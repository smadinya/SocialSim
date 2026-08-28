import type {
  CharacterId,
  Move,
  ResolvedMove,
  TickResult,
  WorldState,
} from "./types";

import {
  createMoveEvent,
} from "./world/events";

import {
  determineObservers,
} from "./world/perception";

import {
  getEligibleActors,
  isLegalMove,
} from "./moves/legalMoves";
import { applyMoveEffects } from "./moves/effects";
import {
  activeConversationFor,
  cleanupStaleConversations,
  continueConversation,
  endConversation,
  ensureConversationForMove,
  interruptConversationsForMove,
} from "./conversations";
import { applyRequestMove, expireRequests } from "./requests";
import { promoteConversationBeat } from "./memory";
import { normalizeRelationship } from "./relationships";
import { normalizeWorldState } from "./world/normalize";
import { selectNpcMoves } from "./behavior/utility";
import { resolveArrivals } from "./world/presence";

export function resolveTick(
  world: WorldState,
  moves: Move[],
  options: {
    playerId?: CharacterId;
    decisionTraces?: TickResult["decisionTraces"];
    sameRoundFollowUps?: boolean;
  } = {},
): TickResult {
  const next = normalizeWorldState(world);
  const events: TickResult["events"] = [];
  const log: ResolvedMove[] = [];
  const deltas: TickResult["deltas"] = [];
  const decisionTraces = [...(options.decisionTraces ?? [])];
  const reservedActors = new Set<CharacterId>();
  const reservedParticipants = new Set<CharacterId>();

  events.push(...resolveArrivals(next, options.playerId));

  cleanupStaleConversations(next);
  expireRequests(next);
  const queue = [...moves];

  for (let moveIndex = 0; moveIndex < queue.length; moveIndex += 1) {
    const move = queue[moveIndex];
    if (reservedActors.has(move.actor)) {
      throw new Error(
        `Actor ${move.actor} proposed more than one move in the same tick`,
      );
    }

    interruptConversationsForMove(next, move);

    if (!isLegalMove(move, next)) {
      throw new Error(
        `Illegal move: ${move.actor} cannot ${move.id}${move.target ? ` ${move.target}` : ""}`,
      );
    }

    const participants = move.target ? [move.actor, move.target] : [move.actor];
    const conflict = participants.find((participant) => reservedParticipants.has(participant));
    if (conflict && move.args?.sameRoundFollowUp !== true) {
      throw new Error(`Conversation participant ${conflict} is already reserved this tick`);
    }

    reservedActors.add(move.actor);
    participants.forEach((participant) => reservedParticipants.add(participant));

    const event = createMoveEvent(next, move);
    event.OnScene = determineObservers(event, next);
    const conversation = ensureConversationForMove(next, move);

    deltas.push(...applyMoveEffects(next, move, {
      eventId: event.id,
      turn: event.turn,
    }));
    if (conversation) continueConversation(conversation, move, event, next);
    applyRequestMove(next, move, event, conversation?.id);
    promoteConversationBeat(next, move, event, conversation);

    const leavesScene = move.id === "Withdraw" ||
      (move.id === "Help" && move.actor !== options.playerId) ||
      (move.id === "AskForHelp" &&
        move.actor !== options.playerId &&
        move.target === options.playerId);
    if (leavesScene) {
      const active = activeConversationFor(next, move.actor);
      if (active) endConversation(next, active.id);
      next.scene.presentCharacters = next.scene.presentCharacters.filter(
        (characterId) => characterId !== move.actor,
      );
      (next.scene.departures ??= {})[move.actor] = {
        returnTurn: event.turn + 5,
        location: next.scene.location,
      };
    }

    events.push(event);
    if (leavesScene) {
      events.push({
        id: `${event.id}-departure`,
        turn: event.turn,
        type: "departure",
        actor: move.actor,
        description: move.id === "AskForHelp"
          ? `${next.characters[move.actor].name} asked for help, then left the scene for five turns.`
          : move.id === "Help"
            ? `${next.characters[move.actor].name} left to provide help and will return in five turns.`
            : `${next.characters[move.actor].name} left the scene and will return in five turns.`,
        OnScene: [...event.OnScene],
      });
    }
    log.push({
      move,
      witnessedByPlayer: options.playerId
        ? event.OnScene.includes(options.playerId)
        : false,
    });

    const shouldFollowUp =
      options.sameRoundFollowUps === true &&
      options.playerId === move.actor &&
      Boolean(move.target) &&
      !reservedActors.has(move.target!) &&
      !queue.slice(moveIndex + 1).some((queued) => queued.actor === move.target);
    if (shouldFollowUp) {
      const followUp = selectNpcMoves(next, {
        playerId: options.playerId,
        onlyActors: [move.target!],
        followUpTo: move.actor,
        maxActors: 1,
        recentMoves: log.map((entry) => entry.move),
      });
      const selected = followUp.moves[0];
      if (selected) {
        selected.args = { ...selected.args, sameRoundFollowUp: true };
        queue.splice(moveIndex + 1, 0, selected);
        decisionTraces.push(...followUp.traces);
      }
    }
  }

  next.turn += 1;
  expireRequests(next);

  const pendingUtterances = log
    .filter((resolved) => resolved.witnessedByPlayer)
    .map((resolved) => {
      const speaker = next.characters[resolved.move.actor];
      return {
        speaker: resolved.move.actor,
        move: resolved.move,
        mood: speaker?.state.mood ?? "neutral",
        relationshipSnapshot: normalizeRelationship(
          resolved.move.target
            ? speaker?.relationships[resolved.move.target]
            : undefined,
        ),
        speakerBeliefs: [...(speaker?.beliefs ?? [])],
        retrievedMemories: [...(speaker?.memories ?? [])]
          .sort((a, b) => b.importance - a.importance || b.turn - a.turn)
          .slice(0, 5),
        witnessedByPlayer: true,
      };
    });

  return {
    state: next,
    events,
    log,
    deltas,
    pendingUtterances,
    utterances: [],
    eligibleActors: getEligibleActors(next),
    decisionTraces,
  };
}

export function tick(
  world: WorldState,
  playerMove?: Move,
  npcMoves?: Move[],
  options: { playerId?: CharacterId } = {},
): TickResult {
  const normalized = normalizeWorldState(world);
  const selected = npcMoves === undefined
    ? selectNpcMoves(normalized, {
        playerId: options.playerId,
        reservedParticipants: playerMove
          ? [playerMove.actor, ...(playerMove.target ? [playerMove.target] : [])]
          : [],
      })
    : { moves: npcMoves, traces: [] };
  return resolveTick(
    normalized,
    playerMove ? [playerMove, ...selected.moves] : selected.moves,
    { ...options, decisionTraces: selected.traces, sameRoundFollowUps: true },
  );
}

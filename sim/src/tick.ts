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

export function resolveTick(
  world: WorldState,
  moves: Move[],
  options: { playerId?: CharacterId } = {},
): TickResult {
  const next = structuredClone(world);
  const events: TickResult["events"] = [];
  const log: ResolvedMove[] = [];
  const deltas: TickResult["deltas"] = [];
  const reservedActors = new Set<CharacterId>();

  for (const move of moves) {
    if (reservedActors.has(move.actor)) {
      throw new Error(
        `Actor ${move.actor} proposed more than one move in the same tick`,
      );
    }

    if (!isLegalMove(move, next)) {
      throw new Error(`Illegal move: ${move.id}`);
    }

    reservedActors.add(move.actor);

    deltas.push(...applyMoveEffects(next, move));

    const event = createMoveEvent(next, move);
    event.OnScene = determineObservers(event, next);
    events.push(event);
    log.push({
      move,
      witnessedByPlayer: options.playerId
        ? event.OnScene.includes(options.playerId)
        : false,
    });
  }

  next.turn += 1;

  return {
    state: next,
    events,
    log,
    deltas,
    pendingUtterances: [],
    utterances: [],
    eligibleActors: getEligibleActors(next),
  };
}

export function tick(
  world: WorldState,
  playerMove?: Move,
  npcMoves: Move[] = [],
  options: { playerId?: CharacterId } = {},
): TickResult {
  return resolveTick(
    world,
    playerMove ? [playerMove, ...npcMoves] : npcMoves,
    options,
  );
}

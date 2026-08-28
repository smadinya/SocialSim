import type {
  Character,
  CharacterId,
  Move,
  Memory,
  WorldState,
} from "../types";

import {
  MOVE_IDS,
  isKnownMoveId,
  moveNeedsTarget,
} from "./catalog";
import { activeConversationFor, isConversationAvailable } from "../conversations";

export function getEligibleActors(world: WorldState): CharacterId[] {
  return world.scene.presentCharacters.filter((id) => {
    const character = world.characters[id];
    return Boolean(character && character.state);
  });
}

export interface DecisionContext {
  actor: CharacterId;
  relationships: Record<CharacterId, Character["relationships"][CharacterId]>;
  beliefs: Character["beliefs"];
  memories: Memory[];
  legalMoves: Move[];
}

export function buildDecisionContext(
  actor: CharacterId,
  world: WorldState,
): DecisionContext {
  const character = world.characters[actor];

  const legalMoves = getLegalMoves(actor, world);
  const memories = [...(character?.memories ?? [])].sort((a, b) => b.turn - a.turn).slice(0, 5);

  return {
    actor,
    relationships: { ...(character?.relationships ?? {}) },
    beliefs: [...(character?.beliefs ?? [])],
    memories,
    legalMoves,
  };
}

/**
 * TODO:
 * move preconditions.
 */
export function getLegalMoves(
  actor: CharacterId,
  world: WorldState,
): Move[] {
  if (!world.characters[actor] || !world.scene.presentCharacters.includes(actor)) return [];

  const targets = world.scene.presentCharacters.filter(
    (id) => id !== actor && Boolean(world.characters[id]),
  );
  const candidates = MOVE_IDS.flatMap((id): Move[] =>
    moveNeedsTarget(id)
      ? targets.map((target) => ({ id, actor, target }))
      : [{ id, actor }],
  );

  return candidates.filter((move) => isLegalMove(move, world));
}

/**
 * TODO:
 * move validation.
 */
export function isLegalMove(
  move: Move,
  world: WorldState,
): boolean {
  const actor = world.characters[move.actor];

  if (!actor || !world.scene.presentCharacters.includes(move.actor)) {
    return false;
  }

  if (!isKnownMoveId(move.id)) {
    return false;
  }

  if (moveNeedsTarget(move.id)) {
    if (!(
      move.target &&
      move.target !== move.actor &&
      world.characters[move.target] &&
      world.scene.presentCharacters.includes(move.target)
    )) return false;

    const canInterrupt = move.args?.interruptConversation === true;
    if (!canInterrupt && (
      !isConversationAvailable(world, move.actor, move.target) ||
      !isConversationAvailable(world, move.target, move.actor)
    )) return false;
  } else if (move.target !== undefined) {
    return false;
  }

  const conversationId = typeof move.args?.conversationId === "string"
    ? move.args.conversationId
    : undefined;
  if (conversationId) {
    const conversation = world.conversations?.[conversationId];
    if (!conversation || conversation.status !== "active" ||
        !conversation.participants.includes(move.actor) ||
        (move.target && !conversation.participants.includes(move.target))) return false;
  }

  const replyId = typeof move.args?.replyToRequestId === "string"
    ? move.args.replyToRequestId
    : undefined;
  if (replyId) {
    const request = world.socialRequests?.[replyId];
    if (!request || request.recipient !== move.actor ||
        !["pending", "clarification_requested", "delayed", "accepted"].includes(request.status) ||
        !["Comply", "Refuse", "Ask", "Wait", "Help"].includes(move.id) ||
        (move.id !== "Wait" && move.target !== request.requester)) return false;
  }

  const withdrawId = typeof move.args?.requestId === "string"
    ? move.args.requestId
    : undefined;
  if (withdrawId) {
    const request = world.socialRequests?.[withdrawId];
    if (move.id !== "Withdraw" || !request || request.requester !== move.actor ||
        !["pending", "clarification_requested", "delayed"].includes(request.status)) return false;
  }

  const active = activeConversationFor(world, move.actor);
  if (move.target && active && !active.participants.includes(move.target) &&
      move.args?.interruptConversation !== true) return false;
  return true;
}

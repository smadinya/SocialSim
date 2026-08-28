import type {
  CharacterId,
  Move,
  SocialRequest,
  WorldState,
} from "./viewTypes";

const TERMINAL_STATUSES = new Set(["refused", "fulfilled", "failed", "withdrawn"]);
const REQUEST_REPLY_MOVES = new Set(["Comply", "Refuse", "Ask", "Wait", "Help"]);

export function openRequestsForPlayer(
  world: WorldState,
  playerId: CharacterId,
): SocialRequest[] {
  return Object.values(world.socialRequests ?? {})
    .filter((request) =>
      !TERMINAL_STATUSES.has(request.status) &&
      (request.requester === playerId || request.recipient === playerId)
    )
    .sort((a, b) => b.importance - a.importance || a.createdTurn - b.createdTurn);
}

/** Links a menu or interpreted response to the persistent request it answers. */
export function linkMoveToPlayerRequest(
  move: Move,
  world: WorldState,
  playerId: CharacterId,
): Move {
  if (move.actor !== playerId || !REQUEST_REPLY_MOVES.has(move.id)) return move;

  const request = openRequestsForPlayer(world, playerId).find((candidate) => {
    if (candidate.recipient !== playerId) return false;
    if (candidate.status === "accepted" && move.id !== "Help") return false;
    if (move.id === "Wait") return candidate.status !== "accepted";
    return move.target === candidate.requester;
  });
  if (!request) return move;

  const conversation = world.conversations?.[request.conversationId];
  return {
    ...move,
    args: {
      ...move.args,
      replyToRequestId: request.id,
      ...(conversation?.status === "active"
        ? { conversationId: request.conversationId }
        : {}),
    },
  };
}

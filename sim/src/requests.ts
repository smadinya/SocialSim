import type {
  Move,
  SimEvent,
  SocialObligation,
  SocialRequest,
  SocialRequestStatus,
  WorldState,
} from "./types";

function stringArg(move: Move, key: string): string | undefined {
  const value = move.args?.[key];
  return typeof value === "string" ? value : undefined;
}

export function pendingRequestFor(world: WorldState, recipient: string) {
  return Object.values(world.socialRequests ?? {})
    .filter((request) =>
      request.recipient === recipient &&
      ["pending", "clarification_requested", "delayed"].includes(request.status),
    )
    .sort((a, b) => b.importance - a.importance || a.createdTurn - b.createdTurn)[0];
}

export function activeObligationFor(world: WorldState, debtor: string) {
  return Object.values(world.obligations ?? {})
    .filter((obligation) => obligation.debtor === debtor && obligation.status === "active")
    .sort((a, b) => a.createdTurn - b.createdTurn)[0];
}

export function transitionRequest(
  world: WorldState,
  requestId: string,
  status: SocialRequestStatus,
  event: SimEvent,
): SocialRequest {
  const request = world.socialRequests?.[requestId];
  if (!request) throw new Error(`Unknown social request: ${requestId}`);
  request.status = status;
  if (["accepted", "refused", "clarification_requested", "delayed"].includes(status)) {
    request.responseEventId = event.id;
  }
  if (["fulfilled", "failed", "withdrawn"].includes(status)) {
    request.resolutionEventId = event.id;
  }
  return request;
}

function createObligation(
  world: WorldState,
  request: SocialRequest,
): SocialObligation {
  const obligation: SocialObligation = {
    id: `obligation-${request.id}`,
    requestId: request.id,
    debtor: request.recipient,
    creditor: request.requester,
    subject: request.subject,
    createdTurn: world.turn + 1,
    status: "active",
  };
  (world.obligations ??= {})[obligation.id] = obligation;
  return obligation;
}

export function applyRequestMove(
  world: WorldState,
  move: Move,
  event: SimEvent,
  conversationId?: string,
): void {
  if (move.id === "AskForHelp" && move.target && conversationId) {
    const request: SocialRequest = {
      id: `request-${event.id}`,
      conversationId,
      requester: move.actor,
      recipient: move.target,
      subject: stringArg(move, "subject") ?? "help",
      about: stringArg(move, "about"),
      createdTurn: event.turn,
      deadlineTurn: event.turn + 3,
      importance: typeof move.args?.importance === "number"
        ? Math.max(0, Math.min(1, move.args.importance))
        : 0.6,
      status: "pending",
    };
    (world.socialRequests ??= {})[request.id] = request;
    const conversation = world.conversations?.[conversationId];
    if (conversation) conversation.pendingRequestIds.push(request.id);
    return;
  }

  const replyId = stringArg(move, "replyToRequestId");
  if (replyId) {
    const status: SocialRequestStatus = move.id === "Comply"
      ? "accepted"
      : move.id === "Refuse"
        ? "refused"
        : move.id === "Ask"
          ? "clarification_requested"
          : move.id === "Wait"
            ? "delayed"
            : move.id === "Help"
              ? "fulfilled"
              : "failed";
    const request = transitionRequest(world, replyId, status, event);
    if (status === "accepted") createObligation(world, request);
    if (status === "fulfilled" || status === "failed") {
      const obligation = world.obligations?.[`obligation-${request.id}`];
      if (obligation) {
        obligation.status = status;
        obligation.resolvedTurn = event.turn;
        obligation.resolutionEventId = event.id;
      }
    }
  }

  const withdrawId = stringArg(move, "requestId");
  if (move.id === "Withdraw" && withdrawId) {
    transitionRequest(world, withdrawId, "withdrawn", event);
  }
}

export function expireRequests(world: WorldState): void {
  for (const request of Object.values(world.socialRequests ?? {})) {
    if (request.deadlineTurn !== undefined && world.turn > request.deadlineTurn &&
        ["pending", "clarification_requested", "delayed"].includes(request.status)) {
      request.status = "failed";
    }
  }
}

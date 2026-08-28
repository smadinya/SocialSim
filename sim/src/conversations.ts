import type {
  CharacterId,
  Conversation,
  ConversationId,
  ConversationTopic,
  Move,
  SimEvent,
  WorldState,
} from "./types";

export function activeConversationFor(
  world: WorldState,
  character: CharacterId,
): Conversation | undefined {
  return Object.values(world.conversations ?? {}).find(
    (conversation) =>
      conversation.status === "active" &&
      conversation.participants.includes(character),
  );
}

export function isConversationAvailable(
  world: WorldState,
  character: CharacterId,
  partner?: CharacterId,
): boolean {
  const active = activeConversationFor(world, character);
  return !active || Boolean(partner && active.participants.includes(partner));
}

function topicFor(move: Move, world: WorldState): ConversationTopic {
  const subject = move.args?.subject as CharacterId | undefined;
  const targetName = move.target ? world.characters[move.target]?.name ?? move.target : "the group";
  const subjectName = subject ? world.characters[subject]?.name ?? subject : undefined;
  return {
    kind: move.id,
    subject: subject ?? move.target,
    object: subject ? move.target : undefined,
    summary: subjectName
      ? `${move.id} with ${targetName} about ${subjectName}`
      : `${move.id} with ${targetName}`,
    salience: ["Fight", "Confront", "RevealSecret", "SpreadRumor"].includes(move.id)
      ? 0.9
      : 0.5,
  };
}

export function startConversation(
  world: WorldState,
  actor: CharacterId,
  partner: CharacterId,
  move: Move,
): Conversation {
  if (!isConversationAvailable(world, actor, partner) ||
      !isConversationAvailable(world, partner, actor)) {
    throw new Error("Conversation participant is already occupied");
  }
  const participants = [actor, partner].sort();
  const id = `conversation-${world.turn + 1}-${participants.join("-")}`;
  const conversation: Conversation = {
    id,
    participants,
    location: world.scene.location,
    status: "active",
    startedTurn: world.turn + 1,
    lastActiveTurn: world.turn + 1,
    currentSpeaker: actor,
    expectedResponder: partner,
    primaryTopic: topicFor(move, world),
    secondaryTopics: [],
    summary: topicFor(move, world).summary,
    recentTurns: [],
    pendingRequestIds: [],
  };
  (world.conversations ??= {})[id] = conversation;
  return conversation;
}

export function ensureConversationForMove(
  world: WorldState,
  move: Move,
): Conversation | undefined {
  if (!move.target) return undefined;
  const existing = activeConversationFor(world, move.actor);
  if (existing?.participants.includes(move.target)) return existing;
  return startConversation(world, move.actor, move.target, move);
}

export function continueConversation(
  conversation: Conversation,
  move: Move,
  event: SimEvent,
  world: WorldState,
): void {
  const topic = topicFor(move, world);
  if (topic.kind !== conversation.primaryTopic.kind) {
    conversation.secondaryTopics = [
      topic,
      ...conversation.secondaryTopics.filter((item) => item.kind !== topic.kind),
    ].slice(0, 3);
    if (topic.salience > conversation.primaryTopic.salience) {
      const former = conversation.primaryTopic;
      conversation.primaryTopic = topic;
      conversation.secondaryTopics = [former, ...conversation.secondaryTopics]
        .filter((item) => item.kind !== conversation.primaryTopic.kind)
        .filter((item, index, all) => all.findIndex((other) => other.kind === item.kind) === index)
        .slice(0, 3);
    }
  }
  conversation.status = "active";
  conversation.lastActiveTurn = event.turn;
  conversation.currentSpeaker = move.actor;
  conversation.expectedResponder = move.target;
  conversation.recentTurns = [
    ...conversation.recentTurns,
    { turn: event.turn, speaker: move.actor, moveId: move.id, target: move.target, eventId: event.id },
  ].slice(-6);
  const actorName = world.characters[move.actor]?.name ?? move.actor;
  conversation.summary = `${actorName} used ${move.id}; topic: ${conversation.primaryTopic.summary}.`;
}

export function pauseConversation(world: WorldState, id: ConversationId): void {
  const conversation = world.conversations?.[id];
  if (conversation?.status === "active") conversation.status = "paused";
}

export function endConversation(world: WorldState, id: ConversationId): void {
  const conversation = world.conversations?.[id];
  if (conversation) {
    conversation.status = "ended";
    conversation.expectedResponder = undefined;
  }
}

/** Explicit player interruptions pause, rather than overlap, prior conversations. */
export function interruptConversationsForMove(
  world: WorldState,
  move: Move,
): void {
  if (!move.target || move.args?.interruptConversation !== true) return;
  for (const conversation of Object.values(world.conversations ?? {})) {
    if (conversation.status !== "active") continue;
    const touchesNewPair = conversation.participants.includes(move.actor) ||
      conversation.participants.includes(move.target);
    const alreadyThisPair = conversation.participants.includes(move.actor) &&
      conversation.participants.includes(move.target);
    if (touchesNewPair && !alreadyThisPair) pauseConversation(world, conversation.id);
  }
}

export function cleanupStaleConversations(world: WorldState): void {
  for (const conversation of Object.values(world.conversations ?? {})) {
    if (conversation.status === "ended") continue;
    const known = conversation.participants.every((id) => Boolean(world.characters[id]));
    if (!known || world.turn - conversation.lastActiveTurn > 3) {
      endConversation(world, conversation.id);
      continue;
    }
    const present = conversation.participants.every((id) =>
      world.scene.presentCharacters.includes(id),
    );
    if (!present) pauseConversation(world, conversation.id);
  }
}

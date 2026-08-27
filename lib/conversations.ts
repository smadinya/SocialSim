import type {
  CharacterId,
  Conversation,
  ConversationId,
  Move,
  MoveId,
  TopicId,
  WorldState,
} from "./viewTypes";

import { HEAT_DRIFT, MOVE_HEAT, heatState } from "./moveMeta";

/**
 * Conversations are what stop three people talking over each other.
 *
 * Before this, `runTick` shuffled the player's move together with up to two
 * unrelated NPC moves and appended a one-shot reply, and the scene view
 * rendered the result as a single stream — so Bob could answer Alice and open
 * a negotiation with Calum in the same breath. A conversation is the unit that
 * makes a tick legible: who is talking to whom, about what, and how hot it is.
 */

/** Idle this many turns and a conversation is over. */
export const IDLE_TURNS = 3;
/**
 * And nobody talks forever. Without a ceiling, two NPCs who keep answering
 * each other stay paired for the rest of the game — and because a character
 * may only be in one conversation, that takes them both out of circulation
 * permanently. Alice and Dana locked together at turn 4 and neither ever
 * approached the player again.
 */
export const MAX_TURNS = 6;
/** The thread's own short-term memory. */
export const MAX_BEATS = 8;

export function pairKey(a: CharacterId, b: CharacterId): string {
  return [a, b].sort().join("~");
}

export function openConversations(world: WorldState): Conversation[] {
  return Object.values(world.conversations).filter((c) => c.status === "open");
}

export function conversationFor(
  world: WorldState,
  id: CharacterId,
): Conversation | null {
  const cid = world.characters[id]?.activeConversationId;
  if (!cid) return null;
  const conversation = world.conversations[cid];
  return conversation && conversation.status === "open" ? conversation : null;
}

export function partnerOf(
  conversation: Conversation,
  id: CharacterId,
): CharacterId | undefined {
  return conversation.participants.find((p) => p !== id);
}

export function between(
  world: WorldState,
  a: CharacterId,
  b: CharacterId,
): Conversation | null {
  const mine = conversationFor(world, a);
  if (mine && mine.participants.includes(b)) return mine;
  return null;
}

/**
 * Join the open conversation between these two, or open one.
 *
 * Anyone already talking to someone else is pulled out of that conversation
 * first — turning to a third person visibly ends the thing you were in, which
 * is both how it works and how the UI has to be able to render it.
 */
export function openOrJoin(
  world: WorldState,
  actor: CharacterId,
  target: CharacterId,
  topicId?: TopicId,
): Conversation {
  const existing = between(world, actor, target);
  if (existing) {
    existing.lastTurn = world.turn;
    if (topicId) existing.topicId = topicId;
    return existing;
  }

  close(world, actor);
  close(world, target);

  const id: ConversationId = `conv-${world.turn}-${pairKey(actor, target)}`;
  const conversation: Conversation = {
    id,
    participants: [actor, target],
    location: world.characters[actor]?.location ?? world.scene.location,
    topicId,
    startedTurn: world.turn,
    lastTurn: world.turn,
    heat: 0,
    beats: [],
    status: "open",
  };

  world.conversations[id] = conversation;
  if (world.characters[actor]) world.characters[actor].activeConversationId = id;
  if (world.characters[target]) world.characters[target].activeConversationId = id;
  return conversation;
}

/** Record a move as a beat and move the heat. Returns the heat after. */
export function advance(
  world: WorldState,
  conversation: Conversation,
  move: Move,
  turn: number,
): number {
  const delta = MOVE_HEAT[move.id] ?? 0;
  conversation.heat = Math.min(100, Math.max(0, conversation.heat + delta));
  conversation.lastTurn = turn;

  conversation.beats.push({
    turn,
    actor: move.actor,
    moveId: move.id,
    heatAfter: conversation.heat,
  });
  if (conversation.beats.length > MAX_BEATS) {
    conversation.beats.splice(0, conversation.beats.length - MAX_BEATS);
  }

  return conversation.heat;
}

export function close(world: WorldState, id: CharacterId): void {
  const conversation = conversationFor(world, id);
  if (!conversation) return;
  conversation.status = "closed";
  for (const p of conversation.participants) {
    const character = world.characters[p];
    if (character && character.activeConversationId === conversation.id) {
      delete character.activeConversationId;
    }
  }
}

export function closeConversation(
  world: WorldState,
  conversation: Conversation,
): void {
  conversation.status = "closed";
  for (const p of conversation.participants) {
    const character = world.characters[p];
    if (character && character.activeConversationId === conversation.id) {
      delete character.activeConversationId;
    }
  }
}

/**
 * End-of-tick housekeeping: cool everything that wasn't touched, and close
 * anything idle or split across two locations.
 */
export function settle(world: WorldState, turn: number): void {
  for (const conversation of openConversations(world)) {
    if (conversation.lastTurn < turn) {
      conversation.heat = Math.max(0, conversation.heat - HEAT_DRIFT);
    }

    const locations = conversation.participants.map(
      (p) => world.characters[p]?.location,
    );
    const split = locations.some((l) => l !== locations[0]);
    const gone = conversation.participants.some((p) => !world.characters[p]);

    const idle = turn - conversation.lastTurn >= IDLE_TURNS;
    const exhausted = turn - conversation.startedTurn >= MAX_TURNS;
    if (split || gone || idle || exhausted) {
      closeConversation(world, conversation);
    }
  }
}

/** The last few beats as prompt lines. Never numbers — just what happened. */
export function beatLines(
  world: WorldState,
  conversation: Conversation | null,
  limit = 3,
): string[] {
  if (!conversation) return [];
  return conversation.beats.slice(-limit).map((b) => {
    const name = world.characters[b.actor]?.name ?? b.actor;
    return `${name}: ${b.moveId}`;
  });
}

export function heatLabel(heat: number): string {
  const state = heatState(heat);
  if (state === "breaking") return "about to break";
  if (state === "argument") return "an argument";
  if (state === "tense") return "tense";
  return "";
}

/** Who is talking to whom right now, at this location. */
export interface TalkingPair {
  id: ConversationId;
  a: CharacterId;
  b: CharacterId;
  aName: string;
  bName: string;
  topicLabel?: string;
  heat: number;
  heatLabel: string;
}

export function talkingPairs(
  world: WorldState,
  location?: string,
): TalkingPair[] {
  return openConversations(world)
    .filter((c) => !location || c.location === location)
    .map((c) => {
      const [a, b] = c.participants;
      return {
        id: c.id,
        a,
        b,
        aName: world.characters[a]?.name ?? a,
        bName: world.characters[b]?.name ?? b,
        topicLabel: c.topicId ? world.topics[c.topicId]?.label : undefined,
        heat: c.heat,
        heatLabel: heatLabel(c.heat),
      };
    });
}

/** Moves that are about a subject rather than only a person. */
export const TOPICAL_MOVES: MoveId[] = [
  "AskAbout",
  "RevealSecret",
  "SpreadRumor",
  "Confront",
];

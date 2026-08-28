import type {
  CharacterId,
  Thread,
  Evidence,
  LocationId,
  Move,
  MoveId,
  PendingRequest,
  RelationshipDelta,
  RelationshipField,
  RelationshipValues,
  ResolvedMove,
  SimEvent,
  TickResult,
  TopicId,
  Utterance,
  WorldState,
} from "./viewTypes";

import {
  BYSTANDER_IMPORTANCE,
  DEFAULT_IMPORTANCE,
  MOVE_IMPORTANCE,
  MOVE_VALENCE,
  canFight,
  effectsFor,
  flirtLandedBadly,
  heatMultiplier,
  heatState,
  isCoreMove,
  stubDialogue,
} from "./moveMeta";
import { REL_FIELDS, clamp, relationshipTone } from "./format";
import { MOVES_PER_DAY, dayIsSpent } from "./clock";
import {
  NIGHT_DECAY_MULTIPLIER,
  decayRelationship,
  driftBaseline,
  recordStatusChanges,
  setFlag,
  snapshotStatuses,
  statusFor,
} from "./relationships";
import {
  advance,
  between,
  close,
  closeConversation,
  conversationFor,
  lastBeatBy,
  openOrJoin,
  recentlyClosed,
  settle,
} from "./conversations";
import {
  CULPRIT,
  LEAK_TOPIC,
  RECKONING_DAY,
  giveEvidence,
  leadingSuspect,
  makeAware,
  phaseFor,
  resolveReckoning,
  shareableEvidence,
  unlockEvidence,
  willShare,
} from "./topics";
import type { CognitionPatch } from "@sim/cognition/schemas";
import { applyCognitionPatch } from "@sim/cognition/applyPatch";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nameOf(world: WorldState, id?: CharacterId): string {
  if (!id) return "";
  return world.characters[id]?.name ?? id;
}

// --- geography ------------------------------------------------------------

/**
 * The scene is derived from where people are standing. It used to be fixture
 * data with no transition rule, which is why the fixture's own conflict was
 * unreachable — everyone wanted to confront Bob and Bob was never in the room.
 */
export function deriveScene(world: WorldState, playerId: CharacterId): void {
  const here = world.characters[playerId]?.location ?? world.scene.location;
  world.scene.location = here;
  world.scene.presentCharacters = Object.keys(world.characters).filter(
    (id) => world.characters[id].location === here,
  );
}

function coLocated(world: WorldState, a: CharacterId, b?: CharacterId): boolean {
  if (!b) return false;
  return world.characters[a]?.location === world.characters[b]?.location;
}

/** First hop along the shortest path, or null if there isn't one. */
export function nextHop(
  world: WorldState,
  from: LocationId,
  to: LocationId,
): LocationId | null {
  if (from === to) return null;
  const seen = new Set<LocationId>([from]);
  // Each entry carries the first step taken to reach it, so the answer falls
  // out of the queue rather than needing a parent map walked backwards.
  const queue: { at: LocationId; first: LocationId }[] = [];

  for (const next of world.locations[from]?.connectsTo ?? []) {
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push({ at: next, first: next });
  }

  while (queue.length > 0) {
    const entry = queue.shift() as { at: LocationId; first: LocationId };
    if (entry.at === to) return entry.first;
    for (const next of world.locations[entry.at]?.connectsTo ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ at: next, first: entry.first });
    }
  }
  return null;
}

// --- what NPCs want -------------------------------------------------------

interface Tendency {
  moveId: MoveId;
  target: CharacterId;
  weight: number;
}

/**
 * Standing wants. Weights stay low so the NPC-to-NPC drama isn't drowned out.
 *
 * `Ask` entries are what make the mystery move without the player: Dana
 * and Alice compare notes on their own, and evidence spreads whether or not
 * anyone is watching.
 */
const TENDENCIES: Record<CharacterId, Tendency[]> = {
  bob: [
    { moveId: "Propose", target: "calum", weight: 3 },
    { moveId: "GiveGift", target: "calum", weight: 2 },
    { moveId: "Greet", target: "alice", weight: 1 },
    { moveId: "SpreadRumor", target: "you", weight: 2 },
    { moveId: "Greet", target: "you", weight: 1 },
  ],
  dana: [
    { moveId: "Confront", target: "bob", weight: 3 },
    { moveId: "Defend", target: "alice", weight: 2 },
    { moveId: "Ask", target: "calum", weight: 2 },
    // Weight 1 out of 8 meant Dana could go a whole game without once
    // addressing the player. She promised Alice she would find out who
    // talked; the newcomer nobody has a history with is an obvious ally.
    { moveId: "AskForHelp", target: "you", weight: 2 },
  ],
  alice: [
    { moveId: "Ask", target: "dana", weight: 3 },
    { moveId: "AskForHelp", target: "dana", weight: 2 },
    { moveId: "Confront", target: "bob", weight: 2 },
    { moveId: "AskForHelp", target: "you", weight: 2 },
    { moveId: "Greet", target: "you", weight: 1 },
  ],
  calum: [
    { moveId: "Greet", target: "dana", weight: 2 },
    { moveId: "AskForHelp", target: "alice", weight: 1 },
    { moveId: "Ask", target: "you", weight: 1 },
    { moveId: "Greet", target: "you", weight: 1 },
  ],
};

/**
 * What someone does when a move lands on them.
 *
 * This is now the conversation advancing rather than a one-shot reply: the
 * partner owes the next beat, and how hot the thread already is decides
 * whether they de-escalate or swing back.
 */
const RESPONSES: Record<string, { warm: MoveId; cold: MoveId }> = {
  Confront: { warm: "Comply", cold: "Refuse" },
  Greet: { warm: "Greet", cold: "Greet" },
  // Not `Withdraw`: that relocates the responder and closes the thread, so
  // an argument with anyone who didn't already hate you ended on its first
  // beat and `Fight` was unreachable. Someone who likes you asks what that
  // was for. Leaving is what `breaking` escalates to, not what it opens with.
  Insult: { warm: "Confront", cold: "Insult" },
  GiveGift: { warm: "Comply", cold: "Greet" },
  AskForHelp: { warm: "Comply", cold: "Refuse" },
  Ask: { warm: "RevealSecret", cold: "Refuse" },
  Apologize: { warm: "Comply", cold: "Refuse" },
  Reassure: { warm: "Comply", cold: "Refuse" },
  SpreadRumor: { warm: "Confront", cold: "Confront" },
  Propose: { warm: "Comply", cold: "Refuse" },
  RevealSecret: { warm: "Comply", cold: "Refuse" },
  Defend: { warm: "Comply", cold: "Greet" },
  Flirt: { warm: "Flirt", cold: "Withdraw" },
  Fight: { warm: "Withdraw", cold: "Fight" },
  Refuse: { warm: "Withdraw", cold: "Insult" },
};

/**
 * The partner's next beat, or null.
 *
 * At `breaking` heat a hostile reply escalates to `Fight` on its own — which
 * is the only way an argument can end in something other than the two of them
 * repeating the same insult at each other forever.
 */
function respondTo(
  world: WorldState,
  move: Move,
  acting: CharacterId[],
  heat: number,
): Move | null {
  const responder = move.target;
  if (!responder || responder === move.actor) return null;
  if (!coLocated(world, move.actor, responder)) return null;
  if (acting.includes(responder)) return null;
  if (move.id === "GoTo" || move.id === "Wait") return null;

  const pair = RESPONSES[move.id];
  if (!pair) return null;

  const rel = world.characters[responder]?.relationships?.[move.actor];
  const cold = rel ? relationshipTone(rel) === "cold" : false;
  let id = cold ? pair.cold : pair.warm;

  // Don't promise a secret you haven't got. `RevealSecret` writes its line in
  // `resolveMove` and only *then* discovers, inside `resolveTopical`, that
  // there is nothing left to hand over — so Alice answered thirty consecutive
  // questions with "There's something you should know, Robin" and transferred
  // a fact exactly once. Someone with nothing more to give says so.
  if (id === "RevealSecret") {
    const topicId = topicFor(world, move);
    const has =
      topicId && shareableEvidence(world, responder, move.actor, topicId);
    if (!has) id = "Refuse";
  }

  if (heatState(heat) === "breaking" && (id === "Insult" || id === "Refuse")) {
    id = "Fight";
  }

  // The same no-repeats rule `legalTendencies` applies to autonomous moves.
  // `RESPONSES` is a pure function of the incoming move and the tone, so two
  // NPCs locked in a stable pair answered each other with the identical
  // sentence indefinitely — Bob proposing and Calum saying "Fine, Bob. We'll
  // do it your way" on every tick until the thread aged out. Saying nothing is
  // a better beat than saying it twice, and lets `IDLE_TURNS` close the thread.
  const said = lastBeatBy(world, responder);
  if (
    said &&
    said.turn >= world.turn - 1 &&
    said.moveId === id &&
    said.target === move.actor
  ) {
    return null;
  }

  const reply: Move = { id, actor: responder, target: move.actor };
  if (move.args?.topicId) reply.args = { topicId: move.args.topicId };
  return reply;
}

/** The topic a move carries, before `resolveMove` has opened its thread. */
function topicFor(world: WorldState, move: Move): TopicId | undefined {
  return topicOf(world, move, conversationFor(world, move.actor));
}

function pickTendency(list: Tendency[], roll: number): Tendency | null {
  if (list.length === 0) return null;
  const total = list.reduce((sum, t) => sum + t.weight, 0);
  let mark = roll * total;
  for (const t of list) {
    mark -= t.weight;
    if (mark <= 0) return t;
  }
  return list[0];
}

/**
 * Tendencies this actor can actually carry out: not aimed at themselves, and
 * aimed at someone in the same room.
 *
 * Filtered *before* weighting. Rolling first and discarding an illegal result
 * is how Calum ended up acting zero times in sixty turns.
 *
 * The one-conversation rule lives here: someone already talking to a partner
 * may only act *within* that conversation. It is the whole fix for three
 * people talking over each other.
 */
function legalTendencies(
  world: WorldState,
  actor: CharacterId,
): Tendency[] {
  const conversation = conversationFor(world, actor);
  const engagedWith = conversation
    ? conversation.participants.find((p) => p !== actor)
    : undefined;

  // Nobody says the same sentence twice in a row. A tendency table plus a
  // weighted roll is a stationary process: Calum greeted Dana with the same
  // words on four consecutive ticks and Dana confronted Bob on five, because
  // nothing in the loop could see what the actor had just done. Excluding the
  // actor's own last beat costs one lookup and is the difference between a
  // conversation and a stuck record.
  const previous = lastBeatBy(world, actor);
  const justSaid = (t: Tendency) =>
    Boolean(
      previous &&
        previous.turn >= world.turn - 1 &&
        previous.moveId === t.moveId &&
        previous.target === t.target,
    );

  return (TENDENCIES[actor] ?? []).filter((t) => {
    if (t.target === actor) return false;
    if (!coLocated(world, actor, t.target)) return false;
    if (justSaid(t)) return false;
    if (engagedWith) return t.target === engagedWith;

    // The rule has to hold from BOTH ends. Enforcing it only on the actor let
    // an idle third party open a conversation with someone already mid-thread
    // — which closed that thread and reset its heat, so an argument could
    // never survive a bystander saying hello.
    const theirs = conversationFor(world, t.target);
    if (theirs && !theirs.participants.includes(actor)) return false;

    // A thread that just hit its ceiling does not restart on the next tick.
    return !recentlyClosed(world, actor, t.target, world.turn);
  });
}

/**
 * Where an unengaged NPC walks, one hop per tick. Replaces the old
 * `pickArrival`, which could only ever add someone to the single room.
 */
function pickMovement(
  world: WorldState,
  actor: CharacterId,
): LocationId | null {
  if (conversationFor(world, actor)) return null;

  let top: Tendency | null = null;
  for (const t of TENDENCIES[actor] ?? []) {
    if (t.target === actor) continue;
    if (!top || t.weight > top.weight) top = t;
  }
  if (!top) return null;

  const from = world.characters[actor]?.location;
  const to = world.characters[top.target]?.location;
  if (!from || !to || from === to) return null;
  return nextHop(world, from, to);
}

// --- effects --------------------------------------------------------------

function applyEffects(
  world: WorldState,
  move: Move,
  deltas: RelationshipDelta[],
  heat: number,
  threadId?: string,
): void {
  const multiplier = heatMultiplier(heat);

  for (const effect of effectsFor(world, move)) {
    const owner = effect.onTarget ? move.target : move.actor;
    const other = effect.onTarget ? move.actor : move.target;
    if (!owner || !other) continue;

    const character = world.characters[owner];
    if (!character) continue;

    const rel = character.relationships[other];
    if (!rel) continue;

    const field = effect.field as RelationshipField;
    const before = rel[field];
    const after = clamp(before + effect.amount * multiplier);
    rel[field] = after;
    if (before !== after) {
      rel.lastDelta[field] = after - before;
      deltas.push({
        sourceActor: move.actor,
        from: owner,
        to: other,
        field,
        before,
        after,
        threadId,
      });
    }
  }
}

// --- memory ---------------------------------------------------------------

/** Ordinary memories only. Core memories are never evicted. */
const MEMORY_CAP = 12;

function verbFor(moveId: MoveId): string {
  const verbs: Record<string, string> = {
    Greet: "greeted",
    Ask: "asked questions of",
    Confront: "confronted",
    GiveGift: "gave a gift to",
    SpreadRumor: "spread a rumor about",
    RevealSecret: "revealed a secret to",
    Defend: "defended",
    Insult: "insulted",
    Apologize: "apologized to",
    Reassure: "steadied",
    AskForHelp: "asked for help from",
    Refuse: "refused",
    Comply: "went along with",
    Flirt: "flirted with",
    Fight: "had it out with",
    Withdraw: "stepped away",
    GoTo: "walked off",
    Wait: "waited",
    Propose: "proposed an alliance with",
  };
  return verbs[moveId] || `used ${moveId} on`;
}

interface MemoryContext {
  turn: number;
  heat: number;
  threadId?: string;
  topicId?: TopicId;
}

/** Returns the importance written, or 0 if there was nobody to write it for. */
function writeMemory(
  world: WorldState,
  observer: CharacterId,
  move: Move,
  ctx: MemoryContext,
): number {
  const character = world.characters[observer];
  if (!character) return 0;

  const verb = verbFor(move.id);
  const subject = move.actor === observer ? "I" : nameOf(world, move.actor);
  const object = move.target === observer ? "me" : nameOf(world, move.target);
  const about = ctx.topicId ? ` about ${world.topics[ctx.topicId]?.label ?? ""}` : "";
  const summary = object
    ? `${subject} ${verb} ${object}${about}.`
    : `${subject} ${verb}${about}.`;

  const involved = observer === move.actor || observer === move.target;
  const importance =
    (MOVE_IMPORTANCE[move.id] ?? DEFAULT_IMPORTANCE) *
    (involved ? 1 : BYSTANDER_IMPORTANCE);

  const core = isCoreMove(move.id, ctx.heat);
  const valence = (MOVE_VALENCE[move.id] ?? 0) * (observer === move.target ? 1 : 0.5);

  character.memories.push({
    id: `mem-${observer}-${ctx.turn}-${move.actor}-${move.id}${move.target ? `-${move.target}` : ""}`,
    turn: ctx.turn,
    actor: move.actor,
    target: move.target,
    description: summary,
    tags: [move.id.toLowerCase(), ...(ctx.topicId ? [ctx.topicId] : [])],
    importance,
    valence,
    tier: involved ? "direct" : "overheard",
    accurate: true,
    core,
    topicId: ctx.topicId,
    threadId: ctx.threadId,
  });

  evictOrdinary(character.memories);
  return importance;
}

/**
 * Evict the least important *ordinary* memory. Core memories are exempt.
 *
 * The cap used to apply to everything, sorted on raw importance, which meant
 * twelve slots of procedural filler competed with the betrayal the whole
 * scenario is about.
 */
function evictOrdinary(memories: WorldState["characters"][string]["memories"]): void {
  const ordinary = memories.filter((m) => !m.core);
  if (ordinary.length <= MEMORY_CAP) return;

  const keep = new Set(
    ordinary
      .slice()
      .sort((a, b) => b.importance - a.importance || b.turn - a.turn)
      .slice(0, MEMORY_CAP)
      .map((m) => m.id),
  );

  for (let i = memories.length - 1; i >= 0; i--) {
    if (!memories[i].core && !keep.has(memories[i].id)) memories.splice(i, 1);
  }
}

function writeCoreMemory(
  world: WorldState,
  observer: CharacterId,
  turn: number,
  description: string,
  tags: string[],
  valence: number,
  topicId?: TopicId,
): void {
  const character = world.characters[observer];
  if (!character) return;
  character.memories.push({
    id: `mem-${observer}-${turn}-${tags.join("-")}`,
    turn,
    actor: observer,
    description,
    tags,
    importance: 0.9,
    valence,
    tier: "direct",
    accurate: true,
    core: true,
    topicId,
  });
}

// --- beliefs --------------------------------------------------------------

/**
 * Belief confidence is now a function of the evidence someone holds, not of
 * whether a move happened to name them.
 *
 * The old rule nudged any belief whose *description text* mentioned someone
 * involved in the move, because `Belief` carried no `subject`. It does now.
 */
function beliefPatches(
  world: WorldState,
  observer: CharacterId,
): CognitionPatch[] {
  const patches: CognitionPatch[] = [];
  const leading = leadingSuspect(world, observer, LEAK_TOPIC);
  if (!leading) return patches;

  for (const belief of world.characters[observer]?.beliefs ?? []) {
    if (belief.id !== `bel-${observer}-leak`) continue;

    const confidence = Math.round(leading.confidence * 100) / 100;
    const subject = leading.suspect;
    if (belief.confidence === confidence && belief.subject === subject) continue;

    patches.push({
      op: "merge",
      path: `/characters/${observer}/beliefs`,
      value: {
        id: belief.id,
        subject,
        confidence,
        description: `${nameOf(world, subject)} is the one who leaked the plan.`,
      },
      reason: `evidence held about ${LEAK_TOPIC}`,
    });
  }

  return patches;
}

/** Mood follows the biggest thing that happened to you this tick. */
const MOOD_FOR: Record<string, string> = {
  "trust:+": "reassured",
  "trust:-": "stung",
  "affection:+": "warmed",
  "affection:-": "hurt",
  "respect:+": "impressed",
  "respect:-": "slighted",
  "fear:+": "rattled",
  "fear:-": "steadier",
  "anger:+": "furious",
  "anger:-": "cooling",
};

/** Below this a Greet's +3 affection would rewrite how someone feels. */
const MOOD_THRESHOLD = 5;

function moodPatches(deltas: RelationshipDelta[]): CognitionPatch[] {
  const biggest = new Map<CharacterId, RelationshipDelta>();
  for (const d of deltas) {
    const size = Math.abs(d.after - d.before);
    if (size < MOOD_THRESHOLD) continue;
    const held = biggest.get(d.from);
    if (!held || size > Math.abs(held.after - held.before)) biggest.set(d.from, d);
  }

  const patches: CognitionPatch[] = [];
  for (const [id, d] of biggest) {
    const mood = MOOD_FOR[`${d.field}:${d.after > d.before ? "+" : "-"}`];
    if (mood) {
      patches.push({
        op: "set",
        path: `/characters/${id}/state/mood`,
        value: mood,
        reason: `${d.field} ${d.before} -> ${d.after}`,
      });
    }
  }
  return patches;
}

// --- pending requests -----------------------------------------------------

const REQUEST_MOVES = new Set<MoveId>(["AskForHelp", "Propose"]);
const REQUEST_TTL = 3;
/** Answering a request. Any of these clears it. */
const ANSWER_MOVES = new Set<MoveId>(["Comply", "Refuse", "Withdraw"]);

export function requestsFor(
  world: WorldState,
  id: CharacterId,
): PendingRequest[] {
  return world.pendingRequests.filter((r) => r.to === id);
}

function openRequest(world: WorldState, move: Move, turn: number): void {
  if (!REQUEST_MOVES.has(move.id) || !move.target) return;
  const already = world.pendingRequests.some(
    (r) => r.from === move.actor && r.to === move.target,
  );
  if (already) return;

  world.pendingRequests.push({
    id: `req-${turn}-${move.actor}-${move.target}`,
    from: move.actor,
    to: move.target,
    moveId: move.id,
    topicId: move.args?.topicId as TopicId | undefined,
    turnAsked: turn,
    expiresTurn: turn + REQUEST_TTL,
  });
}

function answerRequest(world: WorldState, move: Move): void {
  if (!ANSWER_MOVES.has(move.id)) return;
  const at = world.pendingRequests.findIndex(
    (r) => r.to === move.actor && (!move.target || r.from === move.target),
  );
  if (at >= 0) world.pendingRequests.splice(at, 1);
}

/**
 * Letting a request lapse is a choice and it costs. Silence used to be free,
 * which made "will you help me?" indistinguishable from weather.
 */
function expireRequests(
  world: WorldState,
  turn: number,
  deltas: RelationshipDelta[],
  events: SimEvent[],
): void {
  for (let i = world.pendingRequests.length - 1; i >= 0; i--) {
    const request = world.pendingRequests[i];
    if (turn < request.expiresTurn) continue;
    world.pendingRequests.splice(i, 1);

    const rel = world.characters[request.from]?.relationships?.[request.to];
    if (!rel) continue;

    for (const [field, amount] of [
      ["affection", -6],
      ["respect", -4],
    ] as [RelationshipField, number][]) {
      const before = rel[field];
      const after = clamp(before + amount);
      rel[field] = after;
      if (before !== after) {
        rel.lastDelta[field] = after - before;
        deltas.push({
          sourceActor: request.to,
          from: request.from,
          to: request.to,
          field,
          before,
          after,
        });
      }
    }

    events.push({
      id: `event-${turn}-lapsed-${request.id}`,
      turn,
      type: "lapsed",
      actor: request.to,
      target: request.from,
      description: `${nameOf(world, request.from)} stops waiting for an answer from ${nameOf(world, request.to)}.`,
      OnScene: [request.from, request.to],
    });
  }
}

// --- topical moves --------------------------------------------------------

/**
 * What this move is about.
 *
 * Only `Ask` and `SpreadRumor` default to the leak: both are meaningless
 * without a subject, and the leak is the only topic carrying evidence. The
 * others take an explicit arg or the topic the conversation is already on —
 * defaulting them too made every bare `Confront` an accusation about the leak,
 * which showed up as memories reading "I confronted Alice about the leaked
 * plan" when the player had said nothing of the kind.
 */
const TOPIC_DEFAULTING: MoveId[] = ["Ask", "SpreadRumor"];

function topicOf(world: WorldState, move: Move, conversation: Thread | null): TopicId | undefined {
  const named = move.args?.topicId as TopicId | undefined;
  if (named && world.topics[named]) return named;
  if (conversation?.topicId) return conversation.topicId;
  if (TOPIC_DEFAULTING.includes(move.id) && world.topics[LEAK_TOPIC]) {
    return LEAK_TOPIC;
  }
  return undefined;
}

/**
 * "Talk or hear about the thing." `Ask` is the only route by which a fact
 * moves between two people, and it is gated on trust — which is what makes the
 * relationship numbers load-bearing for the mystery rather than decorative.
 */
/**
 * Everyone standing in the room when a fact changes hands hears it too.
 *
 * `MemoryTier` has carried `overheard` since the first schema and nothing ever
 * set it, because there was no mechanism by which a bystander learned
 * anything. It also means watching and waiting is a real, slow way to find
 * things out — which is what the protagonist is supposed to be doing.
 */
function overhear(
  world: WorldState,
  evidence: Evidence,
  speakers: CharacterId[],
  turn: number,
  topicId: TopicId,
): void {
  const where = world.characters[speakers[0]]?.location;
  if (!where || world.locations[where]?.private) return;

  for (const id of Object.keys(world.characters)) {
    if (speakers.includes(id)) continue;
    if (world.characters[id].location !== where) continue;
    if (evidence.heldBy.includes(id)) continue;
    // You cannot learn a fact about yourself from a conversation you are not
    // in. See `shareableEvidence` — the same rule, the other route in.
    if (evidence.pointsAt === id) continue;
    // Someone mid-conversation of their own is not listening to yours. Without
    // this the room was a public address system: one question put to Alice on
    // the opening turn handed her keystone secret to Bob, Calum and Dana at
    // once, and by the endgame all five held all six pieces — which is the
    // scenario's central asymmetry deleted.
    if (conversationFor(world, id)) continue;

    evidence.heldBy.push(id);
    const character = world.characters[id];
    character.memories.push({
      id: `mem-${id}-${turn}-overheard-${evidence.id}`,
      turn,
      actor: speakers[0],
      description: `I overheard it: ${evidence.claim}`,
      tags: [topicId, "evidence", "overheard"],
      importance: 0.6,
      valence: -0.2,
      tier: "overheard",
      accurate: true,
      core: true,
      topicId,
    });
  }
}

function resolveTopical(
  world: WorldState,
  move: Move,
  topicId: TopicId | undefined,
  turn: number,
  events: SimEvent[],
): void {
  if (!topicId || !move.target) return;
  const topic = world.topics[topicId];
  if (!topic) return;

  makeAware(world, move.actor, topicId);
  makeAware(world, move.target, topicId);

  if (move.id === "Ask") {
    if (!willShare(world, move.target, move.actor)) return;
    const evidence = shareableEvidence(world, move.target, move.actor, topicId);
    if (!evidence) return;
    giveEvidence(evidence, move.actor);
    overhear(world, evidence, [move.actor, move.target], turn, topicId);
    writeCoreMemory(
      world,
      move.actor,
      turn,
      `${nameOf(world, move.target)} told me: ${evidence.claim}`,
      [topicId, "evidence"],
      -0.2,
      topicId,
    );
    events.push({
      id: `event-${turn}-evidence-${evidence.id}-${move.actor}`,
      turn,
      type: "evidence",
      actor: move.target,
      target: move.actor,
      description: `${nameOf(world, move.actor)} learns: ${evidence.claim}`,
      OnScene: [move.actor, move.target],
    });
    return;
  }

  if (move.id === "RevealSecret") {
    const evidence = shareableEvidence(world, move.actor, move.target, topicId);
    if (!evidence) return;
    giveEvidence(evidence, move.target);
    overhear(world, evidence, [move.actor, move.target], turn, topicId);
    writeCoreMemory(
      world,
      move.target,
      turn,
      `${nameOf(world, move.actor)} told me: ${evidence.claim}`,
      [topicId, "evidence"],
      -0.2,
      topicId,
    );
    return;
  }

  // Pressing someone hard enough shakes something loose that asking nicely
  // never would.
  if (move.id === "Confront") {
    const rel = world.characters[move.target]?.relationships?.[move.actor];
    if (!rel || rel.fear < 45) return;
    const shaken = topic.evidence.find((e) => e.locked && e.pointsAt === move.target);
    if (!shaken) return;
    unlockEvidence(world, topicId, shaken.id, move.actor);
    events.push({
      id: `event-${turn}-cracked-${shaken.id}`,
      turn,
      type: "evidence",
      actor: move.target,
      target: move.actor,
      description: `${nameOf(world, move.target)} slips: ${shaken.claim}`,
      OnScene: [move.actor, move.target],
    });
    return;
  }

  // A rumor plants something that is not true. Whoever hears it cannot tell.
  //
  // `args.subject` is who the player said the rumor was about. It used to be
  // written by both interpreters and read by neither, so "spread a rumor to
  // Alice about Bob" planted the first lie in the table — which is about
  // Calum. Saying one thing and doing another is worse than not supporting it.
  if (move.id === "SpreadRumor") {
    const listener = move.target as CharacterId;
    const subject = move.args?.subject as CharacterId | undefined;
    const pool = topic.evidence.filter(
      (e) => !e.accurate && e.pointsAt !== listener && !e.heldBy.includes(listener),
    );
    // Naming a subject means that subject: if there is no story to tell about
    // them, none is told. Only an unaimed rumor takes whatever is to hand.
    const planted = subject
      ? pool.find((e) => e.pointsAt === subject)
      : pool[0];
    if (!planted) return;
    planted.locked = false;
    giveEvidence(planted, move.target);
    writeCoreMemory(
      world,
      move.target,
      turn,
      `${nameOf(world, move.actor)} told me: ${planted.claim}`,
      [topicId, "evidence"],
      -0.3,
      topicId,
    );
  }
}

// --- the tick -------------------------------------------------------------

interface TickScratch {
  events: SimEvent[];
  deltas: RelationshipDelta[];
  utterances: Utterance[];
  log: ResolvedMove[];
  patches: CognitionPatch[];
}

/**
 * Resolve one move: effects, conversation beat, memories, events.
 *
 * `witnessedByPlayer` decides whether it becomes a line on screen or a line in
 * the feed. It is now location equality rather than membership of a single
 * hard-coded room.
 */
function resolveMove(
  world: WorldState,
  move: Move,
  playerId: CharacterId,
  turn: number,
  s: TickScratch,
): void {
  // A move at someone in another room can't land. NPCs are filtered before
  // selection, so this catches stale player intent after an NPC walked out.
  if (move.target && !coLocated(world, move.actor, move.target)) return;

  let conversation: Thread | null = null;
  if (move.target && move.id !== "GoTo") {
    conversation = openOrJoin(world, move.actor, move.target);
  }

  const topicId = topicOf(world, move, conversation);
  if (conversation && topicId) conversation.topicId = topicId;

  const heatBefore = conversation?.heat ?? 0;
  applyEffects(world, move, s.deltas, heatBefore, conversation?.id);
  const heatAfter = conversation
    ? advance(world, conversation, move, turn)
    : heatBefore;

  resolveTopical(world, move, topicId, turn, s.events);
  answerRequest(world, move);
  openRequest(world, move, turn);

  const ctx: MemoryContext = {
    turn,
    heat: Math.max(heatBefore, heatAfter),
    threadId: conversation?.id,
    topicId,
  };

  const here = world.characters[playerId]?.location;
  const witnessedByPlayer =
    world.characters[move.actor]?.location === here ||
    (Boolean(move.target) && world.characters[move.target as string]?.location === here);

  s.log.push({ move, witnessedByPlayer, threadId: conversation?.id });

  if (witnessedByPlayer) {
    s.utterances.push({
      speaker: move.actor,
      moveId: move.id,
      line: stubDialogue(
        move.id,
        nameOf(world, move.target),
        nameOf(world, move.args?.subject as CharacterId | undefined) || undefined,
      ),
    });
    for (const observer of world.scene.presentCharacters) {
      writeMemory(world, observer, move, ctx);
    }
  } else {
    writeMemory(world, move.actor, move, ctx);
    if (move.target) writeMemory(world, move.target, move, ctx);

    s.events.push({
      id: `event-${turn}-${move.actor}-${move.id}`,
      turn,
      type: "offscreen",
      actor: move.actor,
      target: move.target,
      description: move.target
        ? `${nameOf(world, move.actor)} ${verbFor(move.id)} ${nameOf(world, move.target)}.`
        : `${nameOf(world, move.actor)} ${verbFor(move.id)}.`,
      OnScene: [move.actor, ...(move.target ? [move.target] : [])],
    });
  }

  if (move.id === "Flirt" && flirtLandedBadly(world, move)) {
    s.events.push({
      id: `event-${turn}-awkward-${move.actor}`,
      turn,
      type: "awkward",
      actor: move.actor,
      target: move.target,
      description: `It doesn't land. ${nameOf(world, move.target)} looks away.`,
      OnScene: [move.actor, ...(move.target ? [move.target] : [])],
    });
  }

  if (move.id === "Fight" && conversation) {
    resolveFight(world, move, conversation, playerId, turn, s);
  }
}

/**
 * A fight ends the conversation and moves someone out of the room. Without
 * that, "storming off" was two characters standing there repeating themselves.
 */
function resolveFight(
  world: WorldState,
  move: Move,
  conversation: Thread,
  playerId: CharacterId,
  turn: number,
  s: TickScratch,
): void {
  for (const [a, b] of [
    [move.actor, move.target],
    [move.target, move.actor],
  ] as [CharacterId, CharacterId | undefined][]) {
    if (!a || !b) continue;
    const rel = world.characters[a]?.relationships?.[b];
    if (rel) setFlag(rel, "estranged");
    writeCoreMemory(
      world,
      a,
      turn,
      `${a === move.actor ? "I" : nameOf(world, move.actor)} and ${a === move.actor ? nameOf(world, b) : "I"} had it out in front of everyone.`,
      ["fight", b],
      -0.9,
    );
  }

  closeConversation(world, conversation);

  // The one who didn't start it leaves — unless that is the player, in which
  // case the one who DID start it leaves instead.
  //
  // The comment here used to assert the player is never walked out and the
  // code did not check. `loser = move.target` was unconditional, so an NPC
  // escalating to `Fight` teleported the player out of the room they had
  // chosen to stand in, and the feed reported it as "Robin walks out." — the
  // player's own character described in the third person, doing something the
  // player never asked for. A fight still empties the room of one of them; it
  // is now always the one whose exit the game is allowed to author.
  const loser = move.target === playerId ? move.actor : move.target;
  if (!loser || loser === playerId) return;
  const from = world.characters[loser]?.location;
  const exits = from ? world.locations[from]?.connectsTo ?? [] : [];
  if (!from || exits.length === 0) return;

  world.characters[loser].location = exits[0];
  close(world, loser);
  s.events.push({
    id: `event-${turn}-storms-${loser}`,
    turn,
    type: "departure",
    actor: loser,
    description: `${nameOf(world, loser)} walks out.`,
    OnScene: [loser],
  });
}

/** The night pass. Everything that resets between days happens here. */
function nightPass(
  world: WorldState,
  playerId: CharacterId,
  rng: () => number,
): SimEvent[] {
  const events: SimEvent[] = [];
  const turn = world.turn;

  for (const conversation of Object.values(world.threads)) {
    if (conversation.status === "open") closeConversation(world, conversation);
  }

  const dropped: RelationshipDelta[] = [];
  expireRequests(world, turn + 999, dropped, events);

  for (const character of Object.values(world.characters)) {
    for (const rel of Object.values(character.relationships)) {
      decayRelationship(rel, NIGHT_DECAY_MULTIPLIER);
      driftBaseline(rel);
      rel.lastDelta = {};
    }
    consolidate(character.memories, turn);
  }

  // The world runs while you sleep. Two unwatched ticks, reported as a digest
  // the next morning rather than as a silent state change.
  for (let i = 0; i < 2; i++) {
    for (const id of Object.keys(world.characters)) {
      if (id === playerId) continue;
      if (rng() >= 0.35) continue;
      const choice = pickTendency(legalTendencies(world, id), rng());
      if (!choice) continue;

      const move: Move = { id: choice.moveId, actor: id, target: choice.target };
      const scratch: TickScratch = {
        events: [],
        deltas: [],
        utterances: [],
        log: [],
        patches: [],
      };
      resolveMove(world, move, playerId, turn, scratch);
      events.push({
        id: `event-night-${world.day}-${id}-${i}`,
        turn,
        type: "overnight",
        actor: id,
        target: choice.target,
        description: `${nameOf(world, id)} ${verbFor(choice.moveId)} ${nameOf(world, choice.target)}.`,
        OnScene: [id, choice.target],
      });
    }
  }

  for (const conversation of Object.values(world.threads)) {
    if (conversation.status === "open") closeConversation(world, conversation);
  }

  world.day += 1;
  world.slot = 0;
  return events;
}

/**
 * A day of small talk becomes one line. Core memories pass through untouched —
 * consolidating a betrayal into "a quiet day" is the failure mode this whole
 * subsystem exists to avoid.
 */
function consolidate(
  memories: WorldState["characters"][string]["memories"],
  turn: number,
): void {
  const filler = memories.filter((m) => !m.core && m.importance < 0.35);
  if (filler.length < 4) return;

  const ids = new Set(filler.map((m) => m.id));
  for (let i = memories.length - 1; i >= 0; i--) {
    if (ids.has(memories[i].id)) memories.splice(i, 1);
  }

  memories.push({
    id: `mem-consolidated-${turn}`,
    turn,
    actor: "",
    description: "Nothing much, for a while. Small talk and waiting.",
    tags: ["quiet"],
    importance: 0.15,
    valence: 0,
    tier: "direct",
    accurate: true,
    core: false,
  });
}

/**
 * Fill in anything a supplied world is missing.
 *
 * `/api/turn` takes the world from the request body, so this runs on data the
 * server did not produce. Every field added in update 1 is defaulted here
 * rather than guarded at each of its ~40 read sites: a world short one
 * collection should play, not throw a 500 halfway through a tick.
 */
export function normalizeWorld(world: WorldState): WorldState {
  const w = world as WorldState & Record<string, unknown>;
  if (typeof w.day !== "number") w.day = 1;
  if (typeof w.slot !== "number") w.slot = 0;
  if (!w.locations) w.locations = {};
  if (!w.topics) w.topics = {};
  if (!w.threads) w.threads = {};
  if (!Array.isArray(w.pendingRequests)) w.pendingRequests = [];
  if (!w.phase) w.phase = "suspicion";

  // A world with no map still needs somewhere for everyone to stand, or
  // co-location is false for every pair and nobody can address anybody.
  const fallback = w.scene?.location ?? Object.keys(w.locations)[0] ?? "here";
  if (!w.locations[fallback]) {
    w.locations[fallback] = {
      id: fallback,
      name: fallback,
      connectsTo: [],
      private: false,
    };
  }
  if (!w.scene) w.scene = { location: fallback, presentCharacters: [] };

  for (const character of Object.values(w.characters)) {
    if (!character.location) character.location = fallback;
    if (!Array.isArray(character.memories)) character.memories = [];
    if (!Array.isArray(character.beliefs)) character.beliefs = [];

    for (const memory of character.memories) {
      if (typeof memory.valence !== "number") memory.valence = 0;
      if (!memory.tier) memory.tier = "direct";
      if (typeof memory.accurate !== "boolean") memory.accurate = true;
      if (typeof memory.core !== "boolean") memory.core = memory.importance >= 0.8;
    }
    for (const belief of character.beliefs) {
      if (!belief.subject) belief.subject = character.id;
    }
    for (const rel of Object.values(character.relationships)) {
      // The boundary between the tolerant shape saves and fixtures are allowed
      // to have (`RelationshipState`, axes optional) and the strict one the
      // engine does arithmetic on. Every axis is a number from here on.
      for (const axis of REL_FIELDS) {
        if (typeof rel[axis] !== "number") rel[axis] = 0;
      }
      if (!rel.flags) rel.flags = [];
      if (!rel.history) rel.history = [];
      if (!rel.lastDelta) rel.lastDelta = {};
      if (!rel.baseline) rel.baseline = {} as RelationshipValues;
      for (const axis of REL_FIELDS) {
        if (typeof rel.baseline[axis] !== "number") rel.baseline[axis] = rel[axis];
      }
    }
  }

  return w;
}

/**
 * Why the player's move cannot happen, or null.
 *
 * Turns are a finite resource now — 24 a day — so a move that lands on nobody
 * has to say so and cost nothing. It used to be dropped silently inside
 * `resolveMove`: the slot was spent, no line was written, no event was
 * emitted, and from the screen it was indistinguishable from a turn where the
 * world simply had nothing to say.
 */
function blockedBecause(
  world: WorldState,
  playerId: CharacterId,
  move: Move,
): string | null {
  if (move.id === "GoTo") {
    const to = move.args?.location as LocationId | undefined;
    if (!to || !world.locations[to]) return "There's no way through there.";
    const here = world.characters[playerId]?.location;
    if (to === here) return "You're already there.";
    if (here && !world.locations[here]?.connectsTo.includes(to)) {
      return `You can't get to the ${world.locations[to].name} from here.`;
    }
    return null;
  }

  if (!move.target) return null;
  const target = world.characters[move.target];
  if (!target) return "There's nobody by that name.";
  if (target.location !== world.characters[playerId]?.location) {
    return `${target.name} isn't here.`;
  }
  if (move.id === "Fight") {
    const conversation = between(world, playerId, move.target);
    if (!canFight(world, playerId, move.target, conversation?.heat ?? 0)) {
      return `It hasn't come to that with ${target.name}. Not yet.`;
    }
  }
  // Same reason `respondTo` no longer answers with a secret it hasn't got:
  // the line is written before `resolveTopical` discovers there is nothing to
  // hand over, so the move reads as a revelation and transfers nothing. Better
  // to say so and keep the move.
  if (move.id === "RevealSecret") {
    const topicId = topicFor(world, move);
    if (!topicId || !shareableEvidence(world, playerId, move.target, topicId)) {
      return `There's nothing you can tell ${target.name} that they don't already know.`;
    }
  }
  return null;
}

/** The world, untouched, plus one line saying why. No slot is spent. */
function refuse(world: WorldState, reason: string): TickResult {
  return {
    state: world,
    utterances: [],
    events: [
      {
        id: `event-${world.turn}-blocked`,
        turn: world.turn,
        type: "blocked",
        description: reason,
        OnScene: [],
      },
    ],
    log: [],
    deltas: [],
  };
}

export function runTick(
  world: WorldState,
  playerId: CharacterId,
  playerMove: Move,
): TickResult {
  const next = normalizeWorld(structuredClone(world));
  deriveScene(next, playerId);

  const blocked = blockedBecause(next, playerId, playerMove);
  if (blocked) return refuse(next, blocked);

  const rng = makeRng((next.rngSeed >>> 0) + next.turn * 101);
  const nextTurn = next.turn + 1;
  next.turn = nextTurn;

  const statusesBefore = snapshotStatuses(next);

  const s: TickScratch = {
    events: [],
    deltas: [],
    utterances: [],
    log: [],
    patches: [],
  };

  // The player walking somewhere is resolved before anything else, so the
  // scene they act in is the one they chose.
  if (playerMove.id === "GoTo") {
    const to = playerMove.args?.location as LocationId | undefined;
    if (to && next.locations[to]) {
      close(next, playerId);
      next.characters[playerId].location = to;
      deriveScene(next, playerId);
      s.events.push({
        id: `event-${nextTurn}-goto-${playerId}`,
        turn: nextTurn,
        type: "arrival",
        actor: playerId,
        description: `You walk to the ${next.locations[to].name}.`,
        OnScene: [...next.scene.presentCharacters],
      });
    }
  }

  // NPCs walk before they act, so whoever arrives can act on the tick they
  // arrive — and so the player can watch them come in.
  for (const id of Object.keys(next.characters)) {
    if (id === playerId) continue;
    const to = pickMovement(next, id);
    if (!to) continue;
    const wasHere = next.characters[id].location === next.scene.location;
    next.characters[id].location = to;
    const nowHere = to === next.scene.location;
    if (nowHere && !wasHere) {
      s.events.push({
        id: `event-${nextTurn}-arrival-${id}`,
        turn: nextTurn,
        type: "arrival",
        actor: id,
        description: `${nameOf(next, id)} arrives.`,
        OnScene: [...next.scene.presentCharacters, id],
      });
    } else if (wasHere && !nowHere) {
      s.events.push({
        id: `event-${nextTurn}-departure-${id}`,
        turn: nextTurn,
        type: "departure",
        actor: id,
        description: `${nameOf(next, id)} heads for the ${next.locations[to]?.name ?? to}.`,
        OnScene: [id],
      });
    }
  }
  deriveScene(next, playerId);

  // `Wait` and `GoTo` are the player letting the world resolve around them.
  const candidates: Move[] =
    playerMove.id === "Wait" || playerMove.id === "GoTo" ? [] : [playerMove];

  // Whoever the player addressed is held back from autonomous selection: if
  // they pick their own move this tick, `respondTo` refuses to also make them
  // reply, and the player's move goes unanswered for reasons invisible from
  // the screen.
  const reserved =
    playerMove.id !== "Wait" && playerMove.id !== "GoTo" ? playerMove.target : undefined;

  let autonomousCount = 0;
  for (const id of Object.keys(next.characters)) {
    if (id === playerId || id === reserved) continue;
    if (autonomousCount >= 2) break;
    // 0.5 was tuned when anyone could act on anyone. The one-conversation
    // rule now takes both partners out of circulation, so a coin flip on top
    // of that left the player paying a slot for a tick where nothing at all
    // happened — which costs more than it used to, because a turn is now a
    // finite resource.
    if (rng() >= 0.7) continue;

    const choice = pickTendency(legalTendencies(next, id), rng());
    if (!choice) continue;

    candidates.push({ id: choice.moveId, actor: id, target: choice.target });
    autonomousCount += 1;
  }

  const order = candidates
    .map((move, index) => ({ move, key: rng() + index * 0.001 }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.move);

  // Appended after the shuffle rather than mixed into it: a reply that
  // resolves before the thing it replies to is worse than no reply.
  //
  // Every move gets a reply, not just the player's. When only the player's did,
  // an NPC addressed by another NPC had no route to a beat at all: `respondTo`
  // was never called for them, and `legalTendencies` confines an engaged
  // character to tendencies aimed at their partner — which for most pairs is
  // the empty set. Bob proposed an alliance to Calum a hundred and nineteen
  // times across eight runs and Calum never once answered. The player is the
  // exception in the other direction: a move aimed AT them gets no automatic
  // reply, because answering is the thing they are here to do.
  const replies: Move[] = [];
  for (const move of order) {
    if (move.target === playerId) continue;
    const conversation = move.target
      ? between(next, move.actor, move.target)
      : null;
    const reply = respondTo(
      next,
      move,
      [...order.map((m) => m.actor), ...replies.map((r) => r.actor)],
      conversation?.heat ?? 0,
    );
    if (reply) replies.push(reply);
  }
  order.push(...replies);

  for (const move of order) {
    resolveMove(next, move, playerId, nextTurn, s);
  }

  // `Withdraw` is the departure half of the presence rule. Breaking off the
  // conversation is the part everyone does, including the player: for them it
  // used to do nothing whatsoever — no relocation (correct, `GoTo` is how they
  // move) but also no disengagement, so the menu offered "step back from the
  // scene" and the player stayed in the room, in the same thread, one move
  // poorer. Walking out afterwards is still NPCs only.
  for (const move of order) {
    if (move.id !== "Withdraw") continue;
    close(next, move.actor);
    if (move.actor === playerId) continue;
    const from = next.characters[move.actor]?.location;
    const exits = from ? next.locations[from]?.connectsTo ?? [] : [];
    if (!from || exits.length === 0) continue;
    next.characters[move.actor].location = exits[0];
    close(next, move.actor);
    s.events.push({
      id: `event-${nextTurn}-departure-${move.actor}`,
      turn: nextTurn,
      type: "departure",
      actor: move.actor,
      description: `${nameOf(next, move.actor)} steps away.`,
      OnScene: [move.actor],
    });
  }

  expireRequests(next, nextTurn, s.deltas, s.events);

  // Decay runs after every effect this tick, so a move's own spike is not
  // immediately pulled back — it decays from the next tick onward.
  for (const character of Object.values(next.characters)) {
    for (const rel of Object.values(character.relationships)) {
      decayRelationship(rel);
    }
  }

  for (const observer of Object.keys(next.characters)) {
    s.patches.push(...beliefPatches(next, observer));
  }
  for (const patch of [...s.patches, ...moodPatches(s.deltas)]) {
    applyCognitionPatch(next, patch);
  }

  settle(next, nextTurn);
  deriveScene(next, playerId);

  for (const change of recordStatusChanges(next, statusesBefore, nextTurn)) {
    const better = improved(change.was, change.now);
    writeCoreMemory(
      next,
      change.from,
      nextTurn,
      better
        ? `${nameOf(next, change.to)} has turned out to be someone I can lean on.`
        : `${nameOf(next, change.to)} is not who I thought they were.`,
      ["status", change.now, change.to],
      better ? 0.5 : -0.5,
    );
    s.events.push({
      id: `event-${nextTurn}-status-${change.from}-${change.to}`,
      turn: nextTurn,
      type: "status",
      actor: change.from,
      target: change.to,
      description: `${nameOf(next, change.from)} ${statusBlurb(change.now, better)} ${nameOf(next, change.to)}.`,
      OnScene: [change.from, change.to],
    });
  }

  next.slot += 1;

  let overnight: SimEvent[] | undefined;
  if (dayIsSpent(next.slot)) {
    overnight = nightPass(next, playerId, rng);
    deriveScene(next, playerId);
  }

  advancePhase(next, playerId, s.events);

  return {
    state: next,
    utterances: s.utterances,
    events: s.events,
    log: s.log,
    deltas: s.deltas,
    overnight,
  };
}

/**
 * Statuses ranked worst to best, so a crossing knows which way it went.
 *
 * Status alone cannot say that: `wary` is a collapse from `friend` and a
 * recovery from `estranged`, and the feed announced both as "has grown wary
 * of". A player watching a relationship climb back out of a fight was told,
 * line by line, that it was still falling apart.
 */
const STATUS_ORDER = [
  "hostile",
  "estranged",
  "rival",
  "wary",
  "neutral",
  "friend",
  "ally",
  "close",
];

function improved(was: string, now: string): boolean {
  return STATUS_ORDER.indexOf(now) > STATUS_ORDER.indexOf(was);
}

/**
 * Every blurb has to end in a preposition, because the name is appended after
 * it. "now treats as a rival" read as "Robin now treats as a rival Alice."
 */
function statusBlurb(status: string, better = false): string {
  const worsening: Record<string, string> = {
    close: "is close with",
    friend: "counts a friend in",
    ally: "is working with",
    neutral: "has cooled toward",
    wary: "has grown wary of",
    rival: "now sees a rival in",
    estranged: "is done with",
    hostile: "is furious with",
  };
  // Only the statuses that read backwards on the way up need a second form.
  const improving: Record<string, string> = {
    neutral: "has come round to",
    wary: "is thawing, a little, toward",
    estranged: "has stopped fighting with",
    rival: "has stepped back from open war with",
  };
  const blurb = (better ? improving[status] : undefined) ?? worsening[status];
  return blurb || "now sees something different in";
}

/** The investigator. The arc is hers; the player is leaning on it. */
const INVESTIGATOR: CharacterId = "alice";

function advancePhase(
  world: WorldState,
  playerId: CharacterId,
  events: SimEvent[],
): void {
  if (world.phase === "resolved") return;

  const was = world.phase;
  world.phase = phaseFor(world, INVESTIGATOR);

  if (world.phase !== was && world.phase !== "resolved") {
    events.push({
      id: `event-${world.turn}-phase-${world.phase}`,
      turn: world.turn,
      type: "phase",
      description:
        world.phase === "investigation"
          ? `${nameOf(world, INVESTIGATOR)} has started asking questions in earnest.`
          : `${nameOf(world, INVESTIGATOR)} has heard enough. She wants an answer today.`,
      OnScene: Object.keys(world.characters),
    });
  }

  const overdue = world.day > RECKONING_DAY;
  if (world.phase === "reckoning" && overdue) {
    const outcome = resolveReckoning(world, INVESTIGATOR);
    world.phase = "resolved";
    world.ending = outcome.ending;
    events.push({
      id: `event-${world.turn}-ending-${outcome.ending}`,
      turn: world.turn,
      type: "ending",
      actor: INVESTIGATOR,
      target: outcome.suspect,
      description: outcome.description,
      OnScene: Object.keys(world.characters),
    });
    writeCoreMemory(
      world,
      playerId,
      world.turn,
      outcome.description,
      ["ending", outcome.ending],
      outcome.correct ? 0.5 : -0.7,
      LEAK_TOPIC,
    );
  }
}

export { CULPRIT, MOVES_PER_DAY, statusFor };

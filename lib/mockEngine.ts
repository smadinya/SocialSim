import type {
  CharacterId,
  Move,
  MoveId,
  RelationshipDelta,
  RelationshipField,
  ResolvedMove,
  SimEvent,
  TickResult,
  Utterance,
  WorldState,
} from "./viewTypes";

import {
  BYSTANDER_IMPORTANCE,
  DEFAULT_IMPORTANCE,
  MOCK_EFFECTS,
  MOVE_IMPORTANCE,
  stubDialogue,
} from "./moveMeta";
import { clamp, relationshipTone } from "./format";
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

function advanceClock(clock: string): string {
  const match = clock.match(/Day\s+(\d+).*?(\d{1,2}):(\d{2})/);
  if (!match) return clock;

  let day = parseInt(match[1], 10);
  let hour = parseInt(match[2], 10);
  let minute = parseInt(match[3], 10) + 5;

  if (minute >= 60) {
    minute -= 60;
    hour += 1;
  }
  if (hour >= 24) {
    hour -= 24;
    day += 1;
  }

  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `Day ${day} — ${hh}:${mm}`;
}

interface Tendency {
  moveId: MoveId;
  target: CharacterId;
  weight: number;
}

/**
 * Standing wants. Only `dana` could ever address the player, so the other three
 * had no route to the protagonist at all — the `you` rows are what lets an NPC
 * *approach*; `RESPONSES` below is what lets them *answer*.
 *
 * Weights stay low so the NPC-to-NPC drama isn't drowned out. Bob's
 * `SpreadRumor → you` is deliberate: he's the gossip and the leaker, and it
 * plants a memory in the player's own array, which is the only route to the
 * false-memory mechanic the premise is built on.
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
    { moveId: "AskForHelp", target: "you", weight: 1 },
  ],
  alice: [
    { moveId: "AskForHelp", target: "dana", weight: 2 },
    { moveId: "Confront", target: "bob", weight: 2 },
    { moveId: "AskForHelp", target: "you", weight: 2 },
    { moveId: "Greet", target: "you", weight: 1 },
  ],
  calum: [
    { moveId: "Greet", target: "dana", weight: 2 },
    { moveId: "AskForHelp", target: "alice", weight: 1 },
    { moveId: "AskForHelp", target: "you", weight: 1 },
    { moveId: "Greet", target: "you", weight: 1 },
  ],
};

/**
 * B-05: what someone does when a move lands on them.
 *
 * NPC selection is a fixed weighted table read with a seeded RNG — it takes no
 * argument describing what just happened, so nothing ever responded to
 * anything. Insult Dana and her next line is about the weather.
 *
 * `relationshipTone` picks the branch, so the same bucketing the fallback lines
 * use decides whether they cooperate or bite back. Neutral goes along.
 *
 * ponytail: a stopgap inside the current shape. Track A's two-stage volition
 * scoring replaces it wholesale and gets the just-written memory of the
 * player's move for free.
 */
const RESPONSES: Record<string, { warm: MoveId; cold: MoveId }> = {
  Confront: { warm: "Comply", cold: "Refuse" },
  Greet: { warm: "Greet", cold: "Greet" },
  Insult: { warm: "Withdraw", cold: "Insult" },
  GiveGift: { warm: "Comply", cold: "Greet" },
  AskForHelp: { warm: "Comply", cold: "Refuse" },
  Apologize: { warm: "Comply", cold: "Refuse" },
  SpreadRumor: { warm: "Confront", cold: "Confront" },
  Propose: { warm: "Comply", cold: "Refuse" },
  RevealSecret: { warm: "Comply", cold: "Refuse" },
  Defend: { warm: "Comply", cold: "Greet" },
};

/**
 * The reply to the player's move, or null. Scoped hard on purpose: only the
 * character the move was aimed at, only if they're here, only if they aren't
 * already acting this tick.
 */
function respondTo(
  world: WorldState,
  move: Move,
  present: CharacterId[],
  acting: CharacterId[],
): Move | null {
  const responder = move.target;
  if (!responder || responder === move.actor) return null;
  if (!present.includes(move.actor) || !present.includes(responder)) return null;
  if (acting.includes(responder)) return null;

  const pair = RESPONSES[move.id];
  if (!pair) return null;

  const rel = world.characters[responder]?.relationships?.[move.actor];
  const cold = rel ? relationshipTone(rel) === "cold" : false;
  return { id: cold ? pair.cold : pair.warm, actor: responder, target: move.actor };
}

function pickTendency(
  list: Tendency[],
  roll: number,
): Tendency | null {
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
 * Tendencies this actor could actually carry out: not aimed at themselves, and
 * not across the scene boundary — both in the room (the player watches it) or
 * both out of it (the feed reports it).
 *
 * Filtered *before* weighting, not after. Rolling first and discarding an
 * illegal result is how Calum ended up acting zero times in sixty turns.
 * ponytail: stand-in for real move preconditions — `isLegalMove` accepts any
 * non-empty string today.
 */
function legalTendencies(
  actor: CharacterId,
  present: CharacterId[],
): Tendency[] {
  return (TENDENCIES[actor] ?? []).filter(
    (t) =>
      t.target !== actor &&
      present.includes(actor) === present.includes(t.target),
  );
}

/**
 * B-02: who walks in this tick, or nobody.
 *
 * Scene membership was fixture data with no transition rule, so the fixture's
 * own conflict was unreachable — everyone wants to confront Bob and Bob is
 * never in the room. An off-scene character walks in when the person their
 * strongest tendency is aimed at is already here; strongest weight wins, one
 * arrival per tick so the courtyard doesn't fill in two turns.
 *
 * Deterministic on purpose: no `rng()` draw, so this doesn't re-roll the rest
 * of the seeded tick.
 *
 * ponytail: stand-in for Track A's `Move` preconditions plus an `Enter`/`Exit`
 * move pair. Cascades — Calum arrives for Dana, then Bob arrives for Calum.
 */
function pickArrival(
  world: WorldState,
  playerId: CharacterId,
  present: CharacterId[],
): CharacterId | null {
  let best: { id: CharacterId; weight: number } | null = null;

  for (const id of Object.keys(world.characters)) {
    if (id === playerId || present.includes(id)) continue;

    let top: Tendency | null = null;
    for (const t of TENDENCIES[id] ?? []) {
      if (!top || t.weight > top.weight) top = t;
    }
    if (!top || !present.includes(top.target)) continue;
    if (!best || top.weight > best.weight) best = { id, weight: top.weight };
  }

  return best ? best.id : null;
}

function applyEffects(
  world: WorldState,
  move: Move,
  deltas: RelationshipDelta[],
): void {
  const effects = MOCK_EFFECTS[move.id] || [];
  for (const effect of effects) {
    const owner = effect.onTarget ? move.target : move.actor;
    const other = effect.onTarget ? move.actor : move.target;
    if (!owner || !other) continue;

    const character = world.characters[owner];
    if (!character) continue;

    const rel = character.relationships[other];
    if (!rel) continue;

    const field = effect.field as RelationshipField;
    const before = rel[field] ?? 0;
    const after = clamp(before + effect.amount);
    rel[field] = after;

    if (before !== after) {
      deltas.push({
        sourceActor: move.actor,
        from: owner,
        to: other,
        field,
        before,
        after,
      });
    }
  }
}

const MEMORY_CAP = 12;

function nameOf(world: WorldState, id?: CharacterId): string {
  if (!id) return "";
  const character = world.characters[id];
  return character ? character.name : id;
}

/** Returns the importance written, or 0 if there was nobody to write it for. */
function writeMemory(
  world: WorldState,
  observer: CharacterId,
  move: Move,
  turn: number,
): number {
  const character = world.characters[observer];
  if (!character) return 0;

  // Readable English, in the right person. `"Dana used AskForHelp on Robin."`
  // made the model guess what "used AskForHelp on" meant — it invented a
  // reciprocal history — and every observer stored byte-identical text, so the
  // player remembered themselves in the third person, by name.
  //
  // Past-tense verbs conjugate the same for both persons, so `verbFor` needs no
  // second table.
  // ponytail: `MoveEffect.memoryTemplate` (work plan §Track A.3) is where these
  // strings belong, written by Track D. This is the readable stand-in.
  const verb = verbFor(move.id);
  const subject = move.actor === observer ? "I" : nameOf(world, move.actor);
  const object = move.target === observer ? "me" : nameOf(world, move.target);
  const summary = object ? `${subject} ${verb} ${object}.` : `${subject} ${verb}.`;

  const involved = observer === move.actor || observer === move.target;
  const importance =
    (MOVE_IMPORTANCE[move.id] ?? DEFAULT_IMPORTANCE) *
    (involved ? 1 : BYSTANDER_IMPORTANCE);

  character.memories.push({
    id: `mem-${observer}-${turn}-${move.actor}-${move.id}${move.target ? `-${move.target}` : ""}`,
    turn,
    actor: move.actor,
    target: move.target,
    description: summary,
    tags: [move.id.toLowerCase()],
    importance,
  });

  // Evict the least important, not the oldest. FIFO flushed the fixture
  // backstory in eight turns, which is every prompt after ~turn 14 retrieving
  // nothing but filler. Sort on raw `importance` — decay belongs in retrieval,
  // where it decides what is recalled now, not what is still recallable at all.
  // Newest wins the tie, so filler at least stays current.
  // ponytail: a cap, not consolidation. Twelve slots of procedural filler still
  // crowd retrieval once the seeds are safe — Track A's consolidation pass
  // (work plan §Track A, memory subsystem) is the real answer.
  if (character.memories.length > MEMORY_CAP) {
    character.memories.sort(
      (a, b) => b.importance - a.importance || b.turn - a.turn,
    );
    character.memories.length = MEMORY_CAP;
  }

  return importance;
}

/**
 * B-12: what a move says about a belief.
 *
 * Beliefs sat frozen because nothing wrote them — Robin still believed
 * "Something happened between Alice and Bob" at 55% after twelve turns of
 * investigating it, and the inspector's confidence percentage was decoration.
 *
 * `Belief` carries no `subject` (`sim/src/types.ts` is frozen), so relevance is
 * "does the description name someone this move involved". Crude, and it is the
 * deterministic pass on purpose: a patch pipeline with no patches in it cannot
 * be debugged, and the LLM-driven cognition pass belongs behind one that works.
 *
 * ponytail: name matching stands in for `Belief.subject`. Replace at G0.
 */
const ACCUSING: MoveId[] = ["Confront", "Insult", "SpreadRumor", "Refuse"];
const EXCULPATING: MoveId[] = ["Defend", "Apologize", "Comply", "GiveGift"];

function beliefPatches(
  world: WorldState,
  observer: CharacterId,
  move: Move,
  importance: number,
): CognitionPatch[] {
  const direction = ACCUSING.includes(move.id)
    ? 1
    : EXCULPATING.includes(move.id)
      ? -1
      : 0;
  if (direction === 0) return [];

  const involved = [move.actor, move.target]
    .filter(Boolean)
    .map((id) => nameOf(world, id as CharacterId))
    .filter(Boolean);
  if (involved.length === 0) return [];

  const named = new RegExp(`\\b(${involved.join("|")})\\b`, "i");
  const patches: CognitionPatch[] = [];

  for (const belief of world.characters[observer]?.beliefs ?? []) {
    if (!named.test(belief.description)) continue;
    // 0.05 at the least important, 0.15 at the most.
    const step = direction * (0.05 + 0.1 * Math.min(1, importance));
    // Never all the way to 0 or 1: a name-matching rule of thumb has no
    // business making anyone certain, and 1.0 is an absorbing state that reads
    // as decoration again from the other end. Real certainty is A's cognition
    // pass with actual evidence behind it.
    const confidence = Math.min(0.95, Math.max(0.05, belief.confidence + step));
    if (confidence === belief.confidence) continue;

    patches.push({
      op: "merge",
      path: `/characters/${observer}/beliefs`,
      value: { id: belief.id, confidence: Math.round(confidence * 100) / 100 },
      reason: `${move.id} involving ${involved.join(" and ")}`,
      sourceMoveId: move.id,
    });
  }

  return patches;
}

/**
 * B-13: mood follows the biggest thing that happened to you this tick.
 *
 * `mood` is a `cacheKey` component and a prompt line, so a frozen mood was a
 * frozen dimension of both. Track D owns the words.
 *
 * ponytail: no decay back to a baseline — `WorldState` doesn't store the
 * fixture mood, so a character keeps the last mood something gave them. Add
 * decay when the baseline exists.
 */
const MOOD_FOR: Record<string, string> = {
  "trust:+": "reassured",
  "trust:-": "stung",
  "gratitude:+": "grateful",
  "gratitude:-": "disappointed",
  "affection:+": "warmed",
  "affection:-": "hurt",
  "respect:+": "impressed",
  "respect:-": "slighted",
  "fear:+": "rattled",
  "fear:-": "steadier",
  "anger:+": "angry",
  "anger:-": "calmer",
  "jealousy:+": "jealous",
  "jealousy:-": "secure",
  "hate:+": "hostile",
  "hate:-": "softened",
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

export function runTick(
  world: WorldState,
  playerId: CharacterId,
  playerMove: Move,
): TickResult {
  const next = structuredClone(world);
  const rng = makeRng((next.rngSeed >>> 0) + next.turn * 101);
  const nextTurn = next.turn + 1;

  const present = next.scene.presentCharacters;
  const events: SimEvent[] = [];

  // Arrivals resolve before move selection, so whoever walks in can act on the
  // same tick they arrive.
  const arriving = pickArrival(next, playerId, present);
  if (arriving) {
    present.push(arriving);
    events.push({
      id: `event-${nextTurn}-arrival-${arriving}`,
      turn: nextTurn,
      type: "arrival",
      actor: arriving,
      description: `${nameOf(next, arriving)} arrives.`,
      OnScene: [...present],
    });
  }

  // `Wait` is the player letting a turn pass: the world resolves, they say
  // nothing, and nothing is written about them. Everyone else still acts.
  const candidates: Move[] = playerMove.id === "Wait" ? [] : [playerMove];

  const npcIds = Object.keys(next.characters).filter(
    (id) => id !== playerId,
  );

  let autonomousCount = 0;
  for (const id of npcIds) {
    if (autonomousCount >= 2) break;
    if (rng() >= 0.5) continue;

    // Filter, then weight. The other order turns "no legal target" into "this
    // character does nothing this turn" — 22 of 60 ticks were empty.
    const choice = pickTendency(legalTendencies(id, present), rng());
    if (!choice) continue;

    candidates.push({ id: choice.moveId, actor: id, target: choice.target });
    autonomousCount += 1;
  }

  const order = candidates
    .map((move, index) => ({ move, key: rng() + index * 0.001 }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.move);

  // Appended after the shuffle rather than mixed into it: a reply that resolves
  // before the thing it replies to is worse than no reply.
  const reply =
    playerMove.id === "Wait"
      ? null
      : respondTo(next, playerMove, present, order.map((m) => m.actor));
  if (reply) order.push(reply);

  const deltas: RelationshipDelta[] = [];
  const utterances: Utterance[] = [];
  const log: ResolvedMove[] = [];

  const patches: CognitionPatch[] = [];

  for (const move of order) {
    applyEffects(next, move, deltas);

    // Seeing something happen is what moves a belief, so the two are written
    // together and weighted the same.
    const remember = (observer: CharacterId) => {
      const importance = writeMemory(next, observer, move, nextTurn);
      patches.push(...beliefPatches(next, observer, move, importance));
    };

    const actorPresent = present.includes(move.actor);
    const targetPresent = move.target
      ? present.includes(move.target)
      : false;
    const witnessedByPlayer =
      present.includes(playerId) && (actorPresent || targetPresent);

    log.push({ move, witnessedByPlayer });

    if (witnessedByPlayer) {
      utterances.push({
        speaker: move.actor,
        moveId: move.id,
        line: stubDialogue(move.id, nameOf(next, move.target)),
      });
      for (const observer of present) {
        remember(observer);
      }
    } else {
      remember(move.actor);
      if (move.target) remember(move.target);

      events.push({
        id: `event-${nextTurn}-${move.actor}-${move.id}`,
        turn: nextTurn,
        type: "offscreen",
        actor: move.actor,
        target: move.target,
        description: move.target
          ? `${nameOf(next, move.actor)} ${verbFor(move.id)} ${nameOf(next, move.target)}.`
          : `${nameOf(next, move.actor)} ${verbFor(move.id)}.`,
        OnScene: [move.actor, ...(move.target ? [move.target] : [])],
      });
    }
  }

  // `Withdraw` is the departure half of the presence rule — it had an empty
  // effect list and its blurb promised "step back from the scene". Applied
  // after the loop so the exit is still witnessed by the player.
  //
  // The player never leaves: there is no second scene to walk to and no rule
  // that brings them back, so removing them stalls the game. `Withdraw` is off
  // `MENU_MOVE_IDS` for the same reason.
  for (const move of order) {
    if (move.id !== "Withdraw" || move.actor === playerId) continue;
    if (present.length <= 2) break; // never leave the player alone
    const at = present.indexOf(move.actor);
    if (at < 0) continue;

    present.splice(at, 1);
    events.push({
      id: `event-${nextTurn}-departure-${move.actor}`,
      turn: nextTurn,
      type: "departure",
      actor: move.actor,
      description: `${nameOf(next, move.actor)} steps away.`,
      OnScene: [...present],
    });
  }

  // Cognition last: mood reads the tick's finished deltas, and both go through
  // the patch pipeline rather than writing `next` directly, so the deterministic
  // pass and the LLM-driven one A has planned share exactly one write path.
  for (const patch of [...patches, ...moodPatches(deltas)]) {
    applyCognitionPatch(next, patch);
  }

  next.turn = nextTurn;
  next.clock = advanceClock(next.clock);

  return {
    state: next,
    utterances,
    events,
    log,
    deltas,
    pendingUtterances: [],
    eligibleActors: present.filter((id) => Boolean(next.characters[id]?.state)),
  };
}

function verbFor(moveId: MoveId): string {
  const verbs: Record<string, string> = {
    Greet: "greeted",
    Talk: "talked to",
    Ask: "asked",
    Confront: "confronted",
    GiveGift: "gave a gift to",
    SpreadRumor: "spread a rumor about",
    RevealSecret: "revealed a secret to",
    Defend: "defended",
    Insult: "insulted",
    Apologize: "apologized to",
    AskForHelp: "asked for help from",
    Hug: "hugged",
    Comfort: "comforted",
    Flirt: "flirted with",
    Mimic: "mimicked",
    Refuse: "refused",
    Argue: "argued with",
    Fight: "fought",
    Comply: "went along with",
    Withdraw: "stepped away",
    Wait: "waited",
    Propose: "proposed an alliance with",
  };
  return verbs[moveId] || `used ${moveId} on`;
}

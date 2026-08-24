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

import { MOCK_EFFECTS, stubDialogue } from "./moveMeta";
import { clamp } from "./format";

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

const TENDENCIES: Record<CharacterId, Tendency[]> = {
  bob: [
    { moveId: "Propose", target: "calum", weight: 3 },
    { moveId: "GiveGift", target: "calum", weight: 2 },
    { moveId: "Greet", target: "alice", weight: 1 },
  ],
  dana: [
    { moveId: "Confront", target: "bob", weight: 3 },
    { moveId: "Defend", target: "alice", weight: 2 },
    { moveId: "AskForHelp", target: "you", weight: 1 },
  ],
  alice: [
    { moveId: "AskForHelp", target: "dana", weight: 2 },
    { moveId: "Confront", target: "bob", weight: 2 },
  ],
  calum: [
    { moveId: "Greet", target: "dana", weight: 2 },
    { moveId: "AskForHelp", target: "alice", weight: 1 },
  ],
};

function pickTendency(
  actor: CharacterId,
  roll: number,
): Tendency | null {
  const list = TENDENCIES[actor];
  if (!list || list.length === 0) return null;

  const total = list.reduce((sum, t) => sum + t.weight, 0);
  let mark = roll * total;
  for (const t of list) {
    mark -= t.weight;
    if (mark <= 0) return t;
  }
  return list[0];
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
    const before = rel[field];
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

function nameOf(world: WorldState, id?: CharacterId): string {
  if (!id) return "";
  const character = world.characters[id];
  return character ? character.name : id;
}

function writeMemory(
  world: WorldState,
  observer: CharacterId,
  move: Move,
  turn: number,
): void {
  const character = world.characters[observer];
  if (!character) return;

  const actorName = nameOf(world, move.actor);
  const targetName = nameOf(world, move.target);
  const summary = targetName
    ? `${actorName} used ${move.id} on ${targetName}.`
    : `${actorName} used ${move.id}.`;

  character.memories.push({
    id: `mem-${observer}-${turn}-${move.id}`,
    turn,
    actor: move.actor,
    target: move.target,
    description: summary,
    tags: [move.id.toLowerCase()],
    importance: 0.4,
  });

  if (character.memories.length > 8) {
    character.memories = character.memories.slice(-8);
  }
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
  const candidates: Move[] = [playerMove];

  const npcIds = Object.keys(next.characters).filter(
    (id) => id !== playerId,
  );

  let autonomousCount = 0;
  for (const id of npcIds) {
    if (autonomousCount >= 2) break;
    if (rng() >= 0.5) continue;

    const choice = pickTendency(id, rng());
    if (!choice) continue;
    if (choice.target === id) continue;

    candidates.push({ id: choice.moveId, actor: id, target: choice.target });
    autonomousCount += 1;
  }

  const order = candidates
    .map((move, index) => ({ move, key: rng() + index * 0.001 }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.move);

  const deltas: RelationshipDelta[] = [];
  const utterances: Utterance[] = [];
  const events: SimEvent[] = [];
  const log: ResolvedMove[] = [];

  for (const move of order) {
    applyEffects(next, move, deltas);

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
        writeMemory(next, observer, move, nextTurn);
      }
    } else {
      writeMemory(next, move.actor, move, nextTurn);
      if (move.target) writeMemory(next, move.target, move, nextTurn);

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

  next.turn = nextTurn;
  next.clock = advanceClock(next.clock);

  return { state: next, utterances, events, log, deltas };
}

function verbFor(moveId: MoveId): string {
  const verbs: Record<string, string> = {
    Greet: "greeted",
    Confront: "confronted",
    GiveGift: "gave a gift to",
    SpreadRumor: "spread a rumor about",
    RevealSecret: "revealed a secret to",
    Defend: "defended",
    Insult: "insulted",
    Apologize: "apologized to",
    AskForHelp: "asked for help from",
    Refuse: "refused",
    Comply: "went along with",
    Withdraw: "stepped away",
    Propose: "proposed an alliance with",
  };
  return verbs[moveId] || `used ${moveId} on`;
}

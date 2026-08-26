import type { CharacterId, Memory, Move, RelationshipAxis } from "@ai/types";
import { MOCK_EFFECTS } from "@/lib/moveMeta";

/**
 * The five-term scorer from the work plan. Pure sort over the speaker's own
 * memories — no vector DB at this scale, and no reading anyone else's array.
 */

const DECAY = 0.08; // per turn
const TOP_N = 5;

/**
 * Track D owns the move -> primary axis map (ask #7). Until it lands, take the
 * largest-magnitude axis in the mock effect table.
 * ponytail: wrong on ties, fine for now — replace with D's map, not with a
 * tie-break heuristic.
 */
export function dominantAxis(moveId: string): RelationshipAxis | null {
  const effects = MOCK_EFFECTS[moveId] || [];
  let best: RelationshipAxis | null = null;
  let bestMag = 0;
  for (const e of effects) {
    const mag = Math.abs(e.amount);
    if (mag > bestMag) {
      bestMag = mag;
      best = e.field as RelationshipAxis;
    }
  }
  return best;
}

/**
 * Tags the move "is about": its own id, the axis it moves, and who it lands on.
 * ponytail: derived, because Track D's memory templates don't exist yet. When
 * they do, this becomes a lookup and the derivation goes away.
 */
function moveTags(move: Move): string[] {
  const axis = dominantAxis(move.id);
  return [move.id.toLowerCase(), axis, move.target].filter(Boolean) as string[];
}

export function tagRelevance(m: Memory, move: Move): number {
  const wanted = moveTags(move);
  if (wanted.length === 0) return 0;
  const hits = wanted.filter((t) => m.tags.includes(t)).length;
  return hits / wanted.length;
}

/**
 * importance * exp(-decay * age).
 * No floor: the floored-tag convention (betrayal, secret) is Track D's, ask #8.
 * ponytail: plain decay until then — a betrayal from turn 0 still outranks
 * small talk for a while, it just stops doing so eventually.
 */
export function effectiveImportance(m: Memory, turn: number): number {
  const age = Math.max(0, turn - m.turn);
  return m.importance * Math.exp(-DECAY * age);
}

export function participantMatch(
  m: Memory,
  speaker: CharacterId,
  listener?: CharacterId,
): number {
  const people = [m.actor, m.target].filter(Boolean) as CharacterId[];
  let score = 0;
  if (listener && people.includes(listener)) score += 0.7;
  if (people.includes(speaker)) score += 0.3;
  return score;
}

/** Does the memory bear on the same axis this move moves? */
export function axisRelevance(m: Memory, axis: RelationshipAxis | null): number {
  if (!axis) return 0;
  if (m.tags.includes(axis)) return 1;
  for (const tag of m.tags) {
    const moveId = Object.keys(MOCK_EFFECTS).find((id) => id.toLowerCase() === tag);
    if (moveId && dominantAxis(moveId) === axis) return 1;
  }
  return 0;
}

export function scoreMemory(
  m: Memory,
  move: Move,
  speaker: CharacterId,
  turn: number,
): number {
  return (
    0.3 * tagRelevance(m, move) +
    0.25 * effectiveImportance(m, turn) +
    0.2 * participantMatch(m, speaker, move.target) +
    0.15 * axisRelevance(m, dominantAxis(move.id)) +
    // `valence` doesn't exist on Memory yet (ask #5). The adapter defaults it
    // to 0, which drops this term out rather than blocking on it.
    0.1 * Math.abs(m.valence)
  );
}

/**
 * Top 5 memories for this speaker and move.
 *
 * Reads `memories` — the speaker's own array — and nothing else. Owner
 * filtering is free by construction here; the leak risk is one layer up in
 * prompt assembly, and `ai/prompts/realize.ts` is where it's guarded.
 */
export function retrieve(
  memories: Memory[],
  move: Move,
  speaker: CharacterId,
  turn: number,
  limit = TOP_N,
): Memory[] {
  return memories
    // The route realizes from `result.state`, whose turn is the tick just
    // written — so this drops exactly the memories this move produced and
    // nothing else. Without it the top result is always the move being
    // realized: it maxes `tagRelevance` and `axisRelevance` by construction,
    // is undecayed at age 0, and restates what `THE MOVE:` says two lines
    // lower. It also made every cache key unique per turn (B-17).
    .filter((m) => m.turn < turn)
    .map((m, i) => ({ m, i, score: scoreMemory(m, move, speaker, turn) }))
    // Ties break on recency, then array order, so retrieval stays deterministic.
    .sort((a, b) => b.score - a.score || b.m.turn - a.m.turn || a.i - b.i)
    .slice(0, limit)
    .map((entry) => entry.m);
}

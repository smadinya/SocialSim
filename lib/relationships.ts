import type {
  CharacterId,
  Relationship,
  RelationshipAxis,
  RelationshipStatus,
  WorldState,
} from "./viewTypes";

import { REL_FIELDS, clamp } from "./format";

/**
 * Status is derived, never stored: two sources of truth for "are they friends"
 * is exactly the bug where the inspector and the dialogue disagree.
 *
 * Order matters — the first match wins, so the ruinous states are tested
 * before the pleasant ones. Someone can be both trusted and feared; the fear
 * is the thing worth telling the player about.
 */
/**
 * Leaving a status costs more than entering it.
 *
 * Without this, decay flapped statuses within a few turns of every gain:
 * a favour pushed trust 52 -> 58 ("friend"), decay pulled it back toward its
 * baseline, and the feed announced Robin befriending and un-befriending Dana
 * inside three turns. Baselines only drift overnight, so any same-day gain
 * reverts by construction — the fix belongs at the boundary, not in decay.
 */
export const STATUS_MARGIN = 5;

export function statusFor(
  rel: Relationship,
  previous?: RelationshipStatus,
): RelationshipStatus {
  const m = (status: RelationshipStatus) =>
    previous === status ? STATUS_MARGIN : 0;

  if (rel.anger >= 60 - m("hostile")) return "hostile";
  if (
    rel.flags.includes("betrayed") ||
    (rel.trust < 25 + m("estranged") && rel.anger >= 40 - m("estranged"))
  ) {
    return "estranged";
  }
  if (rel.respect >= 50 - m("rival") && rel.affection < 35 + m("rival")) {
    return "rival";
  }
  if (rel.trust < 40 + m("wary") || rel.fear >= 40 - m("wary")) return "wary";
  if (rel.trust >= 70 - m("close") && rel.affection >= 70 - m("close")) {
    return "close";
  }
  if (
    rel.flags.includes("allied") ||
    (rel.trust >= 60 - m("ally") && rel.respect >= 60 - m("ally"))
  ) {
    return "ally";
  }
  if (rel.trust >= 55 - m("friend") && rel.affection >= 50 - m("friend")) {
    return "friend";
  }
  return "neutral";
}

/**
 * The status as last recorded, so every reader agrees with the ledger. The
 * last history entry IS the last status this pair was announced as, which is
 * what hysteresis has to be measured against.
 */
export function currentStatus(rel: Relationship): RelationshipStatus {
  return statusFor(rel, rel.history[rel.history.length - 1]?.now);
}

export const STATUS_BLURB: Record<RelationshipStatus, string> = {
  close: "counts them close",
  friend: "counts them a friend",
  ally: "is working with them",
  neutral: "has no strong read on them",
  wary: "is wary of them",
  rival: "treats them as a rival",
  estranged: "is done with them",
  hostile: "is furious with them",
};

/** Decay rates, as a fraction of the gap to baseline, per turn. */
export const DECAY_RATES: Record<RelationshipAxis, number> = {
  fear: 0.12,
  anger: 0.15,
  affection: 0.04,
  respect: 0.03,
  trust: 0.02,
};

/** A night is worth this many turns of decay. Sleeping on it. */
export const NIGHT_DECAY_MULTIPLIER = 3;

/**
 * Pull every axis toward its baseline.
 *
 * Nothing in the game could lower `fear` before this existed — `Confront` was
 * +8 and no move in the effect table carried a negative fear term, so over
 * about fifteen turns everyone ended up terrified of everyone and
 * `relationshipTone` pinned the whole cast to `cold`.
 */
export function decayRelationship(rel: Relationship, multiplier = 1): void {
  for (const axis of REL_FIELDS) {
    const gap = rel.baseline[axis] - rel[axis];
    if (gap === 0) continue;
    const step = gap * DECAY_RATES[axis] * multiplier;
    // Always close by at least a point, or a gap of 3 on trust never closes:
    // 3 * 0.02 rounds to 0 and the axis sits there forever.
    const moved = Math.abs(step) < 1 ? Math.sign(gap) : step;
    const next = clamp(rel[axis] + moved);
    rel[axis] = Math.abs(next - rel.baseline[axis]) < 1 ? rel.baseline[axis] : next;
  }
}

/**
 * Baselines drift toward where the relationship actually is.
 *
 * Without this, decay is amnesia: a betrayal heals back to par overnight
 * because par never moved. Run once per night, not per turn.
 */
export const BASELINE_DRIFT = 0.1;

export function driftBaseline(rel: Relationship): void {
  for (const axis of REL_FIELDS) {
    const gap = rel[axis] - rel.baseline[axis];
    if (gap === 0) continue;
    rel.baseline[axis] = clamp(rel.baseline[axis] + gap * BASELINE_DRIFT);
  }
}

export const MAX_HISTORY = 6;

export interface StatusChange {
  from: CharacterId;
  to: CharacterId;
  was: RelationshipStatus;
  now: RelationshipStatus;
}

/**
 * Compare a snapshot of every directed pair's status against the world now,
 * append the crossings to `history`, and hand back what changed so the caller
 * can write memories and feed lines for them.
 */
export function snapshotStatuses(
  world: WorldState,
): Map<string, RelationshipStatus> {
  const out = new Map<string, RelationshipStatus>();
  for (const from of Object.keys(world.characters)) {
    const rels = world.characters[from].relationships;
    for (const to of Object.keys(rels)) {
      out.set(`${from}>${to}`, currentStatus(rels[to]));
    }
  }
  return out;
}

export function recordStatusChanges(
  world: WorldState,
  before: Map<string, RelationshipStatus>,
  turn: number,
  because?: string,
): StatusChange[] {
  const changes: StatusChange[] = [];

  for (const from of Object.keys(world.characters)) {
    const rels = world.characters[from].relationships;
    for (const to of Object.keys(rels)) {
      const was = before.get(`${from}>${to}`);
      const now = statusFor(rels[to], was);
      if (!was || was === now) continue;

      const rel = rels[to];
      rel.history.push({ turn, was, now, because });
      if (rel.history.length > MAX_HISTORY) {
        rel.history.splice(0, rel.history.length - MAX_HISTORY);
      }
      changes.push({ from, to, was, now });
    }
  }

  return changes;
}

export function setFlag(rel: Relationship, flag: string): void {
  if (!rel.flags.includes(flag)) rel.flags.push(flag);
}

export function clearFlag(rel: Relationship, flag: string): void {
  const at = rel.flags.indexOf(flag);
  if (at >= 0) rel.flags.splice(at, 1);
}

/** A fresh relationship whose baseline is where it starts. */
export function makeRelationship(
  axes: Partial<Record<RelationshipAxis, number>> = {},
): Relationship {
  const values = {} as Record<RelationshipAxis, number>;
  for (const axis of REL_FIELDS) values[axis] = axes[axis] ?? 0;
  return {
    ...values,
    baseline: { ...values },
    lastDelta: {},
    flags: [],
    history: [],
  };
}

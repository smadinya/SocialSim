import type { Relationship, RelationshipField } from "./viewTypes";

export const REL_FIELDS: RelationshipField[] = [
  "trust",
  "affection",
  "respect",
  "fear",
  "anger",
];

export function clamp(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

/**
 * Four coarse bands, used for the realization cache key and nothing else.
 *
 * Thresholds dropped from 75/45/20 in update 1: with a decay pass now pulling
 * values toward their baselines they cluster nearer the middle, and the old
 * bands left `none` almost empty.
 */
export function bucket(value: number): string {
  if (value >= 70) return "high";
  if (value >= 40) return "mid";
  if (value >= 15) return "low";
  return "none";
}

/**
 * The one bucketing scheme in this repo. It picks NPC replies
 * (`respondTo`) and it picks every fallback line (`ai/fallbacks.ts`), so it
 * decides both what characters do and how they sound.
 *
 * The old formula was `(trust + affection + respect) - fear * 3`, which
 * triple-weighted the single axis nothing in the game could lower. Every
 * relationship slid to `cold` and stayed there. Anger now carries the
 * hostility weight (it is the axis that spikes and fades), fear is weighted
 * once, and decay means both come back down.
 */
// Calibrated against the cast, not picked round: warmth runs 0..300, a real
// friendship sits near 200 and a nodding acquaintance near 145. At 110 the
// acquaintance read as `warm` and every fallback line was written for someone
// they barely know.
export const TONE_WARM_AT = 165;
export const TONE_COLD_AT = 60;
/** Cross a boundary by this much or keep the tone you had. */
export const TONE_HYSTERESIS = 8;

export type ToneBucket = "cold" | "neutral" | "warm";

export function toneScore(rel: Relationship): number {
  const warmth = rel.trust + rel.affection + rel.respect;
  const threat = rel.fear + rel.anger * 1.5;
  return warmth - threat;
}

/**
 * `previous` is the tone this pair last read as. Passing it applies hysteresis
 * so a relationship parked on a boundary doesn't alternate warm/cold every
 * turn — which read as a character changing their mind at random.
 */
export function relationshipTone(
  rel: Relationship,
  previous?: ToneBucket,
): ToneBucket {
  const score = toneScore(rel);
  const warmAt =
    previous === "warm" ? TONE_WARM_AT - TONE_HYSTERESIS : TONE_WARM_AT;
  const coldAt =
    previous === "cold" ? TONE_COLD_AT + TONE_HYSTERESIS : TONE_COLD_AT;

  if (score >= warmAt) return "warm";
  if (score <= coldAt) return "cold";
  return "neutral";
}

import type { Relationship, RelationshipField } from "./viewTypes";

export const REL_FIELDS: RelationshipField[] = [
  "trust",
  "affection",
  "respect",
  "fear",
];

export function clamp(n: number): number {
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

export function bucket(value: number): string {
  if (value >= 75) return "high";
  if (value >= 45) return "mid";
  if (value >= 20) return "low";
  return "none";
}

export function relationshipTone(rel: Relationship): string {
  const positive = rel.trust + rel.affection + rel.respect;
  const negative = rel.fear * 3;
  if (positive - negative >= 150) return "warm";
  if (positive - negative <= 40) return "cold";
  return "neutral";
}

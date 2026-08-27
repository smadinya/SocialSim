import type { Relationship, RelationshipField } from "./viewTypes";
import { RELATIONSHIP_AXES } from "@sim/types";
import { relationshipValue } from "@sim/relationships";

export const REL_FIELDS: RelationshipField[] = [...RELATIONSHIP_AXES];

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
  const positive =
    relationshipValue(rel, "trust") +
    relationshipValue(rel, "gratitude") +
    relationshipValue(rel, "affection") +
    relationshipValue(rel, "respect");
  const negative =
    relationshipValue(rel, "fear") * 3 +
    relationshipValue(rel, "anger") +
    relationshipValue(rel, "jealousy") +
    relationshipValue(rel, "hate");
  if (positive - negative >= 150) return "warm";
  if (positive - negative <= 40) return "cold";
  return "neutral";
}

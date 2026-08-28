import {
  RELATIONSHIP_AXES,
  type RelationshipAxis,
  type RelationshipState,
  type RelationshipValues,
  type RelationshipHistoryEntry,
} from "./types";

export function relationshipValue(
  relationship: RelationshipState | undefined,
  axis: RelationshipAxis,
): number {
  return relationship?.[axis] ?? 0;
}

/** Converts legacy four-axis data to the complete eight-axis value record. */
export function relationshipValues(
  relationship?: RelationshipState,
): RelationshipValues {
  return Object.fromEntries(
    RELATIONSHIP_AXES.map((axis) => [axis, relationshipValue(relationship, axis)]),
  ) as RelationshipValues;
}

export function relationshipLabels(
  relationship?: RelationshipState,
): string[] {
  const r = relationshipValues(relationship);
  const labels: string[] = [];
  if (r.trust >= 65 && r.affection >= 60) labels.push("friend");
  if (r.trust >= 70 && r.respect >= 60) labels.push("ally");
  if (r.affection >= 70 && r.trust >= 55) labels.push("close");
  if (r.fear >= 60) labels.push("afraid");
  if (r.anger >= 60 || r.hate >= 55) labels.push("rival");
  if (r.jealousy >= 60) labels.push("jealous");
  if (!labels.length) labels.push("acquaintance");
  return labels;
}

export function previousRelationshipLabels(
  relationship?: RelationshipState,
): string[] {
  const last = relationship?.history?.at(-1);
  if (!last) return relationshipLabels(relationship);
  return relationship?.history?.find((entry) => entry.eventId === last.eventId)
    ?.labelsBefore ?? last.labelsBefore;
}

export function normalizeRelationship(
  relationship?: RelationshipState,
): RelationshipState {
  const values = relationshipValues(relationship);
  return {
    ...values,
    baseline: relationship?.baseline
      ? { ...values, ...relationship.baseline }
      : { ...values },
    lastDelta: { ...(relationship?.lastDelta ?? {}) },
    flags: [...(relationship?.flags ?? [])],
    history: [...(relationship?.history ?? [])],
  };
}

export function recordRelationshipChange(
  relationship: RelationshipState,
  entry: Omit<RelationshipHistoryEntry, "labelsBefore" | "labelsAfter">,
): void {
  const labelsAfter = relationshipLabels(relationship);
  const snapshot = { ...relationship, [entry.field]: entry.before };
  const labelsBefore = relationshipLabels(snapshot);
  const sameEvent = relationship.history?.at(-1)?.eventId === entry.eventId;
  relationship.lastDelta = sameEvent
    ? { ...(relationship.lastDelta ?? {}), [entry.field]: entry.after - entry.before }
    : { [entry.field]: entry.after - entry.before };
  relationship.history = [
    ...(relationship.history ?? []),
    { ...entry, labelsBefore, labelsAfter },
  ].slice(-40);

  const flags = new Set(relationship.flags ?? []);
  if (labelsBefore.includes("friend") && !labelsAfter.includes("friend")) {
    flags.add("former-friend");
  }
  if (labelsAfter.includes("ally")) flags.add("allied");
  if (labelsAfter.includes("rival")) flags.add("hostile");
  else flags.delete("hostile");
  relationship.flags = [...flags].sort();
}

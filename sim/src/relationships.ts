import {
  RELATIONSHIP_AXES,
  type RelationshipAxis,
  type RelationshipState,
  type RelationshipValues,
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

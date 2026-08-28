import { describe, expect, it } from "vitest";

import { relationshipValue, relationshipValues } from "./relationships";
import { RELATIONSHIP_AXES, type RelationshipState } from "./types";

describe("relationship normalization", () => {
  it("defaults new axes in legacy four-axis relationships to zero", () => {
    const legacy: RelationshipState = {
      trust: 50,
      affection: 40,
      respect: 30,
      fear: 20,
    };

    expect(relationshipValues(legacy)).toEqual({
      trust: 50,
      gratitude: 0,
      affection: 40,
      respect: 30,
      fear: 20,
      anger: 0,
      jealousy: 0,
      hate: 0,
    });
  });

  it("preserves every expanded relationship axis", () => {
    const expanded = Object.fromEntries(
      RELATIONSHIP_AXES.map((axis, index) => [axis, index + 1]),
    ) as unknown as RelationshipState;

    for (const axis of RELATIONSHIP_AXES) {
      expect(relationshipValue(expanded, axis)).toBe(expanded[axis]);
    }
  });
});

import { describe, expect, it } from "vitest";

import { MOVE_IDS } from "@sim/moves/catalog";
import { RELATIONSHIP_AXES } from "@sim/types";
import { MOCK_EFFECTS, MOVE_META } from "./moveMeta";

describe("expanded social actions", () => {
  it("gives every catalog action metadata and an effect entry", () => {
    for (const id of MOVE_IDS) {
      expect(MOVE_META[id], `${id} metadata`).toBeDefined();
      expect(MOCK_EFFECTS[id], `${id} effects`).toBeDefined();
    }
  });

  it("only changes authoritative relationship axes", () => {
    for (const effects of Object.values(MOCK_EFFECTS)) {
      for (const effect of effects) {
        expect(RELATIONSHIP_AXES).toContain(effect.field);
      }
    }
  });

  it("uses each newly added axis in at least one action", () => {
    const affected = new Set(
      Object.values(MOCK_EFFECTS).flat().map((effect) => effect.field),
    );

    for (const axis of ["gratitude", "anger", "jealousy", "hate"] as const) {
      expect(affected).toContain(axis);
    }
  });
});

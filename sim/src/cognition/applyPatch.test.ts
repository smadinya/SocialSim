import { describe, expect, it } from "vitest";
import type { WorldState } from "../types";
import { applyCognitionPatch } from "./applyPatch";
import fixture from "@/fixtures/world.json";

const seed = () => structuredClone(fixture) as unknown as WorldState;

describe("cognition patches", () => {
  it("sets, increments and clamps a relationship axis", () => {
    const world = seed();
    applyCognitionPatch(world, {
      op: "increment",
      path: "/characters/alice/relationships/bob/trust",
      value: -5,
    });
    expect(world.characters.alice.relationships.bob.trust).toBe(13);

    applyCognitionPatch(world, {
      op: "increment",
      path: "/characters/alice/relationships/bob/trust",
      value: -500,
    });
    expect(world.characters.alice.relationships.bob.trust).toBe(0);
  });

  it("merges one belief out of the list by id", () => {
    const world = seed();
    const belief = world.characters.you.beliefs[0];
    const result = applyCognitionPatch(world, {
      op: "merge",
      path: "/characters/you/beliefs",
      value: { id: belief.id, confidence: 0.8 },
    });
    expect(result.applied).toBe(true);
    expect(world.characters.you.beliefs[0].confidence).toBe(0.8);
    expect(world.characters.you.beliefs[0].description).toBe(belief.description);
  });

  it("appends and removes", () => {
    const world = seed();
    applyCognitionPatch(world, {
      op: "append",
      path: "/characters/you/goals",
      value: "Find Calum",
    });
    expect(world.characters.you.goals).toContain("Find Calum");

    applyCognitionPatch(world, {
      op: "remove",
      path: "/characters/you/goals",
      value: "Find Calum",
    });
    expect(world.characters.you.goals).not.toContain("Find Calum");
  });

  it("refuses a path that isn't there, and leaves the world alone", () => {
    const world = seed();
    const before = JSON.stringify(world);
    for (const patch of [
      { op: "set", path: "/characters/nobody/state/mood", value: "smug" },
      { op: "increment", path: "/characters/alice/state/mood", value: 1 },
      { op: "append", path: "/characters/alice/state/mood", value: "x" },
      { op: "merge", path: "/characters/you/beliefs", value: { confidence: 1 } },
      { op: "remove", path: "/characters/you/goals", value: "never set" },
    ] as const) {
      const result = applyCognitionPatch(world, patch);
      expect(result.applied, `${patch.op} ${patch.path}`).toBe(false);
      expect(result.error).toBeTruthy();
    }
    expect(JSON.stringify(world)).toBe(before);
  });
});

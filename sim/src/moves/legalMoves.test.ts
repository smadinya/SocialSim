import { describe, expect, it } from "vitest";

import type { WorldState } from "../types";
import { MOVE_IDS, TARGETLESS_MOVE_IDS } from "./catalog";
import { getLegalMoves, isLegalMove } from "./legalMoves";

function world(): WorldState {
  const relationship = {
    trust: 50,
    gratitude: 0,
    affection: 50,
    respect: 50,
    fear: 0,
    anger: 0,
    jealousy: 0,
    hate: 0,
  };

  return {
    turn: 0,
    clock: "Day 1 - 09:00",
    rngSeed: 1,
    scene: { location: "courtyard", presentCharacters: ["alice", "bob"] },
    characters: {
      alice: {
        id: "alice",
        name: "Alice",
        traits: [],
        state: { mood: "neutral", emotions: {} },
        relationships: { bob: { ...relationship } },
        memories: [],
        beliefs: [],
        goals: [],
      },
      bob: {
        id: "bob",
        name: "Bob",
        traits: [],
        state: { mood: "neutral", emotions: {} },
        relationships: { alice: { ...relationship } },
        memories: [],
        beliefs: [],
        goals: [],
      },
    },
  };
}

describe("move legality", () => {
  it("turns every targeted catalog action into a candidate per other character", () => {
    const legal = getLegalMoves("alice", world());
    const targetedIds = MOVE_IDS.filter(
      (id) => !(TARGETLESS_MOVE_IDS as readonly string[]).includes(id),
    );

    expect(legal.filter((move) => move.target === "bob").map((move) => move.id))
      .toEqual(targetedIds);
  });

  it("includes targetless actions without inventing a target", () => {
    const legal = getLegalMoves("alice", world());

    for (const id of TARGETLESS_MOVE_IDS) {
      expect(legal).toContainEqual({ id, actor: "alice" });
    }
  });

  it("rejects unknown, self-targeted, and incorrectly targeted actions", () => {
    const state = world();

    expect(isLegalMove({ id: "Dance", actor: "alice", target: "bob" }, state))
      .toBe(false);
    expect(isLegalMove({ id: "Talk", actor: "alice" }, state)).toBe(false);
    expect(isLegalMove({ id: "Talk", actor: "alice", target: "alice" }, state))
      .toBe(false);
    expect(isLegalMove({ id: "Wait", actor: "alice", target: "bob" }, state))
      .toBe(false);
  });
});

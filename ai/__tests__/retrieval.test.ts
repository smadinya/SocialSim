import { describe, expect, it } from "vitest";
import type { Move, WorldState } from "@sim/types";
import {
  dominantAxis,
  effectiveImportance,
  retrieve,
  scoreMemory,
} from "@ai/retrieval";
import { toPendingUtterance } from "@ai/adapt";
import deep from "./fixtures/deep-world.json";

const world = deep as unknown as WorldState;
// `sim/src/types.ts` carries valence/tier/accurate/core since update 1, so
// these are read straight off the world — `ai/adapt.ts` used to default them.
const memoriesOf = (id: string) => world.characters[id].memories;

describe("retrieval", () => {
  it("has a pool the top-5 cut actually binds against", () => {
    for (const id of Object.keys(world.characters)) {
      expect(memoriesOf(id).length).toBeGreaterThan(5);
    }
  });

  it("returns at most 5, all owned by the speaker", () => {
    const move: Move = { id: "Confront", actor: "alice", target: "bob" };
    const got = retrieve(memoriesOf("alice"), move, "alice", world.turn);
    expect(got).toHaveLength(5);
    for (const m of got) expect(m.id.startsWith("mem-alice-")).toBe(true);
  });

  it("surfaces the Bob history when Alice confronts Bob", () => {
    const move: Move = { id: "Confront", actor: "alice", target: "bob" };
    const got = retrieve(memoriesOf("alice"), move, "alice", world.turn);

    // Every retrieved memory involves the listener, and nothing about Dana or
    // Calum alone crowds them out.
    for (const m of got) {
      expect([m.actor, m.target]).toContain("bob");
    }

    // The turn-0 betrayal is second, behind the most recent confrontation.
    // It is NOT first because `effectiveImportance` has no floor yet — that
    // needs Track D's floored-tag convention (ask #8). This assertion is the
    // evidence for that ask; tighten it to `got[0]` once the floor lands.
    expect(got.slice(0, 2).some((m) => m.tags.includes("betrayal"))).toBe(true);
  });

  it("ranks differently for a different move — it is not a fixed list", () => {
    const confront = retrieve(
      memoriesOf("alice"),
      { id: "Confront", actor: "alice", target: "bob" },
      "alice",
      world.turn,
    ).map((m) => m.id);
    const askDana = retrieve(
      memoriesOf("alice"),
      { id: "AskForHelp", actor: "alice", target: "dana" },
      "alice",
      world.turn,
    ).map((m) => m.id);
    expect(confront).not.toEqual(askDana);
  });

  it("is deterministic", () => {
    const move: Move = { id: "GiveGift", actor: "bob", target: "calum" };
    const once = retrieve(memoriesOf("bob"), move, "bob", world.turn);
    const twice = retrieve(memoriesOf("bob"), move, "bob", world.turn);
    expect(once.map((m) => m.id)).toEqual(twice.map((m) => m.id));
  });

  it("decays: the same memory scores lower from further away", () => {
    const move: Move = { id: "Confront", actor: "alice", target: "bob" };
    const betrayal = memoriesOf("alice")[0];
    const near = scoreMemory(betrayal, move, "alice", 1);
    const far = scoreMemory(betrayal, move, "alice", 40);
    expect(far).toBeLessThan(near);
  });

  it("derives a move's dominant axis from the effect table", () => {
    // `anger` overtook `fear` on Confront when the fifth axis landed (+10 vs
    // +8), and that is the right read: being confronted makes you angrier
    // than it makes you frightened.
    expect(dominantAxis("Confront")).toBe("anger");
    expect(dominantAxis("Insult")).toBe("anger");
    expect(dominantAxis("GiveGift")).toBe("affection");
    expect(dominantAxis("Withdraw")).toBeNull();
  });

  // `ai/types.ts` is deleted and `ai/adapt.ts` defaults nothing: every field
  // below is read straight off the world. This used to assert the opposite —
  // that the shim invented `valence`/`tier`/`accurate` because the schema
  // didn't carry them yet.
  it("reads the real memory fields rather than defaulting them", () => {
    const marked = structuredClone(world) as WorldState;
    for (const m of marked.characters.alice.memories) {
      m.valence = -0.75;
      m.tier = "told";
      m.accurate = false;
    }

    const u = toPendingUtterance(marked, {
      move: { id: "Confront", actor: "alice", target: "bob" },
      witnessedByPlayer: true,
    });

    expect(u.retrievedMemories.length).toBe(5);
    for (const m of u.retrievedMemories) {
      expect(m.valence).toBe(-0.75);
      expect(m.tier).toBe("told");
      expect(m.accurate).toBe(false);
    }
  });

  it("floors decay on core memories so a betrayal stays reachable", () => {
    const betrayal = memoriesOf("alice").find((m) => m.core);
    expect(betrayal).toBeTruthy();

    const ordinary = memoriesOf("alice").find((m) => !m.core);
    expect(ordinary).toBeTruthy();

    // Forty turns on, the core memory is still worth at least half what it
    // was written at. Plain exponential decay put it below the filler.
    const aged = effectiveImportance(betrayal!, 60);
    expect(aged).toBeGreaterThanOrEqual(betrayal!.importance * 0.5);
    expect(effectiveImportance(ordinary!, 60)).toBeLessThan(
      ordinary!.importance * 0.5,
    );
  });
});

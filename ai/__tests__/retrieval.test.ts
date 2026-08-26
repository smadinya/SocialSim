import { describe, expect, it } from "vitest";
import type { Move, WorldState } from "@ai/types";
import { dominantAxis, retrieve, scoreMemory } from "@ai/retrieval";
import { toMemory, toPendingUtterance } from "@ai/adapt";
import deep from "./fixtures/deep-world.json";

const world = deep as unknown as WorldState;
const memoriesOf = (id: string) => world.characters[id].memories.map(toMemory);

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
    expect(dominantAxis("Confront")).toBe("fear");
    expect(dominantAxis("GiveGift")).toBe("affection");
    expect(dominantAxis("Withdraw")).toBeNull();
  });

  // The test everybody quotes. It guards the half the data layout already
  // makes true — see prompts.test.ts for the one that would actually catch me.
  it("Calum-absent: Calum never retrieves the betrayal he missed", () => {
    for (const target of ["bob", "alice", "dana", "you"]) {
      for (const id of ["Confront", "Greet", "SpreadRumor", "AskForHelp"]) {
        const got = retrieve(
          memoriesOf("calum"),
          { id, actor: "calum", target },
          "calum",
          world.turn,
        );
        for (const m of got) {
          expect(m.tags).not.toContain("betrayal");
          expect(m.description.toLowerCase()).not.toMatch(/leak|betray/);
        }
      }
    }
  });

  it("the adapter defaults the fields G0 hasn't landed yet", () => {
    const bare = structuredClone(world);
    for (const c of Object.values(bare.characters)) {
      c.memories = c.memories.map((m) => {
        const copy = { ...m } as Record<string, unknown>;
        delete copy.valence;
        delete copy.tier;
        delete copy.accurate;
        return copy as (typeof c.memories)[number];
      });
    }
    const u = toPendingUtterance(bare, {
      move: { id: "Confront", actor: "alice", target: "bob" },
      witnessedByPlayer: true,
    });
    expect(u.retrievedMemories.length).toBe(5);
    for (const m of u.retrievedMemories) {
      expect(m.valence).toBe(0);
      expect(m.tier).toBe("direct");
      expect(m.accurate).toBe(true);
    }
  });
});

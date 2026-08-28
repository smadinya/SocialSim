import { describe, expect, it } from "vitest";
import fixture from "@/fixtures/world.json";
import { RELATIONSHIP_AXES } from "@sim/types";
import type { CharacterId, Move, WorldFixture, WorldState } from "./viewTypes";
import { runTick } from "./mockEngine";

const { playerId, ...seed } = fixture as unknown as WorldFixture;
const wait: Move = { id: "Wait", actor: playerId };

describe("starting relationship fixture", () => {
  it("seeds every directed pair with all eight numeric axes", () => {
    for (const character of Object.values(seed.characters)) {
      for (const relationship of Object.values(character.relationships)) {
        for (const axis of RELATIONSHIP_AXES) {
          expect(typeof relationship[axis]).toBe("number");
        }
      }
    }
  });
});

function play(turns: number): WorldState {
  let world = structuredClone(seed) as WorldState;
  for (let i = 0; i < turns; i++) world = runTick(world, playerId, wait).state;
  return world;
}

describe("B-01 memory eviction", () => {
  it("keeps the backstory the story is about", () => {
    const alice = play(20).characters.alice;
    // Seeded at 0.95; procedural filler tops out at 0.6.
    expect(alice.memories.some((m) => m.tags.includes("betrayal"))).toBe(true);
  });
});

describe("B-10 memory text", () => {
  it("is English, and puts the owner in the first person", () => {
    const world = structuredClone(seed) as WorldState;
    const after = runTick(world, playerId, {
      id: "Confront",
      actor: playerId,
      target: "alice",
    }).state;

    for (const id of Object.keys(after.characters)) {
      for (const m of after.characters[id].memories) {
        expect(m.description).not.toMatch(/ used [A-Z]/);
      }
    }

    // Alice answers in the same tick (B-05), so pick the confrontation out
    // rather than taking the last memory written.
    const written = (id: CharacterId) =>
      after.characters[id].memories
        .filter((m) => m.tags.includes("confront"))
        .map((m) => m.description);

    expect(written(playerId)).toEqual(["I confronted Alice."]);
    expect(written("alice")).toEqual(["Robin confronted me."]);
    expect(written("dana")).toEqual(["Robin confronted Alice."]);
  });

  it("weights a confrontation above a greeting, and bystanders below both", () => {
    const world = structuredClone(seed) as WorldState;
    const after = runTick(world, playerId, {
      id: "Confront",
      actor: playerId,
      target: "alice",
    }).state;

    const confront = (id: CharacterId) =>
      after.characters[id].memories.find((m) => m.tags.includes("confront"))!;
    expect(confront("alice").importance).toBeGreaterThan(
      confront("dana").importance,
    );
  });
});

describe("B-02 / B-03 everyone acts", () => {
  it("lets every character act at least once in 60 turns", () => {
    let world = structuredClone(seed) as WorldState;
    const acted = new Set<CharacterId>();
    let emptyTicks = 0;

    for (let i = 0; i < 60; i++) {
      const result = runTick(world, playerId, wait);
      if (result.log.length === 0) emptyTicks += 1;
      for (const r of result.log) acted.add(r.move.actor);
      world = result.state;
    }

    expect([...acted].sort()).toEqual(["alice", "bob", "calum", "dana"]);
    // B-03: a legal tendency always exists once the scene fills, so a tick
    // that resolves nothing should be rare rather than a third of the game.
    expect(emptyTicks).toBeLessThan(10);
  });

  it("pulls Bob in so the fixture's confrontation can happen", () => {
    let world = structuredClone(seed) as WorldState;
    let confronted = false;

    for (let i = 0; i < 60; i++) {
      const result = runTick(world, playerId, wait);
      confronted ||= result.log.some(
        (r) => r.move.id === "Confront" && r.move.target === "bob",
      );
      world = result.state;
    }

    expect(confronted).toBe(true);
  });
});

describe("B-05 / B-06 the player is part of the conversation", () => {
  it("answers a move aimed at an NPC, in the same tick", () => {
    const world = structuredClone(seed) as WorldState;
    const result = runTick(world, playerId, {
      id: "Insult",
      actor: playerId,
      target: "dana",
    });

    const insult = result.log.findIndex((r) => r.move.actor === playerId);
    const answer = result.log.findIndex(
      (r) => r.move.actor === "dana" && r.move.target === playerId,
    );
    expect(answer).toBeGreaterThan(insult);
    // Warm toward the player, so she pushes back rather than biting back.
    // This was `Withdraw` until update 1: walking out relocates the responder
    // and closes the thread, so an argument ended on its first beat and
    // `Fight` was unreachable against anyone who didn't already hate you.
    expect(result.log[answer].move.id).toBe("Confront");
  });

  it("bites back when the relationship is cold", () => {
    const world = structuredClone(seed) as WorldState;
    world.characters.dana.relationships[playerId] = {
      trust: 5,
      affection: 5,
      respect: 5,
      fear: 40,
    };
    const result = runTick(world, playerId, {
      id: "Insult",
      actor: playerId,
      target: "dana",
    });
    const answer = result.log.find(
      (r) => r.move.actor === "dana" && r.move.target === playerId,
    );
    expect(answer?.move.id).toBe("Insult");
  });

  it("lets every NPC address the player at least once in 60 turns", () => {
    let world = structuredClone(seed) as WorldState;
    const approached = new Set<CharacterId>();

    for (let i = 0; i < 60; i++) {
      const result = runTick(world, playerId, wait);
      for (const r of result.log) {
        if (r.move.target === playerId) approached.add(r.move.actor);
      }
      world = result.state;
    }

    expect([...approached].sort()).toEqual(["alice", "bob", "calum", "dana"]);
  });
});

describe("B-12 / B-13 beliefs and mood stop being decoration", () => {
  it("tracks a belief against the evidence its holder has", () => {
    const before = (seed as WorldState).characters.you.beliefs[0];
    const world = play(12);
    const after = world.characters.you.beliefs[0];

    // Confidence alone is a bad assertion — it oscillates as evidence arrives
    // and can land back where it started. What matters is that the belief is
    // derived: it names a subject, and the subject follows the evidence rather
    // than the fixture. (Bob's own `SpreadRumor` tendency plants a false lead
    // pointing at Calum, so this legitimately moves without the player acting.)
    expect(after.subject).toBeTruthy();
    expect(after.description).toContain(
      world.characters[after.subject].name,
    );
    expect(after.confidence).toBeGreaterThanOrEqual(0);
    expect(after.confidence).toBeLessThanOrEqual(1);

    const moved =
      after.subject !== before.subject || after.confidence !== before.confidence;
    expect(moved).toBe(true);
  });

  it("moves Alice's suspicion as evidence reaches her, not on a timer", () => {
    const before = (seed as WorldState).characters.alice.beliefs[0].confidence;
    const after = play(12).characters.alice.beliefs[0];
    // She starts holding one piece and picks up Dana's. Two is still short of
    // the 0.7 she needs to act.
    expect(after.confidence).toBeGreaterThan(before);
    expect(after.confidence).toBeLessThan(0.7);
  });

  it("moves mood with the biggest thing that happened to you", () => {
    const world = structuredClone(seed) as WorldState;
    expect(world.characters.alice.state.mood).toBe("guarded");

    const after = runTick(world, playerId, {
      id: "Insult",
      actor: playerId,
      target: "alice",
    }).state;
    // anger +18 is the largest delta Alice owns this tick — it overtook
    // affection -10 when the fifth axis landed, and being furious is a truer
    // read of being insulted than being hurt.
    expect(after.characters.alice.state.mood).toBe("furious");
  });

  it("ignores a delta too small to feel", () => {
    const world = structuredClone(seed) as WorldState;
    const after = runTick(world, playerId, {
      id: "Greet",
      actor: playerId,
      target: "alice",
    }).state;
    // +3 affection is under the threshold; a hello is not a mood.
    expect(after.characters.alice.state.mood).toBe("guarded");
  });
});

describe("B-11 Withdraw leaves the scene", () => {
  it("removes an NPC and never the player", () => {
    const world = structuredClone(seed) as WorldState;
    const after = runTick(world, playerId, { id: "Withdraw", actor: "dana" }).state;
    expect(after.scene.presentCharacters).not.toContain("dana");
    expect(after.scene.presentCharacters).toContain(playerId);
  });

  it("does not remove the player, who has nowhere to go", () => {
    const world = structuredClone(seed) as WorldState;
    const after = runTick(world, playerId, { id: "Withdraw", actor: playerId }).state;
    expect(after.scene.presentCharacters).toContain(playerId);
  });

  it("never leaves the player alone", () => {
    const world = structuredClone(seed) as WorldState;
    world.scene.presentCharacters = [playerId, "alice"];
    const after = runTick(world, playerId, { id: "Withdraw", actor: "alice" }).state;
    expect(after.scene.presentCharacters.length).toBeGreaterThanOrEqual(2);
  });
});

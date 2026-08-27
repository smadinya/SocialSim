import { describe, expect, it } from "vitest";
import fixture from "@/fixtures/world.json";
import type { CharacterId, Move, WorldFixture, WorldState } from "./viewTypes";
import { runTick } from "./mockEngine";
import { MOVES_PER_DAY, formatClock, movesLeft, timeAt } from "./clock";
import { between, openConversations, talkingPairs } from "./conversations";
import { statusFor } from "./relationships";
import { MOCK_EFFECTS, heatState } from "./moveMeta";
import { REL_FIELDS } from "./format";
import { evidenceHeldBy, leadingSuspect, suspicionOf } from "./topics";

const { playerId, ...seed } = fixture as unknown as WorldFixture;
const fresh = () => structuredClone(seed) as WorldState;
const wait: Move = { id: "Wait", actor: playerId };

function play(world: WorldState, turns: number, move: Move = wait): WorldState {
  let w = world;
  for (let i = 0; i < turns; i++) w = runTick(w, playerId, move).state;
  return w;
}

// --- U1b: time ------------------------------------------------------------

describe("U1b the clock", () => {
  it("runs 08:00 to 20:00 across exactly 24 moves", () => {
    expect(timeAt(0)).toBe("08:00");
    expect(timeAt(MOVES_PER_DAY - 1)).toBe("19:30");
    expect(timeAt(MOVES_PER_DAY)).toBe("20:00");
    expect(formatClock(3, 13)).toBe("Day 3 — 14:30");
  });

  it("spends one slot per move and rolls the day exactly once", () => {
    const start = fresh();
    expect(movesLeft(start.slot)).toBe(11);

    const afterTen = play(start, 10);
    expect(afterTen.day).toBe(3);
    expect(afterTen.slot).toBe(23);

    const rolled = play(afterTen, 1);
    expect(rolled.day).toBe(4);
    expect(rolled.slot).toBe(0);
  });

  it("reports what happened overnight rather than changing things silently", () => {
    const eve = play(fresh(), 10);
    const result = runTick(eve, playerId, wait);
    expect(result.state.day).toBe(4);
    expect(result.overnight).toBeDefined();
  });
});

// --- U1: decay ------------------------------------------------------------

describe("U1 fear and anger come back down", () => {
  it("returns fear toward baseline once the pressure stops", () => {
    let world = fresh();
    const base = world.characters.alice.relationships.you.fear;

    for (let i = 0; i < 4; i++) {
      world = runTick(world, playerId, {
        id: "Confront",
        actor: playerId,
        target: "alice",
      }).state;
    }
    const spiked = world.characters.alice.relationships.you.fear;
    expect(spiked).toBeGreaterThan(base);

    // Left alone, it decays. This was impossible before update 1: no move in
    // the effect table carried a negative fear term and there was no decay.
    const settled = play(world, 12).characters.alice.relationships.you.fear;
    expect(settled).toBeLessThan(spiked);
  });

  it("has at least one move that lowers every axis", () => {
    for (const axis of REL_FIELDS) {
      const lowers = Object.values(MOCK_EFFECTS).some((effects) =>
        effects.some((e) => e.field === axis && e.amount < 0),
      );
      expect({ axis, lowers }).toEqual({ axis, lowers: true });
    }
  });
});

// --- U2: conversations ----------------------------------------------------

describe("U2 conversations", () => {
  it("opens a thread and keeps the beats", () => {
    const after = runTick(fresh(), playerId, {
      id: "Greet",
      actor: playerId,
      target: "alice",
    }).state;

    const conversation = between(after, playerId, "alice");
    expect(conversation).toBeTruthy();
    expect(conversation!.beats.length).toBeGreaterThan(0);
    expect(talkingPairs(after, after.scene.location).length).toBeGreaterThan(0);
  });

  it("never puts one character in two conversations at once", () => {
    let world = fresh();
    for (let i = 0; i < 8; i++) {
      world = runTick(world, playerId, {
        id: "Greet",
        actor: playerId,
        target: world.scene.presentCharacters.find((id) => id !== playerId) ?? "alice",
      }).state;

      const seen = new Set<CharacterId>();
      for (const c of openConversations(world)) {
        for (const p of c.participants) {
          expect(seen.has(p)).toBe(false);
          seen.add(p);
        }
      }
    }
  });

  it("carries the topic so the scene can say what it's about", () => {
    const after = runTick(fresh(), playerId, {
      id: "AskAbout",
      actor: playerId,
      target: "alice",
      args: { topicId: "the-leak" },
    }).state;

    expect(between(after, playerId, "alice")?.topicId).toBe("the-leak");
    expect(talkingPairs(after)[0]?.topicLabel).toBe("the leaked plan");
  });
});

// --- U3: responding -------------------------------------------------------

describe("U3 answering an ask", () => {
  it("opens a request the player can answer, and clears it when they do", () => {
    let world = fresh();
    world = runTick(world, playerId, {
      id: "AskForHelp",
      actor: playerId,
      target: "alice",
    }).state;
    // Alice asking back is what the player has to be able to answer.
    world.pendingRequests.push({
      id: "req-test",
      from: "alice",
      to: playerId,
      moveId: "AskForHelp",
      turnAsked: world.turn,
      expiresTurn: world.turn + 3,
    });

    const after = runTick(world, playerId, {
      id: "Comply",
      actor: playerId,
      target: "alice",
    }).state;
    expect(after.pendingRequests.some((r) => r.id === "req-test")).toBe(false);
  });

  it("charges the player for letting one lapse", () => {
    const world = fresh();
    world.pendingRequests.push({
      id: "req-lapse",
      from: "alice",
      to: playerId,
      moveId: "AskForHelp",
      turnAsked: world.turn,
      expiresTurn: world.turn + 1,
    });
    const before = world.characters.alice.relationships.you.affection;

    const after = play(world, 2);
    expect(after.pendingRequests.some((r) => r.id === "req-lapse")).toBe(false);
    expect(after.characters.alice.relationships.you.affection).toBeLessThan(before);
  });
});

// --- U4: heat and fighting ------------------------------------------------

describe("U4 arguments escalate", () => {
  it("heats up on insults and unlocks a fight", () => {
    let world = fresh();
    for (let i = 0; i < 3; i++) {
      world = runTick(world, playerId, {
        id: "Insult",
        actor: playerId,
        target: "alice",
      }).state;
    }
    const conversation = between(world, playerId, "alice");
    expect(conversation).toBeTruthy();
    expect(conversation!.heat).toBeGreaterThanOrEqual(60);
    expect(heatState(conversation!.heat)).not.toBe("calm");
  });

  it("a fight ends the conversation and moves someone out of the room", () => {
    let world = fresh();
    for (let i = 0; i < 3; i++) {
      world = runTick(world, playerId, {
        id: "Insult",
        actor: playerId,
        target: "alice",
      }).state;
    }
    const where = world.characters.alice.location;
    const after = runTick(world, playerId, {
      id: "Fight",
      actor: playerId,
      target: "alice",
    }).state;

    expect(between(after, playerId, "alice")).toBeNull();
    expect(after.characters.alice.location).not.toBe(where);
    expect(
      after.characters.alice.memories.some((m) => m.core && m.tags.includes("fight")),
    ).toBe(true);
  });

  it("flirting at someone who barely likes you lands badly", () => {
    const world = fresh();
    world.characters.alice.relationships.you.affection = 10;
    const before = world.characters.alice.relationships.you.respect;

    const after = runTick(world, playerId, {
      id: "Flirt",
      actor: playerId,
      target: "alice",
    }).state;
    expect(after.characters.alice.relationships.you.respect).toBeLessThan(before);
  });
});

// --- U5: locations --------------------------------------------------------

describe("U5 locations", () => {
  it("moves the player and re-derives who is present", () => {
    const after = runTick(fresh(), playerId, {
      id: "GoTo",
      actor: playerId,
      args: { location: "kitchen" },
    }).state;

    expect(after.characters.you.location).toBe("kitchen");
    expect(after.scene.location).toBe("kitchen");
    expect(after.scene.presentCharacters).toContain("you");
    expect(after.scene.presentCharacters).not.toContain("alice");
  });

  it("what happens in another room reaches the player as a feed line, not a scene line", () => {
    const world = fresh();
    const result = runTick(world, playerId, {
      id: "GoTo",
      actor: playerId,
      args: { location: "kitchen" },
    });
    for (const entry of result.log) {
      if (entry.witnessedByPlayer) continue;
      expect(
        result.events.some((e) => e.actor === entry.move.actor),
      ).toBe(true);
    }
  });
});

// --- U6: core memory ------------------------------------------------------

describe("U6 major events", () => {
  it("never evicts a core memory, however much filler piles up", () => {
    const after = play(fresh(), 30);
    for (const id of Object.keys(after.characters)) {
      const seeded = (seed as WorldState).characters[id].memories.filter((m) => m.core);
      for (const m of seeded) {
        expect(after.characters[id].memories.some((k) => k.id === m.id)).toBe(true);
      }
    }
  });
});

// --- U7: relationship status ---------------------------------------------

describe("U7 who is whose friend", () => {
  it("labels the fixture the way the scenario reads", () => {
    const world = fresh();
    expect(statusFor(world.characters.dana.relationships.alice)).toBe("close");
    // Dana caught him lying and is loyal to Alice: she is done with him,
    // which is a different thing from being frightened of him.
    expect(statusFor(world.characters.dana.relationships.bob)).toBe("estranged");
    // Alice is suspicious of Bob, not finished with him. That distinction is
    // the whole scenario.
    expect(statusFor(world.characters.alice.relationships.bob)).toBe("wary");
  });

  it("records what a relationship was before it changed", () => {
    let world = fresh();
    for (let i = 0; i < 4; i++) {
      world = runTick(world, playerId, {
        id: "Insult",
        actor: playerId,
        target: "alice",
      }).state;
    }
    const rel = world.characters.alice.relationships.you;
    expect(rel.history.length).toBeGreaterThan(0);
    expect(rel.history[0].was).not.toBe(rel.history[0].now);
  });
});

// --- U8: the mystery ------------------------------------------------------

describe("U8 finding out who leaked the plan", () => {
  it("does not hand Alice the answer at the start", () => {
    const world = fresh();
    const held = evidenceHeldBy(world, "alice", "the-leak");
    expect(held).toHaveLength(1);
    expect(suspicionOf(world, "alice", "bob", "the-leak")).toBeLessThan(0.7);
    // Bob, and only Bob, knows.
    expect(
      world.characters.bob.memories.some((m) => m.description.includes("I told a rival")),
    ).toBe(true);
  });

  it("takes three true pieces to convict Bob and two lies to frame Calum", () => {
    const world = fresh();
    const evidence = world.topics["the-leak"].evidence;
    const give = (id: string) => evidence.find((e) => e.id === id)!.heldBy.push("alice");

    give("bob-changed-story");
    expect(suspicionOf(world, "alice", "bob", "the-leak")).toBeLessThan(0.7);
    give("calum-heard-early");
    expect(suspicionOf(world, "alice", "bob", "the-leak")).toBeGreaterThanOrEqual(0.7);

    const framed = fresh();
    const lies = framed.topics["the-leak"].evidence.filter((e) => !e.accurate);
    expect(lies.length).toBe(2);
    for (const lie of lies) lie.heldBy.push("alice");
    expect(suspicionOf(framed, "alice", "calum", "the-leak")).toBeGreaterThanOrEqual(0.7);
    expect(leadingSuspect(framed, "alice", "the-leak")?.suspect).toBe("calum");
  });

  it("a rumor plants something Alice cannot tell is false", () => {
    const after = runTick(fresh(), playerId, {
      id: "SpreadRumor",
      actor: playerId,
      target: "alice",
      args: { topicId: "the-leak" },
    }).state;

    const planted = after.topics["the-leak"].evidence.filter(
      (e) => !e.accurate && e.heldBy.includes("alice"),
    );
    expect(planted.length).toBe(1);
  });

  it("reaches an ending rather than running forever", () => {
    const after = play(fresh(), 60);
    expect(after.phase).toBe("resolved");
    expect(after.ending).toBeTruthy();
  });
});

// --- refusals -------------------------------------------------------------

describe("a move that cannot happen costs nothing", () => {
  const impossible: [string, Move][] = [
    ["target in another room", { id: "Insult", actor: playerId, target: "calum" }],
    ["a room you can't reach", { id: "GoTo", actor: playerId, args: { location: "library" } }],
    ["fighting someone calm", { id: "Fight", actor: playerId, target: "alice" }],
  ];

  for (const [what, move] of impossible) {
    it(`refuses ${what} without spending a slot`, () => {
      const world = fresh();
      const result = runTick(world, playerId, move);

      expect(result.state.slot).toBe(world.slot);
      expect(result.state.turn).toBe(world.turn);
      expect(result.log).toHaveLength(0);
      // And it says why, rather than looking like a quiet turn.
      expect(result.events.some((e) => e.type === "blocked")).toBe(true);
      expect(result.events[0].description.length).toBeGreaterThan(0);
    });
  }

  it("still lets a legal move through", () => {
    const world = fresh();
    const result = runTick(world, playerId, {
      id: "Greet",
      actor: playerId,
      target: "alice",
    });
    expect(result.state.slot).toBe(world.slot + 1);
    expect(result.events.some((e) => e.type === "blocked")).toBe(false);
  });
});

describe("a status doesn't flap while decay pulls a gain back", () => {
  it("holds the label it announced until the change is real", () => {
    let world = fresh();
    const seen: string[] = [];

    for (let i = 0; i < 20; i++) {
      const result = runTick(world, playerId, wait);
      world = result.state;
      for (const e of result.events) {
        if (e.type === "status") seen.push(`${e.actor}>${e.target}`);
      }
    }

    // A pair may cross once or twice over twenty turns. Announcing the same
    // pair five times is decay undoing a same-day gain, not a relationship
    // changing.
    const counts = new Map<string, number>();
    for (const pair of seen) counts.set(pair, (counts.get(pair) ?? 0) + 1);
    for (const [pair, n] of counts) {
      expect({ pair, n }).toEqual({ pair, n: expect.any(Number) });
      expect(n).toBeLessThanOrEqual(3);
    }
  });
});

describe("feed lines read as English", () => {
  it("puts the name last in every status blurb", () => {
    // "Robin now treats as a rival Alice." shipped once. Every blurb ends in
    // a preposition because the name is appended after it.
    let world = fresh();
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = runTick(world, playerId, wait);
      world = r.state;
      for (const e of r.events) if (e.type === "status") lines.push(e.description);
    }
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const name = line.replace(/\.$/, "").split(" ").pop() ?? "";
      const names = Object.values(world.characters).map((c) => c.name);
      expect({ line, endsWithName: names.includes(name) }).toEqual({
        line,
        endsWithName: true,
      });
    }
  });
});

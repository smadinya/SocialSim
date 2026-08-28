import { describe, expect, it } from "vitest";
import fixture from "@/fixtures/world.json";
import type { CharacterId, Move, MoveId, WorldFixture, WorldState } from "./viewTypes";
import { runTick } from "./mockEngine";
import { conversationFor } from "./conversations";
import { LEAK_TOPIC, evidenceHeldBy, phaseFor, shareableEvidence } from "./topics";
import { stubDialogue } from "./moveMeta";
import { interpretInput } from "./interpret";
import { MOVE_IDS } from "@sim/moves/catalog";

/**
 * Defects found by driving whole playthroughs headlessly — five play styles
 * across eight seeds, day 3 to the ending — rather than by unit-testing the
 * pieces. Every one of these passed `typecheck`, `lint` and the existing 93
 * tests while the game was visibly broken on screen, which is the argument for
 * keeping them: they assert what a scene READS like, not what a function
 * returns.
 */

const { playerId, ...seed } = fixture as unknown as WorldFixture;
const LEGAL = [...MOVE_IDS] as MoveId[];
const fresh = (rngSeed?: number): WorldState => {
  const w = structuredClone(seed) as WorldState;
  if (rngSeed !== undefined) w.rngSeed = rngSeed;
  return w;
};
const wait: Move = { id: "Wait", actor: playerId };
const SEEDS = [20260822, 1, 7, 42, 99, 1234, 555, 8080];

function playOut(
  pick: (w: WorldState) => Move,
  rngSeed: number,
  maxTurns = 60,
): { world: WorldState; ticks: ReturnType<typeof runTick>[] } {
  let w = fresh(rngSeed);
  const ticks: ReturnType<typeof runTick>[] = [];
  for (let i = 0; i < maxTurns && w.phase !== "resolved"; i++) {
    const result = runTick(w, playerId, pick(w));
    ticks.push(result);
    w = result.state;
  }
  return { world: w, ticks };
}

const othersHere = (w: WorldState) =>
  w.scene.presentCharacters.filter((id) => id !== playerId);

// --- dialogue says what the move does -------------------------------------

describe("a line addresses the listener and names the subject", () => {
  it("does not tell the listener the rumour is about the listener", () => {
    const line = stubDialogue("SpreadRumor", "Alice", "Bob");
    expect(line).toContain("Alice");
    expect(line).toContain("Bob");
    // The bug: "You didn't hear it from me, but Alice has been talking." —
    // said TO Alice, ABOUT Alice.
    expect(line.indexOf("Alice")).toBeLessThan(line.indexOf("Bob"));
  });

  it("does not ask the person being defended to leave themselves out of it", () => {
    const line = stubDialogue("Defend", "Alice", "Bob");
    expect(line).toBe("Leave Bob out of this, Alice — they've done nothing wrong.");
  });

  it("reads as a whole sentence when nobody was named", () => {
    for (const id of ["SpreadRumor", "Defend", "RevealSecret"] as MoveId[]) {
      const line = stubDialogue(id, "Alice");
      expect(line).not.toContain("{");
      expect(line).toContain("them");
    }
  });
});

// --- conversations have two people in them --------------------------------

describe("NPC conversations are two-sided", () => {
  it("answers an NPC who is addressed by another NPC", () => {
    // Bob's strongest tendency is Propose/GiveGift at Calum, and Calum has no
    // tendency aimed back at Bob. Before replies were generalised beyond the
    // player's own move, Calum could not answer him even once.
    let answered = 0;
    for (const rngSeed of SEEDS) {
      const { ticks } = playOut(() => wait, rngSeed);
      for (const t of ticks) {
        if (t.log.some((r) => r.move.actor === "calum" && r.move.target === "bob")) {
          answered += 1;
        }
      }
    }
    expect(answered).toBeGreaterThan(0);
  });

  it("never leaves one NPC talking at a silent partner for a whole thread", () => {
    for (const rngSeed of SEEDS) {
      const speakers = new Map<string, Set<CharacterId>>();
      const beats = new Map<string, number>();
      const { ticks } = playOut(() => wait, rngSeed);

      for (const t of ticks) {
        for (const r of t.log) {
          if (!r.threadId || r.threadId.includes(playerId)) continue;
          if (!speakers.has(r.threadId)) speakers.set(r.threadId, new Set());
          speakers.get(r.threadId)!.add(r.move.actor);
          beats.set(r.threadId, (beats.get(r.threadId) ?? 0) + 1);
        }
      }

      for (const [id, who] of speakers) {
        if ((beats.get(id) ?? 0) < 3) continue;
        expect(who.size, `${id} on seed ${rngSeed}`).toBeGreaterThan(1);
      }
    }
  });

  it("does not let an NPC say the same sentence on consecutive turns", () => {
    for (const rngSeed of SEEDS) {
      const last = new Map<CharacterId, { line: string; tick: number }>();
      const { ticks } = playOut(() => wait, rngSeed);

      ticks.forEach((t, tick) => {
        for (const u of t.utterances) {
          if (u.speaker === playerId) continue;
          const previous = last.get(u.speaker);
          expect(
            previous?.line === u.line && previous.tick === tick - 1,
            `${u.speaker} repeated "${u.line}" on seed ${rngSeed}`,
          ).toBe(false);
          last.set(u.speaker, { line: u.line, tick });
        }
      });
    }
  });

  it("does not answer a question with a secret it hasn't got", () => {
    // Alice holds one shareable fact. Asking her nine times used to produce
    // nine identical "There's something you should know" lines and one
    // transfer.
    let w = fresh();
    const ask: Move = {
      id: "Ask",
      actor: playerId,
      target: "alice",
      args: { topicId: LEAK_TOPIC },
    };
    let reveals = 0;
    for (let i = 0; i < 9; i++) {
      const result = runTick(w, playerId, ask);
      reveals += result.log.filter(
        (r) => r.move.actor === "alice" && r.move.id === "RevealSecret",
      ).length;
      w = result.state;
    }
    expect(reveals).toBeLessThanOrEqual(1);
  });
});

// --- nobody is told a fact about themselves -------------------------------

describe("evidence never reaches the person it points at", () => {
  it("is not offered by shareableEvidence", () => {
    const w = fresh();
    w.characters.alice.relationships.calum.trust = 90;
    const offered = shareableEvidence(w, "alice", "calum", LEAK_TOPIC);
    expect(offered?.pointsAt).not.toBe("calum");
  });

  it("is not reached by any route across a whole run", () => {
    for (const rngSeed of SEEDS) {
      const { world } = playOut(() => wait, rngSeed);
      for (const e of world.topics[LEAK_TOPIC].evidence) {
        if (!e.pointsAt) continue;
        expect(
          e.heldBy,
          `${e.id} reached ${e.pointsAt} on seed ${rngSeed}`,
        ).not.toContain(e.pointsAt);
      }
    }
  });
});

// --- a room is not a public address system --------------------------------

describe("overhearing has a limit", () => {
  it("does not hand every fact to every character by the end of a run", () => {
    for (const rngSeed of SEEDS) {
      const { world } = playOut(() => wait, rngSeed);
      const cast = Object.keys(world.characters).length;
      const universal = world.topics[LEAK_TOPIC].evidence.filter(
        (e) => e.heldBy.length >= cast,
      );
      expect(universal, `seed ${rngSeed}`).toHaveLength(0);
    }
  });

  it("does not broadcast a private answer to everyone standing in the room", () => {
    const result = runTick(fresh(), playerId, {
      id: "Ask",
      actor: playerId,
      target: "alice",
      args: { topicId: LEAK_TOPIC },
    });
    const keystone = result.state.topics[LEAK_TOPIC].evidence.find(
      (e) => e.id === "told-only-bob",
    )!;
    // Alice and Robin, and not the whole courtyard with them.
    expect(keystone.heldBy).toContain(playerId);
    expect(keystone.heldBy).not.toContain("bob");
  });
});

// --- the player is never moved by anything but their own GoTo -------------

describe("the player keeps their own scene", () => {
  it("is not walked out of the room when an NPC starts a fight", () => {
    let fights = 0;
    for (const rngSeed of SEEDS) {
      let w = fresh(rngSeed);
      for (let i = 0; i < 40 && w.phase !== "resolved"; i++) {
        const move: Move = w.scene.presentCharacters.includes("bob")
          ? { id: "Confront", actor: playerId, target: "bob" }
          : wait;
        const before = w.characters[playerId].location;
        const result = runTick(w, playerId, move);
        if (result.log.some((r) => r.move.id === "Fight")) fights += 1;
        expect(
          result.state.characters[playerId].location,
          `moved on seed ${rngSeed} turn ${result.state.turn}`,
        ).toBe(before);
        w = result.state;
      }
    }
    // The guard is worthless if no fight ever happened.
    expect(fights).toBeGreaterThan(0);
  });
});

// --- moves do what the menu says ------------------------------------------

describe("Withdraw breaks off the conversation", () => {
  it("disengages the player without relocating them", () => {
    let w = runTick(fresh(), playerId, {
      id: "Greet",
      actor: playerId,
      target: "alice",
    }).state;
    expect(conversationFor(w, playerId)).not.toBeNull();

    const where = w.characters[playerId].location;
    w = runTick(w, playerId, { id: "Withdraw", actor: playerId }).state;

    expect(conversationFor(w, playerId)).toBeNull();
    expect(w.characters[playerId].location).toBe(where);
  });
});

describe("RevealSecret with nothing to reveal", () => {
  it("is refused for free rather than spending a move on an empty line", () => {
    const w = fresh();
    // Robin starts holding nothing about the leak, so there is nothing to tell.
    expect(evidenceHeldBy(w, playerId, LEAK_TOPIC)).toHaveLength(0);
    const result = runTick(w, playerId, {
      id: "RevealSecret",
      actor: playerId,
      target: "alice",
      args: { topicId: LEAK_TOPIC },
    });
    expect(result.events.some((e) => e.type === "blocked")).toBe(true);
    expect(result.state.slot).toBe(w.slot);
    expect(result.utterances).toHaveLength(0);
  });
});

describe("SpreadRumor honours the subject the player named", () => {
  it("plants a story about that person, not whichever lie came first", () => {
    const w = fresh();
    const result = runTick(w, playerId, {
      id: "SpreadRumor",
      actor: playerId,
      target: "alice",
      args: { topicId: LEAK_TOPIC, subject: "calum" },
    });
    const planted = result.state.topics[LEAK_TOPIC].evidence.filter((e) =>
      e.heldBy.includes("alice"),
    );
    expect(planted.some((e) => e.pointsAt === "calum" && !e.accurate)).toBe(true);
  });

  it("tells no story at all when there is none about the person named", () => {
    const w = fresh();
    const before = JSON.stringify(w.topics[LEAK_TOPIC].evidence);
    const result = runTick(w, playerId, {
      id: "SpreadRumor",
      actor: playerId,
      target: "alice",
      // Every planted lie in the fixture points at Calum; there is nothing
      // untrue to say about Dana, so nothing is planted.
      args: { topicId: LEAK_TOPIC, subject: "dana" },
    });
    expect(JSON.stringify(result.state.topics[LEAK_TOPIC].evidence)).toBe(before);
  });
});

// --- the arc ---------------------------------------------------------------

describe("the reckoning is a phase you can play", () => {
  it("opens on the evening of the deadline day, not after it", () => {
    const w = fresh();
    w.day = 4;
    w.slot = 16;
    expect(phaseFor(w, "alice")).toBe("reckoning");
    w.slot = 15;
    expect(phaseFor(w, "alice")).not.toBe("reckoning");
  });

  it("gives the player moves between the warning and the ending", () => {
    let w = fresh();
    let announced = -1;
    let ended = -1;
    let ticks = 0;
    while (w.phase !== "resolved" && ticks < 60) {
      const result = runTick(w, playerId, wait);
      if (result.events.some((e) => e.type === "phase" && e.description.includes("heard enough"))) {
        announced = ticks;
      }
      if (result.events.some((e) => e.type === "ending")) ended = ticks;
      w = result.state;
      ticks += 1;
    }
    expect(announced).toBeGreaterThanOrEqual(0);
    expect(ended).toBeGreaterThan(announced);
  });
});

describe("investigating beats not investigating", () => {
  it("reaches the true ending when the player gathers and reports", () => {
    for (const rngSeed of SEEDS) {
      const { world } = playOut((w) => {
        const here = othersHere(w);
        const mine = evidenceHeldBy(w, playerId, LEAK_TOPIC).map((e) => e.id);
        const hers = evidenceHeldBy(w, "alice", LEAK_TOPIC).map((e) => e.id);

        if (here.includes("alice") && mine.some((id) => !hers.includes(id))) {
          return { id: "RevealSecret", actor: playerId, target: "alice", args: { topicId: LEAK_TOPIC } };
        }
        const source = here.find((id) =>
          evidenceHeldBy(w, id, LEAK_TOPIC).some((e) => !mine.includes(e.id)),
        );
        if (source) {
          return { id: "Ask", actor: playerId, target: source, args: { topicId: LEAK_TOPIC } };
        }
        const exits = w.locations[w.characters[playerId].location].connectsTo;
        return { id: "GoTo", actor: playerId, args: { location: exits[0] } };
      }, rngSeed);

      expect(world.ending, `seed ${rngSeed}`).toBe("exposed");
    }
  });

  it("lets the player frame someone instead", () => {
    for (const rngSeed of SEEDS) {
      const { world } = playOut(
        (w) =>
          othersHere(w).includes("alice")
            ? {
                id: "SpreadRumor",
                actor: playerId,
                target: "alice",
                args: { topicId: LEAK_TOPIC, subject: "calum" },
              }
            : wait,
        rngSeed,
      );
      expect(world.ending, `seed ${rngSeed}`).toBe("wrong-person");
    }
  });
});

// --- what the feed says about a relationship ------------------------------

describe("status crossings read in the direction they moved", () => {
  it("does not describe a warming relationship as a betrayal", () => {
    let w = fresh();
    for (let i = 0; i < 12; i++) {
      w = runTick(w, playerId, { id: "GiveGift", actor: playerId, target: "alice" }).state;
    }
    const written = w.characters.alice.memories.filter((m) => m.tags.includes("status"));
    for (const memory of written) {
      // The pair only ever improved, so nothing about Robin should read as a
      // discovery that he is not who Alice thought he was.
      if (!memory.tags.includes(playerId)) continue;
      expect(memory.description).not.toContain("not who I thought");
    }
  });
});

// --- free text ------------------------------------------------------------

describe("the interpreter reads the player's word order", () => {
  it("takes the first move word in the input, not the first in the table", () => {
    const w = fresh();
    const result = interpretInput("just ask alice, don't fight", playerId, LEGAL, w);
    expect(result.move.id).toBe("Ask");
  });

  it("falls back to a move that does nothing when it cannot parse", () => {
    const w = fresh();
    const result = interpretInput("qwertyuiop", playerId, LEGAL, w);
    expect(result.ok).toBe(false);
    expect(result.move.id).toBe("Wait");
  });
});

// --- the bucketed fallback lines agree with the stub lines -----------------

describe("the fallback table names the subject it was given", () => {
  it("substitutes {subject} rather than hardcoding \"them\"", async () => {
    const { FALLBACK_LINES, fallbackLine } = await import("@ai/fallbacks");
    const threeParty: MoveId[] = ["SpreadRumor", "RevealSecret", "Defend"];

    for (const tone of ["cold", "neutral", "warm"] as const) {
      for (const id of threeParty) {
        expect(FALLBACK_LINES[tone][id], `${tone}/${id}`).toContain("{subject}");
      }
    }

    // And the substitution reaches the rendered line.
    const line = fallbackLine({
      move: { id: "SpreadRumor", actor: playerId, target: "alice" },
      targetName: "Alice",
      subjectName: "Calum",
      relationshipSnapshot: {
        trust: 50, affection: 50, respect: 50, fear: 0, anger: 0,
        baseline: { trust: 50, affection: 50, respect: 50, fear: 0, anger: 0 },
        lastDelta: {}, flags: [], history: [],
      },
    } as never);
    expect(line).toContain("Calum");
    expect(line).not.toContain("{");
  });
});

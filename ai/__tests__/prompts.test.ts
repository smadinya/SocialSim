import { describe, expect, it } from "vitest";
import type { CharacterId, WorldState } from "@sim/types";
import { REL_FIELDS } from "@/lib/format";
import { realizePrompt } from "@ai/prompts/realize";
import { toPendingUtterance } from "@ai/adapt";
import deep from "./fixtures/deep-world.json";

const world = deep as unknown as WorldState;

function promptFor(actor: CharacterId, id: string, target?: CharacterId): string {
  return realizePrompt(
    toPendingUtterance(world, {
      move: { id, actor, target },
      witnessedByPlayer: true,
    }),
  );
}

/**
 * Every `axis value` pair the prompt actually renders.
 *
 * Built from `REL_FIELDS` rather than a hard-coded alternation: the literal
 * list stopped covering every axis the moment `anger` landed, and a leak test
 * that quietly ignores an axis is worse than no leak test.
 */
function axisPairs(prompt: string): Set<string> {
  const out = new Set<string>();
  const axes = REL_FIELDS.join("|");
  for (const m of prompt.matchAll(new RegExp(`\\b(${axes}) (\\d+)`, "g"))) {
    out.add(`${m[1]} ${m[2]}`);
  }
  return out;
}

describe("prompt assembly", () => {
  // THE test. Retrieval's owner-filtering is free; this is the one that would
  // catch prompt assembly reaching into `world` for "a bit more context".
  it("no assembled prompt contains a third party's true axis values", () => {
    for (const speaker of Object.keys(world.characters)) {
      for (const target of Object.keys(world.characters)) {
        if (target === speaker) continue;
        const pairs = axisPairs(promptFor(speaker, "Confront", target));

        const own = new Set(
          REL_FIELDS.map(
            (f) =>
              `${f} ${world.characters[speaker].relationships[target][f] ?? 0}`,
          ),
        );
        // The speaker's own view of the listener, and nothing else.
        expect([...pairs].sort()).toEqual([...own].sort());
      }
    }
  });

  it("Calum-absent: no prompt built for Calum carries the betrayal he missed", () => {
    for (const target of ["bob", "alice", "dana", "you"]) {
      for (const id of ["Confront", "Greet", "SpreadRumor", "AskForHelp", "Insult"]) {
        const prompt = promptFor("calum", id, target).toLowerCase();
        expect(prompt).not.toMatch(/leak|betray/);
      }
    }
  });

  it("sends the speaker's beliefs, flagged as possibly wrong", () => {
    const prompt = promptFor("bob", "Greet", "calum");
    expect(prompt).toContain("Calum can be brought around");
    expect(prompt).toContain("may be wrong");
  });

  it("sends deltas, not just values", () => {
    const u = toPendingUtterance(
      world,
      { move: { id: "Confront", actor: "alice", target: "bob" }, witnessedByPlayer: true },
      [
        {
          sourceActor: "bob",
          from: "alice",
          to: "bob",
          field: "trust",
          before: 44,
          after: 18,
        },
      ],
    );
    expect(realizePrompt(u)).toContain("trust 18 (down from 44 this turn)");
  });

  it("carries relationship flags", () => {
    expect(promptFor("alice", "Confront", "bob")).toContain("betrayed");
  });

  it("never takes a WorldState — there is nothing to reach into", () => {
    expect(realizePrompt.length).toBe(1);
  });
});

describe("false belief", () => {
  // The assembly half, which is all that is buildable today. The engine half
  // needs Track A's belief formation and `Memory.accurate` at G0 (asks #5,
  // #6) — see the skipped test below.
  it("carries the planted claim and no trace of the true one", () => {
    const planted = structuredClone(world);
    const calum = planted.characters.calum;

    // What SpreadRumor(Bob -> Calum, about Alice) will write once Track A
    // writes it: an inaccurate memory, and a belief whose subject is Alice.
    calum.memories.push({
      id: "mem-calum-rumor",
      turn: 11,
      actor: "bob",
      target: "alice",
      description: "Bob said Alice sold the group out to a rival.",
      tags: ["spreadrumor", "alice", "bob", "trust"],
      importance: 0.8,
      valence: -0.7,
      tier: "told",
      accurate: false,
    } as (typeof calum.memories)[number]);
    calum.beliefs.push({
      id: "bel-calum-rumor",
      subject: "alice",
      axis: "trust",
      description: "Alice sold the group out to a rival.",
      confidence: 0.6,
      sourceMemoryId: "mem-calum-rumor",
    } as (typeof calum.beliefs)[number]);

    const prompt = realizePrompt(
      toPendingUtterance(planted, {
        move: { id: "Confront", actor: "calum", target: "alice" },
        witnessedByPlayer: true,
      }),
    );

    expect(prompt).toContain("Alice sold the group out to a rival.");
    // The true version — that Bob was the leak — is in Alice's, Bob's and
    // Dana's memories. None of it reaches Calum.
    expect(prompt.toLowerCase()).not.toMatch(/leak|betray/);
  });

  it.skip("end to end: the engine plants it (blocked on Track A belief formation)", () => {
    // Nothing anywhere writes a Belief today, so there is no move to run.
  });
});

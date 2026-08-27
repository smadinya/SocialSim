import { beforeEach, describe, expect, it } from "vitest";
import type { PendingUtterance, WorldState } from "@sim/types";
import { FALLBACK_LINES, fallbackLine, toneFor } from "@ai/fallbacks";
import { cacheClear, cacheGet, cacheKey, cacheSet } from "@ai/cache";
import { namesUnknownCharacter, realize } from "@ai/realize";
import { realizePrompt } from "@ai/prompts/realize";
import { MOVE_META } from "@/lib/moveMeta";
import { toPendingUtterance } from "@ai/adapt";
import deep from "./fixtures/deep-world.json";

// Every test in this file runs with no network.
process.env.MOCK_LLM = "1";

const world = deep as unknown as WorldState;

function pending(actor: string, id: string, target?: string): PendingUtterance {
  return toPendingUtterance(world, {
    move: { id, actor, target },
    witnessedByPlayer: true,
  });
}

describe("fallbacks", () => {
  it("covers every speaking move in the catalog, in all three buckets", () => {
    // `Wait` is the one move that produces no utterance, so it needs no line.
    const speaking = Object.keys(MOVE_META).filter((id) => id !== "Wait");
    for (const bucket of ["cold", "neutral", "warm"] as const) {
      for (const id of speaking) {
        expect(FALLBACK_LINES[bucket][id]).toBeTruthy();
      }
    }
  });

  it("buckets on relationshipTone — the same three strings the UI renders", () => {
    // Alice reads `neutral` toward Bob on purpose: after the update-1 rewrite
    // she suspects him and has not concluded, and the tone she speaks in is
    // how the player is supposed to be able to tell. Dana, who has evidence,
    // is the one who reads `cold`.
    expect(toneFor(pending("alice", "Confront", "bob"))).toBe("neutral");
    expect(toneFor(pending("dana", "Confront", "bob"))).toBe("cold");
    expect(toneFor(pending("calum", "Greet", "dana"))).toBe("neutral");
    expect(toneFor(pending("dana", "Defend", "alice"))).toBe("warm");
  });

  it("substitutes the target name", () => {
    expect(fallbackLine(pending("alice", "Greet", "bob"))).toContain("Bob");
    expect(fallbackLine(pending("alice", "Withdraw"))).not.toContain("{target}");
  });

  // B-16: a targetless move gets a zeroed relationship from `adapt.ts`, which
  // scored as `cold` — so `Withdraw` drew the cold bucket in every scene and
  // its other two lines could never be reached.
  it("uses neutral, not cold, for a move aimed at nobody", () => {
    expect(toneFor(pending("alice", "Withdraw"))).toBe("neutral");
  });

  it("gives each bucket its own words for every speaking move", () => {
    const speaking = Object.keys(MOVE_META).filter((id) => id !== "Wait");
    for (const id of speaking) {
      const lines = new Set([
        FALLBACK_LINES.cold[id],
        FALLBACK_LINES.neutral[id],
        FALLBACK_LINES.warm[id],
      ]);
      expect(lines.size, `${id} reuses a line across buckets`).toBe(3);
    }
  });

  it("reads the third party as 'them' when nobody was named", () => {
    for (const id of ["SpreadRumor", "RevealSecret", "Defend"]) {
      expect(fallbackLine(pending("alice", id, "dana"))).not.toContain("{subject}");
    }
  });
});

describe("realize", () => {
  beforeEach(cacheClear);

  it("MOCK_LLM=1 returns a fallback line with zero API calls", async () => {
    const u = pending("alice", "Confront", "bob");
    const got = await realize(u);
    expect(got.line).toBe(fallbackLine(u));
  });

  it("runs every witnessed move in a tick, autonomous ones included", async () => {
    const moves = [
      pending("bob", "Propose", "calum"),
      pending("dana", "Confront", "bob"),
      pending("you", "Greet", "alice"),
    ];
    const lines = await Promise.all(moves.map(realize));
    for (const l of lines) expect(l.line.length).toBeGreaterThan(0);
  });

  it("rejects a line naming a character the prompt never mentioned", () => {
    const u = pending("calum", "Greet", "dana");
    const prompt = "CHARACTER: Calum\nTHE MOVE: Greet toward Dana";

    expect(namesUnknownCharacter("Have you seen Alice today?", prompt, u.castNames)).toBe(true);
    expect(namesUnknownCharacter("Good to see you.", prompt, u.castNames)).toBe(false);
    // ...and not on a name buried inside another word.
    expect(namesUnknownCharacter("I was robbed of a good morning.", prompt, u.castNames)).toBe(false);
  });

  // The bug that made every real call fall back: beliefs and memory
  // descriptions name people who are not a memory's actor or target, so an
  // allow-list built from participants rejected lines that used context we
  // deliberately sent.
  it("accepts a name the prompt itself supplied via a belief", () => {
    const u = pending("you", "Confront", "alice");
    const prompt = realizePrompt(u);
    expect(prompt).toMatch(/\bBob\b/); // "Something happened between Alice and Bob"
    expect(namesUnknownCharacter("Is this about Bob?", prompt, u.castNames)).toBe(false);
  });
});

describe("cache", () => {
  beforeEach(cacheClear);

  it("keys apart on the top memory — a new event can't serve an old line", () => {
    const a = pending("alice", "Confront", "bob");
    const b = structuredClone(a);
    b.retrievedMemories = [{ ...b.retrievedMemories[0], tags: ["something-else"] }];
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  // B-17: the cached line names people by name, so two speakers sharing an
  // entry means a hit can serve a line addressed to the wrong person. Memory
  // ids are owner-scoped, which hid this by making every key unique — which is
  // also why the cache never hit.
  it("keys apart on who is speaking and who they're speaking to", () => {
    const a = pending("alice", "Greet", "dana");
    const b = structuredClone(a);
    b.speaker = "calum";
    expect(cacheKey(a)).not.toBe(cacheKey(b));

    const c = structuredClone(a);
    c.move = { ...c.move, target: "calum" };
    expect(cacheKey(a)).not.toBe(cacheKey(c));
  });

  it("collides on the same situation, so it can actually hit", () => {
    const a = pending("alice", "Greet", "dana");
    const b = structuredClone(a);
    // Same tags, different memory — the situation is the situation.
    b.retrievedMemories = [{ ...b.retrievedMemories[0], id: "mem-alice-999" }];
    expect(cacheKey(a)).toBe(cacheKey(b));
  });

  it("buckets axes coarsely enough to hit", () => {
    const a = pending("calum", "Greet", "dana"); // trust 53, mid band
    const b = structuredClone(a);
    b.relationshipSnapshot.trust += 2;
    expect(cacheKey(a)).toBe(cacheKey(b));
  });

  it("doesn't serve a warm line at trust 10", () => {
    const a = pending("alice", "Confront", "bob");
    const b = structuredClone(a);
    b.relationshipSnapshot.trust = 90;
    expect(cacheKey(a)).not.toBe(cacheKey(b));
  });

  it("round-trips", () => {
    const key = cacheKey(pending("alice", "Greet", "dana"));
    cacheSet(key, { line: "hello" });
    expect(cacheGet(key)?.line).toBe("hello");
  });
});

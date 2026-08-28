import { describe, expect, it } from "vitest";

import { resolveTick, tick } from "./tick";
import type { WorldState } from "./types";

function world(): WorldState {
  return {
    turn: 0,
    clock: "Day 1 - 09:00",
    rngSeed: 7,
    scene: {
      location: "courtyard",
      presentCharacters: ["you", "alice", "bob", "dana"],
    },
    characters: Object.fromEntries(
      ["you", "alice", "bob", "dana"].map((id) => [
        id,
        {
          id,
          name: id,
          traits: [],
          state: { mood: "neutral", emotions: {} },
          relationships: {},
          memories: [],
          beliefs: [],
          goals: [],
        },
      ]),
    ),
  };
}

describe("multi-actor tick contracts", () => {
  it("allows different actors to act in the same tick", () => {
    const result = resolveTick(
      world(),
      [
        { id: "Greet", actor: "you", target: "alice" },
        { id: "Greet", actor: "bob", target: "dana" },
      ],
      { playerId: "you" },
    );

    expect(result.log.map(({ move }) => move.actor)).toEqual(["you", "bob"]);
    expect(new Set(result.events.map((event) => event.id)).size).toBe(2);
    expect(result.state.turn).toBe(1);
  });

  it("rejects a second move by the same actor", () => {
    const startingWorld = world();

    expect(() =>
      resolveTick(startingWorld, [
        { id: "Greet", actor: "alice", target: "you" },
        { id: "AskForHelp", actor: "alice", target: "bob" },
      ]),
    ).toThrow("alice proposed more than one move");

    expect(startingWorld.turn).toBe(0);
  });

  it("can advance the autonomous world without a player move", () => {
    const result = tick(
      world(),
      undefined,
      [{ id: "Talk", actor: "bob", target: "alice" }],
    );

    expect(result.log).toHaveLength(1);
    expect(result.log[0].move.actor).toBe("bob");
    expect(result.state.turn).toBe(1);
  });
});

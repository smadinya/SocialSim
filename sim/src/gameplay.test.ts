import { describe, expect, it } from "vitest";

import { selectNpcMoves } from "./behavior/utility";
import { cleanupStaleConversations } from "./conversations";
import { previousRelationshipLabels, relationshipLabels } from "./relationships";
import { transitionRequest } from "./requests";
import { normalizeWorldState } from "./world/normalize";
import { resolveTick, tick } from "./tick";
import type { SimEvent, WorldState } from "./types";

function world(): WorldState {
  const ids = ["you", "alice", "bob", "dana"];
  const characters = Object.fromEntries(ids.map((id) => [id, {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    traits: id === "alice" ? ["loyal"] : [],
    state: { mood: "neutral", emotions: {} },
    relationships: Object.fromEntries(ids.filter((other) => other !== id).map((other) => [other, {
      trust: 50,
      gratitude: 20,
      affection: 50,
      respect: 50,
      fear: 5,
      anger: 5,
      jealousy: 0,
      hate: 0,
    }])),
    memories: [],
    beliefs: [],
    goals: id === "alice" ? ["help friends"] : [],
  }]));
  return {
    turn: 0,
    clock: "Day 1 - 09:00",
    rngSeed: 17,
    scene: { location: "courtyard", presentCharacters: ids },
    characters,
  };
}

describe("conversation state", () => {
  it("normalizes legacy saves and permits non-overlapping conversations", () => {
    const normalized = normalizeWorldState(world());
    expect(normalized.conversations).toEqual({});
    expect(normalized.socialRequests).toEqual({});
    expect(normalized.obligations).toEqual({});
    expect(normalized.characters.alice.relationships.bob.baseline?.trust).toBe(50);

    const result = resolveTick(normalized, [
      { id: "Talk", actor: "alice", target: "bob" },
      { id: "Talk", actor: "you", target: "dana" },
    ]);
    expect(Object.values(result.state.conversations ?? {}).filter((item) => item.status === "active"))
      .toHaveLength(2);
  });

  it("rejects overlap and pauses a conversation after departure", () => {
    expect(() => resolveTick(world(), [
      { id: "Talk", actor: "alice", target: "bob" },
      { id: "Talk", actor: "you", target: "bob" },
    ])).toThrow();

    const started = resolveTick(world(), [{ id: "Talk", actor: "alice", target: "bob" }]).state;
    started.scene.presentCharacters = ["you", "alice", "dana"];
    cleanupStaleConversations(started);
    expect(Object.values(started.conversations ?? {})[0].status).toBe("paused");
    started.turn = 6;
    cleanupStaleConversations(started);
    expect(Object.values(started.conversations ?? {})[0].status).toBe("ended");
  });

  it("allows an explicit interruption by pausing the old conversation", () => {
    const started = resolveTick(world(), [
      { id: "Talk", actor: "alice", target: "bob" },
    ]).state;
    const switched = resolveTick(started, [{
      id: "Greet",
      actor: "alice",
      target: "dana",
      args: { interruptConversation: true },
    }]).state;
    const conversations = Object.values(switched.conversations ?? {});
    expect(conversations.find((item) => item.participants.includes("bob"))?.status)
      .toBe("paused");
    expect(conversations.find((item) => item.status === "active")?.participants)
      .toEqual(expect.arrayContaining(["alice", "dana"]));
  });

  it("gives the addressed partner an immediate same-round follow-up", () => {
    const result = tick(
      world(),
      { id: "Greet", actor: "you", target: "alice" },
      [],
      { playerId: "you" },
    );
    expect(result.log.map((entry) => entry.move.actor)).toEqual(["you", "alice"]);
    expect(result.log[1].move.args?.sameRoundFollowUp).toBe(true);
    const conversation = Object.values(result.state.conversations ?? {})[0];
    expect(conversation.expectedResponder).toBe("you");
  });

  it("removes a withdrawn character and returns them five turns later", () => {
    let result = resolveTick(world(), [{ id: "Withdraw", actor: "bob" }]);
    expect(result.state.scene.presentCharacters).not.toContain("bob");
    expect(result.events.some((event) => event.type === "departure")).toBe(true);

    result = resolveTick(result.state, [{ id: "Wait", actor: "you" }]);
    expect(result.state.scene.presentCharacters).not.toContain("bob");
    result = resolveTick(result.state, [{ id: "Wait", actor: "you" }]);
    expect(result.state.scene.presentCharacters).not.toContain("bob");
    result = resolveTick(result.state, [{ id: "Wait", actor: "you" }]);
    expect(result.state.scene.presentCharacters).not.toContain("bob");
    result = resolveTick(result.state, [{ id: "Wait", actor: "you" }]);
    expect(result.state.scene.presentCharacters).not.toContain("bob");
    result = resolveTick(result.state, [{ id: "Wait", actor: "you" }]);
    expect(result.state.scene.presentCharacters).toContain("bob");
    expect(result.events.some((event) => event.type === "arrival" && event.actor === "bob"))
      .toBe(true);
  });

  it("brings an unscheduled off-scene character into the scene", () => {
    const state = world();
    state.scene.presentCharacters = ["you", "alice", "dana"];
    const result = resolveTick(
      state,
      [{ id: "Wait", actor: "you" }],
      { playerId: "you" },
    );
    expect(result.state.scene.presentCharacters).toContain("bob");
    expect(result.events.some((event) => event.type === "arrival" && event.actor === "bob"))
      .toBe(true);
  });
});

describe("requests and obligations", () => {
  it("keeps acceptance distinct from later fulfillment", () => {
    const asked = resolveTick(world(), [
      { id: "AskForHelp", actor: "alice", target: "bob", args: { subject: "find the key" } },
    ]).state;
    const request = Object.values(asked.socialRequests ?? {})[0];
    expect(request.status).toBe("pending");

    const accepted = resolveTick(asked, [{
      id: "Comply",
      actor: "bob",
      target: "alice",
      args: { replyToRequestId: request.id, conversationId: request.conversationId },
    }]).state;
    expect(accepted.socialRequests?.[request.id].status).toBe("accepted");
    expect(accepted.obligations?.[`obligation-${request.id}`].status).toBe("active");

    const fulfilledResult = resolveTick(accepted, [{
      id: "Help",
      actor: "bob",
      target: "alice",
      args: { replyToRequestId: request.id, conversationId: request.conversationId },
    }]);
    const fulfilled = fulfilledResult.state;
    expect(fulfilled.socialRequests?.[request.id].status).toBe("fulfilled");
    expect(fulfilled.obligations?.[`obligation-${request.id}`].status).toBe("fulfilled");
    expect(fulfilled.scene.presentCharacters).not.toContain("bob");
    expect(fulfilled.scene.departures?.bob.returnTurn).toBe(8);
    expect(fulfilledResult.events.some((event) =>
      event.type === "departure" && event.actor === "bob"
    )).toBe(true);
  });

  it("schedules an NPC who asks for help to leave for five turns", () => {
    const result = resolveTick(
      world(),
      [{ id: "AskForHelp", actor: "alice", target: "you" }],
      { playerId: "you" },
    );
    expect(result.state.scene.presentCharacters).not.toContain("alice");
    expect(result.state.scene.departures?.alice.returnTurn).toBe(6);
    expect(Object.values(result.state.socialRequests ?? {})[0].status).toBe("pending");
    expect(result.events.some((event) => event.type === "departure" && event.actor === "alice"))
      .toBe(true);
  });

  it("keeps Robin present when the player asks for help", () => {
    const result = resolveTick(
      world(),
      [{ id: "AskForHelp", actor: "you", target: "alice" }],
      { playerId: "you" },
    );
    expect(result.state.scene.presentCharacters).toContain("you");
    expect(result.state.scene.departures?.you).toBeUndefined();
  });

  it("keeps the player present when they provide help", () => {
    const result = resolveTick(
      world(),
      [{ id: "Help", actor: "you", target: "alice" }],
      { playerId: "you" },
    );
    expect(result.state.scene.presentCharacters).toContain("you");
    expect(result.state.scene.departures?.you).toBeUndefined();
  });
});

describe("relationship history and memory", () => {
  it("records the causing event and promotes observer-scoped beat memories", () => {
    const state = world();
    state.characters.bob.relationships.alice.trust = 75;
    state.characters.bob.relationships.alice.affection = 65;
    state.characters.bob.relationships.alice.respect = 60;
    const result = resolveTick(state, [{ id: "Insult", actor: "alice", target: "bob" }]);
    const relationship = result.state.characters.bob.relationships.alice;
    expect(relationship.history?.some((entry) => entry.eventId === result.events[0].id)).toBe(true);
    expect(relationship.lastDelta).toBeDefined();
    expect(relationshipLabels(relationship)).not.toContain("friend");
    expect(previousRelationshipLabels(relationship)).toContain("friend");
    expect(relationship.flags).toContain("former-friend");
    expect(Object.keys(relationship.lastDelta ?? {})).toEqual(
      expect.arrayContaining(["affection", "respect", "anger", "hate"]),
    );
    for (const id of result.events[0].OnScene) {
      expect(result.state.characters[id].memories.some((memory) => memory.eventId === result.events[0].id))
        .toBe(true);
    }
  });
});

describe("deterministic behavior selection", () => {
  it("prioritizes a pending direct reply and explains the decision", () => {
    const state = normalizeWorldState(world());
    state.conversations!["conversation-1-alice-bob"] = {
      id: "conversation-1-alice-bob",
      participants: ["alice", "bob"],
      location: state.scene.location,
      status: "active",
      startedTurn: 0,
      lastActiveTurn: 0,
      currentSpeaker: "alice",
      expectedResponder: "bob",
      primaryTopic: { kind: "AskForHelp", summary: "Alice needs help", salience: 0.8 },
      secondaryTopics: [],
      summary: "Alice asked Bob for help.",
      recentTurns: [],
      pendingRequestIds: ["request-1"],
    };
    state.socialRequests!["request-1"] = {
      id: "request-1",
      conversationId: "conversation-1-alice-bob",
      requester: "alice",
      recipient: "bob",
      subject: "find the key",
      createdTurn: 0,
      importance: 0.8,
      status: "pending",
    };
    const first = selectNpcMoves(state, { playerId: "alice", maxActors: 1 });
    const second = selectNpcMoves(state, { playerId: "alice", maxActors: 1 });
    expect(first).toEqual(second);
    expect(first.traces[0].branch).toBe("reply");
    expect(first.traces[0].reasons.length).toBeGreaterThan(0);
    expect(first.moves[0].args?.replyToRequestId).toBe("request-1");
    expect(first.traces[0].alternatives.map((item) => item.move.id)).not.toContain("Ask");
  });

  it("supports every explicit request outcome transition", () => {
    const event: SimEvent = {
      id: "event-1",
      turn: 1,
      type: "move",
      actor: "bob",
      target: "alice",
      description: "test",
      OnScene: [],
    };
    const statuses = [
      "accepted",
      "refused",
      "clarification_requested",
      "delayed",
      "fulfilled",
      "failed",
      "withdrawn",
    ] as const;
    for (const status of statuses) {
      const state = normalizeWorldState(world());
      state.socialRequests!["request-1"] = {
        id: "request-1",
        conversationId: "conversation-1",
        requester: "alice",
        recipient: "bob",
        subject: "test",
        createdTurn: 0,
        importance: 0.5,
        status: "pending",
      };
      expect(transitionRequest(state, "request-1", status, event).status).toBe(status);
    }
  });
});

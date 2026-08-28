import { describe, expect, it } from "vitest";
import fixtureData from "@/fixtures/world.json";
import { normalizeWorldState } from "@sim/world/normalize";
import { resolveTick } from "@sim/tick";
import type { WorldFixture } from "./viewTypes";
import { linkMoveToPlayerRequest, openRequestsForPlayer } from "./requestMoves";

function worldWithRequest(status: "pending" | "accepted" | "refused" = "pending") {
  const fixture = structuredClone(fixtureData) as unknown as WorldFixture;
  const { playerId, ...rawWorld } = fixture;
  const world = normalizeWorldState(rawWorld);
  world.socialRequests!["request-1"] = {
    id: "request-1",
    conversationId: "conversation-request-1",
    requester: "alice",
    recipient: playerId,
    subject: "find the missing key",
    createdTurn: world.turn,
    importance: 0.8,
    status,
  };
  return { world, playerId };
}

describe("player request actions", () => {
  it("links Refuse to an inbound request and closes it", () => {
    const { world, playerId } = worldWithRequest();
    const move = linkMoveToPlayerRequest(
      { id: "Refuse", actor: playerId, target: "alice" },
      world,
      playerId,
    );
    expect(move.args?.replyToRequestId).toBe("request-1");

    const result = resolveTick(world, [move], { playerId });
    expect(result.state.socialRequests?.["request-1"].status).toBe("refused");
    expect(openRequestsForPlayer(result.state, playerId)).toHaveLength(0);
  });

  it("links Help to an accepted request so it can be fulfilled", () => {
    const { world, playerId } = worldWithRequest("accepted");
    const move = linkMoveToPlayerRequest(
      { id: "Help", actor: playerId, target: "alice" },
      world,
      playerId,
    );
    const result = resolveTick(world, [move], { playerId });
    expect(result.state.socialRequests?.["request-1"].status).toBe("fulfilled");
    expect(openRequestsForPlayer(result.state, playerId)).toHaveLength(0);
  });

  it("does not show terminal requests as open", () => {
    const { world, playerId } = worldWithRequest("refused");
    expect(openRequestsForPlayer(world, playerId)).toHaveLength(0);
  });
});

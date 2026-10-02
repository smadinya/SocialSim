import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingUtterance, WorldState } from "@sim/types";
import deep from "./fixtures/deep-world.json";

/**
 * B-15. The API's latency is bimodal — ~1s or ~28s — and a retried timeout
 * doubled the bad case into 30s of frozen UI that ended on a fallback line
 * anyway. `isRetryable` is now an allow-list: 503 only.
 */

const calls = vi.fn();

vi.mock("@ai/client", async () => {
  const actual = await vi.importActual<typeof import("@ai/client")>("@ai/client");
  return {
    ...actual,
    mockMode: () => false,
    generateJson: (...args: unknown[]) => calls(...args),
  };
});

const { TimeoutError } = await import("@ai/client");
const { realize } = await import("@ai/realize");
const { cacheClear } = await import("@ai/cache");
const { toPendingUtterance } = await import("@ai/adapt");
const { fallbackLine } = await import("@ai/fallbacks");

const world = deep as unknown as WorldState;
const u: PendingUtterance = toPendingUtterance(world, {
  move: { id: "Confront", actor: "alice", target: "bob" },
  witnessedByPlayer: true,
});

describe("retry policy", () => {
  beforeEach(() => {
    calls.mockReset();
    cacheClear();
  });

  it("does not retry a timeout, and falls back after one call", async () => {
    calls.mockRejectedValue(new TimeoutError(6000));
    const result = await realize(u);
    expect(calls).toHaveBeenCalledTimes(1);
    expect(result.line).toBe(fallbackLine(u));
  });

  it("retries a 503 once", async () => {
    calls.mockRejectedValue(new Error("503 Service Unavailable: model overloaded"));
    await realize(u);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("does not retry a malformed request", async () => {
    calls.mockRejectedValue(new Error("400 Bad Request"));
    await realize(u);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("uses the line when the call works", async () => {
    calls.mockResolvedValue({ line: "You lied to me, Bob." });
    const result = await realize(u);
    expect(result.line).toBe("You lied to me, Bob.");
    expect(calls).toHaveBeenCalledTimes(1);
  });
});

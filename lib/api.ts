import type {
  CharacterId,
  InterpretResult,
  Move,
  MoveId,
  TickResult,
  WorldState,
} from "./viewTypes";

/** "live" = lines came from the model, "mock" = the server has no key either. */
export type AiMode = "live" | "mock";

export async function postTurn(
  world: WorldState,
  playerId: CharacterId,
  move: Move,
): Promise<{ result: TickResult; mode: AiMode }> {
  const res = await fetch("/api/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ world, playerId, move }),
  });
  if (!res.ok) throw new Error("turn request failed");
  return {
    result: (await res.json()) as TickResult,
    mode: res.headers.get("x-ai-mode") === "mock" ? "mock" : "live",
  };
}

export async function postInterpret(
  input: string,
  actor: CharacterId,
  legal: MoveId[],
  world: WorldState,
): Promise<InterpretResult> {
  const res = await fetch("/api/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, actor, legal, world }),
  });
  if (!res.ok) throw new Error("interpret request failed");
  return (await res.json()) as InterpretResult;
}

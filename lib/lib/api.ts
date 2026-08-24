import type {
  CharacterId,
  InterpretResult,
  Move,
  MoveId,
  TickResult,
  WorldState,
} from "./viewTypes";

export async function postTurn(
  world: WorldState,
  playerId: CharacterId,
  move: Move,
): Promise<TickResult> {
  const res = await fetch("/api/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ world, playerId, move }),
  });
  if (!res.ok) throw new Error("turn request failed");
  return (await res.json()) as TickResult;
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

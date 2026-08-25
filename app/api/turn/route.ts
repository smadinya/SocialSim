import { NextResponse } from "next/server";
import type { CharacterId, Move, WorldState } from "@/lib/viewTypes";
import { runTick } from "@/lib/mockEngine";
import { tick as simTick } from "@sim/tick";

interface TurnBody {
  world: WorldState;
  playerId: CharacterId;
  move: Move;
}

export async function POST(request: Request) {
  const body = (await request.json()) as TurnBody;

  try {
    simTick(body.world, body.move);
  } catch {
    void 0;
  }

  const result = runTick(body.world, body.playerId, body.move);
  return NextResponse.json(result);
}

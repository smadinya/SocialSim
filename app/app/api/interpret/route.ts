import { NextResponse } from "next/server";
import type { CharacterId, MoveId, WorldState } from "@/lib/viewTypes";
import { interpretInput } from "@/lib/interpret";
import { getLegalMoves } from "@sim/moves/legalMoves";

interface InterpretBody {
  input: string;
  actor: CharacterId;
  legal?: MoveId[];
  world: WorldState;
}

export async function POST(request: Request) {
  const body = (await request.json()) as InterpretBody;
  const legal = getLegalMoves(body.actor, body.world).map(
    (m) => m.id as MoveId,
  );
  const result = interpretInput(body.input, body.actor, legal, body.world);
  return NextResponse.json(result);
}

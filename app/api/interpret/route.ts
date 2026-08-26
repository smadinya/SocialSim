import { NextResponse } from "next/server";
import type { CharacterId, MoveId, WorldState } from "@/lib/viewTypes";
import { getLegalMoves } from "@sim/moves/legalMoves";
import { beginTick, endTick, interpret } from "@ai/index";

interface InterpretBody {
  input: string;
  actor: CharacterId;
  legal?: MoveId[];
  world: WorldState;
}

/**
 * Nobody types a move in more than a sentence or two. A 2000-character input
 * was billed as tokens and came back as a `Withdraw`; truncating costs nothing
 * a real player will notice.
 */
const MAX_INPUT = 300;

export async function POST(request: Request) {
  const body = (await request.json()) as InterpretBody;

  const input = (body.input ?? "").trim().slice(0, MAX_INPUT);
  if (!input) {
    return NextResponse.json({
      move: { id: "Withdraw", actor: body.actor },
      understoodAs: "Type something first.",
      ok: false,
    });
  }

  const legal = getLegalMoves(body.actor, body.world).map(
    (m) => m.id as MoveId,
  );
  beginTick();
  const result = await interpret(input, body.actor, legal, body.world);
  const cost = endTick();
  if (cost.calls > 0) {
    console.info(
      `[ai] interpret: ${cost.calls} calls, ${cost.tokens} tokens, ${cost.ms}ms`,
    );
  }

  return NextResponse.json(result);
}

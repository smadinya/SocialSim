import { NextResponse } from "next/server";
import type { CharacterId, Move, WorldState } from "@/lib/viewTypes";
import { beginTick, endTick, mockMode, realize, toPendingUtterance, worstTick } from "@ai/index";
import { runSimTick } from "@/lib/simEngine";

interface TurnBody {
  world: WorldState;
  playerId: CharacterId;
  move: Move;
}

export async function POST(request: Request) {
  const body = (await request.json()) as TurnBody;

  const result = runSimTick(body.world, body.playerId, body.move);

  // The realization seam, route-side until Track A/C split it out of the
  // engine: `runSimTick` fills `Utterance.line` with a stub, and every witnessed
  // line is replaced here with a realized one. `ai/adapt.ts` is what makes
  // that possible against today's `WorldState`.
  //
  // COST POLICY: only witnessed moves get a call — which is what the engine
  // already does for free, since unwitnessed moves emit no utterance at all.
  // `result.utterances` and the witnessed entries of `result.log` are in the
  // same resolution order, so they pair by index.
  const witnessed = result.log.filter((r) => r.witnessedByPlayer);

  beginTick();
  await Promise.all(
    result.utterances.map(async (utterance, i) => {
      const resolved = witnessed[i];
      // If the pairing ever stops holding, keep the engine's stub line rather
      // than realizing the wrong move against the right speaker.
      if (
        !resolved ||
        resolved.move.actor !== utterance.speaker ||
        resolved.move.id !== utterance.moveId
      ) {
        return;
      }
      const realized = await realize(
        toPendingUtterance(result.state, resolved, result.deltas),
      );
      utterance.line = realized.line;
      if (realized.deliveryNote) utterance.deliveryNote = realized.deliveryNote;
    }),
  );
  const cost = endTick();

  // Per tick, not per call. Today's ceiling is three moves; re-measure when
  // Track A lifts `runTick`'s two-NPC cap.
  if (cost.calls > 0) {
    const worst = worstTick();
    console.info(
      `[ai] tick ${result.state.turn}: ${cost.calls} calls, ${cost.tokens} tokens, ${cost.ms}ms` +
        ` (worst so far: ${worst.calls} calls, ${worst.tokens} tokens, ${worst.ms}ms)`,
    );
  }

  // With no `GEMINI_API_KEY` the route still answers 200 with stub lines, so
  // "server: on" alone tells the player nothing about what they're reading.
  // Same channel B-15 will use to flag a per-tick fallback.
  return NextResponse.json(result, {
    headers: { "x-ai-mode": mockMode() ? "mock" : "live" },
  });
}

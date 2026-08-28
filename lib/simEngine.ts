import { tick } from "@sim/tick";
import type { CharacterId, Move, TickResult, WorldState } from "./viewTypes";
import { stubDialogue } from "./moveMeta";

/** UI-compatible adapter around the authoritative simulation tick. */
export function runSimTick(
  world: WorldState,
  playerId: CharacterId,
  playerMove?: Move,
): TickResult {
  const interruptibleMove = playerMove?.target
    ? {
        ...playerMove,
        args: { ...playerMove.args, interruptConversation: true },
      }
    : playerMove;
  const result = tick(world, interruptibleMove, undefined, { playerId });
  result.utterances = result.log
    .filter((resolved) => resolved.witnessedByPlayer)
    .map((resolved) => ({
      speaker: resolved.move.actor,
      moveId: resolved.move.id,
      line: stubDialogue(
        resolved.move.id,
        resolved.move.target
          ? result.state.characters[resolved.move.target]?.name
          : undefined,
      ),
    }));
  return result;
}

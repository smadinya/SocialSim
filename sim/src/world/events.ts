import type {
  Move,
  SimEvent,
  WorldState,
} from "../types";

export function createMoveEvent(
  world: WorldState,
  move: Move,
): SimEvent {
  return {
    id: `event-${world.turn + 1}-${move.actor}-${move.id}`,
    type: "move",
    turn: world.turn + 1,

    actor: move.actor,
    target: move.target,

    description:
      `${move.actor} performed ${move.id}`,

    OnScene: []
  };
}

import type {
  CharacterId,
  Move,
  WorldState,
} from "../types";

import { MOVE_IDS } from "./catalog";

export function getEligibleActors(world: WorldState): CharacterId[] {
  return world.scene.presentCharacters.filter((id) => Boolean(world.characters[id]));
}

/**
 * TODO:
 * move preconditions.
 */
export function getLegalMoves(
  actor: CharacterId,
  world: WorldState,
): Move[] {
  void world;

  return MOVE_IDS.map((id) => ({
    id,
    actor,
  }));
}

/**
 * TODO:
 * move validation.
 */
export function isLegalMove(
  move: Move,
  world: WorldState,
): boolean {
  void world;

  return typeof move.id === "string" && move.id.length > 0;
}
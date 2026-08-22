import type {
  CharacterId,
  SimEvent,
  WorldState,
} from "../types";

export function determineObservers(
  event: SimEvent,
  world: WorldState,
): CharacterId[] {
  
  // TODO:
  // actual perception rules:
  // - location
  // - visibility
  // - hearing
  // - private conversation
  // etc.

  return [...world.scene.presentCharacters];
}

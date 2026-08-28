import type {
  CharacterId,
  SimEvent,
  WorldState,
} from "../types";

/**
 * Who saw it happen.
 *
 * This returned `[...scene.presentCharacters]` unconditionally while there was
 * only one room and no privacy rule, so it could not distinguish anything.
 * With locations it has real work: you observe what happens where you are
 * standing, and a `private` location is not overheard from outside it.
 */
export function determineObservers(
  event: SimEvent,
  world: WorldState,
): CharacterId[] {
  const actor = event.actor;
  const where = actor ? world.characters[actor]?.location : undefined;
  if (!where) return [...world.scene.presentCharacters];

  const observers = Object.keys(world.characters).filter(
    (id) => world.characters[id].location === where,
  );

  // A private room hides nothing from the people inside it — only from
  // everyone else, which the location filter above already handles. The flag
  // exists so a future "overheard from the next room" tier has something to
  // check; until then the two branches agree by construction.
  if (world.locations[where]?.private) return observers;

  return observers;
}

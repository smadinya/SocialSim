import type { WorldState } from "../types";
import { normalizeRelationship } from "../relationships";

/** Migrates legacy fixtures/saves without mutating the caller's object. */
export function normalizeWorldState(world: WorldState): WorldState {
  const next = structuredClone(world);
  next.conversations ??= {};
  next.socialRequests ??= {};
  next.obligations ??= {};
  next.scene.departures ??= {};

  for (const character of Object.values(next.characters)) {
    for (const other of Object.keys(character.relationships)) {
      character.relationships[other] = normalizeRelationship(
        character.relationships[other],
      );
    }
  }
  return next;
}

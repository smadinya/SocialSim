import type {
  Character,
  CharacterId,
  Move,
  Memory,
  WorldState,
} from "../types";

import {
  MOVE_IDS,
  isKnownMoveId,
  moveNeedsTarget,
} from "./catalog";

export function getEligibleActors(world: WorldState): CharacterId[] {
  return world.scene.presentCharacters.filter((id) => {
    const character = world.characters[id];
    return Boolean(character && character.state);
  });
}

export interface DecisionContext {
  actor: CharacterId;
  relationships: Record<CharacterId, Character["relationships"][CharacterId]>;
  beliefs: Character["beliefs"];
  memories: Memory[];
  legalMoves: Move[];
}

export function buildDecisionContext(
  actor: CharacterId,
  world: WorldState,
): DecisionContext {
  const character = world.characters[actor];

  const legalMoves = getLegalMoves(actor, world);
  const memories = [...(character?.memories ?? [])].sort((a, b) => b.turn - a.turn).slice(0, 5);

  return {
    actor,
    relationships: { ...(character?.relationships ?? {}) },
    beliefs: [...(character?.beliefs ?? [])],
    memories,
    legalMoves,
  };
}

/**
 * TODO:
 * move preconditions.
 */
export function getLegalMoves(
  actor: CharacterId,
  world: WorldState,
): Move[] {
  if (!world.characters[actor]) return [];

  const targets = Object.keys(world.characters).filter((id) => id !== actor);
  const candidates = MOVE_IDS.flatMap((id): Move[] =>
    moveNeedsTarget(id)
      ? targets.map((target) => ({ id, actor, target }))
      : [{ id, actor }],
  );

  return candidates.filter((move) => isLegalMove(move, world));
}

/**
 * TODO:
 * move validation.
 */
export function isLegalMove(
  move: Move,
  world: WorldState,
): boolean {
  const actor = world.characters[move.actor];

  if (!actor) {
    return false;
  }

  if (!isKnownMoveId(move.id)) {
    return false;
  }

  if (moveNeedsTarget(move.id)) {
    return Boolean(
      move.target &&
      move.target !== move.actor &&
      world.characters[move.target],
    );
  }

  return move.target === undefined;
}

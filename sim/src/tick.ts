import type {
  Move,
  SimEvent,
  WorldState,
} from "./types";

import {
  createMoveEvent,
} from "./world/events";

import {
  determineObservers,
} from "./world/perception";

import {
  getEligibleActors,
  isLegalMove,
} from "./moves/legalMoves";

export function resolveTick(
  world: WorldState,
  moves: Move[],
): {
  state: WorldState;
  events: SimEvent[];
  eligibleActors: string[];
} {
  const next = structuredClone(world);
  const events: SimEvent[] = [];

  for (const move of moves) {
    if (!isLegalMove(move, next)) {
      throw new Error(`Illegal move: ${move.id}`);
    }

    const event = createMoveEvent(next, move);
    event.OnScene = determineObservers(event, next);
    events.push(event);
  }

  next.turn += 1;

  return {
    state: next,
    events,
    eligibleActors: getEligibleActors(next),
  };
}

export function tick(
  world: WorldState,
  playerMove: Move,
  npcMoves: Move[] = [],
): {
  state: WorldState;
  events: SimEvent[];
  eligibleActors: string[];
} {
  return resolveTick(world, [playerMove, ...npcMoves]);
}
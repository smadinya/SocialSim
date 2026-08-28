import { relationshipValues } from "../relationships";
import type { CharacterId, SimEvent, WorldState } from "../types";

function socialPull(
  world: WorldState,
  actor: CharacterId,
  target: CharacterId,
): number {
  const character = world.characters[actor];
  const relationship = relationshipValues(character.relationships[target]);
  const targetName = world.characters[target]?.name.toLowerCase() ?? target;
  const memoryPull = character.memories
    .filter((memory) => memory.actor === target || memory.target === target)
    .reduce((sum, memory) => sum + memory.importance, 0) * 12;
  const goalPull = character.goals.some((goal) =>
    goal.toLowerCase().includes(target.toLowerCase()) ||
    goal.toLowerCase().includes(targetName),
  ) ? 15 : 0;
  return (
    Math.abs(relationship.trust - 50) * 0.25 +
    relationship.affection * 0.08 +
    relationship.respect * 0.05 +
    relationship.fear * 0.12 +
    relationship.anger * 0.18 +
    relationship.hate * 0.22 +
    memoryPull +
    goalPull
  );
}

/** Picks at most one unscheduled off-scene character, deterministically. */
export function pickAmbientArrival(
  world: WorldState,
  playerId?: CharacterId,
): CharacterId | undefined {
  const present = new Set(world.scene.presentCharacters);
  const scheduled = world.scene.departures ?? {};
  return Object.keys(world.characters)
    .filter((id) => id !== playerId && !present.has(id) && !scheduled[id])
    .map((id) => ({
      id,
      score: Math.max(
        0,
        ...world.scene.presentCharacters.map((target) => socialPull(world, id, target)),
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0]?.id;
}

/** Resolves scheduled returns first, otherwise one ambient social arrival. */
export function resolveArrivals(
  world: WorldState,
  playerId?: CharacterId,
): SimEvent[] {
  const events: SimEvent[] = [];
  const eventTurn = world.turn + 1;
  for (const [characterId, departure] of Object.entries(world.scene.departures ?? {})) {
    if (eventTurn < departure.returnTurn || !world.characters[characterId]) continue;
    if (!world.scene.presentCharacters.includes(characterId)) {
      world.scene.presentCharacters.push(characterId);
    }
    delete world.scene.departures![characterId];
    events.push({
      id: `event-${eventTurn}-${characterId}-return`,
      turn: eventTurn,
      type: "arrival",
      actor: characterId,
      description: `${world.characters[characterId].name} returned to ${departure.location}.`,
      OnScene: [...world.scene.presentCharacters],
    });
  }

  if (events.length === 0) {
    const arriving = pickAmbientArrival(world, playerId);
    if (arriving) {
      world.scene.presentCharacters.push(arriving);
      events.push({
        id: `event-${eventTurn}-${arriving}-arrival`,
        turn: eventTurn,
        type: "arrival",
        actor: arriving,
        description: `${world.characters[arriving].name} stepped into the scene.`,
        OnScene: [...world.scene.presentCharacters],
      });
    }
  }
  return events;
}

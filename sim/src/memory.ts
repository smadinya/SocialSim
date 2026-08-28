import type { Conversation, Move, SimEvent, WorldState } from "./types";

const IMPORTANCE: Record<string, number> = {
  Fight: 0.9,
  Confront: 0.7,
  RevealSecret: 0.7,
  SpreadRumor: 0.7,
  AskForHelp: 0.6,
  Help: 0.7,
  Defend: 0.6,
};

export function promoteConversationBeat(
  world: WorldState,
  move: Move,
  event: SimEvent,
  conversation?: Conversation,
): void {
  if (move.id === "Wait") return;
  const actorName = world.characters[move.actor]?.name ?? move.actor;
  const targetName = move.target
    ? world.characters[move.target]?.name ?? move.target
    : "the scene";
  for (const observer of event.OnScene) {
    const character = world.characters[observer];
    if (!character) continue;
    const direct = observer === move.actor || observer === move.target;
    const importance = (IMPORTANCE[move.id] ?? 0.4) * (direct ? 1 : 0.6);
    character.memories.push({
      id: `memory-${event.id}-${observer}`,
      turn: event.turn,
      actor: move.actor,
      target: move.target,
      description: `${actorName} used ${move.id} with ${targetName}.`,
      tags: [move.id.toLowerCase(), move.actor, ...(move.target ? [move.target] : [])],
      importance,
      eventId: event.id,
      conversationId: conversation?.id,
      tier: direct ? "direct" : "overheard",
      valence: 0,
      accurate: true,
    });
    character.memories.sort((a, b) => b.importance - a.importance || b.turn - a.turn);
    character.memories = character.memories.slice(0, 30);
  }
}

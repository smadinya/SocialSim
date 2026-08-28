import type {
  CharacterId,
  Move,
  PendingUtterance,
  Relationship,
  RelationshipAxis,
  WorldState,
} from "@sim/types";
import type { RelationshipDelta, ResolvedMove } from "@/lib/viewTypes";
import { RELATIONSHIP_AXES } from "@sim/types";
import type { RelationshipValues } from "@sim/types";
import { retrieve } from "@ai/retrieval";
import { beatLines } from "@/lib/conversations";

/**
 * `WorldState` -> `PendingUtterance`.
 *
 * This file used to be a shim that defaulted in every field `sim/src/types.ts`
 * didn't carry yet — `valence`, `tier`, `accurate`, `baseline`, `flags`,
 * `Belief.subject`. Update 1 landed all of them, `ai/types.ts` is deleted, and
 * the defaulting is gone with it. What's left is selection: deciding what a
 * speaker is allowed to know when they open their mouth.
 */

function nameOf(world: WorldState, id?: CharacterId): string | undefined {
  if (!id) return undefined;
  return world.characters[id]?.name || id;
}

/**
 * `lastDelta` is written by the engine's effect pass now, but the tick's own
 * deltas are more precise: they are scoped to this move rather than to
 * everything that touched the pair this turn.
 */
function deltaFor(
  deltas: RelationshipDelta[],
  from: CharacterId,
  to?: CharacterId,
): Partial<Record<RelationshipAxis, number>> {
  if (!to) return {};
  const out: Partial<Record<RelationshipAxis, number>> = {};
  for (const d of deltas) {
    if (d.from === from && d.to === to) {
      out[d.field as RelationshipAxis] = d.after - d.before;
    }
  }
  return out;
}

const ZEROED = Object.fromEntries(
  RELATIONSHIP_AXES.map((axis) => [axis, 0]),
) as RelationshipValues;

const EMPTY: Relationship = {
  ...ZEROED,
  baseline: { ...ZEROED },
  lastDelta: {},
  flags: [],
  history: [],
};

export function toPendingUtterance(
  world: WorldState,
  resolved: ResolvedMove,
  deltas: RelationshipDelta[] = [],
): PendingUtterance {
  const move: Move = resolved.move;
  const speaker = world.characters[move.actor];
  const retrieved = retrieve(speaker?.memories ?? [], move, move.actor, world.turn);

  const stored = move.target ? speaker?.relationships?.[move.target] : undefined;
  const tickDelta = deltaFor(deltas, move.actor, move.target);
  const relationshipSnapshot: Relationship = stored
    ? {
        ...stored,
        lastDelta: Object.keys(tickDelta).length ? tickDelta : stored.lastDelta,
      }
    : EMPTY;

  const conversation = resolved.threadId
    ? world.threads[resolved.threadId]
    : null;

  // The topic LABEL only. Evidence never reaches a prompt: it is the one
  // piece of third-party ground truth in the world, and a speaker who has not
  // been told a fact must not be able to say it.
  const topicLabel = conversation?.topicId
    ? world.topics[conversation.topicId]?.label
    : undefined;

  return {
    speaker: move.actor,
    move,
    mood: speaker?.state?.mood ?? "neutral",
    relationshipSnapshot,
    speakerBeliefs: speaker?.beliefs ?? [],
    retrievedMemories: retrieved,
    witnessedByPlayer: resolved.witnessedByPlayer,
    turn: world.turn,
    speakerName: speaker?.name ?? move.actor,
    traits: speaker?.traits ?? [],
    targetName: nameOf(world, move.target),
    subjectName: nameOf(world, move.args?.subject as CharacterId | undefined),
    castNames: Object.keys(world.characters)
      .filter((id) => id !== move.actor)
      .map((id) => world.characters[id].name),
    topicLabel,
    threadBeats: beatLines(world, conversation),
    heat: conversation?.heat ?? 0,
  };
}

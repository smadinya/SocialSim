import type {
  Belief,
  CharacterId,
  Memory,
  Move,
  PendingUtterance,
  Relationship,
  RelationshipAxis,
  WorldState,
} from "@ai/types";
import type { RelationshipState } from "@sim/types";
import type { RelationshipDelta, ResolvedMove } from "@/lib/viewTypes";
import { REL_FIELDS } from "@/lib/format";
import { relationshipValues } from "@sim/relationships";
import { retrieve } from "@ai/retrieval";

/**
 * The shim. Reads what `WorldState` has *today* and defaults what G0 will add.
 *
 * When G0 lands, `ai/types.ts` is deleted and this file loses its defaulting —
 * nothing else in `ai/` changes.
 */

type LooseMemory = Omit<Memory, "valence" | "tier" | "accurate"> &
  Partial<Pick<Memory, "valence" | "tier" | "accurate">>;

type LooseBelief = Omit<Belief, "subject"> & Partial<Pick<Belief, "subject">>;

type LooseRelationship = RelationshipState &
  Partial<Pick<Relationship, "baseline" | "lastDelta" | "flags">>;

export function toMemory(m: LooseMemory): Memory {
  return {
    ...m,
    valence: m.valence ?? 0,
    tier: m.tier ?? "direct",
    accurate: m.accurate ?? true,
  };
}

function toBelief(b: LooseBelief, owner: CharacterId): Belief {
  // No `subject` until G0 (ask #6), so the false-belief test can't be written
  // yet. Defaulting to the owner keeps the type honest without inventing a
  // subject the data doesn't have.
  return { ...b, subject: b.subject ?? owner };
}

function toRelationship(
  rel: LooseRelationship | undefined,
  lastDelta: Partial<Record<RelationshipAxis, number>>,
): Relationship {
  const axes = relationshipValues(rel);
  const baseline = {} as Record<RelationshipAxis, number>;
  for (const f of REL_FIELDS) {
    // Legacy four-axis baselines inherit the normalized current value for any
    // newly introduced axis until Track A's decay pass starts persisting it.
    baseline[f] = rel?.baseline?.[f] ?? axes[f];
  }
  return {
    ...axes,
    baseline,
    // Track A's `lastDelta` wins once it carries anything; until then the
    // tick's own deltas fill it in.
    lastDelta: Object.keys(rel?.lastDelta ?? {}).length ? rel!.lastDelta! : lastDelta,
    flags: rel?.flags ?? [],
  };
}

/**
 * `Relationship.lastDelta` is Track A's (ask #4), but `TickResult.deltas`
 * already carries the same information for this tick, so the prompt gets its
 * "down from 44" clause today instead of waiting.
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
      out[d.field] = d.after - d.before;
    }
  }
  return out;
}

function nameOf(world: WorldState, id?: CharacterId): string | undefined {
  if (!id) return undefined;
  return world.characters[id]?.name || id;
}

export function toPendingUtterance(
  world: WorldState,
  resolved: ResolvedMove,
  deltas: RelationshipDelta[] = [],
): PendingUtterance {
  const move: Move = resolved.move;
  const speaker = world.characters[move.actor];
  const memories = (speaker?.memories ?? []).map(toMemory);
  const retrieved = retrieve(memories, move, move.actor, world.turn);
  const replyToRequestId = typeof move.args?.replyToRequestId === "string"
    ? move.args.replyToRequestId
    : undefined;
  const request = replyToRequestId
    ? world.socialRequests?.[replyToRequestId]
    : undefined;

  return {
    speaker: move.actor,
    move,
    mood: speaker?.state?.mood ?? "neutral",
    relationshipSnapshot: toRelationship(
      move.target ? speaker?.relationships?.[move.target] : undefined,
      deltaFor(deltas, move.actor, move.target),
    ),
    speakerBeliefs: (speaker?.beliefs ?? []).map((b) => toBelief(b, move.actor)),
    retrievedMemories: retrieved,
    witnessedByPlayer: resolved.witnessedByPlayer,
    turn: world.turn,
    speakerName: speaker?.name ?? move.actor,
    traits: speaker?.traits ?? [],
    targetName: nameOf(world, move.target),
    // `Move.args.subject` is filled by both interpreter paths. The engine
    // doesn't read it yet, so this is the only place it has an effect: the
    // speaker's line is about the right person.
    subjectName: nameOf(world, move.args?.subject as CharacterId | undefined),
    requestContext: request
      ? {
          requestId: request.id,
          requesterName: nameOf(world, request.requester) ?? request.requester,
          subject: request.subject,
          aboutName: nameOf(world, request.about),
        }
      : undefined,
    castNames: Object.keys(world.characters)
      .filter((id) => id !== move.actor)
      .map((id) => world.characters[id].name),
  };
}

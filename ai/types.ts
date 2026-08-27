/**
 * TODO(Track B): Shared engine contracts belong in `sim/src/types.ts`.
 * Delete this local mirror and repoint Track B imports after its prompt-only
 * metadata fields have an agreed home. This includes consuming every
 * authoritative relationship axis rather than maintaining a four-axis union.
 *
 * Delete this file at G0 and repoint the imports — `ai/adapt.ts` is the only
 * other file that has to change. This is a shim with a delete date, not an
 * abstraction layer.
 */
import type { CharacterId, Move, RelationshipAxis } from "@sim/types";

export type {
  CharacterId,
  Move,
  MoveId,
  RelationshipAxis,
  WorldState,
} from "@sim/types";

export type MemoryTier = "direct" | "overheard" | "told";

/** Prompt-ready view of every authoritative relationship axis. */
export interface Relationship {
  trust: number;
  gratitude: number;
  affection: number;
  respect: number;
  fear: number;
  anger: number;
  jealousy: number;
  hate: number;
  baseline: Record<RelationshipAxis, number>;
  lastDelta: Partial<Record<RelationshipAxis, number>>;
  flags: string[];
}

export interface Memory {
  id: string;
  turn: number;
  actor: CharacterId;
  target?: CharacterId;
  /** Templated by Track A — never generated. */
  description: string;
  tags: string[];
  importance: number;
  /** -1..1, how good or bad this was for the owner. New field at G0. */
  valence: number;
  tier: MemoryTier;
  /** false = planted by SpreadRumor. New field at G0. */
  accurate: boolean;
}

export interface Belief {
  id: string;
  subject: CharacterId;
  axis?: RelationshipAxis;
  description: string;
  confidence: number;
  sourceMemoryId?: string;
}

export interface PendingUtterance {
  speaker: CharacterId;
  move: Move;
  mood: string;
  relationshipSnapshot: Relationship;
  /** The speaker's view, which may be wrong. Never ground truth. */
  speakerBeliefs: Belief[];
  retrievedMemories: Memory[];
  witnessedByPlayer: boolean;

  // Extras the prompts need that the G0 draft doesn't carry. Names, traits and
  // the turn number only — never a third party's axis values. If G0 lands
  // without them, `adapt.ts` keeps filling them in and this stays a superset.
  turn: number;
  speakerName: string;
  traits: string[];
  targetName?: string;
  /** The third party in "tell X about Y" — talked about, never addressed. */
  subjectName?: string;
  /** Every character name in the world. The hallucination check tests these
   *  against the prompt that was actually sent — a name the prompt never
   *  mentioned is one the speaker cannot know. */
  castNames: string[];
}

export interface RealizedLine {
  line: string;
  deliveryNote?: string;
}

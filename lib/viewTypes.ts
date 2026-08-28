import type {
  CharacterId,
  Move,
  MoveId,
  RelationshipAxis,
  RelationshipState,
  SocialRequest,
  SimEvent,
  TickResult,
  WorldState,
} from "@sim/types";

export type {
  CharacterId,
  Character,
  Memory,
  Belief,
  Move,
  MoveId,
  RelationshipAxis,
  RelationshipDelta,
  RelationshipState,
  SocialRequest,
  ResolvedMove,
  SimEvent,
  TickResult,
  Utterance,
  WorldState,
} from "@sim/types";

/** Compatibility name used by UI components; values come from Track A. */
export type Relationship = RelationshipState;
export type RelationshipField = RelationshipAxis;

export interface WorldFixture extends WorldState {
  playerId: CharacterId;
}

export interface InterpretResult {
  move: Move;
  understoodAs: string;
  ok: boolean;
}

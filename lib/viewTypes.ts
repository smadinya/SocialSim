import type {
  CharacterId,
  Move,
  MoveId,
  RelationshipAxis,
  SimEvent,
  WorldState,
} from "@sim/types";

export type {
  CharacterId,
  Character,
  Conversation,
  ConversationTopic,
  ConversationTurn,
  Evidence,
  Location,
  LocationId,
  Memory,
  MemoryTier,
  Belief,
  Move,
  MoveId,
  PendingRequest,
  PendingUtterance,
  RealizedLine,
  Relationship,
  RelationshipAxis,
  RelationshipDelta,
  RelationshipEvent,
  RelationshipState,
  RelationshipStatus,
  RelationshipValues,
  ResolvedMove,
  ScenarioPhase,
  SimEvent,
  SocialRequest,
  Thread,
  ThreadBeat,
  ThreadId,
  TickResult,
  Topic,
  TopicId,
  Utterance,
  WorldState,
} from "@sim/types";

/**
 * The numeric axes. Deliberately NOT `keyof Relationship`: that type picked up
 * `baseline`, `lastDelta`, `flags` and `history` in update 1 and every
 * `rel[field]` read stopped being a number.
 */
export type RelationshipField = RelationshipAxis;

export interface WorldFixture extends WorldState {
  playerId: CharacterId;
}

export interface SceneLineSource {
  speaker: CharacterId;
  moveId: MoveId;
  line: string;
}

export interface InterpretResult {
  move: Move;
  understoodAs: string;
  ok: boolean;
}

export type { SimEvent as WorldEvent };
export type { Move as PlayerMove };

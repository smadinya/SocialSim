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
  ConversationBeat,
  ConversationId,
  Evidence,
  Location,
  LocationId,
  Memory,
  MemoryTier,
  Belief,
  Move,
  MoveId,
  PendingRequest,
  Relationship,
  RelationshipAxis,
  RelationshipEvent,
  RelationshipStatus,
  ScenarioPhase,
  SimEvent,
  Topic,
  TopicId,
  WorldState,
} from "@sim/types";

/**
 * The four — now five — numeric axes. Deliberately NOT `keyof Relationship`:
 * that type picked up `baseline`, `lastDelta`, `flags` and `history` in
 * update 1 and every `rel[field]` read stopped being a number.
 */
export type RelationshipField = RelationshipAxis;

export interface WorldFixture extends WorldState {
  playerId: CharacterId;
}

export interface Utterance {
  speaker: CharacterId;
  moveId: MoveId;
  line: string;
  deliveryNote?: string;
}

export interface ResolvedMove {
  move: Move;
  witnessedByPlayer: boolean;
  conversationId?: string;
}

export interface RelationshipDelta {
  sourceActor: CharacterId;
  from: CharacterId;
  to: CharacterId;
  field: RelationshipField;
  before: number;
  after: number;
  conversationId?: string;
}

export interface TickResult {
  state: WorldState;
  utterances: Utterance[];
  events: SimEvent[];
  log: ResolvedMove[];
  deltas: RelationshipDelta[];
  /** Events from the night pass, rendered as a "while you slept" digest. */
  overnight?: SimEvent[];
}

export interface InterpretResult {
  move: Move;
  understoodAs: string;
  ok: boolean;
}

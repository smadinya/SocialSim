import type {
  CharacterId,
  Move,
  MoveId,
  Relationship,
  SimEvent,
  WorldState,
} from "@sim/types";

export type {
  CharacterId,
  Character,
  Memory,
  Belief,
  Move,
  MoveId,
  Relationship,
  SimEvent,
  WorldState,
} from "@sim/types";

export type RelationshipField = keyof Relationship;

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
}

export interface RelationshipDelta {
  sourceActor: CharacterId;
  from: CharacterId;
  to: CharacterId;
  field: RelationshipField;
  before: number;
  after: number;
}

export interface TickResult {
  state: WorldState;
  utterances: Utterance[];
  events: SimEvent[];
  log: ResolvedMove[];
  deltas: RelationshipDelta[];
}

export interface InterpretResult {
  move: Move;
  understoodAs: string;
  ok: boolean;
}

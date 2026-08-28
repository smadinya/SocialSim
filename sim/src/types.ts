export type CharacterId = string;
export type MoveId = string;
export type ConversationId = string;
export type SocialRequestId = string;

export const RELATIONSHIP_AXES = [
  "trust",
  "gratitude",
  "affection",
  "respect",
  "fear",
  "anger",
  "jealousy",
  "hate",
] as const;

export type RelationshipAxis = (typeof RELATIONSHIP_AXES)[number];

export type ConversationStatus = "active" | "paused" | "ended";
export type SocialRequestStatus =
  | "pending"
  | "clarification_requested"
  | "delayed"
  | "accepted"
  | "refused"
  | "fulfilled"
  | "failed"
  | "withdrawn";

export interface ConversationTopic {
  /** Stable category used by rules and memory retrieval. */
  kind: string;
  subject?: CharacterId;
  object?: CharacterId;
  /** Player-facing phrasing, e.g. "Whether Bob betrayed Alice". */
  summary: string;
  salience: number;
}

export interface ConversationTurn {
  turn: number;
  speaker: CharacterId;
  moveId: MoveId;
  target?: CharacterId;
  eventId?: string;
}

/**
 * Authoritative state for an interaction that is happening now. Long-term
 * recollection belongs in each character's Memory array, not in this record.
 * Part 2 will enforce that a character appears in at most one active record.
 */
export interface Conversation {
  id: ConversationId;
  participants: CharacterId[];
  location: string;
  status: ConversationStatus;
  startedTurn: number;
  lastActiveTurn: number;
  currentSpeaker?: CharacterId;
  expectedResponder?: CharacterId;
  primaryTopic: ConversationTopic;
  secondaryTopics: ConversationTopic[];
  summary: string;
  recentTurns: ConversationTurn[];
  pendingRequestIds: SocialRequestId[];
}

/** A direct question/request survives the tick in which it was asked. */
export interface SocialRequest {
  id: SocialRequestId;
  conversationId: ConversationId;
  requester: CharacterId;
  recipient: CharacterId;
  subject: string;
  about?: CharacterId;
  createdTurn: number;
  deadlineTurn?: number;
  importance: number;
  status: SocialRequestStatus;
  responseEventId?: string;
  resolutionEventId?: string;
}

export type SocialObligationStatus = "active" | "fulfilled" | "failed";

/** Accepting a request creates an obligation; fulfilling it is a later fact. */
export interface SocialObligation {
  id: string;
  requestId: SocialRequestId;
  debtor: CharacterId;
  creditor: CharacterId;
  subject: string;
  createdTurn: number;
  status: SocialObligationStatus;
  resolvedTurn?: number;
  resolutionEventId?: string;
}

export interface Relationship {
  trust: number;
  affection: number;
  respect: number;
  fear: number;
}

/** Track A's complete relationship state. */
export interface RelationshipState extends Relationship {
  /**
   * Expanded axes are optional only while existing fixtures/saves and the
   * other tracks migrate. Track A normalizes them to zero before scoring.
   */
  gratitude?: number;
  anger?: number;
  jealousy?: number;
  hate?: number;
  baseline?: RelationshipValues;
  lastDelta?: Partial<Record<RelationshipAxis, number>>;
  flags?: string[];
  history?: RelationshipHistoryEntry[];
}

export interface RelationshipHistoryEntry {
  turn: number;
  eventId: string;
  moveId: MoveId;
  field: RelationshipAxis;
  before: number;
  after: number;
  labelsBefore: string[];
  labelsAfter: string[];
}

/** All axes after a fixture/save has passed through relationship normalization. */
export type RelationshipValues = Record<RelationshipAxis, number>;

export interface Memory {
  id: string;
  turn: number;

  actor: CharacterId;
  target?: CharacterId;

  description: string;
  tags: string[];
  importance: number;
  eventId?: string;
  conversationId?: ConversationId;
  tier?: "direct" | "overheard" | "told";
  valence?: number;
  accurate?: boolean;
}

export interface Belief {
  id: string;
  description: string;
  confidence: number;
}

export interface CharacterState {
  mood: string;
  emotions: Record<string, number>;
}

export interface Character {
  id: CharacterId;
  name: string;

  traits: string[];

  state: CharacterState;

  relationships: Record<CharacterId, RelationshipState>;

  memories: Memory[];
  beliefs: Belief[];

  goals: string[];
}

export interface SceneState {
  location: string;
  presentCharacters: CharacterId[];
  departures?: Record<CharacterId, {
    returnTurn: number;
    location: string;
  }>;
}

export interface WorldState {
  turn: number;
  clock: string;

  characters: Record<CharacterId, Character>;

  scene: SceneState;

  /**
   * Optional during the Part 1 save/fixture migration. Part 2 will normalize
   * these to empty records on load and make them required in runtime state.
   */
  conversations?: Record<ConversationId, Conversation>;
  socialRequests?: Record<SocialRequestId, SocialRequest>;
  obligations?: Record<string, SocialObligation>;

  rngSeed: number;
}

export interface Move {
  id: MoveId;
  actor: CharacterId;
  target?: CharacterId;
  args?: Record<string, unknown>;
}

export interface SimEvent {
  id: string;
  turn: number;
  type: string;

  actor?: CharacterId;
  target?: CharacterId;
  description: string;

  OnScene: CharacterId[];
}

export interface ResolvedMove {
  move: Move;
  witnessedByPlayer: boolean;
}

export interface RelationshipDelta {
  sourceActor: CharacterId;
  from: CharacterId;
  to: CharacterId;
  field: RelationshipAxis;
  before: number;
  after: number;
}

export type BehaviorBranch =
  | "danger"
  | "reply"
  | "conversation"
  | "obligation"
  | "reaction"
  | "goal"
  | "social-approach"
  | "idle";

export interface DecisionTrace {
  actor: CharacterId;
  branch: BehaviorBranch;
  selected?: Move;
  score: number;
  reasons: string[];
  contributingMemories: string[];
  rejectedConflicts: string[];
  alternatives: Array<{ move: Move; score: number }>;
}

/** Track B realizes these deterministic facts as dialogue. */
export interface PendingUtterance {
  speaker: CharacterId;
  move: Move;
  mood: string;
  relationshipSnapshot: RelationshipState;
  speakerBeliefs: Belief[];
  retrievedMemories: Memory[];
  witnessedByPlayer: boolean;
}

/** Temporary rendered-line compatibility field; remove after Track C migrates. */
export interface Utterance {
  speaker: CharacterId;
  moveId: MoveId;
  line: string;
  deliveryNote?: string;
}

/** The shared multi-actor result contract. Owned by Track A. */
export interface TickResult {
  state: WorldState;
  events: SimEvent[];
  log: ResolvedMove[];
  deltas: RelationshipDelta[];
  /** Track B's future input. */
  pendingUtterances: PendingUtterance[];
  /** Track C compatibility until it renders realized pending utterances. */
  utterances: Utterance[];
  eligibleActors: CharacterId[];
  decisionTraces?: DecisionTrace[];
}

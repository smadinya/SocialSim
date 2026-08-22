export type CharacterId = string;
export type MoveId = string;

export interface Relationship {
  trust: number;
  affection: number;
  respect: number;
  fear: number;
}

export interface Memory {
  id: string;
  turn: number;

  actor: CharacterId;
  target?: CharacterId;

  description: string;
  tags: string[];
  importance: number;
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

  relationships: Record<CharacterId, Relationship>;

  memories: Memory[];
  beliefs: Belief[];

  goals: string[];
}

export interface SceneState {
  location: string;
  presentCharacters: CharacterId[];
}

export interface WorldState {
  turn: number;
  clock: string;

  characters: Record<CharacterId, Character>;

  scene: SceneState;

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
export type PatchOperation =
  | "set"
  | "increment"
  | "append"
  | "remove"
  | "merge";

export type RelationshipField =
  | "trust"
  | "affection"
  | "respect"
  | "fear";

export type CognitionPath =
  | `/characters/${string}/relationships/${string}/${RelationshipField}`
  | `/characters/${string}/state/mood`
  | `/characters/${string}/state/emotions/${string}`
  | `/characters/${string}/memories`
  | `/characters/${string}/beliefs`
  | `/characters/${string}/goals`;

export interface CognitionPatch {
  op: PatchOperation;
  path: CognitionPath;
  value?: unknown;

  reason?: string;
  sourceMoveId?: string;
  sourceEventId?: string;
}

export interface CognitionPatchResult {
  applied: boolean;
  path: CognitionPath;

  error?: string;
}
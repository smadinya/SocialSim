// packages/sim/src/cognition/validatePatch.ts

import type { WorldState } from "../types";

import type {
  CognitionPatch,
  CognitionPatchResult,
} from "./schemas";

export function validateCognitionPatch(
  world: WorldState,
  patch: CognitionPatch,
): CognitionPatchResult {
  // TODO

  return {
    applied: true,
    path: patch.path,
  };
}
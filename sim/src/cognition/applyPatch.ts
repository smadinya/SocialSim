import type { WorldState } from "../types";

import type {
  CognitionPatch,
  CognitionPatchResult,
} from "./schemas";

import {
  validateCognitionPatch,
} from "./validatePatch";

export function applyCognitionPatch(
  world: WorldState,
  patch: CognitionPatch,
): CognitionPatchResult {
  const validation =
    validateCognitionPatch(world, patch);

  if (!validation.applied) {
    return validation;
  }

  // TODO

  return {
    applied: true,
    path: patch.path,
  };
}

export function applyCognitionPatches(
  world: WorldState,
  patches: CognitionPatch[],
): WorldState {
  const next = structuredClone(world);

  for (const patch of patches) {
    applyCognitionPatch(next, patch);
  }

  return next;
}
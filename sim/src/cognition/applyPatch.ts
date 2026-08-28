import type { WorldState } from "../types";

import type {
  CognitionPatch,
  CognitionPatchResult,
} from "./schemas";

import {
  resolveSlot,
  validateCognitionPatch,
} from "./validatePatch";

/** The five relationship axes are 0..100 everywhere else; keep them so here.
 *  Conversation `heat` shares the range and the same reason to clamp. */
function clampAxis(path: string, value: number): number {
  const bounded =
    /^\/characters\/[^/]+\/relationships\//.test(path) ||
    /^\/conversations\/[^/]+\/heat$/.test(path);
  if (!bounded) return value;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Apply one patch in place. Validated first, so anything that gets past
 * `validateCognitionPatch` is safe to write.
 */
export function applyCognitionPatch(
  world: WorldState,
  patch: CognitionPatch,
): CognitionPatchResult {
  const validation =
    validateCognitionPatch(world, patch);

  if (!validation.applied) {
    return validation;
  }

  const slot = resolveSlot(world, patch.path);
  if ("error" in slot) {
    return { applied: false, path: patch.path, error: slot.error };
  }

  const { container, key } = slot;
  const current = container[key];

  switch (patch.op) {
    case "set":
      container[key] =
        typeof patch.value === "number"
          ? clampAxis(patch.path, patch.value)
          : patch.value;
      break;

    case "increment":
      container[key] = clampAxis(
        patch.path,
        (current as number) + (patch.value as number),
      );
      break;

    case "append":
      (current as unknown[]).push(patch.value);
      break;

    case "remove": {
      const list = current as unknown[];
      // Memories and beliefs are objects with ids; goals are plain strings.
      const at = list.findIndex((entry) =>
        entry !== null && typeof entry === "object"
          ? (entry as { id?: string }).id === patch.value
          : entry === patch.value,
      );
      if (at < 0) {
        return { applied: false, path: patch.path, error: "no such entry" };
      }
      list.splice(at, 1);
      break;
    }

    case "merge": {
      const value = patch.value as Record<string, unknown>;
      if (Array.isArray(current)) {
        const entry = (current as { id?: string }[]).find((e) => e?.id === value.id);
        if (!entry) {
          return { applied: false, path: patch.path, error: `no entry ${value.id}` };
        }
        Object.assign(entry, value);
      } else {
        Object.assign(current as Record<string, unknown>, value);
      }
      break;
    }
  }

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

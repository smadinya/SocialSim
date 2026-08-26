import type { WorldState } from "../types";

import type {
  CognitionPatch,
  CognitionPatchResult,
} from "./schemas";

/**
 * Where a patch lands: the object that holds the value, and the key on it.
 *
 * Every `CognitionPath` is `/characters/{id}/…`, so walking the segments and
 * stopping one short of the end resolves all six shapes with no per-path code.
 */
export interface PatchSlot {
  container: Record<string, unknown>;
  key: string;
}

export function resolveSlot(
  world: WorldState,
  path: string,
): PatchSlot | { error: string } {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 3 || parts[0] !== "characters") {
    return { error: `unsupported path: ${path}` };
  }

  let node: unknown = world;
  for (const part of parts.slice(0, -1)) {
    if (node === null || typeof node !== "object") {
      return { error: `no such path: ${path}` };
    }
    node = (node as Record<string, unknown>)[part];
  }
  if (node === null || typeof node !== "object") {
    return { error: `no such path: ${path}` };
  }

  return { container: node as Record<string, unknown>, key: parts[parts.length - 1] };
}

/**
 * Structural validation only: does the path exist, and does the op make sense
 * for what's there. It does not judge whether the change is a good idea — that
 * is the caller's business, and for LLM-generated patches it is the caller's
 * whole job.
 */
export function validateCognitionPatch(
  world: WorldState,
  patch: CognitionPatch,
): CognitionPatchResult {
  const slot = resolveSlot(world, patch.path);
  if ("error" in slot) {
    return { applied: false, path: patch.path, error: slot.error };
  }

  const current = slot.container[slot.key];
  const isList = Array.isArray(current);

  switch (patch.op) {
    case "increment":
      if (typeof current !== "number") {
        return { applied: false, path: patch.path, error: "increment needs a number" };
      }
      if (typeof patch.value !== "number" || !Number.isFinite(patch.value)) {
        return { applied: false, path: patch.path, error: "increment needs a finite value" };
      }
      break;

    case "set":
      if (patch.value === undefined) {
        return { applied: false, path: patch.path, error: "set needs a value" };
      }
      if (typeof current === "number" && typeof patch.value !== "number") {
        return { applied: false, path: patch.path, error: "cannot set a number to a non-number" };
      }
      break;

    case "append":
    case "remove":
      if (!isList) {
        return { applied: false, path: patch.path, error: `${patch.op} needs a list` };
      }
      if (patch.value === undefined) {
        return { applied: false, path: patch.path, error: `${patch.op} needs a value` };
      }
      break;

    case "merge":
      if (patch.value === null || typeof patch.value !== "object") {
        return { applied: false, path: patch.path, error: "merge needs an object" };
      }
      // Merging into a list means merging into the entry with a matching id.
      if (isList && typeof (patch.value as { id?: unknown }).id !== "string") {
        return { applied: false, path: patch.path, error: "merge into a list needs an id" };
      }
      if (!isList && (current === null || typeof current !== "object")) {
        return { applied: false, path: patch.path, error: "merge needs an object target" };
      }
      break;

    default:
      return { applied: false, path: patch.path, error: `unknown op: ${patch.op}` };
  }

  return { applied: true, path: patch.path };
}

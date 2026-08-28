import type { WorldState } from "./viewTypes";

const KEY = "socialsim-save";

/**
 * v1 -> v2 in update 1. A v1 blob has four relationship axes, no baselines,
 * no locations, no topics and no clock — loading one produces a world that is
 * half-initialised in ways that surface later as crashes rather than as a
 * failed load. There is no migration: the fixture was rewritten, so an old
 * save points at a scenario that no longer exists.
 *
 * v2 -> v3 on the Track A merge. Three more relationship axes, and
 * `conversations` became `threads` when `Conversation` was handed to Track A's
 * model — so a v2 blob has the engine's exchanges under a key nothing reads,
 * which loads as a world where nobody is talking to anybody and no error is
 * raised. Rejecting it is the honest outcome.
 */
export const SAVE_VERSION = 3;

export interface SaveBlob {
  version: number;
  savedAt: string;
  world: WorldState;
}

function blobFor(world: WorldState): SaveBlob {
  return { version: SAVE_VERSION, savedAt: new Date().toISOString(), world };
}

export function saveSession(world: WorldState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(blobFor(world)));
}

export function loadSession(): WorldState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return worldFrom(JSON.parse(raw) as SaveBlob);
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}

export function exportSession(world: WorldState): void {
  if (typeof window === "undefined") return;
  const text = JSON.stringify(blobFor(world), null, 2);
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "socialsim-save.json";
  link.click();
  URL.revokeObjectURL(url);
}

export function parseImported(text: string): WorldState | null {
  try {
    return worldFrom(JSON.parse(text) as SaveBlob);
  } catch {
    return null;
  }
}

/** Rejects anything that isn't a v2 world, rather than loading half of one. */
function worldFrom(blob: SaveBlob): WorldState | null {
  if (!blob || blob.version !== SAVE_VERSION || !blob.world) return null;
  const w = blob.world;
  if (typeof w.day !== "number" || !w.locations || !w.topics) return null;
  return w;
}

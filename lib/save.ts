import type { WorldState } from "./viewTypes";
import { normalizeWorldState } from "@sim/world/normalize";

const KEY = "socialsim-save";

export interface SaveBlob {
  version: 1;
  savedAt: string;
  world: WorldState;
}

export function saveSession(world: WorldState): void {
  if (typeof window === "undefined") return;
  const blob: SaveBlob = {
    version: 1,
    savedAt: new Date().toISOString(),
    world,
  };
  window.localStorage.setItem(KEY, JSON.stringify(blob));
}

export function loadSession(): WorldState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw) as SaveBlob;
    return normalizeWorldState(blob.world);
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
  const blob: SaveBlob = {
    version: 1,
    savedAt: new Date().toISOString(),
    world,
  };
  const text = JSON.stringify(blob, null, 2);
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
    const blob = JSON.parse(text) as SaveBlob;
    if (blob && blob.world) return normalizeWorldState(blob.world);
    return null;
  } catch {
    return null;
  }
}

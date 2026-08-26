import type { PendingUtterance, RealizedLine, RelationshipAxis } from "@ai/types";
import { REL_FIELDS, bucket } from "@/lib/format";

/**
 * Realization cache, keyed on
 * `(speaker, moveId, target, mood, bucketed axes, top-memory tags)`.
 *
 * `bucket()` gives four coarse bands, so four axes is 256 buckets before the
 * move id — coarse enough to hit, fine enough not to serve a warm line at
 * trust 10. The top memory is what stops a cached line ignoring what just
 * happened.
 *
 * `speaker` and `target` are in the key because the cached line names people
 * by name: without them two characters in the same mood, making the same move,
 * with the same bucketed axes share an entry, and a hit serves a line
 * addressed to the wrong person. Memory *ids* are owner-scoped
 * (`mem-{observer}-…`), which used to hide that by making every key unique —
 * and unique keys are also why the cache never hit. Tags instead of the id, so
 * situations that are the same situation collide on purpose.
 */

const MAX_ENTRIES = 500;
const store = new Map<string, RealizedLine>();

export function cacheKey(u: PendingUtterance): string {
  const rel = u.relationshipSnapshot;
  const axes = REL_FIELDS.map((f) => bucket(rel[f as RelationshipAxis])).join("/");
  const top = u.retrievedMemories[0];
  const topMemory = top ? [...top.tags].sort().join(",") : "none";
  return [
    u.speaker,
    u.move.id,
    u.move.target ?? "none",
    u.mood,
    axes,
    topMemory,
  ].join("|");
}

export function cacheGet(key: string): RealizedLine | undefined {
  return store.get(key);
}

export function cacheSet(key: string, value: RealizedLine): void {
  store.set(key, value);
  // ponytail: FIFO eviction on a process-local Map. Per-instance and lost on
  // restart — fine for a demo; swap for a shared cache only if the hit rate
  // across instances turns out to matter.
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
}

export function cacheClear(): void {
  store.clear();
}

/** Track B's public surface. Everything else in `ai/` is internal. */
export { realize } from "@ai/realize";
export { interpret } from "@ai/interpret";
export { toPendingUtterance } from "@ai/adapt";
export { beginTick, endTick, mockMode, worstTick } from "@ai/client";
export type { TickCost } from "@ai/client";
export type { PendingUtterance, RealizedLine } from "@ai/types";

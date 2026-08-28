import type {
  Move,
  RelationshipAxis,
  RelationshipDelta,
  WorldState,
} from "../types";
import type { KnownMoveId } from "./catalog";

export interface RelationshipEffect {
  field: RelationshipAxis;
  amount: number;
  /** true changes the target's view of the actor; false does the reverse. */
  onTarget: boolean;
}

export const MOVE_EFFECTS: Record<KnownMoveId, RelationshipEffect[]> = {
  Greet: [{ field: "affection", amount: 3, onTarget: true }],
  Talk: [{ field: "trust", amount: 2, onTarget: true }],
  Ask: [{ field: "respect", amount: 1, onTarget: true }],
  AskForHelp: [{ field: "respect", amount: 3, onTarget: true }],
  Apologize: [
    { field: "trust", amount: 8, onTarget: true },
    { field: "anger", amount: -6, onTarget: true },
    { field: "hate", amount: -2, onTarget: true },
  ],
  Hug: [
    { field: "affection", amount: 9, onTarget: true },
    { field: "anger", amount: -2, onTarget: true },
  ],
  Comfort: [
    { field: "gratitude", amount: 6, onTarget: true },
    { field: "affection", amount: 4, onTarget: true },
  ],
  Comply: [
    { field: "gratitude", amount: 6, onTarget: true },
    { field: "respect", amount: 4, onTarget: true },
  ],
  Defend: [
    { field: "gratitude", amount: 8, onTarget: true },
    { field: "affection", amount: 7, onTarget: true },
    { field: "respect", amount: 5, onTarget: true },
  ],
  GiveGift: [
    { field: "gratitude", amount: 7, onTarget: true },
    { field: "affection", amount: 9, onTarget: true },
    { field: "trust", amount: 4, onTarget: true },
  ],
  Flirt: [
    { field: "affection", amount: 6, onTarget: true },
    { field: "jealousy", amount: -2, onTarget: true },
  ],
  Propose: [
    { field: "affection", amount: 6, onTarget: true },
    { field: "trust", amount: 5, onTarget: true },
  ],
  RevealSecret: [{ field: "trust", amount: 6, onTarget: true }],
  Mimic: [
    { field: "respect", amount: -2, onTarget: true },
    { field: "anger", amount: 3, onTarget: true },
  ],
  Refuse: [
    { field: "affection", amount: -5, onTarget: true },
    { field: "anger", amount: 4, onTarget: true },
  ],
  Argue: [
    { field: "trust", amount: -4, onTarget: true },
    { field: "anger", amount: 8, onTarget: true },
  ],
  Confront: [
    { field: "fear", amount: 8, onTarget: true },
    { field: "anger", amount: 5, onTarget: true },
    { field: "trust", amount: -6, onTarget: true },
  ],
  Insult: [
    { field: "affection", amount: -10, onTarget: true },
    { field: "respect", amount: -4, onTarget: true },
    { field: "anger", amount: 8, onTarget: true },
    { field: "hate", amount: 4, onTarget: true },
  ],
  SpreadRumor: [
    { field: "trust", amount: -10, onTarget: true },
    { field: "hate", amount: 3, onTarget: true },
  ],
  Fight: [
    { field: "respect", amount: -8, onTarget: true },
    { field: "fear", amount: 12, onTarget: true },
    { field: "anger", amount: 12, onTarget: true },
    { field: "hate", amount: 8, onTarget: true },
  ],
  Reassure: [
    { field: "fear", amount: -10, onTarget: true },
    { field: "anger", amount: -6, onTarget: true },
    { field: "affection", amount: 4, onTarget: true },
  ],
  // Movement, not a social act: it fires no relationship effects.
  GoTo: [],
  Withdraw: [],
  Wait: [],
};

function clampAxis(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Applies only deterministic, directed relationship effects. */
export function applyMoveEffects(
  world: WorldState,
  move: Move,
): RelationshipDelta[] {
  const deltas: RelationshipDelta[] = [];
  const effects = MOVE_EFFECTS[move.id as KnownMoveId] ?? [];

  for (const effect of effects) {
    const owner = effect.onTarget ? move.target : move.actor;
    const other = effect.onTarget ? move.actor : move.target;
    if (!owner || !other) continue;

    const relationship = world.characters[owner]?.relationships[other];
    if (!relationship) continue;

    const before = relationship[effect.field] ?? 0;
    const after = clampAxis(before + effect.amount);
    relationship[effect.field] = after;

    if (before !== after) {
      deltas.push({
        sourceActor: move.actor,
        from: owner,
        to: other,
        field: effect.field,
        before,
        after,
      });
    }
  }

  return deltas;
}

import { activeConversationFor } from "../conversations";
import { relationshipValues } from "../relationships";
import { activeObligationFor, pendingRequestFor } from "../requests";
import { createSeededRng } from "../rng/seededRng";
import type {
  BehaviorBranch,
  CharacterId,
  DecisionTrace,
  Move,
  WorldState,
} from "../types";
import { getEligibleActors, getLegalMoves, isLegalMove } from "../moves/legalMoves";

export interface UtilityWeights {
  goalPursuit: number;
  relationshipFit: number;
  traitExpression: number;
  memoryRelevance: number;
  novelty: number;
  responseUrgency: number;
  actionBias: number;
  minimumAction: number;
}

export const DEFAULT_UTILITY_WEIGHTS: Readonly<UtilityWeights> = {
  goalPursuit: 1.4,
  relationshipFit: 1.1,
  traitExpression: 0.8,
  memoryRelevance: 0.7,
  novelty: 1.2,
  responseUrgency: 3,
  actionBias: 0.35,
  minimumAction: 0.5,
};

const POSITIVE = new Set(["Greet", "Talk", "Ask", "AskForHelp", "Apologize", "Hug", "Comfort", "Comply", "Defend", "Help", "GiveGift", "Flirt", "Propose", "RevealSecret"]);
const HOSTILE = new Set(["Mimic", "Refuse", "Argue", "Confront", "Insult", "SpreadRumor", "Fight"]);
const ACTION_TAGS: Record<string, string[]> = {
  Ask: ["find", "truth", "learn"],
  RevealSecret: ["secret", "truth", "learn"],
  Confront: ["betrayal", "truth", "forgive"],
  Apologize: ["forgive", "repair"],
  Defend: ["protect", "loyal"],
  Help: ["help", "support", "promise"],
  AskForHelp: ["help", "support"],
  Propose: ["alliance", "plan"],
  Talk: ["talk", "learn"],
};

function targetAffinity(world: WorldState, move: Move): number {
  if (!move.target) return 0;
  const r = relationshipValues(world.characters[move.actor]?.relationships[move.target]);
  const warmth = (r.trust + r.affection + r.respect + r.gratitude) / 400;
  const hostility = (r.fear + r.anger + r.jealousy + r.hate) / 400;
  if (POSITIVE.has(move.id)) return warmth - hostility * 0.5;
  if (HOSTILE.has(move.id)) return hostility - warmth * 0.5;
  return 0;
}

function scoreMove(
  world: WorldState,
  move: Move,
  branch: BehaviorBranch,
  weights: UtilityWeights,
  recentMoves: readonly Move[],
): { score: number; reasons: string[]; memories: string[] } {
  const character = world.characters[move.actor];
  const tags = ACTION_TAGS[move.id] ?? [move.id.toLowerCase()];
  const goalText = character.goals.join(" ").toLowerCase();
  const goalMatches = tags.filter((tag) => goalText.includes(tag)).length;
  const traitText = character.traits.join(" ").toLowerCase();
  const traitMatches = tags.filter((tag) => traitText.includes(tag)).length;
  const targetTerms = move.target
    ? [move.target.toLowerCase(), world.characters[move.target]?.name.toLowerCase()]
        .filter((value): value is string => Boolean(value))
    : [];
  const beliefMatches = character.beliefs.filter((belief) => {
    const text = belief.description.toLowerCase();
    return tags.some((tag) => text.includes(tag)) || targetTerms.some((term) => text.includes(term));
  });
  const relevant = character.memories
    .filter((memory) =>
      Boolean(move.target && (memory.actor === move.target || memory.target === move.target)) ||
      tags.some((tag) => memory.tags.some((memoryTag) => memoryTag.toLowerCase() === tag)),
    )
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 3);
  const repeats = recentMoves.slice(-4).filter((past) =>
    past.actor === move.actor && past.id === move.id && past.target === move.target,
  ).length;
  const response = branch === "reply" || branch === "obligation" ? weights.responseUrgency : 0;
  const components = {
    goal: goalMatches * weights.goalPursuit,
    relationship: targetAffinity(world, move) * weights.relationshipFit,
    trait: traitMatches * weights.traitExpression,
    belief: beliefMatches.reduce((sum, belief) => sum + belief.confidence, 0) * weights.memoryRelevance,
    memory: relevant.reduce((sum, memory) => sum + memory.importance, 0) * weights.memoryRelevance,
    novelty: (1 - repeats / 4) * weights.novelty,
    response,
    bias: (move.id === "Wait" ? 0 : 1) * weights.actionBias,
  };
  return {
    score: Object.values(components).reduce((sum, value) => sum + value, 0),
    reasons: Object.entries(components)
      .filter(([, value]) => Math.abs(value) > 0.001)
      .map(([name, value]) => `${name} ${value.toFixed(2)}`),
    memories: relevant.map((memory) => memory.id),
  };
}

function branchCandidates(
  world: WorldState,
  actor: CharacterId,
): { branch: BehaviorBranch; moves: Move[] } {
  const legal = getLegalMoves(actor, world);
  const character = world.characters[actor];
  const danger = Object.values(character.state.emotions).some((value) => value >= 70) ||
    Object.values(character.relationships).some((relationship) => relationship.fear >= 70);
  if (danger) {
    const moves = legal.filter((move) => ["Withdraw", "Fight", "Defend"].includes(move.id));
    if (moves.length) return { branch: "danger", moves };
  }

  const request = pendingRequestFor(world, actor);
  if (request) {
    const subject = request.subject.trim().toLowerCase();
    const needsClarification = subject.length === 0 || subject === "help";
    const replyMoves = [
      "Comply",
      "Refuse",
      ...(needsClarification ? ["Ask"] : []),
      "Wait",
    ];
    const moves: Move[] = replyMoves.map((id) => ({
      id,
      actor,
      target: id === "Wait" ? undefined : request.requester,
      args: { replyToRequestId: request.id, conversationId: request.conversationId },
    })).filter((move) => isLegalMove(move, world));
    if (moves.length) return { branch: "reply", moves };
  }

  const conversation = activeConversationFor(world, actor);
  if (conversation?.expectedResponder === actor) {
    const partner = conversation.participants.find((id) => id !== actor);
    const moves = legal.filter((move) =>
      move.target === partner && ["Talk", "Ask", "Apologize", "Confront", "Refuse"].includes(move.id),
    ).map((move) => ({ ...move, args: { conversationId: conversation.id } }));
    if (moves.length) return { branch: "conversation", moves };
  }

  const obligation = activeObligationFor(world, actor);
  if (obligation) {
    const move: Move = {
      id: "Help",
      actor,
      target: obligation.creditor,
      args: { replyToRequestId: obligation.requestId },
    };
    if (isLegalMove(move, world)) return { branch: "obligation", moves: [move] };
  }

  const reactionMemory = [...character.memories]
    .sort((a, b) => b.turn - a.turn || b.importance - a.importance)
    .find((memory) => memory.importance >= 0.7 && memory.actor !== actor);
  if (reactionMemory) {
    const moves = legal.filter((move) =>
      move.target === reactionMemory.actor && ["Confront", "Ask", "Apologize", "Defend"].includes(move.id),
    );
    if (moves.length) return { branch: "reaction", moves };
  }

  const active = legal.filter((move) => !["Wait", "Withdraw"].includes(move.id));
  if (character.goals.length && active.length) return { branch: "goal", moves: active };
  if (active.length) return { branch: "social-approach", moves: active };
  return { branch: "idle", moves: legal.filter((move) => move.id === "Wait") };
}

export interface NpcSelectionOptions {
  playerId?: CharacterId;
  reservedParticipants?: Iterable<CharacterId>;
  recentMoves?: readonly Move[];
  weights?: UtilityWeights;
  maxActors?: number;
  onlyActors?: Iterable<CharacterId>;
  /** Constrains a same-round response to the person who initiated the exchange. */
  followUpTo?: CharacterId;
}

export function selectNpcMoves(
  world: WorldState,
  options: NpcSelectionOptions = {},
): { moves: Move[]; traces: DecisionTrace[] } {
  const weights = options.weights ?? DEFAULT_UTILITY_WEIGHTS;
  const reserved = new Set(options.reservedParticipants ?? []);
  const rng = createSeededRng((world.rngSeed ^ Math.imul(world.turn + 1, 0x9e3779b1)) >>> 0);
  const moves: Move[] = [];
  const traces: DecisionTrace[] = [];
  const onlyActors = options.onlyActors
    ? new Set(options.onlyActors)
    : undefined;

  for (const actor of [...getEligibleActors(world)].sort()) {
    if (onlyActors && !onlyActors.has(actor)) continue;
    if (actor === options.playerId || reserved.has(actor) || moves.length >= (options.maxActors ?? 2)) continue;
    const branchResult = branchCandidates(world, actor);
    let branch = branchResult.branch;
    let candidates = options.followUpTo
      ? branchResult.moves.filter(
          (move) => move.target === options.followUpTo || move.id === "Withdraw",
        )
      : branchResult.moves;
    if (options.followUpTo && candidates.length === 0) {
      branch = "conversation";
      candidates = getLegalMoves(actor, world).filter(
        (move) => move.target === options.followUpTo &&
          !["Help", "Comply"].includes(move.id),
      );
    }
    const rejectedConflicts: string[] = [];
    const available = candidates.filter((move) => {
      if (move.target && reserved.has(move.target)) {
        rejectedConflicts.push(`${move.id}:${move.target} conflicts with a reserved participant`);
        return false;
      }
      return true;
    });
    const scored = available.map((move) => ({
      move,
      ...scoreMove(world, move, branch, weights, options.recentMoves ?? []),
    })).sort((a, b) => b.score - a.score || a.move.id.localeCompare(b.move.id) ||
      (a.move.target ?? "").localeCompare(b.move.target ?? ""));
    const top = scored[0];
    const ties = top ? scored.filter((item) => Math.abs(item.score - top.score) < 1e-9) : [];
    const winner = ties.length ? ties[rng.nextInt(ties.length)] : undefined;
    const selected = winner && (branch !== "idle" || winner.score >= weights.minimumAction)
      ? winner.move
      : undefined;
    if (selected) {
      moves.push(selected);
      reserved.add(selected.actor);
      if (selected.target) reserved.add(selected.target);
    }
    traces.push({
      actor,
      branch: selected ? branch : "idle",
      selected,
      score: winner?.score ?? 0,
      reasons: winner?.reasons ?? ["no conflict-free legal candidate"],
      contributingMemories: winner?.memories ?? [],
      rejectedConflicts,
      alternatives: scored.slice(0, 4).map(({ move, score }) => ({ move, score })),
    });
  }
  return { moves, traces };
}

import type {
  CharacterId,
  Evidence,
  ScenarioPhase,
  TopicId,
  WorldState,
} from "./viewTypes";

/**
 * Topics are what the world is *about*.
 *
 * Nothing was, before: moves landed on people and `Move.args.subject` was read
 * by exactly one file, to name a third party in a prompt. A mystery needs
 * facts that can be held, moved between people, and be wrong — which is what
 * `Evidence` is.
 */

/** The topic the mystery hangs on. */
export const LEAK_TOPIC: TopicId = "the-leak";

export function topicsKnownTo(
  world: WorldState,
  id: CharacterId,
): TopicId[] {
  return Object.values(world.topics)
    .filter((t) => t.awareOf.includes(id))
    .map((t) => t.id);
}

export function evidenceHeldBy(
  world: WorldState,
  id: CharacterId,
  topicId?: TopicId,
): Evidence[] {
  const topics = topicId
    ? [world.topics[topicId]].filter(Boolean)
    : Object.values(world.topics);
  return topics.flatMap((t) => t.evidence.filter((e) => e.heldBy.includes(id)));
}

export function makeAware(
  world: WorldState,
  id: CharacterId,
  topicId: TopicId,
): void {
  const topic = world.topics[topicId];
  if (topic && !topic.awareOf.includes(id)) topic.awareOf.push(id);
}

/** Trust needed before someone hands over what they know. */
export const TELL_TRUST_AT = 45;

export function willShare(
  world: WorldState,
  holder: CharacterId,
  asker: CharacterId,
): boolean {
  const rel = world.characters[holder]?.relationships?.[asker];
  return Boolean(rel && rel.trust >= TELL_TRUST_AT);
}

/**
 * What `holder` can pass to `asker` about this topic: something they hold,
 * that isn't locked, that the asker doesn't already have.
 */
export function shareableEvidence(
  world: WorldState,
  holder: CharacterId,
  asker: CharacterId,
  topicId: TopicId,
): Evidence | null {
  const topic = world.topics[topicId];
  if (!topic) return null;
  return (
    topic.evidence.find(
      (e) => !e.locked && e.heldBy.includes(holder) && !e.heldBy.includes(asker),
    ) ?? null
  );
}

export function giveEvidence(
  evidence: Evidence,
  to: CharacterId,
): void {
  if (!evidence.heldBy.includes(to)) evidence.heldBy.push(to);
}

/**
 * Confidence that `suspect` is responsible, from the evidence `holder` has.
 *
 * Planted evidence counts exactly the same. Nobody holding a fact can tell
 * whether it is true — only the player, who planted it, knows.
 */
export function suspicionOf(
  world: WorldState,
  holder: CharacterId,
  suspect: CharacterId,
  topicId: TopicId,
): number {
  const topic = world.topics[topicId];
  if (!topic) return 0;
  const weight = topic.evidence
    .filter((e) => e.heldBy.includes(holder) && e.pointsAt === suspect)
    .reduce((sum, e) => sum + e.weight, 0);
  return Math.min(0.95, Math.max(0.05, weight));
}

/** Who `holder` most suspects, and how strongly. */
export function leadingSuspect(
  world: WorldState,
  holder: CharacterId,
  topicId: TopicId,
): { suspect: CharacterId; confidence: number } | null {
  const topic = world.topics[topicId];
  if (!topic) return null;

  const suspects = new Set(
    topic.evidence.filter((e) => e.pointsAt).map((e) => e.pointsAt as CharacterId),
  );

  let best: { suspect: CharacterId; confidence: number } | null = null;
  // Sorted so an exact tie resolves the same way every run rather than by
  // Set insertion order, which the fixture controls by accident.
  for (const suspect of [...suspects].sort()) {
    const confidence = suspicionOf(world, holder, suspect, topicId);
    if (!best || confidence > best.confidence) best = { suspect, confidence };
  }
  return best;
}

/** Unlock evidence gated behind pressure — `bob-alibi-thin` and its kind. */
export function unlockEvidence(
  world: WorldState,
  topicId: TopicId,
  evidenceId: string,
  to: CharacterId,
): Evidence | null {
  const evidence = world.topics[topicId]?.evidence.find((e) => e.id === evidenceId);
  if (!evidence || !evidence.locked) return null;
  evidence.locked = false;
  giveEvidence(evidence, to);
  return evidence;
}

// --- the arc --------------------------------------------------------------

/** Alice acts once she is this sure. */
export const RECKONING_CONFIDENCE = 0.7;
/** Below this by the deadline, she gives up on all of them. */
export const GIVE_UP_CONFIDENCE = 0.35;

/** The day the reckoning lands: the rest of day 3 plus all of day 4. */
export const RECKONING_DAY = 4;

export function phaseFor(
  world: WorldState,
  investigator: CharacterId,
): ScenarioPhase {
  if (world.phase === "resolved") return "resolved";

  const held = evidenceHeldBy(world, investigator, LEAK_TOPIC).length;
  const deadline = world.day > RECKONING_DAY;

  if (deadline) return "reckoning";
  // A passive player still gets moved along: the investigation opens on the
  // first evidence transfer OR at the top of the deadline day, whichever
  // comes first.
  if (held >= 2 || world.day >= RECKONING_DAY) return "investigation";
  return "suspicion";
}

export interface Reckoning {
  ending: string;
  description: string;
  suspect?: CharacterId;
  correct: boolean;
}

/** Who actually did it. The one fact the engine knows and nobody else does. */
export const CULPRIT: CharacterId = "bob";

export function resolveReckoning(
  world: WorldState,
  investigator: CharacterId,
): Reckoning {
  const leading = leadingSuspect(world, investigator, LEAK_TOPIC);
  const nameOf = (id?: CharacterId) =>
    id ? world.characters[id]?.name ?? id : "someone";
  const me = nameOf(investigator);

  if (!leading || leading.confidence < GIVE_UP_CONFIDENCE) {
    return {
      ending: "no-answer",
      description: `${me} stops asking. She never finds out who talked, and she stops trusting any of them enough to care.`,
      correct: false,
    };
  }

  if (leading.confidence < RECKONING_CONFIDENCE) {
    return {
      ending: "unresolved-suspicion",
      description: `${me} suspects ${nameOf(leading.suspect)} and can't prove it. She keeps them at arm's length and says nothing.`,
      suspect: leading.suspect,
      correct: leading.suspect === CULPRIT,
    };
  }

  if (leading.suspect === CULPRIT) {
    const rel = world.characters[investigator]?.relationships?.[CULPRIT];
    const forgiving = Boolean(rel && rel.affection >= 50 && rel.anger < 40);
    return forgiving
      ? {
          ending: "forgiven",
          description: `${me} knows it was ${nameOf(CULPRIT)}. She says so, to his face, and then she lets him stay.`,
          suspect: CULPRIT,
          correct: true,
        }
      : {
          ending: "exposed",
          description: `${me} lays it out in front of everyone. ${nameOf(CULPRIT)} doesn't get to deny it twice.`,
          suspect: CULPRIT,
          correct: true,
        };
  }

  return {
    ending: "wrong-person",
    description: `${me} is certain it was ${nameOf(leading.suspect)}. She is wrong, and the person who actually talked watches her be wrong.`,
    suspect: leading.suspect,
    correct: false,
  };
}

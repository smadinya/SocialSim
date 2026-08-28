/**
 * The legal-move enum. `getLegalMoves` builds the interpretation schema from
 * this array, so anything missing here cannot be produced by either
 * interpreter no matter what the keyword table or the effect table say —
 * that's how "wait" used to come back as `Withdraw`.
 *
 * Keep in step with `MOVE_META` in `lib/moveMeta.ts` and the keyword table in
 * `lib/interpret.ts`. All three, every time.
 *
 * MERGE NOTE — `AskAbout` is gone; `Ask` supersedes it.
 * Update 1 shipped `AskAbout` as the only route by which evidence moves
 * between characters, and Track A shipped `Ask`/`Talk` covering the same
 * ground. Rather than carry two, `Ask` now takes `args.topicId` and owns the
 * evidence-transfer path (`resolveTopical` in `lib/mockEngine.ts`). `Talk` is
 * the untargeted-at-a-topic version and is currently plain small talk.
 * Revisit whether `Talk` should also be able to carry a topic.
 */
export const MOVE_IDS = [
  "Greet",
  "Talk",
  "Ask",
  "AskForHelp",
  "Apologize",
  "Hug",
  "Comfort",
  "Comply",
  "Defend",
  "GiveGift",
  "Flirt",
  "Propose",
  "RevealSecret",
  "Reassure",
  "Mimic",
  "Refuse",
  "Argue",
  "Confront",
  "Insult",
  "SpreadRumor",
  "Fight",
  "Withdraw",
  // Movement. The locations system is unreachable without it.
  "GoTo",
  // Both were reachable from the menu and the mock effect table but not from
  // either interpreter, because this array is what `getLegalMoves` builds the
  // schema enum from. "wait" came back as `Withdraw`; "propose an alliance
  // with alice" came back as `AskForHelp`.
  "Wait",
] as const;

export type KnownMoveId = (typeof MOVE_IDS)[number];

/** Every other social action addresses another character. */
export const TARGETLESS_MOVE_IDS = ["Withdraw", "Wait", "GoTo"] as const satisfies
  readonly KnownMoveId[];

const KNOWN_MOVE_ID_SET: ReadonlySet<string> = new Set(MOVE_IDS);
const TARGETLESS_MOVE_ID_SET: ReadonlySet<string> = new Set(
  TARGETLESS_MOVE_IDS,
);

export function isKnownMoveId(id: string): id is KnownMoveId {
  return KNOWN_MOVE_ID_SET.has(id);
}

export function moveNeedsTarget(id: KnownMoveId): boolean {
  return !TARGETLESS_MOVE_ID_SET.has(id);
}

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
  "Mimic",
  "Refuse",
  "Argue",
  "Confront",
  "Insult",
  "SpreadRumor",
  "Fight",
  "Withdraw",
  // Both were reachable from the menu and the mock effect table but not from
  // either interpreter, because this array is what `getLegalMoves` builds the
  // schema enum from. "wait" came back as `Withdraw`; "propose an alliance
  // with alice" came back as `AskForHelp`.
  "Wait",
] as const;

export type KnownMoveId =
  (typeof MOVE_IDS)[number];

/** Every current social action addresses another character. */
export const TARGETLESS_MOVE_IDS = ["Withdraw", "Wait"] as const satisfies
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

/**
 * The legal-move enum. `getLegalMoves` builds the interpretation schema from
 * this array, so anything missing here cannot be produced by either
 * interpreter no matter what the keyword table or the effect table say —
 * that's how "wait" used to come back as `Withdraw`.
 *
 * Keep in step with `MOVE_META` in `lib/moveMeta.ts` and the keyword table in
 * `lib/interpret.ts`. All three, every time.
 */
export const MOVE_IDS = [
  "Greet",
  "AskAbout",
  "Confront",
  "GiveGift",
  "SpreadRumor",
  "RevealSecret",
  "Defend",
  "Insult",
  "Fight",
  "Flirt",
  "Apologize",
  "Reassure",
  "AskForHelp",
  "Refuse",
  "Comply",
  "Withdraw",
  "Propose",
  "GoTo",
  "Wait",
] as const;

export type KnownMoveId = (typeof MOVE_IDS)[number];

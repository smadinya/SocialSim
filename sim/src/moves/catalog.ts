export const MOVE_IDS = [
  "Greet",
  "Confront",
  "GiveGift",
  "SpreadRumor",
  "RevealSecret",
  "Defend",
  "Insult",
  "Apologize",
  "AskForHelp",
  "Refuse",
  "Comply",
  "Withdraw",
  // Both were reachable from the menu and the mock effect table but not from
  // either interpreter, because this array is what `getLegalMoves` builds the
  // schema enum from. "wait" came back as `Withdraw`; "propose an alliance
  // with alice" came back as `AskForHelp`.
  "Propose",
  "Wait",
] as const;

export type KnownMoveId =
  (typeof MOVE_IDS)[number];

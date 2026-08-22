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
] as const;

export type KnownMoveId =
  (typeof MOVE_IDS)[number];

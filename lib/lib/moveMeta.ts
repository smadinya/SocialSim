import type { MoveId, RelationshipField } from "./viewTypes";

export interface MoveMeta {
  id: MoveId;
  label: string;
  needsTarget: boolean;
  blurb: string;
}

export const MOVE_META: Record<string, MoveMeta> = {
  Greet: { id: "Greet", label: "Greet", needsTarget: true, blurb: "A friendly opening." },
  Confront: { id: "Confront", label: "Confront", needsTarget: true, blurb: "Call someone out directly." },
  GiveGift: { id: "GiveGift", label: "Give gift", needsTarget: true, blurb: "Offer something to win favor." },
  SpreadRumor: { id: "SpreadRumor", label: "Spread rumor", needsTarget: true, blurb: "Pass along a damaging story." },
  RevealSecret: { id: "RevealSecret", label: "Reveal secret", needsTarget: true, blurb: "Tell what you know." },
  Defend: { id: "Defend", label: "Defend", needsTarget: true, blurb: "Take someone's side." },
  Insult: { id: "Insult", label: "Insult", needsTarget: true, blurb: "Cut them down." },
  Apologize: { id: "Apologize", label: "Apologize", needsTarget: true, blurb: "Try to make peace." },
  AskForHelp: { id: "AskForHelp", label: "Ask for help", needsTarget: true, blurb: "Request a favor." },
  Refuse: { id: "Refuse", label: "Refuse", needsTarget: true, blurb: "Turn someone down." },
  Comply: { id: "Comply", label: "Comply", needsTarget: true, blurb: "Go along with it." },
  Withdraw: { id: "Withdraw", label: "Withdraw", needsTarget: false, blurb: "Step back from the scene." },
  Propose: { id: "Propose", label: "Propose", needsTarget: true, blurb: "Suggest an alliance." },
};

export const MENU_MOVE_IDS: MoveId[] = [
  "Greet",
  "Confront",
  "GiveGift",
  "AskForHelp",
  "Defend",
  "Withdraw",
];

export function metaFor(id: MoveId): MoveMeta {
  return (
    MOVE_META[id] || { id, label: id, needsTarget: true, blurb: "" }
  );
}

export interface MockEffect {
  field: RelationshipField;
  amount: number;
  onTarget: boolean;
}

export const MOCK_EFFECTS: Record<string, MockEffect[]> = {
  Greet: [{ field: "affection", amount: 3, onTarget: true }],
  Confront: [
    { field: "fear", amount: 8, onTarget: true },
    { field: "trust", amount: -6, onTarget: true },
  ],
  GiveGift: [
    { field: "affection", amount: 9, onTarget: true },
    { field: "trust", amount: 4, onTarget: true },
  ],
  SpreadRumor: [{ field: "trust", amount: -10, onTarget: true }],
  RevealSecret: [{ field: "trust", amount: 6, onTarget: true }],
  Defend: [
    { field: "affection", amount: 7, onTarget: true },
    { field: "respect", amount: 5, onTarget: true },
  ],
  Insult: [
    { field: "affection", amount: -10, onTarget: true },
    { field: "respect", amount: -4, onTarget: true },
  ],
  Apologize: [{ field: "trust", amount: 8, onTarget: true }],
  AskForHelp: [{ field: "respect", amount: 3, onTarget: true }],
  Refuse: [{ field: "affection", amount: -5, onTarget: true }],
  Comply: [{ field: "respect", amount: 4, onTarget: true }],
  Withdraw: [],
  Propose: [
    { field: "affection", amount: 6, onTarget: true },
    { field: "trust", amount: 5, onTarget: true },
  ],
};

const DIALOGUE_TEMPLATES: Record<string, string> = {
  Greet: "Good to see you, {target}. It's been a strange few days.",
  Confront: "Don't play dumb, {target}. I know what you did.",
  GiveGift: "Here, {target}. I wanted you to have this.",
  SpreadRumor: "You didn't hear it from me, but {target} has been talking.",
  RevealSecret: "There's something you should know, {target}.",
  Defend: "Leave {target} out of this — they've done nothing wrong.",
  Insult: "Honestly, {target}, I expected better and got less.",
  Apologize: "I'm sorry, {target}. I should have handled that differently.",
  AskForHelp: "I can't do this alone, {target}. Will you help me?",
  Refuse: "No, {target}. Not this time.",
  Comply: "Fine, {target}. We'll do it your way.",
  Withdraw: "I need a minute. I'll be back.",
  Propose: "We want the same thing, {target}. Let's work together.",
};

export function stubDialogue(
  moveId: MoveId,
  targetName?: string,
): string {
  const template = DIALOGUE_TEMPLATES[moveId] || "{target}...";
  return template.replace("{target}", targetName || "everyone");
}

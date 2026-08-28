import type {
  CharacterId,
  Move,
  MoveId,
  RelationshipField,
  WorldState,
} from "./viewTypes";

export type MenuRow = "Talk" | "Press" | "Warm" | "Move";

export interface MoveMeta {
  id: MoveId;
  label: string;
  needsTarget: boolean;
  blurb: string;
  row: MenuRow;
  /** Needs `args.topicId` to mean anything. */
  needsTopic?: boolean;
}

export const MOVE_META: Record<string, MoveMeta> = {
  // --- Talk ---------------------------------------------------------------
  Greet: { id: "Greet", label: "Greet", needsTarget: true, row: "Talk", blurb: "A friendly opening." },
  Talk: { id: "Talk", label: "Talk", needsTarget: true, row: "Talk", blurb: "Start or continue a conversation." },
  // Supersedes update 1's `AskAbout`: same evidence-transfer path, Track A's name.
  Ask: { id: "Ask", label: "Ask about", needsTarget: true, row: "Talk", needsTopic: true, blurb: "Ask them what they know." },
  RevealSecret: { id: "RevealSecret", label: "Reveal secret", needsTarget: true, row: "Talk", blurb: "Tell what you know." },
  AskForHelp: { id: "AskForHelp", label: "Ask for help", needsTarget: true, row: "Talk", blurb: "Request a favor." },
  Propose: { id: "Propose", label: "Propose", needsTarget: true, row: "Talk", blurb: "Suggest an alliance." },

  // --- Press --------------------------------------------------------------
  Confront: { id: "Confront", label: "Confront", needsTarget: true, row: "Press", blurb: "Call someone out directly." },
  Argue: { id: "Argue", label: "Argue", needsTarget: true, row: "Press", blurb: "Push a disagreement further." },
  Insult: { id: "Insult", label: "Insult", needsTarget: true, row: "Press", blurb: "Cut them down." },
  Mimic: { id: "Mimic", label: "Mimic", needsTarget: true, row: "Press", blurb: "Imitate someone pointedly." },
  Fight: { id: "Fight", label: "Fight", needsTarget: true, row: "Press", blurb: "Let it boil over. No taking it back." },
  SpreadRumor: { id: "SpreadRumor", label: "Spread rumor", needsTarget: true, row: "Press", blurb: "Pass along a damaging story." },
  Refuse: { id: "Refuse", label: "Refuse", needsTarget: true, row: "Press", blurb: "Turn someone down." },

  // --- Warm ---------------------------------------------------------------
  GiveGift: { id: "GiveGift", label: "Give gift", needsTarget: true, row: "Warm", blurb: "Offer something to win favor." },
  Hug: { id: "Hug", label: "Hug", needsTarget: true, row: "Warm", blurb: "Offer physical reassurance." },
  Comfort: { id: "Comfort", label: "Comfort", needsTarget: true, row: "Warm", blurb: "Support someone who is hurting." },
  Flirt: { id: "Flirt", label: "Flirt", needsTarget: true, row: "Warm", blurb: "Test the water." },
  Apologize: { id: "Apologize", label: "Apologize", needsTarget: true, row: "Warm", blurb: "Try to make peace." },
  Reassure: { id: "Reassure", label: "Reassure", needsTarget: true, row: "Warm", blurb: "Take the heat out of it." },
  Defend: { id: "Defend", label: "Defend", needsTarget: true, row: "Warm", blurb: "Take someone's side." },
  Comply: { id: "Comply", label: "Comply", needsTarget: true, row: "Warm", blurb: "Go along with it." },

  // --- Move ---------------------------------------------------------------
  GoTo: { id: "GoTo", label: "Go to", needsTarget: false, row: "Move", blurb: "Walk somewhere else." },
  Withdraw: { id: "Withdraw", label: "Withdraw", needsTarget: false, row: "Move", blurb: "Break off the conversation you're in." },
  Wait: { id: "Wait", label: "Wait", needsTarget: false, row: "Move", blurb: "Let the moment pass." },
};

export const MENU_ROWS: MenuRow[] = ["Talk", "Press", "Warm", "Move"];

/**
 * The menu is grouped into rows because the catalog outgrew the number keys.
 * `Terminal` maps 1-9 to the *open row*, not to a flat list — the merged
 * catalog is 24 moves and a flat list would leave most of them unreachable.
 * No row may exceed nine entries.
 */
export const MENU_MOVE_IDS: Record<MenuRow, MoveId[]> = {
  Talk: ["Greet", "Talk", "Ask", "RevealSecret", "AskForHelp", "Propose"],
  Press: ["Confront", "Argue", "Insult", "Mimic", "Fight", "SpreadRumor", "Refuse"],
  Warm: ["GiveGift", "Hug", "Comfort", "Flirt", "Apologize", "Reassure", "Defend", "Comply"],
  Move: ["GoTo", "Withdraw", "Wait"],
};

export function metaFor(id: MoveId): MoveMeta {
  return (
    MOVE_META[id] || { id, label: id, needsTarget: true, row: "Talk", blurb: "" }
  );
}

export interface MockEffect {
  field: RelationshipField;
  amount: number;
  onTarget: boolean;
}

/**
 * Rebalanced in update 1, then merged with Track A's expanded axes.
 *
 * Update 1's magnitudes are kept: every number was retuned once a decay pass
 * existed underneath them (`decayPass`), so spikes are allowed to be larger —
 * they no longer stay. Track A's `gratitude`, `jealousy` and `hate` terms are
 * layered on top of that, not averaged with it.
 *
 * `anger` is the hostility axis: it spikes hardest and decays fastest, which
 * is what lets a fight be a fight without permanently ending a relationship.
 * `hate` is the one that does not fade quickly — reserve it for real damage.
 * At least one move lowers every axis.
 */
export const MOCK_EFFECTS: Record<string, MockEffect[]> = {
  Greet: [{ field: "affection", amount: 3, onTarget: true }],
  Talk: [{ field: "trust", amount: 2, onTarget: true }],
  Ask: [{ field: "respect", amount: 2, onTarget: true }],
  Confront: [
    { field: "fear", amount: 8, onTarget: true },
    { field: "trust", amount: -6, onTarget: true },
    { field: "anger", amount: 10, onTarget: true },
  ],
  GiveGift: [
    { field: "gratitude", amount: 7, onTarget: true },
    { field: "affection", amount: 9, onTarget: true },
    { field: "trust", amount: 4, onTarget: true },
    { field: "anger", amount: -4, onTarget: true },
  ],
  SpreadRumor: [
    { field: "trust", amount: -10, onTarget: true },
    { field: "anger", amount: 6, onTarget: true },
    { field: "hate", amount: 3, onTarget: true },
  ],
  RevealSecret: [{ field: "trust", amount: 6, onTarget: true }],
  Defend: [
    { field: "gratitude", amount: 8, onTarget: true },
    { field: "affection", amount: 7, onTarget: true },
    { field: "respect", amount: 5, onTarget: true },
  ],
  Insult: [
    { field: "affection", amount: -10, onTarget: true },
    { field: "respect", amount: -4, onTarget: true },
    { field: "anger", amount: 18, onTarget: true },
    { field: "fear", amount: 4, onTarget: true },
    { field: "hate", amount: 4, onTarget: true },
  ],
  Apologize: [
    { field: "trust", amount: 8, onTarget: true },
    { field: "anger", amount: -12, onTarget: true },
    { field: "hate", amount: -2, onTarget: true },
  ],
  Reassure: [
    { field: "fear", amount: -10, onTarget: true },
    { field: "anger", amount: -6, onTarget: true },
    { field: "affection", amount: 4, onTarget: true },
  ],
  Hug: [
    { field: "affection", amount: 9, onTarget: true },
    { field: "anger", amount: -2, onTarget: true },
    { field: "fear", amount: -4, onTarget: true },
  ],
  Comfort: [
    { field: "gratitude", amount: 6, onTarget: true },
    { field: "affection", amount: 4, onTarget: true },
    { field: "fear", amount: -5, onTarget: true },
  ],
  Mimic: [
    { field: "respect", amount: -2, onTarget: true },
    { field: "anger", amount: 6, onTarget: true },
  ],
  Argue: [
    { field: "trust", amount: -4, onTarget: true },
    { field: "anger", amount: 12, onTarget: true },
  ],
  AskForHelp: [{ field: "respect", amount: 3, onTarget: true }],
  Refuse: [
    { field: "affection", amount: -5, onTarget: true },
    { field: "anger", amount: 8, onTarget: true },
    // Turning someone down spends whatever they felt they owed you.
    { field: "gratitude", amount: -4, onTarget: true },
  ],
  Comply: [
    { field: "gratitude", amount: 6, onTarget: true },
    { field: "respect", amount: 4, onTarget: true },
    { field: "anger", amount: -5, onTarget: true },
  ],
  Flirt: [
    { field: "affection", amount: 12, onTarget: true },
    { field: "fear", amount: -4, onTarget: true },
    // Being wanted quiets this particular insecurity. Jealousy ABOUT a third
    // party needs the volition layer — effects here are strictly pairwise.
    { field: "jealousy", amount: -3, onTarget: true },
  ],
  // Both directions. A fight is the one move where the actor pays too — the
  // aggressor is less frightened afterwards, not less angry.
  Fight: [
    { field: "trust", amount: -20, onTarget: true },
    { field: "affection", amount: -18, onTarget: true },
    { field: "respect", amount: -6, onTarget: true },
    { field: "fear", amount: 25, onTarget: true },
    { field: "anger", amount: 30, onTarget: true },
    { field: "hate", amount: 8, onTarget: true },
    { field: "trust", amount: -20, onTarget: false },
    { field: "affection", amount: -18, onTarget: false },
    { field: "respect", amount: -6, onTarget: false },
    { field: "fear", amount: 15, onTarget: false },
    { field: "anger", amount: 30, onTarget: false },
    { field: "hate", amount: 8, onTarget: false },
  ],
  Propose: [
    { field: "affection", amount: 6, onTarget: true },
    { field: "trust", amount: 5, onTarget: true },
  ],
  Withdraw: [],
  GoTo: [],
  Wait: [],
};

/** Flirting at someone who barely likes you is not flattering. */
const FLIRT_AWKWARD: MockEffect[] = [
  { field: "respect", amount: -6, onTarget: true },
  { field: "affection", amount: -2, onTarget: true },
  { field: "jealousy", amount: 3, onTarget: true },
];
export const FLIRT_WELCOME_AT = 30;

/**
 * The effect list for this move *in this world*. Static for everything except
 * `Flirt`, which has to be able to visibly land badly — a move that always
 * works is not a risk the player is taking.
 */
export function effectsFor(world: WorldState, move: Move): MockEffect[] {
  if (move.id === "Flirt" && move.target) {
    const rel = world.characters[move.target]?.relationships?.[move.actor];
    if (rel && rel.affection < FLIRT_WELCOME_AT) return FLIRT_AWKWARD;
  }
  return MOCK_EFFECTS[move.id] || [];
}

export function flirtLandedBadly(world: WorldState, move: Move): boolean {
  if (move.id !== "Flirt" || !move.target) return false;
  const rel = world.characters[move.target]?.relationships?.[move.actor];
  return Boolean(rel && rel.affection < FLIRT_WELCOME_AT);
}

/**
 * How much a witnessed move is worth remembering, before decay. Also what
 * ordinary-memory eviction sorts on.
 */
export const MOVE_IMPORTANCE: Record<string, number> = {
  Fight: 0.95,
  RevealSecret: 0.7,
  SpreadRumor: 0.7,
  Confront: 0.6,
  Argue: 0.6,
  Insult: 0.6,
  Defend: 0.6,
  Propose: 0.5,
  Flirt: 0.5,
  GiveGift: 0.4,
  Hug: 0.4,
  Comfort: 0.4,
  Mimic: 0.4,
  Apologize: 0.4,
  AskForHelp: 0.4,
  Ask: 0.3,
  Refuse: 0.4,
  Comply: 0.4,
  Reassure: 0.35,
  Talk: 0.2,
  Greet: 0.2,
  Withdraw: 0.2,
  GoTo: 0.1,
  Wait: 0.1,
};

export const DEFAULT_IMPORTANCE = 0.4;

/** Watching it happen to someone else is worth less than being in it. */
export const BYSTANDER_IMPORTANCE = 0.6;

/**
 * MAJOR events. A core memory is exempt from `MEMORY_CAP` and floored on
 * retrieval decay, so it is still reachable at turn 60.
 *
 * Membership is by move class, not by an importance threshold: "was this a
 * big deal" is a design statement, and hiding it behind a number means it
 * drifts every time someone tunes one.
 */
export const CORE_MOVES = new Set<MoveId>([
  "Fight",
  "RevealSecret",
  "SpreadRumor",
  "Propose",
]);

/** Anything inside an argument is worth keeping, whatever the move was. */
export const CORE_HEAT = 60;

export function isCoreMove(moveId: MoveId, heat: number): boolean {
  return CORE_MOVES.has(moveId) || heat >= CORE_HEAT;
}

/** How good or bad this was for the person it landed on. -1..1. */
export const MOVE_VALENCE: Record<string, number> = {
  Fight: -0.9,
  Insult: -0.8,
  SpreadRumor: -0.7,
  Mimic: -0.6,
  Confront: -0.6,
  Argue: -0.5,
  Refuse: -0.4,
  Withdraw: -0.2,
  Greet: 0.2,
  Talk: 0.2,
  Ask: 0.1,
  AskForHelp: 0.1,
  Comply: 0.4,
  Reassure: 0.5,
  Comfort: 0.6,
  Hug: 0.6,
  Defend: 0.6,
  Apologize: 0.6,
  Flirt: 0.5,
  GiveGift: 0.7,
  Propose: 0.6,
  RevealSecret: 0.5,
  GoTo: 0,
  Wait: 0,
};

/** How much this move heats an exchange. Negative cools it. */
export const MOVE_HEAT: Record<string, number> = {
  Insult: 25,
  Fight: 40,
  Argue: 20,
  Confront: 18,
  Mimic: 14,
  SpreadRumor: 12,
  Refuse: 10,
  Withdraw: -5,
  Comply: -15,
  Reassure: -20,
  Comfort: -18,
  Hug: -20,
  Apologize: -30,
  GiveGift: -10,
  Defend: -5,
};

/** Per-turn drift back down when nothing hostile happened. */
export const HEAT_DRIFT = 8;

export const HEAT_TENSE = 30;
export const HEAT_ARGUMENT = 60;
export const HEAT_BREAKING = 85;

export type HeatState = "calm" | "tense" | "argument" | "breaking";

export function heatState(heat: number): HeatState {
  if (heat >= HEAT_BREAKING) return "breaking";
  if (heat >= HEAT_ARGUMENT) return "argument";
  if (heat >= HEAT_TENSE) return "tense";
  return "calm";
}

/** Effect magnitudes scale with how hot the room already is. */
export function heatMultiplier(heat: number): number {
  const state = heatState(heat);
  if (state === "calm") return 1;
  if (state === "tense") return 1.25;
  return 1.5;
}

/** `Fight` is not available until things are already bad. */
export const FIGHT_ANGER_AT = 70;

export function canFight(
  world: WorldState,
  actor: CharacterId,
  target: CharacterId,
  heat: number,
): boolean {
  if (heat >= HEAT_ARGUMENT) return true;
  const rel = world.characters[actor]?.relationships?.[target];
  return Boolean(rel && rel.anger >= FIGHT_ANGER_AT);
}

/**
 * `{target}` is who is being ADDRESSED. `{subject}` is the third party a
 * three-party move is about, and reads as "them" when nobody was named.
 *
 * Conflating the two is not a wording nit: `SpreadRumor` and `Defend` both
 * substituted the listener into the subject slot, so Bob told Robin "Robin has
 * been talking" and Dana told Alice "leave Alice out of this". The bucketed
 * table in `ai/fallbacks.ts` already draws this distinction — these are the
 * lines the player reads with the server off, and they have to agree with it.
 */
const DIALOGUE_TEMPLATES: Record<string, string> = {
  Greet: "Good to see you, {target}. It's been a strange few days.",
  Talk: "Can we talk for a moment, {target}?",
  Ask: "{target} — what do you actually know about it?",
  Confront: "Don't play dumb, {target}. I know what you did.",
  GiveGift: "Here, {target}. I wanted you to have this.",
  SpreadRumor: "You didn't hear it from me, {target}, but there's been talk about {subject}.",
  RevealSecret: "There's something you should know, {target}. It's about {subject}.",
  Defend: "Leave {subject} out of this, {target} — they've done nothing wrong.",
  Insult: "Honestly, {target}, I expected better and got less.",
  Apologize: "I'm sorry, {target}. I should have handled that differently.",
  Reassure: "Breathe, {target}. Nobody here is coming for you.",
  Hug: "Come here, {target}.",
  Comfort: "You don't have to handle this alone, {target}.",
  Mimic: "Is that really how you want to sound, {target}?",
  Argue: "No, {target}. That's not how it happened.",
  AskForHelp: "I can't do this alone, {target}. Will you help me?",
  Refuse: "No, {target}. Not this time.",
  Comply: "Fine, {target}. We'll do it your way.",
  Flirt: "You're the only interesting thing about this week, {target}.",
  Fight: "That's it, {target}. I'm done being careful with you.",
  Withdraw: "I need a minute. I'll be back.",
  GoTo: "I'm not doing this here.",
  Propose: "We want the same thing, {target}. Let's work together.",
};

export function stubDialogue(
  moveId: MoveId,
  targetName?: string,
  subjectName?: string,
): string {
  const template = DIALOGUE_TEMPLATES[moveId] || "{target}...";
  return template
    .replace("{target}", targetName || "everyone")
    .replace("{subject}", subjectName || "them");
}

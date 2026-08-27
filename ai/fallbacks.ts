import type { MoveId, PendingUtterance } from "@sim/types";
import { relationshipTone } from "@/lib/format";

/**
 * Bucketed fallback lines: `cold | neutral | warm` x move.
 *
 * The keys are `relationshipTone()`'s three return values verbatim, so the tone
 * a line assumes is the tone the inspector shows. Do not add a fourth bucket
 * and do not rename these — there is exactly one bucketing scheme in this repo.
 *
 * These are what the player reads whenever the model stalls or the game runs
 * with no key at all, so the three buckets have to sound like three different
 * relationships. TRACK D owns the wording from here; the shape is fixed.
 *
 * `{target}` is who is being addressed. `{subject}` is the third party in the
 * three-party moves ("tell Alice about Bob") and reads as "them" when the
 * player didn't name one, so every line works either way.
 */

export type ToneBucket = "cold" | "neutral" | "warm";

const COLD: Record<string, string> = {
  AskAbout: "Don't pretend you're asking, {target}. You've already decided what you think.",
  Fight: "No — we're doing this now, {target}. I've swallowed it long enough.",
  Flirt: "You'd like that, wouldn't you, {target}. Pity.",
  Reassure: "Calm down, {target}. Nobody's interested in you enough to bother.",
  GoTo: "I'm not standing here for this.",
  Greet: "{target}. Didn't think I'd run into you.",
  Confront: "Save it, {target}. I stopped believing you a while ago.",
  GiveGift: "Here. Take it, {target}. Let's call it settled.",
  SpreadRumor:
    "Since you're asking, {target} — there's plenty being said about them, and none of it is kind.",
  RevealSecret:
    "I'll tell you once, {target}, and only because you'd find out anyway. It's about them.",
  Defend: "Leave them out of it, {target}. Your problem is with me.",
  Insult: "You've never once surprised me, {target}. Not once.",
  Apologize: "Fine. I'm sorry, {target}. Is that what you wanted?",
  AskForHelp: "I wouldn't ask if there were anyone else, {target}.",
  Refuse: "No. And don't ask me again, {target}.",
  Comply: "Have it your way, {target}. You usually do.",
  Withdraw: "I'm done here.",
  Propose: "I don't much like you, {target}, but we want the same thing.",
};

const NEUTRAL: Record<string, string> = {
  AskAbout: "{target} — what do you actually know about it? Straight answer.",
  Fight: "That's it, {target}. I'm done being careful with you.",
  Flirt: "You're the only interesting thing about this week, {target}.",
  Reassure: "Breathe, {target}. Nobody here is coming for you.",
  GoTo: "I need some air.",
  Greet: "Good to see you, {target}. It's been a strange few days.",
  Confront: "Don't play dumb, {target}. I know what you did.",
  GiveGift: "Here, {target}. I wanted you to have this.",
  SpreadRumor: "You didn't hear it from me, {target}, but there's been talk about them.",
  RevealSecret: "There's something you should know, {target}. It's about them.",
  Defend: "Leave them out of this, {target} — they've done nothing wrong.",
  Insult: "Honestly, {target}, I expected better and got less.",
  Apologize: "I'm sorry, {target}. I should have handled that differently.",
  AskForHelp: "I can't do this alone, {target}. Will you help me?",
  Refuse: "No, {target}. Not this time.",
  Comply: "Fine, {target}. We'll do it your way.",
  Withdraw: "I need a minute. I'll be back.",
  Propose: "We want the same thing, {target}. Let's work together.",
};

const WARM: Record<string, string> = {
  AskAbout: "{target}, you'd tell me if you knew. So — do you?",
  Fight: "I don't want to be saying this to you of all people, {target}, but here we are.",
  Flirt: "I've been finding excuses to be wherever you are, {target}. That's all.",
  Reassure: "Hey. {target}. Look at me — you're all right.",
  GoTo: "I'll be close by. Come find me.",
  Greet: "{target} — there you are. I was hoping you'd turn up.",
  Confront: "{target}, I need you to look at me and tell me the truth. That's all.",
  GiveGift: "I saw this and thought of you, {target}. No occasion.",
  SpreadRumor:
    "I wouldn't say this to anyone but you, {target} — people are talking about them.",
  RevealSecret:
    "You deserve to hear it from me first, {target}, before anyone else. It's about them.",
  Defend: "Not while I'm standing here, {target}. Leave them alone.",
  Insult: "I'm going to say something unkind, {target}, and I'll regret it later.",
  Apologize: "I'm sorry, {target}. Truly. I've hated how I left it.",
  AskForHelp: "You're the only one I'd trust with this, {target}.",
  Refuse: "I can't, {target}. I wish I could — but not this.",
  Comply: "All right, {target}. I trust you on this one.",
  Withdraw: "Give me a moment. I'll find you after.",
  Propose: "Between us, {target}, we could actually fix this. Say yes.",
};

export const FALLBACK_LINES: Record<ToneBucket, Record<string, string>> = {
  cold: COLD,
  neutral: NEUTRAL,
  warm: WARM,
};

export function toneFor(u: PendingUtterance): ToneBucket {
  // No target means no relationship, and `adapt.ts` hands us a zeroed one —
  // which scores `0 - 0 = 0`, i.e. `cold`, so `Withdraw` drew the cold bucket
  // every time regardless of the scene and its other two lines were dead code.
  if (!u.move.target) return "neutral";
  return relationshipTone(u.relationshipSnapshot) as ToneBucket;
}

export function fallbackLine(u: PendingUtterance): string {
  const table = FALLBACK_LINES[toneFor(u)] ?? FALLBACK_LINES.neutral;
  const template = table[u.move.id as MoveId] ?? "{target}...";
  return template
    .replace("{target}", u.targetName || "everyone")
    .replace("{subject}", u.subjectName || "them");
}

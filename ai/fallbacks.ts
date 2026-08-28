import type { MoveId, PendingUtterance } from "@ai/types";
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
  Greet: "{target}. Didn't think I'd run into you.",
  Talk: "Say what you came to say, {target}.",
  Ask: "Ask, {target}. I haven't promised an answer.",
  Confront: "Save it, {target}. I stopped believing you a while ago.",
  GiveGift: "Here. Take it, {target}. Let's call it settled.",
  SpreadRumor:
    "Since you're asking, {target} — there's plenty being said about them, and none of it is kind.",
  RevealSecret:
    "I'll tell you once, {target}, and only because you'd find out anyway. It's about them.",
  Defend: "Leave them out of it, {target}. Your problem is with me.",
  Help: "I'll do what I promised, {target}. Don't read more into it.",
  Insult: "You've never once surprised me, {target}. Not once.",
  Apologize: "Fine. I'm sorry, {target}. Is that what you wanted?",
  AskForHelp: "I wouldn't ask if there were anyone else, {target}.",
  Hug: "Don't make more of this than it is, {target}.",
  Comfort: "I know things are bad, {target}. I'm still here.",
  Flirt: "Careful, {target}. Charm won't fix this.",
  Mimic: "Does that sound familiar, {target}? It should.",
  Refuse: "No. And don't ask me again, {target}.",
  Argue: "You're wrong, {target}, and I'm done pretending otherwise.",
  Fight: "Take one more step, {target}. See what happens.",
  Comply: "Have it your way, {target}. You usually do.",
  Withdraw: "I'm done here.",
  Propose: "I don't much like you, {target}, but we want the same thing.",
};

const NEUTRAL: Record<string, string> = {
  Greet: "Good to see you, {target}. It's been a strange few days.",
  Talk: "Can we talk for a moment, {target}?",
  Ask: "I need to ask you something, {target}.",
  Confront: "Don't play dumb, {target}. I know what you did.",
  GiveGift: "Here, {target}. I wanted you to have this.",
  SpreadRumor: "You didn't hear it from me, {target}, but there's been talk about them.",
  RevealSecret: "There's something you should know, {target}. It's about them.",
  Defend: "Leave them out of this, {target} — they've done nothing wrong.",
  Help: "I'll help, {target}. Let's get it done.",
  Insult: "Honestly, {target}, I expected better and got less.",
  Apologize: "I'm sorry, {target}. I should have handled that differently.",
  AskForHelp: "I can't do this alone, {target}. Will you help me?",
  Hug: "Come here, {target}.",
  Comfort: "You don't have to carry this alone, {target}.",
  Flirt: "You know, {target}, you're hard not to notice.",
  Mimic: "Is that really how you want to sound, {target}?",
  Refuse: "No, {target}. Not this time.",
  Argue: "No, {target}. That's not how it happened.",
  Fight: "Enough talking, {target}.",
  Comply: "Fine, {target}. We'll do it your way.",
  Withdraw: "I need a minute. I'll be back.",
  Propose: "We want the same thing, {target}. Let's work together.",
};

const WARM: Record<string, string> = {
  Talk: "I've been wanting a quiet moment with you, {target}.",
  Ask: "Can I ask you something honestly, {target}?",
  Hug: "Come here, {target}. I've got you.",
  Comfort: "Stay with me, {target}. You don't have to face this alone.",
  Flirt: "You make it very difficult to look away, {target}.",
  Mimic: "You do that little thing when you're nervous, {target}.",
  Argue: "I care about you, {target}, but I can't agree with this.",
  Fight: "Please stop, {target}. I don't want this to become a fight.",
  Greet: "{target} — there you are. I was hoping you'd turn up.",
  Confront: "{target}, I need you to look at me and tell me the truth. That's all.",
  GiveGift: "I saw this and thought of you, {target}. No occasion.",
  SpreadRumor:
    "I wouldn't say this to anyone but you, {target} — people are talking about them.",
  RevealSecret:
    "You deserve to hear it from me first, {target}, before anyone else. It's about them.",
  Defend: "Not while I'm standing here, {target}. Leave them alone.",
  Help: "Of course I'll help, {target}. You never had to wonder.",
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

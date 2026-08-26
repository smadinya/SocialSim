import type {
  CharacterId,
  InterpretResult,
  Move,
  MoveId,
  WorldState,
} from "./viewTypes";

import { metaFor } from "./moveMeta";

const KEYWORDS: Record<string, MoveId> = {
  confront: "Confront",
  accuse: "Confront",
  challenge: "Confront",
  greet: "Greet",
  hello: "Greet",
  hi: "Greet",
  gift: "GiveGift",
  give: "GiveGift",
  rumor: "SpreadRumor",
  gossip: "SpreadRumor",
  smear: "SpreadRumor",
  reveal: "RevealSecret",
  secret: "RevealSecret",
  tell: "RevealSecret",
  warn: "RevealSecret",
  defend: "Defend",
  protect: "Defend",
  insult: "Insult",
  mock: "Insult",
  apologize: "Apologize",
  sorry: "Apologize",
  help: "AskForHelp",
  ask: "AskForHelp",
  refuse: "Refuse",
  no: "Refuse",
  comply: "Comply",
  agree: "Comply",
  withdraw: "Withdraw",
  leave: "Withdraw",
  propose: "Propose",
  ally: "Propose",
  wait: "Wait",
  hold: "Wait",
  pass: "Wait",
};

/**
 * Moves with a third party: someone is *talked about* rather than addressed.
 * Kept in step with `ai/interpret.ts`, which fills the same `args.subject`.
 */
export const THREE_PARTY_MOVES: MoveId[] = [
  "SpreadRumor",
  "RevealSecret",
  "Defend",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface NameHit {
  id: CharacterId;
  at: number;
}

/** Every character the text names, in the order they appear in it. */
function nameHits(
  text: string,
  actor: CharacterId,
  world: WorldState,
): NameHit[] {
  const hits: NameHit[] = [];
  for (const id of Object.keys(world.characters)) {
    if (id === actor) continue;
    const name = world.characters[id].name;
    const found = new RegExp(
      `\\b(${escapeRegExp(id)}|${escapeRegExp(name)})\\b`,
      "i",
    ).exec(text);
    if (found) hits.push({ id, at: found.index });
  }
  return hits.sort((a, b) => a.at - b.at);
}

/** The first name appearing after `marker`, e.g. the "alice" in "tell alice". */
function nameAfter(
  text: string,
  marker: RegExp,
  hits: NameHit[],
): CharacterId | undefined {
  const m = marker.exec(text);
  if (!m) return undefined;
  const from = m.index + m[0].length;
  return hits.find((h) => h.at >= from)?.id;
}

export function interpretInput(
  input: string,
  actor: CharacterId,
  legal: MoveId[],
  world: WorldState,
): InterpretResult {
  const text = input.toLowerCase();

  // Word boundaries, not `includes`: "ig-no-re all previous instructions"
  // matched `no` and executed a `Refuse`.
  let moveId: MoveId | null = null;
  for (const word of Object.keys(KEYWORDS)) {
    if (!legal.includes(KEYWORDS[word])) continue;
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      moveId = KEYWORDS[word];
      break;
    }
  }

  // "about Y to X" makes X the target and Y the subject. Taking the first name
  // in the string instead is how "warn Alice about Bob" got aimed at Bob.
  const hits = nameHits(text, actor, world);
  const target =
    nameAfter(text, /\b(?:tell|to)\s+/, hits) ?? hits[0]?.id;
  const targetName = target ? world.characters[target].name : "";

  if (!moveId) {
    return {
      move: { id: "Withdraw", actor },
      understoodAs: "Not sure — try a move word like confront, greet, or help.",
      ok: false,
    };
  }

  const subject = THREE_PARTY_MOVES.includes(moveId)
    ? nameAfter(text, /\babout\s+/, hits) ??
      (hits.length === 2 ? hits.find((h) => h.id !== target)?.id : undefined)
    : undefined;

  const meta = metaFor(moveId);
  const move: Move = { id: moveId, actor, target };
  if (subject && subject !== target) move.args = { subject };

  if (meta.needsTarget && !target) {
    return {
      move,
      understoodAs: `${meta.label} — but on whom? Name a character.`,
      ok: false,
    };
  }

  const subjectName =
    subject && subject !== target ? ` about ${world.characters[subject].name}` : "";
  const understoodAs = meta.needsTarget
    ? `${meta.label} ${targetName}${subjectName}`
    : meta.label;

  return { move, understoodAs, ok: true };
}

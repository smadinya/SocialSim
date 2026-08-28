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
  fight: "Fight",
  brawl: "Fight",
  flirt: "Flirt",
  charm: "Flirt",
  reassure: "Reassure",
  calm: "Reassure",
  comfort: "Reassure",
  apologize: "Apologize",
  sorry: "Apologize",
  help: "AskForHelp",
  ask: "AskAbout",
  about: "AskAbout",
  refuse: "Refuse",
  no: "Refuse",
  yes: "Comply",
  comply: "Comply",
  agree: "Comply",
  sure: "Comply",
  withdraw: "Withdraw",
  leave: "Withdraw",
  propose: "Propose",
  alliance: "Propose",
  ally: "Propose",
  go: "GoTo",
  walk: "GoTo",
  wait: "Wait",
  hold: "Wait",
  pass: "Wait",
};

/** Answers to a live request. These aim at the asker, not at the selection. */
export const ANSWER_WORDS: Record<string, MoveId> = {
  yes: "Comply",
  sure: "Comply",
  agree: "Comply",
  comply: "Comply",
  ok: "Comply",
  okay: "Comply",
  no: "Refuse",
  refuse: "Refuse",
  never: "Refuse",
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

/** The first location the text names, matched on id or display name. */
function locationNamed(
  text: string,
  world: WorldState,
): string | undefined {
  for (const id of Object.keys(world.locations ?? {})) {
    const name = world.locations[id].name;
    if (
      new RegExp(`\\b(${escapeRegExp(id)}|${escapeRegExp(name.toLowerCase())})\\b`, "i").test(
        text,
      )
    ) {
      return id;
    }
  }
  return undefined;
}

/** The first topic the text names, matched on id or label. */
function topicNamed(text: string, world: WorldState): string | undefined {
  for (const id of Object.keys(world.topics ?? {})) {
    const label = world.topics[id].label.toLowerCase();
    if (text.includes(id) || text.includes(label)) return id;
    // "the leaked plan" should also be found by "leak" and by "plan".
    const words = label.split(/\s+/).filter((word) => word.length > 3);
    if (words.some((word) => new RegExp(`\\b${escapeRegExp(word)}`).test(text))) {
      return id;
    }
  }
  return undefined;
}

export function interpretInput(
  input: string,
  actor: CharacterId,
  legal: MoveId[],
  world: WorldState,
): InterpretResult {
  const text = input.toLowerCase();

  // A bare "yes" answers the person who asked, not whoever happens to be
  // selected in the menu. Without this the only way to accept help was to
  // pick Comply and re-target by hand, and "sure" targeted the wrong person.
  const request = (world.pendingRequests ?? []).find((r) => r.to === actor);
  if (request) {
    for (const word of Object.keys(ANSWER_WORDS)) {
      if (!new RegExp(`\\b${word}\\b`).test(text)) continue;
      const answer = ANSWER_WORDS[word];
      if (!legal.includes(answer)) continue;
      // Naming someone else means they meant that, not the pending ask.
      const named = nameHits(text, actor, world);
      if (named.length > 0 && named[0].id !== request.from) break;
      return {
        move: { id: answer, actor, target: request.from },
        understoodAs: `${metaFor(answer).label} ${world.characters[request.from]?.name ?? request.from}`,
        ok: true,
      };
    }
  }

  // Word boundaries, not `includes`: "ig-no-re all previous instructions"
  // matched `no` and executed a `Refuse`.
  //
  // The winner is the keyword that appears EARLIEST IN THE INPUT, not the one
  // that appears earliest in this table. Table order made "just ask, don't
  // fight" a `Fight`, because `fight` is declared above `ask` — the player's
  // own word order is the only ordering they can see, so it has to be the one
  // that decides. Longer keywords win a tie, so "ally" beats a stray "all".
  let moveId: MoveId | null = null;
  let bestAt = Infinity;
  let bestLength = 0;
  for (const word of Object.keys(KEYWORDS)) {
    if (!legal.includes(KEYWORDS[word])) continue;
    const found = new RegExp(`\\b${word}\\b`).exec(text);
    if (!found) continue;
    if (found.index < bestAt || (found.index === bestAt && word.length > bestLength)) {
      moveId = KEYWORDS[word];
      bestAt = found.index;
      bestLength = word.length;
    }
  }

  // "go to the library" is a destination, not a person. Resolved before the
  // target logic below, which would otherwise ask "on whom?".
  if (moveId === "GoTo" || (!moveId && locationNamed(text, world))) {
    const where = locationNamed(text, world);
    if (where) {
      return {
        move: { id: "GoTo", actor, args: { location: where } },
        understoodAs: `Go to ${world.locations[where].name}`,
        ok: true,
      };
    }
    if (moveId === "GoTo") {
      return {
        move: { id: "GoTo", actor },
        understoodAs: "Go where? Name a room.",
        ok: false,
      };
    }
  }

  // "about Y to X" makes X the target and Y the subject. Taking the first name
  // in the string instead is how "warn Alice about Bob" got aimed at Bob.
  const hits = nameHits(text, actor, world);
  const target =
    nameAfter(text, /\b(?:tell|to)\s+/, hits) ?? hits[0]?.id;
  const targetName = target ? world.characters[target].name : "";

  if (!moveId) {
    // `Wait`, not `Withdraw`. Both callers gate on `ok`, so this move is never
    // executed today — but it is the value handed back for "I didn't
    // understand you", and `Withdraw` now breaks off a conversation. A
    // failure-to-parse sentinel should be the move that does nothing.
    return {
      move: { id: "Wait", actor },
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

  const topicId = meta.needsTopic ? topicNamed(text, world) : undefined;
  if (topicId) move.args = { ...(move.args ?? {}), topicId };

  if (meta.needsTarget && !target) {
    return {
      move,
      understoodAs: `${meta.label} — but on whom? Name a character.`,
      ok: false,
    };
  }

  const subjectName =
    subject && subject !== target ? ` about ${world.characters[subject].name}` : "";
  const topicName = topicId ? ` about ${world.topics[topicId].label}` : "";
  const understoodAs = meta.needsTarget
    ? `${meta.label} ${targetName}${topicName || subjectName}`
    : meta.label;

  return { move, understoodAs, ok: true };
}

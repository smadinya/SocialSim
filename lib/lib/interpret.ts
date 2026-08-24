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
  reveal: "RevealSecret",
  secret: "RevealSecret",
  tell: "RevealSecret",
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
};

export function interpretInput(
  input: string,
  actor: CharacterId,
  legal: MoveId[],
  world: WorldState,
): InterpretResult {
  const text = input.toLowerCase();

  let moveId: MoveId | null = null;
  for (const word of Object.keys(KEYWORDS)) {
    if (text.includes(word) && legal.includes(KEYWORDS[word])) {
      moveId = KEYWORDS[word];
      break;
    }
  }

  let target: CharacterId | undefined;
  let targetName = "";
  for (const id of Object.keys(world.characters)) {
    if (id === actor) continue;
    const name = world.characters[id].name.toLowerCase();
    if (text.includes(id) || text.includes(name)) {
      target = id;
      targetName = world.characters[id].name;
      break;
    }
  }

  if (!moveId) {
    return {
      move: { id: "Withdraw", actor },
      understoodAs: "Not sure — try a move word like confront, greet, or help.",
      ok: false,
    };
  }

  const meta = metaFor(moveId);
  const move: Move = { id: moveId, actor, target };

  if (meta.needsTarget && !target) {
    return {
      move,
      understoodAs: `${meta.label} — but on whom? Name a character.`,
      ok: false,
    };
  }

  const understoodAs = meta.needsTarget
    ? `${meta.label} ${targetName}`
    : meta.label;

  return { move, understoodAs, ok: true };
}

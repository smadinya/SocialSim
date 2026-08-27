import type { Memory, PendingUtterance, RelationshipAxis } from "@sim/types";
import { REL_FIELDS } from "@/lib/format";

/**
 * Realization prompt. Edit freely — Track D owns the wording, and no call logic
 * lives in this file.
 *
 * TWO RULES THAT ARE NOT WORDING:
 *
 * 1. Send deltas, not just values. "trust 28" and "trust 28, down from 44 this
 *    turn" are different lines.
 * 2. Send beliefs, never ground truth. Everything below comes off the
 *    `PendingUtterance` — the speaker's own view. This function never takes a
 *    `WorldState`, so there is nothing here to reach into for "a bit more
 *    context" about a third party. `ai/__tests__/prompts.test.ts` asserts it.
 * 3. A topic reaches the prompt as a LABEL and nothing else. `Evidence.claim`
 *    is the one piece of shared ground truth in the world; a speaker who has
 *    not been told a fact must not be able to say it, and the only way to
 *    guarantee that is for the claims never to be in the prompt at all.
 */

function axisLine(u: PendingUtterance): string {
  const rel = u.relationshipSnapshot;
  return REL_FIELDS.map((f) => {
    const axis = f as RelationshipAxis;
    const delta = rel.lastDelta[axis];
    if (delta === undefined || delta === 0) return `${axis} ${rel[axis]}`;
    const dir = delta > 0 ? "up" : "down";
    return `${axis} ${rel[axis]} (${dir} from ${rel[axis] - delta} this turn)`;
  }).join(", ");
}

function memoryLine(m: Memory): string {
  const tier = m.tier === "direct" ? "" : ` [${m.tier}]`;
  return `- turn ${m.turn}${tier}: ${m.description}`;
}

export function realizePrompt(u: PendingUtterance): string {
  const target = u.targetName;
  const memories = u.retrievedMemories.length
    ? u.retrievedMemories.map(memoryLine).join("\n")
    : "- (nothing relevant comes to mind)";
  const beliefs = u.speakerBeliefs.length
    ? u.speakerBeliefs
        .map((b) => `- ${b.description} (confidence ${b.confidence})`)
        .join("\n")
    : "- (no strong beliefs about this)";
  const flags = u.relationshipSnapshot.flags.length
    ? u.relationshipSnapshot.flags.join(", ")
    : "none";

  return [
    "You write one line of dialogue for a character in a social simulation.",
    "You do not decide what happens. The move below has already been resolved by the engine.",
    "",
    `CHARACTER: ${u.speakerName}`,
    `TRAITS: ${u.traits.join(", ") || "unremarkable"}`,
    `MOOD: ${u.mood}`,
    "",
    target
      ? `HOW ${u.speakerName.toUpperCase()} SEES ${target.toUpperCase()}: ${axisLine(u)}`
      : `RELATIONSHIP: not directed at anyone`,
    `FLAGS: ${flags}`,
    "",
    "WHAT THEY BELIEVE (may be wrong — this is their view, not the truth):",
    beliefs,
    "",
    "WHAT THEY ARE REMEMBERING RIGHT NOW:",
    memories,
    "",
    ...(u.conversationBeats.length
      ? [
          "THIS CONVERSATION SO FAR (oldest first):",
          ...u.conversationBeats.map((b) => `- ${b}`),
          "",
        ]
      : []),
    ...(u.topicLabel ? [`THEY ARE TALKING ABOUT: ${u.topicLabel}`] : []),
    ...(u.heat >= 60
      ? ["THIS IS AN ARGUMENT. It has already gone further than either meant it to."]
      : u.heat >= 30
        ? ["THE MOOD IS TENSE. Neither of them is relaxed."]
        : []),
    "",
    `THE MOVE: ${u.move.id}${target ? ` toward ${target}` : ""} (turn ${u.turn})`,
    ...(u.subjectName
      ? [`ABOUT: ${u.subjectName} — they are being talked about, not addressed.`]
      : []),
    "",
    "Write what they say out loud. Constraints:",
    "- One or two sentences. No stage directions in `line`.",
    `- Only ${u.speakerName} speaks. Do not write anyone else's reply.`,
    "- Name only people mentioned above. Do not invent characters or events.",
    "- Let the relationship numbers and the deltas shape the tone, but never say a number.",
    "- If a conversation is already in progress, continue it. Do not re-introduce yourself.",
    "",
    'Respond as JSON: {"line": "...", "deliveryNote": "a few words on delivery"}',
  ].join("\n");
}

/** Gemini `responseSchema` for the realization call. */
export const REALIZE_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    line: { type: "STRING" },
    deliveryNote: { type: "STRING" },
  },
  required: ["line"],
} as const;

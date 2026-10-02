import type { PendingUtterance, RealizedLine } from "@sim/types";
import { REALIZE_RESPONSE_SCHEMA, realizePrompt } from "@ai/prompts/realize";
import { cacheGet, cacheKey, cacheSet } from "@ai/cache";
import { generateJson, isRetryable, mockMode } from "@ai/client";
import { RealizedLineSchema } from "@ai/schemas";
import { fallbackLine } from "@ai/fallbacks";

/**
 * A character says something. One call, one line, no state written.
 *
 * Mock -> cache -> model -> Zod -> hallucination check -> retry once -> fallback.
 * The game stays playable with the network unplugged at every step.
 */
export async function realize(u: PendingUtterance): Promise<RealizedLine> {
  if (mockMode()) return { line: fallbackLine(u) };

  const key = cacheKey(u);
  const hit = cacheGet(key);
  if (hit) return hit;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const prompt = realizePrompt(u);
      const raw = await generateJson(prompt, REALIZE_RESPONSE_SCHEMA);
      const parsed = RealizedLineSchema.safeParse(raw);
      if (!parsed.success) continue;
      if (namesUnknownCharacter(parsed.data.line, prompt, u.castNames)) continue;
      cacheSet(key, parsed.data);
      return parsed.data;
    } catch (error) {
      // Timeout, overload, bad JSON — one more shot, then fall back.
      if (!isRetryable(error)) break;
      // Retrying a 503 instantly just hits the same overloaded window.
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  return { line: fallbackLine(u) };
}

/**
 * The most common way a model invents knowledge a character doesn't have: it
 * names someone the prompt never mentioned.
 *
 * Tested against the assembled prompt rather than a precomputed allow-list,
 * because the two drift: beliefs and memory descriptions name people who are
 * neither in the scene nor a memory's actor or target, and rejecting a line
 * for using context we deliberately sent is a retry that can never succeed.
 */
/** A character named after a pronoun can't be told apart from the pronoun.
 *  The player is literally named "You" today — give them a real name and this
 *  set stops mattering. */
const PRONOUNS = new Set(["i", "me", "we", "us", "you", "he", "she", "they", "it"]);

export function namesUnknownCharacter(
  line: string,
  prompt: string,
  castNames: string[],
): boolean {
  const said = line.toLowerCase();
  const sent = prompt.toLowerCase();
  return castNames.some((name) => {
    if (PRONOUNS.has(name.toLowerCase())) return false;
    const word = new RegExp(`\\b${escapeRegExp(name.toLowerCase())}\\b`);
    return word.test(said) && !word.test(sent);
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

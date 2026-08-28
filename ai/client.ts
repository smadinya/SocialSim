import { GoogleGenAI, ThinkingLevel } from "@google/genai";

/**
 * Server-side only. `GEMINI_API_KEY` is never prefixed `NEXT_PUBLIC_` and is
 * read here and nowhere else.
 */
if (typeof window !== "undefined") {
  throw new Error("ai/client is server-side only — never import it from a component");
}

// Model names churn — `gemini-2.5-flash` was already retired for new keys by
// the time this shipped, and the API's own 404 named the replacement. If calls
// start 404ing, check AI Studio and set GEMINI_MODEL rather than editing this.
//
// Lite over full flash on purpose: ~1.2s vs ~6.5s for one line of dialogue, a
// fraction of the tokens, and the free tier allows far more of them per day
// (full flash is 20 requests/day, which is under one playthrough). Quality is
// indistinguishable at this length. GEMINI_MODEL=gemini-3.6-flash to compare.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
// Measured against the API with no app code involved, the distribution is
// bimodal: ~0.7-1.2s normally, ~26-30s on a stall, and nothing in between. A
// 15s deadline plus a retry meant a worst case of 30s of frozen UI ending in a
// stub line anyway. There is nothing between 6s and 26s to catch.
function configuredTimeoutMs(): number {
  const configured = Number(process.env.GEMINI_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1000 && configured <= 60000
    ? Math.round(configured)
    : 12000;
}

const TIMEOUT_MS = configuredTimeoutMs();

/**
 * Mock mode is the default. `MOCK_LLM=1` forces it; no key means it regardless,
 * so the game is playable with the network unplugged and with no setup.
 */
export function mockMode(): boolean {
  if (process.env.MOCK_LLM === "1") return true;
  return !process.env.GEMINI_API_KEY;
}

let client: GoogleGenAI | null = null;
function genai(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

// --- cost, measured per tick ---------------------------------------------
// A comfortable per-call number and an unaffordable per-tick number are
// entirely compatible, so the aggregate is the one that gets recorded.
//
// Today's ceiling is four moves per tick — the player, two autonomous NPCs
// (`runTick` breaks at `autonomousCount >= 2`) and one reply to the player —
// and realistically fewer, since only witnessed moves produce a call at all.
// RE-MEASURE the day Track A lifts that cap: a number taken now understates
// the real ceiling.
//
// ponytail: module-global, so it's per-process and racy across concurrent
// requests. Good enough to size the bill; use a real metrics sink if it ever
// has to be exact.

export interface TickCost {
  calls: number;
  ms: number;
  tokens: number;
}

const zero = (): TickCost => ({ calls: 0, ms: 0, tokens: 0 });

let current: TickCost | null = null;
let worst: TickCost = zero();

export function beginTick(): void {
  current = zero();
}

export function endTick(): TickCost {
  const done = current ?? zero();
  current = null;
  // Worst by wall clock, not tokens: a tick that burned 20s on timeouts and
  // returned nothing is the worst case a player actually feels.
  if (done.ms > worst.ms) worst = done;
  return done;
}

export function worstTick(): TickCost {
  return { ...worst };
}

function record(ms: number, tokens: number): void {
  if (!current) return;
  current.calls += 1;
  // `performance.now()` is fractional; nobody needs a nanosecond in a log line.
  current.ms += Math.round(ms);
  current.tokens += tokens;
}

/** Failures used to be invisible: no record, no log, a silent fallback line
 *  indistinguishable from mock mode. That is how a dead model name went
 *  unnoticed through a whole play session. */
export interface CallFailure {
  when: string;
  message: string;
}

let lastFailure: CallFailure | null = null;

export function lastCallFailure(): CallFailure | null {
  return lastFailure;
}

/** Our own tag, set at the throw site. Vendor error strings churn; this doesn't. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`model call exceeded ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * An allow-list, not a deny-list. This used to return `true` for everything
 * except 429 — including timeouts, malformed JSON and 400s, none of which get
 * better on a second identical request. 503 "high demand" is the one class
 * worth another shot.
 *
 * Retrying a timeout is what turned a 15s stall into a 30s one and still ended
 * on a fallback line.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof TimeoutError) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /\b503\b|UNAVAILABLE|overloaded/i.test(message);
}

// --- the one call ---------------------------------------------------------

/** Structured output, then Zod at the call site. Throws on timeout or refusal. */
export async function generateJson(
  prompt: string,
  responseSchema: Record<string, unknown>,
): Promise<unknown> {
  const started = performance.now();
  try {
    const response = await genai().models.generateContent({
      model: MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema,
        // One line of dialogue does not need a reasoning pass. LOW is ~3.5x
        // faster and ~6x cheaper than the default with no quality loss here.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      },
    });
    record(performance.now() - started, response.usageMetadata?.totalTokenCount ?? 0);

    const text = response.text;
    if (!text) throw new Error("empty model response");
    return JSON.parse(text);
  } catch (error) {
    // Count the attempt, then make the failure loud. A fallback line is a
    // correct outcome; a fallback line nobody knows about is a bug.
    const elapsed = performance.now() - started;
    record(elapsed, 0);

    // Tag the timeout here, where we know both the signal and the clock, rather
    // than regex-matching the vendor's abort message downstream.
    const tagged =
      (error instanceof Error && error.name === "AbortError") ||
      elapsed >= TIMEOUT_MS
        ? new TimeoutError(TIMEOUT_MS)
        : error;

    const message = tagged instanceof Error ? tagged.message : String(tagged);
    lastFailure = { when: new Date().toISOString(), message };
    const detail = `[ai] ${MODEL} call failed: ${message.slice(0, 300)}; using deterministic fallback`;
    if (tagged instanceof TimeoutError) console.info(detail);
    else console.warn(detail);
    throw tagged;
  }
}

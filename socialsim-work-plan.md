# SocialSim AI — Team Work Plan

**Stack:** TypeScript (rules) · Next.js (app) · Google AI Studio / Gemini via `@google/genai` (dialogue)

**Team:** Anne Z, William S, Andy Z, + 1 — fill in owners below.

**Companion doc:** `claude/socialsim-relationships-memory.md` — the relationship & memory subsystem spec. This plan says who builds what; that spec says how relationships and memory actually work. Track B's section is written against it.

> **That file is not in the repo yet.** Track B's retrieval scorer, prompt assembly, and both of its correctness tests cite its §5 and §6, and none of them can be built without it. Committing it is Track B's first blocker — ahead of the Gemini client.

> **Revision note.** This revision folds the relationship & memory subsystem into the multi-actor world-sim plan. If you are reading a copy whose seam says `tick(w, playerMove)` with a *required* player move, or that scopes the cast to "3–5 characters", you have the older fork — see *What changed in this revision* at the bottom for the delta.

---

## Design note: this is a world sim, not a player-vs-NPC sim

The whole point of the project is that interesting things happen whether or not the player is looking. A tick is not "player acts, one NPC reacts." A tick is: **every** character who clears a motivation threshold — the player included, if they acted — proposes a move, and the engine resolves all of them together before anything reaches the screen.

Concretely: while the player is telling Alice a rumor about Bob, Bob can independently be proposing to Calum in the same tick. Alice's mood going into her conversation with the player should already reflect that, or reflect it a moment later when she finds out — not be blind to a world that's supposedly running underneath her.

This has two consequences that show up throughout the plan below:

1. **5 characters, not 3.** Alice/Bob/Player was fine for a mockup with one NPC-NPC pair. A cast where autonomous interactions are the *point* needs enough characters that those interactions have room to be interesting — rivalries, alliances, triangles. Relationships are directed and pairwise, so 5 characters means 20 directed relationship pairs, each now carrying four axes.
2. **Multi-actor resolution is core engine logic, not a stretch goal.** Ordering, conflicts, and "does the player's move still make sense after an NPC's move already changed the target's mood this tick" have to be designed into `tick()` from the start, not patched in after G1.

---

## Where the code actually is today

Everything below this section is the target. This is the ground truth, so nobody re-plans work that already shipped or builds against a seam that doesn't exist yet.

| Track | State |
|---|---|
| **C — Frontend** | Effectively at G1. Four panels including the event feed, streaming dialogue, animated relationship deltas, save/load/export/import, keyboard nav, free-text input with an "I understood that as" confirmation. Renders with the server off. |
| **A — Simulation core** | Scaffolded, not load-bearing. `sim/src/types.ts` is real. `isLegalMove`, `getLegalMoves`, `determineObservers`, `validateCognitionPatch` and `applyCognitionPatch` are TODO stubs. No volition scoring. `sim/package.json` declares vitest; there are no tests. |
| **B — AI integration** | Not started. No `@google/genai`, no Zod, no prompts, and `MOCK_LLM` appears in `env.local.example` and in this document but is read by **zero lines of code**. |
| **D — Content & design** | 5-character fixture with all four axes, 13 moves with effect tables, one scenario. No fallback line table, no memory templates, no context-multiplier rules, no baselines or flags. |

**The engine you are playing is `lib/mockEngine.ts`, not `sim/`.** It already resolves the player's move plus up to two autonomous NPC moves per tick off a seeded RNG, orders them deterministically, applies clamped effects, writes memories to observers only, and routes unwitnessed moves into the event feed. `/api/turn` calls `simTick`, discards the result, and falls through to the mock. Track A's first job is to make `sim/` do what the mock already does — then go past it.

**Directory names.** The repo is `sim/` (aliased `@sim/*`) plus an app-root `lib/`. There is no `packages/`. Track B's package is `ai/`, aliased `@ai/*`. Don't scaffold a second tree because an older draft of this document said `packages/`.

---

## How the work splits

Four tracks, chosen so that each person owns a layer with a hard boundary around it. Nobody should need to edit someone else's files to make progress.

| Track | Owns | Owner |
|---|---|---|
| **A — Simulation Core** | State schema, multi-actor tick loop, volition rules engine, move effects, context multipliers, decay, conflict resolution | |
| **B — AI Integration** | Gemini calls, prompts, memory retrieval, action interpretation, cost control for N autonomous actors | |
| **C — Frontend** | Next.js app, terminal UI, streaming, event feed, save/load | |
| **D — Content & Design** | Characters (5), moves, rule tuning, fallback lines, scenario, playtesting, QA | |

Track D is the one people undervalue on projects like this. It's also the one that decides whether the game is fun. Give it to someone who will actually play the thing fifty times, not to whoever is left over. Note that the relationship & memory subsystem roughly doubled Track D's content budget — see that section.

---

## Rule zero: contracts before code

**This blocks all four tracks. Nothing else starts until it's done.** Everyone in a room, write `sim/src/types.ts` together, commit it, and treat it as frozen until someone has a concrete reason to change it. Changes after that need a heads-up to all four people, because every track imports it.

Once that file exists, all four tracks can run in parallel against stubs:

- Track A implements the real engine behind those types.
- Track B implements the real LLM calls behind those types, using a fake `WorldState` fixture.
- Track C builds the UI against a hard-coded `WorldState` JSON file.
- Track D writes rule and move data as plain objects conforming to those types.

After this one shared task, nobody blocks on anybody until integration. That's the whole point of paying for it up front.

### The seam

```ts
// sim/src/types.ts — the shared contract

export type CharacterId = string;
export type RelationshipAxis = 'trust' | 'affection' | 'respect' | 'fear';

export interface WorldState {
  turn: number;
  clock: string;                       // "Day 3 - 14:25"
  characters: Record<CharacterId, Character>;
  scene: SceneState;
  rngSeed: number;
}

/** Directed, pairwise. relationships[A][B] is A's view of B — never write
 *  both directions in the same effect unless the move explicitly says so. */
export interface Character {
  id: CharacterId;
  // ...traits, mood, goal, secrets, etc.
  relationships: Record<CharacterId, Relationship>;
  memories: Memory[];                  // owned by this character, by construction
  beliefs: Belief[];
}

/** Four axes. `baseline` is what the end-of-tick decay pass pulls toward.
 *  `lastDelta` is what moved this tick — Track B's prompts and Track C's
 *  animations both read it, and it is cleared at the start of the next tick.
 *  `flags` are discrete states a move can set or clear. */
export interface Relationship {
  trust: number;
  affection: number;
  respect: number;
  fear: number;
  baseline: Record<RelationshipAxis, number>;
  lastDelta: Partial<Record<RelationshipAxis, number>>;
  flags: string[];                     // 'betrayed' | 'indebted' | 'allied' | ...
}

export interface Memory {
  id: string;
  turn: number;
  actor: CharacterId;
  target?: CharacterId;
  description: string;                 // TEMPLATED BY TRACK A — never generated
  tags: string[];
  importance: number;                  // 0..1 at write time; decays on read
  valence: number;                     // -1..1, how good or bad this was for the owner
  tier: 'direct' | 'overheard' | 'told';
  accurate: boolean;                   // false = planted by SpreadRumor
}

/** A belief has to name what it is *about*. A free-text description alone
 *  makes Track B's false-belief test unwritable: you cannot assert that a
 *  prompt contains the false version of a claim and no trace of the true one
 *  if nothing in the type says which claim it is. */
export interface Belief {
  id: string;
  subject: CharacterId;                // who this belief is about
  axis?: RelationshipAxis;             // which axis it bears on, if any
  description: string;
  confidence: number;
  sourceMemoryId?: string;
}

export interface Move {
  id: string;                          // 'Confront' | 'GiveGift' | 'Propose' | ...
  actor: CharacterId;
  target?: CharacterId;
  args?: Record<string, unknown>;
}

/**
 * Track A owns this. Pure, synchronous, no network, no Date.now().
 *
 * Resolves ALL actors this tick, not just the player: every NPC that
 * clears its motivation threshold gets a candidate move alongside the
 * player's move (if any), and they're all applied in one deterministic
 * pass. Order is decided by (priority, then seeded tie-break) — never
 * by object/array iteration order.
 */
export function tick(w: WorldState, playerMove?: Move): TickResult;

export interface TickResult {
  state: WorldState;                   // new state, deltas already applied
  utterances: PendingUtterance[];      // Track B turns these into text
  events: SimEvent[];                  // Track C renders these as log lines
  log: ResolvedMove[];                 // every move that fired this tick, in resolution order
}

export interface ResolvedMove {
  move: Move;
  witnessedByPlayer: boolean;          // was the player present, or does it surface later via memory?
}

export interface PendingUtterance {
  speaker: CharacterId;
  move: Move;
  mood: string;
  relationshipSnapshot: Relationship;  // four axes + baseline + lastDelta + flags
  speakerBeliefs: Belief[];            // the speaker's view, which may be wrong
  retrievedMemories: Memory[];         // filled by Track B before the call
  witnessedByPlayer: boolean;          // Track B's cost strategy branches on this
}

/** Track B owns these two. */
export function realize(u: PendingUtterance): Promise<{ line: string; deliveryNote?: string }>;
export function interpret(input: string, legal: Move[], w: WorldState): Promise<Move>;
```

**`TickResult` currently lives in `lib/viewTypes.ts`, which is Track C's file.** Moving it into `sim/src/types.ts` is part of G0, not a later cleanup — Track B and Track A both need to import it and neither should be reaching into the frontend to do so. `PendingUtterance` does not exist anywhere in the repo yet.

**The invariant that holds the whole design together:** the LLM never mutates `WorldState` and never decides *which* move an NPC takes — that's still Track A's deterministic rule engine, running for every NPC every tick, not just the one the player is talking to. Gemini only writes words: it realizes whatever move Track A already selected as dialogue, whether that move was the player's or an autonomous NPC's. If anyone proposes letting the model return relationship deltas or pick NPC actions directly "because it would be smarter," say no — you lose reproducibility, testability, and the ability to demo when the API rate-limits you.

**The corollary, now that memory is a real subsystem:** memory summaries are **templated by Track A, not generated by Track B**. A generated summary drifting from what the engine recorded is a bug you will spend an evening not finding, and it would make memory stop existing under `MOCK_LLM=1`.

### The contract decisions that have to happen at the meeting

Four fields above are new since the last revision and every one of them is a four-track change with a merge conflict attached if it lands late. Put these on the agenda **explicitly**:

- Does `fear` earn its keep? **This one is answerable today, without debate:** in `lib/moveMeta.ts` `fear` appears in the effects of exactly one move (`Confront`). Either the move catalog differentiates it or it drops and you stop paying for four axes.
- Does `speakerBeliefs` belong on `PendingUtterance`, or does Track B fetch it separately?
- `Belief.subject` / `Belief.axis` — the repo's `Belief` is `{id, description, confidence}` today, free text only. Without a subject, Track B's false-belief test cannot be written.
- `Memory.valence`, `Memory.tier`, `Memory.accurate` — Track B's retrieval formula reads `valence`; Track A's observer tiers write `tier`; `SpreadRumor` needs `accurate`.

---

## Track A — Simulation Core

**Deliverable:** `sim/` — a framework-free TypeScript package with zero React and zero network imports.

Track A carries the largest share of the relationship & memory subsystem. Track B is only the surface of it.

### Build

1. **State module.** `WorldState`, `Character`, `Relationship`, `Memory`, `Belief`. Directed relationships stored as a per-character map keyed by target — `character.relationships[targetId]` — not individual named fields. At 5 characters that's 20 directed pairs; they need to be enumerable so rules and UI can ask "who does Alice trust least" generically. `alice.relationships['bob']` and `bob.relationships['alice']` are separate values and must never be written together by accident — add a lint/test rule asserting a move's effects touch at most one direction unless the move explicitly lists both.
   - **New:** each `Relationship` is four axes plus `baseline`, `lastDelta` and `flags`. The four axes and per-character `beliefs` already exist in `sim/src/types.ts` and in `fixtures/world.json`; `baseline`, `lastDelta` and `flags` do not.
2. **Rule engine.** Two-stage volition scoring, run for **every character each tick**, not only the one the player is engaging with:
   - `rankMotivations(npc, world) → ScoredMotivation[]`, keep top 2 above threshold
   - `rankMoves(npc, motivations, world) → ScoredMove[]`, keep top 1 above threshold
   - Scores are **additive across matching rules**. Several weak reasons stack into a strong one. This is what makes tuning feel like turning dials instead of rewriting logic.
   - **New:** rules score against relationship **axes**, **memory counts**, and **beliefs** — not a single scalar. "Alice has three `betrayal`-tagged memories about Bob" is a rule input.
   - Decide early whether every NPC re-scores every tick or only NPCs above some "worth acting on" bar — with 5 characters, unthrottled scoring means up to 4 autonomous NPC moves competing for the tick log alongside the player's, every single turn. Too noisy an event feed is a design failure just like too quiet a world is.
3. **Move effects.** `MoveEffect` becomes `{ deltas, multipliers, flagOps, observers, memoryTemplate }` — see spec §6. Each move is still `{ id, preconditions, effects }`.
4. **Context multipliers.** History modulates delta size: a fourth apology moves trust less than the first, a betrayal from someone you already flagged `betrayed` cuts deeper. **This is the project's novelty claim and it is not optional.** It is also the reason the debug panel below has to show contributing memories — without that, Track D is tuning a multiplier it cannot see fire.
5. **Multi-actor tick resolution.** This is core logic, not an edge case:
   - Score all candidate moves (player + every qualifying NPC) against the tick's *starting* state.
   - Resolve in a deterministic order — priority field on the move, then a seeded tie-break for ties. Never insertion order.
   - **Recheck preconditions immediately before applying each move's effects**, against the state as it stands after earlier moves in the same tick have applied. If Bob's proposal to Calum resolves first and changes Calum's mood, the player's rumor-telling to Alice should be checked against the world as it now stands, not the world as it was when the tick started.
   - Collect every move that fired into `TickResult.log`, tagged with whether the player witnessed it directly — this is what lets an off-screen event ("Bob proposed to Calum") surface to the player later as a memory/belief instead of vanishing, **and it is the input to Track B's cost strategy.** Without `witnessedByPlayer`, Track B cannot tell a templated line from one worth a real API call.
6. **Memory writes, in three observer tiers.** When a move fires, write a `Memory` into every character in `observers`, not into the world. Alice believing "Bob may be lying" is only interesting because Bob doesn't know she saw.
   - `direct` (present, full importance) / `overheard` (nearby, scaled down) / `told` (learned secondhand, scaled down further and possibly inaccurate).
   - `accurate: false` is how `SpreadRumor` plants a memory that never happened. This is the mechanism the whole false-belief demo rests on.
   - This is also how off-screen NPC-NPC moves reach the player: if the player is in `observers` via a `told` rule, they get the memory even though they weren't in the scene.
   - Today `determineObservers` returns everyone present, flat, and `mockEngine` writes a fixed `importance: 0.4`. Both are placeholders.
7. **Belief formation.** Newly written memories can promote to `Belief`s — repeated or high-importance memories about a subject produce a belief with a confidence, carrying `sourceMemoryId`. Beliefs are what Track B sends to the model *instead of* ground truth, so a character with no belief about a thing has nothing to leak.
8. **Decay pass toward `baseline`, at the end of every tick.** Without it every axis pins at 0 or 100 by turn 20. This is a build step, not a risk-table mitigation.
9. **Seeded RNG.** No `Math.random()` anywhere. Pass `rngSeed` through and advance it deterministically, so a bug report is a seed + a move list — this matters even more now, since a bug report needs to reproduce not just what the player did but what every NPC independently chose to do that tick.
10. **Headless runner.** `scripts/simulate.ts` that plays N turns with a scripted player and dumps **four columns per character pair**, not a single trust column, across all 5 characters. Add flag-thrash and pairwise-axis-correlation checks. This is your debugging superpower and it costs an afternoon.
11. **Debug output — owed to other tracks, ship it early.** Winning motivation per NPC per tick, its score, **and which memories contributed to it**. Track D cannot tune context multipliers without the third item, and it is the single item on this list most likely to get skipped.

### Definition of done

- `tick()` is pure: same input → same output, every time, including which NPC moves fired and in what order.
- Golden tests: fixture state + move → expected state, ~15 of them, **plus a handful specifically covering simultaneous conflicting moves** (e.g., an NPC move and the player's move both targeting the same character in one tick).
- 200-turn headless run across all 5 characters produces:
  - no NaN, no value outside 0–100
  - **no axis pinned** at either end
  - **no flag set-and-cleared more than a handful of times** (flag thrash means your thresholds are too tight)
  - **no pairwise axis correlation above 0.8** — see the "axes move together" risk below
  - no all-characters-hate-everyone collapse

### Don't

- Don't use behavior trees. The original proposal called for them, but they're built for continuous real-time NPC action; this is turn-based with a discrete action menu. Volition rules are the right tool and they're a third of the code.
- Don't `import` anything from `next/` or `react` in this package. Enforce it in review.
- Don't let move resolution order depend on `Object.keys()` or array iteration — it will work in dev and desync the moment character insertion order changes.
- Don't let a generated string into `Memory.description`. Track A templates it.

---

## Track B — AI Integration

**Deliverable:** `ai/` (aliased `@ai/*`) + the API route handlers that call it.

Track B's job is narrower than it sounds and more interesting than it sounds. It writes no game state. What it owns is the translation in both directions: turning a `PendingUtterance` — a speaker, a move, four relationship axes with their deltas, some flags, a set of possibly-false beliefs, and five retrieved memories — into a line a character would say, and turning free player text back into a legal `Move`. Everything below assumes the relationship and memory model in `claude/socialsim-relationships-memory.md`.

### Build

1. **Client setup.** `@google/genai`, server-side only. Key in `.env.local` as `GEMINI_API_KEY`, never `NEXT_PUBLIC_`. Check current model names in AI Studio — they churn; a flash-tier model is right for dialogue.

2. **`MOCK_LLM=1`, first, before anything else.** It is documented in `env.local.example` and in this plan and is currently read by no code at all. Tracks C and D are blocked on it more than you are. It returns stub text instantly and must run the entire game — **including all autonomous NPC-NPC moves** — with zero API calls.

3. **Memory retrieval.** Score in memory, no vector DB at this scale — at 5 characters over 30 turns the whole store is a few hundred records and this is a sort. Five weighted terms:

   ```ts
   score(m) = 0.30 * tagRelevance(m, move)          // does this memory's tag match the move?
            + 0.25 * effectiveImportance(m, turn)   // importance * exp(-λ * age), floored for betrayal/secret
            + 0.20 * participantMatch(m, speaker, listener)
            + 0.15 * axisRelevance(m, dominantAxisOfMove)
            + 0.10 * Math.abs(m.valence)
   ```

   Take top 5. Retrieve **only from the speaker's own memory array** — never from the world, never from another character's.

   Three of those terms depend on things that do not exist yet. Raise all three at the contracts meeting rather than discovering them mid-implementation:
   - `m.valence` is a new field on `Memory`.
   - `effectiveImportance`'s betrayal/secret floor needs a **tag convention**, agreed with Track D, for which tags are floored.
   - `dominantAxisOfMove` needs a **move → primary axis** mapping that Track D owns. Most moves in `lib/moveMeta.ts` touch two axes today with no dominant one designated.

   Owner-filtering is structurally free, not a thing you have to enforce: memories live in `character.memories[]`, so reading `world.characters[speaker].memories` is owner-filtered by construction. **Keep the Cara-absent test anyway — but understand that it guards the easy half.** The real leak risk is one layer up, in prompt assembly reaching into `world` for a third party's true relationship values. That is where a character learns something they never witnessed.

   Only reach for embeddings after you've felt this be insufficient.

4. **Prompt assembly.** The realization prompt carries, in this order: character card, mood, the four relationship axes **with their `lastDelta` values**, active flags, top-5 memories as templated summary strings with turn numbers, and the move being performed.

   Two rules here that matter more than the wording of the prompt itself:

   - **Send deltas, not just values.** "trust 28" and "trust 28, down from 44 this turn" should produce very different lines, and the model can only do that if you tell it which happened.
   - **Send beliefs, never ground truth.** Use `u.speakerBeliefs`, not the real relationship values of third parties. If Cara believes a false rumor, her prompt contains the false version and nothing else. The model cannot leak what she doesn't know, because it was never in the context window. This is the cheapest correctness guarantee in the project — don't trade it away for a prompt that "has more context."

5. **Dialogue realization — for autonomous moves too.** Structured output with `responseMimeType: 'application/json'` and a `responseSchema`. Validate with Zod after parsing anyway — the schema guarantees shape, not sense. Add a check that the returned line doesn't name a character absent from the speaker's memories or the current scene; that's the most common way a model invents knowledge the character doesn't have.

   This applies identically whether the move came from the player or from an NPC's own `rankMoves` output — realizing Bob's line when he proposes to Calum with nobody else around is the same code path.

6. **Cost control for multi-actor ticks. Decide this before G2 closes, not after.** With up to 5 characters acting per tick, naive "one LLM call per fired move" scales per-turn cost by up to 5× versus a one-NPC design — and `lib/mockEngine.ts` already fires up to three moves per tick today. `ResolvedMove.witnessedByPlayer` (and the mirrored flag on `PendingUtterance`) is the input to whichever strategy you pick:

   - **Default:** LLM-realize only moves the player directly witnesses. Resolve purely off-screen NPC-NPC moves with the templated fallback lines, and upgrade to a real call only if the player later asks about it or investigates.
   - **Or batch:** one prompt per tick that realizes *all* the tick's fired moves together, rather than one call per move.
   - Full per-move LLM realization stays available as a demo-day setting, not the default.

   Prompts got substantially bigger when memory and beliefs landed. Measure **per tick with all 5 characters acting**, not per call — a comfortable per-call number and an unaffordable per-turn number are entirely compatible.

7. **Custom action interpretation.** Free text in, a legal move out. **Pass the enum of currently-legal move IDs into the schema** so the model physically cannot return something the engine can't execute:

   ```ts
   responseSchema: {
     type: Type.OBJECT,
     properties: {
       move:   { type: Type.STRING, enum: legalMoveIds },
       target: { type: Type.STRING, enum: presentCharacterIds },
       intensity: { type: Type.NUMBER },
     },
     required: ['move', 'target'],
   }
   ```

   Interpretation reads relationship state only to narrow the legal set (Track A supplies it via preconditions) — it never scales a delta. `intensity` is a hint for realization tone, not a multiplier on state change. `lib/interpret.ts` is a keyword table standing in for this today; it is yours to replace, and it already produces the `understoodAs` string Track C's confirmation UI renders.

8. **Failure handling.** Timeout, retry once, then fall back to canned lines. **The game must remain playable with the network unplugged.**

   The fallback table is bucketed by relationship, not one line per move: **hostile / neutral / warm** × ~15 moves ≈ 45 strings. Track D writes them; it's about an hour and it's what keeps `MOCK_LLM=1` runs legible enough to actually playtest against. A single canned line per move makes every stub run read identically and hides exactly the thing you're trying to tune — which is the state the repo is in right now, with 13 flat templates in `lib/moveMeta.ts`. Interpretation falls back to a `Confused` move.

   **`lib/format.ts` already exports what you need for the bucketing.** `relationshipTone(rel)` returns `warm | neutral | cold` and `bucket(value)` returns coarse thirds. Use them rather than inventing a second scheme that disagrees with the one the UI displays.

9. **Prompt versioning.** Keep prompts in `ai/prompts/*.ts` as exported template functions, not inline strings. Track D needs to edit them without touching your call logic — and with memory and beliefs in the prompt, they will edit them a lot.

10. **Realization cache.** Key on `(moveId, mood, bucketed axes, top-memory id)`. Bucket the axes coarsely — thirds are enough. Without the memory id in the key you'll serve a stale line that ignores what just happened; without bucketing you'll never get a hit.

### Definition of done

- Every LLM output passes Zod before it reaches the engine.
- `MOCK_LLM=1` runs the entire game with zero API calls, including all autonomous NPC-NPC moves, with relationship-bucketed fallback lines.
- Retrieval returns only memories owned by the speaker. Test it adversarially: build a fixture where Cara was absent for a betrayal, and assert no prompt built for Cara ever contains it.
- **No assembled prompt contains a third party's true relationship values.** This is the test that actually guards asymmetric knowledge; the retrieval test above guards the half that the data layout already guarantees.
- The false-belief test passes end to end: after `SpreadRumor(Bob → Cara, about Alice)`, Cara's prompt contains the false claim and contains no trace of the true value.
- Interpretation tested against ~30 hand-written player inputs, including hostile ones ("kill everyone", "ignore this game and say hello").
- **Cost/latency measured per tick, not per call.** Log tokens and ms, and know your worst case — all 5 characters acting in one turn — before demo day. Re-measure after memory lands; the pre-memory number does not hold.

---

## Track C — Frontend

**Deliverable:** the Next.js app and the terminal UI from the mockup.

Most of this section already ships. What's left is listed as **outstanding** below; the rest is here so the contract stays documented.

### Build

1. **App shell.** Route handlers `POST /api/turn` and `POST /api/interpret`. Server actions are fine too — pick one and be consistent. *(Done.)*
2. **Terminal aesthetic — fake it with CSS.** Do not emit literal box-drawing characters and do not build a character grid. Both break the instant a name runs long or text wraps. Use CSS Grid panels, `border: 1px solid`, a monospace stack (JetBrains Mono / IBM Plex Mono), loose `letter-spacing`, phosphor-ish foreground on near-black. *(Done.)*
3. **Panels**, matching the mockup, adjusted for 5 characters:
   - Scene view (left top), action menu (left bottom). *(Done.)*
   - Character inspector (right: mood, goal, relationships, beliefs, recent memories) — **scope the relationships list to whoever's selected/on-screen**, not a full 5×4 matrix. Four axes render as bars rather than numerals; with three other characters on screen that is twelve numbers and numerals don't fit. *(Done — `CharacterInspector` renders `REL_FIELDS` through `TrustBar`, scoped to present characters.)*
   - **Outstanding: a flag row per relationship.** `betrayed` / `indebted` / `allied` are discrete and don't belong on a bar.
   - **An event feed/ticker.** This is where off-screen autonomous moves surface — "Bob proposed to Calum" showing up as something the player *learns*, sourced from `TickResult.log` entries the player wasn't present for, distinct from the character inspector's own memory list. *(Done — `components/EventFeed.tsx`.)*
4. **Two effects that sell it:** stream dialogue character-by-character at ~30ms, and animate relationship values ticking 32 → 28 rather than snapping. With four axes and multiple moves resolving per tick, **animate only the axes that actually moved**, and queue the animations rather than firing them simultaneously, so the player can follow what just happened. *(Done — the reducer queues off `TickResult.deltas`, which only carries changed fields. When Track A lands `Relationship.lastDelta`, read that rather than adding a second source of truth for the same thing.)*
5. **State handling.** `useReducer` client mirror for optimistic menu response, reconcile from the server's `TickResult` — including several relationship values changing in one round trip. Save = one JSON blob per session; don't build a database. *(Done.)*
6. **Custom action input.** Text field, disabled-with-spinner while interpreting, and a visible "I understood that as: *Confront Bob*" confirmation so players learn what the system can parse. *(Done — swaps to Track B's interpreter with no UI change.)*
7. **Outstanding: move `TickResult` out of `lib/viewTypes.ts`.** It belongs in `sim/src/types.ts` where Tracks A and B can import it without reaching into the frontend. Part of G0.

### Definition of done

- Renders correctly from a static `fixtures/world.json` with 5 characters, with the server off.
- No layout break with a 20-character name, a 3-line dialogue response, multiple event-feed entries landing in one tick, or **four axes plus a flag row across a full on-screen cast**.
- Keyboard navigable — number keys pick menu options. It's a terminal game.

---

## Track D — Content & Design

**Deliverable:** the actual game, plus the confidence that it's fun.

This track produces data files, not engine code. It's the one that makes the difference between a tech demo and something people want to keep playing — and the relationship & memory subsystem roughly **doubled its size**, landing on the track that was already easiest to under-resource. Budget accordingly.

### Build

1. **Cast.** 5 characters with traits, starting relationships, a secret, and a want. *(Done — You, Alice, Bob, Calum, Dana in `fixtures/world.json`.)* Traits gate rules (`arrogant`, `loyal`, `gossip`) — coordinate the vocabulary with Track A.
   - **Outstanding:** each of the 20 directed pairs now needs four axis values **plus a baseline per axis plus any starting flags** — roughly 5× the setup data per pair. The axes are in the fixture; baselines and flags are not.
2. **Move catalog.** Target ~15 moves. Per move: base deltas on up to four axes, **an observer rule** (who sees it, at which tier), **a memory template with tags**, and **any context multipliers**. **Budget roughly double the original catalog task.** Start from: `Greet`, `Confront`, `GiveGift`, `SpreadRumor`, `RevealSecret`, `Defend`, `Insult`, `Apologize`, `AskForHelp`, `Refuse`, `Comply`, `Withdraw`, `Propose`. *(13 exist in `lib/moveMeta.ts` with 1–2 axes each and no observer rule, memory template, or multiplier.)*
   - **Also owed to Track B:** a **move → primary axis** mapping (for retrieval's `axisRelevance`) and a **tag convention** naming which memory tags are importance-floored (betrayal, secret). Small, and Track B's retrieval scorer is blocked without both.
   - **Watch `fear`.** It appears in exactly one move's effects today (`Confront`). Either differentiate it across the catalog or say so at the contracts meeting and drop the axis — see the risk table.
3. **Rule tables.** Motivation rules, move rules, **and context multiplier rules**, all as data. Own the volition numbers — with 5 characters all scoring independently each tick, expect more emergent combinations than with 3, and expect to change the numbers more than a hundred times.
4. **Fallback line table.** Hostile / neutral / warm × ~15 moves ≈ 45 strings, for Track B's `MOCK_LLM=1` path. About an hour of work, and Tracks B, C and D all depend on it being decent. Bucket with `relationshipTone()` from `lib/format.ts` so the tone the line assumes matches the tone the UI shows.
5. **Scenario.** A starting configuration with a built-in tension — Bob has already betrayed Alice, the player has to pick a side or play both, and Bob's own independent pursuit of Calum can complicate that without any player input. The Day 3 / 14:25 mockup implies a multi-day arc; decide how long a full run should be (30 turns is a good target). *(Done — see the README's scenario section.)*
6. **Memory fixture with real depth.** `fixtures/world.json` currently gives each character one or two memories. Track B cannot test retrieval *ranking* against a pool that small — the top-5 cut never binds. Extend it to a multi-turn history per character, with mixed tags, tiers, valences and importances.
7. **Playtesting log.** Every session, write down: what you expected, what happened, which rule caused the gap — and specifically, whether an autonomous NPC-NPC move surprised you in a good way or just read as noise, and whether a context multiplier's effect was visible or invisible. This document is what turns tuning from vibes into work.
8. **Integration + QA.** Track D is also the person who runs the full stack end-to-end at every integration session and files the bugs. Nobody else is looking at the whole thing.

### Definition of done

- A 20-turn run where relationships end up meaningfully different from where they started, in a way a player can explain — including at least one relationship change the player didn't directly cause.
- Three distinct playthroughs from the same starting state that produce different endings.
- At least one moment where a **repeated** move visibly lands softer than the first one did — the context multiplier being legible to a player is the whole claim.
- No character whose behavior a playtester describes as "random."

---

## Gates — what blocks what

No dates. Each gate is defined by what it unblocks, so the question is never "are we on schedule," it's "what is the next thing standing between someone and their work."

### G0 — Contracts
**Blocked by:** nothing.
**Blocks:** literally everything.
`types.ts` written and committed, including the directed-relationship map, the four axes with `baseline`/`lastDelta`/`flags`, `Memory`'s `valence`/`tier`/`accurate`, `Belief.subject`, `PendingUtterance` (which does not exist yet), and the multi-actor `TickResult.log` (which currently lives in `lib/viewTypes.ts` and has to move). Repo scaffolded, `.env.local` documented, `MOCK_LLM` flag agreed. The four contract decisions listed under *The seam* are settled here or they become week-three merge conflicts. Everyone can run `npm run dev`.

### G1 — Playable with no AI
**Blocked by:** G0.
**Blocks:** G2, G4, and all meaningful playtesting.
Hard-coded cast of 5, five moves, fixed menu, stub dialogue strings, real rules engine (including multi-actor resolution), real UI with an event feed.

**This should already be a game.** If it isn't fun with stub text — including the autonomous NPC-NPC moves reading as sensible rather than random — adding Gemini will not fix it, it will just make the un-fun harder to see. **This is the one gate worth stopping the project at.** If G1 lands flat, fix the design before writing another line of AI code.

*Status: substantially met by `lib/mockEngine.ts` + the shipped UI, on all four axes and with observer-scoped memory.* An earlier draft proposed scoping G1 down to one axis and direct-tier memory only. That advice is overtaken — the four-axis version already reads fine in play. Don't scope back down; spend the slack on Track A porting the mock's behavior into `sim/`.

### G2 — Dialogue is alive
**Blocked by:** G1 (needs real `PendingUtterance` objects to realize, for both player-facing and autonomous moves) and B's working Gemini client.
**Blocks:** G3, and any demo you'd show someone.
Stub strings replaced by generated lines. Streaming lands in the UI. **The multi-actor cost strategy is in place before this gate closes, not discovered after** — that means a measured worst-case per-turn cost with all 5 characters acting, not a per-call number.

### G3a — Memory works
**Blocked by:** G2 (retrieval is pointless before prompts exist) and A's per-character memory writes.
Engine writes memories to observers only, at the right tier; B retrieves top-k into prompts. Test: do something off-screen between two NPCs on turn 3 with the player not present, have the player learn about it and see it referenced by turn 12. Re-measure tokens and latency here — prompts got bigger.

### G3b — Memory changes behavior
**Blocked by:** G3a.
**Blocks:** the pitch. This is the feature the project is actually about.
A context multiplier demonstrably alters an outcome — the fourth apology moves trust visibly less than the first — and a false belief planted by `SpreadRumor` visibly changes a third character's action.

**Keep these two separate on purpose.** It is easy to hit G3a, call memory done, and never build the half the pitch rests on. G3a is retrieval plumbing; G3b is the claim.

### G4 — Custom actions
**Blocked by:** G1 only — needs a stable legal-move enum from A, *not* G2 or G3.
**Blocks:** nothing downstream.
This is the one branch that can run genuinely in parallel with G2/G3. If Track B has capacity while A is still landing memory writes, this is where it goes. Free-text input, interpretation, confirmation UI, hostile-input handling. The UI half already ships against `lib/interpret.ts`'s keyword table.

### G5 — Polish / endings / quests
**Blocked by:** G3b.
**Blocks:** nothing.
Save/load, demo script, and **event generation made concrete: watch for flag transitions and threshold crossings.** `trust` dropping below 25 having been above 60 fires a rupture event; `allied` being set fires an alliance beat. **Cut quest generation first if anything has to go** — it's the least load-bearing item in the original proposal and nothing depends on it.

### The critical path

```
G0 → G1 → G2 → G3a → G3b → G5
          └──→ G4 (parallel, cuttable)
```

Everything on `G0 → G1 → G2 → G3a → G3b` is critical path: a day lost there is a day lost overall. G4 and G5 are slack. When someone is blocked, they should be pulling work toward the critical path, not building out their own track's nice-to-haves.

### Standing blockers to watch for

These aren't gates, but they stall people the same way:

| If this is missing | These people are stuck |
|---|---|
| `types.ts` (with `PendingUtterance` and `TickResult` in it) | all four |
| `claude/socialsim-relationships-memory.md` | B entirely — it's not in the repo |
| `MOCK_LLM=1` actually implemented, not just documented | C and D, permanently |
| `fixtures/world.json` (with all 5 characters) | C entirely, B for testing |
| A memory fixture with real multi-turn history | B can't test retrieval *ranking* at all |
| Move → primary axis mapping, and the floored-tag convention | B's retrieval scorer |
| Seeded RNG in the engine | D can't reproduce anything they find |
| Legal-move enum exposed by A | B can't build interpretation |
| Deterministic multi-actor tick ordering | A can't hand off a stable `tick()`; B and C build against something that will reshuffle |
| `witnessedByPlayer` on resolved moves | B has no input to a cost strategy |
| Debug panel showing winning motivation + score **+ contributing memories** | D is tuning blind — and tuning context multipliers is impossible without the third column |

The bottom half of that table is the part teams forget. Track D cannot tune volition numbers without seeing which rule won *for which character, off which memories*, and Track B cannot constrain the model without knowing what's legal. All of them are small asks of Track A that unblock someone else's entire track — treat them as higher priority than they look.

---

## Integration protocol

- **Branch per track**, PR into `main`, one reviewer from a different track. Cross-track review is how people find out the seam changed. See `CONTRIBUTING.md` for the branch naming and the lint/typecheck gate.
- **Integration session on a fixed cadence** — everyone present, full stack running, Track D driving. Pick an interval and hold it; the failure mode is integrating only when something breaks.
- **Fixtures are shared property.** `fixtures/world.json` lives at the repo root, contains all 5 characters, and every track uses the same one. When it changes, announce it.
- **Nobody edits another track's directory.** Need something changed? Ask. This sounds bureaucratic for four people and it will save you a merge disaster later.
- **Announce blockers immediately, in public.** The whole plan above is a dependency graph; it only works if a blocked person says so the same hour rather than quietly working around it.
- **This document is the plan of record.** If you're holding a copy that disagrees with it, this one wins — check *What changed in this revision* below before acting on the other.

---

## Risks worth naming now

| Risk | Signal | Mitigation |
|---|---|---|
| LLM-first drift | Someone wires Gemini before G1 for a cool demo | G1 gate: playable with `MOCK_LLM=1` before any real call |
| Rules feel random | Playtester can't explain why an NPC acted, especially an off-screen one | Log the winning motivation + move + score + contributing memories per NPC per turn; surface in a debug panel |
| Relationship collapse | Axis values pinned at 0 or 100 by turn 20 | Clamp, **decay toward `baseline` every tick**, re-run the 200-turn headless check after every rule change |
| **Axes move together** | Pairwise correlation above ~0.8 across a headless run | If all four rise and fall as one you have a one-axis system with extra steps. Either differentiate the move table or drop to two axes and stop paying for four. **Check this early — `fear` currently appears in one move's effects, so the answer for at least one axis is already known.** |
| Memory leaks across characters | A character references something they never witnessed | Retrieval reads only `world.characters[speaker].memories`; **prompt assembly never reads `world` for a third party's values** — the no-ground-truth test in Track B's DoD is the real guard |
| Prompt bloat | Per-turn cost or latency climbs after G3a | Top-5 cap is hard; re-measure tokens/ms at G3a, not at G2 |
| API cost/rate limits | Demo stalls — worse with up to 5 characters acting per tick | Cache realizations by `(moveId, mood, bucketed axes, top-memory id)`; template or batch off-screen moves; fallback lines always present |
| Event feed noise | Player stops reading the feed because too much fires every tick | Throttle how many NPCs act per tick, or raise the "worth acting on" threshold, rather than letting every qualifying NPC always fire |
| Context multipliers invisible | Playtester never notices the fourth apology landing softer | It's the pitch. Make it a G3b exit condition and a required line in the playtest log |
| Track D under-invested | Everyone's building infrastructure, nobody's playing | The subsystem doubled D's budget. Make the playtest log a required artifact at every integration session |
| Silent blocking | Someone's commits go quiet for a stretch | The standing-blockers table above — check it when progress stalls |

---

## Starting tasks per track

Everything here is unblocked the moment G0 lands.

- [ ] **All:** `types.ts` frozen — directed relationship maps with baseline/lastDelta/flags, `Memory.valence`/`tier`/`accurate`, `Belief.subject`, `PendingUtterance`, multi-actor `TickResult` moved out of `lib/viewTypes.ts`. The four contract decisions settled. Owners assigned above.
- [ ] **A:** port `lib/mockEngine.ts`'s behavior into `sim/` — multi-actor candidate selection, seeded ordering, clamped effects, observer-scoped memory writes — replacing the stubbed `isLegalMove` / `getLegalMoves` / `determineObservers`. Then the legal-move enum and debug logging, because B and D are waiting on those. Then decay and context multipliers.
- [ ] **B:** **ship `MOCK_LLM` for real first** — it's documented and unimplemented, and C and D need it more than you do. Then get the companion spec committed. Then the retrieval scorer against a hand-written memory fixture; it's pure and testable before any prompt exists. Then the Gemini client and one hard-coded realization call returning valid JSON. Cost strategy sketched before G2 opens.
- [ ] **C:** flag row in the inspector; move `TickResult` into `sim/src/types.ts`. The rest of the panel work is done.
- [ ] **D:** baselines and starting flags for the 20 directed pairs; the 45-line fallback table; the move → primary axis mapping and floored-tag convention that B is blocked on; then observer rules and memory templates per move.

---

## What changed in this revision

For anyone holding an older copy. Two things merged here that had drifted into separate documents: the **multi-actor world sim** revision and the **relationship & memory subsystem**. A fork existed that had the second without the first — if your copy's seam reads `tick(w, playerMove)` with a required player move, that's the one.

**From the relationship & memory subsystem (new here):**

| Where | Change |
|---|---|
| The seam | Four axes + `baseline` + `lastDelta` + `flags`; `Memory.valence`/`tier`/`accurate`; `Belief.subject`/`axis`; `PendingUtterance.speakerBeliefs` |
| The seam | Memory summaries are **templated by Track A**, never generated — otherwise memory stops existing under `MOCK_LLM=1` |
| Track A | Context multipliers, end-of-tick decay toward baseline, three observer tiers, belief formation, four-column headless output, correlation and flag-thrash checks, contributing-memories in the debug panel |
| Track B | Rewritten: five-term retrieval, owner-filtered, prompt assembly carrying deltas and beliefs, hallucination check, relationship-bucketed fallbacks, cache keyed on the top-memory id |
| Track C | Flag row per relationship; animate only axes that moved |
| Track D | Fallback line table, doubled move-catalog budget, baselines and flags, context multiplier rules, deeper memory fixture |
| Gates | G3 split into G3a (memory works) and G3b (memory changes behavior); G5 event generation made concrete |
| Risks | Memory leaking across characters; prompt bloat; **axes moving together**; context multipliers being invisible |

**Kept from the multi-actor revision (the fork dropped all of it):** the world-sim design note, the cast of 5, multi-actor tick resolution with mid-tick precondition rechecks and deterministic ordering, `TickResult.log` / `ResolvedMove.witnessedByPlayer`, Track B's cost control for N autonomous actors, Track C's event feed, and the event-feed-noise risk.

**Corrected against the code as it actually stands:** several items an earlier appendix listed as outstanding are already built — the four-axis inspector, delta-scoped animation, the event feed, and the 5-character fixture. The proposal to scope G1 down to one axis is overtaken. Conversely, `MOCK_LLM` is documented but unimplemented, `PendingUtterance` doesn't exist, `TickResult` sits in the frontend's file, and `claude/socialsim-relationships-memory.md` is not in the repo at all.

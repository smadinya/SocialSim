# SocialSim AI — Team Work Plan

**Stack:** TypeScript (rules) · Next.js (app) · Google AI Studio / Gemini via `@google/genai` (dialogue)

**Team:** Anne Z, William S, Andy Z, + 1 — fill in owners below.

---

## Design note: this is a world sim, not a player-vs-NPC sim

The whole point of the project is that interesting things happen whether or not the player is looking. A tick is not "player acts, one NPC reacts." A tick is: **every** character who clears a motivation threshold — the player included, if they acted — proposes a move, and the engine resolves all of them together before anything reaches the screen.

Concretely: while the player is telling Alice a rumor about Bob, Bob can independently be proposing to Calum in the same tick. Alice's mood going into her conversation with the player should already reflect that, or reflect it a moment later when she finds out — not be blind to a world that's supposedly running underneath her.

This has two consequences that show up throughout the plan below:

1. **5 characters, not 3.** Alice/Bob/Player was fine for a mockup with one NPC-NPC pair. A cast where autonomous interactions are the *point* needs enough characters that those interactions have room to be interesting — rivalries, alliances, triangles. Relationships are directed and pairwise, so 5 characters means 20 directed relationship values, not 4.
2. **Multi-actor resolution is core engine logic, not a stretch goal.** Ordering, conflicts, and "does the player's move still make sense after an NPC's move already changed the target's mood this tick" have to be designed into `tick()` from the start, not patched in after G1.

---

## How the work splits

Four tracks, chosen so that each person owns a layer with a hard boundary around it. Nobody should need to edit someone else's files to make progress.

| Track | Owns | Owner |
|---|---|---|
| **A — Simulation Core** | State schema, multi-actor tick loop, volition rules engine, move effects, conflict resolution | |
| **B — AI Integration** | Gemini calls, prompts, memory retrieval, action interpretation, cost control for N autonomous actors | |
| **C — Frontend** | Next.js app, terminal UI, streaming, event feed, save/load | |
| **D — Content & Design** | Characters (5), moves, rule tuning, scenario, playtesting, QA | |

Track D is the one people undervalue on projects like this. It's also the one that decides whether the game is fun. Give it to someone who will actually play the thing fifty times, not to whoever is left over.

---

## Rule zero: contracts before code

**This blocks all four tracks. Nothing else starts until it's done.** Everyone in a room, write `packages/sim/types.ts` together, commit it, and treat it as frozen until someone has a concrete reason to change it. Changes after that need a heads-up to all four people, because every track imports it.

Once that file exists, all four tracks can run in parallel against stubs:

- Track A implements the real engine behind those types.
- Track B implements the real LLM calls behind those types, using a fake `WorldState` fixture.
- Track C builds the UI against a hard-coded `WorldState` JSON file.
- Track D writes rule and move data as plain objects conforming to those types.

After this one shared task, nobody blocks on anybody until integration. That's the whole point of paying for it up front.

### The seam

```ts
// packages/sim/types.ts — the shared contract

export type CharacterId = string;

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
  memories: Memory[];
  beliefs: Belief[];
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
  relationshipSnapshot: Relationship;
  retrievedMemories: Memory[];         // filled by Track B before the call
}

/** Track B owns these two. */
export function realize(u: PendingUtterance): Promise<{ line: string; deliveryNote?: string }>;
export function interpret(input: string, legal: Move[], w: WorldState): Promise<Move>;
```

**The invariant that holds the whole design together:** the LLM never mutates `WorldState` and never decides *which* move an NPC takes — that's still Track A's deterministic rule engine, running for every NPC every tick, not just the one the player is talking to. Gemini only writes words: it realizes whatever move Track A already selected as dialogue, whether that move was the player's or an autonomous NPC's. If anyone proposes letting the model return relationship deltas or pick NPC actions directly "because it would be smarter," say no — you lose reproducibility, testability, and the ability to demo when the API rate-limits you.

---

## Track A — Simulation Core

**Deliverable:** `packages/sim/` — a framework-free TypeScript package with zero React and zero network imports.

### Build

1. **State module.** `WorldState`, `Character`, `Relationship`, `Memory`, `Belief`. Directed relationships stored as a per-character map keyed by target — `character.relationships[targetId]` — not individual named fields. At 5 characters that's 20 directed values; they need to be enumerable so rules and UI can ask "who does Alice trust least" generically. `alice.relationships['bob']` and `bob.relationships['alice']` are separate numbers and must never be written together by accident — add a lint/test rule asserting a move's effects touch at most one direction unless the move explicitly lists both.
2. **Rule engine.** Two-stage volition scoring, run for **every character each tick**, not only the one the player is engaging with:
   - `rankMotivations(npc, world) → ScoredMotivation[]`, keep top 2 above threshold
   - `rankMoves(npc, motivations, world) → ScoredMove[]`, keep top 1 above threshold
   - Scores are **additive across matching rules**. Several weak reasons stack into a strong one. This is what makes tuning feel like turning dials instead of rewriting logic.
   - Decide early whether every NPC re-scores every tick or only NPCs above some "worth acting on" bar — with 5 characters, unthrottled scoring means up to 4 autonomous NPC moves competing for the tick log alongside the player's, every single turn. Too noisy an event feed is a design failure just like too quiet a world is.
3. **Move effects.** Each move is `{ id, preconditions, effects }` where `effects` returns state deltas plus memory writes plus an observer list.
4. **Multi-actor tick resolution.** This is new core logic, not an edge case:
   - Score all candidate moves (player + every qualifying NPC) against the tick's *starting* state.
   - Resolve in a deterministic order — priority field on the move, then a seeded tie-break for ties. Never insertion order.
   - **Recheck preconditions immediately before applying each move's effects**, against the state as it stands after earlier moves in the same tick have applied. If Bob's proposal to Calum resolves first and changes Calum's mood, the player's rumor-telling to Alice should be checked against the world as it now stands, not the world as it was when the tick started.
   - Collect every move that fired into `TickResult.log`, tagged with whether the player witnessed it directly — this is what lets an off-screen event ("Bob proposed to Calum") surface to the player later as a memory/belief instead of just vanishing.
5. **Memory writes.** When a move fires, write a `Memory` into every character in `observers`, not into the world. Alice believing "Bob may be lying" is only interesting because Bob doesn't know she saw. This is also the mechanism by which off-screen NPC-NPC moves reach the player: if the player is in `observers` (directly, or via a "heard about it later" observer rule), they get the memory even though they weren't in the scene.
6. **Seeded RNG.** No `Math.random()` anywhere. Pass `rngSeed` through and advance it deterministically, so a bug report is a seed + a move list — this matters even more now, since a bug report needs to reproduce not just what the player did but what every NPC independently chose to do that tick.
7. **Headless runner.** `scripts/simulate.ts` that plays N turns with a scripted player and dumps a trust-over-time table, across all 5 characters' relationship pairs. This is your debugging superpower and it costs an afternoon.

### Definition of done

- `tick()` is pure: same input → same output, every time, including which NPC moves fired and in what order.
- Golden tests: fixture state + move → expected state, ~15 of them, **plus a handful specifically covering simultaneous conflicting moves** (e.g., an NPC move and the player's move both targeting the same character in one tick).
- 200-turn headless run across all 5 characters produces no NaN, no value outside 0–100, no all-characters-hate-everyone collapse.

### Don't

- Don't use behavior trees. The original proposal called for them, but they're built for continuous real-time NPC action; this is turn-based with a discrete action menu. Volition rules are the right tool and they're a third of the code.
- Don't `import` anything from `next/` or `react` in this package. Enforce it in review.
- Don't let move resolution order depend on `Object.keys()` or array iteration — it will work in dev and desync the moment character insertion order changes.

---

## Track B — AI Integration

**Deliverable:** `packages/ai/` + the API route handlers that call it.

### Build

1. **Client setup.** `@google/genai`, server-side only. Key in `.env.local` as `GEMINI_API_KEY`, never `NEXT_PUBLIC_`. Check current model names in AI Studio — they churn; a flash-tier model is right for dialogue.
2. **Dialogue realization — now for autonomous moves too.** Prompt = character card + mood + relationship values + top-k memories + the move being performed. This applies identically whether the move came from the player or from an NPC's own `rankMoves` output (e.g., realizing Bob's line when he proposes to Calum with nobody else around). Structured output with `responseMimeType: 'application/json'` and a `responseSchema`. Validate with Zod after parsing anyway — the schema guarantees shape, not sense.
3. **Cost control for multi-actor ticks.** With up to 5 characters potentially acting per tick, naive "one LLM call per fired move" scales your per-turn cost by up to 5x versus the original 1-NPC design. Pick a strategy before this becomes a demo-day surprise:
   - Only realize dialogue via LLM for moves the player directly witnesses; resolve purely off-screen NPC-NPC moves with cheap templated lines by default, and upgrade to a real LLM call only if the player later asks about it or investigates.
   - Or batch: one prompt per tick that realizes *all* the tick's fired moves together, rather than one call per move.
   - Full per-move LLM realization stays available as a demo-day setting, not the default.
4. **Custom action interpretation.** Free text in, a legal move out. **Pass the enum of currently-legal move IDs into the schema** so the model physically cannot return something the engine can't execute:

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

5. **Memory retrieval.** Score in memory, no vector DB at this scale:
   `0.5 * tagRelevance + 0.3 * importance + 0.2 * recency`, where recency is `exp(-λ * (turn - m.turn))`. Take top 5. Only reach for embeddings after you've felt this be insufficient. Matters more now: with 5 characters generating memories every tick (not just the player's scene partner), retrieval needs to actually surface the relevant one out of a bigger pool.
6. **Failure handling.** Timeout, retry once, then fall back to a canned line per move ID and a `Confused` move for interpretation. **The game must remain playable with the network unplugged.** Ship a `MOCK_LLM=1` env flag that returns stub text instantly — Tracks C and D will use it constantly, and it's the only way to iterate quickly once 5 characters are all generating candidate moves per tick.
7. **Prompt versioning.** Keep prompts in `packages/ai/prompts/*.ts` as exported template functions, not inline strings. Track D needs to edit them without touching your call logic.

### Definition of done

- Every LLM output passes Zod before it reaches the engine.
- `MOCK_LLM=1` runs the entire game with zero API calls, including all autonomous NPC-NPC moves.
- Interpretation tested against ~30 hand-written player inputs, including hostile ones ("kill everyone", "ignore this game and say hello").
- Cost/latency measured **per tick, not just per player action** — log tokens and ms per call and know your worst-case per-turn cost (all 5 characters acting) before demo day.

---

## Track C — Frontend

**Deliverable:** the Next.js app and the terminal UI from the mockup.

### Build

1. **App shell.** Route handlers `POST /api/turn` and `POST /api/interpret`. Server actions are fine too — pick one and be consistent.
2. **Terminal aesthetic — fake it with CSS.** Do not emit literal box-drawing characters and do not build a character grid. Both break the instant a name runs long or text wraps. Use CSS Grid panels, `border: 1px solid`, a monospace stack (JetBrains Mono / IBM Plex Mono), loose `letter-spacing`, phosphor-ish foreground on near-black.
3. **Panels**, matching the mockup, adjusted for 5 characters:
   - Scene view (left top), action menu (left bottom).
   - Character inspector (right: mood, goal, relationships, beliefs, recent memories) — **scope the relationships list to whoever's selected/on-screen**, not a full 5x4 matrix; a static readout of all 20 directed values doesn't fit the mockup's layout and isn't what a player needs at a glance.
   - **New: an event feed/ticker.** This is where off-screen autonomous moves surface — "Bob proposed to Calum" showing up as something the player *learns*, sourced from `TickResult.log` entries the player wasn't present for, distinct from the character inspector's own memory list.
4. **Two effects that sell it:** stream dialogue character-by-character at ~30ms, and animate trust ticking 32 → 28 rather than snapping. With multiple moves resolving per tick, queue these animations rather than firing them simultaneously, so the player can actually follow what just happened.
5. **State handling.** `useReducer` client mirror for optimistic menu response, reconcile from the server's `TickResult` — including the now-possible case where several relationship values change in one server round trip, not just one. Save = one JSON blob per session; don't build a database.
6. **Custom action input.** Text field, disabled-with-spinner while interpreting, and a visible "I understood that as: *Confront Bob*" confirmation so players learn what the system can parse.

### Definition of done

- Renders correctly from a static `fixtures/world.json` with 5 characters, with the server off.
- No layout break with a 20-character name, a 3-line dialogue response, or multiple event-feed entries landing in one tick.
- Keyboard navigable — number keys pick menu options. It's a terminal game.

---

## Track D — Content & Design

**Deliverable:** the actual game, plus the confidence that it's fun.

This track produces data files, not engine code. It's the one that makes the difference between a tech demo and something people want to keep playing.

### Build

1. **Cast.** 5 characters with traits, starting relationships, a secret, and a want. Alice and Bob from the mockup, plus Calum and two more, is enough to start — five gives autonomous interactions somewhere to happen (rivalries, triangles, alliances) instead of just one NPC pair. Traits gate rules (`arrogant`, `loyal`, `gossip`) — coordinate the vocabulary with Track A.
2. **Move catalog.** Target ~15 moves, each with preconditions, effects, and a memory template. Start from: `Greet`, `Confront`, `GiveGift`, `SpreadRumor`, `RevealSecret`, `Defend`, `Insult`, `Apologize`, `AskForHelp`, `Refuse`, `Comply`, `Withdraw`, `Propose`.
3. **Rule tables.** Motivation rules and move rules as data. Own the volition numbers — with 5 characters all scoring independently each tick, expect more emergent combinations than with 3, and expect to change the numbers more than a hundred times.
4. **Scenario.** A starting configuration with a built-in tension — Bob has already betrayed Alice, the player has to pick a side or play both, and now Bob's own independent pursuit of Calum can complicate that without any player input. Your Day 3 / 14:25 mockup implies a multi-day arc; decide how long a full run should be (30 turns is a good target).
5. **Playtesting log.** Every session, write down: what you expected, what happened, which rule caused the gap — and specifically, whether an autonomous NPC-NPC move surprised you in a good way or just read as noise. This document is what turns tuning from vibes into work.
6. **Integration + QA.** Track D is also the person who runs the full stack end-to-end at every integration session and files the bugs. Nobody else is looking at the whole thing.

### Definition of done

- A 20-turn run where relationships end up meaningfully different from where they started, in a way a player can explain — including at least one relationship change the player didn't directly cause.
- Three distinct playthroughs from the same starting state that produce different endings.
- No character whose behavior a playtester describes as "random."

---

## Gates — what blocks what

No dates. Each gate is defined by what it unblocks, so the question is never "are we on schedule," it's "what is the next thing standing between someone and their work."

### G0 — Contracts
**Blocked by:** nothing.
**Blocks:** literally everything.
`types.ts` written and committed, including the directed-relationship-map shape and the multi-actor `TickResult.log`. Repo scaffolded, `.env.local` documented, `MOCK_LLM` flag agreed. Everyone can run `npm run dev`.

### G1 — Playable with no AI
**Blocked by:** G0.
**Blocks:** G2, G4, and all meaningful playtesting.
Hard-coded cast of 5, five moves, fixed menu, stub dialogue strings, real rules engine (including multi-actor resolution), real UI with an event feed. Requires A's `tick()`, C's layout, and D's first move catalog to meet.

**This should already be a game.** If it isn't fun with stub text — including the autonomous NPC-NPC moves reading as sensible rather than random — adding Gemini will not fix it, it will just make the un-fun harder to see. **This is the one gate worth stopping the project at.** If G1 lands flat, fix the design before writing another line of AI code.

### G2 — Dialogue is alive
**Blocked by:** G1 (needs real `PendingUtterance` objects to realize, for both player-facing and autonomous moves) and B's working Gemini client.
**Blocks:** G3, and any demo you'd show someone.
Stub strings replaced by generated lines. Streaming lands in the UI. Cost-control strategy for multi-actor ticks (from Track B) is in place before this gate closes, not discovered after.

### G3 — Memory matters
**Blocked by:** G2 (retrieval is pointless before prompts exist) and A's per-character memory writes.
**Blocks:** the pitch. This is the feature the project is actually about.
Engine writes memories to observers only; B retrieves top-k into prompts. Test: do something off-screen between two NPCs on turn 3 (with the player not present), have the player learn about it and see it referenced by turn 12.

### G4 — Custom actions
**Blocked by:** G1 only — needs a stable legal-move enum from A, *not* G2 or G3.
**Blocks:** nothing downstream.
This is the one branch that can run genuinely in parallel with G2/G3. If Track B has capacity while A is still landing memory writes, this is where it goes. Free-text input, interpretation, confirmation UI, hostile-input handling.

### G5 — Polish / endings / quests
**Blocked by:** G3.
**Blocks:** nothing.
Relationship-delta-triggered events, endings, save/load, demo script. **Cut quest generation first if anything has to go** — it's the least load-bearing item in the original proposal and nothing depends on it.

### The critical path

```
G0 → G1 → G2 → G3 → G5
          └──→ G4 (parallel, cuttable)
```

Everything on `G0 → G1 → G2 → G3` is critical path: a day lost there is a day lost overall. G4 and G5 are slack. When someone is blocked, they should be pulling work toward the critical path, not building out their own track's nice-to-haves.

### Standing blockers to watch for

These aren't gates, but they stall people the same way:

| If this is missing | These people are stuck |
|---|---|
| `types.ts` | all four |
| `MOCK_LLM=1` stub mode | C and D, permanently |
| `fixtures/world.json` (with all 5 characters) | C entirely, B for testing |
| Seeded RNG in the engine | D can't reproduce anything they find |
| Legal-move enum exposed by A | B can't build interpretation |
| Deterministic multi-actor tick ordering | A can't hand off a stable `tick()`, B and C build against something that will reshuffle |
| Debug panel showing winning motivation + score per NPC | D is tuning blind |

The bottom two are the ones teams forget. Track D cannot tune volition numbers without seeing which rule won *for which character*, and Track B cannot constrain the model without knowing what's legal. Both are small asks of Track A that unblock someone else's entire track — treat them as higher priority than they look.

---

## Integration protocol

- **Branch per track**, PR into `main`, one reviewer from a different track. Cross-track review is how people find out the seam changed.
- **Integration session on a fixed cadence** — everyone present, full stack running, Track D driving. Pick an interval and hold it; the failure mode is integrating only when something breaks.
- **Fixtures are shared property.** `fixtures/world.json` lives at the repo root, contains all 5 characters, and every track uses the same one. When it changes, announce it.
- **Nobody edits another track's directory.** Need something changed? Ask. This sounds bureaucratic for four people and it will save you a merge disaster later.
- **Announce blockers immediately, in public.** The whole plan above is a dependency graph; it only works if a blocked person says so the same hour rather than quietly working around it.

---

## Risks worth naming now

| Risk | Signal | Mitigation |
|---|---|---|
| LLM-first drift | Someone wires Gemini before G1 for a cool demo | G1 gate: playable with `MOCK_LLM=1` before any real call |
| Rules feel random | Playtester can't explain why an NPC acted, especially an off-screen one | Log the winning motivation + move + score per NPC per turn; surface in a debug panel |
| Relationship collapse | All 20 directed values pinned at 0 or 100 by turn 20 | Clamp, decay toward baseline, re-run the 200-turn headless check after every rule change |
| API cost/rate limits | Demo stalls, worse with up to 5 characters acting per tick | Cache realizations by `(move, mood, relationship bucket)`; batch or template off-screen moves; fallback lines always present |
| Event feed noise | Player stops reading the feed because too much fires every tick | Throttle how many NPCs act per tick, or raise the "worth acting on" threshold, rather than letting every qualifying NPC always fire |
| Track D under-invested | Everyone's building infrastructure, nobody's playing | Make the playtest log a required artifact at every integration session |
| Silent blocking | Someone's commits go quiet for a stretch | The standing-blockers table above — check it when progress stalls |

---

## Starting tasks per track

Everything here is unblocked the moment G0 lands.

- [ ] **All:** `types.ts` frozen (including directed relationship maps and multi-actor `TickResult`), repo scaffolded, owners assigned above
- [ ] **A:** `tick()` skeleton handling multiple candidate moves per tick, 3 moves, seeded RNG, first golden test (including one multi-actor conflict case) — then the legal-move enum and debug logging, because B and D are waiting on those
- [ ] **B:** Gemini client working, one hard-coded realization call returning valid JSON, `MOCK_LLM` flag, a first pass at the multi-actor cost strategy — ship the flag first, C and D need it more than you do
- [ ] **C:** Terminal layout rendering from a 5-character `fixtures/world.json`, including a first pass at the event feed panel, no server needed
- [ ] **D:** Cast of 5 written, 8 moves specced on paper, first draft of the volition tables
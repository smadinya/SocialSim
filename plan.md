# SocialSim — Update 1: "Conversations, Consequences, and Somewhere To Go"

**Status:** **built** on `update-1-conversations-consequences`. All nine phases landed;
93 tests, lint and typecheck green; verified against a live playthrough. §9 records where
the implementation departed from this plan and why.
**Companion docs:** [`socialsim-work-plan.md`](./socialsim-work-plan.md) (original track plan, gates G0–G5) · [`CONTRIBUTING.md`](./CONTRIBUTING.md) (branch/lint/review rules — still apply).

This document takes the feature list for the next update, diagnoses each item against the
code that actually exists, and turns it into nine phases with a dependency order,
file-level task lists, and done criteria.

The engine being updated is **`lib/mockEngine.ts`**, not `sim/`. `sim/` is still stubs
(`isLegalMove` returns `true` for any non-empty string). This update does not fix that —
it builds on the mock, and every place where the mock is standing in for `sim/` is marked
so Track A's eventual port has a target.

---

## 1. The requests, and what's actually wrong

Each row is one item from the feature list, matched to what the code does today. This
section exists so nobody re-diagnoses in review.

| Request | What the code does today | Real cause |
|---|---|---|
| "Characters don't keep track of their conversations" | `writeMemory` stores one flat atom per move (`"Alice confronted me."`). Nothing links two moves between the same pair. | There is no conversation object. Memory is a bag of unrelated sentences. |
| "Multiple conversations at the same time — shit just doesn't make sense" | `runTick` picks up to 2 NPC moves off a weighted table, shuffles them with the player's move, and appends a reply. All lines go into one flat `SceneView` list. | No conversational pairing, no turn-taking, no "you're busy" rule. Dana can address Bob mid-sentence while Bob is answering Alice, and the UI presents it as one stream. |
| "Need a way to respond when we are asked for help" | Alice's `AskForHelp → you` writes a memory and +3 respect. Nothing else. `Comply`/`Refuse` exist in `MOVE_META` and `MOCK_EFFECTS` but are **not** in `MENU_MOVE_IDS`. | No pending-request state, and the response moves aren't reachable from the menu. |
| "Have x person talking to y person indicator" | `SceneView`'s header shows a flat comma list of `presentCharacters`. | No pairing to display, per above. |
| "What was the big thing they are talking about" | `Move.args.subject` is filled by both interpreters and read by exactly one thing: `ai/adapt.ts`, to name a third party in the prompt. The engine ignores it. | No topic concept. Nothing in the world is *about* anything. |
| "Insult option. Fight option." | `Insult` is fully implemented (effects, dialogue, fallbacks) but absent from `MENU_MOVE_IDS`. `Fight` does not exist. | One is a two-line fix; the other needs escalation state to hang off. |
| "Find out who leaked the plan, but Alice already knows" | `fixtures/world.json` gives Alice a 0.95-importance memory reading *"Bob leaked the plan Alice trusted him with, then denied it to her face"* and a 0.65 belief *"Bob is the one who leaked the plan."* | **Scenario bug, not an engine bug.** The mystery's answer is in the detective's own head at turn 6. There is nothing to investigate. |
| "Move locations" | `SceneState` is one `location` string + `presentCharacters`. `pickArrival` walks NPCs in; `Withdraw` walks them out and is deliberately withheld from the player because "there is nowhere for the player to go" (`lib/moveMeta.ts:29`). | One room. |
| "Fear isn't going down" | Correct — nothing decreases fear. `Confront` is `+8 fear` on the target and **no move in `MOCK_EFFECTS` has a negative fear term.** There is no decay pass anywhere in the repo. | Fear is a ratchet. Over ~15 turns everyone is terrified of everyone. |
| "Adjust movement of tiers" | `relationshipTone` scores `(trust+affection+respect) − fear*3`. With fear ratcheting up, that number collapses and everyone flips to `cold` — which drives both NPC replies (`RESPONSES` in `mockEngine.ts`) and every fallback line. | Fear is triple-weighted against a value that can only rise. Tiers are a one-way valve. |
| "Add anger" | Doesn't exist. `state.emotions` is a free-form `Record<string, number>` that nothing writes and nothing reads. | — |
| "Relationship tracker — who is whose friend? who was what before?" | Inspector shows four raw bars per pair, current values only. No labels, no history. | No status derivation, no ledger. |
| "Things must progress somehow?" | The game runs forever. Clock advances 5 minutes per turn and never matters. No win, loss, phase, or ending. | No arc. |
| "Add an action to talk or hear about the thing" | Nothing. `RevealSecret` is the closest and it's about a *person*, not a *thing*. | Needs topics first. |
| "Add an argument feature" | `RESPONSES` gives one canned counter-move per incoming move. It cannot escalate — Insult→Insult is a fixed point that repeats forever with identical text. | No escalation state. |
| "Flirt" | Doesn't exist. | — |
| "Memory specifically for MAJOR events" | `MEMORY_CAP = 12`, evicted by lowest `importance`. Alice's betrayal memory survives at 0.95, but so do eleven `Greet` atoms at 0.2×0.6, and retrieval scores all thirteen equally. | Partial protection at the cap, none at retrieval. |
| "Days should be 8am–8pm, 24 moves max per day" | `advanceClock` (`lib/mockEngine.ts:36`) regexes `"Day 3 — 14:25"`, adds 5 minutes, rolls the day at 24:00, and re-serialises to a string. **Nothing in the repo reads the clock.** There is no bound on moves, no day boundary, and no notion of a day being *over*. | Time is a decorative string. Turns are free and infinite, so nothing the player does costs anything. |

Three themes run through the whole list:

1. **Nothing is *about* anything.** Moves land on people, never on subjects. Topics fix
   the conversation indicator, "talk about the thing", the argument feature, the mystery,
   and memory relevance all at once. It is the highest-leverage single addition here.
2. **Nothing releases.** Fear ratchets, anger doesn't exist, memory only accumulates,
   relationships never resolve into a state, the scenario never ends. Decay and
   progression are the same missing idea at three scales.
3. **Nothing is scarce.** Turns are unlimited and free. `Wait` costs nothing, walking
   somewhere would cost nothing, and no choice forecloses another. The day budget is what
   makes every other system in this document matter: chasing Bob to the Kitchen is only a
   decision if staying with Alice is the thing you gave up to do it.

---

## 2. The five new subsystems

Everything in the feature list resolves into five additions plus tuning.

### 2.1 Conversations

```ts
export type ConversationId = string;

export interface Conversation {
  id: ConversationId;
  participants: CharacterId[];       // exactly 2 in this update
  location: LocationId;
  topicId?: TopicId;                 // what it's about, if anything
  startedTurn: number;
  lastTurn: number;                  // idle for IDLE_TURNS => auto-close
  heat: number;                      // 0..100 escalation — see §2.4
  beats: ConversationBeat[];         // capped at 8; the thread's own memory
  status: 'open' | 'closed';
}

export interface ConversationBeat {
  turn: number;
  actor: CharacterId;
  moveId: MoveId;
  heatAfter: number;
}
```

Stored on `WorldState.conversations: Record<ConversationId, Conversation>`.
Each character gets `activeConversationId?: ConversationId`.

**The rules that make it "make sense":**

- A directed move between two co-located characters **joins** the open conversation
  between them, or opens a new one.
- **One conversation per character.** During move selection, anyone with an open
  conversation may only act *within* it. This is the single rule that fixes the
  interleaving complaint — Bob physically cannot address Calum while answering Alice.
- **The other participant owes the next beat.** `respondTo` (`lib/mockEngine.ts:133`)
  stops being "the target may reply if free" and becomes "the conversation advances."
  Replies stop being optional and stop being one-shot.
- A conversation closes on `Withdraw`, on either party changing location, on `Fight`, or
  after `IDLE_TURNS = 3` with no beat.
- Beats are the thread's memory. `writeMemory` gets `conversationId` and `topicId`, so a
  character can now recall *"the argument with Bob about the leak"* as a unit rather than
  four disconnected sentences.

**Prompting:** `PendingUtterance` gains `conversationBeats` (the last 3) and `topicLabel`.
This is what stops a character opening every line as if the conversation started fresh —
today the realize prompt has no idea a conversation is in progress at all.

### 2.2 Topics

```ts
export type TopicId = string;

export interface Topic {
  id: TopicId;
  label: string;                     // "the leaked plan"
  secret: boolean;
  awareOf: CharacterId[];            // knows the topic exists
  evidence: Evidence[];
}

export interface Evidence {
  id: string;
  topicId: TopicId;
  claim: string;                     // "Bob changed his story about when he heard it"
  heldBy: CharacterId[];             // who currently has it
  accurate: boolean;                 // false => plantable via SpreadRumor
  pointsAt?: CharacterId;            // who it implicates
  weight: number;                    // 0..1 contribution to belief confidence
}
```

Stored on `WorldState.topics`. `Move.args.topicId` becomes a first-class engine input.
`Memory` gains `topicId?`.

Topics buy, in one addition:

- the conversation subject line in the UI ("Dana → Bob · *the leaked plan*");
- `AskAbout` as a real move with a real payload (evidence transfer);
- memory relevance that isn't tag-string guessing (`ai/retrieval.ts`'s `moveTags` is
  currently *derived* from the effect table because there's nothing better);
- a mystery with actual state (§6).

### 2.3 Locations

```ts
export type LocationId = string;

export interface Location {
  id: LocationId;
  name: string;
  connectsTo: LocationId[];
  private: boolean;                  // conversations here aren't overheard
}
```

`Character` gains `location: LocationId`. `SceneState.presentCharacters` becomes
**derived**: everyone whose `location` equals the player's.

- New move `GoTo` (**not** `Move` — `Move` is already the action type name; do not
  introduce the collision).
- `pickArrival` (`lib/mockEngine.ts:203`) generalises into a movement rule: NPCs travel
  toward whoever their strongest tendency targets, one hop per tick.
- `Withdraw` returns to the player menu — the reason it was withheld disappears
  (`lib/moveMeta.ts:29`).
- `determineObservers` (`sim/src/world/perception.ts`) finally has something to compute:
  co-located and not in a `private` location.
- Off-location moves keep feeding the event feed via the existing `type: "offscreen"`
  path, re-keyed from `presentCharacters` to location equality.

Starting map — small on purpose, four rooms:

```
Courtyard ── West Wing Hall ── Library (private)
    └────────── Kitchen
```

### 2.4 Anger, heat, and decay

**Anger is a fifth directed relationship axis**, not a character-level emotion.
Everything the feature list wants from it — arguments, insults, fights, cooling off — is
about being angry *at a specific person*. A single `character.state.emotions.anger`
scalar cannot express "furious at Bob, fine with Dana," which is the entire point.

*(Alternative considered: keep it in `state.emotions`. Cheaper — no schema change, no
5th `TrustBar`, no cache-key change — but it makes `Fight` and `Argue` untargetable and
would need replacing within one update. Not worth the deferral. Flagging it here because
it is the one genuinely contestable call in this document.)*

```ts
export interface Relationship {
  trust: number;
  affection: number;
  respect: number;
  fear: number;
  anger: number;                              // NEW
  baseline: Record<RelationshipAxis, number>; // what decay pulls toward
  lastDelta: Partial<Record<RelationshipAxis, number>>;
  flags: string[];                            // 'betrayed' | 'allied' | 'rival' | ...
  history: RelationshipEvent[];               // capped at 6 — see §2.5
}
```

**Decay pass**, end of `runTick`, after effects and before cognition patches. Each axis
moves toward `baseline` by a per-axis rate:

| Axis | Rate / turn | Rationale |
|---|---|---|
| `fear` | 12% of the gap | Spikes hard, fades fast. This is the fix for "fear isn't going down." |
| `anger` | 15% of the gap | Faster than fear — you cool off before you stop being scared. |
| `affection` | 4% | Drifts. |
| `respect` | 3% | Slow both ways. |
| `trust` | 2% | Earned slowly, and a betrayal shouldn't heal itself in ten turns. |

Plus explicit release valves in the effect table — `Apologize` gets `anger −12` on
target, `Reassure` gets `fear −10, anger −6`, `Comply` gets `anger −5`. Today **not one
move in the repo reduces fear.**

**`relationshipTone` is retuned.** The current formula
(`(trust+affection+respect) − fear*3`) triple-weights the one axis that only rises. It
feeds both NPC reply selection and every fallback line, so this one function decides how
the game sounds. Replacement:

```
warmth = trust + affection + respect
threat = fear + anger * 1.5
warm    if warmth - threat >= 110
cold    if warmth - threat <=  40
neutral otherwise
```

With hysteresis: crossing a boundary requires clearing it by 8, so a relationship sitting
on the line doesn't flicker between warm and cold dialogue every turn. That is the
"adjust movement of tiers" ask.

`bucket()` thresholds (75/45/20) also shift to 70/40/15 — with decay in place, values
cluster nearer their baselines and the old bands left almost nothing in `none`.

### 2.5 Relationship status and history

Derived label per directed pair, computed from axes + flags:

| Label | Condition |
|---|---|
| `close` | trust ≥ 70 and affection ≥ 70 |
| `friend` | trust ≥ 55 and affection ≥ 50 |
| `ally` | flag `allied`, or trust ≥ 60 and respect ≥ 60 |
| `wary` | trust < 40 or fear ≥ 40 |
| `rival` | respect ≥ 50 and affection < 35 |
| `estranged` | flag `betrayed`, or trust < 25 and anger ≥ 40 |
| `hostile` | anger ≥ 60 |
| `neutral` | none of the above |

```ts
export interface RelationshipEvent {
  turn: number;
  was: RelationshipStatus;
  now: RelationshipStatus;
  because?: string;               // memory id or move id
}
```

Appended whenever the derived label changes, capped at 6. This is literally the
"who was what before" ask, and it's also the event source G5 of the original plan wanted
("watch for flag transitions and threshold crossings" —
`socialsim-work-plan.md`, G5).

### 2.6 Major memories

```ts
export interface Memory {
  // ...existing
  valence: number;                 // -1..1  (already in ai/types.ts, never in sim)
  tier: 'direct' | 'overheard' | 'told';
  accurate: boolean;
  core: boolean;                   // NEW — a MAJOR event
  topicId?: TopicId;               // NEW
  conversationId?: ConversationId; // NEW
}
```

`core` is set by move class, not by a number: **betrayal, secret revealed, alliance
formed, argument, fight, leak evidence learned, relationship status change.** Core
memories:

- are **exempt from `MEMORY_CAP`** — the cap applies only to ordinary memories;
- get a **decay floor** in `ai/retrieval.ts`'s `effectiveImportance` (never below 0.5 of
  their write-time importance, so a turn-0 betrayal never loses to yesterday's greeting);
- render in their own Inspector section above recent memories.

This is what the retrieval scorer's existing `// ponytail: floored-tag convention` note
was waiting for.

### 2.7 Time: days, hours, and the move budget

A day runs **08:00 to 20:00** — twelve waking hours — and holds **24 moves**. That
divides exactly: **one move is 30 minutes**, slot 0 opens the day at 08:00, and the move
taken in slot 23 ends it at 20:00.

```ts
export interface WorldState {
  // ...
  day: number;                 // 1-based
  slot: number;                // 0..23 — moves already spent today
  // `clock` becomes DERIVED for display: 08:00 + slot * 30 minutes.
}

export const DAY_START_MINUTES = 8 * 60;   // 08:00
export const MINUTES_PER_MOVE  = 30;
export const MOVES_PER_DAY     = 24;       // 08:00 -> 20:00 exactly
```

**Time stops being a string.** `advanceClock` (`lib/mockEngine.ts:36`) parses
`"Day 3 — 14:25"` with a regex every tick and silently returns the input unchanged if the
regex misses — so a malformed clock freezes time forever with no error. It is replaced by
`day`/`slot` integers plus a pure `formatClock(day, slot)` for the header. String parsing
does not come back.

**Every move costs one slot**, including `Wait`, `GoTo`, and `Withdraw`. Travel costing a
slot is what gives the map in §2.3 its weight — the Library being two rooms away is a
price, not a detail. *(Alternative: `GoTo` at half a slot. Rejected — it makes the budget
non-integer and buys nothing a shorter map wouldn't.)*

**End of day is a real beat, not a rollover.** When slot 23 resolves, a **night pass**
runs before Day N+1 slot 0:

| Night pass step | Why here |
|---|---|
| All open conversations close | Nobody carries an argument across a night unresolved. Gives `Conversation.status` a guaranteed terminator (§2.1). |
| Pending requests expire, with their penalty | An unanswered "will you help me?" cannot sit open for two days (§2.4 of U3). |
| Decay steps **3× the per-turn rate** | Sleeping on it. This is where fear and anger actually reset — the single biggest answer to "fear isn't going down". |
| Baselines drift toward current values by 10% | The counterweight to decay-mushiness (§7). A betrayal permanently moves where trust returns to; it does not heal to par overnight. |
| Ordinary memories from the day consolidate | Twelve `Greet` atoms become one *"a quiet day in the courtyard."* Core memories pass through untouched (§2.6). |
| NPCs take **2 unwatched ticks** | The world runs while you sleep — the README's whole premise. Surfaces the next morning as a digest. |

The player opens Day N+1 on a **"while you slept"** digest in the event feed. This is the
cheapest possible source of the thing the game is supposed to be about: consequences you
didn't witness.

**Time-of-day bands** — morning (slots 0–7), afternoon (8–15), evening (16–23) — are
available for location occupancy and mood flavour. Cuttable; see §8.

---

## 3. The schema change

Everything above needs `sim/src/types.ts`, which `CONTRIBUTING.md` declares frozen and
all four tracks import. **Do it once, deliberately, as the first commit of this update**,
rather than five times across five branches.

New/changed in `sim/src/types.ts`:

- `RelationshipAxis` union incl. `anger`; `Relationship` gains `anger`, `baseline`,
  `lastDelta`, `flags`, `history`.
- `Memory` gains `valence`, `tier`, `accurate`, `core`, `topicId`, `conversationId`.
- `Belief` gains `subject: CharacterId` and `axis?`.
- `Character` gains `location`, `activeConversationId?`.
- New: `Conversation`, `ConversationBeat`, `Topic`, `Evidence`, `Location`,
  `PendingRequest`, `RelationshipEvent`, `RelationshipStatus`.
- `WorldState` gains `locations`, `topics`, `conversations`, `pendingRequests`, `phase`,
  `day`, `slot`. **`clock` is removed as stored state** and becomes a derived display
  string — leaving it in invites two sources of truth for the same fact.
- `SceneState` narrows to a derived view; `presentCharacters` computed from `location`.

Knock-ons, all mechanical, all in this same commit:

| File | Change |
|---|---|
| `ai/types.ts` | **Delete.** Its header says *"Delete this file at G0 and repoint the imports."* This is that moment. |
| `ai/adapt.ts` | Drop `toMemory`/`toBelief`/`toRelationship` defaulting; read the real fields. |
| `lib/format.ts` | `REL_FIELDS` gains `anger`; retune `bucket` and `relationshipTone` (§2.4). |
| `sim/src/cognition/schemas.ts` | `RelationshipField` union gains `anger`; `CognitionPath` gains conversation/topic paths. |
| `ai/cache.ts` | `cacheKey` gains the 5th axis (256 → 1024 buckets) **and** `topicId` + `heat` band. Without the topic in the key, two conversations about different things serve each other's lines. |
| `lib/save.ts` | Bump `SaveBlob.version` to `2`; `loadSession`/`parseImported` reject v1 with a message rather than loading a world missing half its fields. No migration — the fixture is being rewritten anyway. |
| `fixtures/world.json` | Full rewrite (§6). |
| `components/TrustBar.tsx`, `CharacterInspector.tsx` | Fifth bar. |
| `app/globals.css` | `--anger` colour token; conversation-tag and status-pill styles. |

**Coordination:** this is exactly the "changing `sim/src/types.ts` needs a heads-up to
everyone" case in `CONTRIBUTING.md`. One PR, all four reviewers, merged before any phase
below starts a branch.

---

## 4. Phases

Ordered by dependency, not by importance. `U1` is deliberately first because it's the
cheapest fix for a live complaint and it needs nothing but the schema.

```
U0 (schema) ─┬─ U1 (decay/anger/tiers) ── U1b (days + move budget) ─┐
             │                                                     │
             ├─ U2 (conversations) ─┬─ U3 (responding) ─┬─ U4 (moves + argument)
             │                      │                   │
             ├─ U5 (locations) ─────┘                   │
             │                                          │
             ├─ U6 (memory) ──── U7 (relationship tracker UI)
             │                                          │
             └──────────────────────────────────────────┴─ U8 (mystery + progression)
                                             U8 needs U1b, U2, U4, U6
```

**U1b is a hub, not a leaf.** It lands the day/slot/budget skeleton and an empty night
pass early; U2, U3 and U6 each hook their own step into that pass as part of their own
phase (conversation close, request expiry, memory consolidation). Building it late means
retrofitting a day boundary into three subsystems that were written without one.

---

### U0 — Schema and fixture

**Blocked by:** nothing. **Blocks:** everything.

- [ ] Rewrite `sim/src/types.ts` per §3.
- [ ] Delete `ai/types.ts`, repoint `ai/*` imports, strip defaulting from `ai/adapt.ts`.
- [ ] Update `lib/format.ts`, `sim/src/cognition/schemas.ts`, `ai/cache.ts`, `lib/save.ts`.
- [ ] Rewrite `fixtures/world.json` — 5 characters × 5 axes with baselines, 4 locations,
      3 topics with evidence, empty conversations. (Content detail in §6.)
- [ ] Green: `npm run lint`, `npm run typecheck`, `npm test`.

**Done when:** the game boots on the new fixture and plays exactly as it does today —
no behaviour change, five bars instead of four. A pure-plumbing commit.

---

### U1 — Decay, anger, and tier movement

**Blocked by:** U0. **Blocks:** U4.
**Answers:** "fear isn't going down", "add anger", "adjust movement of tiers".

- [ ] `lib/mockEngine.ts`: `decayPass(world)` — per-axis pull toward `baseline` (§2.4
      table), run after effects, before cognition patches. Populate `lastDelta` while
      you're there; `ai/adapt.ts`'s `deltaFor` shim can then go away.
- [ ] `lib/moveMeta.ts`: anger terms across `MOCK_EFFECTS`; `Apologize`/`Comply` get
      negative anger; add `Reassure`. Rebalance magnitudes — current values (`Insult`
      −10 affection, `Confront` +8 fear) were tuned with no decay underneath them and
      will over-swing once decay is pulling back.
- [ ] `lib/format.ts`: new `relationshipTone` with hysteresis, new `bucket` bands.
- [ ] `lib/mockEngine.ts`: `MOOD_FOR` gains `anger:+` → `"furious"`, `anger:-` →
      `"cooling"`.
- [ ] `ai/prompts/realize.ts`: `axisLine` picks up anger automatically via `REL_FIELDS` —
      verify, don't assume.
- [ ] Tests in `lib/mockEngine.test.ts`: fear spiked by `Confront` returns within 15%
      of baseline inside 12 turns of no further provocation; a relationship sitting 4
      points from a tone boundary does not change tone across 5 turns (hysteresis).

**Done when:** confront someone six times, then leave them alone. Their fear visibly
falls back. It does not today, at all.

**Watch:** `relationshipTone` feeds `respondTo` *and* `fallbackLine`. Retuning it changes
NPC behaviour and dialogue tone in the same commit. Playtest both.

---

### U1b — Days, the move budget, and the night pass

**Blocked by:** U1 (the night pass runs a decay step, so decay has to exist).
**Blocks:** U8. **Hooked into by:** U2, U3, U6.
**Answers:** "days should be 8am–8pm, 24 moves at most per day". Also the structural half
of "things must progress somehow?" — U8 supplies the story arc, this supplies the pressure.

- [ ] `lib/clock.ts` (new): `formatClock(day, slot)`, `bandFor(slot)`, `movesLeft(slot)`,
      and the three constants from §2.7. Pure, no `Date`, no parsing.
- [ ] **Delete `advanceClock`** (`lib/mockEngine.ts:36`). `runTick` increments `slot`;
      `clock` stops being stored. Its regex-returns-input-on-miss failure mode does not
      survive into this update.
- [ ] `lib/mockEngine.ts`: `nightPass(world)` when `slot` reaches 24 — steps per the §2.7
      table, then `day += 1; slot = 0`. Land it with the decay/baseline-drift steps only;
      U2, U3 and U6 add theirs.
- [ ] Night pass runs **2 unwatched NPC ticks** and returns their events as a
      `type: "overnight"` batch. `buildPlan` (`lib/reducer.ts:121`) renders them as a
      **"while you slept"** digest at the head of the next day's first reveal — a new
      `RevealStep` kind, not a stream of ordinary feed lines, or the morning reads as
      noise.
- [ ] `components/Terminal.tsx` header: `Day 3 · 14:30 · 11 moves left` replaces
      `{clock}` + `turn {n}`. Keep `turn` in the world state — tests and memory ids use
      it — but stop showing a raw counter that means nothing to a player.
- [ ] `app/globals.css`: a day-progress meter in the status bar. It should get visibly
      short. That is the entire point.
- [ ] `fixtures/world.json`: `day: 3, slot: 13` — 14:30, 11 moves left on the first day,
      which lines up with the scenario's existing "Day 3, mid-afternoon" framing.
- [ ] Tests: 24 moves advances exactly one day and lands on 20:00; `formatClock(3, 13)`
      is `"Day 3 — 14:30"`; the night pass closes the day exactly once even if a tick
      resolves several moves; fear measurably drops across a night boundary.

**Done when:** the header counts down, the day ends on its own, and you wake up to news.

**Watch:** the budget makes `Wait` expensive, and `Wait` is the only move that costs
nothing today. Verify there is no state where the player *must* burn slots — if every
target is off-location and `GoTo` is the only legal move, the budget is being spent on
walking and that is a map problem, not a clock problem. Playtest with the four-room map
before committing to 24.

---

### U2 — Conversations, topics, and the talking-to indicator

**Blocked by:** U0. **Blocks:** U3, U4, U8.
**Answers:** "characters don't keep track of their conversations", "multiple
conversations at the same time", "x talking to y indicator", "what was the big thing
they are talking about".

- [ ] `lib/conversations.ts` (new): `openOrJoin`, `advance`, `close`, `heatFor`,
      `beatsFor`. Pure functions over `WorldState`, no I/O.
- [ ] `lib/mockEngine.ts`:
  - route every directed move through `openOrJoin` before effects;
  - **one-conversation-per-character** filter in `legalTendencies` — an engaged character
    only draws tendencies aimed at their partner;
  - replace `respondTo` with conversation advancement (the partner owes the next beat);
  - `writeMemory` records `conversationId` and `topicId`;
  - close idle conversations at end of tick.
- [ ] `lib/viewTypes.ts` / `lib/reducer.ts`: `RevealStep` gains `conversationId`.
      **`buildPlan` currently pairs deltas by `sourceActor`** (`lib/reducer.ts:159`) —
      with two conversations resolving in one tick that mis-attributes. Key by
      conversation.
- [ ] `components/SceneView.tsx`: group lines by conversation. Header shows active pairs
      — `Dana → Bob · the leaked plan` — one row per open conversation at the player's
      location.
- [ ] `ai/adapt.ts` + `ai/prompts/realize.ts`: `PendingUtterance` gains
      `conversationBeats` (last 3, as `"Alice: Confront"` lines) and `topicLabel`.
      **Guard the prompt-leak test** — `ai/__tests__/prompts.test.ts` asserts no
      third-party ground truth reaches a prompt. Beats are the speaker's own thread, so
      they're fair game; topic *evidence* is not. Send the label, never the evidence list.
- [ ] Tests: two NPC pairs converse in one tick without cross-talk; a third character
      cannot address someone mid-conversation; beats accumulate and cap at 8.

**Done when:** you can look at the scene header and say who is talking to whom about
what, and nobody is answering two people at once.

---

### U3 — Responding when someone asks you something

**Blocked by:** U2.
**Answers:** "need a way to respond when we are asked for help".

```ts
export interface PendingRequest {
  id: string;
  from: CharacterId;
  to: CharacterId;
  moveId: MoveId;                  // AskForHelp | Propose | AskAbout
  topicId?: TopicId;
  turnAsked: number;
  expiresTurn: number;             // turnAsked + 3
}
```

- [ ] Engine writes a `PendingRequest` when `AskForHelp` / `Propose` / `AskAbout` lands
      on any character. NPC targets resolve theirs during move selection (this replaces
      the `RESPONSES` table's warm/cold coin-flip with something that reads state).
- [ ] Expiry has a cost: −6 affection, −4 respect toward the ignorer. Ignoring is a
      choice, and it should read as one.
- [ ] `components/ActionMenu.tsx`: a **response row** pinned above the move grid when the
      player has a live request — `Agree` / `Refuse` / `Deflect`, target pre-filled,
      showing who asked and what for, with a turns-remaining count.
- [ ] `MENU_MOVE_IDS` gains `Comply` and `Refuse` (they've been implemented and
      unreachable since day one).
- [ ] `lib/interpret.ts` + `ai/prompts/interpret.ts`: "yes" / "sure" / "I'll help" map to
      `Comply` **against the pending request's asker**, not against the currently selected
      target. Same for "no" / "not a chance" → `Refuse`. This is the case the keyword
      table gets wrong today.
- [ ] Tests: request expires with the stated penalty; `Comply` while a request is live
      targets the asker even if another character is selected.

**Done when:** Alice asks for help and you can say yes, say no, or let it lapse, and all
three feel different a few turns later.

---

### U4 — Insult, Fight, Flirt, AskAbout, and arguments

**Blocked by:** U1 (anger), U2 (heat lives on conversations).
**Answers:** "insult option", "fight option", "flirt", "add an argument feature",
"add an action to talk or hear about the thing".

**Arguments are emergent, not a move.** A conversation's `heat` rises when hostile moves
land in it (`Confront` +18, `Insult` +25, `Refuse` +10, `SpreadRumor` +12) and falls with
warm ones (`Apologize` −30, `Comply` −15, `Reassure` −20) plus −8/turn drift.

| Heat | State | Effect |
|---|---|---|
| 0–29 | conversation | normal |
| 30–59 | **tense** | UI tags it; fallback lines shift cold; effect magnitudes ×1.25 |
| 60–84 | **argument** | UI tags it; `Fight` unlocks for both parties; ×1.5; every beat writes a `core` memory |
| 85+ | **breaking** | next hostile move auto-escalates to `Fight` |

New moves:

| Move | Effects (on target unless noted) | Notes |
|---|---|---|
| `Insult` | affection −10, respect −4, **anger +18**, fear +4 | Already implemented; add anger, add to `MENU_MOVE_IDS`. |
| `Fight` | trust −20, affection −18, respect ±8, fear +25, anger +30, both directions | A blow-up — shouting, shoving, storming off. Not combat. Requires heat ≥ 60 or anger ≥ 70. Sets flag `estranged`, writes a `core` memory for every observer, **closes the conversation**, and forces the loser to `GoTo` an adjacent location. |
| `Flirt` | affection +12, fear −4; if target affection < 30: respect −6 instead ("awkward") | Sets flag `flirting`; third success sets `close`. Reciprocation gated on the target's affection, so it can visibly fail. |
| `AskAbout` | respect +2; on success transfers one `Evidence` as a `tier: 'told'` memory | Needs `args.topicId`. Success gated on the target's trust in the asker ≥ 45 and awareness of the topic. Failure = deflection + suspicion of the asker. This is "talk or hear about the thing." |
| `Reassure` | fear −10, anger −6, affection +4 | The release valve U1 needs. |
| `GoTo` | none | U5. |

- [ ] Menu problem: `MENU_MOVE_IDS` has 6 entries and `Terminal.tsx`'s key handler maps
      `1`–`9` positionally. This update pushes it to ~13. **Group the menu into four
      rows** — *Talk · Press · Warm · Move* — with number keys addressing the open row and
      `Tab` cycling rows. Do not silently truncate past 9.
- [ ] `lib/interpret.ts` keyword table + `ai/prompts/interpret.ts` legal-move list +
      `sim/src/moves/catalog.ts` `MOVE_IDS` — **all three** must gain every new move.
      `catalog.ts`'s own comment records what happens when they drift: "wait" came back
      as `Withdraw` because the enum was stale.
- [ ] `ai/fallbacks.ts`: cold/neutral/warm lines for all five new moves. Non-negotiable —
      it's what plays with no API key.
- [ ] Tests: heat crosses 60 after two Insults and unlocks `Fight`; `Fight` closes the
      conversation and relocates the loser; `Flirt` at low affection produces the awkward
      branch.

---

### U5 — Locations and movement

**Blocked by:** U0 (schema), and lands cleanest after U2 so conversations already know
their location.
**Answers:** "move locations".

- [ ] `fixtures/world.json`: four locations per §2.3; every character gets a `location`.
- [ ] `lib/mockEngine.ts`: `presentCharacters` derived from location equality every tick;
      `pickArrival` becomes `pickMovement` (one hop per tick toward a tendency target);
      moves require co-location; leaving closes your conversation.
- [ ] `GoTo` on the player menu; `Withdraw` restored to the menu (its blocker is gone).
- [ ] `sim/src/world/perception.ts`: implement `determineObservers` for real — co-located
      and not in a `private` location. It is a TODO stub returning
      `[...presentCharacters]` today.
- [ ] `components/SceneView.tsx`: location name + exits in the header; arrival/departure
      lines already exist in the reveal pipeline.
- [ ] `components/CharacterInspector.tsx`: `off scene` becomes the actual room name.
- [ ] Tests: a conversation in the Library is not observed from the Courtyard; moving
      closes the mover's conversation; NPCs converge on their tendency targets.

**Watch:** the player leaving the room the drama is in means empty ticks. Keep the event
feed loud — off-location moves must still report, or moving feels like a punishment.

---

### U6 — Major memories and retrieval

**Blocked by:** U0; better with U2 (conversation grouping).
**Answers:** "memory specifically for MAJOR events, argument, leaking secrets".

- [ ] `lib/moveMeta.ts`: `CORE_MOVES` set — `Fight`, `RevealSecret`, `SpreadRumor`,
      `Propose` (when accepted), `Confront` at heat ≥ 60, and any relationship status
      change.
- [ ] `lib/mockEngine.ts`: `writeMemory` sets `core`, `valence`, `tier`, `accurate`,
      `topicId`, `conversationId`. **`MEMORY_CAP` applies to ordinary memories only** —
      the sort at `mockEngine.ts:314` must partition first.
- [ ] `ai/retrieval.ts`: decay floor for core memories in `effectiveImportance`; new
      topic-match term in `scoreMemory` (replacing part of the derived-tag guesswork in
      `moveTags`); re-weight the five terms with the new one added.
- [ ] `components/CharacterInspector.tsx`: a "What they won't forget" section above
      recent memories.
- [ ] Tests: 30 turns of `Greet` spam does not evict a turn-0 betrayal *or* push it out
      of the top 5 retrieved for a related move.

---

### U7 — Relationship tracker

**Blocked by:** U0, U6.
**Answers:** "who is whose friend? who was what before?"

- [ ] `lib/relationships.ts` (new): `statusFor(rel)` per §2.5; `recordStatusChange` which
      appends to `history`, writes a `core` memory, and emits a `SimEvent`.
- [ ] Engine calls it at end of tick for every directed pair that moved.
- [ ] `components/RelationshipMap.tsx` (new panel): 5×5 grid of directed status labels,
      colour-coded, click a cell to open that pair in the Inspector. Reachable from a
      header toggle — `app/globals.css`'s grid is already four named areas and the
      responsive breakpoint at 900px stacks them; add the map as an overlay rather than a
      fifth area.
- [ ] Inspector relationship rows gain the status pill and a one-line "was `friend`
      until turn 12" from `history`.
- [ ] Event feed carries status changes: *"Alice no longer counts Bob a friend."*

---

### U8 — The mystery, and something to play toward

**Blocked by:** U2 (topics), U4 (`AskAbout`), U6 (core memories).
**Answers:** "find out who leaked the plan, but Alice already knows", "things must
progress somehow?"

See §6 for the scenario content. Engine work:

- [ ] `WorldState.phase: ScenarioPhase` — `suspicion` → `investigation` → `reckoning` →
      `resolved`. Transitions on evidence count and clock, announced in the feed.
- [ ] Evidence transfer via `AskAbout` / `RevealSecret` / overhearing a conversation on
      the topic.
- [ ] Alice's belief confidence in "X leaked the plan" is a **function of the evidence
      she holds** and who it points at, not a name-matching nudge.
      `beliefPatches` (`lib/mockEngine.ts:341`) is explicitly a placeholder — its own
      comment says *"name matching stands in for `Belief.subject`. Replace at G0."*
      This is that replacement.
- [ ] `SpreadRumor` plants evidence with `accurate: false`. The player can frame Calum.
      Alice can reach the wrong conclusion and act on it. **This is the feature that makes
      it a game** rather than a fact-collection exercise, and the schema has carried the
      `accurate` flag since the original plan without anything ever setting it.
- [ ] Endings at `reckoning`: Bob exposed · Bob forgiven · wrong person blamed · Alice
      cuts everyone off. Each is a terminal `SimEvent` plus an end card.
- [ ] **The deadline is the budget** (§2.7, U1b). Opening at `day 3, slot 13`, the
      reckoning fires at the **end of Day 4** — 11 moves left today plus 24 tomorrow =
      **35 moves total**. "The rest of today and all of tomorrow" is a deadline a player
      can hold in their head; "Day 4, 18:00" is not.
- [ ] Phase transitions are clock-aware as well as evidence-aware: `investigation` opens
      on the first evidence transfer or at Day 4 slot 0, whichever comes first, so a
      passive player still gets moved along.
- [ ] 35 moves is the **first tuning dial to touch** if playtests come back tight or
      slack — it moves independently of every other number here. Track D owns it. Push
      the reckoning to Day 5 (59 moves) before you consider widening `MOVES_PER_DAY`,
      which would desync the 30-minute grid.

---

## 5. Move catalog after this update

| Move | Status | Menu row |
|---|---|---|
| `Greet` | existing | Talk |
| `AskAbout` | **new** | Talk |
| `RevealSecret` | existing, gains `topicId` | Talk |
| `Confront` | existing, gains `topicId` (= accusation) | Press |
| `Insult` | existing, **menu-exposed**, gains anger | Press |
| `Fight` | **new**, gated on heat | Press |
| `SpreadRumor` | existing, now plants inaccurate evidence | Press |
| `Refuse` | existing, **menu-exposed** | Press |
| `GiveGift` | existing | Warm |
| `Flirt` | **new** | Warm |
| `Apologize` | existing, gains anger −12 | Warm |
| `Reassure` | **new** | Warm |
| `Defend` | existing | Warm |
| `Comply` | existing, **menu-exposed** | Warm |
| `AskForHelp` | existing, now creates a `PendingRequest` | Talk |
| `Propose` | existing, now creates a `PendingRequest` | Talk |
| `GoTo` | **new** | Move |
| `Withdraw` | existing, **menu restored** | Move |
| `Wait` | existing, **now costs a slot** | Move |

Six new moves; four existing ones that were built and never reachable. **Every row costs
one of the day's 24 moves** — `Wait`, `GoTo` and `Withdraw` included (§2.7).

---

## 6. Scenario rewrite: what Alice actually knows

The current fixture hands Alice the answer. `mem-alice-1` reads *"Bob leaked the plan
Alice trusted him with, then denied it to her face"* at importance 0.95, and `bel-alice-1`
is *"Bob is the one who leaked the plan"* at 0.65 confidence. There is no investigation
available because the investigator is already right.

**Restructure — asymmetric knowledge:**

- **Alice** knows the plan leaked, and that she told exactly one person: Bob. Her memory
  becomes *"I told Bob the plan in confidence. Four days later a rival was acting on it."*
  Belief: *"Someone I trusted talked"* at 0.5, `subject` unset. She is **suspicious, not
  certain** — which is what the feature list asks for: she's deciding whether to trust Bob
  yet.
- **Bob** keeps ground truth. He knows he did it. That asymmetry is the entire game.
- **Dana** holds evidence (`bob-changed-story`) and will hand it over at trust ≥ 45.
- **Calum** holds evidence *he doesn't know is evidence* (`calum-heard-early` — Bob
  mentioned the plan to him before it was public). Requires `AskAbout` with the right
  topic; he has no idea it matters.
- **You** start knowing nothing, in a room with two people who each hold half of it.

**Topic `the-leak`, evidence:**

| id | claim | held by | points at | weight |
|---|---|---|---|---|
| `told-only-bob` | Alice confided the plan to Bob alone | alice | bob | 0.35 |
| `bob-changed-story` | Bob gave two different accounts of when he heard it | dana | bob | 0.30 |
| `calum-heard-early` | Bob mentioned the plan to Calum before it was public | calum | bob | 0.30 |
| `bob-alibi-thin` | Bob's account of that evening doesn't hold up | — (unlocked by `Confront` on `the-leak` at fear ≥ 45) | bob | 0.25 |
| `calum-seen-with-rival` | Calum was seen talking to the rival | — (**plantable, inaccurate**, via `SpreadRumor`) | calum | 0.30 |

Alice's confidence in a suspect = sum of held evidence weights pointing at them, clamped
0.05–0.95. At ≥ 0.70 she acts; below 0.35 by the deadline she cuts everyone off. She
cannot tell accurate evidence from planted evidence — only the player, who planted it,
knows.

Two more topics for texture: `bob-and-calum` (Bob's courtship of Calum, not secret) and
`dana-promise` (Dana's pledge to Alice, secret from Bob).

**Playtest target:** a run where the player frames Calum successfully, Alice acts on it,
and Dana — who holds `bob-changed-story` — turns on the player for it. If that run works,
the update landed.

---

## 7. Things that will bite

| Risk | Why | Mitigation |
|---|---|---|
| **The schema commit blocks four people** | Every track imports `sim/src/types.ts`. | U0 is one PR, all four reviewers, merged before any other branch opens. Nothing else starts. |
| **`relationshipTone` drives behaviour *and* voice** | `respondTo` and `fallbackLine` both read it. Retuning it in U1 changes what NPCs do and how they sound at once. | Land the formula and the effect-table rebalance in separate commits so a bad playtest can be bisected. |
| **Cache collisions across conversations** | `cacheKey` has no topic and no conversation. Two arguments about different things would serve each other's lines — and the key already carries a scar from this class of bug (see the comment in `ai/cache.ts`). | Topic + heat band in the key, in U0. |
| **Prompt leakage** | Topics and evidence are exactly the kind of third-party ground truth `ai/__tests__/prompts.test.ts` exists to keep out of prompts. | Send `topicLabel`, never the evidence list. Extend the existing test to assert evidence claims never appear. |
| **`buildPlan` mis-attributes deltas** | It filters `result.deltas` by `sourceActor` (`lib/reducer.ts:159`). Two conversations in one tick will cross the wires. | Key reveal steps by conversation in U2. Has to happen in the same commit that allows parallel conversations. |
| **Menu overflows the number keys** | 6 moves today, ~13 after. `Terminal.tsx` maps `1`–`9` positionally. | Row grouping in U4. Decide it before adding move 10, not after. |
| **Locations empty the screen** | Player walks to the Kitchen and the drama continues without them, invisibly. | Event feed must stay loud for off-location moves; playtest specifically for "did moving feel like being punished." |
| **Decay makes everything mushy** | Pull everything to baseline hard enough and nothing ever changes. | Baselines drift too — a `core` memory shifts the baseline it decays toward. Otherwise the betrayal literally heals. |
| **Saves break** | v1 blobs lack half the new fields and will load as a half-initialised world. | `SaveBlob.version: 2`, explicit rejection of v1, in U0. |
| **24 moves is too few for what U8 asks** | Gathering five evidence pieces, through multi-beat conversations, across four rooms, on a 35-move budget. The budget and the mystery were sized independently and will not agree first try. | Playtest U8 against the real budget before tuning either. The deadline moves (Day 5 = 59 moves); the 30-minute grid does not. |
| **The night pass hides the game** | 2 unwatched NPC ticks per night, silently, is the world moving without the player ever seeing why. | The "while you slept" digest is a **required** deliverable of U1b, not polish. If it slips, cut the night ticks to 0 until it lands. |
| **Three phases hook into one function** | U2, U3 and U6 all add a step to `nightPass`. Three branches editing one function is a merge conflict with a schedule. | U1b lands `nightPass` with named no-op step slots. Each phase fills its own slot; nobody rewrites the ordering. |
| **Six new moves need six × three fallback lines** | `ai/fallbacks.ts` is what plays with no API key — the README's whole "plays fine with the server off" claim. | Track D writes them as part of U4, not after. |

---

## 8. If something has to be cut

In this order, cheapest to lose first:

1. **Time-of-day bands (§2.7)** — morning/afternoon/evening flavour. The day budget and
   the night pass are load-bearing; the *bands* are decoration until locations have
   schedules.
2. **`Flirt`** — the only item with no dependents. Pure content.
3. **`RelationshipMap` panel (U7)** — the derived status labels and `history` are load-bearing
   for U8's events; the *grid UI* is not. Ship the status pill in the Inspector and drop
   the panel.
4. **Overnight NPC ticks (U1b)** — keep the day boundary, the budget and the decay step;
   drop the 2 unwatched ticks and the digest that renders them. The clock still works.
5. **Locations (U5)** — largest surface area, and everything else works in one room. Losing
   it costs `Withdraw`, `GoTo`, and real `determineObservers`. Keep the schema field so it
   can land later without another frozen-types negotiation.
6. **Planted evidence / the frame-Calum path (U8)** — the mystery still works without it,
   just honestly.

**Do not cut:** U1 (decay), U1b (the day budget), U2 (conversations), U3 (responding).
They are four of the loudest complaints in the list; U2 is what four other items are built
on, and without U1b nothing the player does costs anything.

---

## 9. As built — where this plan was wrong

Nine phases landed. Everything in §4 is implemented. What follows is what the plan got
wrong, found either by a failing test or by playing it.

### Numbers that moved

| Plan said | Built | Why |
|---|---|---|
| Tone thresholds 110 / 40 | **165 / 60** | Warmth runs 0–300; a nodding acquaintance sits near 145 and a real friendship near 200. At 110 the acquaintance bucketed `warm` and got dialogue written for someone they barely know. |
| NPC activation 0.5 | **0.7** | 0.5 was tuned when anyone could act on anyone. The one-conversation rule takes *both* partners out of circulation, so a coin flip on top of that produced 10 empty ticks in 60 — and an empty tick now costs the player a scarce slot. At 0.7: zero. |
| Reckoning at 35 moves | unchanged | Held up in play. Alice reaches 0.65 confidence on her own by turn ~12 and stalls one piece short, which is the intended shape. |

### Five things the plan didn't anticipate

1. **Arguments couldn't escalate at all.** `Insult`'s warm response was `Withdraw`, which
   relocates the responder and closes the thread — so an argument with anyone who didn't
   already hate you ended on its first beat and `Fight` was permanently unreachable.
   Someone who likes you pushes back; walking out is what `breaking` escalates *to*, not
   what it opens with. Now `Confront`.
2. **The one-conversation rule only held from one end.** It was enforced on the actor and
   not the target, so an idle bystander could open a conversation with someone already
   mid-thread — closing that thread and resetting its heat. An argument could not survive
   a third party saying hello.
3. **Conversations never ended.** Two NPCs who keep answering each other stayed paired
   forever, and because a character may only hold one conversation that took them both
   out of circulation permanently — Alice and Dana locked at turn 4 and neither approached
   the player again. Added `MAX_TURNS = 6`.
4. **A move at an absent target silently ate a turn.** It was dropped inside `resolveMove`:
   slot spent, no line, no event, indistinguishable on screen from a quiet turn. Harmless
   before; unacceptable once turns are finite. Impossible moves are now refused with a
   reason and cost nothing — `blockedBecause` / `refuse`.
5. **Statuses flapped.** Baselines drift only overnight, so *any* same-day gain reverts by
   construction: a favour pushed trust 52→58 (`friend`), decay pulled it back, and the feed
   announced Robin befriending and un-befriending Dana within three turns. `statusFor` now
   takes hysteresis (`STATUS_MARGIN`), measured against the last status the ledger recorded.

### Two things that came out better than planned

- **`overheard` finally means something.** `MemoryTier` has carried it since the first
  schema and nothing ever set it, because no mechanism existed by which a bystander
  learned anything. Evidence changing hands in a public room is now heard by the room —
  which makes watching and waiting a real, slow way to find things out, and is what the
  observer protagonist is supposed to be doing.
- **The frame path emerged without the player.** Bob's own `SpreadRumor` tendency plants
  `calum-seen-with-rival`, and a bystander overhears it. In a recorded run the player's
  belief flipped from Bob to Calum on turn 11 having taken no action at all. The mystery
  misleads people on its own.

### Verified in play

A live run (real Gemini, `npm start`) walked: evidence transfer on turn 1 → Alice's
suspicion climbing 0.35 → 0.65 as Dana's evidence reached her → an insult chain heating
18 → 61 → 100 → `Fight` → Alice walking out → the day rolling at slot 24 with a
"while you slept" digest → Alice, the next morning, asking Dana what Robin had been asking
*her* about the leak. Dialogue tracked the heat at every step.

### Known rough edges

- The realization cache can serve the same opening line to two separate conversations that
  genuinely match on every key component. Correct per the cache contract, and it reads as
  repetition.
- `rival` and `wary` still trade places occasionally under decay. Hysteresis cut it to a
  handful per 40 turns; a test caps it at 3 per pair per 20.
- `determineObservers` implements co-location; the `private` flag is plumbed and checked
  but both branches currently agree, pending an "overheard from the next room" tier.

---

## 10. Playtest pass — as found, as fixed, still open

§9 was written from a live run and a passing suite. Both were true and neither was
enough: the whole of §9 held while the game read as broken on screen. What found the
rest was driving *complete playthroughs headlessly* — five play styles across eight
seeds, day 3 to the ending, asserting on what a scene reads like rather than on what a
function returns. Every defect below survived `typecheck`, `lint` and 93 green tests.

The harness is now `lib/playtest.test.ts` (24 tests). Add to it, not to `update1.test.ts`,
when a defect is something you *watched happen* rather than something you reasoned about.

### What §9 got wrong about itself

Both entries under "Two things that came out better than planned" were the same bug
wearing a hat.

`overhear` was described as making watching-and-waiting a real way to find things out.
It had no gate at all, so a room was a public address system: one question put to Alice
on the opening turn handed her keystone secret to Bob, Calum and Dana simultaneously,
and by the endgame all five characters held all six pieces of evidence. "Three true
pieces convict Bob, two lies frame Calum, and Alice cannot tell the difference" — the
premise in §6 — cannot survive everyone holding everything. The frame path "emerging
without the player" was the same flood seen from the other end.

The lesson is narrower than it looks: a mechanism that fires *unconditionally* looks
like emergence in a single recorded run and like entropy over eight. One run is an
anecdote.

### Fixed

| Found | Cause |
|---|---|
| Bob proposed an alliance to Calum 119 times across 8 runs; Calum never once answered | `respondTo` ran for the player's move only, and `legalTendencies` confines an engaged character to tendencies aimed at their partner — empty for most pairs |
| A thread's beats and heat vanished mid-tick | Conversation ids collided within a turn: the same pair can open a second thread in one tick and `openOrJoin` overwrote the first record in place |
| 194 cases of a speaker saying the identical sentence three ticks running | A tendency table plus a weighted roll is a stationary process with no view of what the actor just did |
| `MAX_TURNS` bought nothing | The same two reopened on the next tick; it only ever reset heat and the beat list. Now gated by `REOPEN_COOLDOWN` |
| Alice answered thirty consecutive questions with "There's something you should know" | The line is written in `resolveMove` before `resolveTopical` discovers there is nothing left to hand over |
| Bob told Robin "Robin has been talking"; Dana told Alice "leave Alice out of this" | `{target}` (addressed) and `{subject}` (talked about) conflated. `ai/fallbacks.ts` drew the distinction but never used its own `{subject}` placeholder — all nine three-party lines hardcoded "them" |
| An NPC `Fight` teleported the player out of the room; the feed said "Robin walks out." | `loser = move.target` was unconditional, directly under a comment asserting the player is never walked out |
| `Withdraw` spent a move and changed nothing for the player | Correctly skipped the relocation, incorrectly skipped the disengagement too |
| "Calum learns: Calum was seen talking with the rival that week" | Neither `shareableEvidence` nor `overhear` excluded the person the evidence points at; it also fed `suspicionOf` a self-pointing weight |
| "Spread a rumor to Alice about Bob" planted the lie about Calum | Both interpreters wrote `args.subject`; nothing read it |
| The reckoning phase was announced and resolved in the same tick | `phaseFor` and `advancePhase` tested the identical condition, on a day 5 that holds no moves. Now opens on the evening of day 4 |
| "Bob has grown wary of Dana" printed when Bob went estranged → wary | Status alone cannot say which way a crossing went. Same for the memory written with it, which read as a betrayal even when the pair had improved |
| "just ask, don't fight" parsed as `Fight` | Keyword priority was table order, not the order the words appear in the player's input |

Measured over the same sweep — one-sided conversations 121 → 0, consecutive repeated
lines 194 → 0, unrequested player relocations 22 → 0, evidence reaching its own
subject 14 → 0.

### Still open — two design calls, not defects

**Doing nothing reaches the true ending on 5 of 8 seeds.** This is the autonomous world
working as §2.2 describes it: Alice's `AskAbout` tendency is what makes the mystery move
without the player. It is *intended* that the cast can get there alone — but "alone,
most of the time" is a different claim, and it costs the player's presence some of its
meaning. The fix, if it is one, is retuning Alice's tendency weights or raising what
`RECKONING_CONFIDENCE` demands, not another engine change. Left alone deliberately:
tuning it silently while fixing bugs would hide a design decision inside a bug fix.

Against that: a player who gathers evidence and reports it to Alice now reaches
`exposed` on 8/8 seeds, and a player who frames Calum reaches `wrong-person` on 8/8.
Agency exists in both directions; the question is only how much the floor should be.

**Badgering one person now ends worse than it used to.** Asking Alice the same question
every turn ends `unresolved-suspicion` on 8/8 seeds, against 0.65 confidence before.
Two causes, both deliberate: she refuses once she has nothing left to give rather than
faking a reveal, and a conversation genuinely occupies both people, so monopolising her
starves her own investigation. The outcome is worse and the *feedback* is better — she
now visibly says no, where before the player got a revelation line and no way to learn
that nothing had happened. Flagged rather than tuned, for the same reason as above.

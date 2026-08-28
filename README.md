# SocialSim

A terminal-styled social simulation. Five characters share four rooms, directed
pairwise relationships (trust / affection / respect / fear / **anger**), private
memories, and beliefs they hold on evidence that may be false. Each turn, **every**
character who wants to act gets to act — not just the one you're talking to. While
you're confronting Alice in the courtyard, Bob can be proposing an alliance to Calum
in the hall, and you'll find out about it later through the event feed, or by
overhearing it, or not at all.

A day runs **08:00 to 20:00 and holds 24 moves**. Walking somewhere costs one.
Waiting costs one. That is what makes the rest of it matter.

The core rule: **the LLM never mutates world state and never picks a character's
move.** A deterministic rules engine decides what happens; the model only writes
the words. That keeps runs reproducible and keeps the game playable with the
network unplugged.

Full design doc and track ownership: [`socialsim-work-plan.md`](./socialsim-work-plan.md).
Committing to this repo: [`CONTRIBUTING.md`](./CONTRIBUTING.md) — **read it before your
first commit.**

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

No API key is needed. The game currently runs entirely on the offline mock engine —
stub dialogue, real relationship math — so it plays fine with the server off.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` across app + sim |
| `npm run lint` | ESLint across `app`, `components`, `lib`, `sim` |
| `npm test` | Vitest across `ai`, `lib`, `sim` (`test:watch` to keep it running) |

`lint`, `typecheck` and `test` must all pass before a merge — see
[`CONTRIBUTING.md`](./CONTRIBUTING.md). `npm run build` runs ESLint too and fails on
any lint error.

---

## Playing

The screen is four panels: scene view, action menu, character inspector, event feed.

- **`Tab`** cycles the four move rows — *Talk · Press · Warm · Move*.
- **Number keys `1`–`9`** pick a move from the **open row**.
- **`Enter`** commits the selected move against the selected target.
- **`who's who`** in the header opens the relationship map: every directed pair,
  its current status, and what it was before.
- When someone asks you for help, a **response row** pins above the move grid —
  *Agree · Refuse · Deflect*, with a countdown. Letting it lapse is a choice and
  it costs.
- **Custom action box** takes free text ("confront bob", "give alice a gift") and
  shows you *"I understood that as: …"* before it runs, so you learn what parses.
- **Header buttons** — `save` / `load` (localStorage), `export` / `import` (JSON
  file), `reset`, and a `server: on/off` toggle that routes turns through the API
  routes instead of running the engine in the browser. Both paths produce the same
  result today; the client falls back to local if the request fails.

Dialogue streams a character at a time and trust bars tick rather than snap.
`prefers-reduced-motion` skips both.

### The starting scenario

**Day 3, 14:30, the Courtyard. Eleven moves left today, and all of tomorrow.**

Alice's plan got out. She told exactly one person — Bob — and four days later a
rival was acting on it. She does **not** know he did it; she is deciding whether she
can still trust him, and that is the game. Bob knows. He is the only one who does.

Between them, Dana and Calum hold two more pieces of it: Dana caught Bob changing
his story, and Calum was told the plan early without ever realising that mattered.
**Three true pieces convict Bob. Two lies frame Calum** — and Alice cannot tell the
difference, because nobody can tell a planted fact from a real one.

At the end of Day 4 she acts on whatever she believes. She may be right, she may be
wrong, or she may never find out and stop trusting any of you.

Cast: **You (Robin), Alice, Bob, Calum, Dana** across the **Courtyard, West Wing
Hall, Library** (private) and **Kitchen** — all in `fixtures/world.json`.

---

## Layout

```
app/                 Next.js App Router — page, layout, globals.css,
                     and POST /api/turn + POST /api/interpret
components/          Terminal UI: SceneView, ActionMenu, CharacterInspector,
                     EventFeed, TrustBar, CustomActionInput, RelationshipMap
lib/                 Frontend engine + state
  mockEngine.ts        the tick that actually runs the game today
  clock.ts             days, slots, the 24-move budget
  conversations.ts     threads, beats, heat, who-is-talking-to-whom
  relationships.ts     status derivation, decay, baselines, the ledger
  topics.ts            topics, evidence, suspicion, the scenario arc
  reducer.ts           useReducer store, optimistic lines, reveal animation queue
  moveMeta.ts          move catalog, effect tables, heat table, stub dialogue
  interpret.ts         keyword-based free-text → move
  save.ts              localStorage + JSON export/import (v2)
sim/src/             Framework-free simulation package (no React, no network)
  types.ts             the shared contract — WorldState, Character, Move,
                       Conversation, Topic, Location, PendingUtterance…
  tick.ts              multi-actor tick shell
  moves/               move id catalog, legal-move queries
  world/               event creation, observer/perception rules
  cognition/           state-patch schema, validation, application
  rng/seededRng.ts     seeded RNG (no Math.random anywhere)
fixtures/world.json  the shared 5-character starting state
```

`@/*` maps to the repo root and `@sim/*` to `sim/src/*` — see `tsconfig.json`.

---

## Where things stand

**Working end to end.** Four panels, streaming dialogue, animated relationship
deltas, the event feed, save/load/export/import, keyboard navigation, free-text
interpretation, and — since update 1 — conversations, topics, locations, the day
budget, and an arc that reaches an ending.

**The engine you're actually playing is `lib/mockEngine.ts`**, not `sim/`. It
resolves the player's move plus up to two autonomous NPC moves per tick, picks them
from per-character weighted tendency tables filtered by who is co-located and who is
already talking to someone, applies heat-scaled relationship effects, decays every
axis toward its baseline, writes memories to observers only, and routes anything the
player didn't witness into the event feed. Move ordering and NPC selection run off a
seeded RNG, so a run reproduces.

**AI integration is live.** Dialogue is realized per witnessed move through Gemini
(`ai/`), with a bucketed fallback table, a realization cache, a hallucination check,
and one retry — so it plays identically with the network unplugged. Prompts carry
the speaker's own beliefs, retrieved memories, the conversation's last beats, and a
topic *label*; evidence claims never reach a prompt, and a test asserts it.

**`sim/` is still partly scaffolding.** `types.ts` is the real shared contract and
`determineObservers` and the cognition-patch layer now do real work. `isLegalMove`
and `getLegalMoves` remain permissive stubs, and there is no volition scoring — the
tendency tables in `lib/mockEngine.ts` stand in for it. That port is the next thing
on the critical path.

See [`plan.md`](./plan.md) for what update 1 changed and why — §9 for where the plan
turned out to be wrong, and §10 for the playtest pass that followed it, including two
balance questions left open on purpose.

**Defects are found by playing, not by unit-testing the pieces.** The whole of §9 was
true while the game read as broken on screen. `lib/playtest.test.ts` drives complete
playthroughs — five play styles across eight seeds, day 3 to the ending — and asserts
on what a scene *reads like*: that a conversation has two people in it, that nobody
repeats themselves, that the player is never walked out of their own scene. Put a
regression there when it is something you watched happen.

---

## Environment

Copy `env.local.example` to `.env.local`. Nothing is required to run — with no key
the game falls back to the bucketed lines in `ai/fallbacks.ts` and plays fine.

```
MOCK_LLM=1        # 1 = instant stub text, no API calls. Unset it to use a real key.
GEMINI_API_KEY=   # server-side only — never prefix with NEXT_PUBLIC_
```

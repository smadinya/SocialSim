# SocialSim

A terminal-styled social simulation. Five characters share a world with directed,
pairwise relationships (trust / affection / respect / fear), private memories, and
beliefs. Each turn, **every** character who wants to act gets to act — not just the
one you're talking to. While you're confronting Alice in the courtyard, Bob can be
proposing an alliance to Calum somewhere you can't see, and you'll find out about
it later through the event feed.

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

`lint` and `typecheck` must both pass before a merge — see
[`CONTRIBUTING.md`](./CONTRIBUTING.md). `npm run build` runs ESLint too and fails on
any lint error.

---

## Playing

The screen is four panels: scene view, action menu, character inspector, event feed.

- **Number keys `1`–`9`** pick a move from the menu.
- **`Enter`** commits the selected move against the selected target.
- **Custom action box** takes free text ("confront bob", "give alice a gift") and
  shows you *"I understood that as: …"* before it runs, so you learn what parses.
- **Header buttons** — `save` / `load` (localStorage), `export` / `import` (JSON
  file), `reset`, and a `server: on/off` toggle that routes turns through the API
  routes instead of running the engine in the browser. Both paths produce the same
  result today; the client falls back to local if the request fails.

Dialogue streams a character at a time and trust bars tick rather than snap.
`prefers-reduced-motion` skips both.

### The starting scenario

Day 3, 14:25, Courtyard — West Wing. Bob leaked a plan Alice trusted him with and
denied it to her face. Alice's trust in Bob sits at 18. Dana has promised to help
Alice find out who really talked. You (`you`) arrived recently and are trying to
work out what happened — while Bob independently pursues Calum, which can
complicate the picture without you touching it.

Cast: **You, Alice, Bob, Calum, Dana** — defined in `fixtures/world.json`.

---

## Layout

```
app/                 Next.js App Router — page, layout, globals.css,
                     and POST /api/turn + POST /api/interpret
components/          Terminal UI: SceneView, ActionMenu, CharacterInspector,
                     EventFeed, TrustBar, CustomActionInput
lib/                 Frontend engine + state
  mockEngine.ts        the tick that actually runs the game today
  reducer.ts           useReducer store, optimistic lines, reveal animation queue
  moveMeta.ts          move labels, effect tables, stub dialogue templates
  interpret.ts         keyword-based free-text → move
  save.ts              localStorage + JSON export/import
sim/src/             Framework-free simulation package (no React, no network)
  types.ts             the frozen shared contract — WorldState, Character, Move…
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

**Working end to end.** The terminal UI, the full four-panel layout, streaming
dialogue, animated relationship deltas, the event feed, save/load/export/import,
keyboard navigation, and free-text action interpretation all run today against the
5-character fixture.

**The engine you're actually playing is `lib/mockEngine.ts`**, not `sim/`. It does
the real work: resolves the player's move plus up to two autonomous NPC moves per
tick, picks those moves from per-character weighted tendency tables, applies
clamped relationship effects, writes memories to observers only, and routes
anything the player didn't witness into the event feed instead of the scene.
Move ordering and NPC selection run off a seeded RNG.

**`sim/` is scaffolded but not load-bearing yet.** `types.ts`, the tick shell, the
move catalog, the seeded RNG, and the cognition-patch schema are in place.
`isLegalMove`, `getLegalMoves`, `determineObservers`, `validateCognitionPatch`, and
`applyCognitionPatch` are still TODO stubs, and there's no volition/motivation
scoring yet. `/api/turn` calls `simTick` and discards the result before falling
through to the mock engine — the seam is wired, the engine behind it isn't.
`sim/package.json` declares vitest but no tests exist.

**AI integration hasn't started.** No `@google/genai` dependency, no prompts.
Dialogue comes from templates in `lib/moveMeta.ts` and free text is matched against
a keyword table in `lib/interpret.ts`.

Next on the critical path is replacing the mock engine's move selection with real
volition scoring in `sim/`, then swapping stub dialogue for Gemini realization.

---

## Environment

Copy `env.local.example` to `.env.local`. Nothing is required to run today.

```
MOCK_LLM=1        # 1 = instant stub text, no API calls. Leave at 1 until AI lands.
GEMINI_API_KEY=   # server-side only — never prefix with NEXT_PUBLIC_
```

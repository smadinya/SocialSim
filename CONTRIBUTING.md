# Contributing to SocialSim

Read this before your first commit.

---

## Workflow

```bash
git clone git@github.com:smadinya/SocialSim.git
cd SocialSim
npm install

git checkout -b track-c-event-feed    # your track + what you're doing
# ...make your changes...

npm run lint && npm run typecheck     # must both pass — see below
git add -A
git commit -m "Event feed panel renders off-screen moves"
git push -u origin track-c-event-feed
```

Then open a PR on GitHub.

**Rules:**

- **Branch per track**, named `track-<letter>-<what>`. Never commit straight to `main`.
- **One reviewer from a different track.** Cross-track review is how we find out
  the shared contract moved before it breaks someone else's work.
- **Nobody edits another track's directory.** Need something changed over there?
  Ask the owner. See `socialsim-work-plan.md` for who owns what.
- **`sim/src/types.ts` is frozen.** It's the seam all four tracks import. Changing
  it needs a heads-up to everyone, not just your reviewer.

---

## Run the linter before every merge

Both of these must pass before you open a PR, and again before you merge if you've
pushed anything since:

```bash
npm run lint        # eslint via next lint — app, components, lib, sim
npm run typecheck   # tsc --noEmit
```

`npm run build` also runs ESLint and **fails the build on any lint error**, so a
lint failure isn't cosmetic — it stops the app from being built at all. Catching it
locally takes seconds; catching it in a merge costs everyone a round trip.

Config lives in `.eslintrc.json` (`next/core-web-vitals`) and the lint directory
list is in `next.config.mjs`. If a rule is genuinely wrong for our case, raise it in
review and we change it for everyone — don't sprinkle `eslint-disable` comments.

---

## Never commit secrets or env files

`.env`, `.env.local`, and anything matching `.env*.local` are gitignored. Keep it
that way. **Do not force-add them**, and don't paste a key into a source file as a
"temporary" shortcut — once a key is in git history, rotating it is the only real
fix, and that means everyone's local setup breaks until they re-pull.

To add a new config value:

1. Add the key with an **empty value** to `env.local.example` and commit that.
2. Put the real value in your own `.env.local`, which stays on your machine.

### API keys are server-side only

**Never prefix a secret with `NEXT_PUBLIC_`.** Next.js inlines every
`NEXT_PUBLIC_*` variable directly into the client bundle at build time, which means
it ships to every visitor's browser and anyone can read it in devtools. It is not
hidden, obfuscated, or protected by being in a `.env` file.

`GEMINI_API_KEY` must only ever be read server-side — inside `app/api/*/route.ts`
handlers or Track B's `packages/ai/` module. If the frontend needs something the
model produces, it goes through one of our API routes; the key never crosses to the
client.

```ts
// app/api/turn/route.ts — fine, runs on the server
const key = process.env.GEMINI_API_KEY;

// components/Terminal.tsx — never do this
const key = process.env.NEXT_PUBLIC_GEMINI_API_KEY;  // shipped to every browser
```

If you think you've committed a key: say so immediately in the group chat rather
than quietly deleting it in a follow-up commit. It's still in the history, and it
needs rotating.

---

## Before you open a PR

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run dev` still loads the game at `/`
- [ ] No `.env*` files, API keys, or `_MACOSX/` in `git status`
- [ ] You only touched your own track's directories
- [ ] If you changed `sim/src/types.ts`, you told the other three

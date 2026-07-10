# CLAUDE.md — Arcade project guide

Instructions and context for Claude Code sessions working in this repo. Read this
before making changes.

## ⚠️ Standing instructions

1. **Update this file before every commit.** Before any `git commit`, review CLAUDE.md
   and update the "Current state" and "Session history" sections (and anything else
   that changed — commands, architecture, decisions). The update goes into the same
   commit as the change it describes.
2. **No Claude attribution in commits.** Do NOT add `Co-Authored-By: Claude` trailers
   or any AI attribution to commit messages — the owner wants sole authorship
   (explicitly requested).
3. **Pushing:** commits go to `origin main` → https://github.com/Viv-411/arcade.
   Ask before pushing unless the user's request already says to push.
4. **Verify before committing:** `npm run typecheck && npm test` (test builds and
   plays full games of both titles over real sockets). Both games must pass — Mind
   Meld must never regress when touching shared infra. CI runs the same on GitHub.
5. Games must remain **testable in two browser tabs** on one machine — player
   identity is per-tab (`sessionStorage`), never move it to `localStorage`.
6. When adding features, keep the game-module seams clean (see Architecture): shared
   behavior goes in `core/`, game behavior in the game's own module. Don't fork the
   shared lobby/matchmaking/reconnection logic per game.

## What this project is

A real-time multiplayer web arcade for party games, playable in the browser. Three
games are live: **Mind Meld** 🧠 (2–4 players converge on the same word),
**Speed Trivia** ⚡ (2–10 players race through multiple-choice questions), and
**Bid Battle** 💰 (team category-naming auction, exactly 1v1 or 2v2). The
README.md holds the full player-facing rules; this file holds contributor context.

## Architecture (the important mental model)

**One deployable, stateful Node process.** Express serves the built React client and
hosts Socket.IO on the same port. All game state is **in memory** — this cannot run
serverless (Render/Railway/Fly, NOT Vercel). Deploy: build `npm install && npm run
build`, start `npm start`, `PORT` env respected.

```
/shared                     Types + Socket.IO event contracts per game, imported by
                            BOTH client and server (single source of truth).
                            types.ts/events.ts = Mind Meld, trivia.ts = Speed Trivia,
                            normalize.ts = word normalization (used for BOTH win
                            detection and the no-repeat rule — must stay identical).
/server/src/core/           roomManager.ts — game-agnostic BaseRoomManager: room codes
                            (4 letters, no I/O), join, Quick Play, ready toggles, host
                            start validation, public auto-start (20s at 2+, instant at
                            max), rejoin/reconnect, lobby disconnect grace (30s),
                            host reassignment, empty-room GC (5 min), playAgain.
                            Subclasses implement abstract hooks for game state, plus
                            optional overrides: roomMin/MaxPlayers(room) for per-room
                            capacity, quickPlayEligible/quickPlayCreateSettings for
                            mode-filtered matchmaking pools, canAutoStartPartial,
                            canStartExtra (extra host-start validation), and
                            onPlayerJoined/onRejoin (e.g. team socket rooms).
/server/src/store.ts        RoomStore interface (in-memory Map impl) — ALL room state
                            access goes through it so Redis could replace it later.
/server/src/stats.ts        SQLite win stats via better-sqlite3 (data/stats.db,
                            gitignored); degrades to a no-op if the module fails.
/server/src/mindmeld/       manager.ts — Mind Meld state machine (rounds, lock-in,
                            no-repeat, AFK removal after 2 missed rounds).
/server/src/trivia/         manager.ts — vote → fetch → question loop → finish.
                            questionSource.ts — QuestionSource adapter interface +
                            OpenTdbSource (see OpenTDB notes below).
/server/src/bidbattle/      manager.ts — team auction state machine (lobby →
                            category → bidding → delivery → review → repeat/finish).
                            Teams live on the game's own player type; per-team
                            visibility uses socket.io rooms `${code}#A`/`#B`.
                            categories.ts — curated category deck.
/client/src/core/           useRoomCore.ts — client half of shared infra (per-tab
                            session, silent rejoin on connect, lobby actions, toasts,
                            patchRoom). hooks.ts — countdown/progress hooks.
/client/src/components/     GameEntry.tsx, GameLobby.tsx (shared screens), Toasts.tsx.
/client/src/mindmeld/       useMindMeld.ts + GameBoard/EndScreen.
/client/src/trivia/         useTrivia.ts + VoteScreen/QuestionScreen/TriviaFinal.
/client/src/pages/          Home (game grid), MindMeldPage, TriviaPage — each game
                            page shows its own "How to play" on the entry screen.
```

**Adding a game:** new namespace manager on the server (subclass `BaseRoomManager`,
register in `server/src/index.ts`), new shared types/events file, new client route +
page + `useRoomCore`-based hook, card on Home. Each game gets its own Socket.IO
namespace (`/mindmeld`, `/trivia`) and client route of the same name.

**Server is authoritative** for all game outcomes (words, correctness, timing,
scoring). Clients render optimistically but never decide results.

### Key per-game rules that differ (do not cross-contaminate)

- Mind Meld: 2–4 players, AFK removal after `afkMissLimit` (2) missed rounds.
- Speed Trivia: 2–10 players (`TRIVIA_MIN/MAX_PLAYERS` in shared/trivia.ts),
  **NO AFK removal by design** — a missed answer scores 0 and play continues;
  disconnected players resume with their score; the game ends early only when <2
  players remain connected (checked at question resolve, so refreshes can't kill a
  game) or <2 remain in the room.
- Trivia scoring: correct = `round(1000 × factor)`, factor decays linearly 1.0 → 0.5
  across the question time; wrong/no answer = 0. Ties share the win.
- Bid Battle: EXACTLY 2 (1v1) or 4 (2v2) players in fixed teams; per-mode quick
  play pools; no partial-lobby countdown. **Leaving mid-match forfeits for the
  leaver's team; disconnecting does NOT** (timers keep the match moving — a silent
  bid turn counts as declining). Bid timeout = decline-to-raise, except an unopened
  auction: opener timeout passes the opening once, and a second timeout redraws the
  category with no point. Custom ballot categories need unanimous (1v1) / 3 (2v2)
  votes or the round falls back to a random deck draw. Review is honor-system:
  unflagged counts, un-defended flags drop, un-finalized defenses count. During
  delivery BOTH teams see every accepted item live (owner request 2026-07-05;
  originally count-only for opponents). The `${code}#A`/`#B` team socket rooms
  remain for future team-scoped messaging.

### OpenTDB constraints (server/src/trivia/questionSource.ts)

- Rate limit ~1 request / 5s per IP → every call goes through a serialized throttle;
  each game does ONE batched question fetch (after the category vote); category list
  + session token are pre-warmed at startup (`warmUp()`).
- Session token avoids repeat questions; response_code 3/4 → reset/re-request + retry.
- Questions requested with `encode=base64`, decoded server-side; category names get a
  small HTML-entity decoder.
- response_code 1 fallback chain: same category with difficulty "any" → top up from
  General Knowledge (id 9) → built-in question set (so games start even offline).
- Never send `correctIndex` to clients before the reveal.

## Accounts (Supabase) — foundation only

Optional accounts exist (email/password + Google OAuth) but **nothing is gated**:
anonymous play is a hard requirement and must never regress. Key facts:

- Client: `client/src/auth/` — `supabaseClient.ts` exports a NULL client when
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are unset (everything must keep
  working in that state); `AuthContext.tsx` provides `useAuth()` incl. a
  `requireAuth(action)` gate for FUTURE gated actions (none exist yet — don't
  gate existing features). Corner `AuthButton` + `AuthModal` are the only auth UI.
- Server: `server/src/auth.ts` verifies Supabase JWTs via the project's public
  JWKS endpoint (new asymmetric signing keys — the owner's project issues ES256
  tokens) with an HS256 `SUPABASE_JWT_SECRET` fallback for legacy projects;
  attaches `req.userId` on `/api/*` and `socket.data.userId` via per-namespace
  handshake middleware — always optional, never rejects.
  `server/src/supabaseAdmin.ts` is the only sanctioned service-role entry point
  (returns null when unconfigured). Server loads root `.env` via
  `process.loadEnvFile` (Node 21+). Uses `jose`, not `jsonwebtoken`.
- Schema: `supabase/migrations/` — profiles (signup trigger creates rows),
  trivia_sets, questions; RLS on everything (see README for policies + manual
  test checklist). `shared/database.types.ts` is HAND-WRITTEN to match; after
  schema changes run `npm run db:types` against a running local stack.
- Env vars documented in `.env.example` + README; the owner supplies all keys
  from the Supabase dashboard. Google OAuth requires the manual checklist in the
  README (Google Cloud + Supabase dashboard steps) — login failing before that is
  expected. Trivia-set posting UI and solo play are LATER phases; only the schema
  exists now.

## Commands

```bash
npm run dev          # tsx watch server (:3001) + Vite (:5173, proxies /socket.io)
npm run typecheck    # tsc both sides, no emit
npm run build        # vite build (client/dist) + tsc server (dist/)
npm start            # node dist/server/src/index.js — serves client + sockets on :3001
```

Run npm scripts **from the repo root** (the server resolves `client/dist` and
`data/` from cwd). Node ≥18 (developed on Node 24, macOS).

## Testing

`npm test` — builds, then `tests/run.mjs` boots the built server on port 4123 with
an isolated temp stats DB, waits for /healthz, and runs each `tests/*.test.mjs` as a
child process (real `socket.io-client` sockets playing full games). `npm run
test:only` skips the rebuild. CI (`.github/workflows/ci.yml`) runs typecheck + build
+ tests on every push/PR.

Coverage: full Mind Meld win flow (normalization, no-repeat rejection at lock-in,
unlock/re-lock, playAgain reset), full trivia flow (host-only difficulty, vote +
early resolve, decoded questions, hidden correct answer, duplicate/late answer
rejection, scoring bounds 500–1000, sorted scoreboard, tie winners, playAgain),
a 10-player trivia game (11th join rejected; Mind Meld still capped at 4), and
Bid Battle 1v1 + 2v2 (ballot with custom approval, opener-timeout pass +
double-timeout redraw, raise/challenge validation, dedup, team-only item
visibility, full flag/defend/accept/uphold review math, forfeit on leave,
per-mode quick play pools).

Gotchas encoded in `tests/helpers.mjs` — keep them in mind when writing new tests:

- Register `waitFor(event)` listeners BEFORE triggering the action that emits them —
  gameOver fires synchronously after the final reveal (caused a false failure once).
- Speed games up via createRoom settings (clamped mins: 3 questions, 5s question
  time, 1s reveal, 5s vote); trivia falls back to built-in questions offline or when
  OpenTDB rate-limits, so tests stay deterministic in CI.
- A stale server process on the test port once caused a phantom "no ack" failure —
  the orchestrator surfaces the EADDRINUSE crash in its server-log output.
- Manual UI check: two tabs on http://localhost:5173/<game> (per-tab identity).

## Environment / ops notes

- Env vars: `PORT` (default 3001), `STATS_DB` (default `data/stats.db`).
- Long-running dev servers started from a Claude session get killed by session task
  cleanup — start detached: `nohup npm run dev > /tmp/dev.log 2>&1 & disown`.
  Stop everything: `lsof -nP -iTCP:5173,3001,3199 -sTCP:LISTEN -t | xargs kill`.
- The trivia smoke test hits the real OpenTDB API; first fetch after server start can
  queue ~10s behind the startup warm-up (rate-limit throttle). Offline, the built-in
  question fallback keeps games working.
- Browser automation: the Claude-in-Chrome extension has not been connectable in this
  environment; open tabs with macOS `open <url>` instead.

## Current state (update before every commit)

- All three games fully working; end-to-end tests committed in `tests/`
  (`npm test`), GitHub Actions CI on push/PR, and a `render.yaml` blueprint for
  one-click Render free-tier deploy. Not yet deployed — the owner needs to click
  through Render's New → Blueprint flow (account actions are the owner's to do).
- Supabase project EXISTS, is connected, and the schema is APPLIED: local
  `.env` (gitignored) holds the owner's project URL + publishable/secret keys
  (new sb_* format, ES256 tokens). Migrations pushed to the hosted DB via the
  IPv4 pooler (`aws-1-us-west-2.pooler.supabase.com` — the direct db host is
  IPv6-only from this network; the DB password is NOT stored in the repo, ask
  the owner if needed). Live-verified end to end: admin API, password sign-in,
  server-side JWKS verification of /api/me, signup trigger creating profiles,
  and the full RLS checklist (private-set isolation, anon-key restrictions,
  public/removed visibility, profile write protection). STILL PENDING (owner,
  dashboard-only): (1) Site URL / redirect allow-list → http://localhost:5173
  + prod origin in Auth → URL Configuration (needed for email-confirm links +
  Google), (2) Google OAuth checklist, (3) env vars on Render when deploying.
- git: single `main` branch, remote `origin` = https://github.com/Viv-411/arcade.
- Owner: Vivek (github Viv-411). Games tested locally in two browser tabs.

## Session history

1. **Initial build (commit `fed24fb`)** — monorepo scaffolded from scratch: shared
   types/events, Express+Socket.IO server, React+Vite client, Mind Meld complete
   (rounds, no-repeat, AFK, reconnection, quick play, SQLite stats), README with
   rules + deploy notes. Decision: sessionStorage (not localStorage) for player
   identity so two tabs = two players.
2. **Pushed to GitHub** — amended the initial commit to drop the Claude co-author
   trailer (owner requirement, still in force), pushed to Viv-411/arcade.
3. **Speed Trivia (commit `3bf7b72`)** — extracted the game-agnostic multiplayer core
   out of Mind Meld into `server/src/core/roomManager.ts` + `client/src/core/`
   + shared GameEntry/GameLobby (Mind Meld behavior preserved, regression-tested),
   then built trivia on top: category vote, OpenTDB adapter, speed scoring, no-AFK
   rule. Also moved "How to play" from Home onto each game's entry screen.
4. **10-player trivia (commit `0207b30`)** — per-game player limits (base manager
   overridables + GameLobby props); trivia 2–10, Mind Meld unchanged 2–4; verified
   with a 10-client game.
5. **CLAUDE.md (commit `5eaf092`)** — added with the update-before-commit rule.
6. **Durability & deploy readiness (commit `1fd2fc1`)** — moved the scratchpad
   smoke tests into `tests/` with an orchestrator (`npm test` / `npm run
   test:only`), added GitHub Actions CI (typecheck + build + full test suite), and
   a `render.yaml` blueprint for one-click free-tier deploys.
7. **Bid Battle (commit `5c2f2a9`)** — third game: team category-naming auction
   (1v1/2v2). Added the optional capacity/matchmaking/team hooks to the shared
   core (defaults preserve the other games; verified by the existing suite). The
   listener-ordering race bit AGAIN here — the pre-existing trivia tests
   registered questionReveal listeners after answering and flaked once 4+ extra
   clients ran in the same process; fixed by registering before acting (the
   helpers.mjs gotcha).
8. **Delivery spectating** — owner asked for the waiting team to see the named
   list live during delivery (same view as the namers), replacing the original
   count-only opponent view. itemAccepted now broadcasts room-wide; client state
   renamed myItems → liveItems. (Owner separately committed the server half as
   `aa0ec81 "Bidding Wars v1"` mid-task; the rest landed in `c5d7f3d`.) Game
   descriptions then made category-generic (not "car brands") per owner request.
9. **Supabase accounts foundation** — optional login (email/password + Google),
   JWT middleware + optional socket handshake auth, profiles/trivia_sets/questions
   schema with RLS + signup trigger, local-dev config + db:* scripts, .env.example,
   big README section (env vars, RLS checklist, manual Supabase/Google steps).
   NO gated features, NO posting UI, NO solo play yet. All game tests pass with
   zero Supabase config (anonymous path verified).

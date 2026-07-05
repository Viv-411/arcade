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
4. **Verify before committing:** run `npm run typecheck && npm run build`, then run
   the socket smoke tests (see "Testing") for any game-logic change. Both games must
   pass — Mind Meld must never regress when touching shared infra.
5. Games must remain **testable in two browser tabs** on one machine — player
   identity is per-tab (`sessionStorage`), never move it to `localStorage`.
6. When adding features, keep the game-module seams clean (see Architecture): shared
   behavior goes in `core/`, game behavior in the game's own module. Don't fork the
   shared lobby/matchmaking/reconnection logic per game.

## What this project is

A real-time multiplayer web arcade for party games, playable in the browser. Two
games are live: **Mind Meld** 🧠 (2–4 players converge on the same word) and
**Speed Trivia** ⚡ (2–10 players race through multiple-choice questions). The
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
                            Subclasses implement abstract hooks for game state.
/server/src/store.ts        RoomStore interface (in-memory Map impl) — ALL room state
                            access goes through it so Redis could replace it later.
/server/src/stats.ts        SQLite win stats via better-sqlite3 (data/stats.db,
                            gitignored); degrades to a no-op if the module fails.
/server/src/mindmeld/       manager.ts — Mind Meld state machine (rounds, lock-in,
                            no-repeat, AFK removal after 2 missed rounds).
/server/src/trivia/         manager.ts — vote → fetch → question loop → finish.
                            questionSource.ts — QuestionSource adapter interface +
                            OpenTdbSource (see OpenTDB notes below).
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

No test framework; verification is via **socket smoke-test scripts** that play real
games against a built server, plus typecheck/build. The scripts live in the session
scratchpad (not committed) — recreate them if missing; the pattern:

1. `npm run build`, then `PORT=3199 node dist/server/src/index.js &` (kill any stale
   listener on the port first — `lsof -nP -iTCP:3199 -sTCP:LISTEN -t | xargs kill`;
   a stale pre-change server once caused a phantom "no ack" failure).
2. Connect N `socket.io-client` sockets to `http://localhost:3199/<namespace>`
   (use `createRequire` pointing at this repo's package.json to import the client).
3. Drive a full game with acks + event assertions. Speed the game up via createRoom
   settings (e.g. `{ questionsPerGame: 3, revealPauseSec: 1, categoryVoteSec: 10 }`;
   settings are clamped server-side — mins: 3 questions, 5s question time, 1s reveal).
4. Register `waitFor(event)` listeners BEFORE triggering the action that emits them —
   gameOver fires synchronously after the final reveal (missing this caused a false
   test failure once).
5. Test both games; also `rm -rf data` after tests (stats DB) — it's gitignored.
6. Manual UI check: two tabs on http://localhost:5173/<game> (per-tab identity).

Coverage that exists in the scripts: full Mind Meld win flow (normalization,
no-repeat rejection at lock-in, unlock/re-lock, playAgain reset), full trivia flow
(host-only difficulty, vote + early resolve, decoded questions, hidden correct
answer, duplicate/late answer rejection, scoring bounds 500–1000, sorted scoreboard,
tie winners, playAgain), 10-player trivia game + 11th join rejected + Mind Meld still
capped at 4.

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

- Both games fully working and verified end-to-end; deployed nowhere yet (hosting
  plan: Render free tier — build `npm install && npm run build`, start `npm start`).
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
5. **This file (CLAUDE.md)** — added with the update-before-commit rule.

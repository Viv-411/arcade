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
   plays full games of all six multiplayer titles over real sockets, plus Hotlap's
   determinism + verified-leaderboard suite). Every game must pass —
   Mind Meld must never regress when touching shared infra. CI runs the same on
   GitHub.
5. Games must remain **testable in two browser tabs** on one machine — player
   identity is per-tab (`sessionStorage`), never move it to `localStorage`.
6. When adding features, keep the game-module seams clean (see Architecture): shared
   behavior goes in `core/`, game behavior in the game's own module. Don't fork the
   shared lobby/matchmaking/reconnection logic per game.

## What this project is

A real-time multiplayer web arcade for party games, playable in the browser. Six
games are live: **Mind Meld** 🧠 (2–4 players converge on the same word),
**Speed Trivia** ⚡ (2–10 players race through multiple-choice questions),
**Bid Battle** 💰 (team category-naming auction, exactly 1v1 or 2v2),
**Imposter** 🕵️ (social deduction, 3–10 players online PLUS a fully client-side
pass-and-play mode), and **Codewords** 🗝️ (two-team word-association deduction on
a 5×5 grid, with a Remote mode and a Shared Board + QR-spymaster-phones mode),
and **Chess** ♟ (standard chess with server-authoritative clocks, online PLUS a
pass-and-play mode). Plus one single-player title: **Hotlap** (precision 3D
time-trial racing on 12 original tracks — deterministic physics, millisecond
timing, ghosts, and server-VERIFIED leaderboards; three.js, lazy-loaded).
The README.md holds the full player-facing rules; this file holds contributor
context.

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
                            start validation, public auto-start (ONLY when the
                            lobby is full, after a 15s countdown), rejoin/reconnect, lobby disconnect grace (30s),
                            host reassignment, empty-room GC (5 min), playAgain.
                            Subclasses implement abstract hooks for game state, plus
                            optional overrides: roomMin/MaxPlayers(room) for per-room
                            capacity, quickPlayEligible/quickPlayCreateSettings for
                            mode-filtered matchmaking pools,
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
/server/src/chess/          manager.ts — chess.js is the ONLY legality authority
                            (it THROWS on illegal moves — always try/catch).
                            Owns both clocks: charges the mover, pays the
                            increment, arms an exact flag timer + a 5s resync
                            broadcast. hasMatingMaterial() is exported for the
                            test and implements the FIDE 6.9 flag rule.
/server/src/codewords/      manager.ts — Codewords state machine (untimed clue ↔
                            guess turns; remote majority-vote reveals; board-mode
                            tap reveals + QR-token spymaster joins). wordBank.ts —
                            ORIGINAL self-authored ~380-word bank structured as
                            data packs (never copy a published word list).
/client/src/core/           useRoomCore.ts — client half of shared infra (per-tab
                            session, silent rejoin on connect, lobby actions, toasts,
                            patchRoom, generic joinWith for special join flows).
                            hooks.ts — countdown/progress hooks.
/client/src/components/     GameEntry.tsx, GameLobby.tsx (shared screens), Toasts.tsx.
/client/src/mindmeld/       useMindMeld.ts + GameBoard/EndScreen.
/client/src/trivia/         useTrivia.ts + VoteScreen/QuestionScreen/TriviaFinal.
/client/src/codewords/      useCodewords.ts (shared by three surfaces via distinct
                            gameKeys) + BoardGrid/CluePanel/ClueInput/CodewordsLobby.
/client/src/chess/          useChessOnline.ts + ChessBoardView (react-chessboard v4;
                            v5 needs React 19, we're on 18 — do NOT bump it),
                            chessPanels.tsx, GameControls.tsx, sounds.ts (Web
                            Audio, no audio files), theme.ts, lazyChess.tsx.
                            The three chess PAGES are the ONLY lazy routes;
                            lazyChess owns the loaders, the retry/stale-chunk
                            recovery, the error boundary, and preloadChess().
                            Board coordinates are drawn by US in gutters, not
                            by react-chessboard (see the gotcha below).
/shared/hotlap/             Hotlap's DETERMINISTIC simulation, shared by client and
                            server (see the Hotlap rules below): dmath.ts (exact
                            math + polynomial sin/cos), track.ts (segment list →
                            swept road + hash-grid collision world), car.ts
                            (physics, SIM_VERSION, input bits), run.ts (gates,
                            ms timing, respawn), replay.ts (input RLE codec),
                            bot.ts (validation driver), tracks.ts (campaign),
                            api.ts (HTTP contract).
/server/src/hotlap/         /api/hotlap router; verifier.ts runs replays in a
                            worker_thread (verifyWorker; inline fallback);
                            store.ts = Supabase (hotlap_records) or SQLite.
/client/src/hotlap/         session.ts (fixed-120Hz loop + render interpolation,
                            camera, ghost), render/ (trackMesh, carMesh,
                            environment, effects), input.ts, audio.ts (Web
                            Audio synth), storage.ts (local PBs/settings),
                            themes.ts, TrackMap.tsx, lazyHotlap.tsx.
/tools/hotlap-tracks.ts     Track QA + medal calibration (see Hotlap rules).
/client/src/pages/          Home (game grid), MindMeldPage, TriviaPage — each game
                            page shows its own "How to play" on the entry screen.
                            Codewords has FOUR pages: choice, remote, board
                            (shared screen + QRs), key (spymaster phone).
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
- Imposter (online): 3–10 players. ROLE SECRECY IS CRITICAL — the server sends
  each socket ONLY its own card (yourRole / rejoinExtra); snapshots include
  word/allRoles/winners ONLY when state === "finished" (the imposter test
  sweeps every mid-game roomUpdate to enforce this — keep it passing). The
  crew-can't-say-the-word check is deliberately NOT applied to imposters
  (rejection would confirm their guess). Namespace is /imposter but the client
  route is /imposter-online (gameKey overridden after super(); GAME_PATHS in
  shared/social.ts maps invite links). Round-cap counter resets each
  elimination cycle; forced-final-vote deadlock = imposters win. The
  pass-and-play mode (/imposter/local) is PURE React state — no server, no
  accounts; keep it that way.
- Codewords: ONE shared key per game — BOTH spymasters see the SAME complete
  key (there is no per-team key). KEY SECRECY boundary is spymasters-vs-
  operatives only: the key travels via the private `yourKey` event and
  `rejoinExtra`; snapshots carry identities ONLY on revealed cards and
  `fullKey` ONLY when state === "finished" (the codewords test sweeps
  operative AND shared-board roomUpdates — keep it passing). Two modes in one
  namespace via `settings.mode`: "remote" (4–10 players, guesses are
  majority votes of the team's CONNECTED operatives; pass needs a majority
  too and ≥1 guess made) and "board" (exactly board device + 2 spymaster
  phones; phones join via per-team QR tokens — the token identifies the
  phone's TEAM, both phones get the same key; normal joinRoom is blocked via
  the joinBlocked hook; the board device taps reveals and can log spoken
  clues as number-only). Untimed by design — no turn timers anywhere.
  Clue validation: single token, no substring overlap either direction with
  any unrevealed board word; number 0–9 or "unlimited" (0/∞ = uncapped);
  guesses = EXACTLY the number, no +1 bonus (owner rule, 2026-07-19).
  Board-mode games record NO account stats (remote
  does). Word bank is ORIGINAL (wordBank.ts) — never import or imitate a
  published Codenames list, and never use the "Codenames" trademark in UI.
- Chess: EXACTLY 2 players. Perfect information — unlike Imposter/Codewords
  there is NOTHING to hide, so the snapshot carries the whole position and
  there are no secrecy sweeps to keep passing. What IS load-bearing is
  AUTHORITY: the server validates every move with chess.js (which THROWS on
  illegal input — always try/catch), owns both clocks, and flags timeouts on
  its own timer whether or not a client is watching. The client applies an
  OPTIMISTIC position so the piece moves instantly, but discards it the moment
  the server speaks. Flag rule: a timeout is a DRAW when the opponent can't
  possibly mate (FIDE 6.9 asks about POSSIBLE, not forced, mate — so K+B and
  K+N are draws but K+N+N is a loss). Disconnect ≠ resign (clock keeps
  running, they can rejoin); LEAVING ends the game. playAgain swaps colours.
  Base minutes are FRACTIONAL on the wire on purpose so tests can flag a clock
  in seconds; the UI only offers whole minutes.
- Hotlap (single player, route /hotlap, no sockets): an ORIGINAL game — its
  own handling, tracks and look. The owner asked for a 1:1 PolyTrack copy;
  that was declined (recreating a specific existing game), and Hotlap was
  built instead around the qualities they named: one car, no upgrades,
  deterministic, millisecond timing. Never copy another game's tracks/look.
  **DETERMINISM IS LOAD-BEARING**: anything under shared/hotlap that feeds
  the sim may use only + - * /, Math.sqrt/abs/min/max/floor/round/sign and
  dmath.ts — NEVER Math.sin/cos/atan2/pow/exp/hypot (engines differ, and a
  Safari run would then fail verification on Node). Iteration order must be
  deterministic (arrays, insertion-ordered maps). Bump `SIM_VERSION` on ANY
  change that alters sim results (physics constants, track building,
  timing) and a track's `version` when its geometry changes — records and
  ghosts are keyed by both, so stale ones simply stop matching. After any
  physics or track change run `npx tsx tools/hotlap-tracks.ts` (validation,
  self-overlap check, both bots finish with 0 respawns, determinism) and
  paste its calibrated `medals:` lines (ace = fast-bot × 0.94, gold × 1.02,
  silver × 1.12, bronze × 1.30); `--strict-medals` must pass. The clock
  starts on the first tick a DRIVE input is held (no countdown); tick 0 of
  the replay is that tick. Respawn = input bit 16 (edge-triggered), so
  respawns replay too. Server stores the time IT computes; claimedMs ≠
  computed → 422. Posting needs an account; anonymous players keep local
  PBs (localStorage is fine here — device data, not identity). `?autopilot=1`
  on the play page is a QA hook (the bot drives; such runs are never posted).
  OWNER FEEL RULES (2026-10-27, SIM_VERSION 5 — see session 36 for the
  latest numbers, which supersede the ones in this paragraph): the owner wants the driving
  as close to PolyTrack's FEEL as possible (handling only — the game, tracks
  and look stay original). Targets were MEASURED from PolyTrack's public
  leaderboard replays + their speed graph (no code/assets used): constant
  ~17 m/s² launch to ~200 km/h (ours 0–100 1.6 s, 0–200 3.3 s), still
  ~10 m/s² near 330 km/h (ours tops ~418), ~2.3 g brakes, ~2.0–2.2 g grip
  that FADES with speed (fast corners need wide arcs), and corners taken as
  a CONTROLLED SLIDE (nose leads the travel direction by ~7–11°, speed
  bleeds gradually). Measure with probes before/after any tuning. Load-
  bearing pieces of car.ts: the per-wheel grip cap (`gripStepFraction`) —
  without it yaw chatters every substep; the grounded yaw assist, whose
  target is capped by the grip LEFT after braking/driving (so braking hard
  into a corner trades rotation for stopping — the owner flagged turns
  under braking as "weird" before this) and leads by `slideLead` until the
  slide reaches `maxSlip`; and `rearSlide`, which loosens the rear with
  steering × speed but fades out as the slide nears `maxSlip` (self-
  limiting — no spin-outs). Steering ramp lengthens with speed
  (`steerRampPerMs`). The CAMERA: fixed distance/height, constant FOV, no
  shake, follows the direction of TRAVEL (a slide shows the car angled in
  frame, as in PolyTrack) and leans 35% with the car on banks — never let
  speed, braking or boost move or zoom it. The car is an original low-
  detail open-wheel design (exposed wheels drawn exactly at the physics
  contact; three brake lights). All themes are DAYTIME. After physics
  changes retune BOT_CAREFUL/BOT_FAST to the real grip (the bot also
  respects crests, can't brake in the air, and caps takeoff speed when a
  corner follows a landing) or medals calibrate wrong.
- Bid Battle: EXACTLY 2 (1v1) or 4 (2v2) players in fixed teams; per-mode quick
  play pools (full-lobby-only auto-start applies like everywhere). **Leaving mid-match forfeits for the
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
- Messaging: chats/chat_members/chat_messages tables have DENY-ALL RLS —
  server-only via service role. SocialManager validates everything (DMs need
  accepted friendship; group members must be the creator's friends; reads and
  posts need membership; chat invites need lobby membership + the capacity
  rule: chat recipients <= open seats). Invite messages ALSO emit the legacy
  lobbyInvite bell event to online members. Client: SocialContext chat state
  + /messages page; lobby InviteFriends panel routes invites through chats
  (presence display is informational). Unread = last message newer than the
  member's last_read_at. Group roster management (2026-07-19): addToGroup
  (creator only, adds must be the CREATOR's accepted friends, 10 members max),
  leaveGroup (any member, groups only — never DMs; last member out deletes
  the chat row), deleteGroup (creator only, must still be a member — a
  creator who left can't add or delete, the group is orphaned by design).
  ChatSummary.createdBy exposes the creator for the UI gating; the server
  re-validates everything.
- Friends/social layer: `friendships` table (one row per pair, unique
  least/greatest index; RLS = participants only, addressee-only accept) managed
  directly from the client via supabase-js; `/social` Socket.IO namespace
  (server/src/social/manager.ts) for presence + lobby invites, validated
  server-side (service-role friendship lookup, room-membership + lobby-state
  checks via the shared room stores, 10s per-friend invite cooldown). Presence
  registry in server/src/core/presence.ts is fed by the room core (setRoom on
  join/rejoin, clearRoom on removal) and by /social connect/disconnect. Client:
  SocialContext (friends via RLS queries + 45s poll, invites via socket),
  NotificationBell (corner 🔔), FriendsPage (/friends, add by username / link /
  QR via the `qrcode` package), InviteFriends panel in both lobby components.

## Commands

```bash
npm run dev          # tsx watch server (:3001) + Vite (:5173, proxies /socket.io)
npm run typecheck    # tsc both sides, no emit
npm run build        # vite build (client/dist) + tsc server (dist/)
npm start            # node dist/server/src/index.js — serves client + sockets on :3001
```

Run npm scripts **from the repo root** (the server resolves `client/dist` and
`data/` from cwd). Node ≥20.12 (`process.loadEnvFile` needs 20.12+, and
React Router 7 needs 20+; CI uses 22; developed on Node 24/25, macOS).

## Testing

`npm test` — builds, then `tests/run.mjs` boots the built server on port 4123 with
an isolated temp stats DB, waits for /healthz, and runs each `tests/*.test.mjs` as a
child process (real `socket.io-client` sockets playing full games). `npm run
test:only` skips the rebuild. CI (`.github/workflows/ci.yml`) runs typecheck + build
+ tests on every push/PR.

Coverage: Hotlap (every track: careful bot finishes with 0 respawns and
re-simulates to the identical ms directly and after replay encode/decode;
API: 401/400/404/409/422/429 paths, verified time = local sim, improved vs
not, ranks + ties + `you`, replay round-trip, /me). Full Mind Meld win flow
(normalization, no-repeat rejection at lock-in,
unlock/re-lock, playAgain reset), full trivia flow (host-only difficulty, vote +
early resolve, decoded questions, hidden correct answer, duplicate/late answer
rejection, scoring bounds 500–1000, sorted scoreboard, tie winners, playAgain),
a 10-player trivia game (11th join rejected; Mind Meld still capped at 4),
chess (server-side rejection of illegal/out-of-turn/not-your-piece moves,
increment paid, castling, check, promotion incl. the captured piece, checkmate,
rematch colour swap, resign, draw offer/decline/accept, reconnection restoring
position + history + a still-running opponent clock, a real server-flagged
timeout on a 3s clock, and the insufficient-material flag rule asserted
directly against the exported hasMatingMaterial),
Bid Battle 1v1 + 2v2 (ballot with custom approval, opener-timeout pass +
double-timeout redraw, raise/challenge validation, dedup, team-only item
visibility, full flag/defend/accept/uphold review math, forfeit on leave,
per-mode quick play pools), and Codewords (remote: identical spymaster keys,
9/8/7/1 split, clue validation, majority votes + toggle + pass, opponent/
assassin outcomes, playAgain keeps seats, operative secrecy sweep; board:
QR-token joins, join/start gating, spoken + typed clues, tap reveals, phone
rejoin restores the key, board secrecy sweep).

Gotchas encoded in `tests/helpers.mjs` — keep them in mind when writing new tests:

- Register `waitFor(event)` listeners BEFORE triggering the action that emits them —
  gameOver fires synchronously after the final reveal (caused a false failure once).
- Speed games up via createRoom settings (clamped mins: 3 questions, 5s question
  time, 1s reveal, 5s vote); trivia falls back to built-in questions offline or when
  OpenTDB rate-limits, so tests stay deterministic in CI.
- A stale server process on the test port once caused a phantom "no ack" failure —
  the orchestrator surfaces the EADDRINUSE crash in its server-log output.
- **Don't set a speed-up setting so low that the test must win a race against the
  server's own timer.** This caused the long-standing bidbattle flake (fixed
  2026-07-31): `bidTurnSec: 3` had to cover a challenge-rejection plus several
  raises in ONE turn (only a *successful* raise re-arms the timer), and
  `reviewSec: 4` had to cover an 8-round-trip flag/defend/finalize exchange that
  can never resolve early (the test deliberately leaves one item in the
  non-terminal "ok" state). Both now sit at ~3x the needed margin. Keep any
  `waitFor` timeout that waits on a full turn elapsing at >= 2x that setting.
- Keep each file's `globalTimeout` BELOW the orchestrator's 150s per-file kill in
  `tests/run.mjs`, or the nicer in-test message can never fire.
- Manual UI check: two tabs on http://localhost:5173/<game> (per-tab identity).
  The Claude-in-Chrome extension DOES work here (see the ops note); driving the
  real UI caught three things the socket tests structurally cannot — a layout
  wrap, a CSS flex-direction inherit, and a material-count bug. Budget a
  browser pass for anything visual.
- **Do NOT add `build.rollupOptions.output.manualChunks` for the chess split.**
  It looks like an improvement (a nicely named chunk) but Vite then emits a
  `<link rel="modulepreload">` for that chunk in index.html, so EVERY visitor
  downloads chess up front and the lazy route stops saving anything. Verified
  both ways: with manualChunks index.html preloads it, without it there are no
  preload links at all. If you touch the split, check `client/dist/index.html`
  for modulepreload lines and grep the main chunk for `Chessboard`.

## Environment / ops notes

- Env vars: `PORT` (default 3001), `STATS_DB` (default `data/stats.db`; also
  Hotlap's SQLite records), `HOTLAP_STORE=sqlite` (force SQLite records even
  with Supabase configured). `tests/run.mjs` boots the test server with
  `HOTLAP_STORE=sqlite` + a test `SUPABASE_JWT_SECRET` (HS256 tokens minted in
  the test); `process.loadEnvFile` never overrides vars already set, so the
  owner's real `.env` can't leak into tests.
- Visual QA without the Chrome extension: drive headless Chrome over CDP
  (`--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader`,
  `Input.dispatchKeyEvent` for held keys, `Page.captureScreenshot`). Software
  WebGL starves the main thread, so fetches resolve seconds late and the sim
  runs slower than real time there — don't mistake either for a bug.
- Long-running dev servers started from a Claude session get killed by session task
  cleanup — start detached: `nohup npm run dev > /tmp/dev.log 2>&1 & disown`.
  Stop everything: `lsof -nP -iTCP:5173,3001,3199 -sTCP:LISTEN -t | xargs kill`.
- The trivia smoke test hits the real OpenTDB API; first fetch after server start can
  queue ~10s behind the startup warm-up (rate-limit throttle). Offline, the built-in
  question fallback keeps games working.
- Browser automation: the Claude-in-Chrome extension DOES work (verified
  2026-08-01). Earlier sessions recorded it as "not connectable", but the real
  cause was simply that no Chrome instance was paired: the extension was
  installed and enabled, and `list_connected_browsers` returned `[]`. Fix is
  owner-side — be signed into claude.ai in Chrome with the SAME account as
  Claude Code, then open the extension. After that, `list_connected_browsers`
  → `select_browser` → drive it. Serve a real build (`npm run build`, then
  `PORT=3199 node dist/server/src/index.js`) so lazy chunks are exercised.
  Gotcha (2026-10-26): a server started from a SANDBOXED Bash call is
  reachable by curl inside the sandbox but NOT by the user's Chrome (the
  extension's tab shows an error page). Either start the server outside the
  sandbox or drive headless Chrome over CDP from inside it (`--headless=new
  --remote-debugging-port=N`, then Node's built-in WebSocket) — that is how
  the React Router 7 upgrade was route-checked.

## Current state (update before every commit)

- SIX games live; deployed at https://arcade-1628.onrender.com (Render free
  tier; owner-managed; a keep-alive GitHub workflow pings it). Local `.env`
  (gitignored) holds the owner's real Supabase keys — client env is baked at
  build time, server env read at runtime; Render has the same five vars set.
- Supabase schema fully applied (profiles+trigger, trivia_sets/questions,
  player_stats+record_game_result, friendships, chats/chat_members/
  chat_messages, trivia_set_shares) — ALL migrations are applied to the
  hosted DB as of 2026-07-19, including 20260719000000_trivia_set_shares.sql
  and its follow-up 20260719000001_fix_share_read_policy.sql (the original
  share-aware trivia_sets select policy compared an unqualified `id` inside
  the subquery, which bound to trivia_set_shares.id — the inner relation —
  so shared reads silently returned nothing; always QUALIFY column names in
  RLS policy subqueries). Migrations go to the hosted DB via
  `npx supabase db push --db-url "postgresql://postgres.lpfjrayitzwbdowgpdfj:<DB_PASSWORD>@aws-1-us-west-2.pooler.supabase.com:5432/postgres"`
  (direct db host is IPv6-only from this network; ask the owner for the DB
  password — NEVER commit it; it is not in the repo or .env).
- Accounts: email/password + Google both work end to end (identities
  auto-link on matching verified email). Owner's account: @iamfunny411.
  Features shipped: account page + durable stats, friends (requests via
  username/link/QR), presence, messages (friend DMs + group chats, deny-all
  RLS, server-mediated), chat-based lobby invites with group capacity gating,
  notification bell (requests + invites + unread chats).
- Auto-start policy (2026-07-17): public lobbies auto-start ONLY when
  completely full, via a 15s countdown; otherwise host-start with all ready.
- Client deps now include chess.js 1.4 + react-chessboard 4.7 (chess only).
  react-chessboard v5 requires React 19 and this app is on React 18 — v4 is
  pinned deliberately; do not "upgrade" it without moving React first.
- Home's game grid is six cards; accents are pink/yellow/green/cyan/red plus
  chess's `--accent-mono` off-white.
- Hotlap shipped locally (2026-10-26; physics SIM_VERSION 4 as of
  2026-10-27, tuned toward PolyTrack's measured feel): 12 tracks, verified
  leaderboards, ghosts. Client deps: three 0.170 (only in the lazy HotlapPlayPage chunk,
  ~560 kB; no modulepreload — verified). Migration
  20261026000000_hotlap_records.sql must be pushed after the owner resumes
  Supabase, or production leaderboards stay 503.
- Deps (2026-10-26): React Router 7 (react-router-dom 7.18, library mode —
  same `BrowserRouter`/`Routes`/`Link`/`useNavigate`/`useSearchParams` API
  the app already used, no code changes needed) and Vite 6.4 (NOT 7/8 —
  6.4.5 is the smallest jump that clears every advisory; Vite 8 swaps in
  Rolldown, which would need the chess-chunk checks below redone).
  `npm audit` = 0 vulnerabilities after this pass. React stays on 18.
- SUPABASE FREE-TIER PAUSE: on 2026-10-26 the project host
  (lpfjrayitzwbdowgpdfj.supabase.co) returned NXDOMAIN — the signature of a
  paused free project (pauses after ~7 days idle). While paused, login,
  friends, chats, stats and /sets are down on the live site; anonymous play
  is unaffected by design. Restore is owner-only via the Supabase
  dashboard. If accounts features "suddenly" break after a quiet spell,
  check this first (`dig +short <ref>.supabase.co`).
- Keep-alive caveat: the repo is PRIVATE, so the `*/5` keep-alive cron
  bills Actions minutes (each run rounds up to a minute) against the
  2,000/month free allowance shared with CI — owner to confirm on GitHub's
  billing page; unverified from this environment (no `gh` CLI installed).
- git: single `main`, remote origin = https://github.com/Viv-411/arcade, CI
  green. As of 2026-07-31 `origin/main` is fully up to date — the custom
  trivia sets work (3 commits) had sat unpushed for ten days, so the LIVE SITE
  lacked /sets and /solo/trivia while the hosted DB already had their
  migrations. If a feature seems missing in production, diff
  `git log origin/main..HEAD` before debugging anything else.
- PROJECT_CONTEXT.md was reconciled against the code on 2026-07-31 (it had
  drifted badly: no Codewords, wrong auto-start rule, sets listed as
  unbuilt). Both docs are now accurate; CLAUDE.md remains the contributor
  source of truth and PROJECT_CONTEXT.md the "why" doc.
- Owner preferences (standing): no AI attribution in commits; ask before push
  unless told; secrets shared in chat (Supabase keys, DB password) should be
  rotated by the owner someday — remind occasionally, don't nag.

## Live verification scripts (recreate as needed)

The deep e2e checks (auth pipeline, RLS, stats, friends, chats, 50-account
stress) live only in session scratchpads — recreate on demand. The recipe:

- Node ESM script; import deps from THIS repo:
  `createRequire("/path/to/repo/package.json")` then `require("@supabase/supabase-js")`
  and `require("socket.io-client")`.
- Load env: run with `set -a && source .env && set +a` in the repo dir; build
  first and run `PORT=4189 node dist/server/src/index.js` (kill stale
  listeners on the port first — a stale server once caused phantom failures).
- Create disposable users via `admin.auth.admin.createUser({ email:
  "arcade-<x>-<ts>@example.com", password, email_confirm: true,
  user_metadata: { username } })`, sign in with the anon client for tokens,
  pass tokens to sockets via `auth: { token }`. ALWAYS delete the users in a
  finally block (cascades clean profiles/friendships/chats/stats).
- Test-listener rules: register waitFor BEFORE the triggering action; for
  back-to-back events (clueTurn etc.) use the queueing-collector pattern from
  tests/imposter.test.mjs.
- Sign-in bursts can hit Supabase auth rate limits — retry with backoff.

## Backlog (agreed future work, not started)

- Hotlap: multiplayer later (the owner's stated next step — live ghosts of
  other players are the natural first stage, since runs are deterministic);
  a track editor (the segment format is editor-friendly); more tracks.

- Home's Singleplayer section has ONE placeholder card left: Daily Challenge
  (Solo Trivia shipped 2026-07-19 at /solo/trivia).
- Chess has NO computer opponent by design (see README). If one is ever added,
  Stockfish via WebAssembly on the CLIENT is the obvious route — do not put an
  engine in the game loop on the server, it's a single shared process.
- Chess piece-set chooser (board themes + sound toggle already exist).
- Custom trivia sets are DONE end to end (content layer at /sets + gameplay
  in private lobbies and solo).
- User-uploaded Imposter category packs could reuse the accounts DB.
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
10. **Account page + durable stats** — /account route (details, linked
    providers, username/display-name editing, stats, sign out); migration
    20260712000000: profile backfill for pre-trigger users (fixed the owner's
    account → @iamfunny411), player_stats table (owner-only select, writes only
    via the service-role-only record_game_result function). BasePlayer carries
    userId from the socket handshake (refreshed on rejoin); all three managers
    pass participants+game key to the stats store, which records signed-in
    players to Postgres fire-and-forget alongside the local SQLite. Owner's
    email+Google identities confirmed auto-linked (same verified email).
    Live-verified: authed game win → correct player_stats row; clients denied
    record_game_result (42501); owner-only stats reads.
11. **Friends system** — migration 20260712100000 (friendships + RLS), /social
    namespace (presence + validated lobby invites), core presence registry,
    /friends page (add by username / invite link / QR), corner notification
    bell, InviteFriends panel in lobbies. Live-verified end to end: request
    lifecycle, forged-request and RLS isolation, addressee-only accept,
    presence with lobby activity, invite delivery + rate limit + non-friend /
    non-member rejections, join-via-invite, unfriend lockout, offline
    detection. Gotcha: the invite endpoint checks room membership BEFORE
    friendship, so a non-member non-friend gets the membership error.
12. **Visual polish pass** — expandable QR (rendered at 512px, tap-to-enlarge
    overlay), 👥 Friends pill on the home header, and layout fixes: `.page`
    top padding (56px) clears the fixed corner buttons, the sticky in-game
    round-bar now sticks at top:56px so it can't collide with them,
    `.lobby-buttons`/`.settings-line`/`.link-btn` gained breathing room.
    If new fixed/sticky top-of-page elements are added, keep them below the
    56px corner-button band.
13. **Multiplayer reliability fixes** (after owner reports: playAgain
    sometimes dead, invites sometimes failing, multi-game issues). Root
    causes + fixes, all verified by a 50-account stress harness (scratchpad
    stress.mjs pattern; two clean iterations across all games, quick-play
    stampedes, invites, reconnects, menus):
    - Fire-and-forget emits (playAgain/toggleReady/startGame/votes/flags/…)
      sent while the socket was disconnected were buffered by socket.io and
      flushed on reconnect BEFORE the automatic rejoin rebound the session —
      the server dropped them silently. Client now refuses to emit while
      disconnected (`emitEvent` guard in useRoomCore, toast + reconnect) and
      the server answers session-less lobby actions with an errorMsg instead
      of silence.
    - Game sockets could connect BEFORE the Supabase session finished loading
      → anonymous membership → friend invites failed ("not in that lobby")
      and stats went unattributed. supabaseClient now emits onIdentityChange
      (sign-in/out or initial session resolution, never token refreshes) and
      useRoomCore re-handshakes + auto-rejoins, healing userId binding.
    - Following a lobby-invite/share link (?room=CODE) did nothing if the
      entry screen was already mounted (useState initializer) or the player
      was in another room. GameEntry now syncs the param via effect, and
      useJoinLinkOverride (core/hooks) leaves the current room when a link
      targets a different one — wired into all three game pages.
    - Concurrent trivia rooms queued 5.5s apart on the OpenTDB throttle; a
      10-min question cache per category+difficulty now serves same-category
      games instantly (repeat questions across different rooms: accepted
      tradeoff).
    - MM disconnect fast-path (round resolves when all CONNECTED players are
      locked) is spec'd behavior, kept as-is; the harness asserts it.
14. **Imposter (fourth game)** — two modes behind /imposter: pass-and-play
    (/imposter/local, pure client state, offline-capable) and online
    (/imposter-online ↔ namespace /imposter) on the shared room core. Built-in
    word bank in shared/imposterWords.ts (10 categories × 25+). Server manager:
    reveal → clue rounds (turn timers, auto-skip) → continue-or-vote → secret
    accusation vote (tie → runoff → no-elimination; forced after round cap) →
    optional word steal → parity win check → cycles. Tests cover secrecy
    (per-socket cards, no-leak snapshot sweep, rejoin), tie/runoff, steal
    success+fail, forced votes, skips, parity. Home page has no more
    coming-soon placeholders. Test gotcha that bit here: back-to-back server
    events (consecutive clueTurns) outrun re-registered waitFor listeners —
    use the queueing collector pattern from tests/imposter.test.mjs.
15. **Cowork phase start — PROJECT_CONTEXT.md** — reconciled the design brief
    `PROJECT_CONTEXT.md` against the live code and committed it to the repo,
    marking the start of the Cowork phase (research/docs/dashboards/context
    upkeep run through Cowork; coding stays in Claude Code). Corrected stale
    design claims to match reality: player identity is `sessionStorage`
    per-tab (not `localStorage`); JWT verification uses `jose` + JWKS ES256
    with an HS256 fallback (not `getUser`); Bid Battle delivery shows both
    teams every accepted item live (not count-only); filled in verified
    env-var names, the Render deploy URL, and all four merged games. No code
    changed — docs only.
16. **Keep-alive workflow (Cowork)** — added `.github/workflows/keepalive.yml`,
    a scheduled GitHub Actions job (`*/5` cron + `workflow_dispatch`) that curls
    the deployed `/healthz` to prevent the Render free-tier spin-down. Chosen
    over UptimeRobot to avoid a third-party account/credentials. No app code
    changed; only takes effect once pushed to `origin` (GitHub runs the cron).
    Motivated by a Cowork monetization/cost review: running costs are near-zero,
    the free tier's cold start is the main UX cost, and this mitigates it.
17. **Messages + fixes (2026-07-16)** — fixed the Imposter word-steal softlock
    (vote-result overlay never cleared when entering the steal phase, covering
    the guess input); added a Singleplayer section to Home (Imposter pass-and-
    play + placeholders); added friend DMs + group chats (migration
    20260715000000, deny-all RLS, server-mediated via SocialManager) with
    chat-based lobby invites replacing direct invites (capacity-gated for
    groups), a /messages page, bell unread badge, and 💬 buttons on the
    friends page. Live-verified: friendship gating, realtime delivery, unread/
    read, membership isolation, direct-table RLS denial, group rules, capacity
    blocking, invite join flow.

18. **Auto-start rework + home tweak (2026-07-17)** — public lobbies no longer
    countdown-start when partially full. Games start ONLY via host start
    (everyone ready) or, in public lobbies, a 15s countdown once the lobby is
    COMPLETELY full (cancelled if someone leaves; requires all connected at
    fire; re-armed on rejoin). canAutoStartPartial hook removed. Bid Battle's
    full-room auto-start and playAgain restart now go through the same 15s
    countdown (test timeouts bumped accordingly). Imposter card removed from
    the home Singleplayer section (placeholders remain).

19. **Codewords (fifth game, 2026-07-18)** — two-team word deduction on the
    shared room core + Bid Battle-style team layer (`${code}#red`/`#blue`
    socket rooms). One namespace (/codewords) hosts BOTH modes via
    settings.mode: Remote (own devices, majority-vote guessing) and Shared
    Board (board device + QR-token spymaster phones; board rooms reject
    joinRoom). Correction learned mid-spec: there is ONE shared key — both
    spymasters see the identical complete key; the only secrecy boundary is
    spymasters-vs-operatives. Core gained two additive hooks (joinBlocked;
    addPlayerToRoom/detachFromCurrentRoom made protected) and the client core
    a generic joinWith action — existing games untouched (full suite still
    green). Original ~380-word bank in server/src/codewords/wordBank.ts (packs
    as data; IP note: never copy a published list, tile named "Codewords").
    Four client pages (choice/remote/board/key) sharing useCodewords with
    per-surface sessionStorage gameKeys so one browser can host board + both
    phones in three tabs. tests/codewords.test.mjs covers both modes incl.
    secrecy sweeps. Board-mode games record no stats; remote does.

20. **Codewords UI fixes (2026-07-19, owner playtest feedback)** — (a) the
    shared board's QR codes never rendered: boardTokens arrives on the wire
    BEFORE the createRoom ack, and the ack's session reset wiped it from the
    reducer (the e2e test read the socket event directly, so it missed the
    client-state bug) — reset now keeps boardTokens on "joined"; (b) the clue
    row was mangled by the GLOBAL `input, select { width: 100% }` rule (the
    number select hogged the row, crushing the text input to an invisible
    sliver) — .cw-clue-row now pins explicit widths; remember this global
    rule when putting inputs in flex rows; (c) the lobby's unexplained 🕵️
    icon button is now a labeled "Spymaster" button.

21. **Codewords rule + layout polish (2026-07-19, owner playtest round 2)** —
    RULE CHANGE: the guess cap is now EXACTLY the clue's number (no +1 bonus;
    0/∞ still uncapped) — owner request, reflected in server, UI copy, README,
    and test assertions. Shared-board QR pair restyled as centered tiles
    (flex-column cards; the "copy link instead" link used to float inline
    beside the QR image), stacking on narrow screens; guess-action row
    centered.

22. **Site-wide UI polish pass (2026-07-19)** — system-level restyle, no
    markup restructuring (all screens lift through the shared classes).
    Design system decisions to PRESERVE in future work: body face is now
    "Space Grotesk" (Google Fonts, loaded in client/index.html next to Press
    Start 2P — display stays arcade-only and used sparingly); a fixed CRT
    overlay (body::before scanlines + body::after vignette, pointer-inert,
    ~2.4% alpha — delete those two rules to kill the effect) is the site
    signature, plus a one-time crt-on flicker on the home title; GLOW IS A
    BUDGET — reserved for the title, the room-code "ticket" box, .btn.primary,
    and per-game card hovers; panels/buttons use subtle gradients + 1px
    borders instead. Per-game accent classes (.accent-pink mindmeld /
    -yellow trivia / -green imposter / -cyan bidbattle / -red codewords) set
    --accent/--accent-glow consumed by .game-card.active and .play-badge —
    new games should claim an accent. Cross-cutting "polish layer" section at
    the end of styles.css: :focus-visible cyan rings, frosted sticky
    .round-bar, cw-card flip animation, styled scrollbars, and a
    prefers-reduced-motion kill-switch for ALL animation.

23. **Custom pixel icons replace ALL emojis (2026-07-19)** — every emoji in
    the client (~230 sites, 37 files) swapped for the `pixelarticons` set
    (npm dep, MIT) rendered through `client/src/components/Icon.tsx`
    (raw-SVG inlined via Vite `?raw`, 1em, fill: currentColor, `label` prop
    for standalone a11y; tint utilities .ic-red/.ic-blue/.ic-green/
    .ic-yellow/.ic-pink/.ic-muted). RULE GOING FORWARD: no emojis in UI —
    add names to Icon.tsx instead. Brand icons per game: mindmeld=lightbulb,
    trivia=zap, imposter=sunglasses, bidbattle=coins, codewords=grid-3x3;
    codewords spymaster=eye, assassin=skull, bystander=human, host=crown
    (ic-yellow). `.game-emoji` now colors card art with the game's --accent.
    Gotchas hit: `<option>` elements can't hold JSX (those emojis were
    dropped to plain text); strings that flow into string-typed props
    (settingsLine, statusOf, chat previews) were de-emojied rather than
    converted to ReactNode; multi-line `import {` blocks broke a naive
    "insert after last import line" script once.

24. **Group chat management (2026-07-19)** — leave / delete / add-people for
    group chats (see the Messaging bullet above for the exact rules). New
    /social events addToGroup/leaveGroup/deleteGroup + ChatSummary.createdBy;
    SocialContext gained matching functions; MessagesPage group header grew
    Add people (creator), Leave (all, two-tap inline confirm), Delete
    (creator, two-tap confirm) with a friend-chip picker reusing the
    new-group UI. No migration needed (chats.created_by + cascades already
    existed). Live-verified with the scratch harness (27 checks: permission
    denials, non-friend adds, dupes, DM immunity, cascade cleanup,
    orphaned-group semantics, last-member auto-delete, chatsChanged fanout).

25. **Custom trivia sets — content layer (2026-07-19)** — /sets page (behind
    login; home-header pill + account-page link): My Sets + Shared with me,
    set editor (title/description/category, per-question CRUD with 2-4
    options + exactly-one-correct validation, up/down reorder that renumbers
    positions 0..n-1), friend sharing with revoke (+ recipient-side remove),
    and copy-based composition (copy selected questions into an own set, or
    duplicate a whole readable set; source_set_id = provenance only).
    Architecture: client-direct supabase-js with RLS as the server-side
    authority (mirrors friendships; NO service-role path). Migration
    20260719000000: trivia_set_shares table + share-aware select policies on
    trivia_sets/questions + questions.source_set_id + a NOT VALID shape
    check. The questions table already matched the Speed Trivia engine shape
    — no data migration. database.types.ts updated by hand (as required).
    MIGRATION NOT YET APPLIED to the hosted DB (needs the owner's db push);
    README carries the manual RLS checklist. Gameplay wiring is the next
    phase (backlog).

26. **Custom trivia sets — gameplay wiring (2026-07-19)** — both migrations
    pushed to the hosted DB, which surfaced an RLS bug: the share-aware
    trivia_sets select policy used an UNQUALIFIED `id` in its subquery, so
    Postgres bound it to the inner relation (trivia_set_shares.id) and
    shared reads returned nothing. Fix migration
    20260719000001_fix_share_read_policy.sql qualifies `trivia_sets.id`;
    19-check RLS harness green afterwards. Then two ways to PLAY a set:
    - **Private Speed Trivia lobbies.** New shared type CustomSetInfo +
      TriviaSnapshot.customSet + client event setCustomSet. The host-only
      picker (client/src/trivia/CustomSetPicker.tsx, in the lobby extras)
      lists owned + shared sets; picking one SKIPS the category vote
      (beginGame branches to loadCustomSetAndStart; "voting" becomes a brief
      load screen) and hides the difficulty selector. PUBLIC/quick-play
      rooms are rejected server-side and drop any stale pick.
      server/src/trivia/customSets.ts loads the set with the SERVICE ROLE
      (other players may have no access of their own) and therefore
      RE-IMPLEMENTS the access rule IN CODE — owner or trivia_set_shares
      row, set not removed — checked at pick time AND again against the
      CURRENT host at game start, with graceful fallback to a category vote
      on any failure. Question order always shuffled; options reshuffled
      server-side with the correct index recomputed; set smaller than
      questionsPerGame shortens the game, larger plays a RANDOM subset.
      Everything downstream of game.questions is the untouched engine.
    - **Solo practice** (/solo/trivia?set=ID, pages/SoloTriviaPage.tsx): no
      sockets, no room; reads the set through the USER'S OWN session (RLS,
      no service role), scores client-side on the same 1000→500 curve.
      PRACTICE ONLY — never feeds account stats or leaderboards. The
      question card was extracted to the purely presentational
      trivia/QuestionCardView.tsx, shared by multiplayer and solo.
    Home's Solo Trivia card is live; SetsPage gained a "Play solo" button.
    Live-verified with a scratch harness (private-lobby game end to end,
    non-host/public/anonymous/unknown-set rejections, share grant unlocking
    a set for the recipient, and a full sweep asserting the guest NEVER
    receives correctIndex before the reveal). Harness gotcha: core
    `toggleReady`/`startGame` take NO ack callback — awaiting an ack on
    them hangs forever. Also noted: `bidbattle.test.mjs` flaked at random
    points across several runs on this machine under load; reproduced
    identically on unmodified `main`, so it's a pre-existing timing
    sensitivity in that test, not a regression — worth a look separately.

27. **Fix ambiguous `questions` embed on /sets (2026-07-21)** — once
    `source_set_id` (provenance FK, added in the sharing migration) was
    live on the hosted DB, `questions` had TWO foreign keys into
    `trivia_sets` (`set_id` and `source_set_id`), so PostgREST's bare
    `questions(count)` embed in `client/src/sets/api.ts` became ambiguous
    and `/sets` failed to load ("Could not embed because more than one
    relationship was found for 'trivia_sets' and 'questions'"). Fixed by
    qualifying all three call sites with the explicit relationship hint
    `questions!questions_set_id_fkey(count)`. Lesson: any embed shorthand
    on a table with more than one FK to the same target must name the
    relationship explicitly, or it will break the moment a second FK
    lands — even if it worked fine before that column existed. Also
    cleaned up leftover test accounts/sets in the hosted DB from earlier
    live-verification scratch runs (some got killed mid-script before
    their cleanup ran).

28. **Ship the backlog + docs/flake cleanup (2026-07-31)** — a full read of
    the codebase turned up one shipping problem and a pile of drift.
    - **Pushed the 3 unpushed commits.** Sessions 25–27 had never reached
      `origin/main`, so the deployed site had NO /sets and NO /solo/trivia
      (its Solo Trivia card was still a "Coming soon" placeholder) even
      though both sharing migrations were already applied to the hosted DB.
      Verified by grepping the deployed JS bundle, not by assumption.
    - **Fixed the bidbattle flake** (session 26 left it "worth a look").
      Root cause was NOT a server bug: the test's speed-up settings were
      tight enough that it had to win races against the server's own
      timers. `bidTurnSec: 3` had to cover a challenge-rejection plus
      several raises inside ONE turn (only a *successful* raise re-arms the
      timer), and `reviewSec: 4` had to cover an ~8-round-trip
      flag/defend/finalize exchange that can never resolve early, because
      the test deliberately leaves item 3 in the non-terminal "ok" status.
      Raised to 6s/10s (~3x margin), bumped the dependent `waitFor`
      timeouts that were pinned at exactly one turn length, and lowered the
      in-file `globalTimeout` to 140s so it fires BEFORE run.mjs's 150s
      kill. Runtime 53s → 71s, measured over 3 runs each. Note plain CPU
      load does NOT reproduce the flake (Node still gets scheduled), so
      this was fixed by reading the timing structure, not by repro.
    - **PROJECT_CONTEXT.md reconciled** — it was stuck at 2026-07-14: no
      Codewords section at all, "all four games", the OLD auto-start rule
      ("20s at 2+ players, instant at max" — wrong since 2026-07-17),
      online Imposter described as typed-clues-only (it has a
      typed/spoken host setting), and trivia sets listed as "only the
      schema exists". Added §5.5 Codewords, the custom-sets rules, the
      messages layer, the two Supabase access patterns (client-direct+RLS
      vs service-role+in-code checks), the no-emoji/icon rule and design
      system, and the newer gotchas.
    - **Stale docstrings + README:** SetsPage/sets/api.ts no longer claim
      gameplay is "a later phase"; supabaseAdmin.ts now lists its three
      real callers instead of "no server-side DB access exists yet";
      README's auth section had the WRONG verification method (said HS256
      only, it's JWKS/ES256 with an HS256 fallback), plus "foundation
      only", "all three games", and a stale test description.
    - **Last emoji removed** from the UI path: Bid Battle's ballot label
      was `"🎲 Random category"` on the SERVER. Label is now plain text and
      the client draws `<Icon name="shuffle" />` off the existing
      `kind === "random"` field — server strings that reach the screen are
      subject to the no-emoji rule too.
    - `shared/index.ts` was missing `codewords.ts` and `social.ts`; nothing
      imports the barrel, but a half-populated one is a trap, so it's
      complete now.
    - Left alone deliberately: the `eslint-disable` comments in 5 files are
      inert (no ESLint config or dep in the repo). Removing them is churn
      and adding ESLint is a tooling decision for the owner — flagged, not
      taken.

29. **Chess (sixth game, 2026-07-31)** — standard chess in two modes behind
    `/chess`: Online (`/chess/online`, namespace `/chess`, on the shared room
    core) and pass-and-play (`/chess/local`, pure React, no sockets — same
    rule as Imposter's local mode, keep it that way).
    - **Libraries, not hand-rolled rules.** chess.js 1.4 is the ONLY legality
      authority on BOTH sides; react-chessboard 4.7 draws the board. Pinned to
      v4 on purpose: **v5 requires React 19 and this app is React 18** — npm
      refused the install, which is how the constraint surfaced. Sounds are
      synthesized with the Web Audio API rather than shipped as audio files
      (no binary assets, no licensing question, works offline).
    - **chess.js v1 `move()` THROWS on an illegal move** (v0 returned null) —
      every call site wraps it in try/catch. Also note `isDrawByFiftyMoves()`
      exists in 1.4, so the draw reasons can be told apart properly.
    - **Server owns legality, turn order, clocks, and results.** Clocks are
      banked ms + `turnStartedAt`; the server charges the mover, pays the
      increment, arms an EXACT flag timer, and re-broadcasts every 5s. The
      client ticks down from when an update ARRIVED (never from a shared wall
      clock), so client/server skew is a non-issue.
    - **Flag rule:** timeout is a DRAW if the opponent can't possibly mate.
      FIDE 6.9 is about POSSIBLE mate, not forced, so K+B and K+N draw but
      K+N+N is a loss. chess.js's own isInsufficientMaterial() asks about BOTH
      sides at once and is the wrong question — hence hasMatingMaterial().
    - Optimistic client position (piece moves instantly) that is ALWAYS
      discarded when the server speaks. Disconnect ≠ resign: the clock keeps
      running and they can rejoin; leaving ends the game. playAgain swaps
      colours.
    - **The three chess pages are lazy-loaded** (`React.lazy` in App.tsx) —
      the only lazy routes in the app. Without it the main bundle went
      609 kB → 806 kB and every Mind Meld player paid for chess.js; with it
      the main chunk is back to ~642 kB and chess is a separate ~147 kB chunk.
    - `baseMinutes` is deliberately FRACTIONAL on the wire (a local
      `clampFloat`, not the shared rounding `clamp`) so tests can flag a clock
      in 3 seconds instead of a minute. The UI only offers whole minutes.
    - Two test assertions I got wrong before the code: `Bxd1` really is legal
      in that promotion line (it takes the new queen), and `liveClocks()`
      already nets off elapsed time so a 3s clock reads 2999, not 3000. The
      failures were the test's fault both times, not the server's.

30. **Chess follow-ups: lazy-load hardening + board coordinates (2026-07-31)**
    — owner feedback after playing the committed version.
    - **Lazy loading.** Verified first that the split itself was working (no
      chess code in the main chunk), so the problems were robustness, not
      correctness. Fixed: all three chess routes now share ONE Suspense +
      error boundary via a react-router layout route with `<Outlet/>` (was
      three separate boundaries, which re-flashed a loading state when moving
      between chess pages); dynamic imports retry once and then do a single
      SESSION-GUARDED page reload, because content-hashed chunk URLs 404 for
      any tab left open across a redeploy and previously that dead-ended with
      no recovery; a real error boundary with a Reload button replaces the
      blank screen; and hovering/touching the Home card calls `preloadChess()`
      so the chunk is usually already fetched by the time the tap lands.
    - **A `manualChunks` entry was tried and REVERTED** — see the testing
      gotcha above. It produced a nicely named chunk but made Vite
      modulepreload it from index.html, i.e. every visitor downloaded chess on
      first load. The legible chunk name came instead from renaming
      `panels.tsx` → `chessPanels.tsx` (Rollup names the shared chunk after
      that module), which has no such side effect.
    - **Board coordinates.** react-chessboard's `showBoardNotation` paints
      each label in one of the two SQUARE colours by a parity rule, so on a
      themed board they sit at very low contrast on the square they occupy,
      and the corner square draws BOTH a rank and a file on top of each other.
      Now `showBoardNotation={false}` and we render ranks/files ourselves in
      gutters outside the board (`.chess-board-outer` grid), in `--muted`,
      orientation-aware, so they can never collide with a piece or blend into
      a square.

31. **First real browser pass — three UI bugs found and fixed (2026-08-01)**
    — the Claude-in-Chrome extension turned out to work all along (the old
    "not connectable" note was wrong; nothing was ever PAIRED). Drove the real
    built app on :3199 and played through every game. Three defects that the
    socket suite structurally cannot catch:
    - **The in-game chess screen wrapped.** The shared `.page` caps content at
      720px, but a board (~500px) plus the move-list panel (250px min) needs
      ~760px, so the panel wrapped under the board and pushed the controls
      off-screen. Added `.page.chess-playing { max-width: 1120px }` and put
      that class ONLY on the two in-game screens, so entry/setup/lobby keep the
      standard column width and no other game is touched.
    - **`.chess-toggle-field` inherited `flex-direction: column`** from the
      global `.field`, so the auto-flip label sat centred above its switch
      instead of beside it. Needed an explicit `flex-direction: row`. (Same
      family as the known global `input { width: 100% }` trap — assume `.field`
      fights you whenever you put controls on one row.)
    - **Captured-piece trays and material count were wrong after a
      promotion.** They inferred captures as start-count minus on-board-count,
      so a promoted pawn read as a LOST pawn: the opponent's tray sprouted a
      phantom captured pawn and the advantage number was understated. Now the
      tray comes from the MOVE LIST (`capturedBy`, exact and promotion-proof,
      and the server ships full history so it survives a rejoin) and the
      advantage sums the pieces actually ON the board. Verified by promoting
      to a queen and reading +16, which matches a hand count (47 vs 31).
    Everything else verified live: legal-move dots, castling, the promotion
    picker honouring Rook vs Queen, clocks switching and ticking, online
    lobby + join-link + ready sync + bidirectional move sync + board flip for
    Black + orientation-aware coordinates + resign showing "you win"/"you
    lose" on the right sides, a full 2-tab Mind Meld game to a win with stats
    credited, and every other game's pages rendering with ZERO console errors.

32. **Return-after-a-break health pass (2026-10-26)** — owner came back after
    ~3 months. Findings + fixes:
    - The owner's local checkout was 8 commits behind `origin/main` (all of
      sessions 25–31); fast-forwarded. The live site already matched origin.
    - **Security:** `npm audit` showed 8 production advisories (1 critical
      proxy-addr, highs in socket.io-parser/engine.io/body-parser, moderates
      in qs/express/react-router) + dev-only Vite/esbuild ones. `npm audit
      fix` cleared the in-range ones; react-router-dom 6 → 7.18 and vite 5 →
      6.4.5 cleared the rest. 0 vulnerabilities remain.
    - `engines.node` raised `>=18` → `>=20.12`: the server's
      `process.loadEnvFile` already required 20.12, and React Router 7
      requires 20.
    - Verified: typecheck + full suite (all 7 test files); the chess lazy
      split still holds (no modulepreload in index.html, no chess code in
      the main chunk, chess chunks fetched only on /chess*); headless-Chrome
      sweep of all 21 routes with zero console errors; a two-tab UI flow
      (SPA link navigation without reload, create private room, join via a
      `?room=` link, leave → the other tab drops the player).
    - Supabase project found PAUSED (see Current state) — owner action.
    - Doc drift fixed: "five titles" → six in this file, the CI comment, and
      PROJECT_CONTEXT.md's status line.

33. **Hotlap (2026-10-26)** — single-player precision time-trial racer, the
    owner's request (they asked for a 1:1 PolyTrack copy; declined, and an
    ORIGINAL game built around the qualities they named). Built with two
    background agents: one designed the 12-track campaign + tools/hotlap-
    tracks.ts, one built the verified leaderboard backend + tests.
    - Physics tuned by probe scripts, not feel alone: 0–100 km/h 2.7 s, top
      ~280 km/h, ~1.7 g braking, grip 1.2 g → 1.7 g with downforce. Lessons:
      tyre forces at the contact patch rolled the car at ~1 g (now applied
      88% of the way up to the CoM); mapping throttle to air pitch flipped
      cars mid-jump because players hold throttle (air now: nose slowly
      follows velocity + yaw-rate steering only); a damped bump stop stops
      big landings from bouncing; steering ramps over a FIXED 0.13 s at any
      speed so tapping a digital key gives fine, repeatable corrections.
    - Determinism verified three ways: Node runs repeat bit-identically; the
      browser's autopilot lap time equals Node's for the same bot (32.907 s,
      33.584 s); a browser-recorded replay posted to the server verified to
      the identical ms and took #1 on a local board.
    - Bot fixes from the track agent's notes: corners before a jump are
      always respected (the floor only lifts limits beyond the gap), whole-
      path re-localisation after respawn (was an endless respawn loop), and
      braking distance on boost pads doesn't count (it fell off Skywire).
    - Visual bugs caught only by screenshots: spiky mountains, an oversized
      sun, the start prompt covering the car, dark headlights, and support
      pillars of upper decks passing THROUGH the road below (now skipped
      where another road lies underneath).
    - Fixed a latent chess test race: the first gameStart snapshot nets off
      elapsed time, so it can read 179999 ms; the test now allows ≤2 s.
    - NOT pushed at time of writing (owner chose to playtest first); the
      hotlap_records migration is NOT
      applied (Supabase paused). Until it is, production picks the Supabase
      store and the leaderboard answers 503 (UI shows "unavailable"); local
      PBs, ghosts and medals still work.

34. **Hotlap playtest round 1 (2026-10-26)** — owner feedback: night too
    distracting, car heavy/unresponsive ("pull so hard to brake and turn"),
    camera shouldn't move with acceleration. SIM_VERSION 1 → 2.
    - Measured first (scratch probe): 1.4 g at 80 km/h, 300 ms steering
      response, 1.5 g brakes. Retuned to 0–100 in 1.9 s, ~3 g brakes,
      2.8–3.7 g grip, 25–120 ms steering response (lower yaw inertia,
      stiffer grip/suspension, faster steering ramp, more lock at speed).
    - Two real physics bugs surfaced by a tap test: (1) stiff lateral grip
      made yaw oscillate every substep (heading flat while angVel read
      0.08 rad/s) — fixed with a per-wheel effective-mass cap; (2) a slow
      phantom drift after any tap — fixed by the grounded yaw assist; drive/
      brake forces also now act on the centreline (differential-like).
    - Camera rewritten as a rigid chase cam (see the Hotlap rules).
    - All six themes repainted as daytime (morning/noon/golden/alpine/coast/
      bright overcast): mown ground, clouds, snow-capped ridges, white
      barriers with coloured rails, concrete undersides; no headlights or
      underglow; exhaust glow only on boost pads.
    - Bot retuned to the new grip; medals recalibrated (laps ~15–20% faster).

35. **Hotlap playtest round 2 (2026-10-27)** — owner: car too chunky (wants a
    simple F1-style car with visible wheel contact + brake lights), steering
    too responsive at high speed, turns weird under braking, and "make the
    driving as close to PolyTrack as possible" using Claude in Chrome.
    - Claude in Chrome CAN'T hold keys (the `key` action only taps; synthetic
      JS KeyboardEvents are ignored by PolyTrack), so driving it for
      measurements was impossible. Instead: PolyTrack's leaderboard →
      select a run → Watch → its "Graphs" panel plots speed vs time, and
      the replay shows inputs + speedometer. Digitised the #1 Summer 1 run
      (launch 0→217 km/h in 3.5 s, linear; ~10 m/s² at 330 km/h; ~2–2.5 g
      braking) and studied corner frames (controlled slides, camera follows
      travel direction, partial roll on steep banks). Top runs use wall-
      riding tricks — don't tune to those.
    - SIM 2 → 4. Found that the yaw assist rotated the car at ~4 g while
      braking (it ignored grip already spent): now capped by the remaining
      friction budget. Grip fades 30% by 92 m/s; downforce cut. Engine
      reshaped (flat to 50 m/s, taper to 130). Controlled slide added and
      made self-limiting (first attempt spun out — slip grew to 33°).
    - Bot: crest-speed planning (the faster car launched over humps on
      Skywire/Last Light), no braking credit in the air, takeoff cap before
      jumps followed by corners, retuned grip. All 12 tracks pass both bots.
    - New open-wheel car mesh + brake lights; higher sun on low-sun themes
      so the shadow sits under the car.

36. **Hotlap playtest round 3 (2026-10-27)** — owner: "much better", but
    brakes too weak vs PolyTrack, too much skidding at speed, too much
    airtime, and NO steering in the air ("wheels can turn, but it shouldn't
    move the car"). SIM 4 → 5.
    - Friction is now an ELLIPSE with separate limits: cornering (`mu`,
      fades with speed, rear loosens slightly in a slide) and braking/
      traction (`muLong`, never fades). Brakes ~3.85 g at any speed (150→0
      in 23 m; was 39 m). The yaw-assist budget uses the cornering grip
      left after braking (`latAvail`).
    - Slide cut way back: ~5–6° at full lock (rearSlide 0.08, maxSlip
      0.14, slideLead 1.1); cornering a steady ~2.05 g.
    - Gravity 11.5 → 15.5 m/s² (less floaty); `mu` rebalanced to 1.42 so
      cornering g stays the same (grip scales with load = gravity).
    - Air: steering input does NOTHING to the car (wheels still turn). Only
      a passive nose-toward-travel alignment and roll levelling remain.
    - Bot: crest planning now reads CAR.gravity (was hard-coded 11.5 — would
      have silently mis-planned); brake planning raised for the new brakes.

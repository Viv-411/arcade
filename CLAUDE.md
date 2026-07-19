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

A real-time multiplayer web arcade for party games, playable in the browser. Five
games are live: **Mind Meld** 🧠 (2–4 players converge on the same word),
**Speed Trivia** ⚡ (2–10 players race through multiple-choice questions),
**Bid Battle** 💰 (team category-naming auction, exactly 1v1 or 2v2),
**Imposter** 🕵️ (social deduction, 3–10 players online PLUS a fully client-side
pass-and-play mode), and **Codewords** 🗝️ (two-team word-association deduction on
a 5×5 grid, with a Remote mode and a Shared Board + QR-spymaster-phones mode).
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
  member's last_read_at.
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
a 10-player trivia game (11th join rejected; Mind Meld still capped at 4),
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

- FIVE games live; deployed at https://arcade-1628.onrender.com (Render free
  tier; owner-managed; a keep-alive GitHub workflow pings it). Local `.env`
  (gitignored) holds the owner's real Supabase keys — client env is baked at
  build time, server env read at runtime; Render has the same five vars set.
- Supabase schema fully applied (profiles+trigger, trivia_sets/questions,
  player_stats+record_game_result, friendships, chats/chat_members/
  chat_messages). Migrations go to the hosted DB via
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
- git: single `main`, remote origin = https://github.com/Viv-411/arcade, CI
  green. The owner also maintains PROJECT_CONTEXT.md (their doc — keep in sync
  when convenient but CLAUDE.md is the contributor source of truth).
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

- Singleplayer section on Home has two placeholder cards: Solo Trivia
  (client-side scoring — must never feed competitive leaderboards) and Daily
  Challenge. Solo trivia should reuse the trivia question card as shared
  PRESENTATIONAL components (see README note), driven by a local controller.
- Trivia-set posting UI (schema already live: trivia_sets/questions + RLS).
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

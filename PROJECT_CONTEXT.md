# Arcade — Project Context

> **What this file is:** the single source of truth about this project for Claude in
> **Cowork** (and as a shared reference alongside the repo's `CLAUDE.md`, which is the
> lean, code-facing guide read on every Claude Code session). Where `CLAUDE.md` covers
> commands, architecture seams, and per-commit history, this file explains the *why* —
> the design decisions, product intent, and non-negotiable rules behind the code.
>
> **Status:** Reconciled against the live codebase on 2026-07-31 (commit `f25c7e4`,
> all **five** games merged, custom trivia sets shipped end to end). The previous
> reconciliation (2026-07-14, `412e364`) predated Codewords, the messages layer, the
> UI/icon passes, and the trivia-sets feature. Coding continues in Claude Code
> against `CLAUDE.md`; research, docs, dashboard work, and context upkeep run
> through Cowork.
>
> **Update 2026-10-26:** a **sixth** game, **Chess** (online with server-owned clocks +
> pass-and-play), shipped 2026-07-31 after this reconciliation; it has no section here
> yet — `CLAUDE.md` (rules + gotchas) and `README.md` (player rules) cover it. Deps were
> refreshed the same day (React Router 7, Vite 6.4, Node ≥20.12; 0 audit findings), and
> the hosted Supabase project was found paused (free-tier idle pause; owner restores it
> from the dashboard).
>
> **Update 2026-10-26 (later):** **Hotlap** shipped — a single-player, ORIGINAL precision
> time-trial racer (12 tracks, deterministic shared physics, millisecond timing, ghosts,
> server-verified leaderboards). The owner had asked for a 1:1 copy of PolyTrack; that was
> declined and Hotlap was built around the qualities they wanted instead. See `CLAUDE.md`
> (rules, especially the determinism rule) and `README.md` (player rules).

---

## 1. What this is

A web-based multiplayer party-game **arcade** — a home page with a grid of games, each
game its own module. Real-time multiplayer with public matchmaking and private rooms,
plus (for some games) a local pass-and-play mode. User accounts are optional; users
can build their own trivia sets (Kahoot/Blooket-style) and play them.

- **Repo:** github.com/Viv-411/arcade (branch `main`, remote `origin`).
- **Owner:** Vivek (github `Viv-411`).
- **Live deploy:** https://arcade-1628.onrender.com (Render free tier — sleeps when
  idle; a scheduled GitHub Actions job pings `/healthz` every 5 min to keep it warm).
  Render deploys are owner-managed.
- **Games live (all 5 merged & tested):** Mind Meld 🧠, Speed Trivia ⚡,
  Bid Battle 💰, Imposter 🕵️ (online + pass-and-play), Codewords 🗝️ (remote +
  shared-board modes).
- **Singleplayer:** Imposter pass-and-play and Solo Trivia (`/solo/trivia`) are live;
  a Daily Challenge card remains a placeholder.

> Note on emoji: the game emoji above are documentation shorthand. **The UI itself
> contains no emoji** — every glyph in the client is a pixel-art icon (see §9).

## 2. Tech stack

- **Frontend:** React 18 + Vite 5 + TypeScript, React Router 6. Mobile-first,
  high-contrast, playful arcade aesthetic.
- **Backend:** Node (≥18; developed on 24) + Express 4 + Socket.IO 4 (TypeScript).
  One long-lived stateful process.
- **Shared:** a `/shared` module of event names and types imported by both client and
  server (single source of truth per game: `types.ts`/`events.ts` = Mind Meld,
  `trivia.ts`, `bidbattle.ts`, `imposter.ts`/`imposterWords.ts`, `codewords.ts`,
  `social.ts`, `normalize.ts`, plus the hand-written `database.types.ts`).
- **Auth + DB:** Supabase (Postgres + Auth). Client `@supabase/supabase-js`; server
  verifies JWTs with **`jose`** (see §6).
- **Stats:** `better-sqlite3` for local win stats (`data/stats.db`, gitignored);
  durable per-account stats also written to Supabase.
- **State:** live game/room state is held **in memory** on the server, isolated behind
  a `RoomStore` interface (in-memory `Map` impl) so it could move to Redis later.
- **Structure:** monorepo — `/client`, `/server`, `/shared`, `/supabase` (migrations),
  `/tests`. One `package.json` at root; run all npm scripts from the repo root.
- **One deployable service:** in production the Express server serves the built client
  AND handles Socket.IO on the same port; dev runs Vite (:5173) + server (:3001)
  separately with a proxy.

## 3. Deployment — IMPORTANT

- Deploy the server to **Render, Railway, or Fly.io** — a single long-lived stateful
  instance. A `render.yaml` blueprint is committed; the owner has deployed to Render.
- **Do NOT deploy to Vercel.** Serverless functions are short-lived and stateless; the
  in-memory rooms and Socket.IO connections won't survive.
- Known tradeoff: **in-memory state is lost on server restart** (live games drop).
  Acceptable for a hobby project; Redis is the future fix. Single-instance only unless
  a Redis adapter is added.
- **`VITE_*` env vars are build-time.** If they're missing at build, the deployed site
  shows "accounts not configured" even if the server has them. Set them on the host
  before building.

## 4. Multiplayer foundation (shared across games)

All games reuse one game-agnostic layer (`server/src/core/roomManager.ts` —
`BaseRoomManager`; `client/src/core/useRoomCore.ts`). Each game is its own module: **its
own client route and its own Socket.IO namespace** (`/mindmeld`, `/trivia`,
`/bidbattle`, `/imposter`, `/codewords`). Adding a game = subclass `BaseRoomManager`,
register in
`server/src/index.ts`, add shared types/events, add a client route + page + a
`useRoomCore`-based hook, and a card on Home. **Don't fork the shared
lobby/matchmaking/reconnection logic per game** — game-specific behavior goes in the
game's own module, shared behavior stays in `core/`.

Shared systems:
- **Rooms & lobby:** private rooms via a short shareable code (4 letters, no I/O) or
  link; ready toggles; host controls.
- **Auto-start (changed 2026-07-17 — the old "20s at 2+ players" rule is GONE):** a
  public lobby auto-starts **only when it is completely full**, and even then after a
  15s countdown that anyone leaving cancels (all players must be connected when it
  fires; a rejoin re-arms it). Partially filled lobbies **never** auto-start — the
  host starts manually once everyone is ready.
- **Matchmaking:** Quick Play joins the oldest open public room or creates one; games
  can filter the pool via `quickPlayEligible` / `quickPlayCreateSettings` (e.g. Bid
  Battle's per-mode 1v1/2v2 pools, Codewords' remote-only pool).
- **Reconnection:** player identity is per **browser tab**, stored in
  **`sessionStorage`** — **NOT `localStorage`** (this is a hard rule: it lets two tabs
  on one machine act as two players, which is how the games are tested). A refresh must
  not end a player's game; on rejoin the server sends full current state. Identify
  players by their session, never by socket id. Lobby disconnect has a 30s grace;
  empty rooms are GC'd after 5 min.
- **Host handling:** host reassignment if the host leaves; empty room closes.

**Non-negotiable:** the **server is authoritative** for all timing, validity, scoring,
and secret information. Clients render optimistically but never decide outcomes.

## 5. Game rules (design-authoritative)

### 5.1 Mind Meld — 2–4 players
Players secretly submit one word per round simultaneously; reveal with attribution.
Goal: everyone converges on the same word.
- **No-repeat rule (core engine):** any word said by anyone in any prior round can never
  be reused. Enforced at lock-in with inline feedback; used words shown each round.
- **Normalization (strict, shipped):** `shared/normalize.ts` — lowercase, trim, collapse
  whitespace, strip surrounding punctuation; the normalized form is shown back. Used for
  BOTH win-detection and the no-repeat check (they must stay identical).
- **Round:** all connected players lock in → instant reveal (a 60s timer is only a
  backstop). Fast-path: the round resolves as soon as all *connected* players are locked.
  Win if all active players' normalized words match. Else words join the used set; ~5s
  pause; next round.
- **AFK:** miss 2 consecutive rounds (`afkMissLimit`) → removed. Below 2 players, game
  ends.

### 5.2 Speed Trivia — 2–10 players
Vote a category, then answer multiple-choice questions; score by speed + correctness.
- **Question source:** Open Trivia DB (opentdb.com) — free, no key — behind a swappable
  `QuestionSource` adapter (`server/src/trivia/questionSource.ts`). **Do not** generate
  trivia questions with an LLM (hallucinated answers are fatal).
- **OpenTDB constraints handled:** ~1 request / 5s rate limit → all calls go through a
  serialized throttle and each game does **ONE batched fetch** after the category vote
  (never per-question); category list + session token are pre-warmed at startup; session
  token avoids repeats; questions requested base64 and decoded server-side; HTML-entity
  decode category names; `response_code 1` fallback chain (same category any difficulty →
  General Knowledge → built-in question set so games start even offline). A 10-min
  per-category+difficulty cache serves concurrent same-category rooms instantly (repeat
  questions across different rooms is an accepted tradeoff).
- **Format:** multiple choice (fast + unambiguous under a timer).
- **Difficulty:** host-only room setting; OpenTDB's labels are inconsistent — a tuning
  dial, not a guarantee.
- **Scoring:** correct = `round(1000 × factor)` where factor decays linearly 1.0 → 0.5
  across the question timer; wrong/no answer = 0. Ties share the win.
- **AFK:** trivia **NO AFK-removal by design.** A missed answer scores 0 and play
  continues; disconnected players resume with their score. The game ends early only when
  <2 players remain connected (checked at question resolve, so refreshes can't kill a
  game) or <2 remain in the room.
- **Custom sets (shipped 2026-07-19/20):** in a **PRIVATE** lobby the host may swap
  OpenTDB for one of their own / shared-with-them question sets. Picking one **skips
  the category vote** entirely (`voting` becomes a brief load screen) and hides the
  difficulty selector. Public/quick-play rooms reject the pick server-side and drop
  any stale one. A set shorter than `questionsPerGame` shortens the game; a longer one
  contributes a RANDOM subset. Question order is always shuffled and each question's
  options are reshuffled server-side with the correct index recomputed. Everything
  downstream of `game.questions` is the untouched engine. See §6 for the authorization
  model, which is the subtle part.

### 5.3 Bid Battle — exactly 2 (1v1) or 4 (2v2) players
Team-based category-naming auction. First team to `targetPoints` (default 3, clamped
1–10). Teams are a layer on this game's own player type ONLY (other games stay
free-for-all); per-team visibility uses socket.io rooms `${code}#A` / `${code}#B`.
- **Entry:** player picks mode (1v1/2v2) **before** Quick Play / Create Private / Join by
  Code. Per-mode quick-play pools; **no partial-lobby countdown** (needs the exact count).
- **Categories:** Quick Play = random from a curated server-side deck
  (`bidbattle/categories.ts`). Private = a ballot before each round: always a "Random"
  option; any player may submit custom categories (live to all); each player casts one
  vote; a custom category wins only with **unanimous (1v1) / 3 votes (2v2)** approval,
  else Random.
- **Bidding:** turn-based, alternating teams, 10s per turn. **Raise** (strictly higher
  integer) or **Challenge / "make them name it"** (ends bidding; the last/highest bidder
  must deliver). **Bid timeout = auto-decline-to-raise** → the other team wins the bid
  (does NOT lose the round). Opening edge case: opener timeout passes the opening once; a
  second timeout with no bid redraws the category with no point.
- **Delivery:** the delivering team has 60s to name ≥ bid valid, non-duplicate items into
  a shared live list. Counting and exact-duplicate detection are automatic (same
  normalization as Mind Meld). **BOTH teams see every accepted item live** during
  delivery (owner request 2026-07-05; originally opponents saw count only).
- **Review (honor system, no LLM):** opposing team flags items as invalid or semantic
  duplicates. Delivering team concedes or defends; for defended items the opposing team
  accepts or upholds (item drops). Honor-system resolution: unflagged counts,
  un-defended flags drop, un-finalized defenses count. Final valid count ≥ bid →
  delivering team scores; else challenging team scores.
- **Forfeit:** leaving mid-match forfeits for the leaver's team; **disconnecting does
  NOT** (timers keep the match moving — a silent bid turn counts as declining).
- Honest limitation: honor review is exploitable among strangers; best in private
  lobbies. Semantic duplicates and validity can't be auto-refereed cheaply (no LLM
  referee — deliberately, to avoid API cost).

### 5.4 Imposter — social deduction
Two modes behind `/imposter`.
- **Pass-and-play (`/imposter/local`):** **pure client-side React, no server, no
  accounts** — keep it that way. Setup: # players (≥3), # imposters (1..players−1,
  default 1), category, hints on/off. Tap a name to privately reveal word or imposter
  card; random starter; play out loud; "Reveal results" shows all roles + word.
- **Online (`/imposter-online`, namespace `/imposter`):** 3–10 players on the shared room
  core. Clue input is a **host setting: typed (default) or spoken** — in spoken mode
  players say the clue out loud and the speaker (or host) advances the turn. Note the
  route/namespace mismatch is deliberate (`gameKey` overridden after `super()`;
  `GAME_PATHS` in `shared/social.ts` maps invite links).
- **Role secrecy (server-authoritative, CRITICAL):** the server sends each socket ONLY
  its own card; the secret word / all roles / winners are included in a snapshot ONLY
  when `state === "finished"`. A test sweeps every mid-game update to enforce this — keep
  it passing. The crew-can't-say-the-word check is deliberately NOT applied to imposters
  (rejection would confirm their guess).
- **Hints:** toggle. On → imposter also sees the category (never the word). Off →
  imposter sees only "You are the Imposter."
- **Online flow:** private role reveal → clue rounds (turn timers, auto-skip) →
  continue-or-vote group decision (capped rounds then forced) → secret accusation vote
  (tie → one runoff → no-elimination; forced-final deadlock = imposters win) → optional
  word-steal (last caught imposter guesses the word to flip the win) → parity win check →
  cycles. The round-cap counter resets each elimination cycle.
- **Word bank:** built-in curated `shared/imposterWords.ts` (10 categories × 25+). Future:
  user-uploaded category packs could reuse the accounts/DB.

### 5.5 Codewords — two-team word deduction (shipped 2026-07-18)
A 5×5 grid of 25 word cards over a hidden key: 9 agents for the starting team, 8 for the
second, 7 bystanders, 1 assassin. Spymasters give one-word clues; operatives guess.
- **ONE shared key.** Both spymasters see the **same complete key** — there is no
  per-team key. The only secrecy boundary is **spymasters vs operatives**: the key
  travels via the private `yourKey` event and `rejoinExtra`; snapshots carry a card's
  identity only once it is revealed, and `fullKey` only when `state === "finished"`.
  A test sweeps operative AND shared-board updates to enforce this — keep it passing.
- **Two modes in ONE namespace** (`/codewords`, selected by `settings.mode`):
  - **Remote** (4–10 players, own devices): a guess is a **majority vote of the team's
    CONNECTED operatives**; tapping your current vote takes it back; passing also needs
    a majority *and* at least one guess already made.
  - **Shared board** (exactly 3 room seats: the board device + 2 spymaster phones):
    phones join by scanning a **per-team QR token** (the token identifies the phone's
    TEAM only — both phones still get the same key). Normal `joinRoom` is blocked via
    the `joinBlocked` hook. The board device taps to reveal and can log spoken clues as
    number-only. The board leaving closes the room.
- **Clue validation:** a single token, no substring overlap in either direction with any
  unrevealed board word; number 0–9 or "unlimited" (0 and ∞ both mean uncapped).
- **Guess cap = EXACTLY the clue's number — no +1 bonus** (owner rule, 2026-07-19).
- **Untimed by design** — no turn timers anywhere; turns wait for humans.
- **Stats:** remote games record account stats; **board-mode games record none** (a
  screen and two convenience phones aren't real per-person seats).
- **IP rule:** the ~380-word bank (`server/src/codewords/wordBank.ts`) is ORIGINAL and
  self-authored, structured as data packs. **Never copy or imitate a published
  Codenames word list, and never use the "Codenames" trademark in the UI.**

## 6. Auth & database (Supabase) — optional, never required

- **Accounts are optional (non-negotiable).** A logged-in user is an anonymous player who
  additionally has an account. All games remain fully playable anonymously and everything
  works with **zero Supabase config** (client exports a NULL Supabase client when env is
  unset). Login is a small corner button; a reusable `requireAuth()` gate exists for
  FUTURE gated actions — **nothing is gated today; don't gate existing features.**
- **Login methods:** email/password + Google OAuth.
- **Token verification (server, `server/src/auth.ts`):** uses **`jose`** (not
  `jsonwebtoken`, not `getUser`). New Supabase projects sign **ES256** — verified via the
  project's public JWKS endpoint (`SUPABASE_URL/auth/v1/.well-known/jwks.json`); legacy
  projects fall back to an **HS256** `SUPABASE_JWT_SECRET`. Auth is always optional —
  middleware attaches `req.userId` on `/api/*` and `socket.data.userId` via a
  per-namespace handshake, and **never rejects**. `server/src/supabaseAdmin.ts` is the
  only sanctioned service-role entry point (returns null when unconfigured).
- **Env var names (verified — see `.env.example`):**
  - Client (bundled by Vite, public): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
    `VITE_APP_BASE_URL`.
  - Server (secret): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`
    (legacy-only; leave unset on new asymmetric-key projects). Plus `PORT` (default 3001),
    `STATS_DB` (default `data/stats.db`).
  - Keys use the new `sb_publishable_...` / `sb_secret_...` format (legacy anon /
    service_role JWTs also work). Never commit `.env`; secret keys are server-only.
- **Schema (`supabase/migrations/`, RLS on every table; `shared/database.types.ts` is
  HAND-WRITTEN to match — regenerate with `npm run db:types` against a running local
  stack after schema changes):**
  - `profiles` (id → auth.users, unique username, display_name) — auto-created by a signup
    trigger; a backfill migration covers pre-trigger users.
  - `trivia_sets` (owner_id, title, description, category, `visibility`
    private|unlisted|public default private, `is_removed` for future moderation).
  - `questions` (set_id cascade, position, question_text, options jsonb, correct_index,
    `source_set_id` = copy provenance only).
  - `trivia_set_shares` (set_id, shared_with, shared_by; unique per pair) — sharing
    grants READ to specific friends **without** changing `visibility`.
  - `player_stats` (owner-only select; writes only via the service-role-only
    `record_game_result` function — clients are denied, 42501).
  - `friendships` (one row per pair, unique least/greatest index; RLS = participants only,
    addressee-only accept).
  - `chats` / `chat_members` / `chat_messages` — **deny-all RLS (no policies at all)**:
    server-only tables, reachable exclusively through the service role after
    `SocialManager` validates friendship/membership/capacity.
- **Two deliberate access patterns — know which one you're in:**
  1. **Client-direct + RLS as the authority:** friendships, trivia sets, sharing, and
     solo play. No service-role path exists for these.
  2. **Server-mediated + service role:** chats, stats, and multiplayer custom-set
     loading. The service role **bypasses RLS**, so each of these callers
     **re-implements the access rule in code**. Concretely: a host picks a set for a
     private lobby, but the other players may have no access of their own — so
     `server/src/trivia/customSets.ts` checks owner-or-share explicitly, at pick time
     AND again against the CURRENT host at game start, falling back to a category vote
     on any failure. If you change the RLS rule, change that code to match.
- **RLS is the top Supabase failure mode.** After any schema change, manually test: as
  user A you cannot read/modify user B's private rows, and the anon key cannot read
  private data or write anything. This full checklist has been live-verified.
- **ALWAYS QUALIFY column names in RLS policy subqueries.** A real bug shipped here:
  `where sh.set_id = id` bound the unqualified `id` to the *inner* relation, so shared
  reads silently returned nothing. It must be `sh.set_id = trivia_sets.id`
  (migration `20260719000001` is the fix).

## 7. Friends & social layer (built, live-verified)

- `friendships` table managed directly from the client via supabase-js (add by username /
  invite link / QR via the `qrcode` package on `/friends`).
- `/social` Socket.IO namespace (`server/src/social/manager.ts`) for presence + lobby
  invites, validated server-side (service-role friendship lookup, room-membership +
  lobby-state checks, 10s per-friend invite cooldown). A presence registry
  (`server/src/core/presence.ts`) is fed by the room core on join/rejoin/removal.
- Client: `SocialContext` (friends via RLS queries + 45s poll, invites via socket),
  corner `NotificationBell`, `FriendsPage`, and an `InviteFriends` panel in every
  game lobby.
- Gotcha: the invite endpoint checks room membership BEFORE friendship, so a non-member
  non-friend gets the membership error first.

**Messages (added 2026-07-16, roster management 2026-07-19):**
- **Friend DMs** (accepted friends only, one conversation per friendship) and **group
  chats** (creator + 1–9 of the creator's accepted friends, 10 members max).
- **Group roster rules:** the **creator** adds people (and adds must be the CREATOR's
  accepted friends) and is the only one who can delete the group; **any member may
  leave**, and the last member out deletes the chat row. A creator who leaves can no
  longer add or delete — the group is **orphaned by design**. `leaveGroup` never
  applies to DMs.
- **Chat-based lobby invites replaced direct invites.** One tap posts an invite card
  into a DM or group, where it persists even if the recipient is offline; online
  members also get the live bell notification. **Capacity rule:** a group invite is
  allowed only when every other member could fit the lobby's open seats (Codewords
  shared-board rooms count as 0 open seats).
- Unread = the last message is newer than that member's `last_read_at`.

## 8. Roadmap / in progress

**Done (was the headline roadmap item):**
- **User-created trivia sets** shipped end to end — set builder + friend sharing +
  copy-based composition at `/sets` (2026-07-19), then gameplay (2026-07-20): private
  Speed Trivia lobbies (§5.2) and **solo practice** at `/solo/trivia?set=ID`. Solo
  scores client-side and is **practice only — NOT cheat-proof**, so it never feeds
  account stats or any leaderboard. Keep it that way unless scoring moves server-side.

**Still open:**
- **Public set gallery** (browse/search) — the `visibility` enum already supports
  `unlisted`/`public`, but no gallery UI exists and sets are private by default.
- **Content moderation (do not skip):** required *before* strangers can publish sets.
  Schema already carries `visibility` and `is_removed`. Minimum: report button +
  takedown. Sharing today is friend-to-friend only, which is why this hasn't bitten.
- **Daily Challenge** — the last placeholder card on Home's Singleplayer row.
- **User-uploaded Imposter category packs** could reuse the accounts DB the same way
  trivia sets do.
- **Redis** for room state, if single-instance/restart-loses-games ever stops being
  acceptable (see §3).

## 9. Key conventions & non-negotiable rules

- Server authoritative for all timing, validity, scoring, and secrets.
- Never send secret info to clients that shouldn't have it: trivia correct answers
  pre-reveal, imposter's word / others' roles pre-reveal.
- Accounts optional; anonymous play never blocked; everything works with zero Supabase
  config.
- Player identity is per-tab in **`sessionStorage`**, never `localStorage` (two tabs =
  two players).
- Each new game = its own client route + its own Socket.IO namespace; reuse the shared
  lobby/matchmaking/reconnection layer. Don't renumber or re-route existing games when
  adding a new one.
- Client refuses to emit socket events while disconnected (buffered emits were silently
  dropped on reconnect before rejoin rebound the session).
- Same normalization everywhere for word matching.
- Do not deploy to Vercel (see §3).
- **No emoji in the UI.** Every glyph is a pixel-art icon from `pixelarticons` (MIT),
  rendered through `client/src/components/Icon.tsx` (raw SVG inlined, 1em,
  `fill: currentColor`). Need a new glyph? Add it to `Icon.tsx` — don't reach for an
  emoji. This applies to server-authored strings that end up on screen too.
- **Design system to preserve:** body face "Space Grotesk" with the arcade display face
  used sparingly; a fixed CRT overlay (`body::before` scanlines + `body::after`
  vignette, ~2.4% alpha) is the site signature; **glow is a budget** — reserved for the
  title, the room-code box, `.btn.primary`, and per-game card hovers. Each game claims
  an accent class (`.accent-pink` mindmeld / `-yellow` trivia / `-green` imposter /
  `-cyan` bidbattle / `-red` codewords) — a new game should claim one. A
  `prefers-reduced-motion` kill-switch disables all animation.
- **No Claude / AI attribution in commit messages** (owner requirement — sole
  authorship). Keep `CLAUDE.md`'s "Current state" + "Session history" updated in the same
  commit as the change.
- Verify before committing: `npm run typecheck && npm test` (all six titles must pass
  over real sockets).

## 10. Known gotchas

- **OpenTDB rate limit** (~1 req/5s) → one batched fetch per game, never per question.
- **In-memory state** lost on server restart; single-instance only until Redis.
- **RLS** off or misconfigured silently exposes data — always test manually.
- **Google OAuth `redirect_uri_mismatch`** is almost always a mismatch between Google's
  Authorized redirect URI and the Supabase callback URL — copy it exactly. While the
  Google consent screen is in testing, only whitelisted test users can log in.
- **Imposter balance:** too many imposters relative to players is unwinnable for crew;
  the round cap and imposter count tune together.
- **Test listener ordering:** register `waitFor(event)` listeners BEFORE triggering the
  action; back-to-back server events (e.g. consecutive clue turns) outrun re-registered
  listeners — use the queueing collector pattern in `tests/imposter.test.mjs`.
- **Core `toggleReady` / `startGame` take NO ack callback** — awaiting an ack on them
  in a test or harness hangs forever.
- **PostgREST embeds must name the relationship when a table has >1 FK to the target.**
  `questions` has two FKs into `trivia_sets` (`set_id` and `source_set_id`), so a bare
  `questions(count)` became ambiguous the moment `source_set_id` landed and `/sets`
  stopped loading. Always write `questions!questions_set_id_fkey(count)`.
- **Global `input, select { width: 100% }`** in `styles.css` will wreck any input placed
  in a flex row — pin explicit widths (this ate the Codewords clue row once).
- Long-running dev servers started from an agent session get killed by cleanup — start
  detached (`nohup ... & disown`).
- **`tests/bidbattle.test.mjs` is timing-sensitive** and has flaked at random points
  under machine load; it reproduces on unmodified `main`, so treat a lone bidbattle
  failure as suspect-the-test before suspecting a regression — but re-run to confirm.

## 11. External services & manual-only steps (human required)

These involve credentials/consent — an agent must NOT enter passwords, paste secret keys,
grant OAuth consent, create accounts, or make purchases:
- **Supabase dashboard:** create project; copy Project URL + publishable + secret keys;
  enable/verify RLS; auth settings; configure Google provider; set Site URL + allowed
  redirect URLs. (Owner also holds the DB password for the IPv4 pooler used to push
  migrations — not stored in the repo.)
- **Google Cloud Console:** consent screen (External) + test users; Web OAuth Client with
  the Supabase callback as Authorized redirect URI; copy Client ID/Secret.
- **Deploy host (Render):** set env vars; deploy. Owner-managed; no Render credentials in
  the agent environment.

## 12. How to work on this

- **Claude Code (coding):** the lean repo `CLAUDE.md` is read every session — commands,
  architecture seams, per-commit history, and the update-before-commit rule. It is the
  authority for *how the code is built*; this file is the authority for *why*.
- **Cowork (research, docs, dashboards, context upkeep) — the current phase:** use this
  file as the project brief. Cowork can research, read/summarize dashboard state, draft
  SQL/policies/checklists, and generate reports — but the credential/consent steps in §11
  stay with the human. Git in the Cowork sandbox has no GitHub credentials, so pushes are
  run by the owner (or from a credentialed local shell).

## Keeping this file accurate

When code changes materially, ask Claude to reconcile this file against the actual repo:
> "Read the current codebase and update PROJECT_CONTEXT.md to match reality. Correct real
> folder structure, dependencies, env-var names, which games are merged and working, and
> any rule that no longer matches the code. Keep it concise; flag anything you're unsure
> about rather than guessing."

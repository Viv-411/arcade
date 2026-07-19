# 🕹 Arcade

A real-time multiplayer web arcade for party games: **Mind Meld** 🧠,
**Speed Trivia** ⚡, **Bid Battle** 💰, **Imposter** 🕵️, and **Codewords** 🗝️.

## How it works

One Node process does everything: an Express server serves the built React client as
static files and hosts Socket.IO on the same port. All game state lives **in memory**
on the server; every game gets its own Socket.IO namespace (`/mindmeld`, `/trivia`)
and its own client route, so adding a new game means adding one namespace module on
the server and one route/module on the client — the home page is a grid of game cards.

**Shared multiplayer infrastructure** (used by both games, not duplicated):

- Server: `server/src/core/roomManager.ts` — a game-agnostic base class with room
  creation + 4-letter codes, join by code, Quick Play matchmaking, ready toggles,
  host start validation, public-room auto-start countdowns, rejoin/reconnection,
  lobby disconnect grace periods, host reassignment, empty-room GC, and playAgain.
  Each game subclasses it with only its own state machine.
- Client: `client/src/core/useRoomCore.ts` — the matching client half (per-tab
  identity, silent rejoin after refresh/reconnect, lobby actions, toasts), plus the
  shared `GameEntry` and `GameLobby` components.

```
/shared   TypeScript types + Socket.IO event contracts for each game, plus the
          Mind Meld word normalization (imported by BOTH client and server)
/server   Node + Express + Socket.IO. Shared infra in server/src/core/; game logic
          in server/src/mindmeld/ and server/src/trivia/; all room state access
          goes through server/src/store.ts (RoomStore interface) so it could later
          be swapped for Redis.
/client   React + Vite + TypeScript SPA (shared infra in client/src/core/ and
          client/src/components/)
```

Per-player win stats are persisted to a local SQLite file (`data/stats.db`) via
better-sqlite3. If the native module fails to install, stats silently degrade to a
no-op — the game itself never touches the database.

UI iconography is the [pixelarticons](https://pixelarticons.com) set (MIT),
inlined through `client/src/components/Icon.tsx` so every glyph shares one
pixel-art language and inherits the app's colors; display type is Press Start 2P
with Space Grotesk for body text (both via Google Fonts).

## Mind Meld — the rules

- **2–4 players.** Everyone secretly submits one word per round, simultaneously.
- **Round 1:** submit any random word. All words are revealed with attribution.
- **Every later round:** try to submit a word that bridges the revealed words, aiming
  for everyone to land on the **same** word.
- **No repeats:** any word already submitted by anyone in any prior round is dead
  forever. The server rejects it at lock-in; the client also live-warns while typing.
  The full dead-word list is always visible.
- **You win** the moment every active player (2+) submits the same word in one round.
  The winning word and round count are shown.
- **Word matching:** words are normalized — lowercased, trimmed, internal whitespace
  collapsed, surrounding punctuation stripped — and match iff their normalized forms
  are equal. The same normalization is used for win detection and the no-repeat rule,
  and the normalized form is shown to you as you type. A room setting `matchMode:
  "loose"` additionally treats simple trailing-s plurals as equal (`cats` = `cat`);
  the default is `"strict"`.
- **Timers & AFK:** rounds last 60s (configurable). If everyone locks in early the
  round resolves immediately. Miss 2 rounds in a row (configurable) and you're removed.
  Games cap at 20 rounds by default (0 = unlimited).

### Lobbies

- **Create private room** → 4-letter code (no ambiguous I/O) + shareable link
  (`/mindmeld?room=CODE`).
- **Join with code**, or **Quick Play**: joins the oldest public lobby with space, or
  creates a new public room. Public rooms auto-start ONLY once they are completely
  full, after a 15s countdown (cancelled if someone leaves); otherwise the host
  starts manually when everyone is ready.
- Refreshing the page **does not** end your game: your player id is kept per-tab and
  the client silently rejoins on reconnect. Disconnected players are marked in the UI;
  their missed rounds still count toward AFK removal.

## Speed Trivia — the rules

- **2–10 players.** When the host starts, everyone votes on a category
  (~5 random real categories plus "Surprise Me / Any", 15s). Most votes wins;
  ties break randomly; non-voters are ignored. Everyone voting ends the vote early.
- The whole game's questions are then fetched at once and everyone answers the same
  multiple-choice questions simultaneously. 10 questions × 20 seconds each by default;
  the host picks the difficulty (easy/medium/hard) in the lobby.
- **Scoring:** a correct answer earns `1000 × speed factor` points, where the speed
  factor decays **linearly from 1.0 at t=0 to 0.5 at the deadline** (rounded to an
  integer) — fast-correct beats slow-correct. Wrong or no answer = 0. The server clock
  is authoritative for correctness, timing, and scoring; answers lock the moment you
  tap them. If everyone has answered, the question resolves immediately.
- After each question: the correct answer, everyone's picks, points earned, and live
  standings are shown for 5 seconds. After the last question the final scoreboard and
  winner(s) appear — ties are shared wins.
- **No AFK removal (unlike Mind Meld):** not answering simply scores 0 and the game
  moves on. Disconnected players are marked in the UI and score 0 on questions they
  miss, but resume with their score intact if they reconnect. A game only ends early
  if fewer than two players remain connected (checked when a question resolves) or
  fewer than two players remain in the room.

### Question source: Open Trivia DB

Questions come from [Open Trivia DB](https://opentdb.com) — free, no API key —
behind a swappable `QuestionSource` adapter interface
(`server/src/trivia/questionSource.ts`: `getCategories()` / `getQuestions()`), so the
source can be replaced later without touching game logic. The `OpenTdbSource`
implementation handles OpenTDB's constraints:

- **Rate limit (~1 request / 5s per IP):** all requests are funneled through a
  serialized throttle, and each game makes **one batched fetch** for its entire
  question set after the category vote — never one call per question. The category
  list and a session token are pre-fetched at server startup.
- **Session token** (`api_token.php?command=request`) is used on question calls so
  questions don't repeat across games; on `response_code` 3/4 (token missing/empty)
  the token is reset/re-requested and the call retried.
- **Encoding:** questions are requested with `encode=base64` and decoded server-side
  (OpenTDB otherwise HTML-encodes text); category names get a small HTML-entity
  decoder.
- **`response_code 1` (not enough questions):** falls back to the same category with
  difficulty relaxed to "any", then tops up from General Knowledge, and as a final
  offline-safe resort fills from a small built-in question set — a game always gets
  its questions.

## Bid Battle — the rules

A team category-naming auction, **1v1 or 2v2** (exactly 2 or 4 players, Team A vs
Team B). First team to 3 points (configurable) wins the match. You pick the mode
before choosing Quick Play / Create Private / Join by Code; quick play pools are
per-mode and auto-balance four solos into teams.

Each round:

1. **Category.** Quick play auto-draws from a curated server deck (~45 wide
   categories: car brands, dog breeds, world capitals…). Private rooms hold a 20s
   **ballot**: anyone may add custom categories (2 per player, 8 total) and everyone
   casts one vote. A custom category wins ONLY if it reaches the approval
   threshold — **unanimous in 1v1, 3 votes in 2v2** — otherwise (including a 2–2
   split) the round uses a random deck draw. Non-voters just make approval harder.
2. **Bidding.** Teams alternate on a 10s clock; any member may act for their team
   (the first action locks the turn). **Raise** to any higher integer, or
   **decline to raise ("make them name it")** — which ends the auction and makes
   the last/highest bidder deliver. **Timeout = declining**: the silent team hands
   the bid to the last bidder (nobody loses a point to the clock). Opening-turn
   edge case: if the opener times out with no bid, the opening passes to the other
   team; if they *also* time out, no point is awarded and a fresh category is drawn.
3. **Delivery.** The delivering team has 60s to name at least their bid. Teammates
   type into one shared live list; **exact duplicates are auto-rejected instantly**
   (same normalization as Mind Meld). The waiting team watches the list grow live
   too — same view as the namers — so they can line up their review flags. Name
   extra for a buffer, or hit Done early.
4. **Review (honor system).** The full list is revealed. The opposing team flags
   items as invalid/semantic dupes; the namers **concede** or **defend** each flag;
   the opposing team then **accepts** or **upholds** each defense. Burden is on the
   namer — an upheld flag drops the item. Timeout defaults: unflagged items count,
   un-defended flags drop, un-finalized defenses count. Valid count ≥ bid → the
   delivering team scores; otherwise the challengers do. The losing team opens the
   next auction.

> ⚠️ **Honor mode caveat:** counting and exact-duplicate detection are automatic,
> but validity and semantic duplicates ("Mercedes" vs "Mercedes-Benz") are judged
> by the *opposing team*, with no external validation. A bad-faith challenger can
> uphold flags on perfectly valid items. It's designed for private lobbies with
> people you trust; quick play uses the same honor review — play nice.

## Codewords — the rules

A two-team word-association deduction game (route `/codewords`, namespace
`/codewords`). 25 word cards in a 5×5 grid; a hidden key marks each card as a
**red agent**, **blue agent**, **innocent bystander** (7 of them), or the single
**assassin** 💀. The randomly-chosen starting team has **9** agents, the other **8**,
and gives the first clue.

- **Roles.** Each team has exactly one **spymaster**; everyone else on the team is
  a **field operative**. There is **ONE shared key per game**: both spymasters see
  the SAME complete key (all reds, blues, bystanders, and the one assassin). The
  only secrecy boundary is **spymasters vs. operatives** — the server never sends
  operatives a card's identity until it is revealed, and the full key is only
  broadcast once the game ends.
- **A turn.** The active team's spymaster gives a **one-word clue + a number**
  (0–9 or ∞). The clue is validated server-side: one single token that isn't equal
  to, doesn't contain, and isn't contained by any unrevealed word on the board.
  The team then gets **exactly that many** guesses (0 and ∞ = unlimited guesses,
  but any wrong flip still ends the turn) and must guess at least once before
  passing. (House rule: no "+1 bonus guess" — the number is the cap.)
- **Flip outcomes** (decided by the server from the key): your own agent → keep
  guessing; a bystander → turn ends; the *other* team's agent → it's revealed in
  their color (advancing them) and your turn ends; the assassin → **your team
  loses instantly**.
- **Winning.** First team with all its agents revealed wins — or you win because
  the other team hit the assassin.

Two ways to play (mode picker on the Codewords page):

- **Remote** (`/codewords/remote`) — everyone on their own device, 4–10 players,
  with the usual lobby/quick-play/invite/reconnect infrastructure. Both teams need
  a spymaster + at least one operative to start. Spymasters privately see the key
  overlaid on their grid; operatives **guess by voting** — tap a card to vote
  (tap again to take it back), and the server flips the card once a **majority of
  the team's currently-connected operatives** agree on it (passing needs a
  majority too). Votes are cleared whenever a card flips or the turn changes. If
  a spymaster leaves mid-game, the game pauses that seat and a teammate can claim
  it (the key is re-delivered to the new spymaster); a team that can no longer
  field a spymaster + operative forfeits.
- **Shared Board** (`/codewords/board`) — one screen for the room (laptop/TV)
  plus the two spymasters on their phones. The board shows the grid, clue, guess
  counter and **two QR codes (Red / Blue)**; each spymaster scans theirs, which
  opens `/codewords/key` with a per-team secret token. The server validates the
  token before delivering the key to that phone. The two QRs are a **convenience
  to identify which phone belongs to which team** — both phones display the same
  full key; the team in the token only controls whose turn may type a clue.
  Everyone else plays in person: spymasters speak clues aloud (a spymaster can
  optionally type the clue on their phone so it shows on the board; otherwise the
  board has a manual "clue given: N" control so the guess counter still works),
  and operatives reveal guesses by tapping cards **on the shared board**
  (tap to select, tap again to confirm). The shared board itself never receives
  the key. Reloading a phone (or re-scanning the QR after a drop) restores the
  private key view.

Implementation notes / decisions:

- **No in-app voice** — players talk out loud in the same room or use their own
  call. In-app voice is a planned separate project.
- **Original word bank.** The ~380-word bank (`server/src/codewords/wordBank.ts`)
  is self-authored for this arcade — common, concrete, family-friendly single
  English words — and is **not copied from or modeled on any published word
  game's card list**. It's structured as data packs so user-authored packs can
  plug into the accounts DB later. The game tile is named **"Codewords"** and does
  not use the "Codenames" trademark anywhere in the UI.
- Both spymaster surfaces receive the key via the same private `yourKey` socket
  event (one event rather than a separate Mode-B `spymasterKeyGranted` — the
  payload is identical by design since there is only one shared key).
- Board-mode games are in-person around one screen, so they don't record account
  win stats (remote games do). Quick play matches only remote-mode lobbies;
  shared boards are created directly and reject normal code joins (QR tokens
  only). Public remote lobbies follow the arcade-wide rule: auto-start only when
  completely full (teams and spymasters self-heal at launch if unset).

## Running it

```bash
npm install

# Development (Vite on :5173 with hot reload, server on :3001, socket proxy)
npm run dev            # open http://localhost:5173

# Production-style (one port, server serves the built client)
npm run build
npm start              # open http://localhost:3001

# Type-check both sides without emitting
npm run typecheck

# End-to-end tests: builds, boots the server on a test port, and plays full
# games of both Mind Meld and Speed Trivia (incl. a 10-player game) over real
# sockets. `npm run test:only` skips the rebuild.
npm test
```

CI (GitHub Actions) runs typecheck + build + the full test suite on every push
and pull request.

### Testing multiplayer locally

1. `npm run dev` and open http://localhost:5173/mindmeld (or `/trivia`) in
   **two browser tabs**.
2. Tab 1: enter a name → **Create private room** → copy the code (or invite link).
3. Tab 2: enter a different name → **Join with code** → paste the code.
4. Both tabs: hit **I'm ready!**, then the host presses **Start game**.
5. Mind Meld: round 1, each tab locks in any word; from round 2, converge — lock the
   same word in both tabs to trigger the win screen. Speed Trivia: vote on a
   category in both tabs, then race through the questions.

(Player identity is stored per-tab in `sessionStorage`, so two tabs are two players
while a refresh of either tab still reconnects to the same game.)

Codewords needs a few more tabs: **Remote** takes four (two per team; use the 🕵️
button in the lobby to pick each team's spymaster — spymaster tabs see the key
tint, operative tabs don't). **Shared Board** takes three: open
`/codewords/board`, create a board, then open each QR's link (the "copy link
instead" button under each QR, or scan with a phone) in its own tab as the two
spymasters. Each
Codewords surface (remote player / board / spymaster phone) uses its own per-tab
session key, so the three kinds of tab don't clobber each other.

### Env vars

| Var        | Default         | Meaning                          |
| ---------- | --------------- | -------------------------------- |
| `PORT`     | `3001`          | Port the Node server listens on  |
| `STATS_DB` | `data/stats.db` | Path of the SQLite stats file    |

## Imposter — the rules

A social-deduction word game with **two modes** behind one entry (`/imposter`):
**On this device** (pass-and-play, one shared phone) and **Online** (everyone on
their own device). Both share the same built-in word bank (~10 categories × 25+
words, no external API) and the same reveal rules; they differ only in what
drives play.

Core idea: everyone secretly receives the same word — except the imposter(s),
who see only "You are the Imposter" (plus the **category** as a hint when hints
are ON — never the word itself, and there's nothing more to curate since the
hint is just the category label). Players take turns giving ONE-word clues that
prove they know the word without giving it away.

### On this device (works offline, no accounts, no server)

Set player count (3+), names (optional), imposters (1..players-1, with a warning
when the ratio makes crew wins unlikely), category or random, hints on/off.
Each player taps their name to privately view their card (a hand-off screen
guards against peeking, and each card can be viewed **only once**). Then you
play out loud — the app doesn't capture clues — and hit **Reveal results** to
show every role and the word. New round reshuffles with the same settings.

### Online (route `/imposter-online`, namespace `/imposter`)

3–10 players; reuses the shared lobby/room codes/Quick Play/ready/reconnection
infra and friends-list lobby invites. The host configures (in the lobby):
imposter count, category, hints, word steal (default on), typed vs spoken clues
(default typed), and clue rounds before a forced vote (default 3).

- **Role secrecy is server-authoritative**: roles and the word are assigned
  server-side and each client receives ONLY its own card. The word is never
  sent to an imposter's client, and nobody's role is sent to anyone before the
  final reveal — including across refreshes (rejoin restores only your own
  card). The test suite sweeps every mid-game broadcast to prove it.
- **Clue rounds**: turn-based, starting from a randomly announced player, 30s
  per turn; a disconnected/idle player is auto-skipped after the timer (they
  simply contribute no clue). Typed clues must be a single word, and crew may
  not say the secret word itself (deliberately unenforced for imposters — the
  rejection would confirm their guess). Spoken mode advances turns with a
  "said it" tap (active player or host) and keeps no text.
- **Continue-or-vote**: after each round everyone votes "another round" vs
  "accuse now" — majority accuse goes to the vote, ties mean another round,
  and after the round cap the vote is forced.
- **Accusation vote**: secret until the tally reveal. Ties trigger one runoff
  among the tied; a still-tied runoff eliminates nobody and returns to clues
  (benefit of the doubt) — unless it was the forced final vote, in which case
  the deadlocked crew loses. The eliminated player's role is revealed.
- **Word steal** (optional): when the LAST imposter is voted out, they get one
  typed guess at the word — a normalized match wins the game for the imposters
  on the spot.
- **Win check (parity)**: all imposters out (and no successful steal) → crew
  wins; a crew elimination that leaves imposters ≥ crew → imposters win;
  otherwise a fresh clue cycle starts (round cap reset) with a new starter.

Categories come from the built-in word bank in `shared/imposterWords.ts` —
user-uploaded category packs could reuse the accounts/DB foundation later.

## User accounts (Supabase) — optional, foundation only

Accounts are built on Supabase (Auth + Postgres) and are **completely optional**: a
logged-in user is just an anonymous player who additionally has an account. All
three games work fully anonymously with zero configuration — if the Supabase env
vars are unset, the only difference is that the corner "Sign in" button explains
auth isn't configured. **No game or feature is gated behind login**, and nothing
will be without a deliberate future decision (a reusable `requireAuth()` gate is
wired in `client/src/auth/AuthContext.tsx` for that future, but no gated actions
exist yet).

What exists (accounts phase 2 — account page + durable stats):

- **Account page** (`/account`, via the corner button when signed in): email,
  linked sign-in methods, member-since date, username + display-name editing
  (unique usernames enforced by the DB), per-account game stats, sign out.
- **Durable per-account stats**: when a game finishes, the server records each
  *signed-in* participant's result to the `player_stats` table in Postgres via a
  service-role-only SQL function (`record_game_result`) — clients cannot call it,
  so stats can't be inflated. Anonymous players are unaffected (their per-tab
  stats stay in the local SQLite file, which resets on redeploys). Stats count
  only games finished while signed in.
- **Identity linking**: Supabase automatically links a Google sign-in to an
  existing email/password account when the (verified) email matches — one
  account, multiple sign-in methods, shown on the account page.

What exists (accounts phase 3 — friends):

- **Friends** (signed-in players only; anonymous play is untouched): add by
  username, by sharing your personal invite link, or by having a friend scan
  your **QR code** (it encodes the invite link — scan with any phone camera, no
  in-app scanner needed). Requests are accepted/declined in the friends page
  (`/friends`) or the corner **🔔 notification menu**; either side can unfriend.
- **Data model**: one `friendships` row per pair (a unique `least/greatest`
  index blocks duplicate/reverse requests). RLS: only the two people involved
  can see a relationship; you can only send requests as yourself; only the
  addressee can accept; either side can delete.
- **Presence + lobby invites** (Brawl Stars style): a `/social` Socket.IO
  namespace tracks which signed-in players are online and which room they're in
  (server-observed, never client-reported). In any game lobby, **Invite
  friends** lists your friends with live status; one tap sends a real-time
  invite that pops into their 🔔 menu with a Join button. The server validates
  every invite: you must actually be in that (still-joinable) lobby, the target
  must be an accepted friend and online, and repeat invites are rate-limited.
  Friend lists are always read server-side with the service role — client-
  supplied ids are never trusted.

What exists (accounts phase 4 — messages):

- **Friend DMs**: message any *accepted* friend (requests pending or declined
  can't chat). One conversation per friendship, created on first message from
  the friends page (💬) or a lobby invite.
- **Group chats**: name a group and add 1–9 of your accepted friends; everyone
  in it can chat and post game invites. The **creator manages the roster**:
  they can add more of their accepted friends later (10 people max) and delete
  the group for everyone. **Any member can leave** at any time; if the creator
  leaves, the group lives on for the others (nobody can add or delete anymore),
  and the last member out deletes it automatically. All of it lives behind the
  group chat's header buttons on the Messages page, with the same server-side
  validation as creation.
- **Chat-based lobby invites**: the lobby "Invite friends" panel still shows
  who's online (presence can be glitchy, so it's informational) — but invites
  now go through Messages: one tap posts an invite card (with a Join button)
  into a DM or group chat, where it persists even if the friend is offline.
  Online recipients also get the live 🔔 notification. **Capacity rule**: a
  group invite is only allowed when every other member could fit — e.g. a
  3-person group can't be invited to a 1v1 Bid Battle lobby with one open
  seat (the server enforces this; the panel greys those groups out).
- **Security model**: the chat tables have **deny-all RLS** — clients can't
  read or write them even with a valid session. Everything flows through the
  game server (service role), which validates friendship for DMs, membership
  for reads/posts, and lobby membership + capacity for invites. Delivery is
  realtime over the `/social` socket; unread state is tracked per member.

What exists (accounts phase 5 — custom trivia sets, CONTENT LAYER only):

- **My Sets** (`/sets`, behind login — reachable from the home header and the
  account page): create/edit/delete your own question sets, plus a separate
  read-only **"Shared with me"** list. Anonymous play of the built-in games is
  completely unaffected — this page is the only gated surface.
- **Set editor**: title, description, free-text category, and an ordered
  question list. Each question is text + 2–4 answer options with exactly one
  marked correct, validated before save (and re-checked by a DB constraint).
  Questions reorder with up/down (positions renumber 0..n-1). The stored shape
  (`question_text`, `options` jsonb array, `correct_index`, `position`)
  **matches what the Speed Trivia engine consumes** — no translation layer
  will be needed when gameplay wiring lands. Text questions only for now;
  image/media questions would need Supabase Storage and are a future add.
- **Sharing**: from a set you own, pick friends (from your existing friends
  list) to share with — each grant is a `trivia_set_shares` row. The editor
  shows who a set is shared with and can revoke each grant; recipients can
  also remove a share from their own list. Sharing never changes the set's
  `visibility` (stays `private`); recipients get **read-only** access.
- **Composition is COPY, not reference**: from any set you can read (yours or
  shared with you) you can copy selected questions into a set you own, or
  duplicate the entire set. Copies are new rows with new ids
  (`source_set_id` records where a copy came from, for attribution only) —
  editing or deleting the source never affects the copies.
- **Authorization model**: every query runs through the signed-in user's own
  Supabase session, so **Postgres RLS is the server-side authority** — the
  same pattern as the friendships table. No service-role endpoint exists for
  this feature, so there is no RLS bypass to guard. New/changed policies
  (migration `20260719000000_trivia_set_shares.sql` — apply with
  `npx supabase db push` like the others):
  - `trivia_sets` select: owner, OR (not removed AND (non-private visibility
    OR a `trivia_set_shares` row for `auth.uid()`)). Insert/update/delete:
    owner only (unchanged).
  - `questions` select: inherits the set's read access (including shares);
    writes: set owner only (unchanged). New NOT VALID check constraint
    enforces the 2–4 options / valid `correct_index` shape on new writes.
  - `trivia_set_shares`: readable by `shared_by` or `shared_with`; insert only
    by the SET'S OWNER (as themselves, not to themselves); delete by the
    set's owner (revoke) or by `shared_with` (remove from my list).
  - Note: the DB allows an owner to share with any profile id, not just
    friends — the UI offers friends; granting read access to your own content
    is the owner's call either way.

Manual RLS test checklist (two accounts A and B that are friends, plus the
anon key):

1. A creates a private set with questions. B's "Shared with me" is empty; B
   opening the set's URL directly gets "not shared with you" (RLS returns no
   row).
2. A shares the set with B. B now sees it under "Shared with me" and can read
   every question — but has no edit UI, and a hand-written
   `update trivia_sets/questions` from B's session fails (0 rows affected).
3. B copies questions into B's own set (and/or duplicates the set). A then
   deletes the original — B's copies are untouched (only `source_set_id`
   nulls out via `on delete set null`).
4. A revokes the share (or B removes it): the set disappears from B's list
   and B can no longer read it or its questions.
5. With the raw anon key (no session): every select/insert on `trivia_sets`,
   `questions`, and `trivia_set_shares` returns nothing/fails.

What existed from phase 1:

- **Login button** in the top-right corner on every page → modal with email/password
  signup + login, "Continue with Google", and sign-out; shows your username when
  logged in. Session persists across refreshes (Supabase JS client).
- **Server-side identity (optional everywhere):** Express middleware verifies the
  Supabase access token (HS256 with `SUPABASE_JWT_SECRET`) and sets `req.userId` on
  `/api` routes (`GET /api/me` returns it); every game namespace's Socket.IO
  handshake reads an optional token into `socket.data.userId`. Missing/invalid
  token = anonymous, always allowed.
- **Database schema + RLS** (in `supabase/migrations/`): `profiles` (auto-created
  by a Postgres trigger on signup — chosen over a server call so profiles exist
  even if the app server never sees the user), plus `trivia_sets` and `questions`
  tables defined now so the schema is stable. **The trivia-set posting UI is a
  later phase — this is schema only.**

### Environment variables

Copy `.env.example` to `.env` (gitignored) for local dev; set the same values in
your host's dashboard (e.g. Render → Environment) for production. **You provide
all of these from your Supabase project dashboard — they cannot be created by
code.** With none of them set, the arcade runs fully anonymous.

| Var | Where it's used | Where you get it |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | client (public) | Dashboard → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | client (public) | Dashboard → API Keys → publishable key (`sb_publishable_…`; the legacy `anon` JWT also works) |
| `VITE_APP_BASE_URL` | client (public) | Your app's origin: `http://localhost:5173` locally, your deployed URL in prod (OAuth redirect target) |
| `SUPABASE_URL` | server | Same Project URL as above (also used to verify JWTs via the project's public JWKS endpoint) |
| `SUPABASE_SERVICE_ROLE_KEY` | server, **SECRET** | Dashboard → API Keys → secret key (`sb_secret_…`; legacy `service_role` JWT also works). Bypasses RLS — never expose to the client |
| `SUPABASE_JWT_SECRET` | server, **SECRET**, *legacy only* | Only for projects still on the shared HS256 JWT secret (Project Settings → JWT). Projects on the new **asymmetric JWT signing keys** leave this unset — tokens verify against the JWKS endpoint automatically |

Client vars are baked in at `vite build` time; server vars are read at runtime
(the server also loads a repo-root `.env` if present).

> **Render gotcha:** because `VITE_*` vars are baked during the build, they must
> exist in Render's Environment tab *before* the build runs — adding or changing
> them triggers/needs a redeploy. If the deployed site shows "Accounts not
> configured", the env vars were missing at build time; set them and redeploy.
> Also set `VITE_APP_BASE_URL` to the Render URL and add that URL to Supabase's
> redirect allow-list (Auth → URL Configuration) or OAuth/email links will
> bounce back to localhost.

### Row Level Security (RLS)

**Every table has RLS enabled.** This matters because the `anon` and authenticated
keys are public — **without RLS, anyone with your anon key can read/write every
row in the table.** If you ever add a table, enable RLS before inserting data.

Policies shipped in the migration:

- `profiles`: readable by anyone (usernames are public identity); updatable only
  by the owner; no client inserts/deletes (rows come from the signup trigger and
  the `auth.users` cascade).
- `trivia_sets`: owner can always read their own; others can read only when
  `visibility != 'private'` **and** `is_removed = false` (moderation flag);
  insert/update/delete only by the owner.
- `questions`: inherit their set's access for both reads and writes.

**Manual RLS test checklist** (run in the Supabase dashboard's SQL editor / API
docs, or via two browser profiles once posting exists):

1. Sign up as user A and user B.
2. As A, insert a `trivia_sets` row with `visibility='private'` (SQL editor uses
   the service role, so test via the client/API with A's token).
3. As B: verify you can NOT select A's private set, and can NOT update/delete it.
4. As B: verify you CAN select it after A sets `visibility='public'` — and can
   NOT select it again after A sets `is_removed=true`.
5. With only the anon key (no login): verify you can read `profiles` and public
   sets, and can NOT insert/update/delete anything on any table.
6. As B, try `update profiles set username='hacked' where id=<A's id>` via the
   API — it must affect 0 rows.

### Local Supabase development

Requires Docker plus the [Supabase CLI](https://supabase.com/docs/guides/local-development)
(`brew install supabase/tap/supabase`).

```bash
npm run db:start    # boots local Supabase (applies supabase/migrations/)
npm run db:reset    # re-applies migrations from scratch
npm run db:types    # regenerates shared/database.types.ts from the local schema
npm run db:push     # pushes migrations to your linked hosted project
```

`supabase start` prints a local API URL and anon key — put those in `.env` to
develop against the local stack. `shared/database.types.ts` is checked in
(hand-written to match the migration) so the repo typechecks without Docker;
regenerate it after any schema change.

### What you must do by hand (in order) vs what is coded

Everything below requires your Supabase/Google accounts and **cannot be done by
code**. Until you finish steps 1–3, the login button shows "accounts not
configured" — that's expected, not a bug. Anonymous play works regardless.

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Copy four values from Project Settings → API: Project URL, `anon` key,
   `service_role` key, and the JWT Secret.
3. Set the env vars (table above) in local `.env` and in your host's dashboard.
4. Apply the schema to the hosted project: `supabase link --project-ref <ref>`
   then `npm run db:push` (or paste `supabase/migrations/*.sql` into the SQL
   editor).
5. Auth → URL Configuration: set the Site URL to your production origin and add
   BOTH redirect URLs to the allow-list: `http://localhost:5173` (dev) and your
   production origin (e.g. `https://arcade.onrender.com`).
6. (Later, optional) configure any additional OAuth providers the same way as
   Google below.

**Google login setup (all manual — Google login will fail until done; expected,
not a code bug):**

1. In Google Cloud Console → APIs & Services → Credentials, create an
   **OAuth 2.0 Client ID** (type: Web application).
2. Set its **Authorized redirect URI** to the Supabase callback URL shown on
   Supabase → Authentication → Providers → Google (looks like
   `https://<ref>.supabase.co/auth/v1/callback`).
3. Paste the Client ID + Client Secret into that Supabase Google provider page
   and enable it.
4. Add your localhost and production URLs to Supabase's redirect allow-list
   (step 5 above) — the app sends users back to `VITE_APP_BASE_URL`.
5. While your Google consent screen is in **"testing"** mode, only whitelisted
   test users can log in — add yourself, or publish the consent screen.

### Notes for the later phases (why the schema looks like this)

- `questions.options` and `questions.correct_index` are intentionally readable by
  any client allowed to view the set: future **solo play will score client-side**.
  That's fine for practice but **not cheat-proof** — solo results must never feed
  a public/competitive leaderboard without server-side answer checking.
- When solo mode is built, the trivia question card / answer buttons / reveal
  should be extracted from `client/src/trivia/QuestionScreen.tsx` into shared
  **presentational** components driven by either the existing socket engine or a
  local solo controller — reuse the UI, not the networking. (No solo controller
  exists in this phase.)

## Deployment

This is a **single long-lived stateful process** — deploy it to **Render, Railway, or
Fly.io** (build command `npm install && npm run build`, start command `npm start`).
**It cannot run on Vercel** or other serverless platforms: game state lives in server
memory and Socket.IO needs a persistent connection to one process.

**One-click deploy:** a `render.yaml` blueprint is included — on
[Render](https://render.com), choose **New → Blueprint**, select this repo, and
deploy (free tier). Free-tier caveats: the instance sleeps after ~15 min idle
(~30–60s cold start; open games keep it awake) and the disk is ephemeral, so
in-memory games and SQLite win stats don't survive restarts/deploys.

### Tradeoffs / limitations

- **In-memory state is lost on restart** — a deploy or crash ends all games in
  progress (win stats survive in SQLite).
- **Single instance only.** Scaling horizontally would require the Socket.IO Redis
  adapter plus moving room state out of process memory. All room state access already
  goes through the small `RoomStore` interface (`server/src/store.ts`) to make that
  move contained, but timers would also need to be externalized.
- Round countdowns trust the client clock to display the server-sent epoch deadline;
  large client clock skew can make the displayed timer slightly off (the server is
  authoritative about the actual deadline).

## Decisions made along the way

- **`sessionStorage` instead of `localStorage` for the player session** (the spec's
  intent — surviving refresh — is preserved) so that two tabs in one browser are two
  distinct players, which makes local multiplayer testing possible.
- Public rooms auto-start (full lobby + 15s countdown) without requiring ready
  toggles; ready checks apply to the host's manual start. Partially filled
  lobbies never auto-start.
- On the all-locked fast path, "all" means all **connected** players, per spec — so a
  disconnected player can be skipped and takes an AFK strike for the round.
- Lobby disconnects get a 30s grace period before removal (so refreshes don't kick
  you); fully-disconnected rooms are garbage-collected after 5 minutes.
- If the host leaves or is removed, the host role passes to another (preferably
  connected) player; the last player leaving closes the room.
- Reveal history and dead words display the **normalized** word so matching stays
  transparent.
- Room settings exposed in the UI are round time + match mode; the other settings
  (`revealPauseSec`, `maxRounds`, `afkMissLimit`) are supported by the `createRoom`
  API and default sensibly.

### Speed Trivia decisions

- Trivia reuses the exact lobby/matchmaking/reconnection behavior as Mind Meld
  (including public auto-start) via the shared base modules; Mind Meld's behavior
  was preserved unchanged through the refactor.
- Player limits are per-game: Mind Meld stays 2–4, Speed Trivia allows **2–10**
  (public trivia rooms auto-start only when full — 10 players — after a 15s countdown).
- Trivia has **no AFK removal** by design (see rules above) — the shared AFK
  machinery is Mind Meld-specific and lives only in its manager.
- A mid-question disconnect never ends the game on the spot; the "fewer than 2
  connected" check happens when the current question resolves, so a quick refresh
  can't kill a running game.
- The host difficulty selector lives in the lobby (a trivia-specific
  `setDifficulty` event); questions-per-game and seconds-per-question are set when
  creating a room.
- Category names shown in the vote are OpenTDB's real category list (cached at
  startup); the first game after a cold server start may take a few extra seconds
  while the throttled startup fetches finish.
- If two rooms start games at nearly the same moment, the second room's question
  fetch waits ~5s in the throttle queue — players just see "Loading questions…"
  slightly longer.

### Bid Battle decisions

- The team layer is Bid Battle-only: the shared room core gained optional,
  backwards-compatible hooks (per-room player capacity, mode-filtered Quick Play,
  extra start validation, join/rejoin callbacks) and
  the game keeps `team` on its own player type. Mind Meld and Trivia are untouched.
- Players are auto-assigned to the smaller team on join (so lobbies default to
  balanced); private lobbies can swap freely before start; the host can flip
  1v1/2v2 in the lobby, which re-balances everyone in join order.
- Quick play rooms auto-start once full (2 or 4) after the standard 15s
  full-lobby countdown; team sizes are exact so there is never a partial start.
  Public full rooms re-enter the same countdown on Play Again.
- **Leaving mid-match forfeits it for the leaver's team** (in 2v2 the whole team
  loses). Disconnects do NOT forfeit — timers keep the match moving (a silent
  bidding turn declines, missing delivery time just yields fewer items), and a
  reconnecting player resumes on their team with full state.
- A 3-second pause separates the category reveal from the first bid clock so
  everyone can read the category.
- Ballot votes can be changed until the ballot resolves; it resolves early once
  every connected player has voted. Bids are capped at 500.
- Category ballots dedupe suggestions by normalized text; the deck avoids
  repeating a category within the same match.

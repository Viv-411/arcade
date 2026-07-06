# 🕹 Arcade

A real-time multiplayer web arcade for party games: **Mind Meld** 🧠,
**Speed Trivia** ⚡, and **Bid Battle** 💰.

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
  creates a new public room. Public rooms auto-start at 4 players, or 20s after 2+
  players are present (countdown resets when someone joins).
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

### Env vars

| Var        | Default         | Meaning                          |
| ---------- | --------------- | -------------------------------- |
| `PORT`     | `3001`          | Port the Node server listens on  |
| `STATS_DB` | `data/stats.db` | Path of the SQLite stats file    |

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
- Public rooms auto-start without requiring ready toggles; ready checks apply to the
  host's manual start.
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
  (public trivia rooms auto-start immediately at 10 or 20s after 2+ join).
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
  partial-auto-start opt-out, extra start validation, join/rejoin callbacks) and
  the game keeps `team` on its own player type. Mind Meld and Trivia are untouched.
- Players are auto-assigned to the smaller team on join (so lobbies default to
  balanced); private lobbies can swap freely before start; the host can flip
  1v1/2v2 in the lobby, which re-balances everyone in join order.
- Quick play rooms auto-start the moment they're full (2 or 4) — there is no
  partial-lobby countdown since team sizes are exact. Public full rooms also
  restart immediately on Play Again.
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

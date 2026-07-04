# 🕹 Arcade

A real-time multiplayer web arcade for party games. First game: **Mind Meld** 🧠.

## How it works

One Node process does everything: an Express server serves the built React client as
static files and hosts Socket.IO on the same port. All game state lives **in memory**
on the server; every game gets its own Socket.IO namespace (`/mindmeld`) and its own
client route, so adding a new game means adding one namespace module on the server and
one route/module on the client — the home page is a grid of game cards.

```
/shared   TypeScript types, Socket.IO event contracts, word normalization
          (imported by BOTH client and server — one source of truth)
/server   Node + Express + Socket.IO. Game logic in server/src/mindmeld/manager.ts;
          all room state access goes through server/src/store.ts (RoomStore interface)
          so it could later be swapped for Redis.
/client   React + Vite + TypeScript SPA
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
```

### Testing multiplayer locally

1. `npm run dev` and open http://localhost:5173/mindmeld in **two browser tabs**.
2. Tab 1: enter a name → **Create private room** → copy the code (or invite link).
3. Tab 2: enter a different name → **Join with code** → paste the code.
4. Both tabs: hit **I'm ready!**, then the host presses **Start game**.
5. Round 1: each tab locks in any word. From round 2, try to converge — lock the
   same word in both tabs to trigger the win screen.

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

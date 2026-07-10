import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../../shared/events.js";
import { MindMeldManager } from "./mindmeld/manager.js";
import { BidBattleManager } from "./bidbattle/manager.js";
import { TriviaManager } from "./trivia/manager.js";
import { OpenTdbSource } from "./trivia/questionSource.js";
import { InMemoryRoomStore } from "./store.js";
import { createStatsStore } from "./stats.js";
import { optionalAuth, socketOptionalAuth } from "./auth.js";

// npm scripts run from the repo root, so resolve paths from cwd. This keeps
// the same logic working for both tsx (dev) and the compiled dist build.
const ROOT = process.cwd();

// Load .env if present (hosts inject real env vars instead). Everything in it
// is optional: with no Supabase config the arcade runs fully anonymous.
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  /* no .env — fine */
}

const PORT = Number(process.env.PORT) || 3001;
const CLIENT_DIST = path.join(ROOT, "client", "dist");
const STATS_DB = process.env.STATS_DB || path.join(ROOT, "data", "stats.db");

const app = express();
const server = http.createServer(app);
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(server);

// Each game gets its own namespace; add more namespaces here as games ship.
// Every namespace reads an OPTIONAL Supabase token from the handshake —
// authenticated sockets get socket.data.userId, anonymous ones stay welcome.
const stats = await createStatsStore(STATS_DB);
const mindmeldNsp = io.of("/mindmeld");
mindmeldNsp.use(socketOptionalAuth);
new MindMeldManager(mindmeldNsp, new InMemoryRoomStore(), stats);

const questionSource = new OpenTdbSource();
// Pre-fetch the OpenTDB category list + session token so the first game
// doesn't pay the (rate-limited) warm-up cost at start time.
questionSource.warmUp();
const triviaNsp = io.of("/trivia");
triviaNsp.use(socketOptionalAuth);
new TriviaManager(triviaNsp, new InMemoryRoomStore(), questionSource, stats);

const bidbattleNsp = io.of("/bidbattle");
bidbattleNsp.use(socketOptionalAuth);
new BidBattleManager(bidbattleNsp, new InMemoryRoomStore(), stats);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// All /api routes get optional auth: req.userId is set when a valid Supabase
// access token is sent, null otherwise. Nothing is gated yet.
app.use("/api", optionalAuth);
app.get("/api/me", (req, res) => {
  res.json({ userId: req.userId ?? null });
});

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  // SPA fallback: every non-API route serves the client app.
  app.get("*", (_req, res) => {
    res.sendFile(path.join(CLIENT_DIST, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res
      .status(200)
      .send(
        "Arcade server is running. No client build found — use `npm run dev` for the Vite dev server or `npm run build` first.",
      );
  });
}

server.listen(PORT, () => {
  console.log(`[arcade] listening on http://localhost:${PORT}`);
  if (!fs.existsSync(CLIENT_DIST)) {
    console.log("[arcade] client build not found; serving sockets only (dev mode)");
  }
});

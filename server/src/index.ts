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
import { InMemoryRoomStore } from "./store.js";
import { createStatsStore } from "./stats.js";

const PORT = Number(process.env.PORT) || 3001;

// npm scripts run from the repo root, so resolve paths from cwd. This keeps
// the same logic working for both tsx (dev) and the compiled dist build.
const ROOT = process.cwd();
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
const stats = await createStatsStore(STATS_DB);
new MindMeldManager(io.of("/mindmeld"), new InMemoryRoomStore(), stats);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
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

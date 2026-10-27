/**
 * Hotlap HTTP API — implements the contract in shared/hotlap/api.ts.
 * Mounted at /api/hotlap AFTER the /api optionalAuth middleware, so
 * req.userId is already set (or null for anonymous callers).
 *
 * Records are server-verified: POST /runs re-simulates the uploaded inputs
 * (off the main thread, see verifier.ts) and stores the time the SERVER
 * computed; a claimedMs that disagrees is rejected and logged.
 */
import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import type {
  ApiError,
  LeaderboardEntry,
  LeaderboardResponse,
  MyRecordsResponse,
  ReplayResponse,
  SubmitRunRequest,
  SubmitRunResponse,
} from "../../../shared/hotlap/api.js";
import { SIM_VERSION } from "../../../shared/hotlap/car.js";
import { ALL_TRACKS, getTrack } from "../../../shared/hotlap/tracks.js";
import type { BoardKey, HotlapStore } from "./store.js";
import type { ReplayVerifier } from "./verifier.js";

/** One verified submission per user per window. */
const RATE_WINDOW_MS = 2000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
/** Request body cap; a 15-minute replay is far smaller than this. */
const BODY_LIMIT = "128kb";

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ error } satisfies ApiError);
}

function currentKey(trackId: string): BoardKey | null {
  const def = getTrack(trackId);
  return def ? { trackId: def.id, trackVersion: def.version, simVersion: SIM_VERSION } : null;
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

export function createHotlapRouter(store: HotlapStore | null, verifier: ReplayVerifier) {
  const router = express.Router();
  const lastSubmit = new Map<string, number>();

  /** Wrap a handler: storage missing → 503, thrown storage errors → 503. */
  const handle =
    (fn: (req: Request, res: Response, store: HotlapStore) => Promise<void>) =>
    (req: Request, res: Response) => {
      if (!store) return fail(res, 503, "leaderboard storage is unavailable");
      fn(req, res, store).catch((err) => {
        console.warn("[hotlap] storage error:", err);
        if (!res.headersSent) fail(res, 503, "leaderboard storage is unavailable");
      });
    };

  router.get(
    "/leaderboard/:trackId",
    handle(async (req, res, store) => {
      const key = currentKey(req.params.trackId);
      if (!key) return fail(res, 404, "unknown track");
      const raw = Number(req.query.limit);
      const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(MAX_LIMIT, Math.floor(raw)) : DEFAULT_LIMIT;

      const [rows, total] = await Promise.all([store.top(key, limit), store.count(key)]);
      // Ranks follow list order; the board is already sorted by time, set_at.
      const entries: LeaderboardEntry[] = rows.map((r, i) => ({
        rank: i + 1,
        userId: r.userId,
        name: r.name,
        timeMs: r.timeMs,
        setAt: r.setAt,
        runId: r.runId,
      }));

      let you: LeaderboardEntry | null = null;
      if (req.userId) {
        you = entries.find((e) => e.userId === req.userId) ?? null;
        if (!you) {
          const mine = await store.getBest(req.userId, key);
          if (mine) {
            const [rank, name] = await Promise.all([store.rankOf(mine), store.displayName(mine.userId)]);
            you = { rank, userId: mine.userId, name, timeMs: mine.timeMs, setAt: mine.setAt, runId: mine.runId };
          }
        }
      }
      res.json({ ...key, entries, total, you } satisfies LeaderboardResponse);
    }),
  );

  router.post(
    "/runs",
    express.json({ limit: BODY_LIMIT }),
    handle(async (req, res, store) => {
      const userId = req.userId;
      if (!userId) return fail(res, 401, "sign in to post records");

      const body = (req.body ?? {}) as Partial<SubmitRunRequest>;
      const { trackId, trackVersion, simVersion, replay, claimedMs } = body;
      if (
        typeof trackId !== "string" ||
        !isInt(trackVersion) ||
        !isInt(simVersion) ||
        typeof replay !== "string" ||
        replay.length === 0 ||
        typeof claimedMs !== "number" ||
        !Number.isFinite(claimedMs)
      ) {
        return fail(res, 400, "malformed request");
      }
      const def = getTrack(trackId);
      if (!def) return fail(res, 404, "unknown track");
      if (trackVersion !== def.version || simVersion !== SIM_VERSION) {
        return fail(res, 409, "this track or the game has been updated — reload to race the current version");
      }

      // Cheap validation above doesn't count; each verification attempt does.
      const now = Date.now();
      const last = lastSubmit.get(userId);
      if (last !== undefined && now - last < RATE_WINDOW_MS) {
        return fail(res, 429, "slow down — one submission every 2 seconds");
      }
      lastSubmit.set(userId, now);
      if (lastSubmit.size > 5000) {
        for (const [id, t] of lastSubmit) if (now - t >= RATE_WINDOW_MS) lastSubmit.delete(id);
      }

      const result = await verifier.verify(def, replay);
      if (!result.ok) return fail(res, result.status, result.error);
      if (result.timeMs !== claimedMs) {
        console.warn(
          `[hotlap] verification mismatch: user=${userId} track=${trackId} claimed=${claimedMs} computed=${result.timeMs}`,
        );
        return fail(
          res,
          422,
          `verification failed: the replay finishes in ${result.timeMs} ms, not the claimed ${claimedMs} ms`,
        );
      }

      const key: BoardKey = { trackId: def.id, trackVersion: def.version, simVersion: SIM_VERSION };
      const { improved, previousMs, record } = await store.submit(userId, key, result.timeMs, replay);
      const [rank, total] = await Promise.all([store.rankOf(record), store.count(key)]);
      res.json({ ok: true, timeMs: result.timeMs, improved, previousMs, rank, total } satisfies SubmitRunResponse);
    }),
  );

  router.get(
    "/replays/:runId",
    handle(async (req, res, store) => {
      const runId = req.params.runId;
      const run = runId.length <= 64 ? await store.getRun(runId) : null;
      if (!run) return fail(res, 404, "unknown run");
      res.json({
        runId: run.runId,
        trackId: run.trackId,
        trackVersion: run.trackVersion,
        simVersion: run.simVersion,
        name: run.name,
        timeMs: run.timeMs,
        replay: run.replay,
      } satisfies ReplayResponse);
    }),
  );

  router.get(
    "/me",
    handle(async (req, res, store) => {
      const userId = req.userId;
      if (!userId) return fail(res, 401, "sign in to see your records");
      const current = new Set(ALL_TRACKS.map((t) => `${t.id}@${t.version}@${SIM_VERSION}`));
      const mine = (await store.listForUser(userId)).filter((r) =>
        current.has(`${r.trackId}@${r.trackVersion}@${r.simVersion}`),
      );
      const records: MyRecordsResponse["records"] = {};
      await Promise.all(
        mine.map(async (r) => {
          const [rank, total] = await Promise.all([store.rankOf(r), store.count(r)]);
          records[r.trackId] = { timeMs: r.timeMs, rank, total, runId: r.runId };
        }),
      );
      res.json({ records } satisfies MyRecordsResponse);
    }),
  );

  // Body-parser failures (bad JSON, over the size cap) → JSON 400s.
  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const type = (err as { type?: string }).type;
    if (type === "entity.too.large") return fail(res, 400, "replay too large");
    if (type === "entity.parse.failed") return fail(res, 400, "malformed JSON");
    console.warn("[hotlap] request error:", err);
    fail(res, 500, "internal error");
  };
  router.use(onError);
  // Unknown /api/hotlap/* paths: JSON 404 rather than the SPA fallback.
  router.use((_req, res) => fail(res, 404, "not found"));

  return router;
}

/**
 * HTTP contract for Hotlap records (server/src/hotlap ↔ client/src/hotlap).
 *
 * Records are SERVER-VERIFIED: the client uploads only its inputs; the server
 * re-simulates them with the same shared code and stores the time IT
 * computed. A client can't claim a time it didn't drive.
 *
 * All routes live under /api/hotlap. Reads are public; posting a record
 * requires a signed-in account (Bearer Supabase access token) — anonymous
 * players keep personal bests and ghosts on their own device.
 */

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  timeMs: number;
  /** ISO timestamp the record was set. */
  setAt: string;
  /** Id for fetching this record's replay (ghost). */
  runId: string;
}

/** GET /api/hotlap/leaderboard/:trackId?limit=N (default 50, max 100) */
export interface LeaderboardResponse {
  trackId: string;
  trackVersion: number;
  simVersion: number;
  entries: LeaderboardEntry[];
  /** Total distinct racers with a record on this track. */
  total: number;
  /** The caller's own standing, when signed in and on the board. */
  you: LeaderboardEntry | null;
}

/** POST /api/hotlap/runs (auth required) */
export interface SubmitRunRequest {
  trackId: string;
  trackVersion: number;
  simVersion: number;
  /** encodeInputs() output for the whole run, tick 0 to finish. */
  replay: string;
  /** What the client measured; the server's own result is authoritative. */
  claimedMs: number;
}

export interface SubmitRunResponse {
  ok: true;
  /** The server-verified finish time. */
  timeMs: number;
  /** True when this beat the player's previous record (or was their first). */
  improved: boolean;
  previousMs: number | null;
  /** The player's rank after this submission. */
  rank: number;
  total: number;
}

/**
 * Error body for any non-2xx response:
 * 400 malformed · 401 not signed in · 404 unknown track/run ·
 * 409 trackVersion/simVersion mismatch (client is stale — reload) ·
 * 422 verification failed (the inputs don't finish, or finish at a
 *     different time than claimed) · 429 rate limited · 503 storage down
 */
export interface ApiError {
  error: string;
}

/** GET /api/hotlap/replays/:runId */
export interface ReplayResponse {
  runId: string;
  trackId: string;
  trackVersion: number;
  simVersion: number;
  name: string;
  timeMs: number;
  replay: string;
}

/** GET /api/hotlap/me (auth required) — the caller's record on every track. */
export interface MyRecordsResponse {
  records: Record<string, { timeMs: number; rank: number; total: number; runId: string }>;
}

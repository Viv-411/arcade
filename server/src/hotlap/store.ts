/**
 * Hotlap record storage: ONE best record per (user, track, trackVersion,
 * simVersion). Records are only ever written after server-side verification
 * (routes.ts), so everything stored here is a time the server computed.
 *
 * Two implementations behind one interface:
 * - Supabase (service role, deny-all RLS table hotlap_records) when the
 *   server has SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — durable.
 * - SQLite in the local stats DB file otherwise (or when HOTLAP_STORE=sqlite,
 *   which the tests use) — same graceful degradation as stats.ts: if
 *   better-sqlite3 can't load, there is no store and the routes answer 503.
 *
 * Ranking: time ascending, ties broken by the earlier set_at.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSupabaseAdmin } from "../supabaseAdmin.js";

export interface BoardKey {
  trackId: string;
  trackVersion: number;
  simVersion: number;
}

export interface StoredRecord extends BoardKey {
  runId: string;
  userId: string;
  timeMs: number;
  /** ISO timestamp. */
  setAt: string;
}

export interface NamedRecord extends StoredRecord {
  name: string;
}

export interface SubmitResult {
  improved: boolean;
  previousMs: number | null;
  /** The player's best after this submission (the new one when improved). */
  record: StoredRecord;
}

export interface HotlapStore {
  readonly kind: "sqlite" | "supabase";
  /** Keep the record if it beats the user's best on this board (or is their first). */
  submit(userId: string, key: BoardKey, timeMs: number, replay: string): Promise<SubmitResult>;
  getBest(userId: string, key: BoardKey): Promise<StoredRecord | null>;
  /** The top `limit` records, best first, with display names. */
  top(key: BoardKey, limit: number): Promise<NamedRecord[]>;
  /** 1 + the number of records strictly ahead of this one. */
  rankOf(rec: StoredRecord): Promise<number>;
  /** Distinct racers with a record on this board. */
  count(key: BoardKey): Promise<number>;
  getRun(runId: string): Promise<(NamedRecord & { replay: string }) | null>;
  listForUser(userId: string): Promise<StoredRecord[]>;
  displayName(userId: string): Promise<string>;
}

/** SQLite mode has no profiles table — a stable, anonymous-looking handle. */
function fallbackName(userId: string): string {
  return `racer-${userId.slice(0, 6)}`;
}

// ---------------------------------------------------------------- SQLite

interface SqliteRow {
  run_id: string;
  user_id: string;
  track_id: string;
  track_version: number;
  sim_version: number;
  time_ms: number;
  set_at: string;
}

function fromSqlite(r: SqliteRow): StoredRecord {
  return {
    runId: r.run_id,
    userId: r.user_id,
    trackId: r.track_id,
    trackVersion: r.track_version,
    simVersion: r.sim_version,
    timeMs: r.time_ms,
    setAt: r.set_at,
  };
}

async function createSqliteStore(dbPath: string): Promise<HotlapStore | null> {
  try {
    const { default: Database } = await import("better-sqlite3");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS hotlap_records (
        run_id        TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL,
        track_id      TEXT NOT NULL,
        track_version INTEGER NOT NULL,
        sim_version   INTEGER NOT NULL,
        time_ms       INTEGER NOT NULL,
        replay        TEXT NOT NULL,
        set_at        TEXT NOT NULL,
        UNIQUE (user_id, track_id, track_version, sim_version)
      );
      CREATE INDEX IF NOT EXISTS hotlap_records_board_idx
        ON hotlap_records (track_id, track_version, sim_version, time_ms, set_at);
    `);
    const COLS = "run_id, user_id, track_id, track_version, sim_version, time_ms, set_at";
    const KEY = "track_id = @trackId AND track_version = @trackVersion AND sim_version = @simVersion";
    const selBest = db.prepare(`SELECT ${COLS} FROM hotlap_records WHERE user_id = @userId AND ${KEY}`);
    const ins = db.prepare(`
      INSERT INTO hotlap_records (run_id, user_id, track_id, track_version, sim_version, time_ms, replay, set_at)
      VALUES (@runId, @userId, @trackId, @trackVersion, @simVersion, @timeMs, @replay, @setAt)
    `);
    const upd = db.prepare(`
      UPDATE hotlap_records SET run_id = @runId, time_ms = @timeMs, replay = @replay, set_at = @setAt
      WHERE run_id = @oldRunId
    `);
    const selTop = db.prepare(
      `SELECT ${COLS} FROM hotlap_records WHERE ${KEY} ORDER BY time_ms ASC, set_at ASC, run_id ASC LIMIT @limit`,
    );
    const selAhead = db.prepare(`
      SELECT COUNT(*) AS n FROM hotlap_records WHERE ${KEY}
        AND (time_ms < @timeMs OR (time_ms = @timeMs AND set_at < @setAt))
    `);
    const selCount = db.prepare(`SELECT COUNT(*) AS n FROM hotlap_records WHERE ${KEY}`);
    const selRun = db.prepare(`SELECT ${COLS}, replay FROM hotlap_records WHERE run_id = ?`);
    const selUser = db.prepare(`SELECT ${COLS} FROM hotlap_records WHERE user_id = ?`);

    const keyParams = (k: BoardKey) => ({
      trackId: k.trackId,
      trackVersion: k.trackVersion,
      simVersion: k.simVersion,
    });
    // Read-compare-write inside one transaction: atomic per board.
    const submitTx = db.transaction(
      (userId: string, key: BoardKey, timeMs: number, replay: string): SubmitResult => {
        const prevRow = selBest.get({ userId, ...keyParams(key) }) as SqliteRow | undefined;
        const prev = prevRow ? fromSqlite(prevRow) : null;
        if (prev && prev.timeMs <= timeMs) {
          return { improved: false, previousMs: prev.timeMs, record: prev };
        }
        const record: StoredRecord = {
          ...keyParams(key),
          runId: randomUUID(),
          userId,
          timeMs,
          setAt: new Date().toISOString(),
        };
        if (prev) upd.run({ ...record, replay, oldRunId: prev.runId });
        else ins.run({ ...record, replay });
        return { improved: true, previousMs: prev?.timeMs ?? null, record };
      },
    );

    return {
      kind: "sqlite",
      async submit(userId, key, timeMs, replay) {
        return submitTx(userId, key, timeMs, replay);
      },
      async getBest(userId, key) {
        const row = selBest.get({ userId, ...keyParams(key) }) as SqliteRow | undefined;
        return row ? fromSqlite(row) : null;
      },
      async top(key, limit) {
        const rows = selTop.all({ ...keyParams(key), limit }) as SqliteRow[];
        return rows.map((r) => ({ ...fromSqlite(r), name: fallbackName(r.user_id) }));
      },
      async rankOf(rec) {
        const row = selAhead.get({ ...keyParams(rec), timeMs: rec.timeMs, setAt: rec.setAt }) as {
          n: number;
        };
        return row.n + 1;
      },
      async count(key) {
        return (selCount.get(keyParams(key)) as { n: number }).n;
      },
      async getRun(runId) {
        const row = selRun.get(runId) as (SqliteRow & { replay: string }) | undefined;
        if (!row) return null;
        return { ...fromSqlite(row), name: fallbackName(row.user_id), replay: row.replay };
      },
      async listForUser(userId) {
        return (selUser.all(userId) as SqliteRow[]).map(fromSqlite);
      },
      async displayName(userId) {
        return fallbackName(userId);
      },
    };
  } catch (err) {
    console.warn("[hotlap] better-sqlite3 unavailable, local leaderboard disabled:", err);
    return null;
  }
}

// -------------------------------------------------------------- Supabase

type Admin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

interface PgRow {
  id: string;
  user_id: string;
  track_id: string;
  track_version: number;
  sim_version: number;
  time_ms: number;
  set_at: string;
}

const PG_COLS = "id, user_id, track_id, track_version, sim_version, time_ms, set_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fromPg(r: PgRow): StoredRecord {
  return {
    runId: r.id,
    userId: r.user_id,
    trackId: r.track_id,
    trackVersion: r.track_version,
    simVersion: r.sim_version,
    timeMs: r.time_ms,
    setAt: r.set_at,
  };
}

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) {
    const err = new Error(`supabase: ${res.error.message}`) as Error & { code?: string };
    err.code = res.error.code;
    throw err;
  }
  return res.data;
}

function createSupabaseStore(admin: Admin): HotlapStore {
  const table = () => admin.from("hotlap_records");
  // Select from the table already filtered to one board (track + versions).
  const board = (k: BoardKey, cols: string, opts?: { count: "exact"; head: true }) =>
    table()
      .select(cols, opts)
      .eq("track_id", k.trackId)
      .eq("track_version", k.trackVersion)
      .eq("sim_version", k.simVersion);

  async function getBest(userId: string, key: BoardKey): Promise<StoredRecord | null> {
    const row = check(
      await board(key, PG_COLS).eq("user_id", userId).maybeSingle(),
    ) as PgRow | null;
    return row ? fromPg(row) : null;
  }

  async function names(userIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (userIds.length === 0) return map;
    const rows = check(
      await admin.from("profiles").select("id, username, display_name").in("id", userIds),
    ) as { id: string; username: string | null; display_name: string | null }[];
    for (const r of rows) map.set(r.id, r.username || r.display_name || fallbackName(r.id));
    return map;
  }

  return {
    kind: "supabase",
    getBest,
    async submit(userId, key, timeMs, replay) {
      // Rate limiting already serializes a user's submissions; the guarded
      // update below still refuses to overwrite a faster concurrent record.
      for (let attempt = 0; attempt < 2; attempt++) {
        const prev = await getBest(userId, key);
        const setAt = new Date().toISOString();
        if (!prev) {
          const res = await table()
            .insert({
              id: randomUUID(),
              user_id: userId,
              track_id: key.trackId,
              track_version: key.trackVersion,
              sim_version: key.simVersion,
              time_ms: timeMs,
              replay,
              set_at: setAt,
            })
            .select(PG_COLS)
            .single();
          if (res.error?.code === "23505") continue; // raced a first insert — re-read
          return { improved: true, previousMs: null, record: fromPg(check(res) as PgRow) };
        }
        if (prev.timeMs <= timeMs) return { improved: false, previousMs: prev.timeMs, record: prev };
        const row = check(
          await table()
            .update({ id: randomUUID(), time_ms: timeMs, replay, set_at: setAt })
            .eq("id", prev.runId)
            .gt("time_ms", timeMs)
            .select(PG_COLS)
            .maybeSingle(),
        ) as PgRow | null;
        if (row) return { improved: true, previousMs: prev.timeMs, record: fromPg(row) };
        // A faster record landed between the read and the update — re-read.
      }
      const best = await getBest(userId, key);
      if (!best) throw new Error("supabase: record vanished during submit");
      return { improved: false, previousMs: best.timeMs, record: best };
    },
    async top(key, limit) {
      const rows = check(
        await board(key, PG_COLS)
          .order("time_ms", { ascending: true })
          .order("set_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(limit),
      ) as unknown as PgRow[];
      const nameOf = await names([...new Set(rows.map((r) => r.user_id))]);
      return rows.map((r) => ({ ...fromPg(r), name: nameOf.get(r.user_id) ?? fallbackName(r.user_id) }));
    },
    async rankOf(rec) {
      const res = await board(rec, "id", { count: "exact", head: true }).or(
        `time_ms.lt.${rec.timeMs},and(time_ms.eq.${rec.timeMs},set_at.lt."${rec.setAt}")`,
      );
      check(res);
      return (res.count ?? 0) + 1;
    },
    async count(key) {
      const res = await board(key, "id", { count: "exact", head: true });
      check(res);
      return res.count ?? 0;
    },
    async getRun(runId) {
      if (!UUID_RE.test(runId)) return null;
      const row = check(
        await table().select(`${PG_COLS}, replay`).eq("id", runId).maybeSingle(),
      ) as (PgRow & { replay: string }) | null;
      if (!row) return null;
      const nameOf = await names([row.user_id]);
      return {
        ...fromPg(row),
        name: nameOf.get(row.user_id) ?? fallbackName(row.user_id),
        replay: row.replay,
      };
    },
    async listForUser(userId) {
      const rows = check(await table().select(PG_COLS).eq("user_id", userId)) as PgRow[];
      return rows.map(fromPg);
    },
    async displayName(userId) {
      return (await names([userId])).get(userId) ?? fallbackName(userId);
    },
  };
}

// ------------------------------------------------------------- selection

/**
 * Pick the store: HOTLAP_STORE=sqlite forces SQLite; otherwise Supabase when
 * the service role is configured, else SQLite. Returns null when nothing is
 * available (the routes then answer 503).
 */
export async function createHotlapStore(sqlitePath: string): Promise<HotlapStore | null> {
  const forced = process.env.HOTLAP_STORE?.toLowerCase();
  const admin = forced === "sqlite" ? null : getSupabaseAdmin();
  if (admin) {
    console.log("[hotlap] leaderboard store: supabase");
    return createSupabaseStore(admin);
  }
  if (forced === "supabase") {
    console.warn("[hotlap] HOTLAP_STORE=supabase but Supabase is not configured; using SQLite");
  }
  const store = await createSqliteStore(sqlitePath);
  if (store) console.log("[hotlap] leaderboard store: sqlite");
  return store;
}

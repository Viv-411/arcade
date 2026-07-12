import fs from "node:fs";
import path from "node:path";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

export interface GameParticipant {
  /** Per-room player id (anonymous, per tab). */
  id: string;
  name: string;
  /** Supabase user id when the player was signed in; games with it are also
   *  recorded durably to the player_stats table in Postgres. */
  userId?: string | null;
}

export interface StatsStore {
  /** Record a finished game: bump gamesPlayed for everyone, wins for winners. */
  recordGame(participants: GameParticipant[], winnerIds: string[], game: string): void;
  getWins(playerId: string): number;
}

const noopStats: StatsStore = {
  recordGame() {},
  getWins() {
    return 0;
  },
};

/**
 * Per-account stats go to Supabase Postgres via the record_game_result
 * function (service role only — clients cannot execute it). Fire-and-forget:
 * game flow never waits on, or fails because of, stats writes.
 */
function recordToSupabase(
  participants: GameParticipant[],
  winnerIds: string[],
  game: string,
): void {
  const admin = getSupabaseAdmin();
  if (!admin) return;
  for (const p of participants) {
    if (!p.userId) continue;
    void admin
      .rpc("record_game_result", {
        p_user_id: p.userId,
        p_game: game,
        p_won: winnerIds.includes(p.id),
      })
      .then(({ error }) => {
        if (error) console.warn("[stats] supabase record failed:", error.message);
      });
  }
}

/**
 * Local per-player win stats in SQLite (anonymous players, per-tab ids; used
 * for the Mind Meld win screen). Loaded dynamically so a failed native-module
 * install degrades to a no-op instead of crashing the server. Account-level
 * stats additionally go to Supabase regardless of which path loads.
 */
export async function createStatsStore(dbPath: string): Promise<StatsStore> {
  let base: StatsStore = noopStats;
  try {
    const { default: Database } = await import("better-sqlite3");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS player_stats (
        player_id    TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        wins         INTEGER NOT NULL DEFAULT 0,
        games_played INTEGER NOT NULL DEFAULT 0
      )
    `);
    const upsert = db.prepare(`
      INSERT INTO player_stats (player_id, name, wins, games_played)
      VALUES (@id, @name, @win, 1)
      ON CONFLICT(player_id) DO UPDATE SET
        name = @name,
        wins = wins + @win,
        games_played = games_played + 1
    `);
    const selectWins = db.prepare(
      "SELECT wins FROM player_stats WHERE player_id = ?",
    );
    const recordMany = db.transaction(
      (participants: GameParticipant[], winnerIds: string[]) => {
        for (const p of participants) {
          upsert.run({ id: p.id, name: p.name, win: winnerIds.includes(p.id) ? 1 : 0 });
        }
      },
    );
    base = {
      recordGame(participants, winnerIds) {
        try {
          recordMany(participants, winnerIds);
        } catch (err) {
          console.warn("[stats] failed to record game:", err);
        }
      },
      getWins(playerId) {
        const row = selectWins.get(playerId) as { wins: number } | undefined;
        return row?.wins ?? 0;
      },
    };
  } catch (err) {
    console.warn("[stats] better-sqlite3 unavailable, local win stats disabled:", err);
  }

  return {
    recordGame(participants, winnerIds, game) {
      base.recordGame(participants, winnerIds, game);
      recordToSupabase(participants, winnerIds, game);
    },
    getWins(playerId) {
      return base.getWins(playerId);
    },
  };
}

import fs from "node:fs";
import path from "node:path";

export interface StatsStore {
  /** Record a finished game: bump gamesPlayed for everyone, wins for winners. */
  recordGame(participants: { id: string; name: string }[], winnerIds: string[]): void;
  getWins(playerId: string): number;
}

const noopStats: StatsStore = {
  recordGame() {},
  getWins() {
    return 0;
  },
};

/**
 * Per-player win stats in a local SQLite file via better-sqlite3.
 * Loaded dynamically so a failed native-module install degrades to a no-op
 * instead of crashing the server.
 */
export async function createStatsStore(dbPath: string): Promise<StatsStore> {
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
      (participants: { id: string; name: string }[], winnerIds: string[]) => {
        for (const p of participants) {
          upsert.run({ id: p.id, name: p.name, win: winnerIds.includes(p.id) ? 1 : 0 });
        }
      },
    );
    return {
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
    console.warn("[stats] better-sqlite3 unavailable, win stats disabled:", err);
    return noopStats;
  }
}

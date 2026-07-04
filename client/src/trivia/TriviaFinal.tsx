import { Link } from "react-router-dom";
import type { ScoreboardEntry, TriviaSnapshot } from "@shared/trivia";

interface Props {
  room: TriviaSnapshot;
  playerId: string | null;
  final: { finalScoreboard: ScoreboardEntry[]; winners: ScoreboardEntry[]; reason?: string } | null;
  onPlayAgain: () => void;
  onLeave: () => void;
}

export default function TriviaFinal({ room, playerId, final, onPlayAgain, onLeave }: Props) {
  const scoreboard = final?.finalScoreboard ?? room.scoreboard;
  const winners = final?.winners ?? room.winners ?? [];
  const reason = final?.reason ?? room.gameOverReason;

  return (
    <div className="panel end-screen">
      <h2 className="win-title">🏆 {winners.length > 1 ? "It's a tie!" : "Winner!"}</h2>
      <p className="win-word trivia-winner">
        {winners.length > 0 ? winners.map((w) => w.name).join(" & ") : "Nobody"}
      </p>
      {winners.length > 0 && (
        <p className="win-rounds">
          {winners[0].totalScore} point{winners[0].totalScore === 1 ? "" : "s"}
        </p>
      )}
      {reason && <p className="hint">Game ended early: {reason}</p>}

      <ol className="scoreboard final">
        {scoreboard.map((e, rank) => (
          <li key={e.playerId} className={e.playerId === playerId ? "me" : ""}>
            <span className="rank">
              {rank === 0 ? "🥇" : rank === 1 ? "🥈" : rank === 2 ? "🥉" : `#${rank + 1}`}
            </span>
            <span className="player-name">
              {e.name}
              {e.playerId === playerId && " (you)"}
            </span>
            <span className="total-score">{e.totalScore}</span>
          </li>
        ))}
      </ol>

      <div className="lobby-buttons">
        <button className="btn primary" onClick={onPlayAgain}>
          🔁 Play again
        </button>
        <Link to="/" className="btn" onClick={onLeave}>
          🕹 Back to arcade
        </Link>
      </div>
    </div>
  );
}

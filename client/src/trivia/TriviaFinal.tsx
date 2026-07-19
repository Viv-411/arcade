import { Link } from "react-router-dom";
import type { ScoreboardEntry, TriviaSnapshot } from "@shared/trivia";
import Icon from "../components/Icon";

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
      <h2 className="win-title"><Icon name="trophy" /> {winners.length > 1 ? "It's a tie!" : "Winner!"}</h2>
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
              {rank === 0 ? <Icon name="trophy" className="ic-yellow" label="1st" /> : rank === 1 ? <Icon name="star" label="2nd" /> : rank === 2 ? <Icon name="sparkle" label="3rd" /> : `#${rank + 1}`}
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
          <Icon name="repeat" /> Play again
        </button>
        <Link to="/" className="btn" onClick={onLeave}>
          <Icon name="gamepad" /> Back to arcade
        </Link>
      </div>
    </div>
  );
}

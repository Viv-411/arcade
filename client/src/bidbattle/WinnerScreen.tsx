import { Link } from "react-router-dom";
import type { BidBattleSnapshot, TeamId } from "@shared/bidbattle";
import Icon from "../components/Icon";

interface Props {
  room: BidBattleSnapshot;
  myTeam: TeamId | null;
  winner: { winnerTeam: TeamId; scores: Record<TeamId, number>; reason?: string } | null;
  onPlayAgain: () => void;
  onLeave: () => void;
}

export default function WinnerScreen({ room, myTeam, winner, onPlayAgain, onLeave }: Props) {
  const winnerTeam = winner?.winnerTeam ?? room.winnerTeam;
  const scores = winner?.scores ?? room.scores;
  const reason = winner?.reason ?? room.gameOverReason;
  const won = myTeam !== null && myTeam === winnerTeam;

  return (
    <div className="panel end-screen">
      <h2 className="win-title"><Icon name="trophy" /> Team {winnerTeam} wins!</h2>
      <p className="win-word trivia-winner">{won ? "Victory!" : myTeam ? "Defeat…" : ""}</p>
      <p className="win-rounds">
        Final score: Team A {scores.A} — {scores.B} Team B
      </p>
      {reason && <p className="hint">{reason}</p>}

      <ul className="player-list summary">
        {room.players.map((p) => (
          <li key={p.id}>
            <span className="player-name">
              {p.name}
              {p.id === room.hostId && <> <Icon name="crown" className="ic-yellow" label="Host" /></>}
            </span>
            <span className={`badge ${p.team === winnerTeam ? "ready-badge" : "waiting-badge"}`}>
              Team {p.team}
            </span>
          </li>
        ))}
      </ul>

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

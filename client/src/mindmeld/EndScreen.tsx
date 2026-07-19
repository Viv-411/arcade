import { Link } from "react-router-dom";
import type { PublicPlayer, RoomSnapshot } from "@shared/types";
import Icon from "../components/Icon";

interface Props {
  room: RoomSnapshot;
  playerId: string | null;
  win: { word: string; rounds: number; players: PublicPlayer[] } | null;
  onPlayAgain: () => void;
  onLeave: () => void;
}

export default function EndScreen({ room, playerId, win, onPlayAgain, onLeave }: Props) {
  const winner = win ?? (room.winner ? { ...room.winner, players: room.players } : null);

  return (
    <div className="panel end-screen">
      {winner ? (
        <>
          <h2 className="win-title"><Icon name="lightbulb" /><Icon name="zap" /> MIND MELD!</h2>
          <p className="win-word">{winner.word}</p>
          <p className="win-rounds">
            Melded in <strong>{winner.rounds}</strong> round{winner.rounds === 1 ? "" : "s"}
          </p>
        </>
      ) : (
        <>
          <h2 className="lose-title">Game over</h2>
          <p>{room.gameOverReason ?? "The game ended."}</p>
        </>
      )}

      <ul className="player-list summary">
        {winner
          ? winner.players.map((p) => (
              <li key={p.id}>
                <span className="player-name">
                  {p.name}
                  {p.id === playerId && " (you)"}
                </span>
                {typeof p.wins === "number" && (
                  <span className="badge ready-badge"><Icon name="trophy" /> {p.wins} win{p.wins === 1 ? "" : "s"}</span>
                )}
              </li>
            ))
          : room.players.map((p) => (
              <li key={p.id}>
                <span className="player-name">
                  {p.name}
                  {p.id === playerId && " (you)"}
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

import { useEffect, useState } from "react";
import type { RoomSnapshot } from "@shared/types";
import { MAX_PLAYERS, MIN_PLAYERS } from "@shared/types";

interface Props {
  room: RoomSnapshot;
  playerId: string | null;
  onToggleReady: () => void;
  onStart: () => void;
  onLeave: () => void;
}

function useCountdown(endsAt: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) {
      setLeft(null);
      return;
    }
    const update = () => setLeft(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    update();
    const t = setInterval(update, 250);
    return () => clearInterval(t);
  }, [endsAt]);
  return left;
}

export default function Lobby({ room, playerId, onToggleReady, onStart, onLeave }: Props) {
  const [copied, setCopied] = useState(false);
  const me = room.players.find((p) => p.id === playerId);
  const isHost = playerId === room.hostId;
  const allReady = room.players.every((p) => p.ready);
  const canStart =
    isHost && allReady && room.players.length >= MIN_PLAYERS && room.players.length <= MAX_PLAYERS;
  const autoStartIn = useCountdown(room.lobbyCountdownEndsAt);

  const shareLink = `${window.location.origin}/mindmeld?room=${room.code}`;
  const copyLink = () => {
    navigator.clipboard.writeText(shareLink).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  return (
    <div className="lobby panel">
      <div className="room-code-box">
        <span className="room-code-label">
          {room.isPublic ? "Public room" : "Private room"}
        </span>
        <span className="room-code">{room.code}</span>
        <button className="btn small" onClick={copyLink}>
          {copied ? "✓ Copied!" : "Copy invite link"}
        </button>
      </div>

      {autoStartIn !== null && (
        <p className="auto-start">🚀 Auto-starting in {autoStartIn}s…</p>
      )}

      <ul className="player-list">
        {room.players.map((p) => (
          <li key={p.id} className={p.connected ? "" : "disconnected"}>
            <span className={`dot ${p.connected ? "on" : "off"}`} />
            <span className="player-name">
              {p.name}
              {p.id === room.hostId && " 👑"}
              {p.id === playerId && " (you)"}
            </span>
            <span className={`badge ${p.ready ? "ready-badge" : "waiting-badge"}`}>
              {p.ready ? "Ready" : "Not ready"}
            </span>
          </li>
        ))}
        {Array.from({ length: MAX_PLAYERS - room.players.length }).map((_, i) => (
          <li key={`empty-${i}`} className="empty-slot">
            Waiting for player…
          </li>
        ))}
      </ul>

      <div className="lobby-buttons">
        <button className={`btn ${me?.ready ? "" : "primary"}`} onClick={onToggleReady}>
          {me?.ready ? "Unready" : "I'm ready!"}
        </button>
        {isHost && (
          <button className="btn primary" disabled={!canStart} onClick={onStart}>
            ▶ Start game
          </button>
        )}
        <button className="btn danger" onClick={onLeave}>
          Leave
        </button>
      </div>

      {isHost && !canStart && (
        <p className="hint">
          {room.players.length < MIN_PLAYERS
            ? "Need at least 2 players to start."
            : !allReady
              ? "Waiting for everyone to be ready."
              : ""}
        </p>
      )}

      <p className="settings-line">
        ⏱ {room.settings.roundTimeSec}s rounds · max{" "}
        {room.settings.maxRounds === 0 ? "∞" : room.settings.maxRounds} rounds · match:{" "}
        {room.settings.matchMode}
      </p>
    </div>
  );
}

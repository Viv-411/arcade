import { useState } from "react";
import { bidBattleModeSize, type BidBattleMode, type BidBattleSnapshot, type TeamId } from "@shared/bidbattle";
import { useSecondsLeft } from "../core/hooks";

interface Props {
  room: BidBattleSnapshot;
  playerId: string | null;
  onSetMode: (mode: BidBattleMode) => void;
  onAssignTeam: (team: TeamId) => void;
  onToggleReady: () => void;
  onStart: () => void;
  onLeave: () => void;
}

export default function BidBattleLobby({
  room,
  playerId,
  onSetMode,
  onAssignTeam,
  onToggleReady,
  onStart,
  onLeave,
}: Props) {
  const [copied, setCopied] = useState(false);
  const me = room.players.find((p) => p.id === playerId);
  const isHost = playerId === room.hostId;
  const half = bidBattleModeSize(room.settings.mode) / 2;
  const teams: TeamId[] = ["A", "B"];
  const balanced = teams.every(
    (t) => room.players.filter((p) => p.team === t).length === half,
  );
  const allReady = room.players.every((p) => p.ready);
  const canStart =
    isHost && allReady && balanced && room.players.length === bidBattleModeSize(room.settings.mode);
  const autoStartIn = useSecondsLeft(room.lobbyCountdownEndsAt);

  const shareLink = `${window.location.origin}/bidbattle?room=${room.code}`;
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
          {room.isPublic ? "Public room" : "Private room"} · {room.settings.mode}
        </span>
        <span className="room-code">{room.code}</span>
        <button className="btn small" onClick={copyLink}>
          {copied ? "✓ Copied!" : "Copy invite link"}
        </button>
      </div>

      {isHost && !room.isPublic && (
        <div className="mode-toggle-row">
          <span className="field-label">Mode:</span>
          <div className="mode-toggle">
            {(["1v1", "2v2"] as const).map((m) => (
              <button
                key={m}
                className={`btn small ${room.settings.mode === m ? "primary" : ""}`}
                onClick={() => onSetMode(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {autoStartIn !== null && <p className="auto-start">🚀 Auto-starting in {autoStartIn}s…</p>}

      <div className="team-panels">
        {teams.map((t) => {
          const members = room.players.filter((p) => p.team === t);
          return (
            <div key={t} className={`team-panel team-${t.toLowerCase()}`}>
              <h3>Team {t}</h3>
              <ul className="player-list">
                {members.map((p) => (
                  <li key={p.id} className={p.connected ? "" : "disconnected"}>
                    <span className={`dot ${p.connected ? "on" : "off"}`} />
                    <span className="player-name">
                      {p.name}
                      {p.id === room.hostId && " 👑"}
                      {p.id === playerId && " (you)"}
                    </span>
                    <span className={`badge ${p.ready ? "ready-badge" : "waiting-badge"}`}>
                      {p.ready ? "Ready" : "…"}
                    </span>
                  </li>
                ))}
                {Array.from({ length: half - members.length }).map((_, i) => (
                  <li key={`e${i}`} className="empty-slot">
                    open slot
                  </li>
                ))}
              </ul>
              {me && me.team !== t && members.length < half && (
                <button className="btn small" onClick={() => onAssignTeam(t)}>
                  Join Team {t}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="lobby-buttons">
        <button className={`btn ${me?.ready ? "" : "primary"}`} onClick={onToggleReady}>
          {me?.ready ? "Unready" : "I'm ready!"}
        </button>
        {isHost && (
          <button className="btn primary" disabled={!canStart} onClick={onStart}>
            ▶ Start match
          </button>
        )}
        <button className="btn danger" onClick={onLeave}>
          Leave
        </button>
      </div>

      {isHost && !canStart && (
        <p className="hint">
          {room.players.length < bidBattleModeSize(room.settings.mode)
            ? `Waiting for ${bidBattleModeSize(room.settings.mode) - room.players.length} more player(s) — share the code!`
            : !balanced
              ? "Teams must be balanced."
              : "Waiting for everyone to be ready."}
        </p>
      )}
      <p className="settings-line">
        🏆 first to {room.settings.targetPoints} · ⏱ {room.settings.bidTurnSec}s bids ·{" "}
        {room.settings.deliverySec}s naming sprint
      </p>
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { MAX_PLAYERS, MIN_PLAYERS } from "@shared/types";
import type { GameKey } from "@shared/social";
import type { BaseSnapshotShape } from "../core/useRoomCore";
import { useSecondsLeft } from "../core/hooks";
import InviteFriends from "../social/InviteFriends";

interface Props {
  room: BaseSnapshotShape;
  playerId: string | null;
  /** Client route for share links, e.g. "/mindmeld". */
  joinPath: string;
  /** One-line summary of the room settings. */
  settingsLine: string;
  /** Extra lobby controls (e.g. a host-only difficulty selector). */
  extras?: ReactNode;
  /** Player limits for this game (defaults: 2-4). */
  minPlayers?: number;
  maxPlayers?: number;
  /** Social game key when it differs from the route (e.g. imposter). */
  gameKey?: GameKey;
  onToggleReady: () => void;
  onStart: () => void;
  onLeave: () => void;
}

/** Don't render a wall of placeholders in big lobbies. */
const MAX_EMPTY_SLOTS_SHOWN = 3;

/** Shared lobby: room code, share link, player list with ready states, host start. */
export default function GameLobby({
  room,
  playerId,
  joinPath,
  settingsLine,
  extras,
  minPlayers = MIN_PLAYERS,
  maxPlayers = MAX_PLAYERS,
  gameKey,
  onToggleReady,
  onStart,
  onLeave,
}: Props) {
  const [copied, setCopied] = useState(false);
  const me = room.players.find((p) => p.id === playerId);
  const isHost = playerId === room.hostId;
  const allReady = room.players.every((p) => p.ready);
  const canStart =
    isHost && allReady && room.players.length >= minPlayers && room.players.length <= maxPlayers;
  const autoStartIn = useSecondsLeft(room.lobbyCountdownEndsAt);
  const openSlots = Math.max(0, maxPlayers - room.players.length);
  const shownSlots = Math.min(openSlots, MAX_EMPTY_SLOTS_SHOWN);

  const shareLink = `${window.location.origin}${joinPath}?room=${room.code}`;
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

      <InviteFriends
        game={gameKey ?? (joinPath.slice(1) as GameKey)}
        code={room.code}
        openSeats={Math.max(0, maxPlayers - room.players.length)}
      />

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
        {Array.from({ length: shownSlots }).map((_, i) => (
          <li key={`empty-${i}`} className="empty-slot">
            Waiting for player…
          </li>
        ))}
        {openSlots > shownSlots && (
          <li className="empty-slot">…room for {openSlots - shownSlots} more</li>
        )}
      </ul>

      {extras}

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
          {room.players.length < minPlayers
            ? `Need at least ${minPlayers} players to start.`
            : !allReady
              ? "Waiting for everyone to be ready."
              : ""}
        </p>
      )}

      <p className="settings-line">{settingsLine}</p>
    </div>
  );
}

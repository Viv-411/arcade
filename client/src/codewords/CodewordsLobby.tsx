import { useState } from "react";
import {
  CODEWORDS_REMOTE_MAX_PLAYERS,
  CODEWORDS_REMOTE_MIN_PLAYERS,
  cwTeamLabel,
  type CodewordsSnapshot,
  type CwTeam,
} from "@shared/codewords";
import { useSecondsLeft } from "../core/hooks";
import InviteFriends from "../social/InviteFriends";
import Icon from "../components/Icon";

interface Props {
  room: CodewordsSnapshot;
  playerId: string | null;
  onAssignTeam: (team: CwTeam) => void;
  onSetSpymaster: (playerId: string) => void;
  onToggleReady: () => void;
  onStart: () => void;
  onLeave: () => void;
}

const TEAMS: CwTeam[] = ["red", "blue"];

/** Remote-mode lobby: red/blue panels with per-team spymaster selection. */
export default function CodewordsLobby({
  room,
  playerId,
  onAssignTeam,
  onSetSpymaster,
  onToggleReady,
  onStart,
  onLeave,
}: Props) {
  const [copied, setCopied] = useState(false);
  const me = room.players.find((p) => p.id === playerId);
  const isHost = playerId === room.hostId;
  const allReady = room.players.every((p) => p.ready);
  const teamsValid = TEAMS.every((t) => {
    const members = room.players.filter((p) => p.team === t);
    return (
      members.some((p) => p.role === "spymaster") &&
      members.some((p) => p.role === "operative")
    );
  });
  const canStart =
    isHost &&
    allReady &&
    teamsValid &&
    room.players.length >= CODEWORDS_REMOTE_MIN_PLAYERS &&
    room.players.length <= CODEWORDS_REMOTE_MAX_PLAYERS;
  const autoStartIn = useSecondsLeft(room.lobbyCountdownEndsAt);

  const shareLink = `${window.location.origin}/codewords/remote?room=${room.code}`;
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
          {copied ? <><Icon name="check" /> Copied!</> : "Copy invite link"}
        </button>
      </div>

      {autoStartIn !== null && <p className="auto-start"><Icon name="clock" /> Auto-starting in {autoStartIn}s…</p>}

      <InviteFriends
        game="codewords"
        code={room.code}
        openSeats={Math.max(0, CODEWORDS_REMOTE_MAX_PLAYERS - room.players.length)}
      />

      <div className="team-panels">
        {TEAMS.map((t) => {
          const members = room.players.filter((p) => p.team === t);
          return (
            <div key={t} className={`team-panel team-${t}`}>
              <h3>{t === "red" ? <><Icon name="circle" className="ic-red" /> Red</> : <><Icon name="circle" className="ic-blue" /> Blue</>}</h3>
              <ul className="player-list">
                {members.map((p) => (
                  <li key={p.id} className={p.connected ? "" : "disconnected"}>
                    <span className={`dot ${p.connected ? "on" : "off"}`} />
                    <span className="player-name">
                      {p.role === "spymaster" && <><Icon name="eye" label="Spymaster" />{" "}</>}
                      {p.name}
                      {p.id === room.hostId && <> <Icon name="crown" className="ic-yellow" label="Host" /></>}
                      {p.id === playerId && " (you)"}
                    </span>
                    {p.role !== "spymaster" && (isHost || p.id === playerId) && (
                      <button
                        className="btn small"
                        title={`Make ${p.name} the ${cwTeamLabel(t)} spymaster`}
                        onClick={() => onSetSpymaster(p.id)}
                      >
                        Spymaster
                      </button>
                    )}
                    <span className={`badge ${p.ready ? "ready-badge" : "waiting-badge"}`}>
                      {p.ready ? "Ready" : "…"}
                    </span>
                  </li>
                ))}
                {members.length === 0 && <li className="empty-slot">nobody yet</li>}
              </ul>
              {me && me.team !== t && (
                <button className="btn small" onClick={() => onAssignTeam(t)}>
                  Join {cwTeamLabel(t)}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="hint">
        Each team needs a <Icon name="eye" /> spymaster — tap the "Spymaster" button on your row to claim
        the role — and at least one operative.
      </p>

      <div className="lobby-buttons">
        <button className={`btn ${me?.ready ? "" : "primary"}`} onClick={onToggleReady}>
          {me?.ready ? "Unready" : "I'm ready!"}
        </button>
        {isHost && (
          <button className="btn primary" disabled={!canStart} onClick={onStart}>
            <Icon name="play" /> Start game
          </button>
        )}
        <button className="btn danger" onClick={onLeave}>
          Leave
        </button>
      </div>

      {isHost && !canStart && (
        <p className="hint">
          {room.players.length < CODEWORDS_REMOTE_MIN_PLAYERS
            ? `Need at least ${CODEWORDS_REMOTE_MIN_PLAYERS} players — share the code!`
            : !teamsValid
              ? "Both teams need a spymaster and at least one operative."
              : !allReady
                ? "Waiting for everyone to be ready."
                : ""}
        </p>
      )}

      <p className="settings-line"><Icon name="square" className="ic-red" /><Icon name="square" className="ic-blue" /> 5x5 board · 9 vs 8 agents · beware the <Icon name="skull" /></p>
    </div>
  );
}

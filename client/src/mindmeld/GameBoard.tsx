import { useEffect, useState } from "react";
import type { RevealEntry, RoomSnapshot } from "@shared/types";
import { normalizeWord } from "@shared/normalize";
import Icon from "../components/Icon";

interface Props {
  room: RoomSnapshot;
  playerId: string | null;
  myWord: { raw: string; normalized: string } | null;
  reveal: { round: number; entries: RevealEntry[]; isWin: boolean } | null;
  revealSecondsLeft: number | null;
  onLockIn: (word: string) => void;
  onUnlock: () => void;
  onLeave: () => void;
}

function useTimeLeft(deadline: number | null): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!deadline) {
      setLeft(null);
      return;
    }
    const update = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    const t = setInterval(update, 250);
    return () => clearInterval(t);
  }, [deadline]);
  return left;
}

export default function GameBoard({
  room,
  playerId,
  myWord,
  reveal,
  revealSecondsLeft,
  onLockIn,
  onUnlock,
  onLeave,
}: Props) {
  const [word, setWord] = useState("");
  const timeLeft = useTimeLeft(reveal ? null : room.deadline);
  const locked = myWord !== null;

  // Clear the input when a new round starts (deadline changes).
  useEffect(() => {
    setWord("");
  }, [room.roundNumber]);

  const normalized = normalizeWord(word, room.settings.matchMode);
  const alreadyUsed = normalized.length > 0 && room.usedWords.includes(normalized);
  const canLock = !locked && normalized.length > 0 && !alreadyUsed && !reveal;

  const submit = () => {
    if (canLock) onLockIn(word);
  };

  const pastRounds = [...room.history].sort((a, b) => b.round - a.round);

  return (
    <div className="game-board">
      <div className="round-bar panel">
        <div className="round-info">
          <span className="round-number">Round {room.roundNumber}</span>
          {room.settings.maxRounds > 0 && (
            <span className="round-max">/ {room.settings.maxRounds}</span>
          )}
        </div>
        <div className={`timer ${timeLeft !== null && timeLeft <= 10 ? "urgent" : ""}`}>
          {reveal ? "—" : timeLeft !== null ? `${timeLeft}s` : "…"}
        </div>
        <button className="btn small danger" onClick={onLeave}>
          Leave
        </button>
      </div>

      <div className="players-bar">
        {room.players.map((p) => (
          <div
            key={p.id}
            className={`player-chip ${p.lockedIn ? "locked" : ""} ${p.connected ? "" : "disconnected"}`}
            title={p.connected ? "" : "disconnected"}
          >
            <span className={`dot ${p.connected ? "on" : "off"}`} />
            {p.name}
            {p.id === playerId && " (you)"}
            <span className="lock-icon">{p.lockedIn ? <Icon name="lock" /> : "…"}</span>
          </div>
        ))}
      </div>

      <div className="panel input-panel">
        {room.roundNumber === 1 && !locked && (
          <p className="hint">Round 1: throw out any random word to seed the meld!</p>
        )}
        {locked ? (
          <div className="locked-state">
            <p>
              Locked in: <strong className="my-word">{myWord.normalized}</strong>
            </p>
            <button className="btn" onClick={onUnlock} disabled={!!reveal}>
              <Icon name="unlock" /> Unlock &amp; edit
            </button>
          </div>
        ) : (
          <>
            <div className="word-row">
              <input
                value={word}
                placeholder="Your word…"
                maxLength={40}
                disabled={!!reveal}
                onChange={(e) => setWord(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              <button className="btn primary" disabled={!canLock} onClick={submit}>
                Lock in
              </button>
            </div>
            {normalized.length > 0 && normalized !== word && (
              <p className="normalized-preview">
                will count as: <code>{normalized}</code>
              </p>
            )}
            {alreadyUsed && (
              <p className="used-warning"><Icon name="warning" /> “{normalized}” already said — try another</p>
            )}
          </>
        )}
      </div>

      {room.usedWords.length > 0 && (
        <div className="panel used-words">
          <h3><Icon name="skull" /> Dead words ({room.usedWords.length})</h3>
          <div className="word-chips">
            {room.usedWords.map((w) => (
              <span key={w} className="word-chip dead">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {pastRounds.length > 0 && (
        <div className="panel history">
          <h3>Rounds so far</h3>
          {pastRounds.map((h) => (
            <div key={h.round} className="history-round">
              <span className="history-round-label">R{h.round}</span>
              <div className="history-entries">
                {h.entries.map((e) => (
                  <span key={e.playerId} className="history-entry">
                    <span className="history-name">{e.name}:</span>{" "}
                    <strong>{e.normalized}</strong>
                  </span>
                ))}
                {h.entries.length === 0 && <em>nobody locked in <Icon name="moon" /></em>}
              </div>
            </div>
          ))}
        </div>
      )}

      {reveal && (
        <div className="overlay reveal-overlay">
          <div className="panel reveal-panel">
            <h2>{reveal.isWin ? <><Icon name="lightbulb" /><Icon name="zap" /> MIND MELD!</> : `Round ${reveal.round} reveal`}</h2>
            <ul className="reveal-list">
              {reveal.entries.map((e) => (
                <li key={e.playerId}>
                  <span className="history-name">{e.name}</span>
                  <strong className="reveal-word">{e.normalized}</strong>
                </li>
              ))}
              {reveal.entries.length === 0 && <li>Nobody locked in this round <Icon name="moon" /></li>}
            </ul>
            {!reveal.isWin && revealSecondsLeft !== null && (
              <p className="next-round">Next round in {revealSecondsLeft}…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

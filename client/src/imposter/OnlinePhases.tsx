import { useState } from "react";
import { Link } from "react-router-dom";
import type {
  EliminationRecord,
  ImposterSide,
  ImposterSnapshot,
  YourRolePayload,
} from "@shared/imposter";
import { useSecondsLeft } from "../core/hooks";

export function RoleCard({ role }: { role: YourRolePayload }) {
  const imposter = role.role === "imposter";
  return (
    <div className={`role-card ${imposter ? "imposter" : "crew"}`}>
      {imposter ? (
        <>
          <span className="role-title">🕵️ You are the Imposter</span>
          {role.hint && (
            <span className="role-hint">
              Hint — the category is <strong>{role.hint}</strong>
            </span>
          )}
          <span className="role-sub">Blend in. Don't get caught.</span>
        </>
      ) : (
        <>
          <span className="role-title-small">The secret word is</span>
          <span className="role-word">{role.word}</span>
          <span className="role-sub">Give clues without giving it away.</span>
        </>
      )}
    </div>
  );
}

export function RevealScreen({
  room,
  myRole,
}: {
  room: ImposterSnapshot;
  myRole: YourRolePayload | null;
}) {
  const left = useSecondsLeft(room.phaseDeadline);
  return (
    <div className="panel imposter-reveal">
      <p className="hint">Your card — keep it to yourself! 🤫</p>
      {myRole ? <RoleCard role={myRole} /> : <div className="spinner" />}
      {myRole && (
        <p className="starting-player">
          🎤 <strong>{myRole.startingPlayerName}</strong> gives the first clue
        </p>
      )}
      {left !== null && <p className="next-round">Clues begin in {left}…</p>}
    </div>
  );
}

export function CluesScreen({
  room,
  playerId,
  myRole,
  onSubmitClue,
  onAdvanceTurn,
}: {
  room: ImposterSnapshot;
  playerId: string | null;
  myRole: YourRolePayload | null;
  onSubmitClue: (word: string, onResult?: (ok: boolean) => void) => void;
  onAdvanceTurn: () => void;
}) {
  const [word, setWord] = useState("");
  const left = useSecondsLeft(room.turnDeadline);
  const turnPlayer = room.players.find((p) => p.id === room.whoseTurn);
  const myTurn = room.whoseTurn === playerId;
  const iAmAlive = room.players.find((p) => p.id === playerId)?.alive ?? false;
  const spoken = room.settings.clueInputMode === "spoken";
  const isHost = playerId === room.hostId;

  const submit = () => {
    const w = word.trim();
    if (!w) return;
    onSubmitClue(w, (ok) => {
      if (ok) setWord("");
    });
  };

  return (
    <div className="panel imposter-clues">
      <div className="delivery-status">
        <span className="round-number">Clue round {room.round}</span>
        <div className={`timer ${left !== null && left <= 5 ? "urgent" : ""}`}>
          {left !== null ? `${left}s` : "…"}
        </div>
      </div>
      <p className={`turn-banner ${myTurn ? "my-turn" : ""}`}>
        {myTurn
          ? spoken
            ? "🎤 Your turn — say your clue out loud!"
            : "🎤 Your turn — type ONE word"
          : `${turnPlayer?.name ?? "…"} is giving a clue…`}
      </p>
      {!iAmAlive && <p className="hint">You were eliminated — spectating. 👻</p>}
      {myTurn && !spoken && (
        <div className="word-row">
          <input
            value={word}
            maxLength={24}
            autoFocus
            placeholder="one word…"
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
          <button className="btn primary" disabled={!word.trim()} onClick={submit}>
            Say it
          </button>
        </div>
      )}
      {spoken && (myTurn || isHost) && (
        <div className="lobby-buttons">
          <button className="btn primary" onClick={onAdvanceTurn}>
            ✅ Said it — next
          </button>
        </div>
      )}
      <ClueBoard room={room} />
      {myRole && <MiniCard role={myRole} />}
    </div>
  );
}

export function ClueBoard({ room }: { room: ImposterSnapshot }) {
  if (room.clueBoard.length === 0) return null;
  const spoken = room.settings.clueInputMode === "spoken";
  return (
    <div className="clue-board">
      {[...room.clueBoard].reverse().map((r) => (
        <div key={r.round} className="history-round">
          <span className="history-round-label">R{r.round}</span>
          <div className="history-entries">
            {r.entries.map((e, i) => (
              <span key={i} className="history-entry">
                <span className="history-name">{e.name}:</span>{" "}
                <strong>{e.word ?? (spoken ? "🗣" : "—")}</strong>
              </span>
            ))}
            {r.entries.length === 0 && <em>…</em>}
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniCard({ role }: { role: YourRolePayload }) {
  return (
    <p className="mini-card">
      {role.role === "imposter"
        ? `🕵️ imposter${role.hint ? ` · hint: ${role.hint}` : ""}`
        : `your word: ${role.word}`}
    </p>
  );
}

export function DecisionScreen({
  room,
  playerId,
  myDecision,
  onDecide,
}: {
  room: ImposterSnapshot;
  playerId: string | null;
  myDecision: "another" | "accuse" | null;
  onDecide: (c: "another" | "accuse") => void;
}) {
  const left = useSecondsLeft(room.phaseDeadline);
  const alive = room.players.find((p) => p.id === playerId)?.alive ?? false;
  return (
    <div className="panel vote-screen">
      <h2 className="screen-title">Keep going or accuse?</h2>
      <p className="hint">{left !== null ? `${left}s` : "…"} · majority accuse → vote</p>
      {alive ? (
        <div className="lobby-buttons">
          <button
            className={`btn ${myDecision === "another" ? "primary" : ""}`}
            onClick={() => onDecide("another")}
          >
            🔁 Another round
          </button>
          <button
            className={`btn ${myDecision === "accuse" ? "primary" : ""}`}
            onClick={() => onDecide("accuse")}
          >
            👉 Accuse now
          </button>
        </div>
      ) : (
        <p className="hint">Spectating… 👻</p>
      )}
      <ActedChips room={room} label="voted" />
      <ClueBoard room={room} />
    </div>
  );
}

export function VoteScreen({
  room,
  playerId,
  myVote,
  onVote,
}: {
  room: ImposterSnapshot;
  playerId: string | null;
  myVote: string | null;
  onVote: (targetId: string) => void;
}) {
  const left = useSecondsLeft(room.phaseDeadline);
  const alive = room.players.find((p) => p.id === playerId)?.alive ?? false;
  return (
    <div className="panel vote-screen">
      <h2 className="screen-title">{room.runoff ? "Runoff vote!" : "Who is the Imposter?"}</h2>
      <p className="hint">
        {left !== null ? `${left}s` : "…"} · votes stay hidden until the reveal
        {room.forced ? " · final vote!" : ""}
      </p>
      <div className="vote-options">
        {room.candidates
          .map((id) => room.players.find((p) => p.id === id))
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map((p) => (
            <button
              key={p.id}
              className={`btn vote-btn ${myVote === p.id ? "selected" : ""}`}
              disabled={!alive || p.id === playerId}
              onClick={() => onVote(p.id)}
            >
              <span className="vote-name">{p.name}</span>
              {p.id === playerId && <span className="vote-count">you</span>}
            </button>
          ))}
      </div>
      <ActedChips room={room} label="locked in" />
      <ClueBoard room={room} />
    </div>
  );
}

function ActedChips({ room, label }: { room: ImposterSnapshot; label: string }) {
  return (
    <div className="players-bar">
      {room.players
        .filter((p) => p.alive)
        .map((p) => (
          <div
            key={p.id}
            className={`player-chip ${p.acted ? "locked" : ""} ${p.connected ? "" : "disconnected"}`}
          >
            <span className={`dot ${p.connected ? "on" : "off"}`} />
            {p.name}
            <span className="lock-icon">{p.acted ? `✓ ${label}` : "…"}</span>
          </div>
        ))}
    </div>
  );
}

export function StealScreen({
  room,
  playerId,
  stealPrompt,
  onGuess,
}: {
  room: ImposterSnapshot;
  playerId: string | null;
  stealPrompt: { deadline: number } | null;
  onGuess: (word: string) => void;
}) {
  const [word, setWord] = useState("");
  const left = useSecondsLeft(room.phaseDeadline);
  const target = room.players.find((p) => p.id === room.stealTargetId);
  const itsMe = room.stealTargetId === playerId && stealPrompt;
  return (
    <div className="panel vote-screen">
      <h2 className="screen-title">🃏 Word Steal!</h2>
      <p>
        <strong>{target?.name ?? "The imposter"}</strong> was caught — but gets ONE guess at
        the secret word to steal the win!
      </p>
      <p className="hint">{left !== null ? `${left}s` : "…"}</p>
      {itsMe ? (
        <div className="word-row">
          <input
            value={word}
            maxLength={40}
            autoFocus
            placeholder="the secret word is…"
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && word.trim()) onGuess(word);
            }}
          />
          <button className="btn primary" disabled={!word.trim()} onClick={() => onGuess(word)}>
            Steal it
          </button>
        </div>
      ) : (
        <div className="spinner" />
      )}
    </div>
  );
}

export function FinalScreen({
  room,
  playerId,
  end,
  onPlayAgain,
  onLeave,
}: {
  room: ImposterSnapshot;
  playerId: string | null;
  end: {
    winningSide: ImposterSide | null;
    word: string;
    allRoles: EliminationRecord[];
    reason?: string;
  } | null;
  onPlayAgain: () => void;
  onLeave: () => void;
}) {
  const winners = end?.winningSide ?? room.winners;
  const word = end?.word ?? room.word ?? "?";
  const roles = end?.allRoles ?? room.allRoles ?? [];
  const reason = end?.reason ?? room.gameOverReason;
  const myRole = roles.find((r) => r.playerId === playerId)?.role;
  const iWon = myRole && winners && (winners === "imposters") === (myRole === "imposter");
  return (
    <div className="panel end-screen">
      <h2 className="win-title">
        {winners === "crew" ? "😇 Crew wins!" : winners === "imposters" ? "🕵️ Imposters win!" : "Game over"}
      </h2>
      {myRole && winners && (
        <p className="trivia-winner win-word">{iWon ? "Victory!" : "Defeat…"}</p>
      )}
      <p className="win-rounds">
        The word was <strong className="reveal-word">{word}</strong>
      </p>
      {reason && <p className="hint">{reason}</p>}
      <ul className="player-list summary">
        {roles.map((r) => (
          <li key={r.playerId}>
            <span className="player-name">
              {r.name}
              {r.playerId === playerId && " (you)"}
            </span>
            <span className={`badge ${r.role === "imposter" ? "waiting-badge" : "ready-badge"}`}>
              {r.role === "imposter" ? "🕵️ imposter" : "😇 crew"}
            </span>
          </li>
        ))}
      </ul>
      <ClueBoard room={room} />
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

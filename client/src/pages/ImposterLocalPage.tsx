import { useState } from "react";
import { Link } from "react-router-dom";
import { IMPOSTER_CATEGORIES, drawImposterWord } from "@shared/imposterWords";
import { RoleCard } from "../imposter/OnlinePhases";
import type { YourRolePayload } from "@shared/imposter";

interface Assignment {
  roles: ("imposter" | "crew")[];
  word: string;
  category: string;
  starterIdx: number;
}

function assign(count: number, imposters: number, category: string | null): Assignment {
  const idxs = Array.from({ length: count }, (_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  const imposterSet = new Set(idxs.slice(0, imposters));
  const drawn = drawImposterWord(category);
  return {
    roles: Array.from({ length: count }, (_, i) => (imposterSet.has(i) ? "imposter" : "crew")),
    word: drawn.word,
    category: drawn.category,
    starterIdx: Math.floor(Math.random() * count),
  };
}

/** Pass-and-play Imposter: everything lives in this component. Works offline. */
export default function ImposterLocalPage() {
  const [phase, setPhase] = useState<"setup" | "play" | "results">("setup");
  const [count, setCount] = useState(4);
  const [names, setNames] = useState<string[]>([]);
  const [imposters, setImposters] = useState(1);
  const [category, setCategory] = useState<string | null>(null);
  const [hints, setHints] = useState(true);
  const [game, setGame] = useState<Assignment | null>(null);
  const [viewed, setViewed] = useState<Set<number>>(new Set());
  const [card, setCard] = useState<{ idx: number; shown: boolean } | null>(null);

  const nameOf = (i: number) => names[i]?.trim() || `Player ${i + 1}`;
  const clampedImposters = Math.min(imposters, count - 1);
  const unwinnable = clampedImposters * 2 >= count;

  const start = () => {
    setGame(assign(count, clampedImposters, category));
    setViewed(new Set());
    setCard(null);
    setPhase("play");
  };

  const cardPayload = (idx: number): YourRolePayload | null => {
    if (!game) return null;
    const role = game.roles[idx];
    return {
      role,
      word: role === "crew" ? game.word : null,
      hint: role === "imposter" && hints ? game.category : null,
      startingPlayerName: nameOf(game.starterIdx),
    };
  };

  let body: JSX.Element;
  if (phase === "setup") {
    body = (
      <div className="panel">
        <h3 className="screen-title">Set up the round</h3>
        <label className="field">
          <span>Players</span>
          <select
            value={count}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCount(n);
              if (imposters >= n) setImposters(n - 1);
            }}
          >
            {Array.from({ length: 10 }, (_, i) => i + 3).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Imposters</span>
          <select value={clampedImposters} onChange={(e) => setImposters(Number(e.target.value))}>
            {Array.from({ length: count - 1 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {unwinnable && (
          <p className="used-warning">
            ⚠ {clampedImposters} imposter{clampedImposters === 1 ? "" : "s"} among {count} players
            is very hard for the crew to win.
          </p>
        )}
        <label className="field">
          <span>Category</span>
          <select value={category ?? ""} onChange={(e) => setCategory(e.target.value || null)}>
            <option value="">🎲 Random</option>
            {IMPOSTER_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Imposter hints (see the category)</span>
          <select value={hints ? "on" : "off"} onChange={(e) => setHints(e.target.value === "on")}>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
        <details className="local-names">
          <summary className="link-btn">Player names (optional)</summary>
          {Array.from({ length: count }, (_, i) => (
            <label key={i} className="field">
              <span>Player {i + 1}</span>
              <input
                value={names[i] ?? ""}
                maxLength={20}
                placeholder={`Player ${i + 1}`}
                onChange={(e) => {
                  const next = [...names];
                  next[i] = e.target.value;
                  setNames(next);
                }}
              />
            </label>
          ))}
        </details>
        <div className="lobby-buttons">
          <button className="btn primary" onClick={start}>
            ▶ Start
          </button>
        </div>
      </div>
    );
  } else if (phase === "play" && game) {
    const allViewed = viewed.size === count;
    body = (
      <div className="panel">
        <p className="starting-player">
          🎤 <strong>{nameOf(game.starterIdx)}</strong> gives the first clue
        </p>
        <p className="hint">
          Tap your name to see your card — make sure nobody else is looking, then pass the
          device on. Each card can only be viewed once.
        </p>
        <div className="local-grid">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              className={`btn local-name-btn ${viewed.has(i) ? "viewed" : ""}`}
              disabled={viewed.has(i)}
              onClick={() => setCard({ idx: i, shown: false })}
            >
              {viewed.has(i) ? "✓ " : ""}
              {nameOf(i)}
            </button>
          ))}
        </div>
        {allViewed ? (
          <>
            <p className="hint">
              Everyone has seen their card — play out loud! Give clues, debate, accuse. When
              you've decided, reveal the results.
            </p>
            <div className="lobby-buttons">
              <button className="btn primary" onClick={() => setPhase("results")}>
                🔍 Reveal results
              </button>
            </div>
          </>
        ) : (
          <p className="hint">
            {count - viewed.size} player{count - viewed.size === 1 ? " hasn't" : "s haven't"}{" "}
            looked yet.
          </p>
        )}
      </div>
    );
  } else {
    body = (
      <div className="panel end-screen">
        <h2 className="win-title">The reveal</h2>
        <p className="win-rounds">
          The word was <strong className="reveal-word">{game?.word}</strong>{" "}
          <span className="hint">({game?.category})</span>
        </p>
        <ul className="player-list summary">
          {game?.roles.map((role, i) => (
            <li key={i}>
              <span className="player-name">{nameOf(i)}</span>
              <span className={`badge ${role === "imposter" ? "waiting-badge" : "ready-badge"}`}>
                {role === "imposter" ? "🕵️ imposter" : "😇 crew"}
              </span>
            </li>
          ))}
        </ul>
        <div className="lobby-buttons">
          <button className="btn primary" onClick={start}>
            🔁 New round
          </button>
          <button className="btn" onClick={() => setPhase("setup")}>
            ⚙️ Back to setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page imposter">
      <header className="mm-header">
        <Link to="/imposter" className="back-link">
          ← Imposter
        </Link>
        <h1 className="mm-title">🕵️ On this device</h1>
      </header>
      {body}
      {card !== null && game && (
        <div className="overlay">
          <div className="panel reveal-panel">
            {!card.shown ? (
              <>
                <h2>Pass to {nameOf(card.idx)}</h2>
                <p className="hint">Make sure nobody else can see the screen. 🤫</p>
                <div className="lobby-buttons">
                  <button
                    className="btn primary"
                    onClick={() => setCard({ ...card, shown: true })}
                  >
                    I'm {nameOf(card.idx)} — show my card
                  </button>
                  <button className="btn" onClick={() => setCard(null)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <RoleCard role={cardPayload(card.idx)!} />
                <div className="lobby-buttons">
                  <button
                    className="btn primary"
                    onClick={() => {
                      setViewed(new Set([...viewed, card.idx]));
                      setCard(null);
                    }}
                  >
                    🙈 Hide — pass to next
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

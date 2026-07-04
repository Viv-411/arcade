import { Link } from "react-router-dom";

const COMING_SOON = [
  { name: "Sketch Wars", emoji: "🎨", blurb: "Draw fast, guess faster." },
  { name: "Word Duel", emoji: "⚔️", blurb: "Head-to-head word battles." },
];

export default function Home() {
  return (
    <div className="page home">
      <header className="home-header">
        <h1 className="arcade-title">
          <span className="neon-pink">AR</span>
          <span className="neon-cyan">CA</span>
          <span className="neon-yellow">DE</span>
        </h1>
        <p className="tagline">Party games to play with friends, live in your browser.</p>
      </header>

      <div className="game-grid">
        <Link to="/mindmeld" className="game-card active">
          <div className="game-emoji">🧠</div>
          <h2>Mind Meld</h2>
          <p>
            Everyone secretly picks a word, then tries to converge on the{" "}
            <em>same</em> word. No repeats allowed!
          </p>
          <span className="badge play-badge">▶ Play now</span>
        </Link>
        <Link to="/trivia" className="game-card active">
          <div className="game-emoji">⚡</div>
          <h2>Speed Trivia</h2>
          <p>
            Vote on a category, then race to answer multiple-choice questions —
            faster correct answers score more points.
          </p>
          <span className="badge play-badge">▶ Play now</span>
        </Link>
        {COMING_SOON.map((g) => (
          <div key={g.name} className="game-card disabled">
            <div className="game-emoji">{g.emoji}</div>
            <h2>{g.name}</h2>
            <p>{g.blurb}</p>
            <span className="badge soon-badge">Coming soon</span>
          </div>
        ))}
      </div>

    </div>
  );
}

import { Link } from "react-router-dom";

/** Mode choice: same word bank and rules; one shared device vs. networked play. */
export default function ImposterChoicePage() {
  return (
    <div className="page imposter">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">🕵️ Imposter</h1>
      </header>
      <div className="game-grid">
        <Link to="/imposter/local" className="game-card active accent-green">
          <div className="game-emoji">📱</div>
          <h2>On this device</h2>
          <p>
            Pass one phone around the room. Everyone peeks at their card, then you play out
            loud. No internet needed.
          </p>
          <span className="badge play-badge">▶ Play now</span>
        </Link>
        <Link to="/imposter-online" className="game-card active accent-green">
          <div className="game-emoji">🌐</div>
          <h2>Online</h2>
          <p>
            Everyone on their own device: typed clues, secret votes, word steals — with rooms,
            quick play, and friend invites.
          </p>
          <span className="badge play-badge">▶ Play now</span>
        </Link>
      </div>
      <section className="howto panel">
        <h3>How to play</h3>
        <ol>
          <li>Everyone gets the same secret word — except the imposter(s).</li>
          <li>Take turns giving ONE-word clues that show you know the word.</li>
          <li>Discuss, then vote out whoever seems clueless (literally).</li>
          <li>Crew wins by catching every imposter; imposters win by blending in — or
            guessing the word when caught.</li>
        </ol>
      </section>
    </div>
  );
}

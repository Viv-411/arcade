import { Link } from "react-router-dom";

/** Mode choice: everyone on their own device vs. one shared screen + QR phones. */
export default function CodewordsChoicePage() {
  return (
    <div className="page codewords">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">🗝️ Codewords</h1>
      </header>
      <div className="game-grid">
        <Link to="/codewords/remote" className="game-card active accent-red">
          <div className="game-emoji">🌐</div>
          <h2>Remote</h2>
          <p>
            Everyone on their own device: private spymaster keys, typed clues, and operatives
            guess by voting on cards together.
          </p>
          <span className="badge play-badge">▶ Play now</span>
        </Link>
        <Link to="/codewords/board" className="game-card active accent-red">
          <div className="game-emoji">📺</div>
          <h2>Shared Board</h2>
          <p>
            One big screen for the room. The two spymasters scan a QR code to get the secret
            key on their phones; everyone else taps guesses on the shared board.
          </p>
          <span className="badge play-badge">▶ Play now</span>
        </Link>
      </div>
      <section className="howto panel">
        <h3>How to play</h3>
        <ol>
          <li>25 words in a 5x5 grid. A hidden key marks each one: red agent, blue agent,
            innocent bystander — or the one 💀 assassin.</li>
          <li>Both spymasters see the SAME full key. Everyone else sees only the words.</li>
          <li>Spymasters take turns giving a one-word clue plus a number ("OCEAN 3").</li>
          <li>Their team guesses cards: your agent = keep going, bystander or enemy agent =
            turn over, the assassin = you lose instantly.</li>
          <li>You get exactly that many guesses (0 or ∞ = unlimited); pass whenever you've
            guessed at least once. First team to find all its agents wins.</li>
        </ol>
        <p className="hint">
          No in-app voice — talk out loud or hop on your own call while you play.
        </p>
      </section>
    </div>
  );
}

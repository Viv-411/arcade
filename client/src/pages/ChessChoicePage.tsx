import { Link } from "react-router-dom";
import Icon from "../components/Icon";

/** Mode choice: play someone over the internet, or share one device. */
export default function ChessChoicePage() {
  return (
    <div className="page chess">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">
          <Icon name="crown" /> Chess
        </h1>
      </header>
      <div className="game-grid">
        <Link to="/chess/online" className="game-card active accent-mono">
          <div className="game-emoji">
            <Icon name="globe" />
          </div>
          <h2>Online</h2>
          <p>
            Play a friend on another device. Share a room code or use Quick Play. Clocks and
            move legality are enforced by the server, and a refresh drops you straight back
            into the game.
          </p>
          <span className="badge play-badge">
            <Icon name="play" /> Play now
          </span>
        </Link>
        <Link to="/chess/local" className="game-card active accent-mono">
          <div className="game-emoji">
            <Icon name="smartphone" />
          </div>
          <h2>On This Device</h2>
          <p>
            Two players, one screen. The board can flip to whoever is to move. Works
            completely offline — no account, no server.
          </p>
          <span className="badge play-badge">
            <Icon name="play" /> Play now
          </span>
        </Link>
      </div>
      <section className="howto panel">
        <h3>How to play</h3>
        <ol>
          <li>Standard chess, full rules: castling, en passant, and promotion all included.</li>
          <li>
            Drag a piece, or tap it and then tap where it should go. Legal destinations light
            up as dots; captures show a ring.
          </li>
          <li>
            Reach the back rank with a pawn and pick what it becomes. Checkmate, stalemate,
            the fifty-move rule, threefold repetition, and insufficient material are all
            detected automatically.
          </li>
          <li>
            Set a clock before you start (or play untimed). The mover's clock ticks; the
            increment is added when they complete a move.
          </li>
          <li>You can resign or offer a draw at any point during a game.</li>
        </ol>
        <p className="hint">
          There is no computer opponent — both modes are human vs human.
        </p>
      </section>
    </div>
  );
}

import { Link } from "react-router-dom";
import Icon, { type IconName } from "../components/Icon";

const SOLO_COMING_SOON = [
  { name: "Solo Trivia", icon: "target", blurb: "Practice runs on any question set." },
  { name: "Daily Challenge", icon: "calendar", blurb: "One puzzle a day, streaks included." },
] satisfies { name: string; icon: IconName; blurb: string }[];

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
        <nav className="home-links">
          <Link to="/friends" className="btn small home-link-btn" title="Friends">
            <Icon name="users" /> Friends
          </Link>
        </nav>
      </header>

      <div className="game-grid">
        <Link to="/mindmeld" className="game-card active accent-pink">
          <div className="game-emoji"><Icon name="lightbulb" /></div>
          <h2>Mind Meld</h2>
          <p>
            Everyone secretly picks a word, then tries to converge on the{" "}
            <em>same</em> word. No repeats allowed!
          </p>
          <span className="badge play-badge"><Icon name="play" /> Play now</span>
        </Link>
        <Link to="/trivia" className="game-card active accent-yellow">
          <div className="game-emoji"><Icon name="zap" /></div>
          <h2>Speed Trivia</h2>
          <p>
            Vote on a category, then race to answer multiple-choice questions —
            faster correct answers score more points.
          </p>
          <span className="badge play-badge"><Icon name="play" /> Play now</span>
        </Link>
        <Link to="/imposter" className="game-card active accent-green">
          <div className="game-emoji"><Icon name="sunglasses" /></div>
          <h2>Imposter</h2>
          <p>
            Everyone knows the secret word — except one player. Give clues, sniff out the
            faker, vote them out. Pass-and-play or online.
          </p>
          <span className="badge play-badge"><Icon name="play" /> Play now</span>
        </Link>
        <Link to="/bidbattle" className="game-card active accent-cyan">
          <div className="game-emoji"><Icon name="coins" /></div>
          <h2>Bid Battle</h2>
          <p>
            Team auction, 1v1 or 2v2: bid how many items in a category your team can
            name — or dare the other team to prove their number.
          </p>
          <span className="badge play-badge"><Icon name="play" /> Play now</span>
        </Link>
        <Link to="/codewords" className="game-card active accent-red">
          <div className="game-emoji"><Icon name="grid-3x3" /></div>
          <h2>Codewords</h2>
          <p>
            Red vs Blue word deduction: spymasters give one-word clues to steer their team
            to the right cards — and away from the assassin. Remote, or one shared screen
            with QR spymaster phones.
          </p>
          <span className="badge play-badge"><Icon name="play" /> Play now</span>
        </Link>
      </div>

      <h2 className="section-title"><Icon name="gamepad" /> Singleplayer</h2>
      <div className="game-grid">
        {SOLO_COMING_SOON.map((g) => (
          <div key={g.name} className="game-card disabled">
            <div className="game-emoji"><Icon name={g.icon} /></div>
            <h2>{g.name}</h2>
            <p>{g.blurb}</p>
            <span className="badge soon-badge">Coming soon</span>
          </div>
        ))}
      </div>
    </div>
  );
}

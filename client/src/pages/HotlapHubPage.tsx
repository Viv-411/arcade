import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { LeaderboardResponse, MyRecordsResponse } from "@shared/hotlap/api";
import { TRACKS } from "@shared/hotlap/tracks";
import type { Difficulty, TrackDef } from "@shared/hotlap/track";
import Icon from "../components/Icon";
import { useAuth } from "../auth/AuthContext";
import { fetchLeaderboard, fetchMyRecords } from "../hotlap/api";
import { formatTime, getLocalBest, medalFor, type Medal } from "../hotlap/storage";
import TrackMap from "../hotlap/TrackMap";

const DIFFS: { key: Difficulty; label: string }[] = [
  { key: "easy", label: "Easy" },
  { key: "medium", label: "Medium" },
  { key: "hard", label: "Hard" },
  { key: "expert", label: "Expert" },
];

export function MedalBadge({ medal, small }: { medal: Medal; small?: boolean }) {
  if (!medal) return <span className={`hl-medal none${small ? " small" : ""}`} title="No medal yet" />;
  const label = { ace: "Ace", gold: "Gold", silver: "Silver", bronze: "Bronze" }[medal];
  return (
    <span className={`hl-medal ${medal}${small ? " small" : ""}`} title={`${label} medal`}>
      <Icon name={medal === "ace" ? "star" : "trophy"} />
    </span>
  );
}

function Leaderboard({ track }: { track: TrackDef }) {
  const navigate = useNavigate();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { user } = useAuth();
  useEffect(() => {
    let live = true;
    setData(null);
    setErr(null);
    fetchLeaderboard(track.id, 10)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [track.id, user?.id]);

  if (err) return <p className="hl-lb-note">Leaderboard unavailable right now.</p>;
  if (!data) return <p className="hl-lb-note">Loading leaderboard…</p>;
  if (data.entries.length === 0) return <p className="hl-lb-note">No records yet. Be the first.</p>;
  const youInTop = data.you && data.entries.some((e) => e.userId === data.you!.userId);
  return (
    <ol className="hl-lb">
      {data.entries.map((e) => (
        <li key={e.userId} className={e.userId === user?.id ? "you" : ""}>
          <span className="hl-lb-rank">{e.rank}</span>
          <span className="hl-lb-name">{e.name}</span>
          <MedalBadge medal={medalFor(track, e.timeMs)} small />
          <span className="hl-lb-time">{formatTime(e.timeMs)}</span>
          <button
            className="hl-lb-ghost"
            title={`Race ${e.name}'s ghost`}
            aria-label={`Race ${e.name}'s ghost`}
            onClick={() => navigate(`/hotlap/${track.id}?ghost=${encodeURIComponent(e.runId)}`)}
          >
            <Icon name="play" />
          </button>
        </li>
      ))}
      {data.you && !youInTop && (
        <li className="you gap">
          <span className="hl-lb-rank">{data.you.rank}</span>
          <span className="hl-lb-name">{data.you.name}</span>
          <MedalBadge medal={medalFor(track, data.you.timeMs)} small />
          <span className="hl-lb-time">{formatTime(data.you.timeMs)}</span>
          <span />
        </li>
      )}
    </ol>
  );
}

export default function HotlapHubPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, configured, openAuthModal } = useAuth();
  const [mine, setMine] = useState<MyRecordsResponse["records"]>({});
  const selectedId = params.get("track") ?? TRACKS[0]?.id;
  const selected = TRACKS.find((t) => t.id === selectedId) ?? TRACKS[0];

  useEffect(() => {
    if (!user) {
      setMine({});
      return;
    }
    fetchMyRecords()
      .then((r) => setMine(r.records))
      .catch(() => setMine({}));
  }, [user]);

  const bests = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const t of TRACKS) {
      const local = getLocalBest(t)?.ms ?? null;
      const server = mine[t.id]?.timeMs ?? null;
      out[t.id] = local == null ? server : server == null ? local : Math.min(local, server);
    }
    return out;
  }, [mine]);

  const medalCount = TRACKS.filter((t) => medalFor(t, bests[t.id]) !== null).length;
  const aceCount = TRACKS.filter((t) => medalFor(t, bests[t.id]) === "ace").length;

  return (
    <div className="page hl-hub">
      <Link to="/" className="back-link">
        <Icon name="arrow-left" /> Arcade
      </Link>
      <header className="hl-hub-header">
        <h1 className="hl-title">HOTLAP</h1>
        <p className="tagline">
          One car. Twelve tracks. Every millisecond is yours to win or lose.
        </p>
        <div className="hl-progress">
          <span><Icon name="trophy" /> {medalCount}/{TRACKS.length} medals</span>
          <span><Icon name="star" /> {aceCount} aces</span>
        </div>
      </header>

      {selected && (
        <section className="hl-detail panel">
          <div className="hl-detail-map">
            <TrackMap def={selected} size={170} />
          </div>
          <div className="hl-detail-body">
            <div className="hl-detail-title">
              <h2>{selected.name}</h2>
              <span className={`hl-diff ${selected.difficulty}`}>{selected.difficulty}</span>
            </div>
            <p className="hl-blurb">{selected.blurb}</p>
            <div className="hl-medal-row">
              {(["ace", "gold", "silver", "bronze"] as const).map((m) => (
                <span key={m} className={`hl-medal-time ${bests[selected.id] != null && bests[selected.id]! <= selected.medals[m] ? "got" : ""}`}>
                  <MedalBadge medal={m} small /> {formatTime(selected.medals[m])}
                </span>
              ))}
            </div>
            <p className="hl-pb">
              Your best: <strong>{formatTime(bests[selected.id])}</strong>
              {mine[selected.id] && <span className="hl-rank-chip">#{mine[selected.id].rank} of {mine[selected.id].total}</span>}
            </p>
            <button className="btn primary hl-race-btn" onClick={() => navigate(`/hotlap/${selected.id}`)}>
              <Icon name="play" /> Race
            </button>
          </div>
          <div className="hl-detail-lb">
            <h3><Icon name="chart-bar" /> Leaderboard</h3>
            <p className="hl-lb-hint">Every time here was verified by replaying it. Press play on a row to race that ghost.</p>
            <Leaderboard track={selected} />
            {!user && configured && (
              <button className="link-btn" onClick={openAuthModal}>Sign in to post your times</button>
            )}
          </div>
        </section>
      )}

      {DIFFS.map(({ key, label }) => {
        const list = TRACKS.filter((t) => t.difficulty === key);
        if (!list.length) return null;
        return (
          <section key={key} className="hl-tier">
            <h2 className="section-title">{label}</h2>
            <div className="hl-grid">
              {list.map((t) => {
                const idx = TRACKS.indexOf(t) + 1;
                const best = bests[t.id];
                return (
                  <button
                    key={t.id}
                    className={`hl-card ${t.id === selected?.id ? "selected" : ""}`}
                    onClick={() => setParams({ track: t.id }, { replace: true })}
                    onDoubleClick={() => navigate(`/hotlap/${t.id}`)}
                  >
                    <span className="hl-card-num">{String(idx).padStart(2, "0")}</span>
                    <TrackMap def={t} size={84} />
                    <span className="hl-card-name">{t.name}</span>
                    <span className="hl-card-best">
                      <MedalBadge medal={medalFor(t, best)} small />
                      {best != null ? formatTime(best) : "No time"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className="hl-howto panel">
        <h2><Icon name="gamepad" /> How to play</h2>
        <div className="hl-keys">
          <div><kbd>↑</kbd><kbd>W</kbd> Accelerate</div>
          <div><kbd>↓</kbd><kbd>S</kbd> Brake / reverse</div>
          <div><kbd>←</kbd><kbd>→</kbd><kbd>A</kbd><kbd>D</kbd> Steer</div>
          <div><kbd>Enter</kbd> Back to last checkpoint</div>
          <div><kbd>R</kbd> Restart</div>
          <div><kbd>Esc</kbd> Pause</div>
          <div><kbd>C</kbd> Camera</div>
          <div><kbd>G</kbd> Ghost on/off</div>
        </div>
        <p>
          The clock starts the moment you touch the controls and stops on the finish line —
          timed to the millisecond. Hit every checkpoint in order. Fall off and you're put back
          at your last checkpoint, but the clock keeps running. Every car is identical and the
          physics are deterministic: the same inputs always give the same run, which is how
          the server checks every leaderboard time by replaying it. Gamepads work too.
        </p>
      </section>
    </div>
  );
}

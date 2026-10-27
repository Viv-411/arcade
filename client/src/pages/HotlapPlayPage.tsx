import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { IN_DOWN, IN_LEFT, IN_RESPAWN, IN_RIGHT, IN_UP, SIM_VERSION } from "@shared/hotlap/car";
import { decodeInputs, type InputSpan } from "@shared/hotlap/replay";
import { buildTrack } from "@shared/hotlap/track";
import { TRACKS, getTrack } from "@shared/hotlap/tracks";
import type { SubmitRunResponse } from "@shared/hotlap/api";
import Icon from "../components/Icon";
import { useAuth } from "../auth/AuthContext";
import { HotlapApiError, fetchReplay, submitRun } from "../hotlap/api";
import { HotlapSession, type FinishInfo, type Phase } from "../hotlap/session";
import {
  formatDelta,
  formatTime,
  getLocalBest,
  getSettings,
  medalFor,
  offerLocalBest,
  saveSettings,
  type CameraMode,
  type HotlapSettings,
  type LocalBest,
} from "../hotlap/storage";
import { MedalBadge } from "./HotlapHubPage";

type SubmitState =
  | { kind: "idle" }
  | { kind: "anon" }
  | { kind: "sending" }
  | { kind: "done"; res: SubmitRunResponse }
  | { kind: "error"; msg: string };

interface FinishView {
  info: FinishInfo;
  previous: number | null;
  improved: boolean;
}

const CAMERAS: { key: CameraMode; label: string }[] = [
  { key: "chase", label: "Chase" },
  { key: "far", label: "Far" },
  { key: "hood", label: "Hood" },
];

/** Keyed by track so moving to the next track starts completely fresh. */
export default function HotlapPlayPage() {
  const { trackId = "" } = useParams();
  return <HotlapPlay key={trackId} />;
}

function HotlapPlay() {
  const { trackId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const def = getTrack(trackId);
  const built = useMemo(() => (def ? buildTrack(def) : null), [def]);
  const { user, configured, openAuthModal } = useAuth();

  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HotlapSession | null>(null);
  const timerRef = useRef<HTMLDivElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const cpRef = useRef<HTMLSpanElement>(null);

  const [settings, setSettings] = useState<HotlapSettings>(getSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [phase, setPhase] = useState<Phase>("ready");
  const [paused, setPaused] = useState(false);
  const [split, setSplit] = useState<{ text: string; good: boolean | null; key: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const [finish, setFinish] = useState<FinishView | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ kind: "idle" });
  const [ghostLabel, setGhostLabel] = useState<string | null>(null);
  const [webglError, setWebglError] = useState(false);
  const bestRef = useRef<LocalBest | null>(def ? getLocalBest(def) : null);
  const remoteGhost = useRef<{ spans: InputSpan[]; label: string } | null>(null);
  const userRef = useRef(user);
  userRef.current = user;

  const trackIndex = def ? TRACKS.indexOf(def) : -1;
  const nextTrack = trackIndex >= 0 ? TRACKS[trackIndex + 1] : undefined;

  const updateSettings = useCallback((patch: Partial<HotlapSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  /** Pick which ghost to race: a leaderboard replay (?ghost=) or your PB. */
  const applyGhost = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    if (settingsRef.current.ghost === "off") {
      s.setGhost(null);
      setGhostLabel(null);
      return;
    }
    if (remoteGhost.current) {
      s.setGhost(remoteGhost.current.spans);
      setGhostLabel(remoteGhost.current.label);
      return;
    }
    const pb = bestRef.current;
    if (pb) {
      try {
        s.setGhost(decodeInputs(pb.replay));
        setGhostLabel(`Your best ${formatTime(pb.ms)}`);
        return;
      } catch {
        /* corrupt local replay — ignore */
      }
    }
    s.setGhost(null);
    setGhostLabel(null);
  }, []);

  const restart = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    setFinish(null);
    setSubmit({ kind: "idle" });
    setSplit(null);
    setPaused(false);
    s.setPaused(false);
    s.input.enabled = true;
    s.reset();
    applyGhost();
  }, [applyGhost]);

  const handleFinish = useCallback(
    (info: FinishInfo) => {
      if (!def) return;
      const prev = bestRef.current;
      const res = offerLocalBest(def, { ms: info.ms, splits: info.splits, replay: info.replay, at: Date.now() });
      if (res.improved) bestRef.current = { ms: info.ms, splits: info.splits, replay: info.replay, at: Date.now() };
      setFinish({ info, previous: prev?.ms ?? null, improved: res.improved });
      sessionRef.current?.audio.finish(res.improved);
      if (info.autopilot) {
        setSubmit({ kind: "error", msg: "Autopilot run — not posted." });
        return;
      }
      if (!userRef.current) {
        setSubmit({ kind: "anon" });
        return;
      }
      setSubmit({ kind: "sending" });
      submitRun({
        trackId: def.id,
        trackVersion: def.version,
        simVersion: SIM_VERSION,
        replay: info.replay,
        claimedMs: info.ms,
      })
        .then((r) => setSubmit({ kind: "done", res: r }))
        .catch((e: unknown) => {
          const err = e as HotlapApiError;
          const msg =
            err.status === 409
              ? "The game was updated — reload the page to post times."
              : err.status === 422
                ? "This run couldn't be verified, so it wasn't posted."
                : err.status === 429
                  ? "Slow down a little — try posting again in a moment."
                  : err.message || "Couldn't post your time.";
          setSubmit({ kind: "error", msg });
        });
    },
    [def],
  );

  // Create the session once per track.
  useEffect(() => {
    if (!built || !hostRef.current) return;
    let session: HotlapSession;
    try {
      session = new HotlapSession(hostRef.current, built, settingsRef.current, {
        onPhase: (p) => setPhase(p),
        onCheckpoint: (index, ms) => {
          const pb = bestRef.current;
          const ref = pb?.splits[index];
          if (ref != null) {
            const d = ms - ref;
            setSplit({ text: formatDelta(d), good: d <= 0, key: Date.now() });
            session.audio.checkpoint(d <= 0);
          } else {
            setSplit({ text: formatTime(ms), good: null, key: Date.now() });
            session.audio.checkpoint(null);
          }
        },
        onFinish: (info) => handleFinish(info),
        onRespawn: (fell) => setToast({ text: fell ? "Off the track — back to checkpoint" : "Back to checkpoint", key: Date.now() }),
        onAction: (a) => {
          if (a === "restart") restartRef.current();
          else if (a === "pause") togglePauseRef.current();
          else if (a === "camera") {
            const order: CameraMode[] = ["chase", "far", "hood"];
            const next = order[(order.indexOf(settingsRef.current.camera) + 1) % order.length];
            updateSettings({ camera: next });
            session.setCamera(next);
            setToast({ text: `Camera: ${CAMERAS.find((c) => c.key === next)!.label}`, key: Date.now() });
          } else if (a === "ghost") {
            const next = settingsRef.current.ghost === "off" ? "pb" : "off";
            updateSettings({ ghost: next });
            settingsRef.current = { ...settingsRef.current, ghost: next };
            applyGhost();
            setToast({ text: next === "off" ? "Ghost off" : "Ghost on", key: Date.now() });
          } else if (a === "mute") {
            const m = !settingsRef.current.muted;
            updateSettings({ muted: m });
            session.audio.setMuted(m);
            setToast({ text: m ? "Sound off" : "Sound on", key: Date.now() });
          }
        },
      });
    } catch (e) {
      console.error(e);
      setWebglError(true);
      return;
    }
    sessionRef.current = session;
    if (params.get("autopilot") === "1") session.setAutopilot(true);
    applyGhost();

    // HUD numbers update straight into the DOM every frame (no React churn).
    let raf = 0;
    const tickHud = () => {
      const h = session.hud();
      if (timerRef.current) timerRef.current.textContent = formatTime(h.ms);
      if (speedRef.current) speedRef.current.textContent = String(Math.round(h.speedKmh));
      if (cpRef.current) cpRef.current.textContent = `${Math.min(h.nextGate, h.gateCount - 1)}/${h.gateCount - 1}`;
      raf = requestAnimationFrame(tickHud);
    };
    raf = requestAnimationFrame(tickHud);
    document.body.classList.add("hl-playing");
    return () => {
      cancelAnimationFrame(raf);
      document.body.classList.remove("hl-playing");
      session.dispose();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  // Leaderboard ghost (?ghost=runId).
  useEffect(() => {
    const id = params.get("ghost");
    remoteGhost.current = null;
    if (!id || !def) return;
    let live = true;
    fetchReplay(id)
      .then((r) => {
        if (!live || r.trackId !== def.id || r.trackVersion !== def.version || r.simVersion !== SIM_VERSION) return;
        remoteGhost.current = { spans: decodeInputs(r.replay), label: `${r.name} ${formatTime(r.timeMs)}` };
        // A ghost can't join a run already under way; it rides from the next start.
        if (sessionRef.current?.phase === "ready") applyGhost();
        else setToast({ text: "Ghost loaded — press R to race it", key: Date.now() });
      })
      .catch((e) => console.warn("[hotlap] couldn't load that ghost:", e));
    return () => {
      live = false;
    };
  }, [params, def, applyGhost]);

  const togglePause = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.phase === "finished") return;
    const p = !s.paused;
    s.setPaused(p);
    s.input.enabled = !p;
    setPaused(p);
  }, []);
  const restartRef = useRef(restart);
  restartRef.current = restart;
  const togglePauseRef = useRef(togglePause);
  togglePauseRef.current = togglePause;

  if (!def || !built) {
    return (
      <div className="page">
        <p>That track doesn't exist.</p>
        <Link to="/hotlap" className="btn">Back to tracks</Link>
      </div>
    );
  }

  const medal = finish ? medalFor(def, finish.info.ms) : null;
  const pbMs = bestRef.current?.ms ?? null;
  const touch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const press = (bit: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      sessionRef.current?.input.setTouch(bit, true);
    },
    onPointerUp: () => sessionRef.current?.input.setTouch(bit, false),
    onPointerCancel: () => sessionRef.current?.input.setTouch(bit, false),
  });

  return (
    <div className="hl-play">
      <div ref={hostRef} className="hl-canvas" />
      {webglError && (
        <div className="hl-overlay">
          <div className="hl-panel">
            <h2>Can't start the 3D view</h2>
            <p>Your browser or device doesn't have WebGL available. Try another browser or enable hardware acceleration.</p>
            <Link className="btn" to="/hotlap">Back to tracks</Link>
          </div>
        </div>
      )}

      {/* ---- HUD ---- */}
      <div className="hl-hud">
        <div className="hl-hud-top">
          <div className="hl-hud-left">
            <div className="hl-track-name">{def.name}</div>
            <div className="hl-cp"><Icon name="flag" /> <span ref={cpRef}>0/0</span></div>
          </div>
          <div className="hl-timer-wrap">
            <div ref={timerRef} className="hl-timer">0:00.000</div>
            {split && (
              <div key={split.key} className={`hl-split ${split.good === null ? "" : split.good ? "good" : "bad"}`}>
                {split.text}
              </div>
            )}
          </div>
          <div className="hl-hud-right">
            <div className="hl-target">
              {pbMs != null ? <>Best <strong>{formatTime(pbMs)}</strong></> : <>Gold <strong>{formatTime(def.medals.gold)}</strong></>}
            </div>
            {ghostLabel && <div className="hl-ghost-label"><Icon name="human" /> {ghostLabel}</div>}
          </div>
        </div>
        {settings.showSpeed && (
          <div className="hl-speed">
            <span ref={speedRef}>0</span>
            <small>km/h</small>
          </div>
        )}
        {toast && <div key={toast.key} className="hl-toast">{toast.text}</div>}
        {phase === "ready" && !paused && (
          <div className="hl-ready">
            <div className="hl-ready-title">{def.name}</div>
            <div className="hl-ready-hint">
              {touch ? "Touch a control to start" : <>Press <kbd>↑</kbd> or any arrow key to start</>}
            </div>
            <div className="hl-ready-keys">
              <span><kbd>Enter</kbd> checkpoint</span>
              <span><kbd>R</kbd> restart</span>
              <span><kbd>Esc</kbd> pause</span>
            </div>
          </div>
        )}
        <div className="hl-hud-buttons">
          <button className="hl-icon-btn" onClick={togglePause} title="Pause (Esc)" aria-label="Pause">
            <Icon name="list-box" />
          </button>
        </div>
      </div>

      {touch && phase !== "finished" && !paused && (
        <div className="hl-touch">
          <div className="hl-touch-steer">
            <button {...press(IN_LEFT)} aria-label="Steer left">◀</button>
            <button {...press(IN_RIGHT)} aria-label="Steer right">▶</button>
          </div>
          <button className="hl-touch-respawn" {...press(IN_RESPAWN)} aria-label="Back to checkpoint">
            <Icon name="flag" />
          </button>
          <div className="hl-touch-pedals">
            <button className="brake" {...press(IN_DOWN)} aria-label="Brake">BRAKE</button>
            <button className="gas" {...press(IN_UP)} aria-label="Accelerate">GAS</button>
          </div>
        </div>
      )}

      {/* ---- Pause ---- */}
      {paused && (
        <div className="hl-overlay">
          <div className="hl-panel">
            <h2>Paused</h2>
            <div className="hl-menu">
              <button className="btn primary" onClick={togglePause}><Icon name="play" /> Resume</button>
              <button className="btn" onClick={restart}><Icon name="reload" /> Restart</button>
              <button className="btn" onClick={() => navigate(`/hotlap?track=${def.id}`)}><Icon name="arrow-left" /> Tracks</button>
            </div>
            <div className="hl-settings">
              <div className="hl-setting">
                <span><Icon name="camera" /> Camera</span>
                <div className="hl-seg">
                  {CAMERAS.map((c) => (
                    <button
                      key={c.key}
                      className={settings.camera === c.key ? "on" : ""}
                      onClick={() => {
                        updateSettings({ camera: c.key });
                        sessionRef.current?.setCamera(c.key);
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hl-setting">
                <span><Icon name="human" /> Ghost</span>
                <div className="hl-seg">
                  {(["pb", "off"] as const).map((g) => (
                    <button
                      key={g}
                      className={settings.ghost === g ? "on" : ""}
                      onClick={() => {
                        updateSettings({ ghost: g });
                        settingsRef.current = { ...settingsRef.current, ghost: g };
                        applyGhost();
                      }}
                    >
                      {g === "pb" ? "On" : "Off"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="hl-setting">
                <span><Icon name={settings.muted ? "volume-off" : "volume"} /> Volume</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={settings.muted ? 0 : settings.volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    updateSettings({ volume: v, muted: v === 0 });
                    sessionRef.current?.audio.setVolume(v);
                    sessionRef.current?.audio.setMuted(v === 0);
                  }}
                />
              </div>
              <div className="hl-setting">
                <span><Icon name="speed-fast" /> Speedometer</span>
                <div className="hl-seg">
                  {[true, false].map((v) => (
                    <button key={String(v)} className={settings.showSpeed === v ? "on" : ""} onClick={() => updateSettings({ showSpeed: v })}>
                      {v ? "On" : "Off"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Finish ---- */}
      {finish && (
        <div className="hl-overlay finish">
          <div className="hl-panel hl-finish">
            <div className="hl-finish-label">{finish.improved && finish.previous !== null ? "New personal best" : finish.previous === null ? "First finish" : "Finished"}</div>
            <div className="hl-finish-time">{formatTime(finish.info.ms)}</div>
            {finish.previous !== null && (
              <div className={`hl-finish-delta ${finish.info.ms <= finish.previous ? "good" : "bad"}`}>
                {formatDelta(finish.info.ms - finish.previous)} vs best
              </div>
            )}
            <div className="hl-finish-medal">
              <MedalBadge medal={medal} />
              <span>
                {medal ? `${medal[0].toUpperCase()}${medal.slice(1)} medal` : `Bronze is ${formatTime(def.medals.bronze)}`}
              </span>
            </div>
            <div className="hl-medal-row compact">
              {(["ace", "gold", "silver", "bronze"] as const).map((m) => (
                <span key={m} className={`hl-medal-time ${finish.info.ms <= def.medals[m] ? "got" : ""}`}>
                  <MedalBadge medal={m} small /> {formatTime(def.medals[m])}
                </span>
              ))}
            </div>
            <div className="hl-submit">
              {submit.kind === "anon" &&
                (configured ? (
                  <button className="link-btn" onClick={openAuthModal}>Sign in to post times to the leaderboard</button>
                ) : (
                  <span className="muted">Saved on this device.</span>
                ))}
              {submit.kind === "sending" && <span className="muted">Verifying your run…</span>}
              {submit.kind === "done" && (
                <span>
                  <Icon name="check" /> Verified ·{" "}
                  {submit.res.improved ? (
                    <>leaderboard <strong>#{submit.res.rank}</strong> of {submit.res.total}</>
                  ) : (
                    <>your record stays {formatTime(submit.res.previousMs)} (#{submit.res.rank})</>
                  )}
                </span>
              )}
              {submit.kind === "error" && <span className="hl-err">{submit.msg}</span>}
            </div>
            {finish.info.respawns > 0 && <div className="muted small">{finish.info.respawns} checkpoint reset{finish.info.respawns > 1 ? "s" : ""}</div>}
            <div className="hl-menu">
              <button className="btn primary" onClick={restart}><Icon name="reload" /> Retry <kbd>R</kbd></button>
              {nextTrack && (
                <button className="btn" onClick={() => navigate(`/hotlap/${nextTrack.id}`)}>
                  Next: {nextTrack.name} <Icon name="chevron-right" />
                </button>
              )}
              <button className="btn" onClick={() => navigate(`/hotlap?track=${def.id}`)}><Icon name="chart-bar" /> Tracks</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

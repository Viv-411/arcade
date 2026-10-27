/**
 * Per-device Hotlap data: personal bests (with their replays, for the ghost)
 * and settings. localStorage is right here — this is device data, not player
 * identity (identity stays per-tab in sessionStorage, see CLAUDE.md). Every
 * access is wrapped: storage can be unavailable or throw (private mode).
 */
import { SIM_VERSION } from "@shared/hotlap/car";
import type { TrackDef } from "@shared/hotlap/track";

export interface LocalBest {
  ms: number;
  splits: number[];
  replay: string;
  at: number;
}

export type CameraMode = "chase" | "far" | "hood";
export type GhostMode = "pb" | "off";

export interface HotlapSettings {
  camera: CameraMode;
  ghost: GhostMode;
  volume: number;
  muted: boolean;
  showSpeed: boolean;
}

const DEFAULTS: HotlapSettings = { camera: "chase", ghost: "pb", volume: 0.7, muted: false, showSpeed: true };

const bestKey = (t: TrackDef) => `hotlap:best:${t.id}:v${t.version}:s${SIM_VERSION}`;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — PBs just won't persist */
  }
}

export function getLocalBest(t: TrackDef): LocalBest | null {
  const b = read<LocalBest>(bestKey(t));
  return b && typeof b.ms === "number" && typeof b.replay === "string" ? b : null;
}

/** Saves if faster; returns the previous best ms (null if none). */
export function offerLocalBest(t: TrackDef, best: LocalBest): { improved: boolean; previous: number | null } {
  const prev = getLocalBest(t);
  if (!prev || best.ms < prev.ms) {
    write(bestKey(t), best);
    return { improved: true, previous: prev?.ms ?? null };
  }
  return { improved: false, previous: prev.ms };
}

export function getSettings(): HotlapSettings {
  return { ...DEFAULTS, ...(read<Partial<HotlapSettings>>("hotlap:settings") ?? {}) };
}

export function saveSettings(s: HotlapSettings) {
  write("hotlap:settings", s);
}

export type Medal = "ace" | "gold" | "silver" | "bronze" | null;

export function medalFor(t: TrackDef, ms: number | null | undefined): Medal {
  if (ms == null) return null;
  const m = t.medals;
  if (ms <= m.ace) return "ace";
  if (ms <= m.gold) return "gold";
  if (ms <= m.silver) return "silver";
  if (ms <= m.bronze) return "bronze";
  return null;
}

/** m:ss.mmm (or ss.mmm under a minute) — always millisecond precision. */
export function formatTime(ms: number | null | undefined): string {
  if (ms == null || !isFinite(ms)) return "--:--.---";
  const neg = ms < 0;
  const a = Math.abs(Math.round(ms));
  const m = Math.floor(a / 60000);
  const s = Math.floor((a % 60000) / 1000);
  const r = a % 1000;
  const body = `${m}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
  return neg ? `-${body}` : body;
}

/** Signed split delta: "+0.214" / "-1.050". */
export function formatDelta(ms: number): string {
  const a = Math.abs(Math.round(ms));
  const s = Math.floor(a / 1000);
  const r = a % 1000;
  const body = s >= 60 ? formatTime(a) : `${s}.${String(r).padStart(3, "0")}`;
  return (ms < 0 ? "-" : "+") + body;
}

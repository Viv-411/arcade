/**
 * Chess sound effects, synthesized with the Web Audio API.
 *
 * Deliberately NO audio files: the arcade ships no binary assets, and
 * generating the sounds keeps the bundle small, works offline, and avoids
 * licensing questions around sampled chess.com/lichess sound packs. These are
 * short percussive blips rather than realistic wooden clacks — the goal is
 * useful feedback (did that capture? am I in check?), not realism.
 *
 * The AudioContext is created lazily on the first play and resumed on demand,
 * because browsers refuse to start audio before a user gesture.
 */

export type ChessSound =
  | "move"
  | "capture"
  | "check"
  | "castle"
  | "promote"
  | "gameEnd"
  | "illegal";

const SOUND_PREF_KEY = "arcade:chess:sound";

export function soundEnabled(): boolean {
  return localStorage.getItem(SOUND_PREF_KEY) !== "off";
}

export function setSoundEnabled(on: boolean): void {
  localStorage.setItem(SOUND_PREF_KEY, on ? "on" : "off");
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** One shaped oscillator note. */
function tone(
  ac: AudioContext,
  at: number,
  freq: number,
  durationMs: number,
  gain: number,
  type: OscillatorType = "sine",
  glideTo?: number,
): void {
  const dur = durationMs / 1000;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, at + dur);
  // Quick attack, exponential decay — reads as a "click" rather than a beep.
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(amp).connect(ac.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** Filtered noise burst — the "wood on wood" part of a capture. */
function noise(ac: AudioContext, at: number, durationMs: number, gain: number): void {
  const dur = durationMs / 1000;
  const frames = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1800, at);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, at);
  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(at);
  src.stop(at + dur);
}

export function playChessSound(sound: ChessSound): void {
  if (!soundEnabled()) return;
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.001;
  switch (sound) {
    case "move":
      tone(ac, t, 300, 70, 0.16, "triangle", 190);
      break;
    case "capture":
      noise(ac, t, 90, 0.22);
      tone(ac, t, 190, 90, 0.18, "triangle", 120);
      break;
    case "check":
      tone(ac, t, 720, 90, 0.16, "square");
      tone(ac, t + 0.1, 960, 130, 0.16, "square");
      break;
    case "castle":
      tone(ac, t, 300, 60, 0.15, "triangle", 210);
      tone(ac, t + 0.09, 300, 70, 0.15, "triangle", 210);
      break;
    case "promote":
      [523, 659, 784, 1047].forEach((f, i) => tone(ac, t + i * 0.06, f, 110, 0.13, "sine"));
      break;
    case "gameEnd":
      [784, 587, 392].forEach((f, i) => tone(ac, t + i * 0.13, f, 260, 0.16, "sine"));
      break;
    case "illegal":
      tone(ac, t, 150, 130, 0.14, "sawtooth", 90);
      break;
  }
}

/** Pick the right sound for a move that was just applied. */
export function soundForMove(opts: {
  captured: string | null;
  promotion: string | null;
  san: string;
}): ChessSound {
  if (opts.san.includes("#")) return "gameEnd";
  if (opts.san.includes("+")) return "check";
  if (opts.promotion) return "promote";
  if (opts.san === "O-O" || opts.san === "O-O-O") return "castle";
  if (opts.captured) return "capture";
  return "move";
}

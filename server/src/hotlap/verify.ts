/**
 * Pure replay verification: decode a client's inputs and re-drive them
 * through the SAME shared simulation the client ran. Used by the verifier
 * worker (verifyWorker.ts) and by the inline fallback — no I/O, no globals
 * beyond a small built-track cache.
 */
import { buildTrack, type BuiltTrack, type TrackDef } from "../../../shared/hotlap/track.js";
import { MAX_RUN_TICKS, Run } from "../../../shared/hotlap/run.js";
import { decodeInputs, InputPlayer } from "../../../shared/hotlap/replay.js";

export type SimResult =
  | { ok: true; timeMs: number; ticks: number }
  /** 400 = the replay can't be decoded; 422 = it decodes but doesn't finish. */
  | { ok: false; status: 400 | 422; error: string };

// Building a track (geometry + collision world) is the expensive part of a
// short verification, so keep one per track version.
const built = new Map<string, BuiltTrack>();

function builtTrack(def: TrackDef): BuiltTrack {
  const key = `${def.id}@${def.version}`;
  let t = built.get(key);
  if (!t) {
    t = buildTrack(def);
    built.set(key, t);
  }
  return t;
}

export function simulateReplay(def: TrackDef, replay: string): SimResult {
  let spans;
  try {
    spans = decodeInputs(replay, MAX_RUN_TICKS);
  } catch (err) {
    return { ok: false, status: 400, error: `malformed replay (${(err as Error).message})` };
  }
  let ticks = 0;
  for (const s of spans) ticks += s.ticks;
  if (ticks === 0) return { ok: false, status: 400, error: "malformed replay (empty)" };

  const run = new Run(builtTrack(def));
  const player = new InputPlayer(spans);
  while (!run.finished && run.tick < ticks) run.step(player.next());
  if (!run.finished) {
    return { ok: false, status: 422, error: "the replay does not reach the finish line" };
  }
  return { ok: true, timeMs: run.finishMs, ticks: run.tick };
}

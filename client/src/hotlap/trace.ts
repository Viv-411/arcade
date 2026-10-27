/**
 * Speed traces for the finish-screen graph. A comparison trace (your previous
 * best, or a leaderboard ghost) is rebuilt by re-simulating its replay: the
 * simulation is deterministic, so this reproduces the exact run without
 * storing any telemetry.
 */
import { InputPlayer, decodeInputs, type InputSpan } from "@shared/hotlap/replay";
import { MAX_RUN_TICKS, Run } from "@shared/hotlap/run";
import type { BuiltTrack } from "@shared/hotlap/track";
import { SPEED_SAMPLE_TICKS } from "./session";

export function traceFromReplay(track: BuiltTrack, replay: string): number[] | null {
  try {
    return traceFromSpans(track, decodeInputs(replay, MAX_RUN_TICKS));
  } catch {
    return null;
  }
}

export function traceFromSpans(track: BuiltTrack, spans: InputSpan[]): number[] | null {
  try {
    const player = new InputPlayer(spans);
    const run = new Run(track);
    const out: number[] = [];
    while (!run.finished && run.tick < MAX_RUN_TICKS) {
      run.step(player.next());
      if (run.tick % SPEED_SAMPLE_TICKS === 0) out.push(Math.abs(run.car.speed) * 3.6);
      if (player.done && !run.finished) break;
    }
    return run.finished ? out : null;
  } catch {
    return null;
  }
}

/**
 * Worker-thread entry for replay verification (see verifier.ts). Runs one
 * job at a time; the parent owns queueing and timeouts.
 */
import { parentPort } from "node:worker_threads";
import type { TrackDef } from "../../../shared/hotlap/track.js";
import { simulateReplay, type SimResult } from "./verify.js";

export interface VerifyJobMessage {
  id: number;
  def: TrackDef;
  replay: string;
}

export type VerifyResultMessage = { id: number; result: SimResult } | { ready: true };

parentPort?.on("message", (msg: VerifyJobMessage) => {
  let result: SimResult;
  try {
    result = simulateReplay(msg.def, msg.replay);
  } catch (err) {
    // A crash inside the simulation means the inputs drove it somewhere it
    // can't handle — treat as an unverifiable run rather than killing the worker.
    result = { ok: false, status: 422, error: `simulation failed (${(err as Error).message})` };
  }
  parentPort!.postMessage({ id: msg.id, result } satisfies VerifyResultMessage);
});

// Tells the parent the module graph loaded — errors before this are
// treated as "workers unsupported here" and trigger the inline fallback.
parentPort?.postMessage({ ready: true });

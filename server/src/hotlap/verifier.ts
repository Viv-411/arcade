/**
 * Runs replay verification OFF the main thread so a long replay never
 * stalls the real-time games sharing this process.
 *
 * One long-lived worker, a FIFO queue, one job in flight, a per-job
 * timeout (a stuck job kills and respawns the worker). The worker file is
 * resolved next to this module with the same extension, so it is
 * verifyWorker.js in the built server and verifyWorker.ts under tsx (which
 * propagates its loader to workers via execArgv). If a worker can't start
 * in some environment — or keeps crashing — verification falls back to
 * running inline, with a console warning.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { TrackDef } from "../../../shared/hotlap/track.js";
import { simulateReplay, type SimResult } from "./verify.js";
import type { VerifyJobMessage, VerifyResultMessage } from "./verifyWorker.js";

export type VerifyOutcome = SimResult | { ok: false; status: 503; error: string };

interface Job {
  id: number;
  def: TrackDef;
  replay: string;
  resolve: (r: VerifyOutcome) => void;
}

const MAX_CRASHES = 3;

function runInline(def: TrackDef, replay: string): SimResult {
  try {
    return simulateReplay(def, replay);
  } catch (err) {
    return { ok: false, status: 422, error: `simulation failed (${(err as Error).message})` };
  }
}

export class ReplayVerifier {
  private readonly file: string;
  private readonly timeoutMs: number;
  private readonly maxQueue: number;
  private worker: Worker | null = null;
  private ready = false;
  private inline = false;
  private queue: Job[] = [];
  private current: Job | null = null;
  private timer: NodeJS.Timeout | null = null;
  private nextId = 1;
  private crashes = 0;

  constructor(opts: { timeoutMs?: number; maxQueue?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxQueue = opts.maxQueue ?? 64;
    const here = fileURLToPath(import.meta.url);
    this.file = path.join(path.dirname(here), `verifyWorker${path.extname(here)}`);
    if (fs.existsSync(this.file)) this.spawn();
    else this.goInline(`${this.file} not found`);
  }

  get mode(): "worker" | "inline" {
    return this.inline ? "inline" : "worker";
  }

  verify(def: TrackDef, replay: string): Promise<VerifyOutcome> {
    if (this.inline) return Promise.resolve(runInline(def, replay));
    if (this.queue.length >= this.maxQueue) {
      return Promise.resolve({ ok: false, status: 503, error: "verifier busy — try again shortly" });
    }
    return new Promise((resolve) => {
      this.queue.push({ id: this.nextId++, def, replay, resolve });
      this.pump();
    });
  }

  private spawn(): void {
    let w: Worker;
    try {
      w = new Worker(this.file);
    } catch (err) {
      this.goInline(`could not start: ${(err as Error).message}`);
      return;
    }
    w.unref();
    this.worker = w;
    this.ready = false;
    w.on("message", (msg: VerifyResultMessage) => {
      if (w !== this.worker) return;
      if ("ready" in msg) {
        this.ready = true;
        this.pump();
        return;
      }
      const job = this.current;
      if (!job || job.id !== msg.id) return;
      this.clearTimer();
      this.current = null;
      this.crashes = 0;
      job.resolve(msg.result);
      this.pump();
    });
    w.on("error", (err) => this.onDeath(w, err.message));
    w.on("exit", (code) => this.onDeath(w, `exited with code ${code}`));
  }

  private onDeath(w: Worker, reason: string): void {
    if (w !== this.worker) return; // a worker we already replaced
    this.worker = null;
    void w.terminate();
    if (!this.ready) {
      this.goInline(`failed to start: ${reason}`);
      return;
    }
    console.warn(`[hotlap] verification worker died (${reason})`);
    this.clearTimer();
    const job = this.current;
    this.current = null;
    job?.resolve({ ok: false, status: 503, error: "verifier crashed — try again" });
    if (++this.crashes >= MAX_CRASHES) this.goInline("crashed repeatedly");
    else this.spawn();
  }

  private pump(): void {
    const w = this.worker;
    if (!w || !this.ready || this.current) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    this.timer = setTimeout(() => this.onTimeout(job), this.timeoutMs);
    w.postMessage({ id: job.id, def: job.def, replay: job.replay } satisfies VerifyJobMessage);
  }

  private onTimeout(job: Job): void {
    if (this.current !== job) return;
    console.warn(`[hotlap] verification job timed out after ${this.timeoutMs}ms; restarting worker`);
    this.timer = null;
    this.current = null;
    job.resolve({ ok: false, status: 503, error: "verification timed out — try again" });
    const old = this.worker;
    this.worker = null;
    void old?.terminate();
    this.spawn();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private goInline(reason: string): void {
    console.warn(`[hotlap] verification worker unavailable (${reason}); verifying inline on the main thread`);
    this.inline = true;
    this.worker = null;
    this.clearTimer();
    const pending = this.current ? [this.current, ...this.queue] : this.queue;
    this.current = null;
    this.queue = [];
    for (const job of pending) job.resolve(runInline(job.def, job.replay));
  }
}

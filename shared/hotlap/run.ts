/**
 * A single timed run on a track: checkpoints in order, then the finish.
 *
 * Timing: the clock starts at tick 0 (the instant "GO" shows) and a gate
 * crossing is located INSIDE its tick by interpolating where the car's
 * centre crossed the gate plane, so times resolve to the millisecond even
 * though physics ticks are 8.3 ms apart. All of it is deterministic, so the
 * server re-running the same inputs gets the identical time.
 */
import { cloneCar, IN_RESPAWN, makeCar, stepCar, TICK_HZ, type CarState } from "./car.js";
import { qfromBasis, vdot, vsub, type V3 } from "./dmath.js";
import type { BuiltTrack, Frame } from "./track.js";

/** Runs longer than this are abandoned (and cannot be submitted). */
export const MAX_RUN_TICKS = TICK_HZ * 60 * 15;
/** How high above the road the car's centre is placed on (re)spawn. */
const SPAWN_LIFT = 0.95;

export type RunEvent =
  | { type: "checkpoint"; index: number; ms: number }
  | { type: "finish"; ms: number }
  | { type: "respawn"; fell: boolean };

export function ticksToMs(ticks: number): number {
  return Math.round((ticks * 1000) / TICK_HZ);
}

export function placeAt(frame: Frame): CarState {
  const pos = {
    x: frame.p.x + frame.n.x * SPAWN_LIFT,
    y: frame.p.y + frame.n.y * SPAWN_LIFT,
    z: frame.p.z + frame.n.z * SPAWN_LIFT,
  };
  return makeCar(pos, qfromBasis(frame.t, frame.n));
}

export class Run {
  readonly track: BuiltTrack;
  car: CarState;
  /** Ticks simulated so far (the clock reads tick / TICK_HZ). */
  tick = 0;
  /** Index into track.gates of the next gate to cross. */
  nextGate = 0;
  finished = false;
  finishMs = 0;
  /** Split time (ms) for each gate crossed, in order. */
  splits: number[] = [];
  respawns = 0;
  private respawnFrame: Frame;
  private respawnHeld = false;

  constructor(track: BuiltTrack) {
    this.track = track;
    this.respawnFrame = track.spawn;
    this.car = placeAt(track.spawn);
  }

  /** Elapsed ms on the clock (frozen once finished). */
  get ms(): number {
    return this.finished ? this.finishMs : ticksToMs(this.tick);
  }

  /** Advance one tick with the given input bits. Returns what happened. */
  step(input: number): RunEvent[] {
    const events: RunEvent[] = [];
    if (this.finished || this.tick >= MAX_RUN_TICKS) return events;

    // Respawn on the press (edge), not while held.
    const respawnPressed = (input & IN_RESPAWN) !== 0;
    if (respawnPressed && !this.respawnHeld) {
      this.car = placeAt(this.respawnFrame);
      this.respawns++;
      events.push({ type: "respawn", fell: false });
    }
    this.respawnHeld = respawnPressed;

    const p0: V3 = { ...this.car.pos };
    stepCar(this.car, this.track.world, input);
    const p1 = this.car.pos;

    // Gate crossings (at most one per tick — gates are far apart).
    const gate = this.track.gates[this.nextGate];
    if (gate) {
      const frac = crossFraction(gate.frame, p0, p1);
      if (frac !== null) {
        const ms = Math.round(((this.tick + frac) * 1000) / TICK_HZ);
        this.splits.push(ms);
        this.nextGate++;
        if (gate.isFinish) {
          this.finished = true;
          this.finishMs = ms;
          this.tick++;
          events.push({ type: "finish", ms });
          return events;
        }
        this.respawnFrame = gate.frame;
        events.push({ type: "checkpoint", index: gate.index, ms });
      }
    }

    this.tick++;
    if (this.car.pos.y < this.track.killY) {
      this.car = placeAt(this.respawnFrame);
      this.respawns++;
      events.push({ type: "respawn", fell: true });
    }
    return events;
  }

  /** A detached copy of the car state (for render interpolation). */
  snapshot(): CarState {
    return cloneCar(this.car);
  }
}

/**
 * If the segment p0→p1 crosses the gate plane forwards within the gate's
 * opening, return where along the segment (0..1); otherwise null.
 */
export function crossFraction(f: Frame, p0: V3, p1: V3): number | null {
  const d0 = vdot(vsub(p0, f.p), f.t);
  const d1 = vdot(vsub(p1, f.p), f.t);
  if (!(d0 < 0 && d1 >= 0)) return null;
  const frac = d0 / (d0 - d1);
  const x = {
    x: p0.x + (p1.x - p0.x) * frac - f.p.x,
    y: p0.y + (p1.y - p0.y) * frac - f.p.y,
    z: p0.z + (p1.z - p0.z) * frac - f.p.z,
  };
  const lat = vdot(x, f.l);
  const vert = vdot(x, f.n);
  if (Math.abs(lat) > f.width / 2 + 1.5) return null;
  if (vert < -2.5 || vert > 9) return null;
  return frac;
}

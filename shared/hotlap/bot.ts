/**
 * An automatic driver used to VALIDATE tracks (every track must be
 * finishable) and to calibrate medal times. It only produces input bits —
 * exactly what a player's keyboard produces — so anything it can do, a
 * player can do. It is deliberately conservative: it drives the centreline,
 * not a racing line, and good players should beat it.
 */
import { IN_DOWN, IN_LEFT, IN_RESPAWN, IN_RIGHT, IN_UP, TICK_HZ } from "./car.js";
import { qrot, vdot, type V3 } from "./dmath.js";
import type { Run } from "./run.js";
import type { BuiltTrack, Frame } from "./track.js";

export interface BotTuning {
  /** Lateral acceleration it plans corners for (m/s²). */
  latAccel: number;
  /** Deceleration it plans braking with (m/s²). */
  brakeAccel: number;
  /** Lookahead = base + speed * gain (m). */
  lookBase: number;
  lookGain: number;
}

export const BOT_CAREFUL: BotTuning = { latAccel: 11, brakeAccel: 11, lookBase: 7, lookGain: 0.32 };
export const BOT_FAST: BotTuning = { latAccel: 14.5, brakeAccel: 14, lookBase: 7, lookGain: 0.3 };

interface PathPt {
  p: V3;
  s: number;
  /** Max comfortable speed here from horizontal curvature (m/s). */
  vCurve: number;
  gap: boolean;
  /** On a boost pad: braking there barely slows the car, so it doesn't count. */
  boost: boolean;
}

function buildPath(track: BuiltTrack, tune: BotTuning): PathPt[] {
  const pts: PathPt[] = [];
  track.segFrames.forEach((frames, si) => {
    const gap = !!track.def.segs[si].gap;
    const boost = !!track.def.segs[si].boost;
    frames.forEach((f: Frame, j) => {
      if (j === 0 && pts.length > 0) return; // shared boundary frame
      pts.push({ p: f.p, s: f.s, vCurve: Infinity, gap, boost });
    });
  });
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i - 1].p, b = pts[i].p, c = pts[i + 1].p;
    const h1x = b.x - a.x, h1z = b.z - a.z, h2x = c.x - b.x, h2z = c.z - b.z;
    const l1 = Math.sqrt(h1x * h1x + h1z * h1z), l2 = Math.sqrt(h2x * h2x + h2z * h2z);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const cross = (h1x * h2z - h1z * h2x) / (l1 * l2);
    const kappa = Math.abs(cross) / ((l1 + l2) / 2);
    if (kappa > 1e-5) pts[i].vCurve = Math.sqrt(tune.latAccel / kappa);
  }
  return pts;
}

export class Bot {
  private path: PathPt[];
  private idx = 0;
  private stuckTicks = 0;
  private respawnHeld = false;
  /** After a respawn, search the WHOLE path once to find ourselves again. */
  private relocate = false;

  constructor(private track: BuiltTrack, private tune: BotTuning = BOT_CAREFUL) {
    this.path = buildPath(track, tune);
  }

  /** Input bits for the next tick given the current run state. */
  decide(run: Run): number {
    const car = run.car;
    const pos = car.pos;
    const fwd = qrot(car.rot, { x: 0, y: 0, z: 1 });
    const left = qrot(car.rot, { x: 1, y: 0, z: 0 });

    // Track progress: nearest path point, searching a window ahead.
    let best = this.idx;
    let bestD = Infinity;
    const lo = this.relocate ? 0 : Math.max(0, this.idx - 5);
    const hi = this.relocate ? this.path.length - 1 : Math.min(this.path.length - 1, this.idx + 60);
    this.relocate = false;
    for (let i = lo; i <= hi; i++) {
      const p = this.path[i].p;
      const d = (p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 * 0.25 + (p.z - pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.idx = best;
    const here = this.path[best];

    // Stuck / lost: hold still too long or far off the path → respawn.
    const speed = car.speed;
    if (Math.abs(speed) < 1.5 || bestD > 30 * 30) this.stuckTicks++;
    else this.stuckTicks = 0;
    if (this.stuckTicks > TICK_HZ * 1.5) {
      this.stuckTicks = 0;
      this.respawnHeld = true;
      return IN_RESPAWN;
    }
    if (this.respawnHeld) {
      this.respawnHeld = false;
      this.relocate = true;
      return 0;
    }

    // Steering: pure pursuit on a lookahead point.
    const look = this.tune.lookBase + Math.max(0, speed) * this.tune.lookGain;
    let j = best;
    while (j + 1 < this.path.length && this.path[j].s - here.s < look) j++;
    const target = this.path[j].p;
    const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
    const fwdD = dx * fwd.x + dy * fwd.y + dz * fwd.z;
    const latD = dx * left.x + dy * left.y + dz * left.z;
    const angle = latD / Math.max(1, Math.abs(fwdD));
    let bits = 0;
    const dead = 0.018;
    if (angle > dead) bits |= IN_LEFT;
    else if (angle < -dead) bits |= IN_RIGHT;

    // Speed: the most restrictive (corner speed + braking distance) ahead.
    // Corners BEFORE an upcoming jump are always respected; limits beyond
    // the jump are floored so the bot commits enough speed to clear it.
    let vBefore = Infinity;
    let vAfter = Infinity;
    let gapAhead = false;
    let pastGap = false;
    let brakeRoom = 0; // distance ahead usable for braking (boost pads excluded)
    for (let k = best; k < this.path.length; k++) {
      const pt = this.path[k];
      const d = pt.s - here.s;
      if (d > 320) break;
      if (k > best && !this.path[k - 1].boost) brakeRoom += pt.s - this.path[k - 1].s;
      if (pt.gap) {
        if (d < 160) gapAhead = true;
        pastGap = true;
      }
      if (pt.vCurve < Infinity) {
        const v = Math.sqrt(pt.vCurve * pt.vCurve + 2 * this.tune.brakeAccel * Math.max(0, brakeRoom - 4));
        if (pastGap) vAfter = Math.min(vAfter, v);
        else vBefore = Math.min(vBefore, v);
      }
    }
    const vAllowed = gapAhead ? Math.min(vBefore, Math.max(vAfter, 60)) : Math.min(vBefore, vAfter);
    if (speed < vAllowed - 0.5) bits |= IN_UP;
    else if (speed > vAllowed + 2.5) bits |= IN_DOWN;
    void vdot;
    return bits;
  }
}

/** Drive a whole run with the bot. Returns the finish time or null (DNF). */
export function botLap(
  track: BuiltTrack,
  RunCtor: new (t: BuiltTrack) => Run,
  tune: BotTuning = BOT_CAREFUL,
  maxSeconds = 600,
): { ms: number | null; respawns: number; inputs: number[] } {
  const run = new RunCtor(track);
  const bot = new Bot(track, tune);
  const inputs: number[] = [];
  for (let i = 0; i < TICK_HZ * maxSeconds && !run.finished; i++) {
    const bits = bot.decide(run);
    inputs.push(bits);
    run.step(bits);
  }
  return { ms: run.finished ? run.finishMs : null, respawns: run.respawns, inputs };
}

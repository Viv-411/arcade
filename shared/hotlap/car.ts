/**
 * Hotlap car physics — one car, one set of numbers, no upgrades.
 *
 * A rigid body with four raycast wheels (spring-damper suspension), a
 * velocity-damping tyre model capped by a friction circle (so the car grips
 * crisply up to a limit, then slides), downforce, boost pads, light air
 * control, and sphere-vs-triangle body collisions against walls and road.
 *
 * DETERMINISM: fixed timestep, only dmath.ts trig, no Math.sin/cos/pow — see
 * dmath.ts. Any change to a constant here changes how every replay plays
 * back, so bump SIM_VERSION whenever physics behaviour changes.
 */
import {
  dcos,
  dsin,
  qnorm,
  qrot,
  qrotInv,
  vcross,
  vdot,
  v3,
  type Quat,
  type V3,
} from "./dmath.js";
import { SURF_BOOST, SURF_WALL, type CollisionWorld } from "./track.js";

/** Bump on ANY change that alters simulation results (invalidates records). */
export const SIM_VERSION = 4;

export const TICK_HZ = 120;
export const SUBSTEPS = 2;
const DT = 1 / (TICK_HZ * SUBSTEPS);

export const IN_UP = 1;
export const IN_DOWN = 2;
export const IN_LEFT = 4;
export const IN_RIGHT = 8;
export const IN_RESPAWN = 16;
export const INPUT_MASK = 31;

/** Tuning. Exported read-only for the renderer/HUD (wheel radius etc.). */
export const CAR = {
  mass: 1000,
  /** Body-frame principal inertia: x = pitch, y = yaw, z = roll. */
  inertia: { x: 1600, y: 1000, z: 800 },
  gravity: 11.5,
  /** Local mounts (+X = LEFT, +Y = up, +Z = forward): FL, FR, RL, RR. */
  wheels: [
    { x: 0.82, y: -0.22, z: 1.32, front: true },
    { x: -0.82, y: -0.22, z: 1.32, front: true },
    { x: 0.84, y: -0.22, z: -1.26, front: false },
    { x: -0.84, y: -0.22, z: -1.26, front: false },
  ],
  wheelRadius: 0.36,
  restLength: 0.4,
  spring: 60000,
  damperBump: 4200,
  damperRebound: 5600,
  bumpStopDamp: 14000,
  /** Lateral grip stiffness (N per m/s of slip) per wheel. */
  latStiffFront: 72000,
  latStiffRear: 70000,
  /** Max fraction of a wheel's slip its grip may cancel in one substep (4 wheels act at once). */
  gripStepFraction: 0.2,
  /** Peak friction coefficient; sliding drops to `slideFactor` of it. */
  mu: 2.3,
  /** Fraction of grip lost by top speed (linear in speed). */
  gripFade: 0.3,
  /** Speed (m/s) by which the full grip fade has applied. */
  gripFadeSpeed: 92,
  slideFactor: 0.9,
  engineForce: 17500,
  /** Speed (m/s) up to which full engine force is available. */
  pullSpeed: 50,
  topSpeedRef: 130,
  brakeForce: 34000,
  reverseForce: 5200,
  reverseMax: 14,
  rolling: 1.2,
  coastDrag: 900,
  drag: 0.34,
  downforce: 0.15,
  boostAccel: 16,
  maxSteer: 0.5,
  steerFalloff: 17,
  /** Seconds from centre to full lock, and from full lock back to centre. */
  steerRampTime: 0.06,
  /** Extra ramp time per m/s of speed: calmer, less twitchy steering when fast. */
  steerRampPerMs: 0.0013,
  steerReturnTime: 0.05,
  /** Air control: target yaw rate (rad/s), nose alignment, and response. */
  airYaw: 1.3,
  airAlign: 0.55,
  airResponse: 5,
  airRoll: 3,
  angDamp: 0.6,
  /** Front-to-rear axle distance (m) for the kinematic yaw rate. */
  wheelbase: 2.58,
  /** Yaw assist strength (1/s) and the lateral acceleration it may demand (m/s²). */
  yawAssist: 9,
  yawAssistGrip: 30,
  /** >1 lets rotation outpace the turn of the velocity: a controlled slide. */
  slideLead: 1.3,
  /** How much rear grip goes at full lock and speed (0 = none). */
  rearSlide: 0.26,
  /** Slide angle (as lateral/forward speed ratio, ~rad) a held corner settles at. */
  maxSlip: 0.3,
  /** Speed (m/s) at which the rear-slide effect is fully in. */
  slideSpeed: 40,
  /** 0 = tyre forces at the contact patch, 1 = at the centre of mass. */
  rollCentre: 0.88,
  /** Body collision spheres (local centres) and radius. */
  spheres: [
    { x: 0, y: 0.18, z: 0, r: 0.6 },
    { x: 0.48, y: 0.1, z: 1.45, r: 0.5 },
    { x: -0.48, y: 0.1, z: 1.45, r: 0.5 },
    { x: 0.48, y: 0.1, z: -1.45, r: 0.5 },
    { x: -0.48, y: 0.1, z: -1.45, r: 0.5 },
  ],
  wallRestitution: 0.12,
  wallFriction: 0.22,
  roadFriction: 0.18,
} as const;

export interface WheelState {
  /** Suspension compression (m), 0 = fully extended. */
  comp: number;
  contact: boolean;
  /** Rolling angle (rad) for rendering. */
  spin: number;
  spinVel: number;
  /** Lateral slip speed (m/s) — drives skid sound/marks. */
  slip: number;
  onBoost: boolean;
}

export interface CarState {
  pos: V3;
  vel: V3;
  rot: Quat;
  /** World-frame angular velocity. */
  angVel: V3;
  /** Current steering angle (rad), + = left. */
  steer: number;
  wheels: WheelState[];
  grounded: number;
  /** Forward speed (m/s), signed. */
  speed: number;
  /** Strongest impact impulse this tick (for camera shake / sound). */
  impact: number;
}

export function makeCar(pos: V3, rot: Quat): CarState {
  return {
    pos: { ...pos },
    vel: v3(),
    rot: { ...rot },
    angVel: v3(),
    steer: 0,
    wheels: CAR.wheels.map(() => ({ comp: 0, contact: false, spin: 0, spinVel: 0, slip: 0, onBoost: false })),
    grounded: 0,
    speed: 0,
    impact: 0,
  };
}

export function cloneCar(c: CarState): CarState {
  return {
    pos: { ...c.pos },
    vel: { ...c.vel },
    rot: { ...c.rot },
    angVel: { ...c.angVel },
    steer: c.steer,
    wheels: c.wheels.map((w) => ({ ...w })),
    grounded: c.grounded,
    speed: c.speed,
    impact: c.impact,
  };
}

// ---------------------------------------------------------------------------
// Geometry queries

const scratch: number[] = [];

interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  tri: number;
}

/** Nearest non-wall triangle hit along origin + dir * t, t in [0, maxT]. */
function raycast(world: CollisionWorld, o: V3, d: V3, maxT: number, hit: RayHit): boolean {
  const ex = o.x + d.x * maxT;
  const ez = o.z + d.z * maxT;
  const ids = world.query(Math.min(o.x, ex) - 0.01, Math.min(o.z, ez) - 0.01, Math.max(o.x, ex) + 0.01, Math.max(o.z, ez) + 0.01, scratch);
  const V = world.verts;
  let best = maxT;
  let found = false;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    if (world.surf[id] === SURF_WALL) continue;
    const i = id * 9;
    const ax = V[i], ay = V[i + 1], az = V[i + 2];
    const e1x = V[i + 3] - ax, e1y = V[i + 4] - ay, e1z = V[i + 5] - az;
    const e2x = V[i + 6] - ax, e2y = V[i + 7] - ay, e2z = V[i + 8] - az;
    // Möller–Trumbore
    const px = d.y * e2z - d.z * e2y;
    const py = d.z * e2x - d.x * e2z;
    const pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-9 && det < 1e-9) continue;
    const inv = 1 / det;
    const tx = o.x - ax, ty = o.y - ay, tz = o.z - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t < 0 || t >= best) continue;
    // Smooth (barycentric) normal so curved ramps don't feel faceted.
    const N = world.vnormals;
    const w0 = 1 - u - v;
    let nx = N[i] * w0 + N[i + 3] * u + N[i + 6] * v;
    let ny = N[i + 1] * w0 + N[i + 4] * u + N[i + 7] * v;
    let nz = N[i + 2] * w0 + N[i + 5] * u + N[i + 8] * v;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // Only surfaces we are above count (ignore the underside of the road).
    if (nx * d.x + ny * d.y + nz * d.z > -0.2) continue;
    best = t;
    found = true;
    hit.t = t;
    hit.nx = nx;
    hit.ny = ny;
    hit.nz = nz;
    hit.tri = id;
  }
  return found;
}

/** Closest point on triangle `id` to p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTri(world: CollisionWorld, id: number, p: V3, out: V3) {
  const V = world.verts;
  const i = id * 9;
  const ax = V[i], ay = V[i + 1], az = V[i + 2];
  const bx = V[i + 3], by = V[i + 4], bz = V[i + 5];
  const cx = V[i + 6], cy = V[i + 7], cz = V[i + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = p.x - ax, apy = p.y - ay, apz = p.z - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return set(out, ax, ay, az);
  const bpx = p.x - bx, bpy = p.y - by, bpz = p.z - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return set(out, bx, by, bz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return set(out, ax + abx * v, ay + aby * v, az + abz * v);
  }
  const cpx = p.x - cx, cpy = p.y - cy, cpz = p.z - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return set(out, cx, cy, cz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return set(out, ax + acx * w, ay + acy * w, az + acz * w);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return set(out, bx + (cx - bx) * w, by + (cy - by) * w, bz + (cz - bz) * w);
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return set(out, ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w);
}

function set(o: V3, x: number, y: number, z: number) {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
}

// ---------------------------------------------------------------------------
// Dynamics helpers

/** World-space inverse inertia applied to a world vector. */
function invInertia(rot: Quat, v: V3): V3 {
  const l = qrotInv(rot, v);
  return qrot(rot, { x: l.x / CAR.inertia.x, y: l.y / CAR.inertia.y, z: l.z / CAR.inertia.z });
}

/** Apply an impulse J at world point p. */
function applyImpulse(car: CarState, p: V3, J: V3) {
  const im = 1 / CAR.mass;
  car.vel.x += J.x * im;
  car.vel.y += J.y * im;
  car.vel.z += J.z * im;
  const r = { x: p.x - car.pos.x, y: p.y - car.pos.y, z: p.z - car.pos.z };
  const dw = invInertia(car.rot, vcross(r, J));
  car.angVel.x += dw.x;
  car.angVel.y += dw.y;
  car.angVel.z += dw.z;
}

function pointVel(car: CarState, p: V3): V3 {
  const r = { x: p.x - car.pos.x, y: p.y - car.pos.y, z: p.z - car.pos.z };
  const w = vcross(car.angVel, r);
  return { x: car.vel.x + w.x, y: car.vel.y + w.y, z: car.vel.z + w.z };
}

const hit: RayHit = { t: 0, nx: 0, ny: 0, nz: 0, tri: 0 };
const closest: V3 = v3();

/**
 * Advance the car by one TICK (SUBSTEPS physics steps) with a constant input.
 */
export function stepCar(car: CarState, world: CollisionWorld, input: number) {
  const up = (input & IN_UP) !== 0;
  const down = (input & IN_DOWN) !== 0;
  const steerIn = ((input & IN_LEFT) !== 0 ? 1 : 0) - ((input & IN_RIGHT) !== 0 ? 1 : 0);

  // Steering eases toward a speed-dependent lock (once per tick).
  const fwd0 = qrot(car.rot, { x: 0, y: 0, z: 1 });
  const vf0 = vdot(car.vel, fwd0);
  const lock = CAR.maxSteer / (1 + Math.abs(vf0) / CAR.steerFalloff);
  const target = steerIn * lock;
  // Steering ramps over a FIXED time at every speed (lock shrinks with speed,
  // so the rate scales with it): a quick tap gives a small, repeatable
  // correction — that's what makes feathering a digital key precise.
  const rampTime =
    target === 0 || target * car.steer < 0
      ? CAR.steerReturnTime
      : CAR.steerRampTime + Math.abs(vf0) * CAR.steerRampPerMs;
  const rate = Math.max(lock, Math.abs(car.steer)) / rampTime / TICK_HZ;
  if (car.steer < target) car.steer = Math.min(target, car.steer + rate);
  else if (car.steer > target) car.steer = Math.max(target, car.steer - rate);

  car.impact = 0;
  for (let s = 0; s < SUBSTEPS; s++) substep(car, world, up, down, steerIn);
}

function substep(car: CarState, world: CollisionWorld, up: boolean, down: boolean, steerIn: number) {
  const m = CAR.mass;
  const fwd = qrot(car.rot, { x: 0, y: 0, z: 1 });
  const upV = qrot(car.rot, { x: 0, y: 1, z: 0 });
  const left = qrot(car.rot, { x: 1, y: 0, z: 0 });
  const vf = vdot(car.vel, fwd);
  car.speed = vf;

  let fx = 0;
  let fy = -CAR.gravity * m;
  let fz = 0;
  let tx = 0;
  let ty = 0;
  let tz = 0;
  const addForceAt = (p: V3, F: V3) => {
    fx += F.x;
    fy += F.y;
    fz += F.z;
    const r = { x: p.x - car.pos.x, y: p.y - car.pos.y, z: p.z - car.pos.z };
    const t = vcross(r, F);
    tx += t.x;
    ty += t.y;
    tz += t.z;
  };

  // Drive/brake demand for the whole car (split across wheels below).
  let drive = 0; // + pushes forward
  let braking = false;
  if (up && !down) {
    if (vf < -0.5) braking = true;
    else {
      // Flat, strong pull up to `pullSpeed`, then a gentle taper to zero at
      // `topSpeedRef` — acceleration that stays punchy deep into the speed
      // range instead of dying off early.
      const over = vf > CAR.pullSpeed ? (vf - CAR.pullSpeed) / (CAR.topSpeedRef - CAR.pullSpeed) : 0;
      drive = CAR.engineForce * Math.max(0, 1 - over * over);
    }
  } else if (down && !up) {
    if (vf > 0.5) braking = true;
    else if (vf > -CAR.reverseMax) drive = -CAR.reverseForce;
  } else if (down && up) {
    braking = true;
  }

  // Grip bookkeeping for the yaw assist: total grip available vs. the part
  // already spent on driving/braking this substep.
  let gripTotal = 0;
  let gripLong = 0;
  const steerLockNow = CAR.maxSteer / (1 + Math.abs(vf) / CAR.steerFalloff);
  // Current slide angle (lateral / forward speed at the centre of mass).
  const slipNow = Math.abs(vdot(car.vel, left)) / Math.max(6, Math.abs(vf));
  const slideRoom = Math.max(0, 1 - slipNow / CAR.maxSlip);
  const ray = { x: -upV.x, y: -upV.y, z: -upV.z };
  const reach = CAR.restLength + CAR.wheelRadius;
  const cs = dcos(car.steer);
  const sn = dsin(car.steer);
  let grounded = 0;

  for (let i = 0; i < CAR.wheels.length; i++) {
    const wd = CAR.wheels[i];
    const ws = car.wheels[i];
    const mount = qrot(car.rot, wd);
    mount.x += car.pos.x;
    mount.y += car.pos.y;
    mount.z += car.pos.z;
    ws.onBoost = false;
    if (!raycast(world, mount, ray, reach, hit)) {
      ws.contact = false;
      ws.comp = 0;
      ws.slip = 0;
      ws.spinVel *= 0.995;
      ws.spin += ws.spinVel * DT;
      continue;
    }
    grounded++;
    ws.contact = true;
    const comp = reach - hit.t;
    ws.comp = comp;
    const n = { x: hit.nx, y: hit.ny, z: hit.nz };
    const cp = { x: mount.x + ray.x * hit.t, y: mount.y + ray.y * hit.t, z: mount.z + ray.z * hit.t };
    const vMount = pointVel(car, mount);
    const compVel = -vdot(vMount, upV);
    let fs = CAR.spring * comp + (compVel > 0 ? CAR.damperBump : CAR.damperRebound) * compVel;
    // Progressive bump stop near full compression.
    const stop = CAR.restLength * 0.85;
    // Progressive, heavily damped bump stop: big landings are absorbed
    // instead of being thrown back into the air.
    if (comp > stop) fs += CAR.spring * 8 * (comp - stop) + CAR.bumpStopDamp * compVel;
    if (fs < 0) fs = 0;
    addForceAt(cp, { x: upV.x * fs, y: upV.y * fs, z: upV.z * fs });

    // Tyre frame on the contact plane.
    let hx = fwd.x, hy = fwd.y, hz = fwd.z;
    if (wd.front) {
      hx = fwd.x * cs + left.x * sn;
      hy = fwd.y * cs + left.y * sn;
      hz = fwd.z * cs + left.z * sn;
    }
    const hn = hx * n.x + hy * n.y + hz * n.z;
    let fwx = hx - n.x * hn, fwy = hy - n.y * hn, fwz = hz - n.z * hn;
    const fl = Math.sqrt(fwx * fwx + fwy * fwy + fwz * fwz) || 1;
    fwx /= fl;
    fwy /= fl;
    fwz /= fl;
    const lw = vcross(n, { x: fwx, y: fwy, z: fwz });

    const vc = pointVel(car, cp);
    const vLong = vc.x * fwx + vc.y * fwy + vc.z * fwz;
    const vLat = vdot(vc, lw);
    const load = fs;

    // Lateral grip, capped so a single substep can never over-correct: the
    // cap is the force that would cancel a fraction of this wheel's slip in
    // one step given the car's effective mass AT this wheel (translation +
    // rotation). Without it, stiff grip makes the yaw chatter back and forth
    // every substep — invisible on screen, but it eats grip and feels vague.
    const rw = { x: cp.x - car.pos.x, y: cp.y - car.pos.y, z: cp.z - car.pos.z };
    const rl = vcross(rw, lw);
    const invMeff = 1 / m + vdot(vcross(invInertia(car.rot, rl), rw), lw);
    const stiffCap = (CAR.gripStepFraction / invMeff) / DT;
    const stiff = Math.min(wd.front ? CAR.latStiffFront : CAR.latStiffRear, stiffCap);
    let fLat = -vLat * stiff;
    let fLong = 0;
    if (braking) {
      const share = (wd.front ? 0.6 : 0.4) * CAR.brakeForce * 0.5;
      // Never brake past zero within a step (avoids chatter at standstill).
      const stopF = (Math.abs(vLong) * (m / 4)) / DT;
      fLong = -Math.sign(vLong) * Math.min(share, stopF);
    } else if (drive !== 0) {
      fLong = drive * (wd.front ? 0.2 : 0.3); // 40/60 split, 2 wheels each
    } else {
      // Coasting: rolling resistance + mild engine braking.
      const stopF = (Math.abs(vLong) * (m / 4)) / DT;
      fLong = -Math.sign(vLong) * Math.min(CAR.coastDrag / 4, stopF);
    }
    fLong -= vLong * CAR.rolling;

    // Friction circle: grip up to mu·N, then slide with reduced grip.
    // Grip fades a little with speed: fast corners need a wider arc.
    const fade = 1 - CAR.gripFade * Math.min(1, Math.abs(vf) / CAR.gripFadeSpeed);
    // Steering hard at speed lets the REAR give up some grip: the tail steps
    // out into a controlled slide and tucks back in as you unwind the wheel.
    const steerFrac = Math.min(1, Math.abs(car.steer) / Math.max(1e-3, steerLockNow));
    const speedFrac = Math.min(1, Math.abs(vf) / CAR.slideSpeed);
    // Fades out as the slide reaches its target angle, so it self-limits.
    const rearLoose = wd.front ? 1 : 1 - CAR.rearSlide * steerFrac * speedFrac * slideRoom;
    const limit = CAR.mu * load * fade * rearLoose;
    gripTotal += limit;
    gripLong += Math.abs(fLong);
    const total = Math.sqrt(fLat * fLat + fLong * fLong);
    if (total > limit) {
      const k = (limit * CAR.slideFactor) / total;
      fLat *= k;
      fLong *= k;
    }
    ws.slip = Math.abs(vLat);
    // Tyre forces act part-way up toward the centre of mass: the body still
    // leans a little, but lateral grip can never trip the car onto its roof.
    const rise = vdot({ x: car.pos.x - cp.x, y: car.pos.y - cp.y, z: car.pos.z - cp.z }, upV) * CAR.rollCentre;
    const app = { x: cp.x + upV.x * rise, y: cp.y + upV.y * rise, z: cp.z + upV.z * rise };
    // Cornering force acts at the wheel. Drive/brake force acts on the car's
    // centreline (as a differential would balance it): otherwise a wheel
    // clipped by the friction circle on one side lets the other side push
    // harder, and the car steers itself — a slow phantom drift under throttle.
    addForceAt(app, { x: lw.x * fLat, y: lw.y * fLat, z: lw.z * fLat });
    const off = (app.x - car.pos.x) * left.x + (app.y - car.pos.y) * left.y + (app.z - car.pos.z) * left.z;
    const mid = { x: app.x - left.x * off, y: app.y - left.y * off, z: app.z - left.z * off };
    addForceAt(mid, { x: fwx * fLong, y: fwy * fLong, z: fwz * fLong });

    if (world.surf[hit.tri] === SURF_BOOST) {
      ws.onBoost = true;
      const b = hit.tri * 3;
      const a = (CAR.boostAccel * m) / 4;
      fx += world.boostDir[b] * a;
      fy += world.boostDir[b + 1] * a;
      fz += world.boostDir[b + 2] * a;
    }

    ws.spinVel = vLong / CAR.wheelRadius;
    ws.spin += ws.spinVel * DT;
  }
  car.grounded = grounded;

  // Yaw assist (grounded): pull the car's rotation toward what the steering
  // asks for — the kinematic yaw rate v·tan(δ)/wheelbase — capped by what the
  // tyres can actually deliver. Steering becomes direct and predictable, a
  // released key settles the car straight instead of leaving it in a slow
  // drift, and slides still happen when you overcook the grip.
  if (grounded >= 2) {
    const wYaw = vdot(car.angVel, upV);
    const kin = (vf * (sn / cs)) / CAR.wheelbase;
    // Only the grip left over after braking/driving may be used to turn —
    // so braking hard into a corner trades rotation for stopping power.
    const latBudget = Math.sqrt(Math.max(0, gripTotal * gripTotal - gripLong * gripLong)) / m;
    // The assist may rotate the car a bit FASTER than the tyres can turn its
    // velocity (`slideLead`), so at the limit the nose leads and the car
    // slides through the corner — the slip angle scrubs speed by itself.
    // ...but only until the slide reaches `maxSlip`; past that the lead turns
    // into a correction, so a held corner settles at a steady drift angle
    // instead of building into a spin.
    const lead = 1 + (CAR.slideLead - 1) * (1 - slipNow / CAR.maxSlip);
    const cap = (Math.min(CAR.yawAssistGrip, latBudget) * Math.max(0.6, lead)) / Math.max(6, Math.abs(vf));
    const target = kin > cap ? cap : kin < -cap ? -cap : kin;
    const aYaw = (target - wYaw) * CAR.yawAssist * CAR.inertia.y * (grounded / 4);
    tx += upV.x * aYaw;
    ty += upV.y * aYaw;
    tz += upV.z * aYaw;
  }

  // Aerodynamics.
  const sp = Math.sqrt(car.vel.x * car.vel.x + car.vel.y * car.vel.y + car.vel.z * car.vel.z);
  fx -= car.vel.x * sp * CAR.drag;
  fy -= car.vel.y * sp * CAR.drag;
  fz -= car.vel.z * sp * CAR.drag;
  if (grounded > 0) {
    const df = Math.min(CAR.downforce * vf * vf, 9000);
    fx -= upV.x * df;
    fy -= upV.y * df;
    fz -= upV.z * df;
  } else {
    // Air behaviour. The nose slowly weathervanes toward the direction of
    // travel, so landings line up with downhill slopes; steering adds a
    // limited yaw RATE (a rate, not a torque, so holding a key can never spin
    // the car out of control).
    if (sp > 2) {
      const vdir = { x: car.vel.x / sp, y: car.vel.y / sp, z: car.vel.z / sp };
      const align = vdot(vcross(fwd, vdir), left); // + means pitch-down aligns
      const wPitch = vdot(car.angVel, left);
      const wYaw = vdot(car.angVel, upV);
      // No pitch input on purpose: players hold throttle through jumps, and
      // every jump must fly the same way every time.
      const tPitch = align * CAR.airAlign;
      const tYaw = steerIn * CAR.airYaw;
      const aPitch = (tPitch - wPitch) * CAR.airResponse * CAR.inertia.x;
      const aYaw = (tYaw - wYaw) * CAR.airResponse * 0.6 * CAR.inertia.y;
      tx += left.x * aPitch + upV.x * aYaw;
      ty += left.y * aPitch + upV.y * aYaw;
      tz += left.z * aPitch + upV.z * aYaw;
    }
    // Gentle roll levelling toward world-up keeps jumps readable.
    const rollErr = vdot(left, { x: 0, y: 1, z: 0 });
    const wRoll = vdot(car.angVel, fwd);
    const aRoll = (-rollErr * CAR.airRoll - wRoll * 1.5) * CAR.inertia.z;
    tx += fwd.x * aRoll;
    ty += fwd.y * aRoll;
    tz += fwd.z * aRoll;
  }

  // Integrate (semi-implicit Euler).
  car.vel.x += (fx / m) * DT;
  car.vel.y += (fy / m) * DT;
  car.vel.z += (fz / m) * DT;
  const dw = invInertia(car.rot, { x: tx, y: ty, z: tz });
  car.angVel.x += dw.x * DT;
  car.angVel.y += dw.y * DT;
  car.angVel.z += dw.z * DT;
  const damp = 1 - CAR.angDamp * DT;
  car.angVel.x *= damp;
  car.angVel.y *= damp;
  car.angVel.z *= damp;

  car.pos.x += car.vel.x * DT;
  car.pos.y += car.vel.y * DT;
  car.pos.z += car.vel.z * DT;
  const w = car.angVel;
  const q = car.rot;
  car.rot = qnorm({
    x: q.x + 0.5 * DT * (w.x * q.w + w.y * q.z - w.z * q.y),
    y: q.y + 0.5 * DT * (w.y * q.w + w.z * q.x - w.x * q.z),
    z: q.z + 0.5 * DT * (w.z * q.w + w.x * q.y - w.y * q.x),
    w: q.w + 0.5 * DT * (-w.x * q.x - w.y * q.y - w.z * q.z),
  });

  collideBody(car, world);
}

/** Push the body's spheres out of walls/road and apply contact impulses. */
function collideBody(car: CarState, world: CollisionWorld) {
  for (let s = 0; s < CAR.spheres.length; s++) {
    const sd = CAR.spheres[s];
    const c = qrot(car.rot, sd);
    c.x += car.pos.x;
    c.y += car.pos.y;
    c.z += car.pos.z;
    const r = sd.r;
    const ids = world.query(c.x - r, c.z - r, c.x + r, c.z + r, scratch);
    // Resolve the deepest contact for this sphere (stable, order-independent enough).
    let bestPen = 0;
    let nx = 0, ny = 0, nz = 0;
    let bestSurf = 0;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      closestOnTri(world, id, c, closest);
      const dx = c.x - closest.x, dy = c.y - closest.y, dz = c.z - closest.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2);
      const pen = r - d;
      if (pen <= bestPen) continue;
      bestPen = pen;
      bestSurf = world.surf[id];
      if (d > 1e-6) {
        nx = dx / d;
        ny = dy / d;
        nz = dz / d;
      } else {
        const N = world.normals;
        const sgn = (c.x - closest.x) * N[id * 3] + (c.y - closest.y) * N[id * 3 + 1] + (c.z - closest.z) * N[id * 3 + 2] >= 0 ? 1 : -1;
        nx = N[id * 3] * sgn;
        ny = N[id * 3 + 1] * sgn;
        nz = N[id * 3 + 2] * sgn;
      }
    }
    if (bestPen <= 0) continue;
    // Positional correction.
    car.pos.x += nx * bestPen;
    car.pos.y += ny * bestPen;
    car.pos.z += nz * bestPen;
    const p = { x: c.x - nx * r, y: c.y - ny * r, z: c.z - nz * r };
    const n = { x: nx, y: ny, z: nz };
    const vp = pointVel(car, p);
    const vn = vdot(vp, n);
    if (vn >= 0) continue;
    const rr = { x: p.x - car.pos.x, y: p.y - car.pos.y, z: p.z - car.pos.z };
    const rn = vcross(rr, n);
    const k = 1 / CAR.mass + vdot(vcross(invInertia(car.rot, rn), rr), n);
    const e = bestSurf === SURF_WALL ? CAR.wallRestitution : 0.05;
    const jn = (-(1 + e) * vn) / k;
    applyImpulse(car, p, { x: n.x * jn, y: n.y * jn, z: n.z * jn });
    if (jn > car.impact) car.impact = jn;
    // Coulomb friction along the sliding direction.
    const vp2 = pointVel(car, p);
    const vn2 = vdot(vp2, n);
    const vt = { x: vp2.x - n.x * vn2, y: vp2.y - n.y * vn2, z: vp2.z - n.z * vn2 };
    const vtl = Math.sqrt(vt.x * vt.x + vt.y * vt.y + vt.z * vt.z);
    if (vtl > 1e-6) {
      const tdir = { x: vt.x / vtl, y: vt.y / vtl, z: vt.z / vtl };
      const rt = vcross(rr, tdir);
      const kt = 1 / CAR.mass + vdot(vcross(invInertia(car.rot, rt), rr), tdir);
      const mu = bestSurf === SURF_WALL ? CAR.wallFriction : CAR.roadFriction;
      const jt = Math.min(vtl / kt, mu * jn);
      applyImpulse(car, p, { x: -tdir.x * jt, y: -tdir.y * jt, z: -tdir.z * jt });
    }
  }
}

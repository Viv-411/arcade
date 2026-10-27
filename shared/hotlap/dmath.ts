/**
 * Deterministic math for the Hotlap simulation.
 *
 * WHY THIS EXISTS: a run is verified by re-simulating the player's inputs on
 * the server (Node/V8) and comparing against what their browser computed
 * (V8, JavaScriptCore or SpiderMonkey). IEEE-754 guarantees bit-identical
 * results for + - * / and Math.sqrt, but NOT for Math.sin/cos/atan2/pow/exp/
 * hypot — engines are free to use different approximations, which would make
 * a Safari run fail verification on a Node server.
 *
 * RULE: simulation code (everything under shared/hotlap except rendering
 * helpers) may only use + - * /, Math.sqrt, Math.abs, Math.min/max,
 * Math.floor/round/trunc, and the functions in this file. Never Math.sin,
 * Math.cos, Math.atan2, Math.pow, Math.exp, Math.hypot, or `**` with a
 * non-integer exponent.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** Polynomial sine on [-π/2, π/2] (Taylor to x^17; error < 1e-13). */
function sinPoly(x: number): number {
  const x2 = x * x;
  // Horner form of x - x^3/3! + x^5/5! - ... - x^15/15! + x^17/17!
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 *
                        (-1 / 39916800 +
                          x2 *
                            (1 / 6227020800 +
                              x2 * (-1 / 1307674368000 + x2 * (1 / 355687428096000)))))))))
  );
}

/** Deterministic sine for any finite x. */
export function dsin(x: number): number {
  // Reduce to [-π, π]. Math.round is exact, so this step is deterministic.
  let r = x - TAU * Math.round(x / TAU);
  // Fold into [-π/2, π/2] using sin(π - r) = sin(r).
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinPoly(r);
}

/** Deterministic cosine. */
export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Hermite smoothstep on [0,1]. */
export function smooth01(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

export const DEG = PI / 180;

// ---------------------------------------------------------------------------
// Vectors — plain mutable objects; hot paths use the *Into variants to avoid
// allocation, everything else uses the allocating helpers for readability.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const vcopy = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
export const vadd = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vaddScaled = (a: V3, b: V3, s: number): V3 => ({
  x: a.x + b.x * s,
  y: a.y + b.y * s,
  z: a.z + b.z * s,
});
export const vdot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vlen = (a: V3): number => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const vlenSq = (a: V3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export function vnorm(a: V3): V3 {
  const l = vlen(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
}
export const vlerp = (a: V3, b: V3, t: number): V3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
/** Remove the component of `a` along unit vector `n`. */
export const vreject = (a: V3, n: V3): V3 => vaddScaled(a, n, -vdot(a, n));

// ---------------------------------------------------------------------------
// Quaternions (x, y, z, w), unit length.

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const qident = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });

export function qmul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function qnorm(q: Quat): Quat {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Rotate vector v by unit quaternion q. */
export function qrot(q: Quat, v: V3): V3 {
  // t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Rotate by the inverse (conjugate) of unit quaternion q. */
export function qrotInv(q: Quat, v: V3): V3 {
  return qrot({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

/** Quaternion from an axis (unit) and angle. */
export function qaxis(axis: V3, angle: number): Quat {
  const s = dsin(angle / 2);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: dcos(angle / 2) };
}

/**
 * Quaternion whose local frame maps +Z→fwd and +Y→up (both unit, orthogonal).
 * Local +X is then up × fwd, i.e. the car's LEFT side.
 */
export function qfromBasis(fwd: V3, up: V3): Quat {
  const left = vcross(up, fwd);
  // Rotation matrix columns: X=left, Y=up, Z=fwd.
  const m00 = left.x, m01 = up.x, m02 = fwd.x;
  const m10 = left.y, m11 = up.y, m12 = fwd.y;
  const m20 = left.z, m21 = up.z, m22 = fwd.z;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
  }
  return qnorm(q);
}

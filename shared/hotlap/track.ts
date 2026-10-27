/**
 * Hotlap tracks: a compact segment list ("turtle path") that is swept into a
 * smooth 3D ribbon of road. The SAME build runs in the browser (rendering +
 * simulation) and on the server (run verification), so it must only use the
 * deterministic math in dmath.ts — see the rule at the top of that file.
 *
 * Coordinates: metres, +Y up. Heading θ = 0 drives toward +Z; increasing θ
 * turns LEFT. A track starts at the origin heading +Z.
 */
import {
  clamp,
  dcos,
  DEG,
  dsin,
  smooth01,
  v3,
  vadd,
  vcross,
  vnorm,
  vscale,
  type V3,
} from "./dmath.js";

export type Walls = "both" | "left" | "right" | "none";

export interface SegCommon {
  /** Height change across the segment in metres (smooth, slope-continuous). */
  rise?: number;
  /** Bank angle in degrees reached at the END of the segment. Positive = LEFT edge up. */
  bank?: number;
  /** Road width in metres reached at the END of the segment. */
  width?: number;
  /** Barrier walls along this segment (default: the track's `walls`). */
  walls?: Walls;
  /** A checkpoint gate at the END of this segment. */
  cp?: boolean;
  /** Boost pad over this segment: pushes the car along the road while on it. */
  boost?: boolean;
  /** No road at all — a jump. The path continues so later segments line up. */
  gap?: boolean;
}

export type Seg =
  | ({ k: "s"; len: number } & SegCommon)
  /** Arc: `deg` > 0 turns left, < 0 turns right; `r` is the centreline radius. */
  | ({ k: "t"; deg: number; r: number } & SegCommon);

export type Difficulty = "easy" | "medium" | "hard" | "expert";

export interface TrackDef {
  id: string;
  name: string;
  difficulty: Difficulty;
  /** Bump when the geometry changes so stored records/ghosts are invalidated. */
  version: number;
  /** Default road width (m). */
  width: number;
  /** Default wall setting. */
  walls: Walls;
  segs: Seg[];
  /** Medal thresholds in ms (finish at or under to earn). */
  medals: { bronze: number; silver: number; gold: number; ace: number };
  /** Visual theme key (renderer only). */
  theme: string;
  /** Short flavour line for the track list. */
  blurb: string;
}

/** One cross-section of the built road. */
export interface Frame {
  /** Distance along the centreline from the start (m). */
  s: number;
  seg: number;
  /** Centreline point (on the road surface). */
  p: V3;
  /** Unit tangent (direction of travel). */
  t: V3;
  /** Unit lateral pointing to the driver's LEFT, in the road plane. */
  l: V3;
  /** Unit road normal. */
  n: V3;
  width: number;
}

export interface Gate {
  /** 0..n-1 checkpoints, then the finish. */
  index: number;
  isFinish: boolean;
  frame: Frame;
}

export const WALL_HEIGHT = 1.4;
/** Surface tags stored per triangle. */
export const SURF_ROAD = 0;
export const SURF_BOOST = 1;
export const SURF_WALL = 2;

export interface BuiltTrack {
  def: TrackDef;
  /** Frames per segment (inclusive of both ends), for meshing. */
  segFrames: Frame[][];
  gates: Gate[];
  spawn: Frame;
  /** Below this Y the car is considered lost and respawns. */
  killY: number;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  totalLength: number;
  world: CollisionWorld;
}

// ---------------------------------------------------------------------------
// Path building

function segLength(seg: Seg): number {
  return seg.k === "s" ? seg.len : seg.r * Math.abs(seg.deg) * DEG;
}

/** Hermite basis evaluation for the elevation profile. */
function hermite(h0: number, h1: number, m0: number, m1: number, L: number, u: number) {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  return {
    h: h00 * h0 + h01 * h1 + L * (h10 * m0 + h11 * m1),
    slope: (d00 * h0 + d01 * h1) / L + d10 * m0 + d11 * m1,
  };
}

/** Knot slopes (dh/ds) at each segment boundary — monotone, jump-aware. */
function knotSlopes(def: TrackDef): number[] {
  const segs = def.segs;
  const sec = segs.map((s) => (s.rise ?? 0) / segLength(s));
  const m: number[] = new Array(segs.length + 1).fill(0);
  for (let i = 1; i < segs.length; i++) {
    const a = segs[i - 1];
    const b = segs[i];
    const da = sec[i - 1];
    const db = sec[i];
    if (b.gap && !a.gap) {
      // A lip: leave at a little more than the average ramp angle so a
      // kicker actually kicks (still monotone: Hermite allows up to 3x).
      m[i] = 1.5 * da;
    } else if (a.gap && !b.gap) {
      m[i] = 1.5 * db;
    } else if (da * db > 0) {
      m[i] = (2 * da * db) / (da + db); // harmonic mean keeps climbs smooth
    } else {
      m[i] = 0;
    }
  }
  return m;
}

/** Build the frames for every segment. */
function buildFrames(def: TrackDef): Frame[][] {
  const m = knotSlopes(def);
  const out: Frame[][] = [];
  let x = 0;
  let z = 0;
  let theta = 0;
  let h = 0;
  let bank = 0;
  let width = def.width;
  let sTotal = 0;

  for (let i = 0; i < def.segs.length; i++) {
    const seg = def.segs[i];
    const L = segLength(seg);
    const h1 = h + (seg.rise ?? 0);
    const bank1 = seg.bank ?? bank;
    const width1 = seg.width ?? width;
    const turnAngle = seg.k === "t" ? Math.abs(seg.deg) * DEG : 0;
    // Sample densely enough for smooth curves and smooth elevation.
    const n = Math.max(1, Math.ceil(L / 2), Math.ceil(turnAngle / (3 * DEG)));
    const frames: Frame[] = [];
    const sigma = seg.k === "t" ? (seg.deg > 0 ? 1 : -1) : 0;
    const r = seg.k === "t" ? seg.r : 0;
    const lx0 = dcos(theta);
    const lz0 = -dsin(theta);

    for (let j = 0; j <= n; j++) {
      const u = j / n;
      const s = u * L;
      let px: number;
      let pz: number;
      let th: number;
      if (seg.k === "s") {
        th = theta;
        px = x + dsin(theta) * s;
        pz = z + dcos(theta) * s;
      } else {
        th = theta + (sigma * s) / r;
        // p(s) = p0 + σ r (left(θ0) - left(θ(s))), left(θ) = (cos θ, 0, -sin θ)
        px = x + sigma * r * (lx0 - dcos(th));
        pz = z + sigma * r * (lz0 + dsin(th));
      }
      const e = hermite(h, h1, m[i], m[i + 1], L, u);
      const b = (bank + (bank1 - bank) * smooth01(u)) * DEG;
      const w = width + (width1 - width) * smooth01(u);

      const t = vnorm(v3(dsin(th), e.slope, dcos(th)));
      const l0 = v3(dcos(th), 0, -dsin(th));
      const n0 = vnorm(vcross(t, l0));
      const cb = dcos(b);
      const sb = dsin(b);
      const l = vnorm(vadd(vscale(l0, cb), vscale(n0, sb)));
      const nn = vnorm(vadd(vscale(n0, cb), vscale(l0, -sb)));
      frames.push({ s: sTotal + s, seg: i, p: v3(px, e.h, pz), t, l, n: nn, width: w });
    }
    out.push(frames);

    const last = frames[frames.length - 1];
    x = last.p.x;
    z = last.p.z;
    theta = seg.k === "s" ? theta : theta + sigma * turnAngle;
    h = h1;
    bank = bank1;
    width = width1;
    sTotal += L;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Collision world: a flat triangle soup in a uniform XZ hash grid.

const CELL = 8;
const keyOf = (ix: number, iz: number) => (ix + 32768) * 65536 + (iz + 32768);

export class CollisionWorld {
  /** 9 floats per triangle: a, b, c. */
  readonly verts: number[] = [];
  /** 3 floats per triangle: unit normal (as wound). */
  readonly normals: number[] = [];
  readonly surf: number[] = [];
  /** 3 floats per triangle: boost direction (zero unless SURF_BOOST). */
  readonly boostDir: number[] = [];
  /** 9 floats per triangle: smooth vertex normals (face normal if none given). */
  readonly vnormals: number[] = [];
  private grid = new Map<number, number[]>();
  private stamp: Int32Array = new Int32Array(0);
  private queryId = 0;

  get count() {
    return this.surf.length;
  }

  addTri(a: V3, b: V3, c: V3, surf: number, boost?: V3, na?: V3, nb?: V3, nc?: V3) {
    const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z;
    const e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-9) return; // degenerate
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const id = this.surf.length;
    this.verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.normals.push(nx, ny, nz);
    this.surf.push(surf);
    this.boostDir.push(boost?.x ?? 0, boost?.y ?? 0, boost?.z ?? 0);
    if (na && nb && nc) this.vnormals.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z);
    else this.vnormals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x);
    const minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const k = keyOf(ix, iz);
        let cell = this.grid.get(k);
        if (!cell) this.grid.set(k, (cell = []));
        cell.push(id);
      }
    }
  }

  /** Finish construction (sizes the de-dup stamp buffer). */
  seal() {
    this.stamp = new Int32Array(this.count);
  }

  /**
   * Triangle ids whose cells overlap the XZ box. Order is deterministic
   * (cell scan order, then insertion order) and each id appears once.
   */
  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number[] {
    out.length = 0;
    const q = ++this.queryId;
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const cell = this.grid.get(keyOf(ix, iz));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const id = cell[i];
          if (this.stamp[id] !== q) {
            this.stamp[id] = q;
            out.push(id);
          }
        }
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------

const buildCache = new Map<string, BuiltTrack>();

/** Build (and cache) a track's geometry, gates and collision world. */
export function buildTrack(def: TrackDef): BuiltTrack {
  const cacheKey = `${def.id}@${def.version}`;
  const cached = buildCache.get(cacheKey);
  if (cached && cached.def === def) return cached;

  const segFrames = buildFrames(def);
  const world = new CollisionWorld();
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const gates: Gate[] = [];

  const edge = (f: Frame, side: 1 | -1): V3 => vadd(f.p, vscale(f.l, (side * f.width) / 2));
  const wallTop = (f: Frame, side: 1 | -1): V3 => vadd(edge(f, side), vscale(f.n, WALL_HEIGHT));

  def.segs.forEach((seg, i) => {
    const frames = segFrames[i];
    for (const f of frames) {
      for (const side of [1, -1] as const) {
        const e = edge(f, side);
        bounds.minX = Math.min(bounds.minX, e.x);
        bounds.maxX = Math.max(bounds.maxX, e.x);
        bounds.minY = Math.min(bounds.minY, e.y);
        bounds.maxY = Math.max(bounds.maxY, e.y);
        bounds.minZ = Math.min(bounds.minZ, e.z);
        bounds.maxZ = Math.max(bounds.maxZ, e.z);
      }
    }
    if (seg.gap) return;
    const walls = seg.walls ?? def.walls;
    const surf = seg.boost ? SURF_BOOST : SURF_ROAD;
    for (let j = 0; j + 1 < frames.length; j++) {
      const f0 = frames[j];
      const f1 = frames[j + 1];
      const l0 = edge(f0, 1), r0 = edge(f0, -1);
      const l1 = edge(f1, 1), r1 = edge(f1, -1);
      // Road top, wound so the normal points up (l→r→r1 is counter-clockwise from above).
      world.addTri(l0, r0, r1, surf, f0.t, f0.n, f0.n, f1.n);
      world.addTri(l0, r1, l1, surf, f0.t, f0.n, f1.n, f1.n);
      // Walls (faces point inward toward the road; collision is two-sided).
      if (walls === "both" || walls === "left") {
        world.addTri(l0, l1, wallTop(f1, 1), SURF_WALL);
        world.addTri(l0, wallTop(f1, 1), wallTop(f0, 1), SURF_WALL);
      }
      if (walls === "both" || walls === "right") {
        world.addTri(r0, wallTop(f0, -1), wallTop(f1, -1), SURF_WALL);
        world.addTri(r0, wallTop(f1, -1), r1, SURF_WALL);
      }
    }
  });
  world.seal();

  // Gates: checkpoints at the end of flagged segments, finish at the very end.
  let cpIndex = 0;
  def.segs.forEach((seg, i) => {
    if (seg.cp && i < def.segs.length - 1) {
      const f = segFrames[i][segFrames[i].length - 1];
      gates.push({ index: cpIndex++, isFinish: false, frame: f });
    }
  });
  const lastSeg = segFrames[segFrames.length - 1];
  gates.push({ index: cpIndex, isFinish: true, frame: lastSeg[lastSeg.length - 1] });

  // Spawn a few metres in, so the start arch sits just behind the car.
  const first = segFrames[0];
  const spawn = first.find((f) => f.s >= 3) ?? first[first.length - 1];

  const totalLength = lastSeg[lastSeg.length - 1].s;
  const built: BuiltTrack = {
    def,
    segFrames,
    gates,
    spawn,
    killY: bounds.minY - 25,
    bounds,
    totalLength,
    world,
  };
  buildCache.set(cacheKey, built);
  return built;
}

/** Validate a definition; returns a list of problems (empty = OK). */
export function validateTrack(def: TrackDef): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9-]+$/.test(def.id)) errs.push("id must be kebab-case");
  if (def.segs.length < 2) errs.push("needs at least 2 segments");
  if (def.segs[0]?.gap) errs.push("first segment cannot be a gap");
  if (def.segs[def.segs.length - 1]?.gap) errs.push("last segment cannot be a gap");
  def.segs.forEach((s, i) => {
    if (s.k === "s" && !(s.len > 0)) errs.push(`seg ${i}: len must be > 0`);
    if (s.k === "t" && !(s.r >= 6)) errs.push(`seg ${i}: radius must be >= 6`);
    if (s.k === "t" && !(Math.abs(s.deg) > 0 && Math.abs(s.deg) <= 360)) errs.push(`seg ${i}: bad deg`);
    if (s.width !== undefined && !(s.width >= 6 && s.width <= 40)) errs.push(`seg ${i}: width out of range`);
    if (s.bank !== undefined && Math.abs(s.bank) > 45) errs.push(`seg ${i}: bank beyond 45°`);
    if (s.gap && s.cp) errs.push(`seg ${i}: a gap cannot hold a checkpoint`);
  });
  const m = def.medals;
  if (!(m.ace < m.gold && m.gold < m.silver && m.silver < m.bronze)) errs.push("medals must be ace < gold < silver < bronze");
  return errs;
}

/** Clamp helper re-exported for callers that build tracks procedurally. */
export { clamp };

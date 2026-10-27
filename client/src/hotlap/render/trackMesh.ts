/**
 * Turns a BuiltTrack into three.js meshes. Purely visual: collision uses the
 * shared geometry in shared/hotlap/track.ts, built from the SAME frames, so
 * what you see is exactly what you drive on.
 */
import * as THREE from "three";
import { WALL_HEIGHT, type BuiltTrack, type Frame } from "@shared/hotlap/track";
import type { Theme } from "../themes";

const SLAB = 0.7; // visual road thickness (m)

/** Accumulates triangles for one material, then emits a BufferGeometry. */
class Geo {
  pos: number[] = [];
  nrm: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  col: number[] | null = null;

  vert(p: THREE.Vector3Like, n: THREE.Vector3Like, u: number, v: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nrm.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const add = (a: THREE.Vector3Like, b: THREE.Vector3Like, s = 1) => V(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
const neg = (a: THREE.Vector3Like) => V(-a.x, -a.y, -a.z);

// ---------------------------------------------------------------------------
// Procedural textures (canvas) — no binary assets in the repo.

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = true) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d")!;
  draw(ctx);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  const img = ctx.getImageData(0, 0, w, h);
  let seed = 1337;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const n = ((seed / 2147483647) - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function roadTexture(theme: Theme) {
  return canvasTex(256, 512, (c) => {
    c.fillStyle = theme.road;
    c.fillRect(0, 0, 256, 512);
    noise(c, 256, 512, 16);
    // Edge lines.
    c.fillStyle = theme.roadLine;
    c.globalAlpha = 0.9;
    c.fillRect(8, 0, 6, 512);
    c.fillRect(242, 0, 6, 512);
    // Centre dashes (one dash per tile).
    c.globalAlpha = 0.55;
    c.fillRect(125, 40, 6, 200);
    // Subtle lane seams.
    c.globalAlpha = 0.08;
    c.fillRect(64, 0, 2, 512);
    c.fillRect(190, 0, 2, 512);
  });
}

function boostTexture(theme: Theme) {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = "#0c0c14";
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = theme.accent2;
    c.lineWidth = 26;
    c.lineCap = "round";
    c.lineJoin = "round";
    for (const y of [70, 190]) {
      c.beginPath();
      c.moveTo(40, y + 40);
      c.lineTo(128, y - 30);
      c.lineTo(216, y + 40);
      c.stroke();
    }
  });
}

function kerbTexture(theme: Theme) {
  return canvasTex(32, 64, (c) => {
    c.fillStyle = theme.accent;
    c.fillRect(0, 0, 32, 32);
    c.fillStyle = "#f4f4f4";
    c.fillRect(0, 32, 32, 32);
  });
}

function checkerTexture() {
  return canvasTex(256, 64, (c) => {
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 4; y++) {
        c.fillStyle = (x + y) % 2 ? "#111" : "#f5f5f5";
        c.fillRect(x * 16, y * 16, 16, 16);
      }
  }, false);
}

function gridTexture(theme: Theme) {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = theme.ground;
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = theme.grid;
    c.globalAlpha = 0.55;
    c.lineWidth = 3;
    c.strokeRect(0, 0, 256, 256);
    c.globalAlpha = 0.18;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(128, 0);
    c.lineTo(128, 256);
    c.moveTo(0, 128);
    c.lineTo(256, 128);
    c.stroke();
  });
}

function labelTexture(text: string, fg: string, bg: string) {
  return canvasTex(512, 96, (c) => {
    c.fillStyle = bg;
    c.fillRect(0, 0, 512, 96);
    c.fillStyle = fg;
    c.font = "bold 58px 'Press Start 2P', 'Space Grotesk', monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, 256, 52);
  }, false);
}

// ---------------------------------------------------------------------------

export interface TrackVisuals {
  group: THREE.Group;
  /** Per checkpoint gate (index-aligned with track.gates), for pass effects. */
  gateMeshes: THREE.Object3D[];
  boostTex: THREE.Texture | null;
  groundY: number;
  dispose(): void;
}

export function buildTrackVisuals(track: BuiltTrack, theme: Theme): TrackVisuals {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const road = new Geo();
  const boost = new Geo();
  const slab = new Geo();
  const wallGlass = new Geo();
  const wallRail = new Geo();
  const kerb = new Geo();

  const edge = (f: Frame, side: 1 | -1, inset = 0) => add(f.p, f.l, side * (f.width / 2 - inset));

  track.def.segs.forEach((seg, si) => {
    if (seg.gap) return;
    const frames = track.segFrames[si];
    const walls = seg.walls ?? track.def.walls;
    const target = seg.boost ? boost : road;
    // Road surface strip.
    let prev: number[] | null = null;
    for (const f of frames) {
      const v = f.s / 12;
      const ids = [target.vert(edge(f, 1), f.n, 0, v), target.vert(edge(f, -1), f.n, 1, v)];
      if (prev) target.quad(prev[0], prev[1], ids[1], ids[0]);
      prev = ids;
    }
    // Slab sides + underside.
    let prevS: number[] | null = null;
    for (const f of frames) {
      const down = neg(f.n);
      const lt = edge(f, 1), rt = edge(f, -1);
      const lb = add(lt, f.n, -SLAB), rb = add(rt, f.n, -SLAB);
      const ids = [
        slab.vert(lt, f.l, 0, f.s / 8), slab.vert(lb, f.l, 1, f.s / 8),
        slab.vert(rt, neg(f.l), 0, f.s / 8), slab.vert(rb, neg(f.l), 1, f.s / 8),
        slab.vert(lb, down, 0, f.s / 8), slab.vert(rb, down, 1, f.s / 8),
      ];
      if (prevS) {
        slab.quad(prevS[0], ids[0], ids[1], prevS[1]);
        slab.quad(prevS[2], prevS[3], ids[3], ids[2]);
        slab.quad(prevS[4], ids[4], ids[5], prevS[5]);
      }
      prevS = ids;
    }
    // Walls (glass panel + glowing top rail), or kerbs where there's a drop.
    for (const side of [1, -1] as const) {
      const hasWall = walls === "both" || (side === 1 ? walls === "left" : walls === "right");
      let p0: number[] | null = null;
      for (const f of frames) {
        const base = edge(f, side);
        const inward = side === 1 ? neg(f.l) : f.l;
        if (hasWall) {
          const top = add(base, f.n, WALL_HEIGHT);
          const railIn = add(top, inward, 0.06);
          const railTop = add(top, f.n, 0.14);
          const ids = [
            wallGlass.vert(base, inward, 0, f.s / 6), wallGlass.vert(top, inward, 1, f.s / 6),
            wallRail.vert(railIn, f.n, 0, 0), wallRail.vert(railTop, f.n, 1, 0),
          ];
          if (p0) {
            wallGlass.quad(p0[0], ids[0], ids[1], p0[1]);
            wallRail.quad(p0[2], ids[2], ids[3], p0[3]);
          }
          p0 = ids;
        } else {
          const outer = add(base, f.n, 0.03);
          const inner = add(add(base, inward, 0.7), f.n, 0.03);
          const ids = [kerb.vert(outer, f.n, 0, f.s / 4), kerb.vert(inner, f.n, 1, f.s / 4)];
          if (p0) kerb.quad(p0[0], ids[0], ids[1], p0[1]);
          p0 = ids;
        }
      }
    }
  });

  const roadTex = keep(roadTexture(theme));
  roadTex.repeat.set(1, 1);
  const roadMat = keep(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0.05 }));
  const meshRoad = new THREE.Mesh(keep(road.build()), roadMat);
  meshRoad.receiveShadow = true;
  group.add(meshRoad);

  let boostTex: THREE.Texture | null = null;
  if (boost.pos.length) {
    boostTex = keep(boostTexture(theme));
    const m = keep(new THREE.MeshStandardMaterial({
      map: boostTex,
      emissive: new THREE.Color(theme.accent2),
      emissiveMap: boostTex,
      emissiveIntensity: 1.6,
      roughness: 0.4,
    }));
    const mesh = new THREE.Mesh(keep(boost.build()), m);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const slabMat = keep(new THREE.MeshStandardMaterial({
    color: new THREE.Color(theme.road).multiplyScalar(0.55),
    roughness: 0.9,
    side: THREE.DoubleSide,
  }));
  group.add(new THREE.Mesh(keep(slab.build()), slabMat));

  if (wallGlass.pos.length) {
    const glass = keep(new THREE.MeshStandardMaterial({
      color: theme.wall,
      emissive: new THREE.Color(theme.wall),
      emissiveIntensity: 0.25,
      transparent: true,
      opacity: theme.wallOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      roughness: 0.2,
    }));
    group.add(new THREE.Mesh(keep(wallGlass.build()), glass));
    const rail = keep(new THREE.MeshBasicMaterial({ color: theme.accent, side: THREE.DoubleSide }));
    group.add(new THREE.Mesh(keep(wallRail.build()), rail));
  }
  if (kerb.pos.length) {
    const kt = keep(kerbTexture(theme));
    const km = keep(new THREE.MeshStandardMaterial({ map: kt, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide }));
    group.add(new THREE.Mesh(keep(kerb.build()), km));
  }

  // Support pillars under raised road (visual only).
  const groundY = track.bounds.minY - 18;
  const pillarGeo = keep(new THREE.BoxGeometry(1.6, 1, 1.6));
  const pillarMat = keep(new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.road).multiplyScalar(0.7), roughness: 0.95 }));
  const pillarSpots: THREE.Vector3[] = [];
  track.def.segs.forEach((seg, si) => {
    if (seg.gap) return;
    for (const f of track.segFrames[si]) {
      if (Math.floor(f.s / 26) === Math.floor((f.s - 2.0001) / 26)) continue;
      pillarSpots.push(add(f.p, f.n, -SLAB));
    }
  });
  // A pillar must never stand on (or pass through) another stretch of road
  // underneath it — on stacked/bridged tracks it stops above that deck.
  const solidFrames: Frame[] = [];
  track.def.segs.forEach((seg, si) => {
    if (!seg.gap) solidFrames.push(...track.segFrames[si]);
  });
  const pillars: { x: number; z: number; top: number; bottom: number }[] = [];
  for (const p of pillarSpots) {
    let bottom = groundY;
    for (const f of solidFrames) {
      if (f.p.y >= p.y - 2) continue; // not below this pillar
      const dx = f.p.x - p.x;
      const dz = f.p.z - p.z;
      const reach = f.width / 2 + 2;
      if (dx * dx + dz * dz < reach * reach) bottom = Math.max(bottom, f.p.y + WALL_HEIGHT + 4);
    }
    if (p.y - bottom > 1) pillars.push({ x: p.x, z: p.z, top: p.y, bottom: bottom === groundY ? groundY : Infinity });
  }
  const standing = pillars.filter((p) => p.bottom === groundY);
  if (standing.length) {
    const inst = new THREE.InstancedMesh(pillarGeo, pillarMat, standing.length);
    const m = new THREE.Matrix4();
    standing.forEach((p, i) => {
      const h = Math.max(0.5, p.top - groundY);
      m.compose(V(p.x, groundY + h / 2, p.z), new THREE.Quaternion(), V(1, h, 1));
      inst.setMatrixAt(i, m);
    });
    group.add(inst);
  }

  // Gates.
  const gateMeshes: THREE.Object3D[] = [];
  const beamMat = keep(new THREE.MeshBasicMaterial({ color: theme.accent }));
  const postGeo = keep(new THREE.BoxGeometry(0.5, 1, 0.5));
  const makeArch = (f: Frame, color: THREE.Material, label?: THREE.Texture) => {
    const g = new THREE.Group();
    const half = f.width / 2 + 0.6;
    const h = 7;
    for (const side of [1, -1]) {
      const post = new THREE.Mesh(postGeo, color);
      post.scale.set(1, h, 1);
      post.position.copy(add(add(f.p, f.l, side * half), f.n, h / 2));
      post.quaternion.copy(frameQuat(f));
      g.add(post);
    }
    const beamGeo = keep(new THREE.BoxGeometry(half * 2 + 0.5, label ? 1.6 : 0.5, 0.5));
    const beam = new THREE.Mesh(beamGeo, label
      ? keep(new THREE.MeshBasicMaterial({ map: label }))
      : color);
    beam.position.copy(add(f.p, f.n, h));
    beam.quaternion.copy(frameQuat(f));
    g.add(beam);
    group.add(g);
    return g;
  };
  const spawnF = track.segFrames[0][0];
  makeArch(spawnF, beamMat, keep(labelTexture("START", "#ffffff", "#141420")));
  for (const gate of track.gates) {
    if (gate.isFinish) {
      gateMeshes.push(makeArch(gate.frame, beamMat, keep(checkerTexture())));
    } else {
      const mat = keep(new THREE.MeshBasicMaterial({ color: theme.accent2 }));
      gateMeshes.push(makeArch(gate.frame, mat));
    }
  }

  // Ground: a neon grid far below the track.
  const gridTex = keep(gridTexture(theme));
  const size = 8000;
  gridTex.repeat.set(size / 40, size / 40);
  const ground = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(size, size)),
    keep(new THREE.MeshStandardMaterial({ map: gridTex, emissive: new THREE.Color(theme.grid), emissiveMap: gridTex, emissiveIntensity: 0.35, roughness: 1 })),
  );
  ground.rotation.x = -Math.PI / 2;
  const cx = (track.bounds.minX + track.bounds.maxX) / 2;
  const cz = (track.bounds.minZ + track.bounds.maxZ) / 2;
  ground.position.set(cx, groundY, cz);
  ground.receiveShadow = true;
  group.add(ground);

  return {
    group,
    gateMeshes,
    boostTex,
    groundY,
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

/** Orientation whose local X = frame left, Y = normal, Z = tangent. */
export function frameQuat(f: Frame): THREE.Quaternion {
  const m = new THREE.Matrix4().makeBasis(V(f.l.x, f.l.y, f.l.z), V(f.n.x, f.n.y, f.n.z), V(f.t.x, f.t.y, f.t.z));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

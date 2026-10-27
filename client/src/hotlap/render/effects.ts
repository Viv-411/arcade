/**
 * Cosmetic effects: tyre smoke, sparks, skid marks, exhaust glow. Purely
 * visual — driven from interpolated car state, never fed back into physics.
 */
import * as THREE from "three";
import { CAR, type CarState } from "@shared/hotlap/car";

const MAX_PARTICLES = 260;
const MAX_SKID = 900; // quads in the skid-mark ring buffer

const pointVS = `
  attribute float alpha;
  attribute float size;
  attribute vec3 tint;
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vAlpha = alpha;
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const pointFS = `
  varying float vAlpha;
  varying vec3 vTint;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vTint, vAlpha * smoothstep(0.5, 0.15, d));
  }`;

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number; grow: number;
  r: number; g: number; b: number;
  gravity: number;
  a0: number;
}

class ParticleSystem {
  readonly points: THREE.Points;
  private parts: Particle[] = [];
  private pos = new Float32Array(MAX_PARTICLES * 3);
  private alpha = new Float32Array(MAX_PARTICLES);
  private size = new Float32Array(MAX_PARTICLES);
  private tint = new Float32Array(MAX_PARTICLES * 3);
  private geo = new THREE.BufferGeometry();

  constructor(additive: boolean) {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute("tint", new THREE.BufferAttribute(this.tint, 3));
    const mat = new THREE.ShaderMaterial({
      vertexShader: pointVS,
      fragmentShader: pointFS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  emit(p: Omit<Particle, "life">) {
    if (this.parts.length >= MAX_PARTICLES) this.parts.shift();
    this.parts.push({ ...p, life: p.max });
  }

  update(dt: number) {
    let n = 0;
    this.parts = this.parts.filter((p) => (p.life -= dt) > 0);
    for (const p of this.parts) {
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vx *= 1 - dt * 1.5;
      p.vz *= 1 - dt * 1.5;
      p.size += p.grow * dt;
      const t = p.life / p.max;
      this.pos[n * 3] = p.x;
      this.pos[n * 3 + 1] = p.y;
      this.pos[n * 3 + 2] = p.z;
      this.alpha[n] = p.a0 * t;
      this.size[n] = p.size;
      this.tint[n * 3] = p.r;
      this.tint[n * 3 + 1] = p.g;
      this.tint[n * 3 + 2] = p.b;
      n++;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ["position", "alpha", "size", "tint"]) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.parts = [];
    this.geo.setDrawRange(0, 0);
  }

  dispose() {
    this.geo.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

/** Ring buffer of flat quads laid on the road behind sliding rear wheels. */
class SkidMarks {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(MAX_SKID * 4 * 3);
  private alpha = new Float32Array(MAX_SKID * 4);
  private geo = new THREE.BufferGeometry();
  private head = 0;
  private last: (THREE.Vector3 | null)[] = [null, null];

  constructor() {
    const idx: number[] = [];
    for (let i = 0; i < MAX_SKID; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    this.geo.setIndex(idx);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      vertexShader: `attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.03,0.03,0.05, vA); }`,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
  }

  /** Extend wheel `w`'s mark to point `p` with across-vector `side` (or break it). */
  add(w: number, p: THREE.Vector3 | null, side: THREE.Vector3, strength: number) {
    const prev = this.last[w];
    this.last[w] = p ? p.clone() : null;
    if (!p || !prev || prev.distanceToSquared(p) > 9 || prev.distanceToSquared(p) < 0.04) {
      if (p && prev && prev.distanceToSquared(p) < 0.04) this.last[w] = prev; // too short: wait
      return;
    }
    const i = this.head;
    this.head = (this.head + 1) % MAX_SKID;
    const hw = 0.13;
    const v = [
      prev.x + side.x * hw, prev.y + side.y * hw, prev.z + side.z * hw,
      prev.x - side.x * hw, prev.y - side.y * hw, prev.z - side.z * hw,
      p.x - side.x * hw, p.y - side.y * hw, p.z - side.z * hw,
      p.x + side.x * hw, p.y + side.y * hw, p.z + side.z * hw,
    ];
    this.pos.set(v, i * 12);
    const a = Math.min(0.55, strength);
    this.alpha.set([a, a, a, a], i * 4);
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.pos.fill(0);
    this.alpha.fill(0);
    this.last = [null, null];
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("alpha") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class Effects {
  readonly group = new THREE.Group();
  private smoke = new ParticleSystem(false);
  private sparks = new ParticleSystem(true);
  private skids = new SkidMarks();
  private exhaust: THREE.Sprite;
  private exhaustTex: THREE.Texture;
  private headlight: THREE.SpotLight | null = null;
  private smokeAcc = 0;

  constructor(night: boolean, private carRoot: THREE.Object3D) {
    this.group.add(this.smoke.points, this.sparks.points, this.skids.mesh);
    const cv = document.createElement("canvas");
    cv.width = cv.height = 64;
    const c = cv.getContext("2d")!;
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.3, "rgba(120,220,255,0.6)");
    g.addColorStop(1, "rgba(0,120,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    this.exhaustTex = new THREE.CanvasTexture(cv);
    this.exhaust = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.exhaustTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.exhaust.position.set(0, -0.12, -2.35);
    this.exhaust.scale.set(0.01, 0.01, 1);
    carRoot.add(this.exhaust);
    if (night) {
      const spot = new THREE.SpotLight("#fff4dd", 900, 110, 0.55, 0.55, 1.2);
      spot.position.set(0, 0.1, 2.0);
      spot.target.position.set(0, -1.2, 14);
      carRoot.add(spot, spot.target);
      this.headlight = spot;
    }
  }

  reset() {
    this.smoke.clear();
    this.sparks.clear();
    this.skids.clear();
  }

  update(dt: number, s: CarState, rot: THREE.Quaternion, pos: THREE.Vector3, throttle: boolean, boosting: boolean, impact: number) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rot);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(rot);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(rot);
    const speed = Math.abs(s.speed);

    this.smokeAcc += dt;
    const emitSmoke = this.smokeAcc > 1 / 45;
    if (emitSmoke) this.smokeAcc = 0;
    CAR.wheels.forEach((w, i) => {
      const ws = s.wheels[i];
      const contact = new THREE.Vector3(w.x, w.y - (CAR.restLength - ws.comp) - CAR.wheelRadius + 0.02, w.z).applyQuaternion(rot).add(pos);
      const sliding = ws.contact && ws.slip > 3.2 && speed > 4;
      if (!w.front) this.skids.add(i - 2, sliding ? contact : null, left, (ws.slip - 3) / 8);
      if (sliding && emitSmoke) {
        const k = Math.min(1, (ws.slip - 3) / 8);
        this.smoke.emit({
          x: contact.x, y: contact.y + 0.2, z: contact.z,
          vx: (Math.random() - 0.5) * 2 - fwd.x * speed * 0.15, vy: 0.8 + Math.random(), vz: (Math.random() - 0.5) * 2 - fwd.z * speed * 0.15,
          max: 0.9 + Math.random() * 0.6, size: 0.8, grow: 2.6, r: 0.85, g: 0.85, b: 0.9, gravity: -0.4, a0: 0.18 + 0.25 * k,
        });
      }
    });

    if (impact > 2500) {
      const n = Math.min(40, Math.floor(impact / 400));
      for (let i = 0; i < n; i++) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const p = pos.clone().addScaledVector(left, side * 0.9).addScaledVector(fwd, (Math.random() - 0.3) * 3).addScaledVector(up, -0.2);
        this.sparks.emit({
          x: p.x, y: p.y, z: p.z,
          vx: s.vel.x * 0.6 + (Math.random() - 0.5) * 8, vy: Math.random() * 5, vz: s.vel.z * 0.6 + (Math.random() - 0.5) * 8,
          max: 0.35 + Math.random() * 0.35, size: 0.18, grow: -0.2, r: 1, g: 0.75, b: 0.3, gravity: 18, a0: 1,
        });
      }
    }

    // Exhaust glow: brighter under throttle, big flare on boost pads.
    const target = boosting ? 1.6 : throttle ? 0.55 : 0.2;
    const cur = this.exhaust.scale.x;
    const next = cur + (target - cur) * (1 - Math.exp(-dt * 12));
    const flicker = 1 + (Math.random() - 0.5) * 0.15;
    this.exhaust.scale.set(next * flicker, next * 0.7 * flicker, 1);

    this.smoke.update(dt);
    this.sparks.update(dt);
    void this.carRoot;
  }

  dispose() {
    this.smoke.dispose();
    this.sparks.dispose();
    this.skids.dispose();
    this.exhaustTex.dispose();
    this.exhaust.material.dispose();
    this.headlight?.dispose();
  }
}

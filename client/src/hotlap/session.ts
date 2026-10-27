/**
 * One Hotlap driving session on a track: owns the three.js renderer, the
 * deterministic Run, the ghost, input, audio and the camera.
 *
 * Loop: physics runs at a FIXED 120 Hz from an accumulator; every rendered
 * frame interpolates between the last two physics states, so motion is
 * perfectly smooth at any refresh rate (60/120/144 Hz) and the simulation
 * — and therefore the time — never depends on frame rate.
 *
 * The clock starts on the first tick a driving input is held (no countdown
 * to sit through), so restarts are instant.
 */
import * as THREE from "three";
import { IN_DOWN, IN_LEFT, IN_RIGHT, IN_UP, TICK_HZ, type CarState } from "@shared/hotlap/car";
import { Bot } from "@shared/hotlap/bot";
import { qrot } from "@shared/hotlap/dmath";
import { InputPlayer, InputRecorder, encodeInputs, type InputSpan } from "@shared/hotlap/replay";
import { Run, type RunEvent } from "@shared/hotlap/run";
import type { BuiltTrack } from "@shared/hotlap/track";
import { HotlapAudio } from "./audio";
import { InputController, type Action } from "./input";
import { buildCar, type CarVisual } from "./render/carMesh";
import { Effects } from "./render/effects";
import { buildEnvironment, type Environment } from "./render/environment";
import { buildTrackVisuals, type TrackVisuals } from "./render/trackMesh";
import type { CameraMode, HotlapSettings } from "./storage";
import { themeOf } from "./themes";

const DRIVE_MASK = IN_UP | IN_DOWN | IN_LEFT | IN_RIGHT;
const TICK = 1 / TICK_HZ;

export type Phase = "ready" | "running" | "finished";

export interface FinishInfo {
  ms: number;
  splits: number[];
  replay: string;
  respawns: number;
  /** Driven by the QA autopilot — never posted to the leaderboard. */
  autopilot: boolean;
}

export interface SessionCallbacks {
  onPhase(phase: Phase): void;
  onCheckpoint(index: number, ms: number): void;
  onFinish(info: FinishInfo): void;
  onRespawn(fell: boolean): void;
  onAction(a: Action): void;
}

export interface HudFrame {
  ms: number;
  speedKmh: number;
  nextGate: number;
  gateCount: number;
  /** Ghost's time at the same progress isn't known; we expose its clock. */
  ghostFinished: boolean;
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

function lerpState(a: CarState, b: CarState, t: number, outPos: THREE.Vector3, outRot: THREE.Quaternion) {
  outPos.set(a.pos.x + (b.pos.x - a.pos.x) * t, a.pos.y + (b.pos.y - a.pos.y) * t, a.pos.z + (b.pos.z - a.pos.z) * t);
  outRot.set(a.rot.x, a.rot.y, a.rot.z, a.rot.w);
  _q.set(b.rot.x, b.rot.y, b.rot.z, b.rot.w);
  outRot.slerp(_q, t);
}

export class HotlapSession {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private env: Environment;
  private visuals: TrackVisuals;
  private car: CarVisual;
  private ghostCar: CarVisual;
  private effects: Effects;
  readonly input: InputController;
  readonly audio = new HotlapAudio();

  private run!: Run;
  private recorder!: InputRecorder;
  private prev!: CarState;
  private curr!: CarState;
  private ghostRun: Run | null = null;
  private ghostPlayer: InputPlayer | null = null;
  private ghostPrev: CarState | null = null;
  private ghostCurr: CarState | null = null;
  private ghostSpans: InputSpan[] | null = null;

  phase: Phase = "ready";
  paused = false;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private lastInput = 0;
  private camMode: CameraMode;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private shake = 0;
  private fovKick = 0;
  private gateFlash: number[] = [];
  private disposed = false;
  private resizeObs: ResizeObserver;
  /** QA only (?autopilot=1): the validation bot drives instead of the player. */
  private bot: Bot | null = null;
  private pendingImpact = 0;
  private autopilotUsed = false;

  constructor(
    private host: HTMLElement,
    private track: BuiltTrack,
    settings: HotlapSettings,
    private cb: SessionCallbacks,
  ) {
    const theme = themeOf(track.def.theme);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.1, 5000);
    this.scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
    this.scene.background = new THREE.Color(theme.fog);

    const b = track.bounds;
    const center = new THREE.Vector3((b.minX + b.maxX) / 2, b.minY, (b.minZ + b.maxZ) / 2);
    const radius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    this.env = buildEnvironment(theme, center, radius);
    this.scene.add(this.env.group);
    this.visuals = buildTrackVisuals(track, theme);
    this.scene.add(this.visuals.group);

    this.car = buildCar({ color: "#ff3d7f", accent: "#4de1ff" });
    this.scene.add(this.car.root);
    this.ghostCar = buildCar({ color: "#cfe3ff", accent: "#ffffff", ghost: true });
    this.ghostCar.root.visible = false;
    this.scene.add(this.ghostCar.root);
    this.effects = new Effects(track.def.theme === "night" || track.def.theme === "neon", this.car.root);
    this.scene.add(this.effects.group);

    this.camMode = settings.camera;
    this.audio.setVolume(settings.volume);
    this.audio.setMuted(settings.muted);
    this.input = new InputController(() => this.audio.start());
    this.input.onAction((a) => this.cb.onAction(a));

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.reset();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------------ control

  /** Back to the start line, clock at zero, waiting for the first input. */
  reset() {
    this.run = new Run(this.track);
    this.recorder = new InputRecorder();
    this.prev = this.run.snapshot();
    this.curr = this.run.snapshot();
    this.acc = 0;
    this.camInit = false;
    this.autopilotUsed = false;
    if (this.bot) this.bot = new Bot(this.track);
    this.effects?.reset();
    this.gateFlash = this.track.gates.map(() => 0);
    if (this.ghostSpans) this.armGhost(this.ghostSpans);
    this.setPhase("ready");
  }

  setGhost(spans: InputSpan[] | null) {
    this.ghostSpans = spans;
    this.armGhost(spans);
  }

  private armGhost(spans: InputSpan[] | null) {
    if (!spans) {
      this.ghostRun = null;
      this.ghostPlayer = null;
      this.ghostCar.root.visible = false;
      return;
    }
    this.ghostRun = new Run(this.track);
    this.ghostPlayer = new InputPlayer(spans);
    this.ghostPrev = this.ghostRun.snapshot();
    this.ghostCurr = this.ghostRun.snapshot();
    this.ghostCar.root.visible = true;
  }

  setAutopilot(on: boolean) {
    this.bot = on ? new Bot(this.track) : null;
  }

  setCamera(mode: CameraMode) {
    this.camMode = mode;
    this.camInit = false;
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (p) this.audio.idle();
    this.last = performance.now();
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.cb.onPhase(p);
  }

  private onVisibility = () => {
    // A hidden tab gets no frames; make sure we don't "catch up" a burst of
    // physics on return. (Sim time is in ticks, so the clock is unaffected.)
    this.last = performance.now();
    this.acc = 0;
  };

  // --------------------------------------------------------------------- loop

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25; // never spiral after a stall

    if (!this.paused) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < 12) {
        this.tick();
        this.acc -= TICK;
        steps++;
      }
      if (steps === 12) this.acc = 0;
    }
    this.render(dt);
  };

  private tick() {
    let bits = this.input.sample();
    if (this.bot) {
      bits = this.bot.decide(this.run);
      this.autopilotUsed = true;
    }
    this.lastInput = bits;
    if (this.phase === "ready") {
      if ((bits & DRIVE_MASK) === 0) return; // clock hasn't started
      this.setPhase("running");
      this.audio.go();
    }
    if (this.phase !== "running") return;

    this.prev = this.curr;
    this.recorder.push(bits);
    const events = this.run.step(bits);
    this.curr = this.run.snapshot();
    if (this.ghostRun && this.ghostPlayer && !this.ghostRun.finished) {
      this.ghostPrev = this.ghostCurr;
      this.ghostRun.step(this.ghostPlayer.next());
      this.ghostCurr = this.ghostRun.snapshot();
    }
    if (this.curr.impact > this.pendingImpact) this.pendingImpact = this.curr.impact;
    if (this.curr.impact > 2500) {
      this.shake = Math.min(1, this.shake + this.curr.impact / 12000);
      this.audio.impact(Math.min(1, this.curr.impact / 9000));
    }
    for (const e of events) this.handle(e);
  }

  private handle(e: RunEvent) {
    if (e.type === "checkpoint") {
      this.gateFlash[e.index] = 1;
      this.cb.onCheckpoint(e.index, e.ms);
    } else if (e.type === "respawn") {
      // Teleport: don't interpolate across it, snap the camera.
      this.prev = this.run.snapshot();
      this.curr = this.prev;
      this.camInit = false;
      this.audio.respawn();
      this.cb.onRespawn(e.fell);
    } else if (e.type === "finish") {
      this.gateFlash[this.gateFlash.length - 1] = 1;
      this.audio.idle();
      this.setPhase("finished");
      this.cb.onFinish({
        ms: e.ms,
        splits: [...this.run.splits],
        replay: encodeInputs(this.recorder.spans),
        respawns: this.run.respawns,
        autopilot: this.autopilotUsed,
      });
    }
  }

  /** Live numbers for the HUD (read every animation frame). */
  hud(): HudFrame {
    const ms =
      this.phase === "ready" ? 0 : this.phase === "finished" ? this.run.finishMs : (this.run.tick + this.acc / TICK) * (1000 / TICK_HZ);
    return {
      ms,
      speedKmh: Math.abs(this.curr.speed) * 3.6,
      nextGate: this.run.nextGate,
      gateCount: this.track.gates.length,
      ghostFinished: !!this.ghostRun?.finished,
    };
  }

  // ------------------------------------------------------------------- render

  private resize() {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private render(dt: number) {
    const alpha = this.phase === "running" && !this.paused ? Math.min(1, this.acc / TICK) : 1;
    const pos = new THREE.Vector3();
    const rot = new THREE.Quaternion();
    lerpState(this.prev, this.curr, alpha, pos, rot);
    this.car.root.position.copy(pos);
    this.car.root.quaternion.copy(rot);
    const braking = (this.lastInput & IN_DOWN) !== 0 && this.curr.speed > 0.5;
    const boosting = this.curr.wheels.some((w) => w.onBoost);
    this.car.update(this.curr, braking, boosting);

    if (this.ghostRun && this.ghostPrev && this.ghostCurr) {
      const gp = new THREE.Vector3();
      const gr = new THREE.Quaternion();
      lerpState(this.ghostPrev, this.ghostCurr, this.ghostRun.finished ? 1 : alpha, gp, gr);
      this.ghostCar.root.position.copy(gp);
      this.ghostCar.root.quaternion.copy(gr);
      this.ghostCar.update(this.ghostCurr, false, false);
      // Fade the ghost when it's right on top of you so it never hides the road.
      const d = gp.distanceTo(pos);
      this.ghostCar.root.visible = d > 2.5 || this.phase === "ready";
    }

    // Gate pulse when crossed.
    this.gateFlash.forEach((f, i) => {
      if (f <= 0) return;
      const g = this.visuals.gateMeshes[i];
      const s = 1 + f * 0.25;
      g?.scale.set(s, s, s);
      this.gateFlash[i] = Math.max(0, f - dt * 2.5);
    });
    if (this.visuals.boostTex) this.visuals.boostTex.offset.y -= dt * 1.6;

    this.effects.update(
      this.paused ? 0 : dt,
      this.curr,
      rot,
      pos,
      (this.lastInput & IN_UP) !== 0 && this.phase === "running",
      boosting,
      this.pendingImpact,
    );
    this.pendingImpact = 0;
    this.updateCamera(pos, rot, dt);
    this.env.follow(pos);

    const slip = Math.max(...this.curr.wheels.map((w) => (w.contact ? w.slip : 0)));
    if (!this.paused && this.phase !== "finished")
      this.audio.update(this.curr.speed, (this.lastInput & IN_UP) !== 0, slip, this.curr.grounded > 0, boosting, this.phase === "running");

    this.renderer.render(this.scene, this.camera);
  }

  private updateCamera(pos: THREE.Vector3, rot: THREE.Quaternion, dt: number) {
    const fwd = _v.set(0, 0, 1).applyQuaternion(rot).clone();
    const upCar = new THREE.Vector3(0, 1, 0).applyQuaternion(rot);
    const speed = Math.abs(this.curr.speed);
    // Follow the direction of travel (blended with heading) so slides and
    // spins don't whip the camera around.
    const vel = new THREE.Vector3(this.curr.vel.x, this.curr.vel.y, this.curr.vel.z);
    const flat = fwd.clone();
    if (speed > 6 && this.curr.speed > 0) flat.lerp(vel.clone().normalize(), 0.45);
    flat.y *= 0.35;
    flat.normalize();

    let dist = 7.2, height = 2.5, lookAhead = 6, lookUp = 1.0;
    if (this.camMode === "far") {
      dist = 11;
      height = 4.2;
      lookAhead = 8;
    }
    if (this.camMode === "hood") {
      const eye = pos.clone().addScaledVector(upCar, 0.75).addScaledVector(fwd, 0.4);
      this.camera.position.copy(eye);
      this.camera.up.copy(upCar);
      this.camera.lookAt(eye.clone().addScaledVector(fwd, 20).addScaledVector(upCar, 0.3));
      this.applyFov(speed, dt);
      return;
    }
    dist += Math.min(2.2, speed * 0.018);
    const desired = pos.clone().addScaledVector(flat, -dist).add(new THREE.Vector3(0, height, 0));
    // Keep the camera above the car's own up direction on banks/loops.
    desired.addScaledVector(upCar, 0.4);
    const look = pos.clone().addScaledVector(flat, lookAhead).add(new THREE.Vector3(0, lookUp, 0));
    if (!this.camInit) {
      this.camPos.copy(desired);
      this.camLook.copy(look);
      this.camInit = true;
    }
    const kPos = 1 - Math.exp(-dt * 9);
    const kLook = 1 - Math.exp(-dt * 14);
    this.camPos.lerp(desired, kPos);
    this.camLook.lerp(look, kLook);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      const s = this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);
    this.applyFov(speed, dt);
  }

  private applyFov(speed: number, dt: number) {
    const boosting = this.curr.wheels.some((w) => w.onBoost);
    this.fovKick += ((boosting ? 1 : 0) - this.fovKick) * (1 - Math.exp(-dt * 4));
    const fov = 70 + Math.min(14, speed * 0.17) + this.fovKick * 6;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.resizeObs.disconnect();
    this.input.dispose();
    this.audio.dispose();
    this.visuals.dispose();
    this.env.dispose();
    this.car.dispose();
    this.ghostCar.dispose();
    this.effects.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Forward vector helper for UI code that needs it. */
export function forwardOf(c: CarState) {
  return qrot(c.rot, { x: 0, y: 0, z: 1 });
}

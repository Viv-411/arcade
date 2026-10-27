/**
 * The Hotlap car: an original, low-detail open-wheel racer built in code (no
 * model files). Four exposed wheels sit exactly where the physics puts them,
 * so you can always see each tyre touching the road. Local frame matches the
 * physics body: +Z forward, +Y up, +X = LEFT. The road is ~0.9 m below the
 * body origin at rest.
 */
import * as THREE from "three";
import { CAR, type CarState } from "@shared/hotlap/car";

export interface CarVisual {
  root: THREE.Group;
  update(state: CarState, braking: boolean, boosting: boolean): void;
  dispose(): void;
}

/**
 * A box whose cross-section changes along Z: rectangle (w0 × h0) centred at
 * height y0 at z0, morphing to (w1 × h1) centred at y1 at z1. Flat-shaded.
 */
function taper(z0: number, z1: number, w0: number, w1: number, h0: number, h1: number, y0: number, y1: number) {
  const a = [
    [-w0 / 2, y0 - h0 / 2, z0], [w0 / 2, y0 - h0 / 2, z0], [w0 / 2, y0 + h0 / 2, z0], [-w0 / 2, y0 + h0 / 2, z0],
    [-w1 / 2, y1 - h1 / 2, z1], [w1 / 2, y1 - h1 / 2, z1], [w1 / 2, y1 + h1 / 2, z1], [-w1 / 2, y1 + h1 / 2, z1],
  ];
  const quads = [
    [0, 3, 2, 1], // back (z0)
    [4, 5, 6, 7], // front (z1)
    [3, 7, 6, 2], // top
    [0, 1, 5, 4], // bottom
    [1, 2, 6, 5], // +x side
    [0, 4, 7, 3], // -x side
  ];
  const pos: number[] = [];
  for (const [p, q, r, s] of quads) {
    for (const i of [p, q, r, p, r, s]) pos.push(...a[i]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildCar(opts: { color: string; accent: string; ghost?: boolean }): CarVisual {
  const root = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const ghost = !!opts.ghost;
  const ghostProps = ghost ? { transparent: true, opacity: 0.35, depthWrite: false } : {};
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
    keep(new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide, ...ghostProps, ...extra }));

  const paint = std(opts.color, { metalness: 0.3, roughness: 0.38, emissive: new THREE.Color(opts.color), emissiveIntensity: ghost ? 0.5 : 0.06 });
  const carbon = std("#1a1b22", { roughness: 0.7 });
  const accent = std(opts.accent, { roughness: 0.4 });
  const white = std("#f4f5f8", { roughness: 0.5 });
  const brakeOff = new THREE.Color("#5a0d16");
  const brakeOn = new THREE.Color("#ff2338");
  const brakeMat = keep(new THREE.MeshBasicMaterial({ color: brakeOff, ...ghostProps }));

  const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(keep(g), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = !ghost;
    root.add(mesh);
    return mesh;
  };

  // Floor / plank — low and wide between the wheels.
  add(taper(-1.55, 0.95, 1.2, 1.0, 0.05, 0.05, -0.77, -0.77), carbon);
  // Monocoque: from behind the cockpit to the nose root.
  add(taper(-0.55, 0.85, 0.78, 0.6, 0.38, 0.3, -0.53, -0.56), paint);
  // Nose cone, tapering down toward the front wing.
  add(taper(0.85, 2.05, 0.56, 0.22, 0.28, 0.13, -0.56, -0.66), paint);
  // Sidepods with an undercut at the back.
  for (const side of [1, -1]) {
    add(taper(-1.0, 0.45, 0.32, 0.42, 0.22, 0.32, -0.6, -0.55), paint, side * 0.55, 0, 0);
    // Coloured inlet stripe on the pod front.
    add(taper(0.44, 0.47, 0.42, 0.42, 0.3, 0.3, -0.55, -0.55), accent, side * 0.55, 0, 0);
  }
  // Engine cover / airbox sweeping down to the rear.
  add(taper(-1.7, -0.25, 0.26, 0.46, 0.14, 0.42, -0.5, -0.24), paint);
  // Cockpit opening + helmet.
  add(taper(-0.2, 0.55, 0.46, 0.4, 0.05, 0.05, -0.36, -0.37), carbon);
  const helmet = new THREE.Mesh(keep(new THREE.SphereGeometry(0.17, 10, 8)), white);
  helmet.position.set(0, -0.2, 0.1);
  helmet.castShadow = !ghost;
  root.add(helmet);
  const visor = new THREE.Mesh(keep(new THREE.BoxGeometry(0.24, 0.06, 0.05)), carbon);
  visor.position.set(0, -0.19, 0.25);
  root.add(visor);
  // Roll hoop / intake above the helmet.
  add(taper(-0.18, -0.02, 0.12, 0.16, 0.16, 0.18, -0.06, -0.08), carbon);

  // Front wing: main plane + endplates + accent flap.
  add(new THREE.BoxGeometry(1.86, 0.04, 0.42), carbon, 0, -0.73, 2.02);
  add(new THREE.BoxGeometry(1.7, 0.035, 0.16), accent, 0, -0.68, 1.95);
  for (const side of [1, -1]) add(new THREE.BoxGeometry(0.03, 0.17, 0.48), carbon, side * 0.93, -0.68, 2.02);

  // Rear wing: two elements on endplates, plus a centre pillar.
  add(new THREE.BoxGeometry(1.08, 0.05, 0.34), paint, 0, 0.0, -1.98);
  add(new THREE.BoxGeometry(1.08, 0.04, 0.2), carbon, 0, 0.1, -2.08);
  for (const side of [1, -1]) add(new THREE.BoxGeometry(0.03, 0.5, 0.5), carbon, side * 0.55, -0.12, -2.0);
  add(new THREE.BoxGeometry(0.05, 0.42, 0.06), carbon, 0, -0.24, -1.92);
  // Diffuser.
  add(taper(-1.95, -1.55, 0.9, 1.1, 0.16, 0.05, -0.71, -0.76), carbon);

  // Brake lights: a centre light under the rear wing + one on each endplate.
  const lamp = (w: number, h: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, 0.03)), brakeMat);
    m.position.set(x, y, z);
    root.add(m);
  };
  lamp(0.16, 0.1, 0, -0.42, -1.99);
  lamp(0.03, 0.18, 0.565, -0.12, -2.26);
  lamp(0.03, 0.18, -0.565, -0.12, -2.26);

  // Wheels: exposed, on a steer pivot that rides the suspension.
  const tyreMat = std("#16161a", { roughness: 0.9, metalness: 0 });
  const rimMat = std("#c8ccd6", { metalness: 0.7, roughness: 0.3 });
  const wheels = CAR.wheels.map((w) => {
    const width = w.front ? 0.34 : 0.44;
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const spin = new THREE.Group();
    const tyreGeo = keep(new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, width, 18));
    tyreGeo.rotateZ(Math.PI / 2);
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    tyre.castShadow = !ghost;
    const rimGeo = keep(new THREE.CylinderGeometry(CAR.wheelRadius * 0.62, CAR.wheelRadius * 0.62, width + 0.02, 8));
    rimGeo.rotateZ(Math.PI / 2);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    // A coloured sidewall stripe so wheel rotation is readable.
    const ringGeo = keep(new THREE.TorusGeometry(CAR.wheelRadius * 0.8, 0.018, 4, 18));
    ringGeo.rotateY(Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, accent);
    ring.position.x = (w.x > 0 ? 1 : -1) * (width / 2 + 0.005);
    spin.add(tyre, rim, ring);
    pivot.add(spin);
    // Suspension arms from the body to the hub (ride with the wheel).
    const armLen = Math.abs(w.x) - 0.38;
    const armGeo = keep(new THREE.BoxGeometry(armLen, 0.03, 0.05));
    for (const dz of [-0.12, 0.12]) {
      const arm = new THREE.Mesh(armGeo, carbon);
      arm.position.set((w.x > 0 ? -1 : 1) * (armLen / 2 + width / 2 - 0.05), 0.05, dz);
      pivot.add(arm);
    }
    root.add(pivot);
    return { pivot, spin, front: w.front, mount: w };
  });

  return {
    root,
    update(state, braking) {
      wheels.forEach((w, i) => {
        const ws = state.wheels[i];
        // Wheel centre sits (restLength - compression) below its mount: when
        // the wheel has contact, the tyre's bottom is exactly on the road.
        w.pivot.position.y = w.mount.y - (CAR.restLength - ws.comp);
        w.pivot.rotation.y = w.front ? state.steer : 0;
        w.spin.rotation.x = ws.spin;
      });
      brakeMat.color.copy(braking ? brakeOn : brakeOff);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

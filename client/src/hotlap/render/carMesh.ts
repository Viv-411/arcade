/**
 * The Hotlap car: an original low-poly wedge built in code (no model files).
 * Local frame matches the physics body: +Z forward, +Y up, +X = LEFT.
 */
import * as THREE from "three";
import { CAR, type CarState } from "@shared/hotlap/car";

export interface CarVisual {
  root: THREE.Group;
  update(state: CarState, braking: boolean, boosting: boolean): void;
  dispose(): void;
}

/** Side profile (z, y) of the lower body, nose to tail. */
const BODY_PROFILE: [number, number][] = [
  [2.18, -0.38], [2.22, -0.18], [2.0, -0.02], [1.1, 0.1], [0.55, 0.16],
  [-1.2, 0.2], [-1.85, 0.24], [-2.12, 0.16], [-2.16, -0.38],
];
const CABIN_PROFILE: [number, number][] = [
  [0.75, 0.14], [0.05, 0.55], [-0.85, 0.57], [-1.45, 0.24],
];

function extrudeProfile(profile: [number, number][], width: number, bevel: number) {
  const shape = new THREE.Shape();
  profile.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  });
  // Shape is in (x=z, y=y); extrusion runs along +Z. Rotate so the profile's
  // x becomes our forward Z and the extrusion becomes our lateral X.
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

export function buildCar(opts: { color: string; accent: string; ghost?: boolean }): CarVisual {
  const root = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const ghost = !!opts.ghost;

  const ghostProps = ghost ? { transparent: true, opacity: 0.32, depthWrite: false } : {};
  const paint = keep(new THREE.MeshStandardMaterial({
    color: opts.color, metalness: 0.35, roughness: 0.35, flatShading: true,
    // A little self-light so the car never goes muddy when driving into the sun.
    emissive: new THREE.Color(opts.color), emissiveIntensity: ghost ? 0.5 : 0.14, ...ghostProps,
  }));
  const dark = keep(new THREE.MeshStandardMaterial({ color: "#14151c", roughness: 0.7, flatShading: true, ...ghostProps }));
  const glass = keep(new THREE.MeshStandardMaterial({
    color: "#0d1830", metalness: 0.6, roughness: 0.15, emissive: new THREE.Color(opts.accent), emissiveIntensity: 0.12, flatShading: true, ...ghostProps,
  }));
  const accentMat = keep(new THREE.MeshBasicMaterial({ color: opts.accent, ...ghostProps }));
  const head = keep(new THREE.MeshBasicMaterial({ color: "#fff6e0", ...ghostProps }));
  const tail = keep(new THREE.MeshBasicMaterial({ color: "#ff1744", ...ghostProps }));

  const body = new THREE.Mesh(keep(extrudeProfile(BODY_PROFILE, 1.86, 0.08)), paint);
  const cabin = new THREE.Mesh(keep(extrudeProfile(CABIN_PROFILE, 1.32, 0.06)), glass);
  body.castShadow = !ghost;
  cabin.castShadow = !ghost;
  root.add(body, cabin);

  // Side skirts / stripe.
  const stripeGeo = keep(new THREE.BoxGeometry(0.04, 0.07, 3.3));
  for (const side of [1, -1]) {
    const s = new THREE.Mesh(stripeGeo, accentMat);
    s.position.set(side * 0.94, -0.06, 0.05);
    root.add(s);
  }
  // Rear wing.
  const wing = new THREE.Mesh(keep(new THREE.BoxGeometry(1.9, 0.06, 0.42)), dark);
  wing.position.set(0, 0.62, -1.92);
  wing.rotation.x = -0.12;
  const wingEdge = new THREE.Mesh(keep(new THREE.BoxGeometry(1.92, 0.035, 0.06)), accentMat);
  wingEdge.position.set(0, 0.66, -2.12);
  const postGeo = keep(new THREE.BoxGeometry(0.07, 0.4, 0.14));
  for (const side of [1, -1]) {
    const p = new THREE.Mesh(postGeo, dark);
    p.position.set(side * 0.55, 0.42, -1.9);
    root.add(p);
  }
  root.add(wing, wingEdge);
  // Lights.
  const lampGeo = keep(new THREE.BoxGeometry(0.42, 0.07, 0.05));
  for (const side of [1, -1]) {
    const h = new THREE.Mesh(lampGeo, head);
    h.position.set(side * 0.6, -0.08, 2.18);
    h.rotation.x = 0.35;
    const t = new THREE.Mesh(lampGeo, tail);
    t.position.set(side * 0.58, 0.08, -2.16);
    root.add(h, t);
  }
  // Underglow strip (not on the ghost).
  if (!ghost) {
    const glow = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.5, 3.6)), keep(new THREE.MeshBasicMaterial({
      color: opts.accent, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.62;
    root.add(glow);
  }

  // Wheels: a steer pivot holding a spinning wheel.
  const tyreGeo = keep(new THREE.CylinderGeometry(CAR.wheelRadius, CAR.wheelRadius, 0.32, 16));
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = keep(new THREE.CylinderGeometry(CAR.wheelRadius * 0.6, CAR.wheelRadius * 0.6, 0.34, 6));
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = keep(new THREE.MeshStandardMaterial({ color: "#b8bcc8", metalness: 0.8, roughness: 0.3, flatShading: true, ...ghostProps }));
  const wheels = CAR.wheels.map((w) => {
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, dark);
    tyre.castShadow = !ghost;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    spin.add(tyre, rim);
    pivot.add(spin);
    root.add(pivot);
    return { pivot, spin, front: w.front, mount: w };
  });

  return {
    root,
    update(state, braking) {
      wheels.forEach((w, i) => {
        const ws = state.wheels[i];
        // Wheel centre sits (restLength - compression) below its mount.
        w.pivot.position.y = w.mount.y - (CAR.restLength - ws.comp);
        w.pivot.rotation.y = w.front ? state.steer : 0;
        w.spin.rotation.x = ws.spin;
      });
      tail.color.set(braking ? "#ff4060" : "#b0102a");
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

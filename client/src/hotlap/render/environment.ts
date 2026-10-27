/** Sky dome, sun, stars, distant mountains and lighting for a theme. */
import * as THREE from "three";
import type { Theme } from "../themes";

export interface Environment {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  /** Keep the sky and the shadow camera centred on the player. */
  follow(target: THREE.Vector3): void;
  dispose(): void;
}

export function buildEnvironment(theme: Theme, center: THREE.Vector3, radius: number): Environment {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  // Gradient sky dome (follows the camera so it never clips).
  const skyGeo = keep(new THREE.SphereGeometry(4000, 32, 16));
  const skyMat = keep(new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      horizon: { value: new THREE.Color(theme.skyHorizon) },
      bottom: { value: new THREE.Color(theme.skyBottom) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main(){ float h = vDir.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, bottom, pow(clamp(-h*3.0,0.0,1.0), 0.7));
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -10;
  group.add(sky);

  const sunDir = new THREE.Vector3(...theme.sunDir).normalize();
  if (theme.disc) {
    const disc = new THREE.Mesh(
      keep(new THREE.CircleGeometry(80, 48)),
      keep(new THREE.MeshBasicMaterial({ color: theme.disc, fog: false, transparent: true, opacity: 0.95, depthWrite: false })),
    );
    disc.position.copy(sunDir.clone().multiplyScalar(3600));
    disc.lookAt(0, 0, 0);
    disc.renderOrder = -9;
    sky.add(disc);
    // Soft halo: a radial-gradient sprite behind the disc.
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const c2 = cv.getContext("2d")!;
    const grad = c2.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.18)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    c2.fillStyle = grad;
    c2.fillRect(0, 0, 128, 128);
    const haloTex = keep(new THREE.CanvasTexture(cv));
    const halo = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: haloTex, color: theme.disc, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    halo.scale.set(900, 900, 1);
    halo.position.copy(sunDir.clone().multiplyScalar(3580));
    halo.renderOrder = -9;
    sky.add(halo);
  }

  if (theme.stars) {
    const pts: number[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i++) {
      const u = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const y = Math.abs(u) * 0.9 + 0.05;
      const r = Math.sqrt(1 - y * y);
      pts.push(Math.cos(a) * r * 3800, y * 3800, Math.sin(a) * r * 3800);
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const stars = new THREE.Points(g, keep(new THREE.PointsMaterial({ color: "#ffffff", size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false })));
    stars.renderOrder = -9;
    sky.add(stars);
  }

  // Two layered rings of low-poly ridges around the track. The far ring is
  // blended toward the fog colour (atmospheric perspective); both are drawn
  // without fog so they always read as a silhouette.
  const ringR = Math.max(1300, radius + 650);
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const fogC = new THREE.Color(theme.fog);
  const ridge = (r: number, count: number, hMin: number, hVar: number, tint: number) => {
    const color = new THREE.Color(theme.mountains).lerp(fogC, tint);
    const pos: number[] = [];
    const heights: number[] = [];
    for (let i = 0; i < count; i++) {
      // Smooth-ish noise: a few sine octaves plus jitter, never needle-thin.
      const a = (i / count) * Math.PI * 2;
      const h = hMin + hVar * (0.5 + 0.3 * Math.sin(a * 3 + r) + 0.2 * Math.sin(a * 7.3 + r * 0.7)) + rnd() * hVar * 0.35;
      heights.push(h);
    }
    const base = center.y - 80;
    for (let i = 0; i < count; i++) {
      const a0 = (i / count) * Math.PI * 2;
      const a1 = ((i + 1) / count) * Math.PI * 2;
      const h0 = heights[i];
      const h1 = heights[(i + 1) % count];
      const rr0 = r + (rnd() - 0.5) * 80;
      const p0 = [center.x + Math.cos(a0) * r, base, center.z + Math.sin(a0) * r];
      const p1 = [center.x + Math.cos(a1) * r, base, center.z + Math.sin(a1) * r];
      const t0 = [center.x + Math.cos(a0) * rr0, base + h0, center.z + Math.sin(a0) * rr0];
      const am = (a0 + a1) / 2;
      const t1 = [center.x + Math.cos(am) * (r + 40), base + (h0 + h1) / 2 + rnd() * 25, center.z + Math.sin(am) * (r + 40)];
      const t2 = [center.x + Math.cos(a1) * r, base + h1, center.z + Math.sin(a1) * r];
      pos.push(...p0, ...t0, ...t1, ...p0, ...t1, ...p1, ...p1, ...t1, ...t2);
    }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mat = keep(new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1, fog: false, side: THREE.DoubleSide }));
    group.add(new THREE.Mesh(g, mat));
  };
  ridge(ringR + 500, 90, 140, 260, 0.55);
  ridge(ringR, 120, 50, 150, 0.15);

  // Lighting.
  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun, theme.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  group.add(sun);
  group.add(sun.target);

  return {
    group,
    sun,
    follow(target) {
      sky.position.copy(target);
      sun.position.copy(target).addScaledVector(sunDir, 180);
      sun.target.position.copy(target);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      sun.shadow.map?.dispose();
    },
  };
}

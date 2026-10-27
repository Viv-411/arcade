/**
 * Visual themes for Hotlap tracks (renderer only — never affects physics).
 * Every track's `theme` must be one of these keys. All themes are DAYTIME
 * (owner request, 2026-10-26: the night/neon look was too distracting); the
 * keys are kept so track definitions don't change.
 */
export interface Theme {
  label: string;
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  sunIntensity: number;
  /** Direction the sunlight comes FROM (normalised in the renderer). */
  sunDir: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  road: string;
  roadLine: string;
  /** Rail/gate colour. */
  accent: string;
  accent2: string;
  wall: string;
  wallOpacity: number;
  /** Ground base colour and the darker stripe mown into it. */
  ground: string;
  groundStripe: string;
  mountains: string;
  /** Snow caps / highlight colour on the far ridges. */
  peaks: string;
  clouds: number;
  disc: string | null;
}

export const THEMES: Record<string, Theme> = {
  dawn: {
    label: "Morning",
    skyTop: "#4a8fe0",
    skyHorizon: "#cfe6ff",
    skyBottom: "#e9f4ff",
    fog: "#d6e8fb",
    fogNear: 300,
    fogFar: 1700,
    sun: "#fff1dc",
    sunIntensity: 2.6,
    sunDir: [-0.55, 0.45, 0.7],
    hemiSky: "#d9ecff",
    hemiGround: "#6f8f5a",
    hemiIntensity: 1.35,
    road: "#5b5f68",
    roadLine: "#ffffff",
    accent: "#ff4f6e",
    accent2: "#2f80ed",
    wall: "#f4f7fb",
    wallOpacity: 0.9,
    ground: "#7fbf5a",
    groundStripe: "#74b24f",
    mountains: "#7f9cad",
    peaks: "#eef4f8",
    clouds: 26,
    disc: "#fffaf0",
  },
  noon: {
    label: "Noon",
    skyTop: "#2c79e6",
    skyHorizon: "#a9d6ff",
    skyBottom: "#e3f3ff",
    fog: "#c4e2ff",
    fogNear: 350,
    fogFar: 1800,
    sun: "#ffffff",
    sunIntensity: 3.0,
    sunDir: [0.3, 0.9, 0.25],
    hemiSky: "#e1f0ff",
    hemiGround: "#5e8a4e",
    hemiIntensity: 1.3,
    road: "#585c64",
    roadLine: "#ffffff",
    accent: "#ff7a1a",
    accent2: "#1fb4ff",
    wall: "#ffffff",
    wallOpacity: 0.9,
    ground: "#6db34c",
    groundStripe: "#63a745",
    mountains: "#6e9a8a",
    peaks: "#f2f6f2",
    clouds: 22,
    disc: "#ffffff",
  },
  dusk: {
    label: "Golden afternoon",
    skyTop: "#3b7fd6",
    skyHorizon: "#ffe2b5",
    skyBottom: "#fff1da",
    fog: "#f2dcc0",
    fogNear: 280,
    fogFar: 1600,
    sun: "#ffe3b3",
    sunIntensity: 2.7,
    sunDir: [0.7, 0.3, -0.6],
    hemiSky: "#ffe9c9",
    hemiGround: "#8a7a4e",
    hemiIntensity: 1.25,
    road: "#5e5b5a",
    roadLine: "#fff6e6",
    accent: "#e8513a",
    accent2: "#1aa37a",
    wall: "#fff8ee",
    wallOpacity: 0.9,
    ground: "#c9b46a",
    groundStripe: "#bfa95f",
    mountains: "#a88d6e",
    peaks: "#f4e6d2",
    clouds: 18,
    disc: "#fff2d6",
  },
  night: {
    label: "Alpine",
    skyTop: "#1f6fd1",
    skyHorizon: "#bfe0ff",
    skyBottom: "#eef7ff",
    fog: "#dcebf8",
    fogNear: 300,
    fogFar: 1700,
    sun: "#ffffff",
    sunIntensity: 2.8,
    sunDir: [-0.4, 0.75, -0.35],
    hemiSky: "#e6f2ff",
    hemiGround: "#9fb4c4",
    hemiIntensity: 1.35,
    road: "#545a63",
    roadLine: "#ffffff",
    accent: "#2f6fed",
    accent2: "#ff4f6e",
    wall: "#ffffff",
    wallOpacity: 0.9,
    ground: "#e9f0f5",
    groundStripe: "#dde7ee",
    mountains: "#8aa1b4",
    peaks: "#ffffff",
    clouds: 14,
    disc: "#ffffff",
  },
  neon: {
    label: "Coast",
    skyTop: "#1c8fd8",
    skyHorizon: "#b8f0f4",
    skyBottom: "#e6fbfb",
    fog: "#cdeff2",
    fogNear: 320,
    fogFar: 1800,
    sun: "#fffbea",
    sunIntensity: 2.9,
    sunDir: [0, 0.6, -0.8],
    hemiSky: "#dff6ff",
    hemiGround: "#b8a77a",
    hemiIntensity: 1.3,
    road: "#5a5f66",
    roadLine: "#ffffff",
    accent: "#ff5c8a",
    accent2: "#00a8b5",
    wall: "#ffffff",
    wallOpacity: 0.9,
    ground: "#e6d39c",
    groundStripe: "#dcc78f",
    mountains: "#5fa39a",
    peaks: "#e8f6f1",
    clouds: 20,
    disc: "#fffdf2",
  },
  storm: {
    label: "Bright overcast",
    skyTop: "#7f9ab8",
    skyHorizon: "#d9e3ee",
    skyBottom: "#eef3f8",
    fog: "#dbe3ec",
    fogNear: 260,
    fogFar: 1500,
    sun: "#f2f6fb",
    sunIntensity: 2.0,
    sunDir: [-0.3, 0.85, 0.4],
    hemiSky: "#eef3f9",
    hemiGround: "#748a6a",
    hemiIntensity: 1.6,
    road: "#5a5e65",
    roadLine: "#ffffff",
    accent: "#2bb24c",
    accent2: "#f2a20c",
    wall: "#ffffff",
    wallOpacity: 0.9,
    ground: "#86b46c",
    groundStripe: "#7caa62",
    mountains: "#8a9aa6",
    peaks: "#f1f4f7",
    clouds: 40,
    disc: null,
  },
};

export function themeOf(key: string): Theme {
  return THEMES[key] ?? THEMES.noon;
}

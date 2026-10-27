/**
 * Visual themes for Hotlap tracks (renderer only — never affects physics).
 * Every track's `theme` must be one of these keys.
 */
export interface Theme {
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
  /** Neon trim along road edges, gates and walls. */
  accent: string;
  accent2: string;
  wall: string;
  wallOpacity: number;
  ground: string;
  grid: string;
  mountains: string;
  stars: boolean;
  /** Show the sun/moon disc. */
  disc: string | null;
}

export const THEMES: Record<string, Theme> = {
  dawn: {
    skyTop: "#2a3a78",
    skyHorizon: "#ff9e7a",
    skyBottom: "#ffd3a8",
    fog: "#e8a58f",
    fogNear: 220,
    fogFar: 1300,
    sun: "#ffd6b0",
    sunIntensity: 2.2,
    sunDir: [-0.6, 0.35, 0.7],
    hemiSky: "#9fb6ff",
    hemiGround: "#5a3a4a",
    hemiIntensity: 1.1,
    road: "#3a3a48",
    roadLine: "#f2e7da",
    accent: "#ff5fa2",
    accent2: "#ffd166",
    wall: "#ff8fbf",
    wallOpacity: 0.32,
    ground: "#4a3050",
    grid: "#ff7ab8",
    mountains: "#5b3d6b",
    stars: false,
    disc: "#ffe3c2",
  },
  noon: {
    skyTop: "#2f7fe0",
    skyHorizon: "#a9dcff",
    skyBottom: "#dff3ff",
    fog: "#bfe3ff",
    fogNear: 300,
    fogFar: 1600,
    sun: "#fffaf0",
    sunIntensity: 2.8,
    sunDir: [0.35, 0.9, 0.25],
    hemiSky: "#cfe8ff",
    hemiGround: "#4b6b4a",
    hemiIntensity: 1.25,
    road: "#4a4f5a",
    roadLine: "#ffffff",
    accent: "#00c2ff",
    accent2: "#ffcf3a",
    wall: "#7fd8ff",
    wallOpacity: 0.28,
    ground: "#3f7a52",
    grid: "#9be8c0",
    mountains: "#5f8f8a",
    stars: false,
    disc: "#fffbe8",
  },
  dusk: {
    skyTop: "#1b1645",
    skyHorizon: "#d8486b",
    skyBottom: "#ff8a4c",
    fog: "#a63f62",
    fogNear: 200,
    fogFar: 1200,
    sun: "#ff9a6b",
    sunIntensity: 2.0,
    sunDir: [0.7, 0.18, -0.6],
    hemiSky: "#8f6bd8",
    hemiGround: "#3a1e3c",
    hemiIntensity: 1.05,
    road: "#302a40",
    roadLine: "#ffd9c7",
    accent: "#ffb000",
    accent2: "#ff3d7f",
    wall: "#ffb36b",
    wallOpacity: 0.3,
    ground: "#2c1838",
    grid: "#ff5f8f",
    mountains: "#3d2152",
    stars: false,
    disc: "#ffb48a",
  },
  night: {
    skyTop: "#03040c",
    skyHorizon: "#16204a",
    skyBottom: "#1e2b5c",
    fog: "#0d1430",
    fogNear: 150,
    fogFar: 1000,
    sun: "#9fb8ff",
    sunIntensity: 0.9,
    sunDir: [-0.4, 0.8, -0.3],
    hemiSky: "#3a4c8c",
    hemiGround: "#0a0c18",
    hemiIntensity: 1.0,
    road: "#272b40",
    roadLine: "#9fb8ff",
    accent: "#4de1ff",
    accent2: "#b46bff",
    wall: "#4de1ff",
    wallOpacity: 0.22,
    ground: "#070a18",
    grid: "#2a5cff",
    mountains: "#111735",
    stars: true,
    disc: "#dfe6ff",
  },
  neon: {
    skyTop: "#070012",
    skyHorizon: "#3b0a5e",
    skyBottom: "#ff2fd6",
    fog: "#24073a",
    fogNear: 160,
    fogFar: 1100,
    sun: "#ff8af0",
    sunIntensity: 1.2,
    sunDir: [0, 0.3, -1],
    hemiSky: "#7a3dff",
    hemiGround: "#12001f",
    hemiIntensity: 0.95,
    road: "#18102a",
    roadLine: "#ff4fd8",
    accent: "#ff2fd6",
    accent2: "#2ff3ff",
    wall: "#2ff3ff",
    wallOpacity: 0.24,
    ground: "#0b0016",
    grid: "#ff2fd6",
    mountains: "#1c0636",
    stars: true,
    disc: "#ff6ad5",
  },
  storm: {
    skyTop: "#38434f",
    skyHorizon: "#8693a1",
    skyBottom: "#a3aeb9",
    fog: "#59636f",
    fogNear: 120,
    fogFar: 800,
    sun: "#d7e2ee",
    sunIntensity: 1.3,
    sunDir: [-0.3, 0.85, 0.4],
    hemiSky: "#9aa8b8",
    hemiGround: "#2a3038",
    hemiIntensity: 1.15,
    road: "#2c3036",
    roadLine: "#e8f0f8",
    accent: "#7cff6b",
    accent2: "#e8f0f8",
    wall: "#9fffa0",
    wallOpacity: 0.22,
    ground: "#2b3a33",
    grid: "#7cff6b",
    mountains: "#36424d",
    stars: false,
    disc: null,
  },
};

export function themeOf(key: string): Theme {
  return THEMES[key] ?? THEMES.dusk;
}

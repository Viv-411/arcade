/**
 * Board themes + the small set of per-viewer chess preferences. These are
 * VIEWER preferences, not room settings: two players in the same online game
 * can each pick their own board colours, so they live in localStorage rather
 * than travelling over the wire.
 */

export interface BoardTheme {
  id: string;
  name: string;
  light: string;
  dark: string;
  /** Tint for the last move's from/to squares. */
  lastMove: string;
  /** Tint for the square a selected piece is sitting on. */
  selected: string;
}

export const BOARD_THEMES: BoardTheme[] = [
  {
    id: "green",
    name: "Green",
    light: "#eeeed2",
    dark: "#769656",
    lastMove: "rgba(255, 255, 51, 0.45)",
    selected: "rgba(255, 255, 51, 0.6)",
  },
  {
    id: "brown",
    name: "Brown",
    light: "#f0d9b5",
    dark: "#b58863",
    lastMove: "rgba(255, 255, 51, 0.45)",
    selected: "rgba(255, 255, 51, 0.6)",
  },
  {
    id: "blue",
    name: "Blue",
    light: "#dee3e6",
    dark: "#8ca2ad",
    lastMove: "rgba(120, 200, 255, 0.55)",
    selected: "rgba(120, 200, 255, 0.7)",
  },
  {
    id: "arcade",
    name: "Arcade",
    light: "#d8d5f2",
    dark: "#5b4b9c",
    lastMove: "rgba(255, 92, 208, 0.45)",
    selected: "rgba(255, 92, 208, 0.6)",
  },
];

const THEME_KEY = "arcade:chess:theme";

export function loadTheme(): BoardTheme {
  const id = localStorage.getItem(THEME_KEY);
  return BOARD_THEMES.find((t) => t.id === id) ?? BOARD_THEMES[0];
}

export function saveTheme(id: string): void {
  localStorage.setItem(THEME_KEY, id);
}

/** Material value used for the captured-tray advantage counter. */
export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Unicode glyphs for the captured trays (the board itself uses real SVG pieces). */
export const PIECE_GLYPH: Record<string, string> = {
  p: "♟",
  n: "♞",
  b: "♝",
  r: "♜",
  q: "♛",
  k: "♚",
};

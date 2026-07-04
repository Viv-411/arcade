export type MatchMode = "strict" | "loose";

export type RoomState = "lobby" | "playing" | "finished";

export interface RoomSettings {
  /** Seconds each round lasts before it auto-resolves. */
  roundTimeSec: number;
  /** Seconds to linger on the reveal before the next round starts. */
  revealPauseSec: number;
  /** Game ends after this many rounds. 0 = unlimited. */
  maxRounds: number;
  /** A player is removed after missing this many consecutive rounds. */
  afkMissLimit: number;
  /** How words are normalized for matching. */
  matchMode: MatchMode;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  roundTimeSec: 60,
  revealPauseSec: 5,
  maxRounds: 20,
  afkMissLimit: 2,
  matchMode: "strict",
};

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** Player info that is safe to broadcast to everyone in a room. */
export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  missedRounds: number;
  /** Whether the player has locked in a word this round (never the word itself). */
  lockedIn: boolean;
  /** Lifetime wins (from the stats store); only populated on gameWin. */
  wins?: number;
}

export interface RevealEntry {
  playerId: string;
  name: string;
  /** The word as typed. */
  word: string;
  /** The normalized form used for matching. */
  normalized: string;
}

export interface RoundRecord {
  round: number;
  entries: RevealEntry[];
}

/** Full public state of a room — enough for a client to render from scratch. */
export interface RoomSnapshot {
  code: string;
  isPublic: boolean;
  state: RoomState;
  hostId: string | null;
  settings: RoomSettings;
  players: PublicPlayer[];
  roundNumber: number;
  /** Epoch ms when the current round resolves; null outside an active round. */
  deadline: number | null;
  usedWords: string[];
  history: RoundRecord[];
  /** Epoch ms when a public lobby auto-starts; null if no countdown running. */
  lobbyCountdownEndsAt: number | null;
  winner: { word: string; rounds: number } | null;
  gameOverReason: string | null;
}

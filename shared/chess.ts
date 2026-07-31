import type { Ack } from "./events.js";

/**
 * Chess — standard chess for exactly two players, in two flavours that share
 * this contract's vocabulary but not its transport:
 * - Online (`/chess/online`, namespace `/chess`): the SERVER owns a chess.js
 *   instance and both clocks and is the only authority on legality, turn
 *   order, time, and results. Clients render; they never decide.
 * - On this device (`/chess/local`): pure client state, no sockets at all.
 *
 * Chess is a perfect-information game, so unlike Imposter/Codewords there is
 * nothing to hide in a snapshot — the full position ships to everyone. The
 * secrecy work in those games has no analogue here; the authority work does.
 */

export type ChessColor = "white" | "black";
/** What a player asks for in the lobby; "random" is resolved at game start. */
export type ChessColorPref = ChessColor | "random";

export interface ChessTimeControl {
  /** Base minutes per side. 0 means UNLIMITED — no clock runs at all. */
  baseMinutes: number;
  /** Seconds added to the mover's clock after each completed move. */
  incrementSeconds: number;
}

export interface ChessSettings {
  timeControl: ChessTimeControl;
  /** The host's colour preference; the guest gets the other colour. */
  hostColor: ChessColorPref;
}

export const DEFAULT_CHESS_TIME_CONTROL: ChessTimeControl = {
  baseMinutes: 5,
  incrementSeconds: 0,
};

export const DEFAULT_CHESS_SETTINGS: ChessSettings = {
  timeControl: DEFAULT_CHESS_TIME_CONTROL,
  hostColor: "random",
};

/** Chess is strictly two-player: min and max are both 2. */
export const CHESS_MIN_PLAYERS = 2;
export const CHESS_MAX_PLAYERS = 2;

export const CHESS_MAX_BASE_MINUTES = 180;
export const CHESS_MAX_INCREMENT_SECONDS = 60;

/** Named presets offered in the lobby (plus Unlimited and a custom entry). */
export const CHESS_PRESETS: { label: string; group: string; tc: ChessTimeControl }[] = [
  { label: "1+0", group: "Bullet", tc: { baseMinutes: 1, incrementSeconds: 0 } },
  { label: "3+2", group: "Blitz", tc: { baseMinutes: 3, incrementSeconds: 2 } },
  { label: "5+0", group: "Blitz", tc: { baseMinutes: 5, incrementSeconds: 0 } },
  { label: "10+0", group: "Rapid", tc: { baseMinutes: 10, incrementSeconds: 0 } },
  { label: "15+10", group: "Rapid", tc: { baseMinutes: 15, incrementSeconds: 10 } },
  { label: "Unlimited", group: "Casual", tc: { baseMinutes: 0, incrementSeconds: 0 } },
];

export function isUnlimited(tc: ChessTimeControl): boolean {
  return tc.baseMinutes <= 0;
}

export function formatTimeControl(tc: ChessTimeControl): string {
  return isUnlimited(tc) ? "Unlimited" : `${tc.baseMinutes}+${tc.incrementSeconds}`;
}

export function otherChessColor(color: ChessColor): ChessColor {
  return color === "white" ? "black" : "white";
}

/** chess.js speaks "w"/"b"; the wire and UI speak "white"/"black". */
export function colorFromShort(short: string): ChessColor {
  return short === "b" ? "black" : "white";
}

export function shortFromColor(color: ChessColor): "w" | "b" {
  return color === "white" ? "w" : "b";
}

export type ChessResult = ChessColor | "draw";

export type ChessEndReason =
  | "checkmate"
  | "resign"
  | "timeout"
  | "stalemate"
  | "fifty"
  | "threefold"
  | "insufficient"
  | "draw-agreed"
  /** A player left the room mid-game (distinct from an explicit resign). */
  | "abandoned";

export interface ChessClocks {
  whiteMs: number;
  blackMs: number;
  /**
   * Whose clock is ticking right now, or null when no clock is running
   * (unlimited time control, or the game is over / not started).
   * Clients tick down locally from the moment they RECEIVE this and resync on
   * the next update, which sidesteps client/server wall-clock skew entirely.
   */
  running: ChessColor | null;
}

export interface ChessPublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  /** Assigned when the game starts; null in the lobby. */
  color: ChessColor | null;
}

/** One played move, enough to render a move list and captured trays. */
export interface ChessMoveInfo {
  san: string;
  from: string;
  to: string;
  color: ChessColor;
  /** Piece type captured by this move, if any ("p","n","b","r","q"). */
  captured: string | null;
  /** Piece promoted to, if any. */
  promotion: string | null;
}

/** Full public state of a chess room — everything needed to render fresh. */
export interface ChessSnapshot {
  code: string;
  isPublic: boolean;
  state: "lobby" | "playing" | "finished";
  hostId: string | null;
  settings: ChessSettings;
  players: ChessPublicPlayer[];
  lobbyCountdownEndsAt: number | null;
  gameOverReason: string | null;
  /** Current position in Forsyth-Edwards Notation. */
  fen: string;
  moves: ChessMoveInfo[];
  turn: ChessColor;
  lastMove: { from: string; to: string } | null;
  /** Side to move is in check. */
  inCheck: boolean;
  /** null when the time control is unlimited. */
  clocks: ChessClocks | null;
  /** Colour that has a draw offer outstanding, if any. */
  drawOfferBy: ChessColor | null;
  result: ChessResult | null;
  endReason: ChessEndReason | null;
}

export interface ChessJoinResult {
  playerId: string;
  code: string;
  link: string;
  room: ChessSnapshot;
}

export interface ChessRejoinResult {
  playerId: string;
  code: string;
  room: ChessSnapshot;
  /** Convenience echo of this player's colour (also in room.players). */
  yourColor: ChessColor | null;
}

export interface ChessClientEvents {
  createRoom(
    payload: { name: string; isPublic: boolean; settings?: Partial<ChessSettings> },
    ack: Ack<ChessJoinResult>,
  ): void;
  joinRoom(payload: { code: string; name: string }, ack: Ack<ChessJoinResult>): void;
  quickPlay(payload: { name: string }, ack: Ack<ChessJoinResult>): void;
  rejoin(payload: { playerId: string; code: string }, ack: Ack<ChessRejoinResult>): void;
  toggleReady(): void;
  startGame(): void;
  leaveRoom(): void;
  playAgain(): void;
  /** Host-only lobby settings. */
  setChessSettings(payload: Partial<ChessSettings>): void;
  makeMove(
    payload: { from: string; to: string; promotion?: string },
    ack: Ack<{ san: string }>,
  ): void;
  resign(): void;
  offerDraw(): void;
  respondDraw(payload: { accept: boolean }): void;
}

export interface ChessServerEvents {
  roomUpdate(room: ChessSnapshot): void;
  errorMsg(payload: { message: string }): void;
  playerJoined(payload: { player: ChessPublicPlayer }): void;
  playerLeft(payload: {
    playerId: string;
    name: string;
    reason: "left" | "afk" | "removed";
  }): void;
  gameStart(payload: {
    fen: string;
    colors: { white: string; black: string };
    timeControl: ChessTimeControl;
    clocks: ChessClocks | null;
  }): void;
  moveMade(payload: {
    fen: string;
    move: ChessMoveInfo;
    lastMove: { from: string; to: string };
    turn: ChessColor;
    inCheck: boolean;
    clocks: ChessClocks | null;
  }): void;
  /** The server rejected a move; the client should snap back to `fen`. */
  illegalMove(payload: { reason: string; fen: string }): void;
  drawOffered(payload: { by: ChessColor }): void;
  drawDeclined(payload: { by: ChessColor }): void;
  /** Periodic resync so a long think (or a sleeping tab) can't drift. */
  clockUpdate(payload: ChessClocks): void;
  gameOver(payload: {
    result: ChessResult;
    reason: ChessEndReason;
    fen: string;
    clocks: ChessClocks | null;
  }): void;
}

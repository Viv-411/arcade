import type {
  PublicPlayer,
  RevealEntry,
  RoomSettings,
  RoomSnapshot,
} from "./types.js";

/** Every request/response style event acks with this envelope. */
export type AckResponse<T> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T> = (res: AckResponse<T>) => void;

export interface JoinResult {
  playerId: string;
  code: string;
  /** Shareable link, e.g. /mindmeld?room=ABCD */
  link: string;
  room: RoomSnapshot;
}

export interface RejoinResult {
  playerId: string;
  code: string;
  room: RoomSnapshot;
  /** The rejoining player's own current-round word, if they locked one in. */
  yourWord: { raw: string; normalized: string } | null;
}

export interface ClientToServerEvents {
  createRoom(
    payload: { name: string; isPublic: boolean; settings?: Partial<RoomSettings> },
    ack: Ack<JoinResult>,
  ): void;
  joinRoom(payload: { code: string; name: string }, ack: Ack<JoinResult>): void;
  quickPlay(payload: { name: string }, ack: Ack<JoinResult>): void;
  rejoin(payload: { playerId: string; code: string }, ack: Ack<RejoinResult>): void;
  toggleReady(): void;
  startGame(): void;
  lockIn(payload: { word: string }, ack: Ack<{ normalized: string }>): void;
  unlock(): void;
  leaveRoom(): void;
  playAgain(): void;
}

export interface ServerToClientEvents {
  roomUpdate(room: RoomSnapshot): void;
  roundStart(payload: { roundNumber: number; usedWords: string[]; deadline: number }): void;
  playerLockedIn(payload: { playerId: string; locked: boolean }): void;
  revealCountdown(payload: { secondsLeft: number }): void;
  roundReveal(payload: {
    round: number;
    entries: RevealEntry[];
    usedWords: string[];
    isWin: boolean;
  }): void;
  gameWin(payload: { word: string; rounds: number; players: PublicPlayer[] }): void;
  gameOver(payload: { reason: string }): void;
  errorMsg(payload: { message: string }): void;
  playerJoined(payload: { player: PublicPlayer }): void;
  playerLeft(payload: {
    playerId: string;
    name: string;
    reason: "left" | "afk" | "removed";
  }): void;
}

export interface SocketData {
  playerId?: string;
  roomCode?: string;
  /** Supabase user id when the socket connected with a valid access token. */
  userId?: string | null;
}

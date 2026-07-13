import type { Ack } from "./events.js";

export type ImposterRole = "imposter" | "crew";
export type ImposterState =
  | "lobby"
  | "reveal" // private role-reveal countdown
  | "clues"
  | "decision" // continue-or-vote
  | "vote"
  | "steal" // caught imposter's one word guess
  | "finished";
export type ClueInputMode = "typed" | "spoken";
export type ImposterSide = "crew" | "imposters";

export interface ImposterSettings {
  /** Number of imposters (clamped to players-1 at start). */
  imposters: number;
  /** Word category; null = random each game. */
  category: string | null;
  /** When ON, imposters also see the category as a hint (never the word). */
  hints: boolean;
  /** Caught last imposter gets one guess at the word. */
  wordSteal: boolean;
  clueInputMode: ClueInputMode;
  /** Clue rounds per cycle before the accusation vote is forced. */
  maxClueRounds: number;
  clueTurnSec: number;
  decisionSec: number;
  voteSec: number;
  stealSec: number;
  revealSec: number;
}

export const DEFAULT_IMPOSTER_SETTINGS: ImposterSettings = {
  imposters: 1,
  category: null,
  hints: true,
  wordSteal: true,
  clueInputMode: "typed",
  maxClueRounds: 3,
  clueTurnSec: 30,
  decisionSec: 15,
  voteSec: 25,
  stealSec: 30,
  revealSec: 7,
};

export const IMPOSTER_MIN_PLAYERS = 3;
export const IMPOSTER_MAX_PLAYERS = 10;

export interface ImposterPublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  alive: boolean;
  /** Acted in the current phase (clued/voted) — never what they chose. */
  acted: boolean;
}

export interface ClueEntry {
  playerId: string;
  name: string;
  /** null = spoken mode or skipped turn. */
  word: string | null;
}

export interface ClueRound {
  round: number;
  entries: ClueEntry[];
}

export interface EliminationRecord {
  playerId: string;
  name: string;
  role: ImposterRole;
}

export interface YourRolePayload {
  role: ImposterRole;
  /** The secret word — crew only, NEVER sent to imposters. */
  word: string | null;
  /** Category hint — imposters only, and only when hints are ON. */
  hint: string | null;
  startingPlayerName: string;
}

export interface ImposterSnapshot {
  code: string;
  isPublic: boolean;
  state: ImposterState;
  hostId: string | null;
  settings: ImposterSettings;
  players: ImposterPublicPlayer[];
  lobbyCountdownEndsAt: number | null;
  gameOverReason: string | null;
  /** Global clue-round counter (across elimination cycles). */
  round: number;
  startingPlayerName: string | null;
  whoseTurn: string | null;
  turnDeadline: number | null;
  /** Deadline of the current reveal/decision/vote/steal phase. */
  phaseDeadline: number | null;
  clueBoard: ClueRound[];
  /** Accusation candidates (runoffs narrow this). */
  candidates: string[];
  runoff: boolean;
  forced: boolean;
  stealTargetId: string | null;
  eliminated: EliminationRecord[];
  /** Populated ONLY when state === "finished". */
  winners: ImposterSide | null;
  word: string | null;
  allRoles: EliminationRecord[] | null;
}

export interface ImposterJoinResult {
  playerId: string;
  code: string;
  link: string;
  room: ImposterSnapshot;
}

export interface ImposterRejoinResult {
  playerId: string;
  code: string;
  room: ImposterSnapshot;
  /** Own private card restored on refresh; null in the lobby. */
  yourRole: YourRolePayload | null;
}

export interface ImposterClientEvents {
  createRoom(
    payload: { name: string; isPublic: boolean; settings?: Partial<ImposterSettings> },
    ack: Ack<ImposterJoinResult>,
  ): void;
  joinRoom(payload: { code: string; name: string }, ack: Ack<ImposterJoinResult>): void;
  quickPlay(payload: { name: string }, ack: Ack<ImposterJoinResult>): void;
  rejoin(payload: { playerId: string; code: string }, ack: Ack<ImposterRejoinResult>): void;
  toggleReady(): void;
  startGame(): void;
  leaveRoom(): void;
  playAgain(): void;
  setImposterSettings(payload: Partial<ImposterSettings>): void;
  submitClue(payload: { word: string }, ack: Ack<{ word: string }>): void;
  /** Spoken mode: active player (or host) advances the turn. */
  advanceTurn(): void;
  castDecisionVote(payload: { choice: "another" | "accuse" }): void;
  castAccusationVote(payload: { targetId: string }): void;
  submitWordGuess(payload: { word: string }, ack: Ack<{ correct: boolean }>): void;
}

export interface ImposterServerEvents {
  roomUpdate(room: ImposterSnapshot): void;
  errorMsg(payload: { message: string }): void;
  playerJoined(payload: { player: ImposterPublicPlayer }): void;
  playerLeft(payload: {
    playerId: string;
    name: string;
    reason: "left" | "afk" | "removed";
  }): void;
  /** Private, per-socket. */
  yourRole(payload: YourRolePayload): void;
  clueTurn(payload: { playerId: string; deadline: number; round: number }): void;
  clueSubmitted(payload: ClueEntry & { round: number }): void;
  decisionStart(payload: { deadline: number }): void;
  decisionResult(payload: { another: number; accuse: number; goVote: boolean }): void;
  voteStart(payload: {
    candidates: string[];
    deadline: number;
    runoff: boolean;
    forced: boolean;
  }): void;
  voteResult(payload: {
    tally: { targetId: string; votes: number }[];
    eliminatedId: string | null;
    revealedRole: ImposterRole | null;
    runoffNext: boolean;
  }): void;
  /** Private: sent only to the caught imposter. */
  wordStealPrompt(payload: { deadline: number }): void;
  gameEnd(payload: {
    winningSide: ImposterSide | null;
    word: string;
    allRoles: EliminationRecord[];
    reason?: string;
  }): void;
}

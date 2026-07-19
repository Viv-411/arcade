import type { Ack } from "./events.js";

/**
 * Codewords — a two-team word-association deduction game. 25 word cards in a
 * 5x5 grid; a hidden key marks each card as a red agent, blue agent, innocent
 * bystander, or the single assassin. Spymasters (who both see the SAME full
 * key) give one-word clues; their operatives guess cards. The only secrecy
 * boundary is spymasters-vs-operatives: operatives never receive a card's
 * identity until it is revealed.
 *
 * Two modes share one namespace (/codewords) and one server state machine:
 * - "remote": everyone on their own device; operatives guess by majority vote.
 * - "board": one shared screen (the board device) + spymasters on phones that
 *   join via per-team QR tokens; guesses are taps on the shared board.
 */

export type CwTeam = "red" | "blue";
export type CwRole = "spymaster" | "operative";
export type CwIdentity = "red" | "blue" | "bystander" | "assassin";
export type CwMode = "remote" | "board";
export type CwPhase = "clue" | "guess";
export type CwState = "lobby" | "playing" | "finished";
/** A clue's number: 0..9, or "unlimited". 0 and "unlimited" both mean no guess cap. */
export type CwClueNumber = number | "unlimited";

export interface CodewordsSettings {
  mode: CwMode;
}

export const DEFAULT_CODEWORDS_SETTINGS: CodewordsSettings = { mode: "remote" };

export const CW_BOARD_SIZE = 25;
export const CW_STARTING_TEAM_AGENTS = 9;
export const CW_SECOND_TEAM_AGENTS = 8;
export const CW_BYSTANDERS = 7;
export const CW_MAX_CLUE_NUMBER = 9;

export const CODEWORDS_REMOTE_MIN_PLAYERS = 4;
export const CODEWORDS_REMOTE_MAX_PLAYERS = 10;
/** Board mode rooms hold exactly: the shared board device + two spymaster phones. */
export const CODEWORDS_BOARD_ROOM_SIZE = 3;

export function otherCwTeam(team: CwTeam): CwTeam {
  return team === "red" ? "blue" : "red";
}

export function cwTeamLabel(team: CwTeam): string {
  return team === "red" ? "Red" : "Blue";
}

export interface CwPublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  team: CwTeam | null;
  role: CwRole;
  /** True for the shared-screen device in board mode (not a team member). */
  isBoard: boolean;
}

/** A card as everyone may see it: identity present ONLY once revealed. */
export interface CwPublicCard {
  word: string;
  revealed: boolean;
  identity: CwIdentity | null;
}

export interface CwClue {
  team: CwTeam;
  /** null = the clue was spoken aloud (board mode manual counter). */
  word: string | null;
  number: CwClueNumber;
}

export interface CwGuessRecord {
  index: number;
  word: string;
  identity: CwIdentity;
}

export interface CwClueRecord extends CwClue {
  guesses: CwGuessRecord[];
}

/** Live vote tallies for the active team's guess phase (remote mode). */
export interface CwVoteTally {
  /** cardIndex -> current vote count. */
  cards: Record<number, number>;
  pass: number;
  /** Votes needed for a majority right now. */
  needed: number;
}

export interface CodewordsSnapshot {
  code: string;
  isPublic: boolean;
  state: CwState;
  hostId: string | null;
  settings: CodewordsSettings;
  players: CwPublicPlayer[];
  lobbyCountdownEndsAt: number | null;
  gameOverReason: string | null;
  /** Empty in the lobby; identities only on revealed cards. */
  board: CwPublicCard[];
  startingTeam: CwTeam | null;
  activeTeam: CwTeam | null;
  phase: CwPhase | null;
  clue: CwClue | null;
  /** Guesses left this turn; null = unlimited (or outside a guess phase). */
  guessesRemaining: number | null;
  guessesMade: number;
  /** Unrevealed agents left per team. */
  remaining: Record<CwTeam, number>;
  clueHistory: CwClueRecord[];
  /** Teams currently without a (connected, in board mode) spymaster mid-game. */
  needsSpymaster: CwTeam[];
  winner: CwTeam | null;
  /** The complete key — ONLY once the game is finished. */
  fullKey: CwIdentity[] | null;
}

export interface CodewordsJoinResult {
  playerId: string;
  code: string;
  link: string;
  room: CodewordsSnapshot;
}

export interface CodewordsRejoinResult {
  playerId: string;
  code: string;
  room: CodewordsSnapshot;
  /** The full key — only when this player is a spymaster (or game finished). */
  yourKey: CwIdentity[] | null;
  yourVote: number | "pass" | null;
  voteTally: CwVoteTally | null;
  /** Per-team QR tokens — only for the board device in board mode. */
  boardTokens: Record<CwTeam, string> | null;
}

export interface CodewordsClientEvents {
  createRoom(
    payload: { name: string; isPublic: boolean; settings?: Partial<CodewordsSettings> },
    ack: Ack<CodewordsJoinResult>,
  ): void;
  joinRoom(payload: { code: string; name: string }, ack: Ack<CodewordsJoinResult>): void;
  quickPlay(payload: { name: string }, ack: Ack<CodewordsJoinResult>): void;
  rejoin(payload: { playerId: string; code: string }, ack: Ack<CodewordsRejoinResult>): void;
  toggleReady(): void;
  startGame(): void;
  leaveRoom(): void;
  playAgain(): void;
  /** Remote lobby: switch your own team. */
  assignTeam(payload: { team: CwTeam }): void;
  /** Make a player their team's spymaster (host or self; mid-game only to fill a vacancy). */
  setSpymaster(payload: { playerId: string }): void;
  /** Board mode: a phone claims a spymaster seat with the QR token. */
  spymasterJoinViaToken(
    payload: { code: string; team: CwTeam; token: string },
    ack: Ack<CodewordsJoinResult>,
  ): void;
  /** Spymaster clue; board device may send word:null (spoken clue, number only). */
  submitClue(
    payload: { word: string | null; number: CwClueNumber },
    ack: Ack<{ word: string | null; number: CwClueNumber }>,
  ): void;
  /** Remote mode: toggle your vote for a card index, or "pass". */
  voteCard(payload: { target: number | "pass" }): void;
  /** Board mode: the shared board applies a tapped guess. */
  revealCard(payload: { index: number }): void;
  /** Board mode: end the guess phase (after at least one guess). */
  passTurn(): void;
}

export interface CodewordsServerEvents {
  roomUpdate(room: CodewordsSnapshot): void;
  errorMsg(payload: { message: string }): void;
  playerJoined(payload: { player: CwPublicPlayer }): void;
  playerLeft(payload: {
    playerId: string;
    name: string;
    reason: "left" | "afk" | "removed";
  }): void;
  gameStart(payload: { room: CodewordsSnapshot }): void;
  /** The SAME full key, delivered privately to every spymaster (both modes). */
  yourKey(payload: { key: CwIdentity[] }): void;
  /** Per-team QR join tokens, delivered privately to the board device. */
  boardTokens(payload: { tokens: Record<CwTeam, string> }): void;
  clueGiven(payload: CwClue): void;
  voteUpdate(payload: CwVoteTally): void;
  cardRevealed(payload: {
    index: number;
    identity: CwIdentity;
    byTeam: CwTeam;
    outcome: "agent" | "bystander" | "opponent" | "assassin";
  }): void;
  turnChange(payload: {
    activeTeam: CwTeam;
    phase: CwPhase;
    guessesRemaining: number | null;
  }): void;
  gameOver(payload: { winner: CwTeam; reason: string; fullKey: CwIdentity[] }): void;
}

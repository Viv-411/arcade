import type { Ack } from "./events.js";

export type TriviaDifficulty = "easy" | "medium" | "hard";

export type TriviaState = "lobby" | "voting" | "playing" | "finished";

export interface TriviaSettings {
  /** Number of questions in a game. */
  questionsPerGame: number;
  /** Seconds players have to answer each question. */
  questionTimeSec: number;
  /** OpenTDB difficulty; host can change it in the lobby. */
  difficulty: TriviaDifficulty;
  /** Seconds to linger on each reveal before the next question. */
  revealPauseSec: number;
  /** Seconds the category vote lasts. */
  categoryVoteSec: number;
}

export const DEFAULT_TRIVIA_SETTINGS: TriviaSettings = {
  questionsPerGame: 10,
  questionTimeSec: 20,
  difficulty: "medium",
  revealPauseSec: 5,
  categoryVoteSec: 15,
};

/** The always-present "Surprise Me / Any" category vote option. */
export const ANY_CATEGORY_ID = -1;

export interface TriviaPublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  score: number;
  /** Whether they answered the current question (never their choice). */
  answered: boolean;
  /** Whether they voted in the category vote (never their pick). */
  voted: boolean;
}

export interface CategoryOption {
  id: number;
  name: string;
}

export interface ScoreboardEntry {
  playerId: string;
  name: string;
  totalScore: number;
}

export interface TriviaQuestionPublic {
  /** 0-based question index. */
  index: number;
  total: number;
  category: string;
  questionText: string;
  options: string[];
  /** Epoch ms when the question auto-resolves. */
  deadline: number;
}

export interface TriviaRevealPerPlayer {
  playerId: string;
  name: string;
  choice: number | null;
  correct: boolean;
  pointsEarned: number;
}

export interface TriviaRevealPayload {
  index: number;
  correctIndex: number;
  perPlayer: TriviaRevealPerPlayer[];
  scoreboard: ScoreboardEntry[];
}

export interface TriviaVotePublic {
  options: CategoryOption[];
  /** categoryId -> vote count. */
  tally: Record<number, number>;
  deadline: number;
}

/** Full public state of a trivia room — enough to render from scratch on rejoin. */
export interface TriviaSnapshot {
  code: string;
  isPublic: boolean;
  state: TriviaState;
  hostId: string | null;
  settings: TriviaSettings;
  players: TriviaPublicPlayer[];
  lobbyCountdownEndsAt: number | null;
  gameOverReason: string | null;
  vote: TriviaVotePublic | null;
  /** Winning category name once the vote resolves (questions may still be loading). */
  chosenCategory: string | null;
  question: TriviaQuestionPublic | null;
  /** The most recent question reveal, cleared when the next question starts. */
  lastReveal: TriviaRevealPayload | null;
  scoreboard: ScoreboardEntry[];
  winners: ScoreboardEntry[] | null;
}

export interface TriviaJoinResult {
  playerId: string;
  code: string;
  link: string;
  room: TriviaSnapshot;
}

export interface TriviaRejoinResult {
  playerId: string;
  code: string;
  room: TriviaSnapshot;
  /** The rejoining player's locked answer for the current question, if any. */
  yourAnswer: number | null;
}

export interface TriviaClientEvents {
  createRoom(
    payload: { name: string; isPublic: boolean; settings?: Partial<TriviaSettings> },
    ack: Ack<TriviaJoinResult>,
  ): void;
  joinRoom(payload: { code: string; name: string }, ack: Ack<TriviaJoinResult>): void;
  quickPlay(payload: { name: string }, ack: Ack<TriviaJoinResult>): void;
  rejoin(payload: { playerId: string; code: string }, ack: Ack<TriviaRejoinResult>): void;
  toggleReady(): void;
  leaveRoom(): void;
  playAgain(): void;
  startGame(): void;
  setDifficulty(payload: { difficulty: TriviaDifficulty }): void;
  voteCategory(payload: { categoryId: number }): void;
  answer(payload: { optionIndex: number }, ack: Ack<{ optionIndex: number }>): void;
}

export interface TriviaServerEvents {
  roomUpdate(room: TriviaSnapshot): void;
  errorMsg(payload: { message: string }): void;
  playerJoined(payload: { player: TriviaPublicPlayer }): void;
  playerLeft(payload: {
    playerId: string;
    name: string;
    reason: "left" | "afk" | "removed";
  }): void;
  voteStart(payload: { options: CategoryOption[]; deadline: number }): void;
  voteUpdate(payload: { tally: Record<number, number> }): void;
  questionStart(payload: TriviaQuestionPublic): void;
  playerAnswered(payload: { playerId: string }): void;
  questionReveal(payload: TriviaRevealPayload): void;
  revealCountdown(payload: { secondsLeft: number }): void;
  gameOver(payload: {
    finalScoreboard: ScoreboardEntry[];
    winners: ScoreboardEntry[];
    reason?: string;
  }): void;
}

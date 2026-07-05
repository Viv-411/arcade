import type { Ack } from "./events.js";

export type BidBattleMode = "1v1" | "2v2";
export type TeamId = "A" | "B";
export type BidBattleState =
  | "lobby"
  | "category"
  | "bidding"
  | "delivery"
  | "review"
  | "finished";

export interface BidBattleSettings {
  /** 1v1 (2 players) or 2v2 (4 players); fixed team sizes. */
  mode: BidBattleMode;
  /** First team to this many points wins the match. */
  targetPoints: number;
  /** Seconds per bidding turn. */
  bidTurnSec: number;
  /** Seconds the delivering team gets to name items. */
  deliverySec: number;
  /** Seconds the category ballot lasts (private rooms only). */
  categorySec: number;
  /** Seconds the review phase lasts. */
  reviewSec: number;
}

export const DEFAULT_BIDBATTLE_SETTINGS: BidBattleSettings = {
  mode: "1v1",
  targetPoints: 3,
  bidTurnSec: 10,
  deliverySec: 60,
  categorySec: 20,
  reviewSec: 45,
};

export function bidBattleModeSize(mode: BidBattleMode): number {
  return mode === "2v2" ? 4 : 2;
}

export function otherTeam(team: TeamId): TeamId {
  return team === "A" ? "B" : "A";
}

/** Votes a custom category needs to beat Random: unanimous in 1v1, 3-of-4 in 2v2. */
export function customApprovalThreshold(mode: BidBattleMode): number {
  return mode === "2v2" ? 3 : 2;
}

export interface BidBattlePublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  team: TeamId | null;
  /** Whether they voted in the current category ballot (never their pick). */
  voted: boolean;
}

export interface BallotOption {
  id: number;
  kind: "random" | "custom";
  label: string;
  suggestedBy?: string;
}

export interface BallotPublic {
  options: BallotOption[];
  /** optionId -> vote count. */
  tally: Record<number, number>;
  deadline: number;
}

export interface BidEntry {
  team: TeamId;
  amount: number;
}

export interface BiddingPublic {
  /** 0 = no bid yet (opening turn). */
  currentBid: number;
  lastBidTeam: TeamId | null;
  turnTeam: TeamId;
  deadline: number;
  history: BidEntry[];
  /** True once the opener timed out and the opening passed to the other team. */
  openingPassed: boolean;
}

export interface DeliveryPublic {
  deliveringTeam: TeamId;
  target: number;
  /** Live count only — items are visible to the delivering team during the sprint. */
  count: number;
  deadline: number;
}

export type ReviewItemStatus =
  | "ok" // unflagged (counts)
  | "flagged" // opposing team flagged it, awaiting a response
  | "conceded" // delivering team conceded (dropped)
  | "defended" // delivering team defended, awaiting the final call
  | "accepted" // opposing team accepted the defense (counts)
  | "upheld"; // opposing team upheld the flag (dropped)

export interface ReviewItem {
  raw: string;
  normalized: string;
  status: ReviewItemStatus;
}

export interface ReviewPublic {
  deliveringTeam: TeamId;
  target: number;
  items: ReviewItem[];
  deadline: number;
}

export interface RoundResult {
  round: number;
  category: string;
  deliveringTeam: TeamId;
  target: number;
  validCount: number;
  winnerTeam: TeamId;
  scores: Record<TeamId, number>;
}

export interface BidBattleSnapshot {
  code: string;
  isPublic: boolean;
  state: BidBattleState;
  hostId: string | null;
  settings: BidBattleSettings;
  players: BidBattlePublicPlayer[];
  lobbyCountdownEndsAt: number | null;
  gameOverReason: string | null;
  round: number;
  scores: Record<TeamId, number>;
  category: string | null;
  categorySource: "custom" | "random" | null;
  ballot: BallotPublic | null;
  bidding: BiddingPublic | null;
  delivery: DeliveryPublic | null;
  review: ReviewPublic | null;
  lastResult: RoundResult | null;
  winnerTeam: TeamId | null;
}

export interface BidBattleJoinResult {
  playerId: string;
  code: string;
  link: string;
  room: BidBattleSnapshot;
}

export interface BidBattleRejoinResult {
  playerId: string;
  code: string;
  room: BidBattleSnapshot;
  yourVote: number | null;
  yourSuggestions: number;
  /** Your team's live list if you rejoin mid-delivery on the delivering team. */
  deliveryItems: { raw: string; normalized: string }[] | null;
}

export interface BidBattleClientEvents {
  createRoom(
    payload: { name: string; isPublic: boolean; settings?: Partial<BidBattleSettings> },
    ack: Ack<BidBattleJoinResult>,
  ): void;
  joinRoom(payload: { code: string; name: string }, ack: Ack<BidBattleJoinResult>): void;
  quickPlay(
    payload: { name: string; mode: BidBattleMode; settings?: Partial<BidBattleSettings> },
    ack: Ack<BidBattleJoinResult>,
  ): void;
  rejoin(payload: { playerId: string; code: string }, ack: Ack<BidBattleRejoinResult>): void;
  toggleReady(): void;
  leaveRoom(): void;
  playAgain(): void;
  startGame(): void;
  setMode(payload: { mode: BidBattleMode }): void;
  assignTeam(payload: { team: TeamId }): void;
  submitCategorySuggestion(payload: { text: string }, ack: Ack<{ optionId: number }>): void;
  voteCategory(payload: { optionId: number }): void;
  raiseBid(payload: { amount: number }, ack: Ack<{ amount: number }>): void;
  challengeBid(): void;
  submitItem(payload: { text: string }, ack: Ack<{ count: number }>): void;
  finishDelivery(): void;
  flagItem(payload: { index: number }): void;
  respondToFlag(payload: { index: number; action: "concede" | "defend" }): void;
  finalizeFlag(payload: { index: number; action: "accept" | "uphold" }): void;
}

export interface BidBattleServerEvents {
  roomUpdate(room: BidBattleSnapshot): void;
  errorMsg(payload: { message: string }): void;
  playerJoined(payload: { player: BidBattlePublicPlayer }): void;
  playerLeft(payload: {
    playerId: string;
    name: string;
    reason: "left" | "afk" | "removed";
  }): void;
  teamsUpdate(payload: { players: BidBattlePublicPlayer[] }): void;
  categoryBallot(payload: BallotPublic): void;
  categoryReveal(payload: { category: string; source: "custom" | "random" }): void;
  bidUpdate(payload: BiddingPublic): void;
  biddingEnded(payload: { deliveringTeam: TeamId; target: number }): void;
  itemAccepted(payload: { raw: string; normalized: string; count: number }): void;
  deliveryCount(payload: { count: number }): void;
  deliveryEnded(): void;
  reviewStart(payload: ReviewPublic): void;
  flagUpdate(payload: { statuses: ReviewItemStatus[] }): void;
  roundResult(payload: RoundResult): void;
  gameOver(payload: { winnerTeam: TeamId; scores: Record<TeamId, number>; reason?: string }): void;
}

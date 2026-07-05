import type { Namespace } from "socket.io";
import type { Ack, SocketData } from "../../../shared/events.js";
import {
  DEFAULT_BIDBATTLE_SETTINGS,
  bidBattleModeSize,
  customApprovalThreshold,
  otherTeam,
  type BallotOption,
  type BallotPublic,
  type BidBattleClientEvents,
  type BidBattleMode,
  type BidBattlePublicPlayer,
  type BidBattleServerEvents,
  type BidBattleSettings,
  type BidBattleSnapshot,
  type BidBattleState,
  type BidEntry,
  type BiddingPublic,
  type ReviewItem,
  type ReviewPublic,
  type RoundResult,
  type TeamId,
} from "../../../shared/bidbattle.js";
import { normalizeWord } from "../../../shared/normalize.js";
import type { RoomStore } from "../store.js";
import type { StatsStore } from "../stats.js";
import {
  BaseRoomManager,
  clamp,
  type AnySocket,
  type BasePlayer,
  type BaseRoom,
} from "../core/roomManager.js";
import { CATEGORY_DECK } from "./categories.js";

type BidBattleNamespace = Namespace<
  BidBattleClientEvents,
  BidBattleServerEvents,
  Record<string, never>,
  SocketData
>;

interface BidBattlePlayer extends BasePlayer {
  team: TeamId | null;
}

interface GameData {
  round: number;
  scores: Record<TeamId, number>;
  usedCategories: Set<string>;
  /** Team that opens the next auction (loser of the previous point). */
  openerTeam: TeamId | null;
  // --- category phase ---
  ballotOptions: BallotOption[];
  nextOptionId: number;
  suggestionCounts: Map<string, number>;
  votes: Map<string, number>;
  categoryDeadline: number | null;
  category: string | null;
  categorySource: "custom" | "random" | null;
  // --- bidding ---
  turnTeam: TeamId | null;
  currentBid: number;
  lastBidTeam: TeamId | null;
  bidHistory: BidEntry[];
  bidDeadline: number | null;
  openingPassed: boolean;
  // --- delivery ---
  deliveringTeam: TeamId | null;
  target: number;
  items: { raw: string; normalized: string }[];
  deliveryDeadline: number | null;
  // --- review ---
  statuses: ReviewItem["status"][];
  reviewDeadline: number | null;
  lastResult: RoundResult | null;
  winnerTeam: TeamId | null;
  // --- timers ---
  categoryTimer: NodeJS.Timeout | null;
  preBidTimer: NodeJS.Timeout | null;
  bidTimer: NodeJS.Timeout | null;
  deliveryTimer: NodeJS.Timeout | null;
  reviewTimer: NodeJS.Timeout | null;
  resultTimer: NodeJS.Timeout | null;
}

interface BidBattleRoom extends BaseRoom<BidBattleSettings, BidBattlePlayer> {
  game: GameData;
}

const MAX_CUSTOM_PER_PLAYER = 2;
const MAX_CUSTOM_TOTAL = 8;
const MAX_BID = 500;
const PRE_BID_PAUSE_MS = 3000;
const RESULT_PAUSE_MS = 4000;
const RANDOM_OPTION_ID = 0;

function freshGame(): GameData {
  return {
    round: 0,
    scores: { A: 0, B: 0 },
    usedCategories: new Set(),
    openerTeam: null,
    ballotOptions: [],
    nextOptionId: 1,
    suggestionCounts: new Map(),
    votes: new Map(),
    categoryDeadline: null,
    category: null,
    categorySource: null,
    turnTeam: null,
    currentBid: 0,
    lastBidTeam: null,
    bidHistory: [],
    bidDeadline: null,
    openingPassed: false,
    deliveringTeam: null,
    target: 0,
    items: [],
    deliveryDeadline: null,
    statuses: [],
    reviewDeadline: null,
    lastResult: null,
    winnerTeam: null,
    categoryTimer: null,
    preBidTimer: null,
    bidTimer: null,
    deliveryTimer: null,
    reviewTimer: null,
    resultTimer: null,
  };
}

export class BidBattleManager extends BaseRoomManager<
  BidBattleSettings,
  BidBattlePlayer,
  BidBattleRoom
> {
  constructor(
    private bnsp: BidBattleNamespace,
    store: RoomStore<BidBattleRoom>,
    private stats: StatsStore,
  ) {
    super(bnsp, store, "/bidbattle");
  }

  // ---------- base hooks ----------

  protected bindGameEvents(socket: AnySocket): void {
    socket.on("setMode", (p: { mode: BidBattleMode }) => this.setMode(socket, p));
    socket.on("assignTeam", (p: { team: TeamId }) => this.assignTeam(socket, p));
    socket.on("submitCategorySuggestion", (p: { text: string }, ack: Ack<{ optionId: number }>) =>
      this.submitSuggestion(socket, p, ack),
    );
    socket.on("voteCategory", (p: { optionId: number }) => this.voteCategory(socket, p));
    socket.on("raiseBid", (p: { amount: number }, ack: Ack<{ amount: number }>) =>
      this.raiseBid(socket, p, ack),
    );
    socket.on("challengeBid", () => this.challengeBid(socket));
    socket.on("submitItem", (p: { text: string }, ack: Ack<{ count: number }>) =>
      this.submitItem(socket, p, ack),
    );
    socket.on("finishDelivery", () => this.finishDelivery(socket));
    socket.on("flagItem", (p: { index: number }) => this.flagItem(socket, p));
    socket.on("respondToFlag", (p: { index: number; action: "concede" | "defend" }) =>
      this.respondToFlag(socket, p),
    );
    socket.on("finalizeFlag", (p: { index: number; action: "accept" | "uphold" }) =>
      this.finalizeFlag(socket, p),
    );
  }

  protected sanitizeSettings(partial?: Partial<BidBattleSettings>): BidBattleSettings {
    const s = { ...DEFAULT_BIDBATTLE_SETTINGS, ...partial };
    return {
      mode: s.mode === "2v2" ? "2v2" : "1v1",
      targetPoints: clamp(Number(s.targetPoints) || 3, 1, 10),
      bidTurnSec: clamp(Number(s.bidTurnSec) || 10, 3, 30),
      deliverySec: clamp(Number(s.deliverySec) || 60, 5, 180),
      categorySec: clamp(Number(s.categorySec) || 20, 5, 60),
      reviewSec: clamp(Number(s.reviewSec) || 45, 3, 120),
    };
  }

  protected makeRoom(base: BaseRoom<BidBattleSettings, BidBattlePlayer>): BidBattleRoom {
    return { ...base, game: freshGame() };
  }

  protected makePlayer(base: BasePlayer): BidBattlePlayer {
    return { ...base, team: null };
  }

  protected roomMinPlayers(room: BidBattleRoom): number {
    return bidBattleModeSize(room.settings.mode);
  }

  protected roomMaxPlayers(room: BidBattleRoom): number {
    return bidBattleModeSize(room.settings.mode);
  }

  protected canAutoStartPartial(): boolean {
    return false; // exact team sizes only — start when the room is full
  }

  protected canStartExtra(room: BidBattleRoom): string | null {
    const half = bidBattleModeSize(room.settings.mode) / 2;
    const a = this.teamMembers(room, "A").length;
    const b = this.teamMembers(room, "B").length;
    if (a !== half || b !== half) return "Teams must be full and balanced first.";
    return null;
  }

  protected quickPlayEligible(room: BidBattleRoom, payload: unknown): boolean {
    const mode = (payload as { mode?: string })?.mode === "2v2" ? "2v2" : "1v1";
    return room.settings.mode === mode;
  }

  protected quickPlayCreateSettings(payload: unknown): Partial<BidBattleSettings> {
    const p = payload as { mode?: BidBattleMode; settings?: Partial<BidBattleSettings> };
    return { ...p?.settings, mode: p?.mode === "2v2" ? "2v2" : "1v1" };
  }

  protected onPlayerJoined(room: BidBattleRoom, player: BidBattlePlayer, socket: AnySocket): void {
    // Default to the smaller team so lobbies stay balanced without any clicks.
    const half = bidBattleModeSize(room.settings.mode) / 2;
    const a = this.teamMembers(room, "A").length;
    const b = this.teamMembers(room, "B").length;
    player.team = a <= b && a < half ? "A" : b < half ? "B" : null;
    if (player.team) socket.join(this.teamRoom(room, player.team));
  }

  protected onRejoin(room: BidBattleRoom, player: BidBattlePlayer, socket: AnySocket): void {
    if (player.team) socket.join(this.teamRoom(room, player.team));
  }

  protected publicPlayer(room: BidBattleRoom, p: BidBattlePlayer): BidBattlePublicPlayer {
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
      team: p.team,
      voted: room.game.votes.has(p.id),
    };
  }

  protected snapshot(room: BidBattleRoom): BidBattleSnapshot {
    const g = room.game;
    return {
      code: room.code,
      isPublic: room.isPublic,
      state: room.state as BidBattleState,
      hostId: room.hostId,
      settings: room.settings,
      players: [...room.players.values()].map((p) => this.publicPlayer(room, p)),
      lobbyCountdownEndsAt: room.lobbyCountdownEndsAt,
      gameOverReason: room.gameOverReason,
      round: g.round,
      scores: g.scores,
      category: g.category,
      categorySource: g.categorySource,
      ballot:
        room.state === "category" && !room.isPublic && g.ballotOptions.length > 0 && !g.category
          ? this.ballotPublic(room)
          : null,
      bidding: room.state === "bidding" && g.turnTeam ? this.biddingPublic(room) : null,
      delivery:
        room.state === "delivery" && g.deliveringTeam
          ? {
              deliveringTeam: g.deliveringTeam,
              target: g.target,
              count: g.items.length,
              deadline: g.deliveryDeadline ?? 0,
            }
          : null,
      review: room.state === "review" && g.deliveringTeam ? this.reviewPublic(room) : null,
      lastResult: g.lastResult,
      winnerTeam: g.winnerTeam,
    };
  }

  protected clearGameTimers(room: BidBattleRoom): void {
    const g = room.game;
    for (const key of [
      "categoryTimer",
      "preBidTimer",
      "bidTimer",
      "deliveryTimer",
      "reviewTimer",
      "resultTimer",
    ] as const) {
      if (g[key]) clearTimeout(g[key]!);
      g[key] = null;
    }
  }

  protected resetGame(room: BidBattleRoom): void {
    this.clearGameTimers(room);
    room.game = freshGame();
  }

  protected rejoinExtra(room: BidBattleRoom, player: BidBattlePlayer): Record<string, unknown> {
    const g = room.game;
    return {
      yourVote: g.votes.get(player.id) ?? null,
      yourSuggestions: g.suggestionCounts.get(player.id) ?? 0,
      deliveryItems: room.state === "delivery" ? g.items : null,
    };
  }

  protected onPlayerRemoved(room: BidBattleRoom, player: BidBattlePlayer): void {
    room.game.votes.delete(player.id);
    // Leaving mid-match forfeits it for the leaver's team.
    if (
      room.state !== "lobby" &&
      room.state !== "finished" &&
      player.team &&
      room.players.size > 0
    ) {
      this.finishGame(
        room,
        otherTeam(player.team),
        `${player.name} left — team ${player.team} forfeits`,
      );
    }
  }

  protected onDisconnectDuringGame(room: BidBattleRoom): void {
    // Disconnects never forfeit; timers keep the match moving. Just recheck
    // the "everyone voted" fast path.
    this.maybeResolveBallotEarly(room);
  }

  // ---------- teams & lobby ----------

  private teamRoom(room: BidBattleRoom, team: TeamId): string {
    return `${room.code}#${team}`;
  }

  private teamMembers(room: BidBattleRoom, team: TeamId): BidBattlePlayer[] {
    return [...room.players.values()].filter((p) => p.team === team);
  }

  private moveToTeam(room: BidBattleRoom, player: BidBattlePlayer, team: TeamId | null): void {
    const sock = player.socketId ? this.bnsp.sockets.get(player.socketId) : null;
    if (player.team && sock) sock.leave(this.teamRoom(room, player.team));
    player.team = team;
    if (team && sock) sock.join(this.teamRoom(room, team));
  }

  private broadcastTeams(room: BidBattleRoom): void {
    this.bnsp.to(room.code).emit("teamsUpdate", {
      players: [...room.players.values()].map((p) => this.publicPlayer(room, p)),
    });
    this.broadcastRoom(room);
  }

  private setMode(socket: AnySocket, payload: { mode: BidBattleMode }): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "lobby") return;
    const { room, player } = ctx;
    if (player.id !== room.hostId) {
      this.emitError(socket, "Only the host can change the mode.");
      return;
    }
    const mode: BidBattleMode = payload?.mode === "2v2" ? "2v2" : "1v1";
    if (mode === room.settings.mode) return;
    if (room.players.size > bidBattleModeSize(mode)) {
      this.emitError(socket, `Too many players in the room for ${mode}.`);
      return;
    }
    room.settings = { ...room.settings, mode };
    // Re-balance everyone across the new team sizes in join order.
    let i = 0;
    for (const p of room.players.values()) {
      this.moveToTeam(room, p, i % 2 === 0 ? "A" : "B");
      i++;
    }
    this.updateLobbyCountdown(room);
    this.broadcastTeams(room);
  }

  private assignTeam(socket: AnySocket, payload: { team: TeamId }): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "lobby") return;
    const { room, player } = ctx;
    const team: TeamId | null = payload?.team === "A" ? "A" : payload?.team === "B" ? "B" : null;
    if (!team || team === player.team) return;
    const half = bidBattleModeSize(room.settings.mode) / 2;
    if (this.teamMembers(room, team).length >= half) {
      this.emitError(socket, `Team ${team} is full.`);
      return;
    }
    this.moveToTeam(room, player, team);
    this.broadcastTeams(room);
  }

  // ---------- match lifecycle ----------

  protected beginGame(room: BidBattleRoom): void {
    // Fill any unassigned seats, keeping teams balanced (quick play path).
    const half = bidBattleModeSize(room.settings.mode) / 2;
    for (const p of room.players.values()) {
      if (!p.team) {
        const target: TeamId = this.teamMembers(room, "A").length < half ? "A" : "B";
        this.moveToTeam(room, p, target);
      }
    }
    room.state = "category";
    room.game = freshGame();
    room.game.openerTeam = Math.random() < 0.5 ? "A" : "B";
    this.startRound(room);
  }

  private startRound(room: BidBattleRoom): void {
    if (room.state === "finished" || !this.store.has(room.code)) return;
    const g = room.game;
    g.round += 1;
    g.category = null;
    g.categorySource = null;
    g.ballotOptions = [];
    g.nextOptionId = 1;
    g.suggestionCounts.clear();
    g.votes.clear();
    g.turnTeam = null;
    g.currentBid = 0;
    g.lastBidTeam = null;
    g.bidHistory = [];
    g.openingPassed = false;
    g.deliveringTeam = null;
    g.target = 0;
    g.items = [];
    g.statuses = [];
    room.state = "category";

    if (room.isPublic) {
      // Quick play: set categories only — auto-draw from the curated deck.
      this.chooseCategory(room, this.drawRandomCategory(room), "random");
    } else {
      g.ballotOptions = [{ id: RANDOM_OPTION_ID, kind: "random", label: "🎲 Random category" }];
      g.categoryDeadline = Date.now() + room.settings.categorySec * 1000;
      this.broadcastRoom(room);
      this.bnsp.to(room.code).emit("categoryBallot", this.ballotPublic(room));
      g.categoryTimer = setTimeout(() => {
        g.categoryTimer = null;
        this.resolveBallot(room);
      }, room.settings.categorySec * 1000);
    }
  }

  // ---------- category phase ----------

  private ballotPublic(room: BidBattleRoom): BallotPublic {
    const tally: Record<number, number> = {};
    for (const optionId of room.game.votes.values()) {
      tally[optionId] = (tally[optionId] ?? 0) + 1;
    }
    return {
      options: room.game.ballotOptions,
      tally,
      deadline: room.game.categoryDeadline ?? 0,
    };
  }

  private drawRandomCategory(room: BidBattleRoom): string {
    const g = room.game;
    let pool = CATEGORY_DECK.filter((c) => !g.usedCategories.has(c));
    if (pool.length === 0) {
      g.usedCategories.clear();
      pool = [...CATEGORY_DECK];
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private submitSuggestion(
    socket: AnySocket,
    payload: { text: string },
    ack: Ack<{ optionId: number }>,
  ): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    const g = room.game;
    if (room.isPublic) {
      return ack({ ok: false, error: "Quick play uses random categories only." });
    }
    if (room.state !== "category" || g.category) {
      return ack({ ok: false, error: "The ballot is closed." });
    }
    const text = String(payload?.text ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (text.length < 3) return ack({ ok: false, error: "Category is too short." });
    const mine = g.suggestionCounts.get(player.id) ?? 0;
    if (mine >= MAX_CUSTOM_PER_PLAYER) {
      return ack({ ok: false, error: `Max ${MAX_CUSTOM_PER_PLAYER} suggestions per player.` });
    }
    const customs = g.ballotOptions.filter((o) => o.kind === "custom");
    if (customs.length >= MAX_CUSTOM_TOTAL) {
      return ack({ ok: false, error: "The ballot is full." });
    }
    const normalized = normalizeWord(text);
    if (customs.some((o) => normalizeWord(o.label) === normalized)) {
      return ack({ ok: false, error: "That category is already on the ballot." });
    }
    const option: BallotOption = {
      id: g.nextOptionId++,
      kind: "custom",
      label: text,
      suggestedBy: player.name,
    };
    g.ballotOptions.push(option);
    g.suggestionCounts.set(player.id, mine + 1);
    ack({ ok: true, data: { optionId: option.id } });
    this.bnsp.to(room.code).emit("categoryBallot", this.ballotPublic(room));
  }

  private voteCategory(socket: AnySocket, payload: { optionId: number }): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const g = room.game;
    if (room.isPublic || room.state !== "category" || g.category) return;
    const optionId = Number(payload?.optionId);
    if (!g.ballotOptions.some((o) => o.id === optionId)) return;
    g.votes.set(player.id, optionId); // one vote each; changeable until resolve
    this.bnsp.to(room.code).emit("categoryBallot", this.ballotPublic(room));
    this.broadcastRoom(room);
    this.maybeResolveBallotEarly(room);
  }

  private maybeResolveBallotEarly(room: BidBattleRoom): void {
    if (room.state !== "category" || room.isPublic || room.game.category) return;
    const connected = [...room.players.values()].filter((p) => p.connected);
    if (connected.length === 0) return;
    if (connected.every((p) => room.game.votes.has(p.id))) {
      this.resolveBallot(room);
    }
  }

  /**
   * A custom category wins ONLY if it reaches the approval threshold
   * (unanimous in 1v1, 3 votes in 2v2); everything else falls back to Random.
   */
  private resolveBallot(room: BidBattleRoom): void {
    const g = room.game;
    if (room.state !== "category" || g.category) return;
    if (g.categoryTimer) {
      clearTimeout(g.categoryTimer);
      g.categoryTimer = null;
    }
    const tally = this.ballotPublic(room).tally;
    const threshold = customApprovalThreshold(room.settings.mode);
    const approved = g.ballotOptions.filter(
      (o) => o.kind === "custom" && (tally[o.id] ?? 0) >= threshold,
    );
    if (approved.length > 0) {
      const top = Math.max(...approved.map((o) => tally[o.id] ?? 0));
      const leaders = approved.filter((o) => (tally[o.id] ?? 0) === top);
      const winner = leaders[Math.floor(Math.random() * leaders.length)];
      this.chooseCategory(room, winner.label, "custom");
    } else {
      this.chooseCategory(room, this.drawRandomCategory(room), "random");
    }
  }

  private chooseCategory(
    room: BidBattleRoom,
    category: string,
    source: "custom" | "random",
  ): void {
    const g = room.game;
    g.category = category;
    g.categorySource = source;
    g.categoryDeadline = null;
    g.usedCategories.add(category);
    this.bnsp.to(room.code).emit("categoryReveal", { category, source });
    this.broadcastRoom(room);
    // Short pause so everyone reads the category before the bid clock starts.
    g.preBidTimer = setTimeout(() => {
      g.preBidTimer = null;
      this.startBidding(room);
    }, PRE_BID_PAUSE_MS);
  }

  // ---------- bidding phase ----------

  private biddingPublic(room: BidBattleRoom): BiddingPublic {
    const g = room.game;
    return {
      currentBid: g.currentBid,
      lastBidTeam: g.lastBidTeam,
      turnTeam: g.turnTeam!,
      deadline: g.bidDeadline ?? 0,
      history: g.bidHistory,
      openingPassed: g.openingPassed,
    };
  }

  private startBidding(room: BidBattleRoom): void {
    if (room.state !== "category" || !this.store.has(room.code)) return;
    const g = room.game;
    room.state = "bidding";
    g.turnTeam = g.openerTeam ?? "A";
    g.currentBid = 0;
    g.lastBidTeam = null;
    g.bidHistory = [];
    g.openingPassed = false;
    this.armBidTimer(room);
    this.broadcastRoom(room);
    this.bnsp.to(room.code).emit("bidUpdate", this.biddingPublic(room));
  }

  private armBidTimer(room: BidBattleRoom): void {
    const g = room.game;
    if (g.bidTimer) clearTimeout(g.bidTimer);
    g.bidDeadline = Date.now() + room.settings.bidTurnSec * 1000;
    g.bidTimer = setTimeout(() => {
      g.bidTimer = null;
      this.bidTimeout(room);
    }, room.settings.bidTurnSec * 1000);
  }

  private raiseBid(
    socket: AnySocket,
    payload: { amount: number },
    ack: Ack<{ amount: number }>,
  ): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    const g = room.game;
    if (room.state !== "bidding") return ack({ ok: false, error: "Bidding has ended." });
    if (!player.team || player.team !== g.turnTeam) {
      return ack({ ok: false, error: "It is not your team's turn." });
    }
    const amount = Math.floor(Number(payload?.amount));
    if (!Number.isFinite(amount) || amount < 1 || amount > MAX_BID) {
      return ack({ ok: false, error: `Bid must be between 1 and ${MAX_BID}.` });
    }
    if (amount <= g.currentBid) {
      return ack({ ok: false, error: `Bid must be higher than ${g.currentBid}.` });
    }
    g.currentBid = amount;
    g.lastBidTeam = player.team;
    g.bidHistory.push({ team: player.team, amount });
    g.turnTeam = otherTeam(player.team);
    this.armBidTimer(room);
    ack({ ok: true, data: { amount } });
    this.bnsp.to(room.code).emit("bidUpdate", this.biddingPublic(room));
  }

  /** Decline to raise: the last (highest) bidder must now deliver their number. */
  private challengeBid(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const g = room.game;
    if (room.state !== "bidding") return;
    if (!player.team || player.team !== g.turnTeam) {
      this.emitError(socket, "It is not your team's turn.");
      return;
    }
    if (g.currentBid < 1 || !g.lastBidTeam) {
      this.emitError(socket, "There is no bid to challenge yet — you must open.");
      return;
    }
    this.endBidding(room);
  }

  /** Timeout is EXACTLY a decline-to-raise, except on an unopened auction. */
  private bidTimeout(room: BidBattleRoom): void {
    if (room.state !== "bidding") return;
    const g = room.game;
    if (g.currentBid >= 1 && g.lastBidTeam) {
      this.endBidding(room);
      return;
    }
    if (!g.openingPassed) {
      // Opener never bid: the opening passes to the other team.
      g.openingPassed = true;
      g.turnTeam = otherTeam(g.turnTeam!);
      this.armBidTimer(room);
      this.bnsp.to(room.code).emit("bidUpdate", this.biddingPublic(room));
      return;
    }
    // Both teams refused to open: no point, redraw the category.
    if (g.bidTimer) clearTimeout(g.bidTimer);
    g.bidTimer = null;
    this.bnsp
      .to(room.code)
      .emit("errorMsg", { message: "Nobody opened the bidding — redrawing the category." });
    this.startRound(room);
  }

  private endBidding(room: BidBattleRoom): void {
    const g = room.game;
    if (room.state !== "bidding" || !g.lastBidTeam) return;
    if (g.bidTimer) clearTimeout(g.bidTimer);
    g.bidTimer = null;
    g.bidDeadline = null;
    g.deliveringTeam = g.lastBidTeam;
    g.target = g.currentBid;
    g.items = [];
    g.deliveryDeadline = Date.now() + room.settings.deliverySec * 1000;
    room.state = "delivery";
    this.bnsp
      .to(room.code)
      .emit("biddingEnded", { deliveringTeam: g.deliveringTeam, target: g.target });
    this.broadcastRoom(room);
    g.deliveryTimer = setTimeout(() => {
      g.deliveryTimer = null;
      this.endDelivery(room);
    }, room.settings.deliverySec * 1000);
  }

  // ---------- delivery phase ----------

  private submitItem(
    socket: AnySocket,
    payload: { text: string },
    ack: Ack<{ count: number }>,
  ): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    const g = room.game;
    if (room.state !== "delivery") return ack({ ok: false, error: "The sprint is over." });
    if (!player.team || player.team !== g.deliveringTeam) {
      return ack({ ok: false, error: "Only the delivering team can name items." });
    }
    const raw = String(payload?.text ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    const normalized = normalizeWord(raw);
    if (!normalized) return ack({ ok: false, error: "Enter an item first." });
    if (g.items.some((i) => i.normalized === normalized)) {
      return ack({ ok: false, error: `"${normalized}" already said — doesn't count.` });
    }
    g.items.push({ raw, normalized });
    ack({ ok: true, data: { count: g.items.length } });
    // Both teams watch the list grow live — the waiting team sees every item too.
    this.bnsp
      .to(room.code)
      .emit("itemAccepted", { raw, normalized, count: g.items.length });
    this.bnsp.to(room.code).emit("deliveryCount", { count: g.items.length });
  }

  private finishDelivery(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== "delivery" || player.team !== room.game.deliveringTeam) return;
    this.endDelivery(room);
  }

  private endDelivery(room: BidBattleRoom): void {
    const g = room.game;
    if (room.state !== "delivery" || !g.deliveringTeam) return;
    if (g.deliveryTimer) clearTimeout(g.deliveryTimer);
    g.deliveryTimer = null;
    g.deliveryDeadline = null;
    g.statuses = g.items.map(() => "ok" as const);
    g.reviewDeadline = Date.now() + room.settings.reviewSec * 1000;
    room.state = "review";
    this.bnsp.to(room.code).emit("deliveryEnded");
    this.bnsp.to(room.code).emit("reviewStart", this.reviewPublic(room));
    this.broadcastRoom(room);
    if (g.items.length === 0) {
      // Nothing to review — the challenge succeeds immediately.
      this.resolveReview(room);
      return;
    }
    g.reviewTimer = setTimeout(() => {
      g.reviewTimer = null;
      this.resolveReview(room);
    }, room.settings.reviewSec * 1000);
  }

  // ---------- review phase ----------

  private reviewPublic(room: BidBattleRoom): ReviewPublic {
    const g = room.game;
    return {
      deliveringTeam: g.deliveringTeam!,
      target: g.target,
      items: g.items.map((item, i) => ({ ...item, status: g.statuses[i] })),
      deadline: g.reviewDeadline ?? 0,
    };
  }

  private emitFlags(room: BidBattleRoom): void {
    this.bnsp.to(room.code).emit("flagUpdate", { statuses: room.game.statuses });
  }

  private reviewCtx(
    socket: AnySocket,
    side: "delivering" | "opposing",
  ): { room: BidBattleRoom; player: BidBattlePlayer } | null {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "review") return null;
    const { room, player } = ctx;
    const delivering = room.game.deliveringTeam;
    if (!player.team || !delivering) return null;
    const isDelivering = player.team === delivering;
    if ((side === "delivering") !== isDelivering) return null;
    return ctx;
  }

  private flagItem(socket: AnySocket, payload: { index: number }): void {
    const ctx = this.reviewCtx(socket, "opposing");
    if (!ctx) return;
    const g = ctx.room.game;
    const i = Number(payload?.index);
    if (!Number.isInteger(i) || i < 0 || i >= g.statuses.length) return;
    if (g.statuses[i] !== "ok") return;
    g.statuses[i] = "flagged";
    this.emitFlags(ctx.room);
    this.maybeResolveReviewEarly(ctx.room);
  }

  private respondToFlag(
    socket: AnySocket,
    payload: { index: number; action: "concede" | "defend" },
  ): void {
    const ctx = this.reviewCtx(socket, "delivering");
    if (!ctx) return;
    const g = ctx.room.game;
    const action = payload?.action === "defend" ? "defend" : "concede";
    const i = Number(payload?.index);
    if (i === -1 && action === "concede") {
      // "Concede all" shortcut.
      g.statuses = g.statuses.map((s) => (s === "flagged" ? "conceded" : s));
    } else {
      if (!Number.isInteger(i) || i < 0 || i >= g.statuses.length) return;
      if (g.statuses[i] !== "flagged") return;
      g.statuses[i] = action === "defend" ? "defended" : "conceded";
    }
    this.emitFlags(ctx.room);
    this.maybeResolveReviewEarly(ctx.room);
  }

  private finalizeFlag(
    socket: AnySocket,
    payload: { index: number; action: "accept" | "uphold" },
  ): void {
    const ctx = this.reviewCtx(socket, "opposing");
    if (!ctx) return;
    const g = ctx.room.game;
    const i = Number(payload?.index);
    if (!Number.isInteger(i) || i < 0 || i >= g.statuses.length) return;
    if (g.statuses[i] !== "defended") return;
    g.statuses[i] = payload?.action === "accept" ? "accepted" : "upheld";
    this.emitFlags(ctx.room);
    this.maybeResolveReviewEarly(ctx.room);
  }

  /** End early only when every single item has reached a terminal state. */
  private maybeResolveReviewEarly(room: BidBattleRoom): void {
    if (room.state !== "review") return;
    const terminal = new Set(["conceded", "accepted", "upheld"]);
    if (room.game.statuses.length > 0 && room.game.statuses.every((s) => terminal.has(s))) {
      this.resolveReview(room);
    }
  }

  /**
   * Timeout defaults: unflagged items count; flagged items nobody defended are
   * dropped (burden on the namer); defended items with no final call count.
   */
  private resolveReview(room: BidBattleRoom): void {
    const g = room.game;
    if (room.state !== "review" || !g.deliveringTeam) return;
    if (g.reviewTimer) clearTimeout(g.reviewTimer);
    g.reviewTimer = null;
    g.reviewDeadline = null;

    const counts = new Set(["ok", "defended", "accepted"]);
    const validCount = g.statuses.filter((s) => counts.has(s)).length;
    const winnerTeam =
      validCount >= g.target ? g.deliveringTeam : otherTeam(g.deliveringTeam);
    g.scores[winnerTeam] += 1;
    g.openerTeam = otherTeam(winnerTeam); // the loser of the point opens next
    const result: RoundResult = {
      round: g.round,
      category: g.category ?? "?",
      deliveringTeam: g.deliveringTeam,
      target: g.target,
      validCount,
      winnerTeam,
      scores: { ...g.scores },
    };
    g.lastResult = result;
    this.bnsp.to(room.code).emit("roundResult", result);
    this.broadcastRoom(room);

    if (g.scores[winnerTeam] >= room.settings.targetPoints) {
      this.finishGame(room, winnerTeam);
      return;
    }
    g.resultTimer = setTimeout(() => {
      g.resultTimer = null;
      this.startRound(room);
    }, RESULT_PAUSE_MS);
  }

  private finishGame(room: BidBattleRoom, winnerTeam: TeamId, reason?: string): void {
    if (room.state === "finished") return;
    room.state = "finished";
    room.gameOverReason = reason ?? null;
    room.game.winnerTeam = winnerTeam;
    this.clearGameTimers(room);
    const participants = [...room.players.values()].map((p) => ({ id: p.id, name: p.name }));
    const winnerIds = this.teamMembers(room, winnerTeam).map((p) => p.id);
    if (participants.length > 0) this.stats.recordGame(participants, winnerIds);
    this.bnsp
      .to(room.code)
      .emit("gameOver", { winnerTeam, scores: { ...room.game.scores }, reason });
    this.broadcastRoom(room);
  }
}

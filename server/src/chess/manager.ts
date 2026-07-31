import { Chess } from "chess.js";
import type { Namespace } from "socket.io";
import type { Ack, SocketData } from "../../../shared/events.js";
import {
  CHESS_MAX_BASE_MINUTES,
  CHESS_MAX_INCREMENT_SECONDS,
  CHESS_MAX_PLAYERS,
  CHESS_MIN_PLAYERS,
  DEFAULT_CHESS_SETTINGS,
  colorFromShort,
  isUnlimited,
  otherChessColor,
  shortFromColor,
  type ChessClientEvents,
  type ChessClocks,
  type ChessColor,
  type ChessColorPref,
  type ChessEndReason,
  type ChessMoveInfo,
  type ChessPublicPlayer,
  type ChessResult,
  type ChessServerEvents,
  type ChessSettings,
  type ChessSnapshot,
  type ChessTimeControl,
} from "../../../shared/chess.js";
import type { RoomStore } from "../store.js";
import type { StatsStore } from "../stats.js";
import {
  BaseRoomManager,
  clamp,
  type AnySocket,
  type BasePlayer,
  type BaseRoom,
} from "../core/roomManager.js";

type ChessNamespace = Namespace<
  ChessClientEvents,
  ChessServerEvents,
  Record<string, never>,
  SocketData
>;

interface ChessPlayer extends BasePlayer {
  color: ChessColor | null;
}

interface ChessGameData {
  /** THE authoritative position. Clients never decide legality. */
  chess: Chess;
  moves: ChessMoveInfo[];
  lastMove: { from: string; to: string } | null;
  /** Remaining time banked at the last checkpoint (not live — see liveClocks). */
  whiteMs: number;
  blackMs: number;
  /** Server epoch ms when the side to move's clock started; null = not running. */
  turnStartedAt: number | null;
  drawOfferBy: ChessColor | null;
  result: ChessResult | null;
  endReason: ChessEndReason | null;
  /** Fires exactly when the side to move runs out of time. */
  flagTimer: NodeJS.Timeout | null;
  /** Periodic resync so long thinks / sleeping tabs can't drift the display. */
  clockSyncTimer: NodeJS.Timeout | null;
}

interface ChessRoom extends BaseRoom<ChessSettings, ChessPlayer> {
  game: ChessGameData;
}

const CLOCK_SYNC_MS = 5000;

/** Like the shared clamp() but WITHOUT rounding — see sanitizeSettings. */
function clampFloat(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function freshGame(): ChessGameData {
  return {
    chess: new Chess(),
    moves: [],
    lastMove: null,
    whiteMs: 0,
    blackMs: 0,
    turnStartedAt: null,
    drawOfferBy: null,
    result: null,
    endReason: null,
    flagTimer: null,
    clockSyncTimer: null,
  };
}

/**
 * Can `color` still deliver checkmate with the material on the board?
 *
 * Used ONLY for the flag rule: when a side runs out of time, FIDE 6.9 makes it
 * a draw rather than a loss if the opponent could not checkmate "by any
 * possible series of legal moves". So this asks about *possible* mate, not
 * *forced* mate: a bare king, K+B, or K+N cannot mate at all, but two knights
 * can (with cooperation), so KNN counts as sufficient and the flagging side
 * loses. chess.js's own isInsufficientMaterial() is about BOTH sides at once,
 * which is not the question being asked here.
 */
export function hasMatingMaterial(chess: Chess, color: ChessColor): boolean {
  const short = shortFromColor(color);
  let minors = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== short) continue;
      if (sq.type === "p" || sq.type === "r" || sq.type === "q") return true;
      if (sq.type === "b" || sq.type === "n") minors += 1;
    }
  }
  return minors >= 2;
}

export class ChessManager extends BaseRoomManager<ChessSettings, ChessPlayer, ChessRoom> {
  protected minPlayers = CHESS_MIN_PLAYERS;
  protected maxPlayers = CHESS_MAX_PLAYERS;

  constructor(
    private xnsp: ChessNamespace,
    store: RoomStore<ChessRoom>,
    private stats: StatsStore,
  ) {
    super(xnsp, store, "/chess/online");
    this.gameKey = "chess"; // the route has a subpath; the social key doesn't
  }

  // ---------- base hooks ----------

  protected bindGameEvents(socket: AnySocket): void {
    socket.on("setChessSettings", (p: Partial<ChessSettings>) => this.setSettings(socket, p));
    socket.on(
      "makeMove",
      (p: { from: string; to: string; promotion?: string }, ack: Ack<{ san: string }>) =>
        this.makeMove(socket, p, ack),
    );
    socket.on("resign", () => this.resign(socket));
    socket.on("offerDraw", () => this.offerDraw(socket));
    socket.on("respondDraw", (p: { accept: boolean }) => this.respondDraw(socket, p));
  }

  protected sanitizeSettings(partial?: Partial<ChessSettings>): ChessSettings {
    const tc = partial?.timeControl;
    const hostColor = partial?.hostColor;
    return {
      timeControl: {
        // NOT the shared clamp(): that rounds, and fractional minutes are
        // deliberately allowed so the test suite can flag a clock in seconds
        // instead of minutes. The UI only ever offers whole numbers.
        baseMinutes: clampFloat(
          Number(tc?.baseMinutes ?? DEFAULT_CHESS_SETTINGS.timeControl.baseMinutes) || 0,
          0,
          CHESS_MAX_BASE_MINUTES,
        ),
        incrementSeconds: clamp(
          Number(tc?.incrementSeconds ?? DEFAULT_CHESS_SETTINGS.timeControl.incrementSeconds) || 0,
          0,
          CHESS_MAX_INCREMENT_SECONDS,
        ),
      },
      hostColor:
        hostColor === "white" || hostColor === "black" || hostColor === "random"
          ? (hostColor as ChessColorPref)
          : DEFAULT_CHESS_SETTINGS.hostColor,
    };
  }

  protected makeRoom(base: BaseRoom<ChessSettings, ChessPlayer>): ChessRoom {
    return { ...base, game: freshGame() };
  }

  protected makePlayer(base: BasePlayer): ChessPlayer {
    return { ...base, color: null };
  }

  protected publicPlayer(_room: ChessRoom, p: ChessPlayer): ChessPublicPlayer {
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
      color: p.color,
    };
  }

  /** Quick Play only pairs players who asked for the SAME time control — a
   *  1+0 bullet player dropped into a 15+10 game is a bad match. */
  protected quickPlayEligible(room: ChessRoom, payload: unknown): boolean {
    const want = this.sanitizeSettings(
      (payload as { settings?: Partial<ChessSettings> })?.settings,
    ).timeControl;
    const have = room.settings.timeControl;
    return (
      want.baseMinutes === have.baseMinutes &&
      want.incrementSeconds === have.incrementSeconds
    );
  }

  protected quickPlayCreateSettings(payload: unknown): Partial<ChessSettings> | undefined {
    return (payload as { settings?: Partial<ChessSettings> })?.settings;
  }

  // ---------- clocks ----------

  private clockRunning(room: ChessRoom): boolean {
    return room.state === "playing" && !isUnlimited(room.settings.timeControl);
  }

  /** Live clocks: banked time minus whatever the mover has burned so far. */
  private liveClocks(room: ChessRoom): ChessClocks | null {
    if (isUnlimited(room.settings.timeControl)) return null;
    const g = room.game;
    const turn = colorFromShort(g.chess.turn());
    const running = this.clockRunning(room) && g.turnStartedAt !== null ? turn : null;
    const burned = running && g.turnStartedAt !== null ? Date.now() - g.turnStartedAt : 0;
    return {
      whiteMs: Math.max(0, g.whiteMs - (running === "white" ? burned : 0)),
      blackMs: Math.max(0, g.blackMs - (running === "black" ? burned : 0)),
      running,
    };
  }

  private clearClockTimers(room: ChessRoom): void {
    const g = room.game;
    if (g.flagTimer) clearTimeout(g.flagTimer);
    if (g.clockSyncTimer) clearInterval(g.clockSyncTimer);
    g.flagTimer = null;
    g.clockSyncTimer = null;
  }

  /** Arm the flag timer for the side to move, and keep clients in sync. */
  private armClocks(room: ChessRoom): void {
    this.clearClockTimers(room);
    if (!this.clockRunning(room)) return;
    const g = room.game;
    const mover = colorFromShort(g.chess.turn());
    const remaining = mover === "white" ? g.whiteMs : g.blackMs;
    g.flagTimer = setTimeout(() => {
      g.flagTimer = null;
      this.flag(room, mover);
    }, Math.max(0, remaining));
    g.clockSyncTimer = setInterval(() => {
      if (room.state !== "playing" || !this.store.has(room.code)) {
        this.clearClockTimers(room);
        return;
      }
      const clocks = this.liveClocks(room);
      if (clocks) this.xnsp.to(room.code).emit("clockUpdate", clocks);
    }, CLOCK_SYNC_MS);
  }

  /** Charge the mover for the time they just used. Returns false if they flagged. */
  private chargeMover(room: ChessRoom, mover: ChessColor): boolean {
    const g = room.game;
    if (!this.clockRunning(room) || g.turnStartedAt === null) return true;
    const burned = Date.now() - g.turnStartedAt;
    if (mover === "white") g.whiteMs = g.whiteMs - burned;
    else g.blackMs = g.blackMs - burned;
    const left = mover === "white" ? g.whiteMs : g.blackMs;
    if (left <= 0) {
      if (mover === "white") g.whiteMs = 0;
      else g.blackMs = 0;
      return false;
    }
    return true;
  }

  /**
   * A side ran out of time. Normally they lose — but if the OPPONENT cannot
   * possibly checkmate with the material they have, it is a draw instead.
   */
  private flag(room: ChessRoom, flagged: ChessColor): void {
    if (room.state !== "playing") return;
    const g = room.game;
    if (flagged === "white") g.whiteMs = 0;
    else g.blackMs = 0;
    g.turnStartedAt = null;
    const opponent = otherChessColor(flagged);
    if (!hasMatingMaterial(g.chess, opponent)) {
      this.finish(room, "draw", "insufficient");
      return;
    }
    this.finish(room, opponent, "timeout");
  }

  // ---------- snapshot ----------

  protected snapshot(room: ChessRoom): ChessSnapshot {
    const g = room.game;
    return {
      code: room.code,
      isPublic: room.isPublic,
      state: room.state as ChessSnapshot["state"],
      hostId: room.hostId,
      settings: room.settings,
      players: [...room.players.values()].map((p) => this.publicPlayer(room, p)),
      lobbyCountdownEndsAt: room.lobbyCountdownEndsAt,
      gameOverReason: room.gameOverReason,
      fen: g.chess.fen(),
      moves: g.moves,
      turn: colorFromShort(g.chess.turn()),
      lastMove: g.lastMove,
      inCheck: g.chess.isCheck(),
      clocks: this.liveClocks(room),
      drawOfferBy: g.drawOfferBy,
      result: g.result,
      endReason: g.endReason,
    };
  }

  protected clearGameTimers(room: ChessRoom): void {
    this.clearClockTimers(room);
  }

  protected resetGame(room: ChessRoom): void {
    this.clearGameTimers(room);
    room.game = freshGame();
    // Rematch convention: swap colours so each player gets White every other
    // game. beginGame keeps an existing valid assignment, so this sticks.
    const players = [...room.players.values()];
    if (players.length === 2 && players[0].color && players[1].color) {
      const first = players[0].color;
      players[0].color = players[1].color;
      players[1].color = first;
    }
  }

  protected rejoinExtra(_room: ChessRoom, player: ChessPlayer): Record<string, unknown> {
    // Chess hides nothing: the snapshot already carries the whole position,
    // move list, and live clocks. This is just a convenience echo.
    return { yourColor: player.color };
  }

  protected onPlayerRemoved(room: ChessRoom, player: ChessPlayer): void {
    if (room.state !== "playing") return;
    // Leaving mid-game hands the win to whoever is still sitting at the board.
    // (Disconnecting does NOT — their clock keeps running and they can rejoin.)
    const opponent = [...room.players.values()].find((p) => p.id !== player.id);
    if (opponent?.color) this.finish(room, opponent.color, "abandoned");
    else this.finish(room, "draw", "abandoned");
  }

  // ---------- lobby ----------

  private setSettings(socket: AnySocket, partial: Partial<ChessSettings>): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "lobby") return;
    if (ctx.player.id !== ctx.room.hostId) {
      this.emitError(socket, "Only the host can change the time control.");
      return;
    }
    ctx.room.settings = this.sanitizeSettings({ ...ctx.room.settings, ...partial });
    this.broadcastRoom(ctx.room);
  }

  private assignColors(room: ChessRoom): void {
    const players = [...room.players.values()];
    if (players.length !== 2) return;
    const existing = players.map((p) => p.color);
    // A rematch keeps (already swapped) colours; a fresh lobby assigns them.
    if (existing[0] && existing[1] && existing[0] !== existing[1]) return;
    const host = players.find((p) => p.id === room.hostId) ?? players[0];
    const guest = players.find((p) => p.id !== host.id)!;
    const pref = room.settings.hostColor;
    const hostColor: ChessColor =
      pref === "random" ? (Math.random() < 0.5 ? "white" : "black") : pref;
    host.color = hostColor;
    guest.color = otherChessColor(hostColor);
  }

  protected beginGame(room: ChessRoom): void {
    const g = (room.game = freshGame());
    this.assignColors(room);
    const tc: ChessTimeControl = room.settings.timeControl;
    if (!isUnlimited(tc)) {
      g.whiteMs = tc.baseMinutes * 60_000;
      g.blackMs = tc.baseMinutes * 60_000;
      g.turnStartedAt = Date.now();
    }
    room.state = "playing";
    const white = [...room.players.values()].find((p) => p.color === "white");
    const black = [...room.players.values()].find((p) => p.color === "black");
    this.xnsp.to(room.code).emit("gameStart", {
      fen: g.chess.fen(),
      colors: { white: white?.id ?? "", black: black?.id ?? "" },
      timeControl: tc,
      clocks: this.liveClocks(room),
    });
    this.armClocks(room);
    this.broadcastRoom(room);
  }

  // ---------- moves ----------

  private makeMove(
    socket: AnySocket,
    payload: { from: string; to: string; promotion?: string },
    ack: Ack<{ san: string }>,
  ): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    const g = room.game;
    if (room.state !== "playing") {
      return ack({ ok: false, error: "There is no game in progress." });
    }
    if (!player.color) return ack({ ok: false, error: "You are not playing this game." });
    const turn = colorFromShort(g.chess.turn());
    if (player.color !== turn) {
      return ack({ ok: false, error: "It is not your turn." });
    }

    // If their flag already fell while this packet was in flight, time wins.
    if (this.clockRunning(room) && g.turnStartedAt !== null) {
      const remaining = turn === "white" ? g.whiteMs : g.blackMs;
      if (Date.now() - g.turnStartedAt >= remaining) {
        ack({ ok: false, error: "Your time ran out." });
        this.flag(room, turn);
        return;
      }
    }

    // chess.js is the ONLY legality authority, and it THROWS on illegal input.
    let move;
    try {
      move = g.chess.move({
        from: String(payload?.from ?? ""),
        to: String(payload?.to ?? ""),
        promotion: payload?.promotion ? String(payload.promotion) : undefined,
      });
    } catch {
      socket.emit("illegalMove", { reason: "That move is not legal.", fen: g.chess.fen() });
      return ack({ ok: false, error: "That move is not legal." });
    }

    // Legal: charge the clock, then add the increment.
    this.chargeMover(room, turn);
    const tc = room.settings.timeControl;
    if (!isUnlimited(tc)) {
      const inc = tc.incrementSeconds * 1000;
      if (turn === "white") g.whiteMs += inc;
      else g.blackMs += inc;
      g.turnStartedAt = Date.now();
    }

    const info: ChessMoveInfo = {
      san: move.san,
      from: move.from,
      to: move.to,
      color: colorFromShort(move.color),
      captured: move.captured ?? null,
      promotion: move.promotion ?? null,
    };
    g.moves.push(info);
    g.lastMove = { from: move.from, to: move.to };
    // A move implicitly declines any outstanding offer from the mover's side.
    if (g.drawOfferBy === turn) g.drawOfferBy = null;

    ack({ ok: true, data: { san: move.san } });
    this.xnsp.to(room.code).emit("moveMade", {
      fen: g.chess.fen(),
      move: info,
      lastMove: g.lastMove,
      turn: colorFromShort(g.chess.turn()),
      inCheck: g.chess.isCheck(),
      clocks: this.liveClocks(room),
    });

    if (this.checkGameEnd(room, turn)) return;
    this.armClocks(room);
    this.broadcastRoom(room);
  }

  /** Auto-detect every terminal position chess.js knows about. */
  private checkGameEnd(room: ChessRoom, mover: ChessColor): boolean {
    const c = room.game.chess;
    if (c.isCheckmate()) {
      this.finish(room, mover, "checkmate");
      return true;
    }
    if (c.isStalemate()) {
      this.finish(room, "draw", "stalemate");
      return true;
    }
    if (c.isInsufficientMaterial()) {
      this.finish(room, "draw", "insufficient");
      return true;
    }
    if (c.isThreefoldRepetition()) {
      this.finish(room, "draw", "threefold");
      return true;
    }
    if (c.isDrawByFiftyMoves()) {
      this.finish(room, "draw", "fifty");
      return true;
    }
    if (c.isDraw()) {
      this.finish(room, "draw", "fifty");
      return true;
    }
    return false;
  }

  // ---------- resign & draws ----------

  private resign(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "playing") return;
    const { room, player } = ctx;
    if (!player.color) return;
    this.finish(room, otherChessColor(player.color), "resign");
  }

  private offerDraw(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "playing") return;
    const { room, player } = ctx;
    const g = room.game;
    if (!player.color) return;
    if (g.drawOfferBy === player.color) return; // already offered
    if (g.drawOfferBy && g.drawOfferBy !== player.color) {
      // Offering into an open offer is the same as accepting it.
      this.finish(room, "draw", "draw-agreed");
      return;
    }
    g.drawOfferBy = player.color;
    this.xnsp.to(room.code).emit("drawOffered", { by: player.color });
    this.broadcastRoom(room);
  }

  private respondDraw(socket: AnySocket, payload: { accept: boolean }): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "playing") return;
    const { room, player } = ctx;
    const g = room.game;
    if (!player.color || !g.drawOfferBy || g.drawOfferBy === player.color) return;
    if (payload?.accept) {
      this.finish(room, "draw", "draw-agreed");
      return;
    }
    const by = g.drawOfferBy;
    g.drawOfferBy = null;
    this.xnsp.to(room.code).emit("drawDeclined", { by });
    this.broadcastRoom(room);
  }

  // ---------- end ----------

  private finish(room: ChessRoom, result: ChessResult, reason: ChessEndReason): void {
    if (room.state === "finished") return;
    const g = room.game;
    room.state = "finished";
    g.result = result;
    g.endReason = reason;
    g.drawOfferBy = null;
    g.turnStartedAt = null;
    this.clearGameTimers(room);
    room.gameOverReason = reason;

    const participants = [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      userId: p.userId,
    }));
    if (participants.length > 0) {
      // A draw records a game for both players and a win for neither.
      const winnerIds =
        result === "draw"
          ? []
          : [...room.players.values()].filter((p) => p.color === result).map((p) => p.id);
      this.stats.recordGame(participants, winnerIds, "chess");
    }

    this.xnsp.to(room.code).emit("gameOver", {
      result,
      reason,
      fen: g.chess.fen(),
      clocks: this.liveClocks(room),
    });
    this.broadcastRoom(room);
  }
}

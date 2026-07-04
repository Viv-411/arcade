import { randomUUID } from "node:crypto";
import type { Namespace, Socket } from "socket.io";
import type {
  Ack,
  ClientToServerEvents,
  JoinResult,
  RejoinResult,
  ServerToClientEvents,
  SocketData,
} from "../../../shared/events.js";
import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type PublicPlayer,
  type RevealEntry,
  type RoomSettings,
  type RoomSnapshot,
  type RoomState,
  type RoundRecord,
} from "../../../shared/types.js";
import { normalizeWord } from "../../../shared/normalize.js";
import type { RoomStore } from "../store.js";
import type { StatsStore } from "../stats.js";

type MindMeldSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
type MindMeldNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

interface ServerPlayer {
  id: string;
  name: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  missedRounds: number;
  /** Pending removal after disconnecting from a lobby. */
  removalTimer: NodeJS.Timeout | null;
}

interface Submission {
  raw: string;
  normalized: string;
  locked: boolean;
}

interface GameData {
  roundNumber: number;
  usedWords: Set<string>;
  submissions: Map<string, Submission>;
  history: RoundRecord[];
  deadline: number | null;
  roundTimer: NodeJS.Timeout | null;
  revealTimer: NodeJS.Timeout | null;
  /** True from the moment a round starts resolving until the next roundStart. */
  resolving: boolean;
}

interface Room {
  code: string;
  isPublic: boolean;
  state: RoomState;
  hostId: string | null;
  settings: RoomSettings;
  players: Map<string, ServerPlayer>;
  game: GameData;
  createdAt: number;
  lobbyCountdownTimer: NodeJS.Timeout | null;
  lobbyCountdownEndsAt: number | null;
  emptyRoomTimer: NodeJS.Timeout | null;
  winner: { word: string; rounds: number } | null;
  gameOverReason: string | null;
}

// No I or O — too easy to confuse with 1 and 0 when sharing codes aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOBBY_DISCONNECT_REMOVE_MS = 30_000;
const EMPTY_ROOM_CLOSE_MS = 5 * 60_000;
const PUBLIC_AUTO_START_MS = 20_000;

function freshGame(): GameData {
  return {
    roundNumber: 0,
    usedWords: new Set(),
    submissions: new Map(),
    history: [],
    deadline: null,
    roundTimer: null,
    revealTimer: null,
    resolving: false,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function sanitizeSettings(partial: Partial<RoomSettings> | undefined): RoomSettings {
  const s = { ...DEFAULT_SETTINGS, ...partial };
  return {
    roundTimeSec: clamp(Number(s.roundTimeSec) || DEFAULT_SETTINGS.roundTimeSec, 10, 300),
    revealPauseSec: clamp(Number(s.revealPauseSec) || DEFAULT_SETTINGS.revealPauseSec, 1, 30),
    maxRounds: clamp(Number(s.maxRounds) ?? DEFAULT_SETTINGS.maxRounds, 0, 100),
    afkMissLimit: clamp(Number(s.afkMissLimit) || DEFAULT_SETTINGS.afkMissLimit, 1, 10),
    matchMode: s.matchMode === "loose" ? "loose" : "strict",
  };
}

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 20);
  return name.length > 0 ? name : null;
}

export class MindMeldManager {
  constructor(
    private nsp: MindMeldNamespace,
    private store: RoomStore<Room>,
    private stats: StatsStore,
  ) {
    nsp.on("connection", (socket) => this.bindSocket(socket));
  }

  private bindSocket(socket: MindMeldSocket): void {
    socket.on("createRoom", (payload, ack) => this.createRoom(socket, payload, ack));
    socket.on("joinRoom", (payload, ack) => this.joinRoom(socket, payload, ack));
    socket.on("quickPlay", (payload, ack) => this.quickPlay(socket, payload, ack));
    socket.on("rejoin", (payload, ack) => this.rejoin(socket, payload, ack));
    socket.on("toggleReady", () => this.toggleReady(socket));
    socket.on("startGame", () => this.startGame(socket));
    socket.on("lockIn", (payload, ack) => this.lockIn(socket, payload, ack));
    socket.on("unlock", () => this.unlock(socket));
    socket.on("leaveRoom", () => this.leaveRoom(socket));
    socket.on("playAgain", () => this.playAgain(socket));
    socket.on("disconnect", () => this.handleDisconnect(socket));
  }

  // ---------- helpers ----------

  private roomOf(socket: MindMeldSocket): { room: Room; player: ServerPlayer } | null {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return null;
    const room = this.store.get(roomCode);
    const player = room?.players.get(playerId);
    if (!room || !player) return null;
    return { room, player };
  }

  private publicPlayer(room: Room, p: ServerPlayer): PublicPlayer {
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
      missedRounds: p.missedRounds,
      lockedIn: room.game.submissions.get(p.id)?.locked ?? false,
    };
  }

  private snapshot(room: Room): RoomSnapshot {
    return {
      code: room.code,
      isPublic: room.isPublic,
      state: room.state,
      hostId: room.hostId,
      settings: room.settings,
      players: [...room.players.values()].map((p) => this.publicPlayer(room, p)),
      roundNumber: room.game.roundNumber,
      deadline: room.state === "playing" ? room.game.deadline : null,
      usedWords: [...room.game.usedWords],
      history: room.game.history,
      lobbyCountdownEndsAt: room.lobbyCountdownEndsAt,
      winner: room.winner,
      gameOverReason: room.gameOverReason,
    };
  }

  private broadcastRoom(room: Room): void {
    this.nsp.to(room.code).emit("roomUpdate", this.snapshot(room));
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      let code = "";
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.store.has(code)) return code;
    }
    throw new Error("could not allocate a room code");
  }

  private clearRoomTimers(room: Room): void {
    if (room.game.roundTimer) clearTimeout(room.game.roundTimer);
    if (room.game.revealTimer) clearTimeout(room.game.revealTimer);
    if (room.lobbyCountdownTimer) clearTimeout(room.lobbyCountdownTimer);
    if (room.emptyRoomTimer) clearTimeout(room.emptyRoomTimer);
    room.game.roundTimer = null;
    room.game.revealTimer = null;
    room.lobbyCountdownTimer = null;
    room.emptyRoomTimer = null;
    room.lobbyCountdownEndsAt = null;
    for (const p of room.players.values()) {
      if (p.removalTimer) clearTimeout(p.removalTimer);
      p.removalTimer = null;
    }
  }

  private closeRoom(room: Room): void {
    this.clearRoomTimers(room);
    this.store.delete(room.code);
  }

  private link(code: string): string {
    return `/mindmeld?room=${code}`;
  }

  private addPlayerToRoom(
    socket: MindMeldSocket,
    room: Room,
    name: string,
  ): ServerPlayer {
    const player: ServerPlayer = {
      id: randomUUID(),
      name,
      socketId: socket.id,
      connected: true,
      ready: false,
      missedRounds: 0,
      removalTimer: null,
    };
    room.players.set(player.id, player);
    if (!room.hostId) room.hostId = player.id;
    socket.data.playerId = player.id;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    this.cancelEmptyRoomTimer(room);
    socket.to(room.code).emit("playerJoined", { player: this.publicPlayer(room, player) });
    this.updateLobbyCountdown(room);
    this.broadcastRoom(room);
    return player;
  }

  private cancelEmptyRoomTimer(room: Room): void {
    if (room.emptyRoomTimer) {
      clearTimeout(room.emptyRoomTimer);
      room.emptyRoomTimer = null;
    }
  }

  /** If a socket is already bound to a room, detach it first (e.g. a second tab). */
  private detachFromCurrentRoom(socket: MindMeldSocket): void {
    if (socket.data.roomCode) this.leaveRoom(socket);
  }

  // ---------- lobby & matchmaking ----------

  private createRoom(
    socket: MindMeldSocket,
    payload: { name: string; isPublic: boolean; settings?: Partial<RoomSettings> },
    ack: Ack<JoinResult>,
  ): void {
    const name = sanitizeName(payload?.name);
    if (!name) return ack({ ok: false, error: "Please enter a name." });
    this.detachFromCurrentRoom(socket);
    const room: Room = {
      code: this.generateCode(),
      isPublic: Boolean(payload.isPublic),
      state: "lobby",
      hostId: null,
      settings: sanitizeSettings(payload.settings),
      players: new Map(),
      game: freshGame(),
      createdAt: Date.now(),
      lobbyCountdownTimer: null,
      lobbyCountdownEndsAt: null,
      emptyRoomTimer: null,
      winner: null,
      gameOverReason: null,
    };
    this.store.set(room.code, room);
    const player = this.addPlayerToRoom(socket, room, name);
    ack({
      ok: true,
      data: {
        playerId: player.id,
        code: room.code,
        link: this.link(room.code),
        room: this.snapshot(room),
      },
    });
  }

  private joinRoom(
    socket: MindMeldSocket,
    payload: { code: string; name: string },
    ack: Ack<JoinResult>,
  ): void {
    const name = sanitizeName(payload?.name);
    if (!name) return ack({ ok: false, error: "Please enter a name." });
    const code = String(payload?.code ?? "").trim().toUpperCase();
    const room = this.store.get(code);
    if (!room) return ack({ ok: false, error: `Room ${code || "?"} not found.` });
    if (room.state !== "lobby") {
      return ack({ ok: false, error: "That game has already started." });
    }
    if (room.players.size >= MAX_PLAYERS) {
      return ack({ ok: false, error: "That room is full (4 players max)." });
    }
    this.detachFromCurrentRoom(socket);
    const player = this.addPlayerToRoom(socket, room, name);
    ack({
      ok: true,
      data: {
        playerId: player.id,
        code: room.code,
        link: this.link(room.code),
        room: this.snapshot(room),
      },
    });
  }

  private quickPlay(
    socket: MindMeldSocket,
    payload: { name: string },
    ack: Ack<JoinResult>,
  ): void {
    const name = sanitizeName(payload?.name);
    if (!name) return ack({ ok: false, error: "Please enter a name." });
    let oldest: Room | null = null;
    for (const room of this.store.values()) {
      if (
        room.isPublic &&
        room.state === "lobby" &&
        room.players.size >= 1 &&
        room.players.size < MAX_PLAYERS &&
        (!oldest || room.createdAt < oldest.createdAt)
      ) {
        oldest = room;
      }
    }
    if (oldest) {
      return this.joinRoom(socket, { code: oldest.code, name }, ack);
    }
    this.createRoom(socket, { name, isPublic: true }, ack);
  }

  /**
   * Public-room auto-start: start immediately at 4 players; with 2-3 players
   * run a 20s countdown that resets whenever someone joins.
   */
  private updateLobbyCountdown(room: Room): void {
    if (!room.isPublic || room.state !== "lobby") return;
    if (room.lobbyCountdownTimer) {
      clearTimeout(room.lobbyCountdownTimer);
      room.lobbyCountdownTimer = null;
      room.lobbyCountdownEndsAt = null;
    }
    const connected = [...room.players.values()].filter((p) => p.connected);
    if (room.players.size >= MAX_PLAYERS) {
      this.beginGame(room);
      return;
    }
    if (connected.length >= MIN_PLAYERS) {
      room.lobbyCountdownEndsAt = Date.now() + PUBLIC_AUTO_START_MS;
      room.lobbyCountdownTimer = setTimeout(() => {
        room.lobbyCountdownTimer = null;
        room.lobbyCountdownEndsAt = null;
        if (room.state === "lobby" && room.players.size >= MIN_PLAYERS) {
          this.beginGame(room);
        } else {
          this.broadcastRoom(room);
        }
      }, PUBLIC_AUTO_START_MS);
    }
  }

  private toggleReady(socket: MindMeldSocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "lobby") return;
    ctx.player.ready = !ctx.player.ready;
    this.broadcastRoom(ctx.room);
  }

  private startGame(socket: MindMeldSocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== "lobby") {
      socket.emit("errorMsg", { message: "The game has already started." });
      return;
    }
    if (player.id !== room.hostId) {
      socket.emit("errorMsg", { message: "Only the host can start the game." });
      return;
    }
    if (room.players.size < MIN_PLAYERS || room.players.size > MAX_PLAYERS) {
      socket.emit("errorMsg", { message: "Mind Meld needs 2-4 players." });
      return;
    }
    if (![...room.players.values()].every((p) => p.ready)) {
      socket.emit("errorMsg", { message: "Everyone must be ready first." });
      return;
    }
    this.beginGame(room);
  }

  private beginGame(room: Room): void {
    if (room.state !== "lobby") return;
    if (room.lobbyCountdownTimer) clearTimeout(room.lobbyCountdownTimer);
    room.lobbyCountdownTimer = null;
    room.lobbyCountdownEndsAt = null;
    room.state = "playing";
    room.winner = null;
    room.gameOverReason = null;
    room.game = freshGame();
    room.game.roundNumber = 1;
    for (const p of room.players.values()) p.missedRounds = 0;
    this.broadcastRoom(room);
    this.startRound(room);
  }

  // ---------- round state machine ----------

  private startRound(room: Room): void {
    if (room.state !== "playing") return;
    const game = room.game;
    game.submissions.clear();
    game.resolving = false;
    game.deadline = Date.now() + room.settings.roundTimeSec * 1000;
    this.nsp.to(room.code).emit("roundStart", {
      roundNumber: game.roundNumber,
      usedWords: [...game.usedWords],
      deadline: game.deadline,
    });
    game.roundTimer = setTimeout(() => {
      game.roundTimer = null;
      this.resolveRound(room);
    }, room.settings.roundTimeSec * 1000);
  }

  private lockIn(
    socket: MindMeldSocket,
    payload: { word: string },
    ack: Ack<{ normalized: string }>,
  ): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    if (room.state !== "playing" || room.game.resolving) {
      return ack({ ok: false, error: "There is no round to lock into right now." });
    }
    const raw = String(payload?.word ?? "");
    const normalized = normalizeWord(raw, room.settings.matchMode);
    if (!normalized) return ack({ ok: false, error: "Enter a word first." });
    if (room.game.usedWords.has(normalized)) {
      return ack({ ok: false, error: `"${normalized}" was already said — try another.` });
    }
    // Re-locking just replaces the submission, which makes double clicks harmless.
    room.game.submissions.set(player.id, { raw: raw.trim(), normalized, locked: true });
    ack({ ok: true, data: { normalized } });
    this.nsp.to(room.code).emit("playerLockedIn", { playerId: player.id, locked: true });
    this.maybeResolveEarly(room);
  }

  private unlock(socket: MindMeldSocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== "playing" || room.game.resolving) {
      socket.emit("errorMsg", { message: "The round has already been resolved." });
      return;
    }
    if (!room.game.submissions.get(player.id)?.locked) return;
    room.game.submissions.delete(player.id);
    this.nsp.to(room.code).emit("playerLockedIn", { playerId: player.id, locked: false });
  }

  /** Fast path: if every connected player has locked in, resolve immediately. */
  private maybeResolveEarly(room: Room): void {
    if (room.state !== "playing" || room.game.resolving) return;
    const connected = [...room.players.values()].filter((p) => p.connected);
    if (connected.length === 0) return;
    if (connected.every((p) => room.game.submissions.get(p.id)?.locked)) {
      this.resolveRound(room);
    }
  }

  private resolveRound(room: Room): void {
    if (room.state !== "playing" || room.game.resolving) return;
    const game = room.game;
    game.resolving = true;
    if (game.roundTimer) {
      clearTimeout(game.roundTimer);
      game.roundTimer = null;
    }
    game.deadline = null;

    // Collect locked submissions; track AFK strikes.
    const entries: RevealEntry[] = [];
    const removed: ServerPlayer[] = [];
    for (const p of room.players.values()) {
      const sub = game.submissions.get(p.id);
      if (sub?.locked) {
        p.missedRounds = 0;
        entries.push({ playerId: p.id, name: p.name, word: sub.raw, normalized: sub.normalized });
        game.usedWords.add(sub.normalized);
      } else {
        p.missedRounds += 1;
        if (p.missedRounds >= room.settings.afkMissLimit) removed.push(p);
      }
    }

    for (const p of removed) {
      this.removePlayer(room, p, "afk");
    }

    game.history.push({ round: game.roundNumber, entries });

    // Players who submitted always survive AFK removal (their counter reset),
    // so a win means every remaining player submitted the same word.
    const isWin =
      room.players.size >= MIN_PLAYERS &&
      entries.length === room.players.size &&
      entries.every((e) => e.normalized === entries[0].normalized);

    this.nsp.to(room.code).emit("roundReveal", {
      round: game.roundNumber,
      entries,
      usedWords: [...game.usedWords],
      isWin,
    });

    if (isWin) {
      room.state = "finished";
      room.winner = { word: entries[0].normalized, rounds: game.roundNumber };
      const participants = [...room.players.values()].map((p) => ({ id: p.id, name: p.name }));
      this.stats.recordGame(participants, participants.map((p) => p.id));
      this.nsp.to(room.code).emit("gameWin", {
        word: room.winner.word,
        rounds: room.winner.rounds,
        players: [...room.players.values()].map((p) => ({
          ...this.publicPlayer(room, p),
          wins: this.stats.getWins(p.id),
        })),
      });
      this.broadcastRoom(room);
      return;
    }

    if (room.settings.maxRounds > 0 && game.roundNumber >= room.settings.maxRounds) {
      return this.endGame(room, "round limit");
    }
    if (room.players.size < MIN_PLAYERS) {
      return this.endGame(room, "not enough players");
    }

    // Reveal pause with a per-second countdown, then next round.
    let secondsLeft = room.settings.revealPauseSec;
    this.nsp.to(room.code).emit("revealCountdown", { secondsLeft });
    const tick = () => {
      secondsLeft -= 1;
      if (room.state !== "playing") return;
      if (secondsLeft > 0) {
        this.nsp.to(room.code).emit("revealCountdown", { secondsLeft });
        game.revealTimer = setTimeout(tick, 1000);
      } else {
        game.revealTimer = null;
        game.roundNumber += 1;
        this.startRound(room);
      }
    };
    game.revealTimer = setTimeout(tick, 1000);
  }

  private endGame(room: Room, reason: string): void {
    if (room.state === "finished") return;
    room.state = "finished";
    room.gameOverReason = reason;
    if (room.game.roundTimer) clearTimeout(room.game.roundTimer);
    if (room.game.revealTimer) clearTimeout(room.game.revealTimer);
    room.game.roundTimer = null;
    room.game.revealTimer = null;
    room.game.deadline = null;
    const participants = [...room.players.values()].map((p) => ({ id: p.id, name: p.name }));
    if (participants.length > 0) this.stats.recordGame(participants, []);
    this.nsp.to(room.code).emit("gameOver", { reason });
    this.broadcastRoom(room);
  }

  // ---------- membership ----------

  /** Remove a player from the room and handle host reassignment / room close. */
  private removePlayer(room: Room, player: ServerPlayer, reason: "left" | "afk" | "removed"): void {
    if (player.removalTimer) clearTimeout(player.removalTimer);
    player.removalTimer = null;
    room.players.delete(player.id);
    room.game.submissions.delete(player.id);
    this.nsp.to(room.code).emit("playerLeft", { playerId: player.id, name: player.name, reason });

    // Detach their socket, if any, and tell them why they were removed.
    if (player.socketId) {
      const sock = this.nsp.sockets.get(player.socketId);
      if (sock) {
        sock.leave(room.code);
        sock.data.roomCode = undefined;
        sock.data.playerId = undefined;
        if (reason === "afk") {
          sock.emit("errorMsg", {
            message: "You were removed for missing too many rounds.",
          });
        }
      }
    }

    if (room.players.size === 0) {
      this.closeRoom(room);
      return;
    }
    if (room.hostId === player.id) {
      const next =
        [...room.players.values()].find((p) => p.connected) ??
        [...room.players.values()][0];
      room.hostId = next.id;
    }
    this.broadcastRoom(room);
  }

  private leaveRoom(socket: MindMeldSocket): void {
    const ctx = this.roomOf(socket);
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    if (!ctx) return;
    const { room, player } = ctx;
    socket.leave(room.code);
    player.socketId = null;
    this.removePlayer(room, player, "left");
    if (!this.store.has(room.code)) return; // room was closed
    if (room.state === "playing") {
      if (room.players.size < MIN_PLAYERS) {
        this.endGame(room, "not enough players");
      } else {
        this.maybeResolveEarly(room);
      }
    } else if (room.state === "lobby") {
      this.updateLobbyCountdown(room);
      this.broadcastRoom(room);
    }
  }

  private handleDisconnect(socket: MindMeldSocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    // Only react if this socket is still the player's active binding
    // (a rejoin from a new tab may have already superseded it).
    if (player.socketId !== socket.id) return;
    player.socketId = null;
    player.connected = false;

    if (room.state === "lobby") {
      // Grace period so a refresh doesn't kick you out of the lobby.
      player.removalTimer = setTimeout(() => {
        player.removalTimer = null;
        if (!player.connected && this.store.has(room.code)) {
          this.removePlayer(room, player, "left");
          if (this.store.has(room.code)) this.updateLobbyCountdown(room);
        }
      }, LOBBY_DISCONNECT_REMOVE_MS);
    }

    if ([...room.players.values()].every((p) => !p.connected)) {
      this.cancelEmptyRoomTimer(room);
      room.emptyRoomTimer = setTimeout(() => {
        room.emptyRoomTimer = null;
        if ([...room.players.values()].every((p) => !p.connected)) {
          this.closeRoom(room);
        }
      }, EMPTY_ROOM_CLOSE_MS);
    }

    this.broadcastRoom(room);
    if (room.state === "playing") this.maybeResolveEarly(room);
  }

  private rejoin(
    socket: MindMeldSocket,
    payload: { playerId: string; code: string },
    ack: Ack<RejoinResult>,
  ): void {
    const code = String(payload?.code ?? "").trim().toUpperCase();
    const room = this.store.get(code);
    const player = room?.players.get(String(payload?.playerId ?? ""));
    if (!room || !player) {
      return ack({ ok: false, error: "That game is no longer available." });
    }
    // If an older socket is still bound (e.g. a duplicate tab), supersede it.
    if (player.socketId && player.socketId !== socket.id) {
      const old = this.nsp.sockets.get(player.socketId);
      if (old) {
        old.data.roomCode = undefined;
        old.data.playerId = undefined;
        old.leave(room.code);
        old.emit("errorMsg", { message: "This session was opened in another tab." });
      }
    }
    if (player.removalTimer) {
      clearTimeout(player.removalTimer);
      player.removalTimer = null;
    }
    this.cancelEmptyRoomTimer(room);
    player.socketId = socket.id;
    player.connected = true;
    socket.data.playerId = player.id;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    const sub = room.game.submissions.get(player.id);
    ack({
      ok: true,
      data: {
        playerId: player.id,
        code: room.code,
        room: this.snapshot(room),
        yourWord: sub?.locked ? { raw: sub.raw, normalized: sub.normalized } : null,
      },
    });
    this.broadcastRoom(room);
  }

  private playAgain(socket: MindMeldSocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room } = ctx;
    if (room.state !== "finished") return;
    room.state = "lobby";
    room.winner = null;
    room.gameOverReason = null;
    room.game = freshGame();
    for (const p of room.players.values()) {
      p.ready = false;
      p.missedRounds = 0;
    }
    this.updateLobbyCountdown(room);
    this.broadcastRoom(room);
  }
}

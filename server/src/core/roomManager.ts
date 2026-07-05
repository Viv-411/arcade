import { randomUUID } from "node:crypto";
import type { Namespace, Socket } from "socket.io";
import type { SocketData } from "../../../shared/events.js";
import type { RoomStore } from "../store.js";

/**
 * Game-agnostic multiplayer room infrastructure shared by every game:
 * room creation with 4-letter codes, join by code, Quick Play matchmaking,
 * ready toggles, host start validation, public-room auto-start countdowns,
 * rejoin/reconnection with per-player identity, lobby disconnect grace
 * periods, host reassignment, empty-room garbage collection, and playAgain.
 *
 * Each game subclasses this with its own settings/room/snapshot types and
 * implements the abstract hooks for game-specific state and events. The
 * namespace is intentionally loosely typed here; subclasses keep their own
 * fully-typed namespace reference for game-specific emits.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AnySocket = Socket<any, any, any, SocketData>;
export type AnyNamespace = Namespace<any, any, any, SocketData>;

export interface BasePlayer {
  id: string;
  name: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  /** Pending removal after disconnecting from a lobby. */
  removalTimer: NodeJS.Timeout | null;
}

export interface BaseRoom<TSettings, TPlayer extends BasePlayer> {
  code: string;
  isPublic: boolean;
  state: string;
  hostId: string | null;
  settings: TSettings;
  players: Map<string, TPlayer>;
  createdAt: number;
  lobbyCountdownTimer: NodeJS.Timeout | null;
  lobbyCountdownEndsAt: number | null;
  emptyRoomTimer: NodeJS.Timeout | null;
  gameOverReason: string | null;
}

// No I or O — too easy to confuse with 1 and 0 when sharing codes aloud.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOBBY_DISCONNECT_REMOVE_MS = 30_000;
const EMPTY_ROOM_CLOSE_MS = 5 * 60_000;
const PUBLIC_AUTO_START_MS = 20_000;

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 20);
  return name.length > 0 ? name : null;
}

export abstract class BaseRoomManager<
  TSettings,
  TPlayer extends BasePlayer,
  TRoom extends BaseRoom<TSettings, TPlayer>,
> {
  protected minPlayers = 2;
  protected maxPlayers = 4;

  constructor(
    protected nsp: AnyNamespace,
    protected store: RoomStore<TRoom>,
    /** Client route for share links, e.g. "/mindmeld". */
    protected linkPath: string,
  ) {
    nsp.on("connection", (socket: AnySocket) => {
      this.bindBaseEvents(socket);
      this.bindGameEvents(socket);
    });
  }

  // ---------- game-specific hooks ----------

  protected abstract sanitizeSettings(partial?: Partial<TSettings>): TSettings;
  /** Attach game-specific fields to a freshly created room. */
  protected abstract makeRoom(base: BaseRoom<TSettings, TPlayer>): TRoom;
  /** Attach game-specific fields to a freshly created player. */
  protected abstract makePlayer(base: BasePlayer): TPlayer;
  /** Public snapshot broadcast as roomUpdate. */
  protected abstract snapshot(room: TRoom): unknown;
  /** Public per-player view (used for playerJoined). */
  protected abstract publicPlayer(room: TRoom, player: TPlayer): unknown;
  /** Transition the room out of the lobby and start the game. */
  protected abstract beginGame(room: TRoom): void;
  /** Clear all game-phase timers (called when a room closes). */
  protected abstract clearGameTimers(room: TRoom): void;
  /** Reset game state for playAgain (room is already back in "lobby"). */
  protected abstract resetGame(room: TRoom): void;
  /** Extra fields merged into the rejoin ack (e.g. the player's own hidden state). */
  protected abstract rejoinExtra(room: TRoom, player: TPlayer): Record<string, unknown>;
  /** Bind game-specific socket events. */
  protected abstract bindGameEvents(socket: AnySocket): void;

  /** Game-specific cleanup when a player is removed (before host reassignment). */
  protected onPlayerRemoved(_room: TRoom, _player: TPlayer, _reason: string): void {}
  /** Called after an explicit leave while a game is in progress. */
  protected afterLeaveDuringGame(_room: TRoom): void {}
  /** Called after a disconnect while a game is in progress. */
  protected onDisconnectDuringGame(_room: TRoom): void {}
  /** Per-room player limits — override when capacity depends on room settings. */
  protected roomMinPlayers(_room: TRoom): number {
    return this.minPlayers;
  }
  protected roomMaxPlayers(_room: TRoom): number {
    return this.maxPlayers;
  }
  /** Whether a public lobby may countdown-start before it is full. */
  protected canAutoStartPartial(_room: TRoom): boolean {
    return true;
  }
  /** Extra host-start validation; return an error message to block the start. */
  protected canStartExtra(_room: TRoom): string | null {
    return null;
  }
  /** Whether a public lobby matches this quickPlay request (e.g. same mode). */
  protected quickPlayEligible(_room: TRoom, _payload: unknown): boolean {
    return true;
  }
  /** Settings for the room quickPlay creates when no lobby matched. */
  protected quickPlayCreateSettings(_payload: unknown): Partial<TSettings> | undefined {
    return undefined;
  }
  /** Called when a player joins a room (e.g. to auto-assign a team). */
  protected onPlayerJoined(_room: TRoom, _player: TPlayer, _socket: AnySocket): void {}
  /** Called when a player rejoins and is rebound (e.g. to rejoin team rooms). */
  protected onRejoin(_room: TRoom, _player: TPlayer, _socket: AnySocket): void {}

  // ---------- base event wiring ----------

  private bindBaseEvents(socket: AnySocket): void {
    socket.on("createRoom", (payload: any, ack: any) => this.createRoom(socket, payload, ack));
    socket.on("joinRoom", (payload: any, ack: any) => this.joinRoom(socket, payload, ack));
    socket.on("quickPlay", (payload: any, ack: any) => this.quickPlay(socket, payload, ack));
    socket.on("rejoin", (payload: any, ack: any) => this.rejoin(socket, payload, ack));
    socket.on("toggleReady", () => this.toggleReady(socket));
    socket.on("startGame", () => this.handleHostStart(socket));
    socket.on("leaveRoom", () => this.leaveRoom(socket));
    socket.on("playAgain", () => this.playAgain(socket));
    socket.on("disconnect", () => this.handleDisconnect(socket));
  }

  // ---------- helpers ----------

  protected roomOf(socket: AnySocket): { room: TRoom; player: TPlayer } | null {
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return null;
    const room = this.store.get(roomCode);
    const player = room?.players.get(playerId);
    if (!room || !player) return null;
    return { room, player };
  }

  protected broadcastRoom(room: TRoom): void {
    this.nsp.to(room.code).emit("roomUpdate", this.snapshot(room));
  }

  protected emitError(socket: AnySocket, message: string): void {
    socket.emit("errorMsg", { message });
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

  private clearRoomTimers(room: TRoom): void {
    this.clearGameTimers(room);
    if (room.lobbyCountdownTimer) clearTimeout(room.lobbyCountdownTimer);
    if (room.emptyRoomTimer) clearTimeout(room.emptyRoomTimer);
    room.lobbyCountdownTimer = null;
    room.emptyRoomTimer = null;
    room.lobbyCountdownEndsAt = null;
    for (const p of room.players.values()) {
      if (p.removalTimer) clearTimeout(p.removalTimer);
      p.removalTimer = null;
    }
  }

  protected closeRoom(room: TRoom): void {
    this.clearRoomTimers(room);
    this.store.delete(room.code);
  }

  private link(code: string): string {
    return `${this.linkPath}?room=${code}`;
  }

  private addPlayerToRoom(socket: AnySocket, room: TRoom, name: string): TPlayer {
    const player = this.makePlayer({
      id: randomUUID(),
      name,
      socketId: socket.id,
      connected: true,
      ready: false,
      removalTimer: null,
    });
    room.players.set(player.id, player);
    if (!room.hostId) room.hostId = player.id;
    socket.data.playerId = player.id;
    socket.data.roomCode = room.code;
    socket.join(room.code);
    this.cancelEmptyRoomTimer(room);
    this.onPlayerJoined(room, player, socket);
    socket.to(room.code).emit("playerJoined", { player: this.publicPlayer(room, player) });
    this.updateLobbyCountdown(room);
    this.broadcastRoom(room);
    return player;
  }

  private cancelEmptyRoomTimer(room: TRoom): void {
    if (room.emptyRoomTimer) {
      clearTimeout(room.emptyRoomTimer);
      room.emptyRoomTimer = null;
    }
  }

  /** If a socket is already bound to a room, detach it first (e.g. a second tab). */
  private detachFromCurrentRoom(socket: AnySocket): void {
    if (socket.data.roomCode) this.leaveRoom(socket);
  }

  // ---------- lobby & matchmaking ----------

  private createRoom(
    socket: AnySocket,
    payload: { name: string; isPublic: boolean; settings?: Partial<TSettings> },
    ack: (res: unknown) => void,
  ): void {
    const name = sanitizeName(payload?.name);
    if (!name) return ack({ ok: false, error: "Please enter a name." });
    this.detachFromCurrentRoom(socket);
    const room = this.makeRoom({
      code: this.generateCode(),
      isPublic: Boolean(payload.isPublic),
      state: "lobby",
      hostId: null,
      settings: this.sanitizeSettings(payload.settings),
      players: new Map(),
      createdAt: Date.now(),
      lobbyCountdownTimer: null,
      lobbyCountdownEndsAt: null,
      emptyRoomTimer: null,
      gameOverReason: null,
    });
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
    socket: AnySocket,
    payload: { code: string; name: string },
    ack: (res: unknown) => void,
  ): void {
    const name = sanitizeName(payload?.name);
    if (!name) return ack({ ok: false, error: "Please enter a name." });
    const code = String(payload?.code ?? "").trim().toUpperCase();
    const room = this.store.get(code);
    if (!room) return ack({ ok: false, error: `Room ${code || "?"} not found.` });
    if (room.state !== "lobby") {
      return ack({ ok: false, error: "That game has already started." });
    }
    if (room.players.size >= this.roomMaxPlayers(room)) {
      return ack({
        ok: false,
        error: `That room is full (${this.roomMaxPlayers(room)} players max).`,
      });
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
    socket: AnySocket,
    payload: { name: string },
    ack: (res: unknown) => void,
  ): void {
    const name = sanitizeName(payload?.name);
    if (!name) return ack({ ok: false, error: "Please enter a name." });
    let oldest: TRoom | null = null;
    for (const room of this.store.values()) {
      if (
        room.isPublic &&
        room.state === "lobby" &&
        room.players.size >= 1 &&
        room.players.size < this.roomMaxPlayers(room) &&
        this.quickPlayEligible(room, payload) &&
        (!oldest || room.createdAt < oldest.createdAt)
      ) {
        oldest = room;
      }
    }
    if (oldest) {
      return this.joinRoom(socket, { code: oldest.code, name }, ack);
    }
    this.createRoom(
      socket,
      { name, isPublic: true, settings: this.quickPlayCreateSettings(payload) },
      ack,
    );
  }

  /**
   * Public-room auto-start: start immediately at maxPlayers; with 2+ players
   * run a 20s countdown that resets whenever someone joins.
   */
  protected updateLobbyCountdown(room: TRoom): void {
    if (!room.isPublic || room.state !== "lobby") return;
    if (room.lobbyCountdownTimer) {
      clearTimeout(room.lobbyCountdownTimer);
      room.lobbyCountdownTimer = null;
      room.lobbyCountdownEndsAt = null;
    }
    const connected = [...room.players.values()].filter((p) => p.connected);
    if (room.players.size >= this.roomMaxPlayers(room)) {
      this.launchGame(room);
      return;
    }
    if (connected.length >= this.roomMinPlayers(room) && this.canAutoStartPartial(room)) {
      room.lobbyCountdownEndsAt = Date.now() + PUBLIC_AUTO_START_MS;
      room.lobbyCountdownTimer = setTimeout(() => {
        room.lobbyCountdownTimer = null;
        room.lobbyCountdownEndsAt = null;
        if (room.state === "lobby" && room.players.size >= this.roomMinPlayers(room)) {
          this.launchGame(room);
        } else {
          this.broadcastRoom(room);
        }
      }, PUBLIC_AUTO_START_MS);
    }
  }

  private toggleReady(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "lobby") return;
    ctx.player.ready = !ctx.player.ready;
    this.broadcastRoom(ctx.room);
  }

  /** Host-initiated start with the shared validation rules. */
  protected handleHostStart(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== "lobby") {
      this.emitError(socket, "The game has already started.");
      return;
    }
    if (player.id !== room.hostId) {
      this.emitError(socket, "Only the host can start the game.");
      return;
    }
    const min = this.roomMinPlayers(room);
    const max = this.roomMaxPlayers(room);
    if (room.players.size < min || room.players.size > max) {
      this.emitError(
        socket,
        min === max
          ? `This game needs exactly ${min} players.`
          : `This game needs ${min}-${max} players.`,
      );
      return;
    }
    if (![...room.players.values()].every((p) => p.ready)) {
      this.emitError(socket, "Everyone must be ready first.");
      return;
    }
    const blocked = this.canStartExtra(room);
    if (blocked) {
      this.emitError(socket, blocked);
      return;
    }
    this.launchGame(room);
  }

  protected launchGame(room: TRoom): void {
    if (room.state !== "lobby") return;
    if (room.lobbyCountdownTimer) clearTimeout(room.lobbyCountdownTimer);
    room.lobbyCountdownTimer = null;
    room.lobbyCountdownEndsAt = null;
    room.gameOverReason = null;
    this.beginGame(room);
  }

  // ---------- membership ----------

  /** Remove a player from the room and handle host reassignment / room close. */
  protected removePlayer(room: TRoom, player: TPlayer, reason: "left" | "afk" | "removed"): void {
    if (player.removalTimer) clearTimeout(player.removalTimer);
    player.removalTimer = null;
    room.players.delete(player.id);
    this.onPlayerRemoved(room, player, reason);
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

  private leaveRoom(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    if (!ctx) return;
    const { room, player } = ctx;
    socket.leave(room.code);
    player.socketId = null;
    this.removePlayer(room, player, "left");
    if (!this.store.has(room.code)) return; // room was closed
    if (room.state === "lobby") {
      this.updateLobbyCountdown(room);
      this.broadcastRoom(room);
    } else if (room.state !== "finished") {
      this.afterLeaveDuringGame(room);
    }
  }

  private handleDisconnect(socket: AnySocket): void {
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
    if (room.state !== "lobby" && room.state !== "finished") {
      this.onDisconnectDuringGame(room);
    }
  }

  private rejoin(
    socket: AnySocket,
    payload: { playerId: string; code: string },
    ack: (res: unknown) => void,
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
    this.onRejoin(room, player, socket);
    ack({
      ok: true,
      data: {
        playerId: player.id,
        code: room.code,
        room: this.snapshot(room),
        ...this.rejoinExtra(room, player),
      },
    });
    this.broadcastRoom(room);
  }

  private playAgain(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room } = ctx;
    if (room.state !== "finished") return;
    room.state = "lobby";
    room.gameOverReason = null;
    for (const p of room.players.values()) {
      p.ready = false;
    }
    this.resetGame(room);
    this.updateLobbyCountdown(room);
    this.broadcastRoom(room);
  }
}

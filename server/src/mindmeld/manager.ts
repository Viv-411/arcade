import type { Namespace } from "socket.io";
import type {
  Ack,
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from "../../../shared/events.js";
import {
  DEFAULT_SETTINGS,
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
import {
  BaseRoomManager,
  clamp,
  type AnySocket,
  type BasePlayer,
  type BaseRoom,
} from "../core/roomManager.js";

type MindMeldNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

interface MindMeldPlayer extends BasePlayer {
  missedRounds: number;
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

interface MindMeldRoom extends BaseRoom<RoomSettings, MindMeldPlayer> {
  game: GameData;
  winner: { word: string; rounds: number } | null;
}

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

export class MindMeldManager extends BaseRoomManager<
  RoomSettings,
  MindMeldPlayer,
  MindMeldRoom
> {
  constructor(
    private mnsp: MindMeldNamespace,
    store: RoomStore<MindMeldRoom>,
    private stats: StatsStore,
  ) {
    super(mnsp, store, "/mindmeld");
  }

  // ---------- base hooks ----------

  protected bindGameEvents(socket: AnySocket): void {
    socket.on("lockIn", (payload: { word: string }, ack: Ack<{ normalized: string }>) =>
      this.lockIn(socket, payload, ack),
    );
    socket.on("unlock", () => this.unlock(socket));
  }

  protected sanitizeSettings(partial?: Partial<RoomSettings>): RoomSettings {
    const s = { ...DEFAULT_SETTINGS, ...partial };
    return {
      roundTimeSec: clamp(Number(s.roundTimeSec) || DEFAULT_SETTINGS.roundTimeSec, 10, 300),
      revealPauseSec: clamp(Number(s.revealPauseSec) || DEFAULT_SETTINGS.revealPauseSec, 1, 30),
      maxRounds: clamp(Number(s.maxRounds) ?? DEFAULT_SETTINGS.maxRounds, 0, 100),
      afkMissLimit: clamp(Number(s.afkMissLimit) || DEFAULT_SETTINGS.afkMissLimit, 1, 10),
      matchMode: s.matchMode === "loose" ? "loose" : "strict",
    };
  }

  protected makeRoom(base: BaseRoom<RoomSettings, MindMeldPlayer>): MindMeldRoom {
    return { ...base, game: freshGame(), winner: null };
  }

  protected makePlayer(base: BasePlayer): MindMeldPlayer {
    return { ...base, missedRounds: 0 };
  }

  protected publicPlayer(room: MindMeldRoom, p: MindMeldPlayer): PublicPlayer {
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
      missedRounds: p.missedRounds,
      lockedIn: room.game.submissions.get(p.id)?.locked ?? false,
    };
  }

  protected snapshot(room: MindMeldRoom): RoomSnapshot {
    return {
      code: room.code,
      isPublic: room.isPublic,
      state: room.state as RoomState,
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

  protected clearGameTimers(room: MindMeldRoom): void {
    if (room.game.roundTimer) clearTimeout(room.game.roundTimer);
    if (room.game.revealTimer) clearTimeout(room.game.revealTimer);
    room.game.roundTimer = null;
    room.game.revealTimer = null;
  }

  protected resetGame(room: MindMeldRoom): void {
    this.clearGameTimers(room);
    room.game = freshGame();
    room.winner = null;
    for (const p of room.players.values()) p.missedRounds = 0;
  }

  protected rejoinExtra(room: MindMeldRoom, player: MindMeldPlayer): Record<string, unknown> {
    const sub = room.game.submissions.get(player.id);
    return {
      yourWord: sub?.locked ? { raw: sub.raw, normalized: sub.normalized } : null,
    };
  }

  protected onPlayerRemoved(room: MindMeldRoom, player: MindMeldPlayer): void {
    room.game.submissions.delete(player.id);
  }

  protected afterLeaveDuringGame(room: MindMeldRoom): void {
    if (room.players.size < this.minPlayers) {
      this.endGame(room, "not enough players");
    } else {
      this.maybeResolveEarly(room);
    }
  }

  protected onDisconnectDuringGame(room: MindMeldRoom): void {
    this.maybeResolveEarly(room);
  }

  // ---------- round state machine ----------

  protected beginGame(room: MindMeldRoom): void {
    room.state = "playing";
    room.winner = null;
    room.game = freshGame();
    room.game.roundNumber = 1;
    for (const p of room.players.values()) p.missedRounds = 0;
    this.broadcastRoom(room);
    this.startRound(room);
  }

  private startRound(room: MindMeldRoom): void {
    if (room.state !== "playing") return;
    const game = room.game;
    game.submissions.clear();
    game.resolving = false;
    game.deadline = Date.now() + room.settings.roundTimeSec * 1000;
    this.mnsp.to(room.code).emit("roundStart", {
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
    socket: AnySocket,
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
    this.mnsp.to(room.code).emit("playerLockedIn", { playerId: player.id, locked: true });
    this.maybeResolveEarly(room);
  }

  private unlock(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== "playing" || room.game.resolving) {
      this.emitError(socket, "The round has already been resolved.");
      return;
    }
    if (!room.game.submissions.get(player.id)?.locked) return;
    room.game.submissions.delete(player.id);
    this.mnsp.to(room.code).emit("playerLockedIn", { playerId: player.id, locked: false });
  }

  /** Fast path: if every connected player has locked in, resolve immediately. */
  private maybeResolveEarly(room: MindMeldRoom): void {
    if (room.state !== "playing" || room.game.resolving) return;
    const connected = [...room.players.values()].filter((p) => p.connected);
    if (connected.length === 0) return;
    if (connected.every((p) => room.game.submissions.get(p.id)?.locked)) {
      this.resolveRound(room);
    }
  }

  private resolveRound(room: MindMeldRoom): void {
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
    const removed: MindMeldPlayer[] = [];
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
      room.players.size >= this.minPlayers &&
      entries.length === room.players.size &&
      entries.every((e) => e.normalized === entries[0].normalized);

    this.mnsp.to(room.code).emit("roundReveal", {
      round: game.roundNumber,
      entries,
      usedWords: [...game.usedWords],
      isWin,
    });

    if (isWin) {
      room.state = "finished";
      room.winner = { word: entries[0].normalized, rounds: game.roundNumber };
      const participants = [...room.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        userId: p.userId,
      }));
      this.stats.recordGame(participants, participants.map((p) => p.id), "mindmeld");
      this.mnsp.to(room.code).emit("gameWin", {
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
    if (room.players.size < this.minPlayers) {
      return this.endGame(room, "not enough players");
    }

    // Reveal pause with a per-second countdown, then next round.
    let secondsLeft = room.settings.revealPauseSec;
    this.mnsp.to(room.code).emit("revealCountdown", { secondsLeft });
    const tick = () => {
      secondsLeft -= 1;
      if (room.state !== "playing") return;
      if (secondsLeft > 0) {
        this.mnsp.to(room.code).emit("revealCountdown", { secondsLeft });
        game.revealTimer = setTimeout(tick, 1000);
      } else {
        game.revealTimer = null;
        game.roundNumber += 1;
        this.startRound(room);
      }
    };
    game.revealTimer = setTimeout(tick, 1000);
  }

  private endGame(room: MindMeldRoom, reason: string): void {
    if (room.state === "finished") return;
    room.state = "finished";
    room.gameOverReason = reason;
    this.clearGameTimers(room);
    room.game.deadline = null;
    const participants = [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      userId: p.userId,
    }));
    if (participants.length > 0) this.stats.recordGame(participants, [], "mindmeld");
    this.mnsp.to(room.code).emit("gameOver", { reason });
    this.broadcastRoom(room);
  }
}

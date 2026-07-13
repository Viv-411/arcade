import type { Namespace } from "socket.io";
import type { Ack, SocketData } from "../../../shared/events.js";
import {
  DEFAULT_IMPOSTER_SETTINGS,
  IMPOSTER_MAX_PLAYERS,
  IMPOSTER_MIN_PLAYERS,
  type ClueRound,
  type EliminationRecord,
  type ImposterClientEvents,
  type ImposterPublicPlayer,
  type ImposterRole,
  type ImposterServerEvents,
  type ImposterSettings,
  type ImposterSide,
  type ImposterSnapshot,
  type ImposterState,
  type YourRolePayload,
} from "../../../shared/imposter.js";
import { IMPOSTER_WORD_BANK, drawImposterWord } from "../../../shared/imposterWords.js";
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

type ImposterNamespace = Namespace<
  ImposterClientEvents,
  ImposterServerEvents,
  Record<string, never>,
  SocketData
>;

type ImposterPlayer = BasePlayer;

interface GameData {
  roles: Map<string, ImposterRole>;
  word: string;
  category: string;
  alive: Set<string>;
  /** Global clue-round counter (across cycles) for the board. */
  round: number;
  /** Clue rounds inside the current cycle (reset after each elimination). */
  cycleRounds: number;
  startingPlayerId: string | null;
  turnOrder: string[];
  turnIdx: number;
  turnDeadline: number | null;
  clueBoard: ClueRound[];
  decisionVotes: Map<string, "another" | "accuse">;
  votes: Map<string, string>;
  candidates: string[];
  runoff: boolean;
  forced: boolean;
  stealTargetId: string | null;
  phaseDeadline: number | null;
  eliminated: EliminationRecord[];
  winners: ImposterSide | null;
  // timers
  revealTimer: NodeJS.Timeout | null;
  turnTimer: NodeJS.Timeout | null;
  decisionTimer: NodeJS.Timeout | null;
  voteTimer: NodeJS.Timeout | null;
  stealTimer: NodeJS.Timeout | null;
  pauseTimer: NodeJS.Timeout | null;
}

interface ImposterRoom extends BaseRoom<ImposterSettings, ImposterPlayer> {
  game: GameData;
}

const RESULT_PAUSE_MS = 3500;

function freshGame(): GameData {
  return {
    roles: new Map(),
    word: "",
    category: "",
    alive: new Set(),
    round: 0,
    cycleRounds: 0,
    startingPlayerId: null,
    turnOrder: [],
    turnIdx: -1,
    turnDeadline: null,
    clueBoard: [],
    decisionVotes: new Map(),
    votes: new Map(),
    candidates: [],
    runoff: false,
    forced: false,
    stealTargetId: null,
    phaseDeadline: null,
    eliminated: [],
    winners: null,
    revealTimer: null,
    turnTimer: null,
    decisionTimer: null,
    voteTimer: null,
    stealTimer: null,
    pauseTimer: null,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class ImposterManager extends BaseRoomManager<
  ImposterSettings,
  ImposterPlayer,
  ImposterRoom
> {
  protected minPlayers = IMPOSTER_MIN_PLAYERS;
  protected maxPlayers = IMPOSTER_MAX_PLAYERS;

  constructor(
    private insp: ImposterNamespace,
    store: RoomStore<ImposterRoom>,
    private stats: StatsStore,
  ) {
    super(insp, store, "/imposter-online");
    this.gameKey = "imposter"; // presence/invite key differs from the route
  }

  // ---------- base hooks ----------

  protected bindGameEvents(socket: AnySocket): void {
    socket.on("setImposterSettings", (p: Partial<ImposterSettings>) =>
      this.setSettings(socket, p),
    );
    socket.on("submitClue", (p: { word: string }, ack: Ack<{ word: string }>) =>
      this.submitClue(socket, p, ack),
    );
    socket.on("advanceTurn", () => this.advanceTurnSpoken(socket));
    socket.on("castDecisionVote", (p: { choice: "another" | "accuse" }) =>
      this.castDecisionVote(socket, p),
    );
    socket.on("castAccusationVote", (p: { targetId: string }) =>
      this.castAccusationVote(socket, p),
    );
    socket.on("submitWordGuess", (p: { word: string }, ack: Ack<{ correct: boolean }>) =>
      this.submitWordGuess(socket, p, ack),
    );
  }

  protected sanitizeSettings(partial?: Partial<ImposterSettings>): ImposterSettings {
    const s = { ...DEFAULT_IMPOSTER_SETTINGS, ...partial };
    return {
      imposters: clamp(Number(s.imposters) || 1, 1, IMPOSTER_MAX_PLAYERS - 1),
      category:
        typeof s.category === "string" && IMPOSTER_WORD_BANK[s.category] ? s.category : null,
      hints: Boolean(s.hints),
      wordSteal: Boolean(s.wordSteal),
      clueInputMode: s.clueInputMode === "spoken" ? "spoken" : "typed",
      maxClueRounds: clamp(Number(s.maxClueRounds) || 3, 1, 10),
      clueTurnSec: clamp(Number(s.clueTurnSec) || 30, 5, 90),
      decisionSec: clamp(Number(s.decisionSec) || 15, 5, 60),
      voteSec: clamp(Number(s.voteSec) || 25, 5, 90),
      stealSec: clamp(Number(s.stealSec) || 30, 10, 90),
      revealSec: clamp(Number(s.revealSec) || 7, 3, 20),
    };
  }

  protected makeRoom(base: BaseRoom<ImposterSettings, ImposterPlayer>): ImposterRoom {
    return { ...base, game: freshGame() };
  }

  protected makePlayer(base: BasePlayer): ImposterPlayer {
    return base;
  }

  protected publicPlayer(room: ImposterRoom, p: ImposterPlayer): ImposterPublicPlayer {
    const g = room.game;
    let acted = false;
    if (room.state === "decision") acted = g.decisionVotes.has(p.id);
    else if (room.state === "vote") acted = g.votes.has(p.id);
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
      alive: room.state === "lobby" ? true : g.alive.has(p.id),
      acted,
    };
  }

  protected snapshot(room: ImposterRoom): ImposterSnapshot {
    const g = room.game;
    const finished = room.state === "finished";
    return {
      code: room.code,
      isPublic: room.isPublic,
      state: room.state as ImposterState,
      hostId: room.hostId,
      settings: room.settings,
      players: [...room.players.values()].map((p) => this.publicPlayer(room, p)),
      lobbyCountdownEndsAt: room.lobbyCountdownEndsAt,
      gameOverReason: room.gameOverReason,
      round: g.round,
      startingPlayerName: g.startingPlayerId
        ? room.players.get(g.startingPlayerId)?.name ?? null
        : null,
      whoseTurn: room.state === "clues" ? g.turnOrder[g.turnIdx] ?? null : null,
      turnDeadline: room.state === "clues" ? g.turnDeadline : null,
      phaseDeadline: g.phaseDeadline,
      clueBoard: g.clueBoard,
      candidates: room.state === "vote" ? g.candidates : [],
      runoff: g.runoff,
      forced: g.forced,
      stealTargetId: room.state === "steal" ? g.stealTargetId : null,
      eliminated: g.eliminated,
      // SECRECY: word and roles only after the game is over.
      winners: finished ? g.winners : null,
      word: finished && g.word ? g.word : null,
      allRoles: finished ? this.allRoles(room) : null,
    };
  }

  private allRoles(room: ImposterRoom): EliminationRecord[] {
    return [...room.game.roles.entries()].map(([playerId, role]) => ({
      playerId,
      name:
        room.players.get(playerId)?.name ??
        room.game.eliminated.find((e) => e.playerId === playerId)?.name ??
        "left",
      role,
    }));
  }

  protected clearGameTimers(room: ImposterRoom): void {
    const g = room.game;
    for (const key of [
      "revealTimer",
      "turnTimer",
      "decisionTimer",
      "voteTimer",
      "stealTimer",
      "pauseTimer",
    ] as const) {
      if (g[key]) clearTimeout(g[key]!);
      g[key] = null;
    }
  }

  protected resetGame(room: ImposterRoom): void {
    this.clearGameTimers(room);
    room.game = freshGame();
  }

  protected rejoinExtra(room: ImposterRoom, player: ImposterPlayer): Record<string, unknown> {
    return { yourRole: this.roleFor(room, player.id) };
  }

  private roleFor(room: ImposterRoom, playerId: string): YourRolePayload | null {
    const g = room.game;
    const role = g.roles.get(playerId);
    if (!role || room.state === "lobby") return null;
    return {
      role,
      // NEVER the word for imposters; category hint only when hints are on.
      word: role === "crew" ? g.word : null,
      hint: role === "imposter" && room.settings.hints ? g.category : null,
      startingPlayerName: g.startingPlayerId
        ? room.players.get(g.startingPlayerId)?.name ?? "?"
        : "?",
    };
  }

  protected onPlayerRemoved(room: ImposterRoom, player: ImposterPlayer): void {
    const g = room.game;
    g.decisionVotes.delete(player.id);
    g.votes.delete(player.id);
    for (const [voter, target] of [...g.votes.entries()]) {
      if (target === player.id) g.votes.delete(voter);
    }
    if (room.state === "lobby" || room.state === "finished") return;
    g.alive.delete(player.id);
    g.candidates = g.candidates.filter((id) => id !== player.id);
    if (room.players.size < IMPOSTER_MIN_PLAYERS) {
      this.endGame(room, null, "not enough players");
      return;
    }
    // Their departure may decide the game or unblock the current phase.
    if (this.checkAliveWin(room)) return;
    if (room.state === "clues" && g.turnOrder[g.turnIdx] === player.id) {
      this.recordClue(room, player, null);
      return;
    }
    if (room.state === "decision") this.maybeResolveDecision(room);
    else if (room.state === "vote") this.maybeResolveVote(room);
    else if (room.state === "steal" && g.stealTargetId === player.id) {
      this.resolveStealFail(room);
    }
  }

  protected onDisconnectDuringGame(room: ImposterRoom): void {
    if (room.state === "decision") this.maybeResolveDecision(room);
    else if (room.state === "vote") this.maybeResolveVote(room);
  }

  // ---------- lobby ----------

  private setSettings(socket: AnySocket, partial: Partial<ImposterSettings>): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "lobby") return;
    if (ctx.player.id !== ctx.room.hostId) {
      this.emitError(socket, "Only the host can change settings.");
      return;
    }
    ctx.room.settings = this.sanitizeSettings({ ...ctx.room.settings, ...partial });
    this.broadcastRoom(ctx.room);
  }

  // ---------- game start ----------

  protected beginGame(room: ImposterRoom): void {
    const g = (room.game = freshGame());
    const players = [...room.players.values()];
    const imposterCount = Math.min(room.settings.imposters, players.length - 1);
    const order = shuffle(players.map((p) => p.id));
    order.forEach((id, idx) => g.roles.set(id, idx < imposterCount ? "imposter" : "crew"));
    const { category, word } = drawImposterWord(room.settings.category);
    g.category = category;
    g.word = word;
    g.alive = new Set(players.map((p) => p.id));
    g.startingPlayerId = order[Math.floor(Math.random() * order.length)];
    room.state = "reveal";
    g.phaseDeadline = Date.now() + room.settings.revealSec * 1000;
    this.broadcastRoom(room);
    this.sendPrivateRoles(room);
    g.revealTimer = setTimeout(() => {
      g.revealTimer = null;
      this.startCycle(room);
    }, room.settings.revealSec * 1000);
  }

  /** Each socket gets ONLY its own card. */
  private sendPrivateRoles(room: ImposterRoom): void {
    for (const p of room.players.values()) {
      if (!p.socketId) continue;
      const payload = this.roleFor(room, p.id);
      if (payload) this.insp.to(p.socketId).emit("yourRole", payload);
    }
  }

  // ---------- clue rounds ----------

  private startCycle(room: ImposterRoom): void {
    if (room.state === "finished" || !this.store.has(room.code)) return;
    const g = room.game;
    g.cycleRounds = 0;
    const alive = [...room.players.values()].filter((p) => g.alive.has(p.id)).map((p) => p.id);
    const start =
      g.round === 0 && g.startingPlayerId && g.alive.has(g.startingPlayerId)
        ? g.startingPlayerId
        : alive[Math.floor(Math.random() * alive.length)];
    const at = Math.max(0, alive.indexOf(start));
    g.turnOrder = [...alive.slice(at), ...alive.slice(0, at)];
    this.startClueRound(room);
  }

  private startClueRound(room: ImposterRoom): void {
    const g = room.game;
    room.state = "clues";
    g.round += 1;
    g.cycleRounds += 1;
    g.phaseDeadline = null;
    g.turnIdx = -1;
    g.clueBoard.push({ round: g.round, entries: [] });
    this.nextTurn(room);
  }

  private nextTurn(room: ImposterRoom): void {
    const g = room.game;
    if (g.turnTimer) clearTimeout(g.turnTimer);
    g.turnTimer = null;
    // Skip anyone eliminated or gone since the order was built.
    do {
      g.turnIdx += 1;
    } while (
      g.turnIdx < g.turnOrder.length &&
      (!g.alive.has(g.turnOrder[g.turnIdx]) || !room.players.has(g.turnOrder[g.turnIdx]))
    );
    if (g.turnIdx >= g.turnOrder.length) {
      this.endClueRound(room);
      return;
    }
    const playerId = g.turnOrder[g.turnIdx];
    g.turnDeadline = Date.now() + room.settings.clueTurnSec * 1000;
    this.insp.to(room.code).emit("clueTurn", {
      playerId,
      deadline: g.turnDeadline,
      round: g.round,
    });
    this.broadcastRoom(room);
    g.turnTimer = setTimeout(() => {
      g.turnTimer = null;
      // Grace expired (disconnected or idle): auto-skip with no clue.
      const p = room.players.get(playerId);
      if (room.state === "clues" && g.turnOrder[g.turnIdx] === playerId && p) {
        this.recordClue(room, p, null);
      }
    }, room.settings.clueTurnSec * 1000);
  }

  private recordClue(room: ImposterRoom, player: ImposterPlayer, word: string | null): void {
    const g = room.game;
    const bucket = g.clueBoard[g.clueBoard.length - 1];
    const entry = { playerId: player.id, name: player.name, word };
    bucket.entries.push(entry);
    this.insp.to(room.code).emit("clueSubmitted", { ...entry, round: g.round });
    this.nextTurn(room);
  }

  private submitClue(
    socket: AnySocket,
    payload: { word: string },
    ack: Ack<{ word: string }>,
  ): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    const g = room.game;
    if (room.state !== "clues") return ack({ ok: false, error: "It's not clue time." });
    if (room.settings.clueInputMode !== "typed") {
      return ack({ ok: false, error: "Spoken mode — say your clue out loud!" });
    }
    if (g.turnOrder[g.turnIdx] !== player.id) {
      return ack({ ok: false, error: "It's not your turn." });
    }
    const word = String(payload?.word ?? "").trim().toLowerCase().slice(0, 24);
    if (!word || /\s/.test(word)) {
      return ack({ ok: false, error: "One single word, please." });
    }
    // Crew may not say the secret word itself. (Deliberately NOT enforced for
    // imposters — rejecting their guess would leak the word to them.)
    if (g.roles.get(player.id) === "crew" && normalizeWord(word) === normalizeWord(g.word)) {
      return ack({ ok: false, error: "You can't say the secret word itself!" });
    }
    ack({ ok: true, data: { word } });
    this.recordClue(room, player, word);
  }

  private advanceTurnSpoken(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const g = room.game;
    if (room.state !== "clues" || room.settings.clueInputMode !== "spoken") return;
    const active = g.turnOrder[g.turnIdx];
    if (player.id !== active && player.id !== room.hostId) {
      this.emitError(socket, "Only the speaking player (or host) can advance the turn.");
      return;
    }
    const activePlayer = room.players.get(active);
    if (activePlayer) this.recordClue(room, activePlayer, null);
  }

  private endClueRound(room: ImposterRoom): void {
    const g = room.game;
    g.turnDeadline = null;
    if (g.cycleRounds >= room.settings.maxClueRounds) {
      this.startVote(room, { forced: true });
    } else {
      this.startDecision(room);
    }
  }

  // ---------- continue-or-vote ----------

  private startDecision(room: ImposterRoom): void {
    const g = room.game;
    room.state = "decision";
    g.decisionVotes.clear();
    g.phaseDeadline = Date.now() + room.settings.decisionSec * 1000;
    this.insp.to(room.code).emit("decisionStart", { deadline: g.phaseDeadline });
    this.broadcastRoom(room);
    g.decisionTimer = setTimeout(() => {
      g.decisionTimer = null;
      this.resolveDecision(room);
    }, room.settings.decisionSec * 1000);
  }

  private castDecisionVote(socket: AnySocket, payload: { choice: "another" | "accuse" }): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== "decision" || !room.game.alive.has(player.id)) return;
    const choice = payload?.choice === "accuse" ? "accuse" : "another";
    room.game.decisionVotes.set(player.id, choice);
    this.broadcastRoom(room);
    this.maybeResolveDecision(room);
  }

  private maybeResolveDecision(room: ImposterRoom): void {
    if (room.state !== "decision") return;
    const g = room.game;
    const aliveConnected = [...room.players.values()].filter(
      (p) => g.alive.has(p.id) && p.connected,
    );
    if (aliveConnected.length > 0 && aliveConnected.every((p) => g.decisionVotes.has(p.id))) {
      this.resolveDecision(room);
    }
  }

  private resolveDecision(room: ImposterRoom): void {
    if (room.state !== "decision") return;
    const g = room.game;
    if (g.decisionTimer) clearTimeout(g.decisionTimer);
    g.decisionTimer = null;
    g.phaseDeadline = null;
    let another = 0;
    let accuse = 0;
    for (const v of g.decisionVotes.values()) v === "accuse" ? accuse++ : another++;
    const goVote = accuse > another; // ties -> another round
    this.insp.to(room.code).emit("decisionResult", { another, accuse, goVote });
    if (goVote) this.startVote(room, { forced: false });
    else this.startClueRound(room);
  }

  // ---------- accusation vote ----------

  private startVote(
    room: ImposterRoom,
    opts: { forced: boolean; candidates?: string[]; runoff?: boolean },
  ): void {
    const g = room.game;
    room.state = "vote";
    g.votes.clear();
    g.runoff = Boolean(opts.runoff);
    g.forced = opts.forced;
    g.candidates = (opts.candidates ?? [...g.alive]).filter(
      (id) => g.alive.has(id) && room.players.has(id),
    );
    g.phaseDeadline = Date.now() + room.settings.voteSec * 1000;
    this.insp.to(room.code).emit("voteStart", {
      candidates: g.candidates,
      deadline: g.phaseDeadline,
      runoff: g.runoff,
      forced: g.forced,
    });
    this.broadcastRoom(room);
    g.voteTimer = setTimeout(() => {
      g.voteTimer = null;
      this.resolveVote(room);
    }, room.settings.voteSec * 1000);
  }

  private castAccusationVote(socket: AnySocket, payload: { targetId: string }): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const g = room.game;
    if (room.state !== "vote" || !g.alive.has(player.id)) return;
    const targetId = String(payload?.targetId ?? "");
    if (!g.candidates.includes(targetId) || targetId === player.id) return;
    g.votes.set(player.id, targetId); // hidden until the tally reveal
    this.broadcastRoom(room);
    this.maybeResolveVote(room);
  }

  private maybeResolveVote(room: ImposterRoom): void {
    if (room.state !== "vote") return;
    const g = room.game;
    const aliveConnected = [...room.players.values()].filter(
      (p) => g.alive.has(p.id) && p.connected,
    );
    if (aliveConnected.length > 0 && aliveConnected.every((p) => g.votes.has(p.id))) {
      this.resolveVote(room);
    }
  }

  private resolveVote(room: ImposterRoom): void {
    if (room.state !== "vote") return;
    const g = room.game;
    if (g.voteTimer) clearTimeout(g.voteTimer);
    g.voteTimer = null;
    g.phaseDeadline = null;

    const counts = new Map<string, number>();
    for (const target of g.votes.values()) counts.set(target, (counts.get(target) ?? 0) + 1);
    const tally = [...counts.entries()]
      .map(([targetId, votes]) => ({ targetId, votes }))
      .sort((a, b) => b.votes - a.votes);
    const top = tally[0]?.votes ?? 0;
    const leaders = tally.filter((t) => t.votes === top && top > 0).map((t) => t.targetId);

    if (leaders.length === 1) {
      const outId = leaders[0];
      const role = g.roles.get(outId)!;
      const name = room.players.get(outId)?.name ?? "?";
      g.alive.delete(outId);
      g.eliminated.push({ playerId: outId, name, role });
      this.insp.to(room.code).emit("voteResult", {
        tally,
        eliminatedId: outId,
        revealedRole: role,
        runoffNext: false,
      });
      this.broadcastRoom(room);
      const aliveImposters = this.aliveCount(room, "imposter");
      g.pauseTimer = setTimeout(() => {
        g.pauseTimer = null;
        if (role === "imposter" && room.settings.wordSteal && aliveImposters === 0) {
          this.startSteal(room, outId);
        } else {
          this.afterElimination(room, role);
        }
      }, RESULT_PAUSE_MS);
      return;
    }

    // Tie (or nobody voted).
    if (!g.runoff && leaders.length > 1) {
      this.insp.to(room.code).emit("voteResult", {
        tally,
        eliminatedId: null,
        revealedRole: null,
        runoffNext: true,
      });
      g.pauseTimer = setTimeout(() => {
        g.pauseTimer = null;
        this.startVote(room, { forced: g.forced, candidates: leaders, runoff: true });
      }, RESULT_PAUSE_MS);
      return;
    }

    // Runoff still tied (or a vote with no ballots at all).
    this.insp.to(room.code).emit("voteResult", {
      tally,
      eliminatedId: null,
      revealedRole: null,
      runoffNext: false,
    });
    if (g.forced) {
      // No rounds left and the crew deadlocked: the imposters slip away.
      this.endGame(room, "imposters", "the crew couldn't agree in the final vote");
      return;
    }
    g.pauseTimer = setTimeout(() => {
      g.pauseTimer = null;
      this.startCycle(room); // benefit of the doubt: fresh clue cycle
    }, RESULT_PAUSE_MS);
  }

  private aliveCount(room: ImposterRoom, role: ImposterRole): number {
    let n = 0;
    for (const id of room.game.alive) if (room.game.roles.get(id) === role) n++;
    return n;
  }

  private afterElimination(room: ImposterRoom, eliminatedRole: ImposterRole): void {
    if (room.state === "finished") return;
    const imposters = this.aliveCount(room, "imposter");
    const crew = this.aliveCount(room, "crew");
    if (imposters === 0) return this.endGame(room, "crew");
    if (eliminatedRole === "crew" && imposters >= crew) {
      return this.endGame(room, "imposters", "the imposters reached parity");
    }
    this.startCycle(room);
  }

  /** Win checks after a player LEAVES (not vote-based). */
  private checkAliveWin(room: ImposterRoom): boolean {
    const imposters = this.aliveCount(room, "imposter");
    const crew = this.aliveCount(room, "crew");
    if (imposters === 0) {
      this.endGame(room, "crew", "all imposters left");
      return true;
    }
    if (imposters >= crew) {
      this.endGame(room, "imposters", "the imposters reached parity");
      return true;
    }
    return false;
  }

  // ---------- word steal ----------

  private startSteal(room: ImposterRoom, targetId: string): void {
    const g = room.game;
    if (room.state === "finished") return;
    const target = room.players.get(targetId);
    if (!target) return this.afterElimination(room, "imposter");
    room.state = "steal";
    g.stealTargetId = targetId;
    g.phaseDeadline = Date.now() + room.settings.stealSec * 1000;
    if (target.socketId) {
      this.insp.to(target.socketId).emit("wordStealPrompt", { deadline: g.phaseDeadline });
    }
    this.broadcastRoom(room);
    g.stealTimer = setTimeout(() => {
      g.stealTimer = null;
      this.resolveStealFail(room);
    }, room.settings.stealSec * 1000);
  }

  private submitWordGuess(
    socket: AnySocket,
    payload: { word: string },
    ack: Ack<{ correct: boolean }>,
  ): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    const g = room.game;
    if (room.state !== "steal" || g.stealTargetId !== player.id) {
      return ack({ ok: false, error: "No word guess is open for you." });
    }
    if (g.stealTimer) clearTimeout(g.stealTimer);
    g.stealTimer = null;
    const correct = normalizeWord(String(payload?.word ?? "")) === normalizeWord(g.word);
    ack({ ok: true, data: { correct } });
    if (correct) this.endGame(room, "imposters", "the imposter stole the word");
    else this.endGame(room, "crew", "the word guess missed");
  }

  private resolveStealFail(room: ImposterRoom): void {
    if (room.state !== "steal") return;
    this.endGame(room, "crew", "the word guess never came");
  }

  // ---------- end ----------

  private endGame(room: ImposterRoom, winners: ImposterSide | null, reason?: string): void {
    if (room.state === "finished") return;
    room.state = "finished";
    room.gameOverReason = reason ?? null;
    const g = room.game;
    g.winners = winners;
    this.clearGameTimers(room);
    g.phaseDeadline = null;
    g.turnDeadline = null;
    this.insp.to(room.code).emit("gameEnd", {
      winningSide: winners,
      word: g.word,
      allRoles: this.allRoles(room),
      reason,
    });
    const participants = [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      userId: p.userId,
    }));
    if (participants.length > 0 && winners) {
      const winnerIds = participants
        .filter((p) => {
          const role = g.roles.get(p.id);
          return role && (winners === "imposters") === (role === "imposter");
        })
        .map((p) => p.id);
      this.stats.recordGame(participants, winnerIds, "imposter");
    }
    this.broadcastRoom(room);
  }
}

import { randomBytes } from "node:crypto";
import type { Namespace } from "socket.io";
import type { Ack, SocketData } from "../../../shared/events.js";
import {
  CODEWORDS_BOARD_ROOM_SIZE,
  CODEWORDS_REMOTE_MAX_PLAYERS,
  CODEWORDS_REMOTE_MIN_PLAYERS,
  CW_BOARD_SIZE,
  CW_BYSTANDERS,
  CW_MAX_CLUE_NUMBER,
  CW_SECOND_TEAM_AGENTS,
  CW_STARTING_TEAM_AGENTS,
  DEFAULT_CODEWORDS_SETTINGS,
  cwTeamLabel,
  otherCwTeam,
  type CodewordsClientEvents,
  type CodewordsServerEvents,
  type CodewordsSettings,
  type CodewordsSnapshot,
  type CwClue,
  type CwClueNumber,
  type CwClueRecord,
  type CwIdentity,
  type CwPhase,
  type CwPublicPlayer,
  type CwRole,
  type CwState,
  type CwTeam,
  type CwVoteTally,
} from "../../../shared/codewords.js";
import type { RoomStore } from "../store.js";
import type { StatsStore } from "../stats.js";
import {
  BaseRoomManager,
  type AnySocket,
  type BasePlayer,
  type BaseRoom,
} from "../core/roomManager.js";
import { drawBoardWords } from "./wordBank.js";

type CodewordsNamespace = Namespace<
  CodewordsClientEvents,
  CodewordsServerEvents,
  Record<string, never>,
  SocketData
>;

interface CodewordsPlayer extends BasePlayer {
  team: CwTeam | null;
  role: CwRole;
  /** The shared-screen device in board mode; never on a team, never has the key. */
  isBoard: boolean;
}

interface GameData {
  words: string[];
  /** The ONE shared key. Sent in full to BOTH spymasters, never to operatives. */
  key: CwIdentity[];
  revealed: boolean[];
  startingTeam: CwTeam | null;
  activeTeam: CwTeam | null;
  phase: CwPhase | null;
  clue: CwClue | null;
  /** null = unlimited guesses this turn (clue number 0 / "unlimited"). */
  guessesRemaining: number | null;
  guessesMade: number;
  remaining: Record<CwTeam, number>;
  clueHistory: CwClueRecord[];
  /** Remote mode: one live vote per operative (card index or "pass"). */
  votes: Map<string, number | "pass">;
  winner: CwTeam | null;
}

interface CodewordsRoom extends BaseRoom<CodewordsSettings, CodewordsPlayer> {
  game: GameData;
  /** Board mode: per-team QR join tokens (identify the phone's team; both see the same key). */
  tokens: Record<CwTeam, string> | null;
}

const TEAMS: CwTeam[] = ["red", "blue"];

function freshGame(): GameData {
  return {
    words: [],
    key: [],
    revealed: [],
    startingTeam: null,
    activeTeam: null,
    phase: null,
    clue: null,
    guessesRemaining: null,
    guessesMade: 0,
    remaining: { red: 0, blue: 0 },
    clueHistory: [],
    votes: new Map(),
    winner: null,
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

export class CodewordsManager extends BaseRoomManager<
  CodewordsSettings,
  CodewordsPlayer,
  CodewordsRoom
> {
  constructor(
    private cnsp: CodewordsNamespace,
    store: RoomStore<CodewordsRoom>,
    private stats: StatsStore,
  ) {
    // Share links point at the remote-mode page; the social key stays "codewords".
    super(cnsp, store, "/codewords/remote");
    this.gameKey = "codewords";
  }

  // ---------- base hooks ----------

  protected bindGameEvents(socket: AnySocket): void {
    socket.on("assignTeam", (p: { team: CwTeam }) => this.assignTeam(socket, p));
    socket.on("setSpymaster", (p: { playerId: string }) => this.setSpymaster(socket, p));
    socket.on(
      "spymasterJoinViaToken",
      (p: { code: string; team: CwTeam; token: string }, ack: Ack<unknown>) =>
        this.spymasterJoinViaToken(socket, p, ack),
    );
    socket.on(
      "submitClue",
      (
        p: { word: string | null; number: CwClueNumber },
        ack: Ack<{ word: string | null; number: CwClueNumber }>,
      ) => this.submitClue(socket, p, ack),
    );
    socket.on("voteCard", (p: { target: number | "pass" }) => this.voteCard(socket, p));
    socket.on("revealCard", (p: { index: number }) => this.revealCardFromBoard(socket, p));
    socket.on("passTurn", () => this.passTurnFromBoard(socket));
  }

  protected sanitizeSettings(partial?: Partial<CodewordsSettings>): CodewordsSettings {
    return { mode: partial?.mode === "board" ? "board" : DEFAULT_CODEWORDS_SETTINGS.mode };
  }

  protected makeRoom(base: BaseRoom<CodewordsSettings, CodewordsPlayer>): CodewordsRoom {
    return {
      ...base,
      game: freshGame(),
      tokens:
        base.settings.mode === "board"
          ? { red: randomBytes(12).toString("hex"), blue: randomBytes(12).toString("hex") }
          : null,
    };
  }

  protected makePlayer(base: BasePlayer): CodewordsPlayer {
    return { ...base, team: null, role: "operative", isBoard: false };
  }

  protected roomMinPlayers(room: CodewordsRoom): number {
    // Board rooms bypass the generic count check; canStartExtra validates phones.
    return room.settings.mode === "board" ? 1 : CODEWORDS_REMOTE_MIN_PLAYERS;
  }

  protected roomMaxPlayers(room: CodewordsRoom): number {
    return room.settings.mode === "board"
      ? CODEWORDS_BOARD_ROOM_SIZE
      : CODEWORDS_REMOTE_MAX_PLAYERS;
  }

  protected joinBlocked(room: CodewordsRoom): string | null {
    return room.settings.mode === "board"
      ? "That room is a shared board — spymasters join by scanning its QR codes."
      : null;
  }

  protected quickPlayEligible(room: CodewordsRoom): boolean {
    return room.settings.mode === "remote";
  }

  protected quickPlayCreateSettings(): Partial<CodewordsSettings> {
    return { mode: "remote" };
  }

  protected canStartExtra(room: CodewordsRoom): string | null {
    if (room.settings.mode === "board") {
      for (const team of TEAMS) {
        const spy = this.spymasterOf(room, team);
        if (!spy || !spy.connected) {
          return `The ${cwTeamLabel(team)} spymaster phone isn't connected — scan the ${cwTeamLabel(team)} QR code.`;
        }
      }
      return null;
    }
    for (const p of room.players.values()) {
      if (!p.team) return "Everyone needs a team first.";
    }
    for (const team of TEAMS) {
      const members = this.teamMembers(room, team);
      if (!this.spymasterOf(room, team)) {
        return `Team ${cwTeamLabel(team)} needs a spymaster.`;
      }
      if (members.filter((p) => p.role === "operative").length < 1) {
        return `Team ${cwTeamLabel(team)} needs at least one operative.`;
      }
    }
    return null;
  }

  protected onPlayerJoined(room: CodewordsRoom, player: CodewordsPlayer, socket: AnySocket): void {
    if (room.settings.mode === "board") {
      // No ready ceremony on a shared board: the board + phones are always ready.
      player.ready = true;
      if (room.players.size === 1) {
        player.isBoard = true;
        if (room.tokens) socket.emit("boardTokens", { tokens: room.tokens });
      }
      return;
    }
    // Remote: default to the smaller team so lobbies stay balanced.
    const red = this.teamMembers(room, "red").length;
    const blue = this.teamMembers(room, "blue").length;
    this.moveToTeam(room, player, red <= blue ? "red" : "blue");
  }

  protected onRejoin(room: CodewordsRoom, player: CodewordsPlayer, socket: AnySocket): void {
    if (player.team) socket.join(this.teamRoom(room, player.team));
    if (player.isBoard && room.tokens) socket.emit("boardTokens", { tokens: room.tokens });
  }

  protected publicPlayer(_room: CodewordsRoom, p: CodewordsPlayer): CwPublicPlayer {
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
      team: p.team,
      role: p.role,
      isBoard: p.isBoard,
    };
  }

  protected snapshot(room: CodewordsRoom): CodewordsSnapshot {
    const g = room.game;
    const finished = room.state === "finished";
    return {
      code: room.code,
      isPublic: room.isPublic,
      state: room.state as CwState,
      hostId: room.hostId,
      settings: room.settings,
      players: [...room.players.values()].map((p) => this.publicPlayer(room, p)),
      lobbyCountdownEndsAt: room.lobbyCountdownEndsAt,
      gameOverReason: room.gameOverReason,
      // KEY SECRECY: identity appears ONLY once a card is revealed.
      board: g.words.map((word, i) => ({
        word,
        revealed: g.revealed[i],
        identity: g.revealed[i] ? g.key[i] : null,
      })),
      startingTeam: g.startingTeam,
      activeTeam: g.activeTeam,
      phase: g.phase,
      clue: g.clue,
      guessesRemaining: g.guessesRemaining,
      guessesMade: g.guessesMade,
      remaining: { ...g.remaining },
      clueHistory: g.clueHistory,
      needsSpymaster: this.needsSpymaster(room),
      winner: g.winner,
      fullKey: finished ? g.key : null,
    };
  }

  protected clearGameTimers(_room: CodewordsRoom): void {
    // Codewords is untimed — turns wait for humans.
  }

  protected resetGame(room: CodewordsRoom): void {
    // Same players, teams, and spymasters; a brand-new board and key.
    room.game = freshGame();
  }

  protected rejoinExtra(room: CodewordsRoom, player: CodewordsPlayer): Record<string, unknown> {
    const g = room.game;
    const activeTally =
      room.state === "playing" &&
      room.settings.mode === "remote" &&
      g.phase === "guess" &&
      player.team === g.activeTeam
        ? this.voteTally(room)
        : null;
    return {
      yourKey:
        player.role === "spymaster" && room.state !== "lobby" && g.key.length > 0 ? g.key : null,
      yourVote: g.votes.get(player.id) ?? null,
      voteTally: activeTally,
      boardTokens: player.isBoard ? room.tokens : null,
    };
  }

  protected onPlayerRemoved(room: CodewordsRoom, player: CodewordsPlayer, _reason: string): void {
    const g = room.game;
    g.votes.delete(player.id);

    // The shared board leaving kills the room in any state — the phones and
    // the game have nothing to render on.
    if (player.isBoard) {
      this.cnsp.to(room.code).emit("errorMsg", { message: "The shared board closed this room." });
      for (const p of [...room.players.values()]) {
        this.removePlayer(room, p, "removed");
      }
      return;
    }

    if (room.state !== "playing") return;

    if (room.settings.mode === "remote" && player.team) {
      const members = this.teamMembers(room, player.team);
      if (members.length < 2) {
        this.finish(
          room,
          otherCwTeam(player.team),
          `${player.name} left — team ${cwTeamLabel(player.team)} can't field a spymaster and an operative`,
        );
        return;
      }
      // Fewer connected operatives can lower the majority threshold.
      this.maybeApplyMajority(room);
    }
    // Board mode: a phone leaving just vacates the seat; re-scanning the QR
    // (or the needsSpymaster prompt) restores it.
  }

  protected onDisconnectDuringGame(room: CodewordsRoom): void {
    if (room.settings.mode === "remote") this.maybeApplyMajority(room);
  }

  // ---------- teams & helpers ----------

  private teamRoom(room: CodewordsRoom, team: CwTeam): string {
    return `${room.code}#${team}`;
  }

  private teamMembers(room: CodewordsRoom, team: CwTeam): CodewordsPlayer[] {
    return [...room.players.values()].filter((p) => p.team === team);
  }

  private spymasterOf(room: CodewordsRoom, team: CwTeam): CodewordsPlayer | null {
    return (
      [...room.players.values()].find((p) => p.team === team && p.role === "spymaster") ?? null
    );
  }

  private moveToTeam(room: CodewordsRoom, player: CodewordsPlayer, team: CwTeam | null): void {
    const sock = player.socketId ? this.cnsp.sockets.get(player.socketId) : null;
    if (player.team && sock) sock.leave(this.teamRoom(room, player.team));
    player.team = team;
    if (team && sock) sock.join(this.teamRoom(room, team));
  }

  private needsSpymaster(room: CodewordsRoom): CwTeam[] {
    if (room.state !== "playing") return [];
    return TEAMS.filter((team) => {
      const spy = this.spymasterOf(room, team);
      // Remote: a disconnected spymaster will rejoin — only a vacated seat needs
      // filling. Board: a disconnected phone needs a re-scan, so surface it.
      return room.settings.mode === "board" ? !spy || !spy.connected : !spy;
    });
  }

  private sendKeyTo(room: CodewordsRoom, player: CodewordsPlayer): void {
    if (!player.socketId || room.game.key.length === 0) return;
    this.cnsp.to(player.socketId).emit("yourKey", { key: room.game.key });
  }

  private sendKeys(room: CodewordsRoom): void {
    for (const p of room.players.values()) {
      if (p.role === "spymaster") this.sendKeyTo(room, p);
    }
  }

  // ---------- lobby: teams & spymasters ----------

  private assignTeam(socket: AnySocket, payload: { team: CwTeam }): void {
    const ctx = this.roomOf(socket);
    if (!ctx || ctx.room.state !== "lobby") return;
    const { room, player } = ctx;
    if (room.settings.mode === "board" || player.isBoard) return;
    const team: CwTeam | null =
      payload?.team === "red" ? "red" : payload?.team === "blue" ? "blue" : null;
    if (!team || team === player.team) return;
    // Switching teams never carries the spymaster seat along.
    player.role = "operative";
    this.moveToTeam(room, player, team);
    this.broadcastRoom(room);
  }

  private setSpymaster(socket: AnySocket, payload: { playerId: string }): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.settings.mode === "board") return;
    const target = room.players.get(String(payload?.playerId ?? ""));
    if (!target || !target.team) return;
    if (player.id !== room.hostId && player.id !== target.id) {
      this.emitError(socket, "Only the host (or the player themselves) can do that.");
      return;
    }
    if (room.state === "lobby") {
      const current = this.spymasterOf(room, target.team);
      if (current && current.id !== target.id) current.role = "operative";
      target.role = "spymaster";
      this.broadcastRoom(room);
      return;
    }
    if (room.state === "playing") {
      // Mid-game only to fill a vacated seat (the old spymaster left the room).
      if (this.spymasterOf(room, target.team)) {
        this.emitError(socket, `Team ${cwTeamLabel(target.team)} already has a spymaster.`);
        return;
      }
      target.role = "spymaster";
      room.game.votes.delete(target.id);
      this.sendKeyTo(room, target);
      this.broadcastRoom(room);
      if (room.game.phase === "guess") this.maybeApplyMajority(room);
    }
  }

  private spymasterJoinViaToken(
    socket: AnySocket,
    payload: { code: string; team: CwTeam; token: string },
    ack: Ack<unknown>,
  ): void {
    const code = String(payload?.code ?? "").trim().toUpperCase();
    const team: CwTeam | null =
      payload?.team === "red" ? "red" : payload?.team === "blue" ? "blue" : null;
    const room = this.store.get(code);
    if (!room || room.settings.mode !== "board" || !room.tokens || !team) {
      return ack({ ok: false, error: "That shared board is no longer available." });
    }
    if (String(payload?.token ?? "") !== room.tokens[team]) {
      return ack({ ok: false, error: "This QR link is not valid for that room." });
    }
    const existing = this.spymasterOf(room, team);
    if (existing?.connected) {
      return ack({
        ok: false,
        error: `The ${cwTeamLabel(team)} spymaster is already connected on another phone.`,
      });
    }
    // A re-scan replaces a phone that dropped without rejoining.
    if (existing) this.removePlayer(room, existing, "removed");
    this.detachFromCurrentRoom(socket);
    const player = this.addPlayerToRoom(socket, room, `${cwTeamLabel(team)} Spymaster`);
    player.team = team;
    player.role = "spymaster";
    player.ready = true;
    socket.join(this.teamRoom(room, team));
    // Mid-game scans (or start-of-game joins) get the key immediately.
    if (room.state !== "lobby") this.sendKeyTo(room, player);
    this.broadcastRoom(room);
    ack({
      ok: true,
      data: {
        playerId: player.id,
        code: room.code,
        link: `/codewords/remote?room=${room.code}`,
        room: this.snapshot(room),
      },
    });
  }

  // ---------- game start ----------

  protected beginGame(room: CodewordsRoom): void {
    if (room.settings.mode === "remote") {
      // Self-heal for the auto-start path (full public lobby): everyone gets a
      // team, and a team without a spymaster promotes its first member.
      for (const p of room.players.values()) {
        if (!p.team) {
          const red = this.teamMembers(room, "red").length;
          const blue = this.teamMembers(room, "blue").length;
          this.moveToTeam(room, p, red <= blue ? "red" : "blue");
        }
      }
      for (const team of TEAMS) {
        if (!this.spymasterOf(room, team)) {
          const first = this.teamMembers(room, team)[0];
          if (first) first.role = "spymaster";
        }
      }
    }
    const g = (room.game = freshGame());
    g.words = drawBoardWords(CW_BOARD_SIZE);
    g.revealed = g.words.map(() => false);
    const startingTeam: CwTeam = Math.random() < 0.5 ? "red" : "blue";
    const second = otherCwTeam(startingTeam);
    const identities: CwIdentity[] = [
      ...Array<CwIdentity>(CW_STARTING_TEAM_AGENTS).fill(startingTeam),
      ...Array<CwIdentity>(CW_SECOND_TEAM_AGENTS).fill(second),
      ...Array<CwIdentity>(CW_BYSTANDERS).fill("bystander"),
      "assassin",
    ];
    g.key = shuffle(identities);
    g.startingTeam = startingTeam;
    g.activeTeam = startingTeam;
    g.phase = "clue";
    g.remaining = {
      red: startingTeam === "red" ? CW_STARTING_TEAM_AGENTS : CW_SECOND_TEAM_AGENTS,
      blue: startingTeam === "blue" ? CW_STARTING_TEAM_AGENTS : CW_SECOND_TEAM_AGENTS,
    };
    room.state = "playing";
    this.broadcastRoom(room);
    this.cnsp.to(room.code).emit("gameStart", { room: this.snapshot(room) });
    this.sendKeys(room);
  }

  // ---------- clues ----------

  private submitClue(
    socket: AnySocket,
    payload: { word: string | null; number: CwClueNumber },
    ack: Ack<{ word: string | null; number: CwClueNumber }>,
  ): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    const g = room.game;
    if (room.state !== "playing" || g.phase !== "clue" || !g.activeTeam) {
      return ack({ ok: false, error: "It's not clue time." });
    }

    const isManualBoardClue = player.isBoard && room.settings.mode === "board";
    if (!isManualBoardClue) {
      if (player.role !== "spymaster" || player.team !== g.activeTeam) {
        return ack({
          ok: false,
          error: `Only the ${cwTeamLabel(g.activeTeam)} spymaster can give a clue right now.`,
        });
      }
    }

    // Number: 0..9 or "unlimited"; 0 and "unlimited" both mean uncapped guesses.
    let number: CwClueNumber;
    if (payload?.number === "unlimited") {
      number = "unlimited";
    } else {
      const n = Math.floor(Number(payload?.number));
      if (!Number.isFinite(n) || n < 0 || n > CW_MAX_CLUE_NUMBER) {
        return ack({ ok: false, error: `Number must be 0-${CW_MAX_CLUE_NUMBER} or unlimited.` });
      }
      number = n;
    }

    let word: string | null = null;
    if (isManualBoardClue && (payload?.word == null || payload.word === "")) {
      // Spoken clue: the board only tracks the number for the guess counter.
      word = null;
    } else {
      word = String(payload?.word ?? "").trim().toLowerCase();
      if (!word || /\s/.test(word) || word.length > 24) {
        return ack({ ok: false, error: "The clue must be one single word." });
      }
      for (let i = 0; i < g.words.length; i++) {
        if (g.revealed[i]) continue;
        const boardWord = g.words[i];
        if (word === boardWord || word.includes(boardWord) || boardWord.includes(word)) {
          return ack({
            ok: false,
            error: `"${word.toUpperCase()}" overlaps "${boardWord.toUpperCase()}" on the board — pick another clue.`,
          });
        }
      }
    }

    g.clue = { team: g.activeTeam, word, number };
    g.clueHistory.push({ ...g.clue, guesses: [] });
    g.guessesRemaining = number === "unlimited" || number === 0 ? null : number + 1;
    g.guessesMade = 0;
    g.phase = "guess";
    g.votes.clear();
    ack({ ok: true, data: { word, number } });
    this.cnsp.to(room.code).emit("clueGiven", g.clue);
    this.cnsp.to(room.code).emit("turnChange", {
      activeTeam: g.activeTeam,
      phase: "guess",
      guessesRemaining: g.guessesRemaining,
    });
    this.broadcastRoom(room);
  }

  // ---------- remote mode: guessing by majority vote ----------

  /** Connected operatives on the active team — the electorate for reveals. */
  private activeOperatives(room: CodewordsRoom): CodewordsPlayer[] {
    const g = room.game;
    if (!g.activeTeam) return [];
    return [...room.players.values()].filter(
      (p) => p.team === g.activeTeam && p.role === "operative" && p.connected && !p.isBoard,
    );
  }

  private voteTally(room: CodewordsRoom): CwVoteTally {
    const g = room.game;
    const electorate = new Set(this.activeOperatives(room).map((p) => p.id));
    const cards: Record<number, number> = {};
    let pass = 0;
    for (const [voterId, target] of g.votes.entries()) {
      if (!electorate.has(voterId)) continue;
      if (target === "pass") pass++;
      else cards[target] = (cards[target] ?? 0) + 1;
    }
    return { cards, pass, needed: Math.floor(electorate.size / 2) + 1 };
  }

  private voteCard(socket: AnySocket, payload: { target: number | "pass" }): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const g = room.game;
    if (
      room.state !== "playing" ||
      room.settings.mode !== "remote" ||
      g.phase !== "guess" ||
      !g.activeTeam
    ) {
      return;
    }
    if (player.team !== g.activeTeam || player.role !== "operative") {
      this.emitError(socket, "Only the guessing team's operatives can vote right now.");
      return;
    }
    let target: number | "pass";
    if (payload?.target === "pass") {
      if (g.guessesMade < 1) {
        this.emitError(socket, "Your team must make at least one guess before passing.");
        return;
      }
      target = "pass";
    } else {
      const index = Math.floor(Number(payload?.target));
      if (!Number.isInteger(index) || index < 0 || index >= g.words.length || g.revealed[index]) {
        return;
      }
      target = index;
    }
    // Toggle: tapping your current vote clears it; tapping elsewhere moves it.
    if (g.votes.get(player.id) === target) g.votes.delete(player.id);
    else g.votes.set(player.id, target);
    this.emitVoteUpdate(room);
    this.maybeApplyMajority(room);
  }

  private emitVoteUpdate(room: CodewordsRoom): void {
    const g = room.game;
    if (!g.activeTeam) return;
    this.cnsp.to(this.teamRoom(room, g.activeTeam)).emit("voteUpdate", this.voteTally(room));
  }

  /** Reveal (or pass) once a majority of connected operatives agree. */
  private maybeApplyMajority(room: CodewordsRoom): void {
    const g = room.game;
    if (room.state !== "playing" || room.settings.mode !== "remote" || g.phase !== "guess") {
      return;
    }
    const tally = this.voteTally(room);
    const electorate = this.activeOperatives(room);
    if (electorate.length === 0) return;
    if (tally.pass >= tally.needed && g.guessesMade >= 1) {
      this.endTurn(room);
      return;
    }
    for (const [indexStr, count] of Object.entries(tally.cards)) {
      if (count >= tally.needed) {
        this.applyReveal(room, Number(indexStr));
        return;
      }
    }
  }

  // ---------- board mode: taps on the shared screen ----------

  private revealCardFromBoard(socket: AnySocket, payload: { index: number }): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const g = room.game;
    if (!player.isBoard || room.state !== "playing" || g.phase !== "guess") {
      if (player.isBoard && g.phase === "clue") {
        this.emitError(socket, "Give (or log) a clue before guessing.");
      }
      return;
    }
    const index = Math.floor(Number(payload?.index));
    if (!Number.isInteger(index) || index < 0 || index >= g.words.length || g.revealed[index]) {
      return;
    }
    this.applyReveal(room, index);
  }

  private passTurnFromBoard(socket: AnySocket): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const g = room.game;
    if (!player.isBoard || room.state !== "playing" || g.phase !== "guess") return;
    if (g.guessesMade < 1) {
      this.emitError(socket, "The team must make at least one guess before passing.");
      return;
    }
    this.endTurn(room);
  }

  // ---------- reveals, turns, and the end ----------

  private applyReveal(room: CodewordsRoom, index: number): void {
    const g = room.game;
    if (!g.activeTeam || g.revealed[index]) return;
    const byTeam = g.activeTeam;
    const identity = g.key[index];
    g.revealed[index] = true;
    g.votes.clear();
    g.guessesMade += 1;
    const record = g.clueHistory[g.clueHistory.length - 1];
    if (record) record.guesses.push({ index, word: g.words[index], identity });
    if (identity === "red" || identity === "blue") g.remaining[identity] -= 1;

    const outcome =
      identity === byTeam
        ? "agent"
        : identity === "assassin"
          ? "assassin"
          : identity === "bystander"
            ? "bystander"
            : "opponent";
    this.cnsp.to(room.code).emit("cardRevealed", { index, identity, byTeam, outcome });
    if (room.settings.mode === "remote") this.emitVoteUpdate(room);

    if (identity === "assassin") {
      this.finish(room, otherCwTeam(byTeam), `team ${cwTeamLabel(byTeam)} hit the assassin`);
      return;
    }
    if ((identity === "red" || identity === "blue") && g.remaining[identity] === 0) {
      this.finish(room, identity, `team ${cwTeamLabel(identity)} found all their agents`);
      return;
    }
    if (outcome === "agent") {
      if (g.guessesRemaining !== null) {
        g.guessesRemaining -= 1;
        if (g.guessesRemaining <= 0) {
          this.endTurn(room);
          return;
        }
      }
      this.broadcastRoom(room);
      return;
    }
    // Bystander or the other team's agent: the turn is over.
    this.endTurn(room);
  }

  private endTurn(room: CodewordsRoom): void {
    const g = room.game;
    if (!g.activeTeam) return;
    g.activeTeam = otherCwTeam(g.activeTeam);
    g.phase = "clue";
    g.clue = null;
    g.guessesRemaining = null;
    g.guessesMade = 0;
    g.votes.clear();
    this.cnsp.to(room.code).emit("turnChange", {
      activeTeam: g.activeTeam,
      phase: "clue",
      guessesRemaining: null,
    });
    this.broadcastRoom(room);
  }

  private finish(room: CodewordsRoom, winner: CwTeam, reason: string): void {
    if (room.state === "finished") return;
    const g = room.game;
    room.state = "finished";
    room.gameOverReason = reason;
    g.winner = winner;
    g.phase = null;
    // Everyone sees the full key at the reveal.
    this.cnsp.to(room.code).emit("gameOver", { winner, reason, fullKey: g.key });
    // Stats: remote games only — board-mode "players" are a screen and two
    // convenience phones, not real per-person seats.
    if (room.settings.mode === "remote") {
      const participants = [...room.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        userId: p.userId,
      }));
      const winnerIds = this.teamMembers(room, winner).map((p) => p.id);
      if (participants.length > 0) this.stats.recordGame(participants, winnerIds, "codewords");
    }
    this.broadcastRoom(room);
  }
}

import type { Namespace } from "socket.io";
import type { Ack, SocketData } from "../../../shared/events.js";
import {
  ANY_CATEGORY_ID,
  DEFAULT_TRIVIA_SETTINGS,
  type CustomSetInfo,
  TRIVIA_MAX_PLAYERS,
  TRIVIA_MIN_PLAYERS,
  type CategoryOption,
  type ScoreboardEntry,
  type TriviaClientEvents,
  type TriviaPublicPlayer,
  type TriviaQuestionPublic,
  type TriviaRevealPayload,
  type TriviaServerEvents,
  type TriviaSettings,
  type TriviaSnapshot,
  type TriviaState,
} from "../../../shared/trivia.js";
import type { RoomStore } from "../store.js";
import type { StatsStore } from "../stats.js";
import {
  BaseRoomManager,
  clamp,
  type AnySocket,
  type BasePlayer,
  type BaseRoom,
} from "../core/roomManager.js";
import type { PreparedQuestion, QuestionSource } from "./questionSource.js";
import { describeAccessibleSet, loadAccessibleSet } from "./customSets.js";

type TriviaNamespace = Namespace<
  TriviaClientEvents,
  TriviaServerEvents,
  Record<string, never>,
  SocketData
>;

type TriviaPlayer = BasePlayer;

interface TriviaGameData {
  voteOptions: CategoryOption[];
  votes: Map<string, number>;
  voteDeadline: number | null;
  voteTimer: NodeJS.Timeout | null;
  chosenCategory: CategoryOption | null;
  questions: PreparedQuestion[];
  qIndex: number;
  answers: Map<string, { choice: number; at: number }>;
  questionDeadline: number | null;
  questionStartAt: number;
  questionTimer: NodeJS.Timeout | null;
  revealTimer: NodeJS.Timeout | null;
  scores: Map<string, number>;
  lastReveal: TriviaRevealPayload | null;
  resolving: boolean;
  /** Bumped whenever a new game starts so stale async fetches are discarded. */
  fetchSeq: number;
}

interface TriviaRoom extends BaseRoom<TriviaSettings, TriviaPlayer> {
  game: TriviaGameData;
  /** Host-picked custom set (private lobbies only). Survives playAgain;
   *  re-authorized against the CURRENT host at every game start. */
  customSet: CustomSetInfo | null;
}

const VOTE_OPTION_COUNT = 5;
const BASE_POINTS = 1000;

function freshGame(fetchSeq: number): TriviaGameData {
  return {
    voteOptions: [],
    votes: new Map(),
    voteDeadline: null,
    voteTimer: null,
    chosenCategory: null,
    questions: [],
    qIndex: 0,
    answers: new Map(),
    questionDeadline: null,
    questionStartAt: 0,
    questionTimer: null,
    revealTimer: null,
    scores: new Map(),
    lastReveal: null,
    resolving: false,
    fetchSeq,
  };
}

function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export class TriviaManager extends BaseRoomManager<TriviaSettings, TriviaPlayer, TriviaRoom> {
  protected minPlayers = TRIVIA_MIN_PLAYERS;
  protected maxPlayers = TRIVIA_MAX_PLAYERS;

  constructor(
    private tnsp: TriviaNamespace,
    store: RoomStore<TriviaRoom>,
    private source: QuestionSource,
    private stats: StatsStore,
  ) {
    super(tnsp, store, "/trivia");
  }

  // ---------- base hooks ----------

  protected bindGameEvents(socket: AnySocket): void {
    socket.on("voteCategory", (payload: { categoryId: number }) =>
      this.voteCategory(socket, payload),
    );
    socket.on("answer", (payload: { optionIndex: number }, ack: Ack<{ optionIndex: number }>) =>
      this.answer(socket, payload, ack),
    );
    socket.on("setDifficulty", (payload: { difficulty: string }) =>
      this.setDifficulty(socket, payload),
    );
    socket.on(
      "setCustomSet",
      (payload: { setId: string | null }, ack: Ack<{ set: CustomSetInfo | null }>) =>
        void this.setCustomSet(socket, payload, ack),
    );
  }

  protected sanitizeSettings(partial?: Partial<TriviaSettings>): TriviaSettings {
    const s = { ...DEFAULT_TRIVIA_SETTINGS, ...partial };
    const difficulty =
      s.difficulty === "easy" || s.difficulty === "hard" ? s.difficulty : "medium";
    return {
      questionsPerGame: clamp(
        Number(s.questionsPerGame) || DEFAULT_TRIVIA_SETTINGS.questionsPerGame,
        3,
        25,
      ),
      questionTimeSec: clamp(
        Number(s.questionTimeSec) || DEFAULT_TRIVIA_SETTINGS.questionTimeSec,
        5,
        60,
      ),
      difficulty,
      revealPauseSec: clamp(
        Number(s.revealPauseSec) || DEFAULT_TRIVIA_SETTINGS.revealPauseSec,
        1,
        30,
      ),
      categoryVoteSec: clamp(
        Number(s.categoryVoteSec) || DEFAULT_TRIVIA_SETTINGS.categoryVoteSec,
        5,
        60,
      ),
    };
  }

  protected makeRoom(base: BaseRoom<TriviaSettings, TriviaPlayer>): TriviaRoom {
    return { ...base, game: freshGame(0), customSet: null };
  }

  protected makePlayer(base: BasePlayer): TriviaPlayer {
    return base;
  }

  protected publicPlayer(room: TriviaRoom, p: TriviaPlayer): TriviaPublicPlayer {
    return {
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
      score: room.game.scores.get(p.id) ?? 0,
      answered: room.game.answers.has(p.id),
      voted: room.game.votes.has(p.id),
    };
  }

  private scoreboard(room: TriviaRoom): ScoreboardEntry[] {
    return [...room.players.values()]
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        totalScore: room.game.scores.get(p.id) ?? 0,
      }))
      .sort((a, b) => b.totalScore - a.totalScore || a.name.localeCompare(b.name));
  }

  private winners(room: TriviaRoom): ScoreboardEntry[] {
    const board = this.scoreboard(room);
    if (board.length === 0) return [];
    const top = board[0].totalScore;
    return board.filter((e) => e.totalScore === top);
  }

  private currentQuestionPublic(room: TriviaRoom): TriviaQuestionPublic | null {
    const game = room.game;
    const q = game.questions[game.qIndex];
    if (room.state !== "playing" || !q) return null;
    return {
      index: game.qIndex,
      total: game.questions.length,
      category: q.category,
      questionText: q.questionText,
      options: q.options,
      deadline: game.questionDeadline ?? 0,
    };
  }

  protected snapshot(room: TriviaRoom): TriviaSnapshot {
    const game = room.game;
    return {
      code: room.code,
      isPublic: room.isPublic,
      state: room.state as TriviaState,
      hostId: room.hostId,
      settings: room.settings,
      players: [...room.players.values()].map((p) => this.publicPlayer(room, p)),
      lobbyCountdownEndsAt: room.lobbyCountdownEndsAt,
      gameOverReason: room.gameOverReason,
      vote:
        room.state === "voting" && game.voteOptions.length > 0
          ? {
              options: game.voteOptions,
              tally: this.tally(room),
              deadline: game.voteDeadline ?? 0,
            }
          : null,
      chosenCategory: game.chosenCategory?.name ?? null,
      customSet: room.customSet,
      question: this.currentQuestionPublic(room),
      lastReveal: game.lastReveal,
      scoreboard: this.scoreboard(room),
      winners: room.state === "finished" ? this.winners(room) : null,
    };
  }

  protected clearGameTimers(room: TriviaRoom): void {
    const game = room.game;
    if (game.voteTimer) clearTimeout(game.voteTimer);
    if (game.questionTimer) clearTimeout(game.questionTimer);
    if (game.revealTimer) clearTimeout(game.revealTimer);
    game.voteTimer = null;
    game.questionTimer = null;
    game.revealTimer = null;
  }

  protected resetGame(room: TriviaRoom): void {
    this.clearGameTimers(room);
    room.game = freshGame(room.game.fetchSeq + 1);
  }

  protected rejoinExtra(room: TriviaRoom, player: TriviaPlayer): Record<string, unknown> {
    return { yourAnswer: room.game.answers.get(player.id)?.choice ?? null };
  }

  protected onPlayerRemoved(room: TriviaRoom, player: TriviaPlayer): void {
    room.game.votes.delete(player.id);
    room.game.answers.delete(player.id);
    room.game.scores.delete(player.id);
  }

  protected afterLeaveDuringGame(room: TriviaRoom): void {
    if (room.players.size < this.minPlayers) {
      this.finishGame(room, "not enough players");
      return;
    }
    this.maybeResolveVoteEarly(room);
    this.maybeResolveQuestionEarly(room);
  }

  protected onDisconnectDuringGame(room: TriviaRoom): void {
    // Disconnects never remove a player mid-game; they just stop blocking the
    // fast paths. The <2-connected check happens when the question resolves.
    this.maybeResolveVoteEarly(room);
    this.maybeResolveQuestionEarly(room);
  }

  // ---------- lobby extras ----------

  private setDifficulty(socket: AnySocket, payload: { difficulty: string }): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (room.state !== "lobby") return;
    if (player.id !== room.hostId) {
      this.emitError(socket, "Only the host can change the difficulty.");
      return;
    }
    const d = payload?.difficulty;
    if (d !== "easy" && d !== "medium" && d !== "hard") return;
    room.settings = { ...room.settings, difficulty: d };
    this.broadcastRoom(room);
  }

  /**
   * Host picks a custom question set (or clears it). PRIVATE lobbies only —
   * quick play / public matchmaking always uses the OpenTDB vote. The server
   * verifies IN CODE that the host owns the set or holds a share (the loader
   * uses the service role, which bypasses RLS).
   */
  private async setCustomSet(
    socket: AnySocket,
    payload: { setId: string | null },
    ack: Ack<{ set: CustomSetInfo | null }>,
  ): Promise<void> {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    if (room.state !== "lobby") return ack({ ok: false, error: "The game already started." });
    if (player.id !== room.hostId) {
      return ack({ ok: false, error: "Only the host can pick the question source." });
    }
    if (room.isPublic) {
      return ack({ ok: false, error: "Custom sets are for private lobbies only." });
    }
    if (payload?.setId == null) {
      room.customSet = null;
      this.broadcastRoom(room);
      return ack({ ok: true, data: { set: null } });
    }
    const userId = socket.data.userId;
    if (!userId) return ack({ ok: false, error: "Sign in to use your custom sets." });
    const res = await describeAccessibleSet(userId, String(payload.setId));
    if (!res.ok) return ack({ ok: false, error: res.error });
    if (room.state !== "lobby" || player.id !== room.hostId) {
      return ack({ ok: false, error: "The lobby changed — try again." });
    }
    room.customSet = res.info;
    this.broadcastRoom(room);
    ack({ ok: true, data: { set: res.info } });
  }

  // ---------- category vote ----------

  protected beginGame(room: TriviaRoom): void {
    room.state = "voting";
    room.game = freshGame(room.game.fetchSeq + 1);
    if (room.customSet && !room.isPublic) {
      // Custom set: no category vote — "voting" is just a brief loading state.
      this.broadcastRoom(room);
      void this.loadCustomSetAndStart(room);
      return;
    }
    room.customSet = null; // never let a stale pick leak into a public game
    this.broadcastRoom(room);
    void this.startVote(room);
  }

  /** Load the chosen set, re-authorizing against the CURRENT host; on any
   *  failure fall back to the normal category vote so the game still starts. */
  private async loadCustomSetAndStart(room: TriviaRoom): Promise<void> {
    const game = room.game;
    const seq = game.fetchSeq;
    const chosen = room.customSet!;
    const host = room.hostId ? room.players.get(room.hostId) : null;
    const result = host?.userId
      ? await loadAccessibleSet(host.userId, chosen.setId, room.settings.questionsPerGame)
      : ({ ok: false, error: "The host isn't signed in." } as const);
    if (!this.store.has(room.code) || room.state !== "voting" || game.fetchSeq !== seq) {
      return;
    }
    if (!result.ok) {
      room.customSet = null;
      this.tnsp.to(room.code).emit("errorMsg", {
        message: `Custom set unavailable (${result.error}) — falling back to a category vote.`,
      });
      this.broadcastRoom(room);
      void this.startVote(room);
      return;
    }
    room.customSet = result.info; // refresh the playable count shown to players
    game.chosenCategory = { id: ANY_CATEGORY_ID, name: result.info.title };
    room.state = "playing";
    game.questions = result.questions;
    game.qIndex = 0;
    this.startQuestion(room);
  }

  private async startVote(room: TriviaRoom): Promise<void> {
    const seq = room.game.fetchSeq;
    const categories = await this.source.getCategories();
    if (!this.store.has(room.code) || room.state !== "voting" || room.game.fetchSeq !== seq) {
      return;
    }
    const game = room.game;
    game.voteOptions = [
      { id: ANY_CATEGORY_ID, name: "Surprise Me (Any)" },
      ...sample(categories, VOTE_OPTION_COUNT),
    ];
    game.voteDeadline = Date.now() + room.settings.categoryVoteSec * 1000;
    this.tnsp.to(room.code).emit("voteStart", {
      options: game.voteOptions,
      deadline: game.voteDeadline,
    });
    this.broadcastRoom(room);
    game.voteTimer = setTimeout(() => {
      game.voteTimer = null;
      this.resolveVote(room);
    }, room.settings.categoryVoteSec * 1000);
  }

  private tally(room: TriviaRoom): Record<number, number> {
    const tally: Record<number, number> = {};
    for (const categoryId of room.game.votes.values()) {
      tally[categoryId] = (tally[categoryId] ?? 0) + 1;
    }
    return tally;
  }

  private voteCategory(socket: AnySocket, payload: { categoryId: number }): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const game = room.game;
    if (room.state !== "voting" || game.chosenCategory || game.voteOptions.length === 0) {
      return;
    }
    const categoryId = Number(payload?.categoryId);
    if (!game.voteOptions.some((o) => o.id === categoryId)) return;
    // Players may change their vote until the deadline.
    game.votes.set(player.id, categoryId);
    this.tnsp.to(room.code).emit("voteUpdate", { tally: this.tally(room) });
    this.broadcastRoom(room);
    this.maybeResolveVoteEarly(room);
  }

  private maybeResolveVoteEarly(room: TriviaRoom): void {
    if (room.state !== "voting" || room.game.chosenCategory) return;
    const connected = [...room.players.values()].filter((p) => p.connected);
    if (connected.length === 0) return;
    if (connected.every((p) => room.game.votes.has(p.id))) {
      this.resolveVote(room);
    }
  }

  private resolveVote(room: TriviaRoom): void {
    if (room.state !== "voting" || room.game.chosenCategory) return;
    const game = room.game;
    if (game.voteTimer) {
      clearTimeout(game.voteTimer);
      game.voteTimer = null;
    }
    // Most votes wins; ties broken randomly; nobody voted -> "Any".
    const tally = this.tally(room);
    const max = Math.max(0, ...Object.values(tally));
    const leaders = game.voteOptions.filter((o) => (tally[o.id] ?? 0) === max && max > 0);
    game.chosenCategory =
      leaders.length > 0
        ? leaders[Math.floor(Math.random() * leaders.length)]
        : game.voteOptions[0]; // "Surprise Me (Any)"
    this.tnsp.to(room.code).emit("voteUpdate", { tally });
    this.broadcastRoom(room);
    void this.fetchAndStart(room);
  }

  private async fetchAndStart(room: TriviaRoom): Promise<void> {
    const game = room.game;
    const seq = game.fetchSeq;
    const chosen = game.chosenCategory!;
    let questions: PreparedQuestion[] = [];
    try {
      // ONE batched fetch for the whole game (OpenTDB rate limit: ~1 req/5s).
      questions = await this.source.getQuestions({
        category: chosen.id === ANY_CATEGORY_ID ? undefined : chosen.id,
        difficulty: room.settings.difficulty,
        amount: room.settings.questionsPerGame,
      });
    } catch (err) {
      console.warn("[trivia] question fetch failed:", err);
    }
    if (!this.store.has(room.code) || room.state !== "voting" || game.fetchSeq !== seq) {
      return; // room closed, game reset, or restarted while fetching
    }
    if (questions.length === 0) {
      this.finishGame(room, "could not load questions");
      return;
    }
    room.state = "playing";
    game.questions = questions;
    game.qIndex = 0;
    this.startQuestion(room);
  }

  // ---------- question loop ----------

  private startQuestion(room: TriviaRoom): void {
    if (room.state !== "playing") return;
    const game = room.game;
    game.answers.clear();
    game.resolving = false;
    game.lastReveal = null;
    game.questionStartAt = Date.now();
    game.questionDeadline = game.questionStartAt + room.settings.questionTimeSec * 1000;
    const pub = this.currentQuestionPublic(room)!;
    this.tnsp.to(room.code).emit("questionStart", pub);
    this.broadcastRoom(room);
    game.questionTimer = setTimeout(() => {
      game.questionTimer = null;
      this.resolveQuestion(room);
    }, room.settings.questionTimeSec * 1000);
  }

  private answer(
    socket: AnySocket,
    payload: { optionIndex: number },
    ack: Ack<{ optionIndex: number }>,
  ): void {
    const ctx = this.roomOf(socket);
    if (!ctx) return ack({ ok: false, error: "You are not in a room." });
    const { room, player } = ctx;
    const game = room.game;
    if (room.state !== "playing" || game.resolving || game.questionDeadline === null) {
      return ack({ ok: false, error: "There is no question to answer right now." });
    }
    if (game.answers.has(player.id)) {
      return ack({ ok: false, error: "Your answer is already locked in." });
    }
    const q = game.questions[game.qIndex];
    const optionIndex = Number(payload?.optionIndex);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= q.options.length) {
      return ack({ ok: false, error: "Invalid answer." });
    }
    // Answers lock immediately; the server clock decides the speed bonus.
    game.answers.set(player.id, {
      choice: optionIndex,
      at: Math.min(Date.now(), game.questionDeadline),
    });
    ack({ ok: true, data: { optionIndex } });
    this.tnsp.to(room.code).emit("playerAnswered", { playerId: player.id });
    this.broadcastRoom(room);
    this.maybeResolveQuestionEarly(room);
  }

  /** Fast path: if every connected player has answered, resolve immediately. */
  private maybeResolveQuestionEarly(room: TriviaRoom): void {
    if (room.state !== "playing" || room.game.resolving) return;
    const connected = [...room.players.values()].filter((p) => p.connected);
    if (connected.length === 0) return;
    if (connected.every((p) => room.game.answers.has(p.id))) {
      this.resolveQuestion(room);
    }
  }

  private resolveQuestion(room: TriviaRoom): void {
    if (room.state !== "playing" || room.game.resolving) return;
    const game = room.game;
    game.resolving = true;
    if (game.questionTimer) {
      clearTimeout(game.questionTimer);
      game.questionTimer = null;
    }
    game.questionDeadline = null;

    const q = game.questions[game.qIndex];
    const questionTimeMs = room.settings.questionTimeSec * 1000;
    const perPlayer = [...room.players.values()].map((p) => {
      const a = game.answers.get(p.id);
      const correct = a !== undefined && a.choice === q.correctIndex;
      let pointsEarned = 0;
      if (correct && a) {
        // 1000 points decaying linearly to 500 at the deadline.
        const elapsed = Math.min(Math.max(a.at - game.questionStartAt, 0), questionTimeMs);
        pointsEarned = Math.round(BASE_POINTS * (1 - 0.5 * (elapsed / questionTimeMs)));
        game.scores.set(p.id, (game.scores.get(p.id) ?? 0) + pointsEarned);
      }
      return {
        playerId: p.id,
        name: p.name,
        choice: a?.choice ?? null,
        correct,
        pointsEarned,
      };
    });

    const reveal: TriviaRevealPayload = {
      index: game.qIndex,
      correctIndex: q.correctIndex,
      perPlayer,
      scoreboard: this.scoreboard(room),
    };
    game.lastReveal = reveal;
    this.tnsp.to(room.code).emit("questionReveal", reveal);
    this.broadcastRoom(room);

    const isLast = game.qIndex >= game.questions.length - 1;
    const connectedCount = [...room.players.values()].filter((p) => p.connected).length;
    if (isLast) {
      this.finishGame(room);
      return;
    }
    if (connectedCount < this.minPlayers) {
      this.finishGame(room, "not enough players connected");
      return;
    }

    // Reveal pause with a per-second countdown, then the next question.
    let secondsLeft = room.settings.revealPauseSec;
    this.tnsp.to(room.code).emit("revealCountdown", { secondsLeft });
    const tick = () => {
      secondsLeft -= 1;
      if (room.state !== "playing") return;
      if (secondsLeft > 0) {
        this.tnsp.to(room.code).emit("revealCountdown", { secondsLeft });
        game.revealTimer = setTimeout(tick, 1000);
      } else {
        game.revealTimer = null;
        game.qIndex += 1;
        this.startQuestion(room);
      }
    };
    game.revealTimer = setTimeout(tick, 1000);
  }

  private finishGame(room: TriviaRoom, reason?: string): void {
    if (room.state === "finished") return;
    room.state = "finished";
    room.gameOverReason = reason ?? null;
    this.clearGameTimers(room);
    room.game.questionDeadline = null;
    const finalScoreboard = this.scoreboard(room);
    const winners = this.winners(room);
    const participants = [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      userId: p.userId,
    }));
    if (participants.length > 0) {
      this.stats.recordGame(participants, winners.map((w) => w.playerId), "trivia");
    }
    this.tnsp.to(room.code).emit("gameOver", { finalScoreboard, winners, reason });
    this.broadcastRoom(room);
  }
}

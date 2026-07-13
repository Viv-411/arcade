import { useCallback, useReducer } from "react";
import type {
  CategoryOption,
  ScoreboardEntry,
  TriviaDifficulty,
  TriviaQuestionPublic,
  TriviaRejoinResult,
  TriviaRevealPayload,
  TriviaSettings,
  TriviaSnapshot,
} from "@shared/trivia";
import { useRoomCore, type GameApi } from "../core/useRoomCore";

interface TriviaGameState {
  vote: { options: CategoryOption[]; tally: Record<number, number>; deadline: number } | null;
  myVote: number | null;
  question: TriviaQuestionPublic | null;
  /** Your locked answer for the current question (optimistically set). */
  myChoice: number | null;
  reveal: TriviaRevealPayload | null;
  revealSecondsLeft: number | null;
  final: { finalScoreboard: ScoreboardEntry[]; winners: ScoreboardEntry[]; reason?: string } | null;
}

type GameAction =
  | { type: "voteStart"; options: CategoryOption[]; deadline: number }
  | { type: "voteUpdate"; tally: Record<number, number> }
  | { type: "votedSelf"; categoryId: number }
  | { type: "questionStart"; question: TriviaQuestionPublic }
  | { type: "answeredSelf"; optionIndex: number }
  | { type: "answerRejected" }
  | { type: "questionReveal"; reveal: TriviaRevealPayload }
  | { type: "revealCountdown"; secondsLeft: number }
  | { type: "gameOver"; final: NonNullable<TriviaGameState["final"]> }
  | { type: "reset"; init?: Partial<TriviaGameState> };

const initialGame: TriviaGameState = {
  vote: null,
  myVote: null,
  question: null,
  myChoice: null,
  reveal: null,
  revealSecondsLeft: null,
  final: null,
};

function gameReducer(state: TriviaGameState, action: GameAction): TriviaGameState {
  switch (action.type) {
    case "voteStart":
      return {
        ...initialGame,
        vote: { options: action.options, tally: {}, deadline: action.deadline },
      };
    case "voteUpdate":
      return state.vote ? { ...state, vote: { ...state.vote, tally: action.tally } } : state;
    case "votedSelf":
      return { ...state, myVote: action.categoryId };
    case "questionStart":
      return {
        ...state,
        vote: null,
        myVote: null,
        question: action.question,
        myChoice: null,
        reveal: null,
        revealSecondsLeft: null,
      };
    case "answeredSelf":
      return { ...state, myChoice: action.optionIndex };
    case "answerRejected":
      return { ...state, myChoice: null };
    case "questionReveal":
      return { ...state, reveal: action.reveal, revealSecondsLeft: null };
    case "revealCountdown":
      return { ...state, revealSecondsLeft: action.secondsLeft };
    case "gameOver":
      return { ...state, final: action.final };
    case "reset":
      return { ...initialGame, ...action.init };
    default:
      return state;
  }
}

export function useTrivia() {
  const [game, dispatchGame] = useReducer(gameReducer, initialGame);

  const onSession = useCallback((kind: "joined" | "rejoined" | "left", rejoinData?: unknown) => {
    if (kind === "rejoined") {
      // Rebuild mid-game state from the snapshot so a refresh drops you back
      // into the current vote/question/reveal exactly where you left off.
      const data = rejoinData as TriviaRejoinResult;
      const room = data.room;
      dispatchGame({
        type: "reset",
        init: {
          vote: room.vote,
          question: room.question,
          myChoice: data.yourAnswer,
          reveal: room.lastReveal,
          final:
            room.state === "finished"
              ? {
                  finalScoreboard: room.scoreboard,
                  winners: room.winners ?? [],
                  reason: room.gameOverReason ?? undefined,
                }
              : null,
        },
      });
    } else {
      dispatchGame({ type: "reset" });
    }
  }, []);

  const bindGameEvents = useCallback(
    (
      socket: Parameters<NonNullable<Parameters<typeof useRoomCore>[0]["bindGameEvents"]>>[0],
      api: GameApi<TriviaSnapshot>,
    ) => {
      socket.on("voteStart", (p: { options: CategoryOption[]; deadline: number }) =>
        dispatchGame({ type: "voteStart", ...p }),
      );
      socket.on("voteUpdate", (p: { tally: Record<number, number> }) =>
        dispatchGame({ type: "voteUpdate", tally: p.tally }),
      );
      socket.on("questionStart", (question: TriviaQuestionPublic) => {
        api.patchRoom((room) => ({
          ...room,
          state: "playing",
          players: room.players.map((pl) => ({ ...pl, answered: false })),
        }));
        dispatchGame({ type: "questionStart", question });
      });
      socket.on("playerAnswered", (p: { playerId: string }) => {
        api.patchRoom((room) => ({
          ...room,
          players: room.players.map((pl) =>
            pl.id === p.playerId ? { ...pl, answered: true } : pl,
          ),
        }));
      });
      socket.on("questionReveal", (reveal: TriviaRevealPayload) =>
        dispatchGame({ type: "questionReveal", reveal }),
      );
      socket.on("revealCountdown", (p: { secondsLeft: number }) =>
        dispatchGame({ type: "revealCountdown", secondsLeft: p.secondsLeft }),
      );
      socket.on(
        "gameOver",
        (p: { finalScoreboard: ScoreboardEntry[]; winners: ScoreboardEntry[]; reason?: string }) =>
          dispatchGame({ type: "gameOver", final: p }),
      );
    },
    [],
  );

  const core = useRoomCore<TriviaSnapshot>({
    namespace: "/trivia",
    gameKey: "trivia",
    onSession,
    bindGameEvents,
  });

  const voteCategory = useCallback(
    (categoryId: number) => {
      if (core.emitEvent("voteCategory", { categoryId })) {
        dispatchGame({ type: "votedSelf", categoryId });
      }
    },
    [core.emitEvent],
  );

  const answer = useCallback(
    (optionIndex: number) => {
      // Optimistic lock; reverted if the server rejects it.
      dispatchGame({ type: "answeredSelf", optionIndex });
      core.emitWithAck("answer", { optionIndex }, (res) => {
        if (!res.ok) {
          dispatchGame({ type: "answerRejected" });
          core.toast(res.error);
        }
      });
    },
    [core.emitWithAck, core.toast],
  );

  const setDifficulty = useCallback(
    (difficulty: TriviaDifficulty) => core.emitEvent("setDifficulty", { difficulty }),
    [core.emitEvent],
  );

  const createRoom = useCallback(
    (name: string, isPublic: boolean, settings?: Partial<TriviaSettings>) =>
      core.actions.createRoom(name, isPublic, settings),
    [core.actions.createRoom],
  );

  return {
    state: {
      status: core.state.status,
      room: core.state.room,
      playerId: core.state.playerId,
      toasts: core.state.toasts,
      busy: core.state.busy,
      ...game,
    },
    actions: {
      ...core.actions,
      createRoom,
      voteCategory,
      answer,
      setDifficulty,
    },
  };
}

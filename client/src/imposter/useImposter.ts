import { useCallback, useReducer } from "react";
import type {
  ClueEntry,
  EliminationRecord,
  ImposterRejoinResult,
  ImposterSettings,
  ImposterSide,
  ImposterSnapshot,
  YourRolePayload,
} from "@shared/imposter";
import { useRoomCore, type GameApi } from "../core/useRoomCore";

interface ImposterGameState {
  myRole: YourRolePayload | null;
  decisionResult: { another: number; accuse: number; goVote: boolean } | null;
  voteResult: {
    tally: { targetId: string; votes: number }[];
    eliminatedId: string | null;
    revealedRole: "imposter" | "crew" | null;
    runoffNext: boolean;
  } | null;
  myDecision: "another" | "accuse" | null;
  myVote: string | null;
  stealPrompt: { deadline: number } | null;
  end: {
    winningSide: ImposterSide | null;
    word: string;
    allRoles: EliminationRecord[];
    reason?: string;
  } | null;
}

type GameAction =
  | { type: "yourRole"; payload: YourRolePayload }
  | { type: "decisionStart" }
  | { type: "decisionResult"; payload: ImposterGameState["decisionResult"] }
  | { type: "voteStart" }
  | { type: "voteResult"; payload: ImposterGameState["voteResult"] }
  | { type: "clueTurn" }
  | { type: "myDecision"; choice: "another" | "accuse" }
  | { type: "myVote"; targetId: string }
  | { type: "stealPrompt"; payload: { deadline: number } }
  | { type: "gameEnd"; payload: ImposterGameState["end"] }
  | { type: "reset"; init?: Partial<ImposterGameState> };

const initialGame: ImposterGameState = {
  myRole: null,
  decisionResult: null,
  voteResult: null,
  myDecision: null,
  myVote: null,
  stealPrompt: null,
  end: null,
};

function gameReducer(state: ImposterGameState, action: GameAction): ImposterGameState {
  switch (action.type) {
    case "yourRole":
      // A fresh card means a fresh game — clear everything transient.
      return { ...initialGame, myRole: action.payload };
    case "decisionStart":
      return { ...state, decisionResult: null, voteResult: null, myDecision: null };
    case "decisionResult":
      return { ...state, decisionResult: action.payload };
    case "voteStart":
      return { ...state, voteResult: null, myVote: null, decisionResult: null };
    case "voteResult":
      return { ...state, voteResult: action.payload };
    case "clueTurn":
      return { ...state, decisionResult: null, voteResult: null };
    case "myDecision":
      return { ...state, myDecision: action.choice };
    case "myVote":
      return { ...state, myVote: action.targetId };
    case "stealPrompt":
      // Clear the vote-result popup so it can't cover the guess input.
      return { ...state, stealPrompt: action.payload, voteResult: null };
    case "gameEnd":
      return { ...state, end: action.payload, stealPrompt: null };
    case "reset":
      return { ...initialGame, ...action.init };
    default:
      return state;
  }
}

export function useImposter() {
  const [game, dispatchGame] = useReducer(gameReducer, initialGame);

  const onSession = useCallback((kind: "joined" | "rejoined" | "left", rejoinData?: unknown) => {
    if (kind === "rejoined") {
      const data = rejoinData as ImposterRejoinResult;
      const room = data.room;
      dispatchGame({
        type: "reset",
        init: {
          myRole: data.yourRole,
          end:
            room.state === "finished" && room.word && room.allRoles
              ? {
                  winningSide: room.winners,
                  word: room.word,
                  allRoles: room.allRoles,
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
      api: GameApi<ImposterSnapshot>,
    ) => {
      socket.on("yourRole", (payload: YourRolePayload) =>
        dispatchGame({ type: "yourRole", payload }),
      );
      socket.on("clueTurn", (p: { playerId: string; deadline: number; round: number }) => {
        api.patchRoom((room) => ({
          ...room,
          state: "clues",
          whoseTurn: p.playerId,
          turnDeadline: p.deadline,
          round: p.round,
        }));
        dispatchGame({ type: "clueTurn" });
      });
      socket.on("clueSubmitted", (p: ClueEntry & { round: number }) => {
        api.patchRoom((room) => {
          const board = [...room.clueBoard];
          const idx = board.findIndex((b) => b.round === p.round);
          const entry = { playerId: p.playerId, name: p.name, word: p.word };
          if (idx >= 0) {
            board[idx] = { ...board[idx], entries: [...board[idx].entries, entry] };
          } else {
            board.push({ round: p.round, entries: [entry] });
          }
          return { ...room, clueBoard: board };
        });
      });
      socket.on("decisionStart", (p: { deadline: number }) => {
        api.patchRoom((room) => ({ ...room, state: "decision", phaseDeadline: p.deadline }));
        dispatchGame({ type: "decisionStart" });
      });
      socket.on("decisionResult", (p: ImposterGameState["decisionResult"]) =>
        dispatchGame({ type: "decisionResult", payload: p }),
      );
      socket.on(
        "voteStart",
        (p: { candidates: string[]; deadline: number; runoff: boolean; forced: boolean }) => {
          api.patchRoom((room) => ({
            ...room,
            state: "vote",
            candidates: p.candidates,
            phaseDeadline: p.deadline,
            runoff: p.runoff,
            forced: p.forced,
          }));
          dispatchGame({ type: "voteStart" });
        },
      );
      socket.on("voteResult", (p: ImposterGameState["voteResult"]) =>
        dispatchGame({ type: "voteResult", payload: p }),
      );
      socket.on("wordStealPrompt", (p: { deadline: number }) =>
        dispatchGame({ type: "stealPrompt", payload: p }),
      );
      socket.on("gameEnd", (p: ImposterGameState["end"]) =>
        dispatchGame({ type: "gameEnd", payload: p }),
      );
    },
    [],
  );

  const core = useRoomCore<ImposterSnapshot>({
    namespace: "/imposter",
    gameKey: "imposter",
    onSession,
    bindGameEvents,
  });

  const createRoom = useCallback(
    (name: string, isPublic: boolean, settings?: Partial<ImposterSettings>) =>
      core.actions.createRoom(name, isPublic, settings),
    [core.actions.createRoom],
  );

  const setSettings = useCallback(
    (partial: Partial<ImposterSettings>) => core.emitEvent("setImposterSettings", partial),
    [core.emitEvent],
  );

  const submitClue = useCallback(
    (word: string, onResult?: (ok: boolean) => void) => {
      core.emitWithAck("submitClue", { word }, (res) => {
        onResult?.(res.ok);
        if (!res.ok) core.toast(res.error);
      });
    },
    [core.emitWithAck, core.toast],
  );

  const advanceTurn = useCallback(() => core.emitEvent("advanceTurn"), [core.emitEvent]);

  const castDecision = useCallback(
    (choice: "another" | "accuse") => {
      if (core.emitEvent("castDecisionVote", { choice })) {
        dispatchGame({ type: "myDecision", choice });
      }
    },
    [core.emitEvent],
  );

  const castVote = useCallback(
    (targetId: string) => {
      if (core.emitEvent("castAccusationVote", { targetId })) {
        dispatchGame({ type: "myVote", targetId });
      }
    },
    [core.emitEvent],
  );

  const guessWord = useCallback(
    (word: string) => {
      core.emitWithAck("submitWordGuess", { word }, (res) => {
        if (!res.ok) core.toast(res.error);
      });
    },
    [core.emitWithAck, core.toast],
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
      setSettings,
      submitClue,
      advanceTurn,
      castDecision,
      castVote,
      guessWord,
    },
  };
}

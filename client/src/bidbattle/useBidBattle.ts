import { useCallback, useReducer } from "react";
import type {
  BallotPublic,
  BidBattleMode,
  BidBattleRejoinResult,
  BidBattleSettings,
  BidBattleSnapshot,
  BiddingPublic,
  ReviewItemStatus,
  ReviewPublic,
  RoundResult,
  TeamId,
} from "@shared/bidbattle";
import { useRoomCore, type GameApi } from "../core/useRoomCore";

interface BidBattleGameState {
  /** The live named list during the delivery sprint (visible to both teams). */
  liveItems: { raw: string; normalized: string }[];
  myVote: number | null;
  result: RoundResult | null;
  winner: { winnerTeam: TeamId; scores: Record<TeamId, number>; reason?: string } | null;
}

type GameAction =
  | { type: "newRound" }
  | { type: "votedSelf"; optionId: number }
  | { type: "itemAccepted"; raw: string; normalized: string }
  | { type: "setItems"; items: { raw: string; normalized: string }[] }
  | { type: "roundResult"; result: RoundResult }
  | { type: "gameOver"; winner: NonNullable<BidBattleGameState["winner"]> }
  | { type: "reset"; init?: Partial<BidBattleGameState> };

const initialGame: BidBattleGameState = {
  liveItems: [],
  myVote: null,
  result: null,
  winner: null,
};

function gameReducer(state: BidBattleGameState, action: GameAction): BidBattleGameState {
  switch (action.type) {
    case "newRound":
      return { ...state, liveItems: [], myVote: null, result: null };
    case "votedSelf":
      return { ...state, myVote: action.optionId };
    case "itemAccepted":
      return {
        ...state,
        liveItems: [...state.liveItems, { raw: action.raw, normalized: action.normalized }],
      };
    case "setItems":
      return { ...state, liveItems: action.items };
    case "roundResult":
      return { ...state, result: action.result };
    case "gameOver":
      return { ...state, winner: action.winner };
    case "reset":
      return { ...initialGame, ...action.init };
    default:
      return state;
  }
}

export function useBidBattle() {
  const [game, dispatchGame] = useReducer(gameReducer, initialGame);

  const onSession = useCallback((kind: "joined" | "rejoined" | "left", rejoinData?: unknown) => {
    if (kind === "rejoined") {
      const data = rejoinData as BidBattleRejoinResult;
      dispatchGame({
        type: "reset",
        init: {
          liveItems: data.deliveryItems ?? [],
          myVote: data.yourVote,
          winner:
            data.room.state === "finished" && data.room.winnerTeam
              ? {
                  winnerTeam: data.room.winnerTeam,
                  scores: data.room.scores,
                  reason: data.room.gameOverReason ?? undefined,
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
      api: GameApi<BidBattleSnapshot>,
    ) => {
      socket.on("categoryBallot", (ballot: BallotPublic) => {
        api.patchRoom((room) => ({ ...room, state: "category", ballot }));
        // A fresh ballot (only the Random option, no votes) means a new round.
        if (ballot.options.length === 1 && Object.keys(ballot.tally).length === 0) {
          dispatchGame({ type: "newRound" });
        }
      });
      socket.on("categoryReveal", (p: { category: string; source: "custom" | "random" }) => {
        api.patchRoom((room) => ({
          ...room,
          category: p.category,
          categorySource: p.source,
          ballot: null,
        }));
        dispatchGame({ type: "newRound" });
      });
      socket.on("bidUpdate", (bidding: BiddingPublic) => {
        api.patchRoom((room) => ({ ...room, state: "bidding", bidding }));
      });
      socket.on("deliveryCount", (p: { count: number }) => {
        api.patchRoom((room) =>
          room.delivery ? { ...room, delivery: { ...room.delivery, count: p.count } } : room,
        );
      });
      socket.on("itemAccepted", (p: { raw: string; normalized: string; count: number }) => {
        dispatchGame({ type: "itemAccepted", raw: p.raw, normalized: p.normalized });
      });
      socket.on("reviewStart", (review: ReviewPublic) => {
        api.patchRoom((room) => ({ ...room, state: "review", review, delivery: null }));
      });
      socket.on("flagUpdate", (p: { statuses: ReviewItemStatus[] }) => {
        api.patchRoom((room) =>
          room.review
            ? {
                ...room,
                review: {
                  ...room.review,
                  items: room.review.items.map((item, i) => ({
                    ...item,
                    status: p.statuses[i] ?? item.status,
                  })),
                },
              }
            : room,
        );
      });
      socket.on("roundResult", (result: RoundResult) => {
        api.patchRoom((room) => ({ ...room, scores: result.scores, lastResult: result }));
        dispatchGame({ type: "roundResult", result });
      });
      socket.on(
        "gameOver",
        (p: { winnerTeam: TeamId; scores: Record<TeamId, number>; reason?: string }) => {
          dispatchGame({ type: "gameOver", winner: p });
        },
      );
    },
    [],
  );

  const core = useRoomCore<BidBattleSnapshot>({
    namespace: "/bidbattle",
    gameKey: "bidbattle",
    onSession,
    bindGameEvents,
  });

  const withToastOnError = useCallback(
    (event: string, payload: unknown, onOk?: (data: any) => void) => {
      core.emitWithAck(event, payload, (res) => {
        if (res.ok) onOk?.(res.data);
        else core.toast(res.error);
      });
    },
    [core.emitWithAck, core.toast],
  );

  const createRoom = useCallback(
    (name: string, isPublic: boolean, settings?: Partial<BidBattleSettings>) =>
      core.actions.createRoom(name, isPublic, settings),
    [core.actions.createRoom],
  );

  const quickPlay = useCallback(
    (name: string, mode: BidBattleMode) => {
      // Same flow as the base quickPlay, with the chosen mode attached.
      (core.socket as any).timeout(8000).emit(
        "quickPlay",
        { name, mode },
        (err: unknown, res: any) => {
          if (err || !res.ok) core.toast(err ? "No response from server — try again." : res.error);
        },
      );
    },
    [core.socket, core.toast],
  );

  const setMode = useCallback(
    (mode: BidBattleMode) => core.socket.emit("setMode", { mode }),
    [core.socket],
  );
  const assignTeam = useCallback(
    (team: TeamId) => core.socket.emit("assignTeam", { team }),
    [core.socket],
  );
  const suggestCategory = useCallback(
    (text: string) => withToastOnError("submitCategorySuggestion", { text }),
    [withToastOnError],
  );
  const voteCategory = useCallback(
    (optionId: number) => {
      core.socket.emit("voteCategory", { optionId });
      dispatchGame({ type: "votedSelf", optionId });
    },
    [core.socket],
  );
  const raiseBid = useCallback(
    (amount: number) => withToastOnError("raiseBid", { amount }),
    [withToastOnError],
  );
  const challengeBid = useCallback(() => core.socket.emit("challengeBid"), [core.socket]);
  const submitItem = useCallback(
    (text: string, onResult?: (ok: boolean, error?: string) => void) => {
      core.emitWithAck("submitItem", { text }, (res) => {
        onResult?.(res.ok, res.ok ? undefined : res.error);
        if (!res.ok) core.toast(res.error);
      });
    },
    [core.emitWithAck, core.toast],
  );
  const finishDelivery = useCallback(() => core.socket.emit("finishDelivery"), [core.socket]);
  const flagItem = useCallback(
    (index: number) => core.socket.emit("flagItem", { index }),
    [core.socket],
  );
  const respondToFlag = useCallback(
    (index: number, action: "concede" | "defend") =>
      core.socket.emit("respondToFlag", { index, action }),
    [core.socket],
  );
  const finalizeFlag = useCallback(
    (index: number, action: "accept" | "uphold") =>
      core.socket.emit("finalizeFlag", { index, action }),
    [core.socket],
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
      quickPlay,
      setMode,
      assignTeam,
      suggestCategory,
      voteCategory,
      raiseBid,
      challengeBid,
      submitItem,
      finishDelivery,
      flagItem,
      respondToFlag,
      finalizeFlag,
    },
  };
}

import { useCallback, useReducer } from "react";
import type { RejoinResult } from "@shared/events";
import type {
  PublicPlayer,
  RevealEntry,
  RoomSettings,
  RoomSnapshot,
} from "@shared/types";
import { useRoomCore, type GameApi } from "../core/useRoomCore";

export type { Toast } from "../core/useRoomCore";
export { NAME_KEY } from "../core/useRoomCore";

interface MindMeldGameState {
  /** Your own locked word for the current round. */
  myWord: { raw: string; normalized: string } | null;
  reveal: { round: number; entries: RevealEntry[]; isWin: boolean } | null;
  revealSecondsLeft: number | null;
  win: { word: string; rounds: number; players: PublicPlayer[] } | null;
}

type GameAction =
  | { type: "roundStart" }
  | { type: "revealCountdown"; secondsLeft: number }
  | { type: "roundReveal"; round: number; entries: RevealEntry[]; isWin: boolean }
  | { type: "gameWin"; word: string; rounds: number; players: PublicPlayer[] }
  | { type: "lockedSelf"; raw: string; normalized: string }
  | { type: "unlockedSelf" }
  | { type: "reset"; init?: Partial<MindMeldGameState> };

const initialGame: MindMeldGameState = {
  myWord: null,
  reveal: null,
  revealSecondsLeft: null,
  win: null,
};

function gameReducer(state: MindMeldGameState, action: GameAction): MindMeldGameState {
  switch (action.type) {
    case "roundStart":
      return { ...state, reveal: null, revealSecondsLeft: null, myWord: null, win: null };
    case "revealCountdown":
      return { ...state, revealSecondsLeft: action.secondsLeft };
    case "roundReveal":
      return {
        ...state,
        reveal: { round: action.round, entries: action.entries, isWin: action.isWin },
      };
    case "gameWin":
      return { ...state, win: { word: action.word, rounds: action.rounds, players: action.players } };
    case "lockedSelf":
      return { ...state, myWord: { raw: action.raw, normalized: action.normalized } };
    case "unlockedSelf":
      return { ...state, myWord: null };
    case "reset":
      return { ...initialGame, ...action.init };
    default:
      return state;
  }
}

export function useMindMeld() {
  const [game, dispatchGame] = useReducer(gameReducer, initialGame);

  const onSession = useCallback((kind: "joined" | "rejoined" | "left", rejoinData?: unknown) => {
    if (kind === "rejoined") {
      const data = rejoinData as RejoinResult;
      dispatchGame({
        type: "reset",
        init: {
          myWord: data.yourWord,
          win:
            data.room.state === "finished" && data.room.winner
              ? { ...data.room.winner, players: data.room.players }
              : null,
        },
      });
    } else {
      dispatchGame({ type: "reset" });
    }
  }, []);

  const bindGameEvents = useCallback(
    (socket: Parameters<NonNullable<Parameters<typeof useRoomCore>[0]["bindGameEvents"]>>[0], api: GameApi<RoomSnapshot>) => {
      socket.on(
        "roundStart",
        (p: { roundNumber: number; usedWords: string[]; deadline: number }) => {
          api.patchRoom((room) => ({
            ...room,
            state: "playing",
            roundNumber: p.roundNumber,
            usedWords: p.usedWords,
            deadline: p.deadline,
            players: room.players.map((pl) => ({ ...pl, lockedIn: false })),
          }));
          dispatchGame({ type: "roundStart" });
        },
      );
      socket.on("playerLockedIn", (p: { playerId: string; locked: boolean }) => {
        api.patchRoom((room) => ({
          ...room,
          players: room.players.map((pl) =>
            pl.id === p.playerId ? { ...pl, lockedIn: p.locked } : pl,
          ),
        }));
        if (p.playerId === api.getPlayerId() && !p.locked) {
          dispatchGame({ type: "unlockedSelf" });
        }
      });
      socket.on("revealCountdown", (p: { secondsLeft: number }) =>
        dispatchGame({ type: "revealCountdown", secondsLeft: p.secondsLeft }),
      );
      socket.on(
        "roundReveal",
        (p: { round: number; entries: RevealEntry[]; usedWords: string[]; isWin: boolean }) => {
          api.patchRoom((room) => ({
            ...room,
            usedWords: p.usedWords,
            deadline: null,
            history: [
              ...room.history.filter((h) => h.round !== p.round),
              { round: p.round, entries: p.entries },
            ],
          }));
          dispatchGame({ type: "roundReveal", ...p });
        },
      );
      socket.on("gameWin", (p: { word: string; rounds: number; players: PublicPlayer[] }) =>
        dispatchGame({ type: "gameWin", ...p }),
      );
      socket.on("gameOver", (p: { reason: string }) =>
        api.toast(`Game over: ${p.reason}`, "info"),
      );
    },
    [],
  );

  const core = useRoomCore<RoomSnapshot>({
    namespace: "/mindmeld",
    gameKey: "mindmeld",
    onSession,
    bindGameEvents,
  });

  const lockIn = useCallback(
    (word: string) => {
      core.emitWithAck("lockIn", { word }, (res) => {
        if (res.ok) {
          dispatchGame({ type: "lockedSelf", raw: word, normalized: res.data.normalized });
        } else {
          core.toast(res.error);
        }
      });
    },
    [core.emitWithAck, core.toast],
  );

  const unlock = useCallback(() => {
    if (core.emitEvent("unlock")) dispatchGame({ type: "unlockedSelf" });
  }, [core.emitEvent]);

  const createRoom = useCallback(
    (name: string, isPublic: boolean, settings?: Partial<RoomSettings>) =>
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
      lockIn,
      unlock,
    },
  };
}

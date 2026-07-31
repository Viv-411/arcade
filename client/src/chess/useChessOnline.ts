import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Chess } from "chess.js";
import type {
  ChessClocks,
  ChessColor,
  ChessEndReason,
  ChessMoveInfo,
  ChessResult,
  ChessSettings,
  ChessSnapshot,
} from "@shared/chess";
import { useRoomCore, type GameApi } from "../core/useRoomCore";
import { playChessSound, soundForMove } from "./sounds";

/**
 * Client half of online chess. The SERVER owns legality, turn order, clocks,
 * and results; this hook only renders what it is told, with one exception —
 * an OPTIMISTIC position so the piece moves under your finger instead of
 * after a round trip. The optimistic FEN is always discarded the moment the
 * server speaks (`moveMade` confirms it, `illegalMove` / `roomUpdate` replace
 * it), so the client can never win a disagreement about the position.
 */

interface ChessOnlineState {
  clocks: ChessClocks | null;
  /** Client-clock timestamp when `clocks` arrived, so ticking needs no
   *  agreement between the two machines' wall clocks. */
  syncedAt: number;
  optimisticFen: string | null;
  optimisticLastMove: { from: string; to: string } | null;
  over: { result: ChessResult; reason: ChessEndReason } | null;
}

type Action =
  | { type: "clocks"; clocks: ChessClocks | null }
  | { type: "optimistic"; fen: string; lastMove: { from: string; to: string } }
  | { type: "serverPosition" }
  | { type: "over"; result: ChessResult; reason: ChessEndReason }
  | { type: "reset" };

const initial: ChessOnlineState = {
  clocks: null,
  syncedAt: Date.now(),
  optimisticFen: null,
  optimisticLastMove: null,
  over: null,
};

function reducer(state: ChessOnlineState, action: Action): ChessOnlineState {
  switch (action.type) {
    case "clocks":
      return { ...state, clocks: action.clocks, syncedAt: Date.now() };
    case "optimistic":
      return { ...state, optimisticFen: action.fen, optimisticLastMove: action.lastMove };
    case "serverPosition":
      return { ...state, optimisticFen: null, optimisticLastMove: null };
    case "over":
      return { ...state, over: { result: action.result, reason: action.reason } };
    case "reset":
      return { ...initial, syncedAt: Date.now() };
    default:
      return state;
  }
}

export function useChessOnline() {
  const [game, dispatch] = useReducer(reducer, initial);

  const onSession = useCallback((kind: "joined" | "rejoined" | "left", rejoinData?: unknown) => {
    if (kind === "rejoined") {
      const room = (rejoinData as { room?: ChessSnapshot })?.room;
      dispatch({ type: "reset" });
      // A refresh must land back on the live clock, not a stale one.
      if (room?.clocks) dispatch({ type: "clocks", clocks: room.clocks });
    } else {
      dispatch({ type: "reset" });
    }
  }, []);

  const bindGameEvents = useCallback(
    (
      socket: Parameters<NonNullable<Parameters<typeof useRoomCore>[0]["bindGameEvents"]>>[0],
      _api: GameApi<ChessSnapshot>,
    ) => {
      // Every snapshot carries authoritative clocks; take them from all sources.
      socket.on("roomUpdate", (room: ChessSnapshot) => {
        dispatch({ type: "clocks", clocks: room.clocks });
        dispatch({ type: "serverPosition" });
      });
      socket.on("gameStart", (p: { clocks: ChessClocks | null }) => {
        dispatch({ type: "reset" });
        dispatch({ type: "clocks", clocks: p.clocks });
      });
      socket.on(
        "moveMade",
        (p: { move: ChessMoveInfo; clocks: ChessClocks | null }) => {
          dispatch({ type: "serverPosition" });
          dispatch({ type: "clocks", clocks: p.clocks });
          playChessSound(soundForMove(p.move));
        },
      );
      socket.on("illegalMove", () => {
        dispatch({ type: "serverPosition" });
        playChessSound("illegal");
      });
      socket.on("clockUpdate", (clocks: ChessClocks) => dispatch({ type: "clocks", clocks }));
      socket.on(
        "gameOver",
        (p: { result: ChessResult; reason: ChessEndReason; clocks: ChessClocks | null }) => {
          dispatch({ type: "serverPosition" });
          dispatch({ type: "clocks", clocks: p.clocks });
          dispatch({ type: "over", result: p.result, reason: p.reason });
          playChessSound("gameEnd");
        },
      );
    },
    [],
  );

  const core = useRoomCore<ChessSnapshot>({
    namespace: "/chess",
    gameKey: "chess",
    onSession,
    bindGameEvents,
  });

  const room = core.state.room;
  const myColor =
    room?.players.find((p) => p.id === core.state.playerId)?.color ?? null;

  /** Validate locally for instant feedback, then let the server decide. */
  const makeMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      const current = core.state.room;
      if (!current) return false;
      const board = new Chess();
      try {
        board.load(game.optimisticFen ?? current.fen);
        board.move({ from, to, promotion });
      } catch {
        return false; // not legal locally; the server would reject it too
      }
      dispatch({ type: "optimistic", fen: board.fen(), lastMove: { from, to } });
      core.emitWithAck("makeMove", { from, to, promotion }, (res) => {
        if (!res.ok) {
          dispatch({ type: "serverPosition" });
          core.toast(res.error);
        }
      });
      return true;
    },
    [core.state.room, core.emitWithAck, core.toast, game.optimisticFen],
  );

  const resign = useCallback(() => core.emitEvent("resign"), [core.emitEvent]);
  const offerDraw = useCallback(() => core.emitEvent("offerDraw"), [core.emitEvent]);
  const respondDraw = useCallback(
    (accept: boolean) => core.emitEvent("respondDraw", { accept }),
    [core.emitEvent],
  );
  const setChessSettings = useCallback(
    (partial: Partial<ChessSettings>) => core.emitEvent("setChessSettings", partial),
    [core.emitEvent],
  );

  /** Quick Play carries the time control so pools only match like with like. */
  const quickPlay = useCallback(
    (name: string, settings: Partial<ChessSettings>) =>
      core.actions.joinWith("quickPlay", { name, settings }),
    [core.actions.joinWith],
  );

  const ticking = useTickingClocks(game.clocks, game.syncedAt);

  return {
    state: {
      status: core.state.status,
      room,
      playerId: core.state.playerId,
      toasts: core.state.toasts,
      busy: core.state.busy,
      myColor,
      clocks: ticking,
      fen: game.optimisticFen ?? room?.fen ?? new Chess().fen(),
      lastMove: game.optimisticLastMove ?? room?.lastMove ?? null,
      over: game.over,
    },
    actions: {
      ...core.actions,
      quickPlay,
      makeMove,
      resign,
      offerDraw,
      respondDraw,
      setChessSettings,
    },
  };
}

/**
 * Tick the last server clock snapshot down locally between updates. The server
 * remains the only thing that can FLAG a player; this is display only, and it
 * resyncs on every move and on the periodic clockUpdate.
 */
export function useTickingClocks(
  clocks: ChessClocks | null,
  syncedAt: number,
): ChessClocks | null {
  const [, force] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!clocks || !clocks.running) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      force((n) => n + 1);
      raf.current = window.setTimeout(tick, 100) as unknown as number;
    };
    raf.current = window.setTimeout(tick, 100) as unknown as number;
    return () => {
      alive = false;
      if (raf.current) clearTimeout(raf.current);
    };
  }, [clocks, syncedAt]);

  if (!clocks) return null;
  if (!clocks.running) return clocks;
  const elapsed = Date.now() - syncedAt;
  return {
    whiteMs: Math.max(0, clocks.whiteMs - (clocks.running === "white" ? elapsed : 0)),
    blackMs: Math.max(0, clocks.blackMs - (clocks.running === "black" ? elapsed : 0)),
    running: clocks.running,
  };
}

export type ChessOnlineHook = ReturnType<typeof useChessOnline>;
export type { ChessColor };

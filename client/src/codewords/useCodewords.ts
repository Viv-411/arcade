import { useCallback, useReducer } from "react";
import type {
  CodewordsRejoinResult,
  CodewordsSettings,
  CodewordsSnapshot,
  CwClueNumber,
  CwIdentity,
  CwTeam,
  CwVoteTally,
} from "@shared/codewords";
import { useRoomCore, type GameApi } from "../core/useRoomCore";

export interface CwReveal {
  index: number;
  identity: CwIdentity;
  byTeam: CwTeam;
  outcome: "agent" | "bystander" | "opponent" | "assassin";
}

interface CwGameState {
  /** The full shared key — present only on spymaster clients. */
  cardKey: CwIdentity[] | null;
  tally: CwVoteTally | null;
  myVote: number | "pass" | null;
  boardTokens: Record<CwTeam, string> | null;
  lastReveal: CwReveal | null;
  winner: { winner: CwTeam; reason: string; fullKey: CwIdentity[] } | null;
}

type GameAction =
  | { type: "key"; key: CwIdentity[] }
  | { type: "tokens"; tokens: Record<CwTeam, string> }
  | { type: "tally"; tally: CwVoteTally }
  | { type: "myVote"; vote: number | "pass" | null }
  | { type: "reveal"; reveal: CwReveal }
  | { type: "turnChange" }
  | { type: "gameStart" }
  | { type: "gameOver"; winner: NonNullable<CwGameState["winner"]> }
  | { type: "reset"; init?: Partial<CwGameState>; keepTokens?: boolean };

const initialGame: CwGameState = {
  cardKey: null,
  tally: null,
  myVote: null,
  boardTokens: null,
  lastReveal: null,
  winner: null,
};

function gameReducer(state: CwGameState, action: GameAction): CwGameState {
  switch (action.type) {
    case "key":
      return { ...state, cardKey: action.key };
    case "tokens":
      return { ...state, boardTokens: action.tokens };
    case "tally":
      return { ...state, tally: action.tally };
    case "myVote":
      return { ...state, myVote: action.vote };
    case "reveal":
      return { ...state, lastReveal: action.reveal, tally: null, myVote: null };
    case "turnChange":
      return { ...state, tally: null, myVote: null };
    case "gameStart":
      // New board, new key (spymasters get theirs via yourKey right after).
      return { ...initialGame, boardTokens: state.boardTokens };
    case "gameOver":
      return { ...state, winner: action.winner, tally: null, myVote: null };
    case "reset":
      // keepTokens: the board's QR tokens arrive via a boardTokens event
      // BEFORE the createRoom ack, and the ack's session reset must not
      // wipe them (that hid the QR codes entirely).
      return {
        ...initialGame,
        ...(action.keepTokens ? { boardTokens: state.boardTokens } : {}),
        ...action.init,
      };
    default:
      return state;
  }
}

/**
 * Client half of Codewords, shared by all three surfaces (remote players, the
 * shared board, spymaster phones). `gameKey` differs per surface so their
 * per-tab sessions don't clobber each other.
 */
export function useCodewords(gameKey: "codewords" | "codewords-board" | "codewords-key") {
  const [game, dispatchGame] = useReducer(gameReducer, initialGame);

  const onSession = useCallback((kind: "joined" | "rejoined" | "left", rejoinData?: unknown) => {
    if (kind === "rejoined") {
      const data = rejoinData as CodewordsRejoinResult;
      dispatchGame({
        type: "reset",
        init: {
          cardKey: data.yourKey,
          myVote: data.yourVote,
          tally: data.voteTally,
          boardTokens: data.boardTokens,
          winner:
            data.room.state === "finished" && data.room.winner && data.room.fullKey
              ? {
                  winner: data.room.winner,
                  reason: data.room.gameOverReason ?? "",
                  fullKey: data.room.fullKey,
                }
              : null,
        },
      });
    } else {
      dispatchGame({ type: "reset", keepTokens: kind === "joined" });
    }
  }, []);

  const bindGameEvents = useCallback(
    (
      socket: Parameters<NonNullable<Parameters<typeof useRoomCore>[0]["bindGameEvents"]>>[0],
      _api: GameApi<CodewordsSnapshot>,
    ) => {
      socket.on("gameStart", () => dispatchGame({ type: "gameStart" }));
      socket.on("yourKey", (p: { key: CwIdentity[] }) =>
        dispatchGame({ type: "key", key: p.key }),
      );
      socket.on("boardTokens", (p: { tokens: Record<CwTeam, string> }) =>
        dispatchGame({ type: "tokens", tokens: p.tokens }),
      );
      socket.on("voteUpdate", (tally: CwVoteTally) => dispatchGame({ type: "tally", tally }));
      socket.on("cardRevealed", (reveal: CwReveal) => dispatchGame({ type: "reveal", reveal }));
      socket.on("turnChange", () => dispatchGame({ type: "turnChange" }));
      socket.on(
        "gameOver",
        (p: { winner: CwTeam; reason: string; fullKey: CwIdentity[] }) =>
          dispatchGame({ type: "gameOver", winner: p }),
      );
    },
    [],
  );

  const core = useRoomCore<CodewordsSnapshot>({
    namespace: "/codewords",
    gameKey,
    onSession,
    bindGameEvents,
  });

  const createRoom = useCallback(
    (name: string, isPublic: boolean, settings?: Partial<CodewordsSettings>) =>
      core.actions.createRoom(name, isPublic, settings),
    [core.actions.createRoom],
  );

  const joinViaToken = useCallback(
    (code: string, team: CwTeam, token: string) =>
      core.actions.joinWith("spymasterJoinViaToken", { code, team, token }),
    [core.actions.joinWith],
  );

  const assignTeam = useCallback(
    (team: CwTeam) => core.emitEvent("assignTeam", { team }),
    [core.emitEvent],
  );
  const setSpymaster = useCallback(
    (playerId: string) => core.emitEvent("setSpymaster", { playerId }),
    [core.emitEvent],
  );
  const submitClue = useCallback(
    (word: string | null, number: CwClueNumber, onOk?: () => void) => {
      core.emitWithAck("submitClue", { word, number }, (res) => {
        if (res.ok) onOk?.();
        else core.toast(res.error);
      });
    },
    [core.emitWithAck, core.toast],
  );
  const voteCard = useCallback(
    (target: number | "pass", currentVote: number | "pass" | null) => {
      if (core.emitEvent("voteCard", { target })) {
        // Mirror the server's toggle: same target clears, new target moves.
        dispatchGame({ type: "myVote", vote: currentVote === target ? null : target });
      }
    },
    [core.emitEvent],
  );
  const revealCard = useCallback(
    (index: number) => core.emitEvent("revealCard", { index }),
    [core.emitEvent],
  );
  const passTurn = useCallback(() => core.emitEvent("passTurn"), [core.emitEvent]);

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
      joinViaToken,
      assignTeam,
      setSpymaster,
      submitClue,
      voteCard,
      revealCard,
      passTurn,
    },
  };
}

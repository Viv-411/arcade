import { useEffect, useRef } from "react";
import { Chess } from "chess.js";
import type { ChessColor, ChessMoveInfo } from "@shared/chess";
import { PIECE_GLYPH, PIECE_VALUE } from "./theme";

/** Presentational side panels shared by online and pass-and-play. */

// ------------------------------- clock -------------------------------

export function ClockView({
  ms,
  active,
  label,
  low,
}: {
  ms: number;
  active: boolean;
  label: string;
  low?: boolean;
}) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  // Under ten seconds, show tenths — the standard blitz-scramble affordance.
  const showTenths = ms < 10_000 && ms > 0;
  const tenths = Math.floor((Math.max(0, ms) % 1000) / 100);
  return (
    <div
      className={`chess-clock ${active ? "active" : ""} ${low || total <= 10 ? "low" : ""}`}
      aria-label={`${label} clock`}
    >
      <span className="chess-clock-time">
        {mins}:{String(secs).padStart(2, "0")}
        {showTenths && <span className="chess-clock-tenths">.{tenths}</span>}
      </span>
    </div>
  );
}

// --------------------------- captured pieces ---------------------------

/**
 * Captured material for one side, derived from the position rather than the
 * move list so it stays correct after a rejoin (where we may not have every
 * move locally). `color` is the side whose LOSSES are shown.
 */
export function capturedFrom(fen: string, color: ChessColor): string[] {
  const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const short = color === "white" ? "w" : "b";
  const onBoard: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  let board;
  try {
    board = new Chess(fen).board();
  } catch {
    return [];
  }
  for (const row of board) {
    for (const sq of row) {
      if (sq && sq.color === short && sq.type in onBoard) onBoard[sq.type] += 1;
    }
  }
  const lost: string[] = [];
  for (const type of ["q", "r", "b", "n", "p"]) {
    const missing = (START[type] ?? 0) - (onBoard[type] ?? 0);
    for (let i = 0; i < missing; i++) lost.push(type);
  }
  return lost;
}

export function materialScore(fen: string): number {
  const white = capturedFrom(fen, "white").reduce((n, p) => n + (PIECE_VALUE[p] ?? 0), 0);
  const black = capturedFrom(fen, "black").reduce((n, p) => n + (PIECE_VALUE[p] ?? 0), 0);
  return black - white; // positive = white is up material
}

export function CapturedTray({ fen, color }: { fen: string; color: ChessColor }) {
  // Pieces captured BY `color` are the opponent's losses.
  const opponent: ChessColor = color === "white" ? "black" : "white";
  const pieces = capturedFrom(fen, opponent);
  const score = materialScore(fen);
  const advantage = color === "white" ? score : -score;
  return (
    <div className="chess-captured">
      <span className={`chess-captured-pieces ${opponent}`}>
        {pieces.map((p, i) => (
          <span key={`${p}-${i}`} className="chess-captured-piece">
            {PIECE_GLYPH[p]}
          </span>
        ))}
      </span>
      {advantage > 0 && <span className="chess-advantage">+{advantage}</span>}
    </div>
  );
}

// ------------------------------ move list ------------------------------

export function MoveList({ moves }: { moves: ChessMoveInfo[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [moves.length]);

  const rows: { n: number; white?: ChessMoveInfo; black?: ChessMoveInfo }[] = [];
  for (const move of moves) {
    if (move.color === "white") rows.push({ n: rows.length + 1, white: move });
    else if (rows.length > 0 && !rows[rows.length - 1].black) rows[rows.length - 1].black = move;
    else rows.push({ n: rows.length + 1, black: move });
  }

  return (
    <div className="chess-movelist" aria-label="Move list">
      {rows.length === 0 && <p className="hint chess-movelist-empty">No moves yet.</p>}
      {rows.map((row, i) => (
        <div className="chess-move-row" key={row.n}>
          <span className="chess-move-num">{row.n}.</span>
          <span className="chess-move-san">{row.white?.san ?? ""}</span>
          <span className="chess-move-san">{row.black?.san ?? ""}</span>
          {i === rows.length - 1 && <div ref={endRef} />}
        </div>
      ))}
    </div>
  );
}

// ---------------------------- result banner ----------------------------

export const END_REASON_TEXT: Record<string, string> = {
  checkmate: "by checkmate",
  resign: "by resignation",
  timeout: "on time",
  stalemate: "by stalemate",
  fifty: "by the fifty-move rule",
  threefold: "by threefold repetition",
  insufficient: "by insufficient material",
  "draw-agreed": "by agreement",
  abandoned: "opponent left the game",
};

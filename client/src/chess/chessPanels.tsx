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

const CAPTURE_ORDER: Record<string, number> = { q: 0, r: 1, b: 2, n: 3, p: 4 };

/**
 * Pieces captured BY `color`, taken from the MOVE LIST.
 *
 * Deriving this from the board instead (start-count minus on-board-count) is
 * wrong the moment anyone promotes: the promoted pawn reads as a lost pawn, so
 * the opponent's tray sprouts a phantom capture and the material count is off.
 * The move list records each capture exactly and survives a rejoin, because
 * the server ships the full history in its snapshot.
 */
export function capturedBy(moves: ChessMoveInfo[], color: ChessColor): string[] {
  return moves
    .filter((m) => m.color === color && m.captured)
    .map((m) => m.captured as string)
    .sort((a, b) => (CAPTURE_ORDER[a] ?? 9) - (CAPTURE_ORDER[b] ?? 9));
}

/**
 * Material difference from the pieces actually ON the board (positive = white
 * ahead). Counting real pieces is promotion-proof: a new queen is simply worth
 * a queen.
 */
export function materialScore(fen: string): number {
  let score = 0;
  try {
    for (const row of new Chess(fen).board()) {
      for (const sq of row) {
        if (!sq) continue;
        const value = PIECE_VALUE[sq.type] ?? 0;
        score += sq.color === "w" ? value : -value;
      }
    }
  } catch {
    return 0;
  }
  return score;
}

export function CapturedTray({
  fen,
  moves,
  color,
}: {
  fen: string;
  moves: ChessMoveInfo[];
  color: ChessColor;
}) {
  // The tray shows what THIS player has taken off the board.
  const opponent: ChessColor = color === "white" ? "black" : "white";
  const pieces = capturedBy(moves, color);
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

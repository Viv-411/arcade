import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import type { ChessColor } from "@shared/chess";
import { shortFromColor } from "@shared/chess";
import type { BoardTheme } from "./theme";

/**
 * The board surface, shared by online and pass-and-play.
 *
 * It owns only INTERACTION state (what's selected, a pending promotion) and
 * derives everything it draws from the `fen` prop, so the parent stays the
 * single source of truth for the position. Legal destinations come from
 * chess.js — this component never reasons about chess rules itself, it just
 * asks which moves exist from a square.
 *
 * Supports both input styles, like chess.com: drag a piece, or tap the source
 * square and then tap a destination.
 */

interface Props {
  fen: string;
  orientation: ChessColor;
  /** Colours this viewer is allowed to move. Empty = read-only board. */
  movableColors: ChessColor[];
  lastMove: { from: string; to: string } | null;
  theme: BoardTheme;
  /** Return false to signal the move was rejected (snaps the piece back). */
  onMove: (from: string, to: string, promotion?: string) => boolean;
}

interface PendingPromotion {
  from: string;
  to: string;
}

const PROMOTION_CHOICES: { piece: string; label: string }[] = [
  { piece: "q", label: "Queen" },
  { piece: "r", label: "Rook" },
  { piece: "b", label: "Bishop" },
  { piece: "n", label: "Knight" },
];

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
/** Width of the rank gutter (and height of the file gutter), in px. */
const GUTTER = 18;

const PROMO_GLYPH: Record<string, Record<string, string>> = {
  white: { q: "♕", r: "♖", b: "♗", n: "♘" },
  black: { q: "♛", r: "♜", b: "♝", n: "♞" },
};

export default function ChessBoardView({
  fen,
  orientation,
  movableColors,
  lastMove,
  theme,
  onMove,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingPromotion | null>(null);
  const [boardWidth, setBoardWidth] = useState(() => responsiveWidth());

  useEffect(() => {
    const onResize = () => setBoardWidth(responsiveWidth());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // A throwaway chess.js instance purely for "what can move from here?".
  const game = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  // Any change of position clears interaction state (e.g. opponent moved).
  useEffect(() => {
    setSelected(null);
    setPending(null);
  }, [fen]);

  const turn = game.turn();
  const canMoveNow = movableColors.some((c) => shortFromColor(c) === turn);

  const legalFrom = useCallback(
    (square: string) => {
      try {
        return game.moves({ square: square as Square, verbose: true });
      } catch {
        return [];
      }
    },
    [game],
  );

  const isOwnMovablePiece = useCallback(
    (square: string) => {
      const piece = game.get(square as Square);
      if (!piece) return false;
      return movableColors.some((c) => shortFromColor(c) === piece.color) && piece.color === turn;
    },
    [game, movableColors, turn],
  );

  /** Commit a move, opening the promotion picker first when one is required. */
  const attemptMove = useCallback(
    (from: string, to: string): boolean => {
      if (!canMoveNow) return false;
      const options = legalFrom(from).filter((m) => m.to === to);
      if (options.length === 0) return false;
      if (options.some((m) => m.promotion)) {
        setPending({ from, to });
        setSelected(null);
        return true; // the picker will finish it
      }
      const ok = onMove(from, to);
      if (ok) setSelected(null);
      return ok;
    },
    [canMoveNow, legalFrom, onMove],
  );

  const onPieceDrop = useCallback(
    (from: Square, to: Square): boolean => attemptMove(from, to),
    [attemptMove],
  );

  const onSquareClick = useCallback(
    (square: Square) => {
      if (pending) return;
      if (selected) {
        if (square === selected) {
          setSelected(null);
          return;
        }
        // Tapping another of your own pieces re-targets instead of failing.
        if (attemptMove(selected, square)) return;
        setSelected(isOwnMovablePiece(square) ? square : null);
        return;
      }
      if (isOwnMovablePiece(square)) setSelected(square);
    },
    [pending, selected, attemptMove, isOwnMovablePiece],
  );

  const choosePromotion = useCallback(
    (piece: string) => {
      if (!pending) return;
      onMove(pending.from, pending.to, piece);
      setPending(null);
    },
    [pending, onMove],
  );

  // ---- square styling: last move, selection, check, legal destinations ----
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      styles[lastMove.from] = { backgroundColor: theme.lastMove };
      styles[lastMove.to] = { backgroundColor: theme.lastMove };
    }
    if (game.isCheck()) {
      // Tint the king that's actually in check.
      for (const row of game.board()) {
        for (const sq of row) {
          if (sq && sq.type === "k" && sq.color === turn) {
            styles[sq.square] = {
              ...styles[sq.square],
              background: "radial-gradient(circle, rgba(255,60,60,0.85) 12%, transparent 72%)",
            };
          }
        }
      }
    }
    if (selected) {
      styles[selected] = { ...styles[selected], backgroundColor: theme.selected };
      for (const move of legalFrom(selected)) {
        // chess.com convention: a dot on an empty square, a ring on a capture.
        const isCapture = Boolean(move.captured);
        styles[move.to] = {
          ...styles[move.to],
          background: isCapture
            ? "radial-gradient(circle, transparent 52%, rgba(20,20,20,0.32) 54%)"
            : "radial-gradient(circle, rgba(20,20,20,0.28) 18%, transparent 20%)",
          borderRadius: isCapture ? "50%" : undefined,
        };
      }
    }
    return styles;
  }, [lastMove, selected, game, turn, theme, legalFrom]);

  const promotingColor: ChessColor = turn === "w" ? "white" : "black";

  // Files/ranks in board order for the current orientation.
  const files = orientation === "white" ? FILES : [...FILES].reverse();
  const ranks = orientation === "white" ? RANKS : [...RANKS].reverse();

  return (
    <div className="chess-board-outer" style={{ width: boardWidth + GUTTER }}>
      {/* Coordinates are rendered HERE rather than by react-chessboard: its
          built-in notation paints each label in one of the two SQUARE colours
          by a parity rule, so on a themed board they sit at very low contrast
          against the square they're on (and crowd the corner square, which
          draws both a rank and a file). In the gutter they're always legible
          and can't collide with a piece. */}
      <div className="chess-ranks" style={{ height: boardWidth }} aria-hidden="true">
        {ranks.map((r) => (
          <span key={r}>{r}</span>
        ))}
      </div>

      <div className="chess-board-wrap" style={{ width: boardWidth }}>
        <Chessboard
          id="arcade-chess"
          position={fen}
          boardWidth={boardWidth}
          boardOrientation={orientation}
          onPieceDrop={onPieceDrop}
          onSquareClick={onSquareClick}
          isDraggablePiece={({ sourceSquare }) => isOwnMovablePiece(sourceSquare)}
          arePiecesDraggable={canMoveNow}
          customSquareStyles={squareStyles}
          customLightSquareStyle={{ backgroundColor: theme.light }}
          customDarkSquareStyle={{ backgroundColor: theme.dark }}
          customBoardStyle={{ borderRadius: "6px", boxShadow: "0 10px 30px rgba(0,0,0,0.45)" }}
          animationDuration={180}
          showBoardNotation={false}
        />

        {pending && (
          <div className="chess-promo-overlay" role="dialog" aria-label="Choose promotion piece">
            <div className="chess-promo-panel">
              <p className="chess-promo-title">Promote to</p>
              <div className="chess-promo-choices">
                {PROMOTION_CHOICES.map((c) => (
                  <button
                    key={c.piece}
                    className="chess-promo-btn"
                    onClick={() => choosePromotion(c.piece)}
                    aria-label={c.label}
                  >
                    <span className={`chess-promo-glyph ${promotingColor}`}>
                      {PROMO_GLYPH[promotingColor][c.piece]}
                    </span>
                    <span className="chess-promo-label">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Corner spacer keeps the file letters aligned under the board. */}
      <div className="chess-corner" aria-hidden="true" />
      <div className="chess-files" style={{ width: boardWidth }} aria-hidden="true">
        {files.map((f) => (
          <span key={f}>{f}</span>
        ))}
      </div>
    </div>
  );
}

/** Keep the board square and inside the viewport on phones. */
function responsiveWidth(): number {
  if (typeof window === "undefined") return 480;
  const byWidth = Math.min(window.innerWidth - 32, 560);
  const byHeight = window.innerHeight - 260;
  return Math.max(260, Math.min(byWidth, Math.max(260, byHeight)));
}

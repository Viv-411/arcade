import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Chess } from "chess.js";
import {
  DEFAULT_CHESS_TIME_CONTROL,
  colorFromShort,
  formatTimeControl,
  isUnlimited,
  otherChessColor,
  type ChessColor,
  type ChessColorPref,
  type ChessEndReason,
  type ChessMoveInfo,
  type ChessResult,
  type ChessTimeControl,
} from "@shared/chess";
import ChessBoardView from "../chess/ChessBoardView";
import { BoardPrefs, ColorPicker, TimeControlPicker } from "../chess/GameControls";
import { CapturedTray, ClockView, END_REASON_TEXT, MoveList } from "../chess/chessPanels";
import { playChessSound, setSoundEnabled, soundEnabled, soundForMove } from "../chess/sounds";
import { loadTheme, saveTheme, type BoardTheme } from "../chess/theme";
import Icon from "../components/Icon";

/**
 * Pass-and-play chess: TWO people sharing one device, with no server and no
 * account — same spirit as Imposter's local mode, and it must stay that way.
 * Everything here is React state plus a chess.js instance; nothing is emitted.
 *
 * Because there is exactly one trusted device, the clock runs client-side with
 * the same tick/increment/flag logic the server applies online.
 */

interface LocalOver {
  result: ChessResult;
  reason: ChessEndReason;
}

/** Same flag rule as the server: can this side still possibly mate? */
function hasMatingMaterial(game: Chess, color: ChessColor): boolean {
  const short = color === "white" ? "w" : "b";
  let minors = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== short) continue;
      if (sq.type === "p" || sq.type === "r" || sq.type === "q") return true;
      if (sq.type === "b" || sq.type === "n") minors += 1;
    }
  }
  return minors >= 2;
}

export default function ChessLocalPage() {
  // --- pre-game configuration ---
  const [started, setStarted] = useState(false);
  const [timeControl, setTimeControl] = useState<ChessTimeControl>(DEFAULT_CHESS_TIME_CONTROL);
  const [p1Color, setP1Color] = useState<ChessColorPref>("white");
  const [autoFlip, setAutoFlip] = useState(true);

  // --- board / preferences ---
  const [theme, setTheme] = useState<BoardTheme>(() => loadTheme());
  const [sound, setSound] = useState(() => soundEnabled());
  const [manualOrientation, setManualOrientation] = useState<ChessColor>("white");

  // --- game state ---
  const gameRef = useRef(new Chess());
  const [fen, setFen] = useState(() => gameRef.current.fen());
  const [moves, setMoves] = useState<ChessMoveInfo[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [over, setOver] = useState<LocalOver | null>(null);
  const [p1Actual, setP1Actual] = useState<ChessColor>("white");

  // --- clocks (client-side; single trusted device) ---
  const [whiteMs, setWhiteMs] = useState(0);
  const [blackMs, setBlackMs] = useState(0);
  const turnStartedAt = useRef<number | null>(null);
  const [, forceTick] = useState(0);

  const timed = !isUnlimited(timeControl);
  const turn: ChessColor = colorFromShort(gameRef.current.turn());
  const clockActive = started && timed && !over;

  // Display ticker: re-render ~10x/s while a clock is running.
  useEffect(() => {
    if (!clockActive) return;
    const id = setInterval(() => forceTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [clockActive]);

  const liveMs = useCallback(
    (color: ChessColor): number => {
      const base = color === "white" ? whiteMs : blackMs;
      if (!clockActive || turn !== color || turnStartedAt.current === null) return base;
      return Math.max(0, base - (Date.now() - turnStartedAt.current));
    },
    [whiteMs, blackMs, clockActive, turn],
  );

  const finish = useCallback((result: ChessResult, reason: ChessEndReason) => {
    turnStartedAt.current = null;
    setOver({ result, reason });
    playChessSound("gameEnd");
  }, []);

  // Flag detection — checked on every display tick.
  const liveWhite = liveMs("white");
  const liveBlack = liveMs("black");
  useEffect(() => {
    if (!clockActive) return;
    const flagged: ChessColor | null =
      liveWhite <= 0 ? "white" : liveBlack <= 0 ? "black" : null;
    if (!flagged) return;
    if (flagged === "white") setWhiteMs(0);
    else setBlackMs(0);
    const opponent = otherChessColor(flagged);
    if (!hasMatingMaterial(gameRef.current, opponent)) finish("draw", "insufficient");
    else finish(opponent, "timeout");
  }, [liveWhite, liveBlack, clockActive, finish]);

  const detectEnd = useCallback(
    (mover: ChessColor): boolean => {
      const g = gameRef.current;
      if (g.isCheckmate()) return finish(mover, "checkmate"), true;
      if (g.isStalemate()) return finish("draw", "stalemate"), true;
      if (g.isInsufficientMaterial()) return finish("draw", "insufficient"), true;
      if (g.isThreefoldRepetition()) return finish("draw", "threefold"), true;
      if (g.isDrawByFiftyMoves()) return finish("draw", "fifty"), true;
      if (g.isDraw()) return finish("draw", "fifty"), true;
      return false;
    },
    [finish],
  );

  const onMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      if (over || !started) return false;
      const g = gameRef.current;
      const mover = colorFromShort(g.turn());
      let move;
      try {
        move = g.move({ from, to, promotion });
      } catch {
        playChessSound("illegal");
        return false;
      }
      // Charge the clock and pay the increment, exactly like the server does.
      if (timed && turnStartedAt.current !== null) {
        const burned = Date.now() - turnStartedAt.current;
        const remaining = (mover === "white" ? whiteMs : blackMs) - burned;
        const updated = Math.max(0, remaining) + timeControl.incrementSeconds * 1000;
        if (mover === "white") setWhiteMs(updated);
        else setBlackMs(updated);
        turnStartedAt.current = Date.now();
      }
      const info: ChessMoveInfo = {
        san: move.san,
        from: move.from,
        to: move.to,
        color: colorFromShort(move.color),
        captured: move.captured ?? null,
        promotion: move.promotion ?? null,
      };
      setMoves((m) => [...m, info]);
      setLastMove({ from: move.from, to: move.to });
      setFen(g.fen());
      playChessSound(soundForMove(info));
      detectEnd(mover);
      return true;
    },
    [over, started, timed, whiteMs, blackMs, timeControl.incrementSeconds, detectEnd],
  );

  const startGame = useCallback(() => {
    const resolved: ChessColor =
      p1Color === "random" ? (Math.random() < 0.5 ? "white" : "black") : p1Color;
    gameRef.current = new Chess();
    setP1Actual(resolved);
    setFen(gameRef.current.fen());
    setMoves([]);
    setLastMove(null);
    setOver(null);
    setManualOrientation("white");
    if (!isUnlimited(timeControl)) {
      setWhiteMs(timeControl.baseMinutes * 60_000);
      setBlackMs(timeControl.baseMinutes * 60_000);
      turnStartedAt.current = Date.now();
    } else {
      setWhiteMs(0);
      setBlackMs(0);
      turnStartedAt.current = null;
    }
    setStarted(true);
  }, [p1Color, timeControl]);

  const rematch = useCallback(() => {
    // Swap who plays White, like a real rematch.
    const swapped = otherChessColor(p1Actual);
    gameRef.current = new Chess();
    setP1Actual(swapped);
    setFen(gameRef.current.fen());
    setMoves([]);
    setLastMove(null);
    setOver(null);
    if (!isUnlimited(timeControl)) {
      setWhiteMs(timeControl.baseMinutes * 60_000);
      setBlackMs(timeControl.baseMinutes * 60_000);
      turnStartedAt.current = Date.now();
    }
  }, [p1Actual, timeControl]);

  const orientation: ChessColor = autoFlip && !over ? turn : manualOrientation;

  const applyTheme = (t: BoardTheme) => {
    setTheme(t);
    saveTheme(t.id);
  };
  const applySound = (on: boolean) => {
    setSound(on);
    setSoundEnabled(on);
  };

  const nameFor = useCallback(
    (color: ChessColor) => (color === p1Actual ? "Player 1" : "Player 2"),
    [p1Actual],
  );

  const topColor: ChessColor = otherChessColor(orientation);
  const resultText = useMemo(() => {
    if (!over) return null;
    const detail = END_REASON_TEXT[over.reason] ?? "";
    if (over.result === "draw") return `Draw ${detail}`;
    return `${over.result === "white" ? "White" : "Black"} wins ${detail}`;
  }, [over]);

  // ------------------------------ setup screen ------------------------------
  if (!started) {
    return (
      <div className="page chess">
        <header className="mm-header">
          <Link to="/chess" className="back-link">
            ← Chess
          </Link>
          <h1 className="mm-title">
            <Icon name="crown" /> On This Device
          </h1>
        </header>
        <div className="entry panel">
          <p className="entry-blurb">
            Two players, one screen. Set the clock and who starts as White, then pass the
            device back and forth.
          </p>
          <label className="field">
            <span>Time control</span>
          </label>
          <TimeControlPicker value={timeControl} onChange={setTimeControl} />
          <ColorPicker label="Player 1 plays" value={p1Color} onChange={setP1Color} />
          <label className="field chess-toggle-field">
            <span>Auto-flip the board to the side to move</span>
            <button className="btn small" onClick={() => setAutoFlip((v) => !v)}>
              <Icon name={autoFlip ? "checkbox" : "square"} /> {autoFlip ? "On" : "Off"}
            </button>
          </label>
          <BoardPrefs theme={theme} onTheme={applyTheme} sound={sound} onSound={applySound} />
          <div className="entry-buttons">
            <button className="btn primary" onClick={startGame}>
              <Icon name="play" /> Start game
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------- game screen -------------------------------
  return (
    <div className="page chess chess-playing">
      <header className="mm-header">
        <Link to="/chess" className="back-link">
          ← Chess
        </Link>
        <h1 className="mm-title">
          <Icon name="crown" /> On This Device
        </h1>
      </header>

      <div className="chess-layout">
        <div className="chess-main">
          <div className="chess-player-bar">
            <div className="chess-player-info">
              <span className={`chess-color-dot ${topColor}`} />
              <strong>{nameFor(topColor)}</strong>
              <CapturedTray fen={fen} moves={moves} color={topColor} />
            </div>
            {timed && (
              <ClockView
                ms={liveMs(topColor)}
                active={clockActive && turn === topColor}
                label={nameFor(topColor)}
              />
            )}
          </div>

          <ChessBoardView
            fen={fen}
            orientation={orientation}
            movableColors={over ? [] : ["white", "black"]}
            lastMove={lastMove}
            theme={theme}
            onMove={onMove}
          />

          <div className="chess-player-bar">
            <div className="chess-player-info">
              <span className={`chess-color-dot ${orientation}`} />
              <strong>{nameFor(orientation)}</strong>
              <CapturedTray fen={fen} moves={moves} color={orientation} />
            </div>
            {timed && (
              <ClockView
                ms={liveMs(orientation)}
                active={clockActive && turn === orientation}
                label={nameFor(orientation)}
              />
            )}
          </div>
        </div>

        <aside className="chess-side panel">
          {over ? (
            <div className="chess-result">
              <h3>
                <Icon name="trophy" /> {resultText}
              </h3>
            </div>
          ) : (
            <p className="chess-turn">
              <span className={`chess-color-dot ${turn}`} />
              {nameFor(turn)} to move
              {gameRef.current.isCheck() && <strong className="chess-check"> — check!</strong>}
            </p>
          )}

          <MoveList moves={moves} />

          <div className="chess-actions">
            <button className="btn small" onClick={() => setAutoFlip((v) => !v)}>
              <Icon name={autoFlip ? "checkbox" : "square"} /> Auto-flip
            </button>
            <button
              className="btn small"
              disabled={autoFlip && !over}
              onClick={() => setManualOrientation((o) => otherChessColor(o))}
            >
              <Icon name="repeat" /> Flip board
            </button>
            {!over && (
              <>
                <button
                  className="btn small danger"
                  onClick={() => finish(otherChessColor(turn), "resign")}
                >
                  <Icon name="flag" /> {nameFor(turn)} resigns
                </button>
                <button className="btn small" onClick={() => finish("draw", "draw-agreed")}>
                  <Icon name="hand" /> Agree a draw
                </button>
              </>
            )}
            <button className="btn small primary" onClick={rematch}>
              <Icon name="repeat" /> Rematch (swap colours)
            </button>
            <button className="btn small" onClick={() => setStarted(false)}>
              <Icon name="settings" /> New game / settings
            </button>
          </div>

          <BoardPrefs theme={theme} onTheme={applyTheme} sound={sound} onSound={applySound} />
          <p className="settings-line">{formatTimeControl(timeControl)} · pass and play</p>
        </aside>
      </div>
    </div>
  );
}

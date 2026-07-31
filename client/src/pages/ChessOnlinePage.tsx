import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CHESS_MAX_PLAYERS,
  CHESS_MIN_PLAYERS,
  DEFAULT_CHESS_TIME_CONTROL,
  formatTimeControl,
  isUnlimited,
  otherChessColor,
  type ChessColor,
  type ChessColorPref,
  type ChessTimeControl,
} from "@shared/chess";
import { useChessOnline } from "../chess/useChessOnline";
import { useJoinLinkOverride } from "../core/hooks";
import ChessBoardView from "../chess/ChessBoardView";
import { BoardPrefs, ColorPicker, TimeControlPicker } from "../chess/GameControls";
import { CapturedTray, ClockView, END_REASON_TEXT, MoveList } from "../chess/panels";
import { setSoundEnabled, soundEnabled } from "../chess/sounds";
import { loadTheme, saveTheme, type BoardTheme } from "../chess/theme";
import GameEntry from "../components/GameEntry";
import GameLobby from "../components/GameLobby";
import Toasts from "../components/Toasts";
import Icon from "../components/Icon";

/**
 * Online chess. The server is authoritative for legality, turn order, clocks,
 * and results; this page renders its snapshots and sends intents. Reuses the
 * shared entry/lobby/reconnection components exactly like the other games.
 */
export default function ChessOnlinePage() {
  const { state, actions } = useChessOnline();
  const { room } = state;
  const [entryTc, setEntryTc] = useState<ChessTimeControl>(DEFAULT_CHESS_TIME_CONTROL);
  const [entryColor, setEntryColor] = useState<ChessColorPref>("random");
  const [theme, setTheme] = useState<BoardTheme>(() => loadTheme());
  const [sound, setSound] = useState(() => soundEnabled());
  const [flipped, setFlipped] = useState(false);

  useJoinLinkOverride(room?.code ?? null, actions.leaveRoom);

  const applyTheme = (t: BoardTheme) => {
    setTheme(t);
    saveTheme(t.id);
  };
  const applySound = (on: boolean) => {
    setSound(on);
    setSoundEnabled(on);
  };

  const isHost = room ? state.playerId === room.hostId : false;
  const myColor: ChessColor = state.myColor ?? "white";
  const orientation: ChessColor = flipped ? otherChessColor(myColor) : myColor;
  const opponent = room?.players.find((p) => p.id !== state.playerId) ?? null;
  const me = room?.players.find((p) => p.id === state.playerId) ?? null;

  const resultText = useMemo(() => {
    if (!room || room.state !== "finished" || !room.result) return null;
    const detail = END_REASON_TEXT[room.endReason ?? ""] ?? "";
    if (room.result === "draw") return `Draw ${detail}`;
    const iWon = room.result === state.myColor;
    return `${room.result === "white" ? "White" : "Black"} wins ${detail}${
      state.myColor ? (iWon ? " — you win!" : " — you lose.") : ""
    }`;
  }, [room, state.myColor]);

  // ------------------------------ entry ------------------------------
  if (!room) {
    return (
      <div className="page chess">
        <Header />
        <GameEntry
          busy={state.busy}
          blurb={
            <>
              Play a full game of chess against a friend on another device. Set a clock, pick
              your colour, and share the room code — the server referees every move.
            </>
          }
          preActions={
            <>
              <label className="field">
                <span>Time control</span>
              </label>
              <TimeControlPicker value={entryTc} onChange={setEntryTc} />
              <ColorPicker label="You play" value={entryColor} onChange={setEntryColor} />
            </>
          }
          onCreate={(name) =>
            actions.createRoom(name, false, { timeControl: entryTc, hostColor: entryColor })
          }
          onJoin={actions.joinRoom}
          onQuickPlay={(name) => actions.quickPlay(name, { timeControl: entryTc })}
        />
        <section className="howto panel">
          <h3>How to play</h3>
          <ol>
            <li>Two players. Create a private room and share the code, or use Quick Play.</li>
            <li>
              Quick Play only pairs you with someone who chose the SAME time control, so a
              bullet game never gets matched against a 15+10.
            </li>
            <li>
              Drag or tap to move. Legal squares light up; promotion opens a picker; check,
              checkmate, stalemate and all the draw rules are detected for you.
            </li>
            <li>
              The clock is kept by the server — closing your tab does not pause it, and a
              refresh puts you straight back with the right time remaining.
            </li>
          </ol>
        </section>
        <Toasts toasts={state.toasts} onDismiss={actions.dismissToast} />
      </div>
    );
  }

  // ------------------------------ lobby ------------------------------
  if (room.state === "lobby") {
    return (
      <div className="page chess">
        <Header />
        <GameLobby
          room={room}
          playerId={state.playerId}
          joinPath="/chess/online"
          gameKey="chess"
          minPlayers={CHESS_MIN_PLAYERS}
          maxPlayers={CHESS_MAX_PLAYERS}
          settingsLine={`${formatTimeControl(room.settings.timeControl)} · host plays ${
            room.settings.hostColor
          } · 2 players`}
          extras={
            <div className="chess-lobby-extras">
              {isHost ? (
                <>
                  <label className="field">
                    <span>Time control</span>
                  </label>
                  <TimeControlPicker
                    value={room.settings.timeControl}
                    onChange={(tc) => actions.setChessSettings({ timeControl: tc })}
                  />
                  <ColorPicker
                    label="You play"
                    value={room.settings.hostColor}
                    onChange={(c) => actions.setChessSettings({ hostColor: c })}
                  />
                </>
              ) : (
                <p className="hint">
                  <Icon name="clock" /> {formatTimeControl(room.settings.timeControl)} — the
                  host sets the time control and colours.
                </p>
              )}
              <BoardPrefs theme={theme} onTheme={applyTheme} sound={sound} onSound={applySound} />
            </div>
          }
          onToggleReady={actions.toggleReady}
          onStart={actions.startGame}
          onLeave={actions.leaveRoom}
        />
        <Toasts toasts={state.toasts} onDismiss={actions.dismissToast} />
      </div>
    );
  }

  // ------------------------------ game ------------------------------
  const finished = room.state === "finished";
  const timed = !isUnlimited(room.settings.timeControl);
  const clocks = state.clocks;
  const topColor = otherChessColor(orientation);
  const drawOfferToMe =
    room.drawOfferBy !== null && state.myColor !== null && room.drawOfferBy !== state.myColor;

  const nameOf = (color: ChessColor): string => {
    if (state.myColor === color) return me?.name ?? "You";
    return opponent?.name ?? "Opponent";
  };
  const connectedOf = (color: ChessColor): boolean => {
    if (state.myColor === color) return true;
    return opponent?.connected ?? false;
  };

  return (
    <div className="page chess">
      <Header />
      <div className="chess-layout">
        <div className="chess-main">
          <PlayerBar
            color={topColor}
            name={nameOf(topColor)}
            connected={connectedOf(topColor)}
            fen={state.fen}
            ms={topColor === "white" ? clocks?.whiteMs : clocks?.blackMs}
            active={clocks?.running === topColor}
            timed={timed}
          />

          <ChessBoardView
            fen={state.fen}
            orientation={orientation}
            movableColors={finished || !state.myColor ? [] : [state.myColor]}
            lastMove={state.lastMove}
            theme={theme}
            onMove={actions.makeMove}
          />

          <PlayerBar
            color={orientation}
            name={nameOf(orientation)}
            connected={connectedOf(orientation)}
            fen={state.fen}
            ms={orientation === "white" ? clocks?.whiteMs : clocks?.blackMs}
            active={clocks?.running === orientation}
            timed={timed}
          />
        </div>

        <aside className="chess-side panel">
          {finished ? (
            <div className="chess-result">
              <h3>
                <Icon name="trophy" /> {resultText}
              </h3>
              <button className="btn primary" onClick={actions.playAgain}>
                <Icon name="repeat" /> Rematch (swap colours)
              </button>
            </div>
          ) : (
            <p className="chess-turn">
              <span className={`chess-color-dot ${room.turn}`} />
              {room.turn === state.myColor ? "Your move" : `${nameOf(room.turn)} to move`}
              {room.inCheck && <strong className="chess-check"> — check!</strong>}
            </p>
          )}

          {!finished && opponent && !opponent.connected && (
            <p className="hint chess-reconnect-note">
              <Icon name="warning" /> {opponent.name} disconnected. Their clock keeps running —
              if it hits zero you win on time.
            </p>
          )}

          {drawOfferToMe && !finished && (
            <div className="chess-draw-offer">
              <p>
                <Icon name="hand" /> {opponent?.name ?? "Your opponent"} offers a draw.
              </p>
              <div className="chess-actions">
                <button className="btn small primary" onClick={() => actions.respondDraw(true)}>
                  Accept
                </button>
                <button className="btn small" onClick={() => actions.respondDraw(false)}>
                  Decline
                </button>
              </div>
            </div>
          )}
          {!finished && room.drawOfferBy === state.myColor && (
            <p className="hint">Draw offered — waiting for a reply.</p>
          )}

          <MoveList moves={room.moves} />

          <div className="chess-actions">
            <button className="btn small" onClick={() => setFlipped((f) => !f)}>
              <Icon name="repeat" /> Flip board
            </button>
            {!finished && (
              <>
                <button
                  className="btn small"
                  disabled={room.drawOfferBy === state.myColor}
                  onClick={actions.offerDraw}
                >
                  <Icon name="hand" /> Offer draw
                </button>
                <ResignButton onResign={actions.resign} />
              </>
            )}
            <button className="btn small danger" onClick={actions.leaveRoom}>
              Leave
            </button>
          </div>

          <BoardPrefs theme={theme} onTheme={applyTheme} sound={sound} onSound={applySound} />
          <p className="settings-line">
            {formatTimeControl(room.settings.timeControl)} · room {room.code}
          </p>
        </aside>
      </div>

      {state.status === "reconnecting" && (
        <div className="overlay reconnecting">
          <div className="panel">
            <div className="spinner" />
            <p>Reconnecting…</p>
          </div>
        </div>
      )}
      <Toasts toasts={state.toasts} onDismiss={actions.dismissToast} />
    </div>
  );
}

function Header() {
  return (
    <header className="mm-header">
      <Link to="/chess" className="back-link">
        ← Chess
      </Link>
      <h1 className="mm-title">
        <Icon name="crown" /> Chess
      </h1>
    </header>
  );
}

function PlayerBar({
  color,
  name,
  connected,
  fen,
  ms,
  active,
  timed,
}: {
  color: ChessColor;
  name: string;
  connected: boolean;
  fen: string;
  ms: number | undefined;
  active: boolean;
  timed: boolean;
}) {
  return (
    <div className="chess-player-bar">
      <div className="chess-player-info">
        <span className={`chess-color-dot ${color}`} />
        <strong className={connected ? "" : "disconnected"}>{name}</strong>
        {!connected && <span className="dot off" title="Disconnected" />}
        <CapturedTray fen={fen} color={color} />
      </div>
      {timed && <ClockView ms={ms ?? 0} active={active} label={name} />}
    </div>
  );
}

/** Two-tap confirm so a mis-tap can't throw the game. */
function ResignButton({ onResign }: { onResign: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button className="btn small danger" onClick={() => setConfirming(true)}>
        <Icon name="flag" /> Resign
      </button>
    );
  }
  return (
    <>
      <button className="btn small danger" onClick={onResign}>
        Confirm resign
      </button>
      <button className="btn small" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import type { MatchMode } from "@shared/types";
import { useMindMeld } from "../mindmeld/useMindMeld";
import { useJoinLinkOverride } from "../core/hooks";
import GameEntry from "../components/GameEntry";
import GameLobby from "../components/GameLobby";
import GameBoard from "../mindmeld/GameBoard";
import EndScreen from "../mindmeld/EndScreen";
import Toasts from "../components/Toasts";

export default function MindMeldPage() {
  const { state, actions } = useMindMeld();
  const { room } = state;
  const [roundTimeSec, setRoundTimeSec] = useState(60);
  const [matchMode, setMatchMode] = useState<MatchMode>("strict");
  useJoinLinkOverride(room?.code ?? null, actions.leaveRoom);

  let screen: JSX.Element;
  if (!room) {
    screen = (
      <>
        <GameEntry
        busy={state.busy}
        blurb={
          <>
            Sync brains with 2–4 players: everyone secretly submits a word, then keeps
            submitting until you all say the <strong>same</strong> word. Used words are
            dead forever!
          </>
        }
        advanced={
          <>
            <label className="field">
              <span>Round time</span>
              <select
                value={roundTimeSec}
                onChange={(e) => setRoundTimeSec(Number(e.target.value))}
              >
                <option value={30}>30 seconds</option>
                <option value={60}>60 seconds</option>
                <option value={90}>90 seconds</option>
                <option value={120}>2 minutes</option>
              </select>
            </label>
            <label className="field">
              <span>Word matching</span>
              <select
                value={matchMode}
                onChange={(e) => setMatchMode(e.target.value === "loose" ? "loose" : "strict")}
              >
                <option value="strict">Strict (exact after normalizing)</option>
                <option value="loose">Loose (cats = cat)</option>
              </select>
            </label>
          </>
        }
          onCreate={(name) => actions.createRoom(name, false, { roundTimeSec, matchMode })}
          onJoin={actions.joinRoom}
          onQuickPlay={actions.quickPlay}
        />
        <section className="howto panel">
          <h3>How to play</h3>
          <ol>
            <li>
              2–4 players each secretly submit a word every round — round 1 is anything
              at all.
            </li>
            <li>
              All words are revealed. Now try to submit a word that bridges
              everyone&apos;s words.
            </li>
            <li>Any word anyone has ever said is dead — it can never be used again.</li>
            <li>You win together the moment everyone says the exact same word. 🧠⚡🧠</li>
          </ol>
        </section>
      </>
    );
  } else if (room.state === "lobby") {
    screen = (
      <GameLobby
        room={room}
        playerId={state.playerId}
        joinPath="/mindmeld"
        settingsLine={`⏱ ${room.settings.roundTimeSec}s rounds · max ${
          room.settings.maxRounds === 0 ? "∞" : room.settings.maxRounds
        } rounds · match: ${room.settings.matchMode}`}
        onToggleReady={actions.toggleReady}
        onStart={actions.startGame}
        onLeave={actions.leaveRoom}
      />
    );
  } else if (room.state === "finished") {
    screen = (
      <EndScreen
        room={room}
        playerId={state.playerId}
        win={state.win}
        onPlayAgain={actions.playAgain}
        onLeave={actions.leaveRoom}
      />
    );
  } else {
    screen = (
      <GameBoard
        room={room}
        playerId={state.playerId}
        myWord={state.myWord}
        reveal={state.reveal}
        revealSecondsLeft={state.revealSecondsLeft}
        onLockIn={actions.lockIn}
        onUnlock={actions.unlock}
        onLeave={actions.leaveRoom}
      />
    );
  }

  return (
    <div className="page mindmeld">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">🧠 Mind Meld</h1>
      </header>
      {screen}
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

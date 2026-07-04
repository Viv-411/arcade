import { Link } from "react-router-dom";
import { useMindMeld } from "../mindmeld/useMindMeld";
import Entry from "../mindmeld/Entry";
import Lobby from "../mindmeld/Lobby";
import GameBoard from "../mindmeld/GameBoard";
import EndScreen from "../mindmeld/EndScreen";
import Toasts from "../components/Toasts";

export default function MindMeldPage() {
  const { state, actions } = useMindMeld();
  const { room } = state;

  let screen: JSX.Element;
  if (!room) {
    screen = (
      <Entry
        busy={state.busy}
        onCreate={actions.createRoom}
        onJoin={actions.joinRoom}
        onQuickPlay={actions.quickPlay}
      />
    );
  } else if (room.state === "lobby") {
    screen = (
      <Lobby
        room={room}
        playerId={state.playerId}
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

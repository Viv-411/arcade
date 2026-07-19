import { Link } from "react-router-dom";
import { cwTeamLabel } from "@shared/codewords";
import { useCodewords } from "../codewords/useCodewords";
import { useJoinLinkOverride } from "../core/hooks";
import GameEntry from "../components/GameEntry";
import CodewordsLobby from "../codewords/CodewordsLobby";
import BoardGrid from "../codewords/BoardGrid";
import ClueInput from "../codewords/ClueInput";
import { ClueBar, ClueHistory, WinnerBanner } from "../codewords/CluePanel";
import Toasts from "../components/Toasts";

export default function CodewordsRemotePage() {
  const { state, actions } = useCodewords("codewords");
  const { room } = state;
  const me = room?.players.find((p) => p.id === state.playerId) ?? null;
  const myTeam = me?.team ?? null;
  useJoinLinkOverride(room?.code ?? null, actions.leaveRoom);

  let screen: JSX.Element;
  if (!room) {
    screen = (
      <>
        <GameEntry
          busy={state.busy}
          blurb={
            <>
              Two teams, one grid of 25 words, one shared secret key. Spymasters give
              one-word clues; operatives vote on which cards to flip —{" "}
              <strong>never touch the 💀</strong>.
            </>
          }
          onCreate={(name) => actions.createRoom(name, false)}
          onJoin={actions.joinRoom}
          onQuickPlay={actions.quickPlay}
        />
        <section className="howto panel">
          <h3>How to play</h3>
          <ol>
            <li>4-10 players in two teams; each team picks a 🕵️ spymaster.</li>
            <li>Both spymasters privately see the same full key (who's red, blue, bystander,
              assassin).</li>
            <li>On your team's turn the spymaster types a one-word clue + number; operatives
              tap cards to vote — a majority of your team's connected operatives flips the
              card.</li>
            <li>Your agent: keep guessing (up to the clue's number). Anything else ends the
              turn — and the assassin ends the game.</li>
            <li>Find all your agents first to win. Talk out loud or on your own call!</li>
          </ol>
        </section>
      </>
    );
  } else if (room.state === "lobby") {
    screen = (
      <CodewordsLobby
        room={room}
        playerId={state.playerId}
        onAssignTeam={actions.assignTeam}
        onSetSpymaster={actions.setSpymaster}
        onToggleReady={actions.toggleReady}
        onStart={actions.startGame}
        onLeave={actions.leaveRoom}
      />
    );
  } else {
    const isSpymaster = me?.role === "spymaster";
    const myClueTurn =
      room.state === "playing" &&
      isSpymaster &&
      room.phase === "clue" &&
      room.activeTeam === myTeam;
    const canGuess =
      room.state === "playing" &&
      !isSpymaster &&
      room.phase === "guess" &&
      room.activeTeam === myTeam;
    const needMySpymaster =
      room.state === "playing" && myTeam !== null && room.needsSpymaster.includes(myTeam);
    const finished = room.state === "finished";
    screen = (
      <>
        {finished && (
          <WinnerBanner
            room={room}
            myTeam={myTeam}
            onPlayAgain={actions.playAgain}
            onLeave={actions.leaveRoom}
          />
        )}
        <ClueBar room={room} myTeam={myTeam} />
        {needMySpymaster && !isSpymaster && (
          <div className="panel cw-claim">
            <p>Your team's spymaster left!</p>
            <button
              className="btn primary"
              onClick={() => state.playerId && actions.setSpymaster(state.playerId)}
            >
              🕵️ Become the {myTeam ? cwTeamLabel(myTeam) : ""} spymaster
            </button>
          </div>
        )}
        {myClueTurn && (
          <ClueInput onSubmit={(word, number, reset) => actions.submitClue(word, number, reset)} />
        )}
        <BoardGrid
          board={room.board}
          cardKey={finished ? room.fullKey : state.cardKey}
          tally={state.tally?.cards ?? null}
          myVote={state.myVote}
          interactive={canGuess}
          onCard={(i) => actions.voteCard(i, state.myVote)}
        />
        {isSpymaster && !finished && (
          <p className="hint">
            🕵️ Only you and the other spymaster see the card colors — don't say them out
            loud… except through your clue.
          </p>
        )}
        {canGuess && (
          <div className="cw-guess-actions">
            <p className="hint">
              Tap a card to vote ({state.tally?.needed ?? 1} vote
              {(state.tally?.needed ?? 1) === 1 ? "" : "s"} flips it). Tap again to take your
              vote back.
            </p>
            <button
              className={`btn ${state.myVote === "pass" ? "primary" : ""}`}
              disabled={room.guessesMade < 1}
              onClick={() => actions.voteCard("pass", state.myVote)}
            >
              ✋ Vote to pass {state.tally?.pass ? `(${state.tally.pass})` : ""}
            </button>
          </div>
        )}
        <ClueHistory room={room} />
        {!finished && (
          <div className="lobby-buttons">
            <button className="btn danger" onClick={actions.leaveRoom}>
              Leave game
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="page codewords">
      <header className="mm-header">
        <Link to="/codewords" className="back-link">
          ← Codewords
        </Link>
        <h1 className="mm-title">🗝️ Codewords</h1>
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

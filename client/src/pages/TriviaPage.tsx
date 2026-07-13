import { useState } from "react";
import { Link } from "react-router-dom";
import {
  TRIVIA_MAX_PLAYERS,
  TRIVIA_MIN_PLAYERS,
  type TriviaDifficulty,
} from "@shared/trivia";
import { useTrivia } from "../trivia/useTrivia";
import { useJoinLinkOverride } from "../core/hooks";
import GameEntry from "../components/GameEntry";
import GameLobby from "../components/GameLobby";
import VoteScreen from "../trivia/VoteScreen";
import QuestionScreen from "../trivia/QuestionScreen";
import TriviaFinal from "../trivia/TriviaFinal";
import Toasts from "../components/Toasts";

export default function TriviaPage() {
  const { state, actions } = useTrivia();
  const { room } = state;
  const [questionsPerGame, setQuestionsPerGame] = useState(10);
  const [questionTimeSec, setQuestionTimeSec] = useState(20);
  useJoinLinkOverride(room?.code ?? null, actions.leaveRoom);

  let screen: JSX.Element;
  if (!room) {
    screen = (
      <>
        <GameEntry
        busy={state.busy}
        blurb={
          <>
            Race 2–10 players through rapid-fire multiple choice questions. Vote on a
            category, then answer <strong>fast</strong> — correct answers score more the
            quicker you lock them in!
          </>
        }
        advanced={
          <>
            <label className="field">
              <span>Questions per game</span>
              <select
                value={questionsPerGame}
                onChange={(e) => setQuestionsPerGame(Number(e.target.value))}
              >
                <option value={5}>5 questions</option>
                <option value={10}>10 questions</option>
                <option value={15}>15 questions</option>
                <option value={20}>20 questions</option>
              </select>
            </label>
            <label className="field">
              <span>Seconds per question</span>
              <select
                value={questionTimeSec}
                onChange={(e) => setQuestionTimeSec(Number(e.target.value))}
              >
                <option value={10}>10 seconds</option>
                <option value={15}>15 seconds</option>
                <option value={20}>20 seconds</option>
                <option value={30}>30 seconds</option>
              </select>
            </label>
          </>
        }
          onCreate={(name) =>
            actions.createRoom(name, false, { questionsPerGame, questionTimeSec })
          }
          onJoin={actions.joinRoom}
          onQuickPlay={actions.quickPlay}
        />
        <section className="howto panel">
          <h3>How to play</h3>
          <ol>
            <li>2–10 players vote on a question category (or leave it to chance).</li>
            <li>Everyone answers the same multiple-choice questions at the same time.</li>
            <li>
              Correct answers earn up to 1000 points — the faster you answer, the more
              you score.
            </li>
            <li>Highest total after the last question wins. ⚡</li>
          </ol>
        </section>
      </>
    );
  } else if (room.state === "lobby") {
    const isHost = state.playerId === room.hostId;
    screen = (
      <GameLobby
        room={room}
        playerId={state.playerId}
        joinPath="/trivia"
        settingsLine={`❓ ${room.settings.questionsPerGame} questions · ⏱ ${room.settings.questionTimeSec}s each · difficulty: ${room.settings.difficulty} · up to ${TRIVIA_MAX_PLAYERS} players`}
        minPlayers={TRIVIA_MIN_PLAYERS}
        maxPlayers={TRIVIA_MAX_PLAYERS}
        extras={
          <label className="field difficulty-field">
            <span>Difficulty {isHost ? "" : "(host chooses)"}</span>
            <select
              value={room.settings.difficulty}
              disabled={!isHost}
              onChange={(e) => actions.setDifficulty(e.target.value as TriviaDifficulty)}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
        }
        onToggleReady={actions.toggleReady}
        onStart={actions.startGame}
        onLeave={actions.leaveRoom}
      />
    );
  } else if (room.state === "voting") {
    screen = (
      <VoteScreen
        room={room}
        vote={state.vote}
        myVote={state.myVote}
        onVote={actions.voteCategory}
        onLeave={actions.leaveRoom}
      />
    );
  } else if (room.state === "finished") {
    screen = (
      <TriviaFinal
        room={room}
        playerId={state.playerId}
        final={state.final}
        onPlayAgain={actions.playAgain}
        onLeave={actions.leaveRoom}
      />
    );
  } else {
    screen = (
      <QuestionScreen
        room={room}
        playerId={state.playerId}
        question={state.question}
        myChoice={state.myChoice}
        reveal={state.reveal}
        revealSecondsLeft={state.revealSecondsLeft}
        onAnswer={actions.answer}
        onLeave={actions.leaveRoom}
      />
    );
  }

  return (
    <div className="page trivia">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">⚡ Speed Trivia</h1>
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

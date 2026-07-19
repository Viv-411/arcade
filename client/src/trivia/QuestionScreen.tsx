import type {
  TriviaQuestionPublic,
  TriviaRevealPayload,
  TriviaSnapshot,
} from "@shared/trivia";
import { useSecondsLeft, useTimeFraction } from "../core/hooks";
import Icon from "../components/Icon";

interface Props {
  room: TriviaSnapshot;
  playerId: string | null;
  question: TriviaQuestionPublic | null;
  myChoice: number | null;
  reveal: TriviaRevealPayload | null;
  revealSecondsLeft: number | null;
  onAnswer: (optionIndex: number) => void;
  onLeave: () => void;
}

export default function QuestionScreen({
  room,
  playerId,
  question,
  myChoice,
  reveal,
  revealSecondsLeft,
  onAnswer,
  onLeave,
}: Props) {
  const revealed = reveal !== null && reveal.index === question?.index;
  const secondsLeft = useSecondsLeft(revealed ? null : question?.deadline ?? null);
  const fraction = useTimeFraction(
    revealed ? null : question?.deadline ?? null,
    room.settings.questionTimeSec * 1000,
  );

  if (!question) {
    return (
      <div className="panel vote-screen">
        <div className="spinner" />
        <p className="hint">Loading questions…</p>
      </div>
    );
  }

  const myReveal = revealed ? reveal.perPlayer.find((e) => e.playerId === playerId) : null;
  const answered = myChoice !== null;

  return (
    <div className="game-board trivia-board">
      <div className="round-bar panel">
        <div className="round-info">
          <span className="round-number">
            Q {question.index + 1}
            <span className="round-max"> / {question.total}</span>
          </span>
          <div className="question-category">{question.category}</div>
        </div>
        <div className={`timer ${secondsLeft !== null && secondsLeft <= 5 ? "urgent" : ""}`}>
          {revealed ? "—" : secondsLeft !== null ? `${secondsLeft}s` : "…"}
        </div>
        <button className="btn small danger" onClick={onLeave}>
          Leave
        </button>
      </div>

      {!revealed && (
        <div className="timer-track">
          <div
            className={`timer-fill ${fraction < 0.3 ? "urgent" : ""}`}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      )}

      <div className="panel question-panel">
        <p className="question-text">{question.questionText}</p>
        <div className="answer-grid">
          {question.options.map((opt, i) => {
            const classes = ["answer-btn"];
            if (revealed) {
              if (i === reveal.correctIndex) classes.push("correct");
              else if (myReveal?.choice === i) classes.push("wrong");
              else classes.push("dimmed");
            } else if (myChoice === i) {
              classes.push("chosen");
            } else if (answered) {
              classes.push("dimmed");
            }
            return (
              <button
                key={i}
                className={classes.join(" ")}
                disabled={answered || revealed}
                onClick={() => onAnswer(i)}
              >
                <span className="answer-letter">{String.fromCharCode(65 + i)}</span>
                <span className="answer-text">{opt}</span>
              </button>
            );
          })}
        </div>
        {!revealed && answered && <p className="hint">Answer locked in — waiting for others…</p>}
        {revealed && myReveal && (
          <p className={`points-earned ${myReveal.correct ? "good" : "bad"}`}>
            {myReveal.correct ? (
              <><Icon name="check" /> Correct! +{myReveal.pointsEarned} points</>
            ) : myReveal.choice === null ? (
              <><Icon name="clock" /> No answer — 0 points</>
            ) : (
              <><Icon name="close" /> Wrong — 0 points</>
            )}
          </p>
        )}
      </div>

      <div className="players-bar">
        {room.players.map((p) => (
          <div
            key={p.id}
            className={`player-chip ${p.answered ? "locked" : ""} ${p.connected ? "" : "disconnected"}`}
          >
            <span className={`dot ${p.connected ? "on" : "off"}`} />
            {p.name}
            {p.id === playerId && " (you)"}
            <span className="lock-icon">{p.answered ? <Icon name="lock" /> : "…"}</span>
          </div>
        ))}
      </div>

      {revealed && (
        <div className="panel scoreboard-panel">
          <h3>Standings</h3>
          <ol className="scoreboard">
            {reveal.scoreboard.map((e, rank) => {
              const delta = reveal.perPlayer.find((pp) => pp.playerId === e.playerId);
              return (
                <li key={e.playerId} className={e.playerId === playerId ? "me" : ""}>
                  <span className="rank">#{rank + 1}</span>
                  <span className="player-name">{e.name}</span>
                  {delta && delta.pointsEarned > 0 && (
                    <span className="delta">+{delta.pointsEarned}</span>
                  )}
                  <span className="total-score">{e.totalScore}</span>
                </li>
              );
            })}
          </ol>
          {revealSecondsLeft !== null && (
            <p className="next-round">Next question in {revealSecondsLeft}…</p>
          )}
        </div>
      )}
    </div>
  );
}

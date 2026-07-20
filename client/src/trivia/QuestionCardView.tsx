import type { ReactNode } from "react";

interface Props {
  questionText: string;
  options: string[];
  /** The locked-in choice, if any. */
  myChoice: number | null;
  revealed: boolean;
  /** Required once revealed. */
  correctIndex?: number | null;
  /** Line under the answers after the reveal (points earned etc.). */
  resultLine?: ReactNode;
  /** Line while waiting after answering (multiplayer's "waiting for others"). */
  waitingLine?: ReactNode;
  onAnswer: (optionIndex: number) => void;
}

/**
 * PRESENTATIONAL question card (text + lettered answer grid + reveal
 * coloring), shared by multiplayer Speed Trivia and solo practice play —
 * it renders whatever it's told and decides nothing.
 */
export default function QuestionCardView({
  questionText,
  options,
  myChoice,
  revealed,
  correctIndex,
  resultLine,
  waitingLine,
  onAnswer,
}: Props) {
  const answered = myChoice !== null;
  return (
    <div className="panel question-panel">
      <p className="question-text">{questionText}</p>
      <div className="answer-grid">
        {options.map((opt, i) => {
          const classes = ["answer-btn"];
          if (revealed) {
            if (i === correctIndex) classes.push("correct");
            else if (myChoice === i) classes.push("wrong");
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
      {!revealed && answered && waitingLine}
      {revealed && resultLine}
    </div>
  );
}

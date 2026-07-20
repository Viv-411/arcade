import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DEFAULT_TRIVIA_SETTINGS } from "@shared/trivia";
import { useAuth } from "../auth/AuthContext";
import { getSet, listQuestions, type SetSummary } from "../sets/api";
import QuestionCardView from "../trivia/QuestionCardView";
import Icon from "../components/Icon";

/**
 * SOLO practice trivia. No sockets, no server, no accounts beyond the
 * Supabase read that fetches the set under the player's own RLS session.
 * Scoring happens entirely in the browser and is PRACTICE ONLY — it is not
 * cheat-proof and never feeds account stats or any leaderboard.
 */

const BASE_POINTS = 1000;
const QUESTION_TIME_SEC = DEFAULT_TRIVIA_SETTINGS.questionTimeSec;

interface SoloQuestion {
  text: string;
  options: string[];
  correctIndex: number;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default function SoloTriviaPage() {
  const [params] = useSearchParams();
  const setId = params.get("set");
  const { configured, user, loading: authLoading, openAuthModal } = useAuth();

  const [set, setSet] = useState<SetSummary | null>(null);
  const [questions, setQuestions] = useState<SoloQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [earned, setEarned] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(QUESTION_TIME_SEC);
  const [nonce, setNonce] = useState(0);
  const startedAt = useRef<number>(Date.now());

  const load = useCallback(async () => {
    if (!setId || !user) return;
    try {
      const [info, rows] = await Promise.all([getSet(setId), listQuestions(setId)]);
      if (!info) {
        setError("That set isn't available to you.");
        return;
      }
      const prepared: SoloQuestion[] = [];
      for (const row of rows) {
        if (row.options.length < 2 || row.correctIndex >= row.options.length) continue;
        const answer = row.options[row.correctIndex];
        const opts = shuffle(row.options);
        prepared.push({ text: row.text, options: opts, correctIndex: opts.indexOf(answer) });
      }
      if (prepared.length === 0) {
        setError("That set has no playable questions yet.");
        return;
      }
      setSet(info);
      setQuestions(shuffle(prepared));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load that set.");
    }
  }, [setId, user]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  const question = questions ? questions[index] ?? null : null;
  const finished = questions !== null && index >= questions.length;

  const lockIn = useCallback(
    (optionIndex: number | null) => {
      if (!question || revealed) return;
      const elapsed = Math.min(Date.now() - startedAt.current, QUESTION_TIME_SEC * 1000);
      const correct = optionIndex !== null && optionIndex === question.correctIndex;
      // Same curve as multiplayer: 1000 → 500 linearly across the timer.
      const points = correct
        ? Math.round(BASE_POINTS * (1 - 0.5 * (elapsed / (QUESTION_TIME_SEC * 1000))))
        : 0;
      setChoice(optionIndex);
      setEarned(points);
      setScore((s) => s + points);
      if (correct) setCorrectCount((c) => c + 1);
      setRevealed(true);
    },
    [question, revealed],
  );

  // Per-question countdown; running out locks in "no answer".
  useEffect(() => {
    if (!question || revealed) return;
    startedAt.current = Date.now();
    setSecondsLeft(QUESTION_TIME_SEC);
    const timer = setInterval(() => {
      const left = Math.ceil((QUESTION_TIME_SEC * 1000 - (Date.now() - startedAt.current)) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) lockIn(null);
    }, 250);
    return () => clearInterval(timer);
  }, [question, revealed, lockIn]);

  const next = () => {
    setIndex((i) => i + 1);
    setChoice(null);
    setRevealed(false);
    setEarned(0);
  };

  const restart = () => {
    setIndex(0);
    setChoice(null);
    setRevealed(false);
    setEarned(0);
    setScore(0);
    setCorrectCount(0);
    setQuestions((qs) => (qs ? shuffle(qs) : qs));
  };

  const maxScore = useMemo(() => (questions?.length ?? 0) * BASE_POINTS, [questions]);

  let body: JSX.Element;
  if (!configured) {
    body = <p className="hint">Accounts aren't configured on this server, so solo play is unavailable.</p>;
  } else if (authLoading) {
    body = <div className="spinner" />;
  } else if (!user) {
    body = (
      <div className="panel">
        <p>Log in to practice with your own or shared question sets.</p>
        <button className="btn primary" onClick={openAuthModal}>
          Log in
        </button>
      </div>
    );
  } else if (!setId) {
    body = (
      <div className="panel">
        <p>Pick a question set to practice with.</p>
        <Link to="/sets" className="btn primary">
          <Icon name="article" /> Browse my sets
        </Link>
      </div>
    );
  } else if (error) {
    body = (
      <div className="panel">
        <p className="hint error">{error}</p>
        <div className="lobby-buttons">
          <button className="btn small" onClick={() => setNonce((n) => n + 1)}>
            Try again
          </button>
          <Link to="/sets" className="btn small">
            My Sets
          </Link>
        </div>
      </div>
    );
  } else if (!questions) {
    body = (
      <div className="panel vote-screen">
        <div className="spinner" />
        <p className="hint">Loading questions…</p>
      </div>
    );
  } else if (finished) {
    body = (
      <div className="panel end-screen">
        <h2>Practice run complete</h2>
        <p className="big-score">{score}</p>
        <p className="hint">
          {correctCount} / {questions.length} correct · best possible {maxScore}
        </p>
        <p className="hint">
          Practice scores stay on this device — solo play never affects your account stats
          or leaderboards.
        </p>
        <div className="lobby-buttons">
          <button className="btn primary" onClick={restart}>
            Play again
          </button>
          <Link to="/sets" className="btn">
            My Sets
          </Link>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="game-board trivia-board">
        <div className="round-bar panel">
          <div className="round-info">
            <span className="round-number">
              Q {index + 1}
              <span className="round-max"> / {questions.length}</span>
            </span>
            <div className="question-category">{set?.title ?? "Practice"}</div>
          </div>
          <div className={`timer ${!revealed && secondsLeft <= 5 ? "urgent" : ""}`}>
            {revealed ? "—" : `${secondsLeft}s`}
          </div>
          <div className="timer">{score}</div>
        </div>

        {!revealed && (
          <div className="timer-track">
            <div
              className={`timer-fill ${secondsLeft / QUESTION_TIME_SEC < 0.3 ? "urgent" : ""}`}
              style={{ width: `${(secondsLeft / QUESTION_TIME_SEC) * 100}%` }}
            />
          </div>
        )}

        <QuestionCardView
          questionText={question!.text}
          options={question!.options}
          myChoice={choice}
          revealed={revealed}
          correctIndex={question!.correctIndex}
          resultLine={
            <p className={`points-earned ${earned > 0 ? "good" : "bad"}`}>
              {earned > 0 ? (
                <>
                  <Icon name="check" /> Correct! +{earned} points
                </>
              ) : choice === null ? (
                <>
                  <Icon name="clock" /> No answer — 0 points
                </>
              ) : (
                <>
                  <Icon name="close" /> Wrong — 0 points
                </>
              )}
            </p>
          }
          onAnswer={lockIn}
        />

        {revealed && (
          <div className="lobby-buttons">
            <button className="btn primary" onClick={next}>
              {index + 1 >= questions.length ? "See results" : "Next question"}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page trivia">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">
          <Icon name="target" /> Solo Trivia
        </h1>
      </header>
      {body}
    </div>
  );
}

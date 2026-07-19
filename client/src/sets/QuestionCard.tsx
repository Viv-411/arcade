import { useState } from "react";
import Icon from "../components/Icon";
import {
  MAX_OPTIONS,
  MIN_OPTIONS,
  validateQuestion,
  type QuestionDraft,
  type QuestionRow,
} from "./api";

interface Props {
  /** Existing question; omit for a blank "new question" form. */
  question?: QuestionRow;
  index?: number;
  total?: number;
  /** Return an error message to keep the form open, null on success. */
  onSave: (draft: QuestionDraft) => Promise<string | null>;
  onCancel?: () => void;
  onDelete?: () => void;
  onMove?: (dir: -1 | 1) => void;
}

/** One question in the set editor: a display row that flips into a form. */
export default function QuestionCard({
  question,
  index,
  total,
  onSave,
  onCancel,
  onDelete,
  onMove,
}: Props) {
  const [editing, setEditing] = useState(!question);
  const [text, setText] = useState(question?.text ?? "");
  const [options, setOptions] = useState<string[]>(question?.options ?? ["", ""]);
  const [correctIndex, setCorrectIndex] = useState(question?.correctIndex ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const draft: QuestionDraft = { text, options, correctIndex };
    const invalid = validateQuestion(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(true);
    const err = await onSave(draft);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    if (question) setEditing(false);
  };

  if (!editing && question) {
    return (
      <li className="q-card">
        <div className="q-head">
          <span className="q-num">{(index ?? 0) + 1}.</span>
          <span className="q-text">{question.text}</span>
          <span className="q-actions">
            {onMove && (
              <>
                <button
                  className="btn small"
                  disabled={index === 0}
                  onClick={() => onMove(-1)}
                >
                  <Icon name="arrow-up" label="Move up" />
                </button>
                <button
                  className="btn small"
                  disabled={index === (total ?? 1) - 1}
                  onClick={() => onMove(1)}
                >
                  <Icon name="arrow-down" label="Move down" />
                </button>
              </>
            )}
            <button className="btn small" onClick={() => setEditing(true)}>
              Edit
            </button>
            {onDelete && (
              <button className="btn small danger" onClick={onDelete}>
                <Icon name="close" label="Delete question" />
              </button>
            )}
          </span>
        </div>
        <ul className="q-options">
          {question.options.map((opt, i) => (
            <li key={i} className={i === question.correctIndex ? "q-correct" : ""}>
              {i === question.correctIndex && <Icon name="check" className="ic-green" />} {opt}
            </li>
          ))}
        </ul>
      </li>
    );
  }

  return (
    <li className="q-card q-editing">
      <label className="field">
        <span>Question</span>
        <input
          value={text}
          maxLength={300}
          placeholder="e.g. Which planet has the most moons?"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <p className="hint q-opt-hint">Answer options — pick the correct one:</p>
      {options.map((opt, i) => (
        <div key={i} className="q-opt-row">
          <input
            type="radio"
            name={`correct-${question?.id ?? "new"}`}
            checked={correctIndex === i}
            onChange={() => setCorrectIndex(i)}
            title="Mark as the correct answer"
          />
          <input
            value={opt}
            maxLength={120}
            placeholder={`Option ${i + 1}`}
            onChange={(e) =>
              setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))
            }
          />
          {options.length > MIN_OPTIONS && (
            <button
              className="btn small"
              title="Remove option"
              onClick={() => {
                setOptions((prev) => prev.filter((_, j) => j !== i));
                setCorrectIndex((c) => (c === i ? 0 : c > i ? c - 1 : c));
              }}
            >
              <Icon name="close" label="Remove option" />
            </button>
          )}
        </div>
      ))}
      {options.length < MAX_OPTIONS && (
        <button className="link-btn" onClick={() => setOptions((prev) => [...prev, ""])}>
          <Icon name="plus" /> Add an option
        </button>
      )}
      {error && (
        <p className="used-warning">
          <Icon name="warning" /> {error}
        </p>
      )}
      <div className="lobby-buttons q-form-buttons">
        <button className="btn primary" disabled={saving} onClick={() => void save()}>
          {question ? "Save question" : "Add question"}
        </button>
        <button
          className="btn"
          onClick={() => {
            if (question) {
              setText(question.text);
              setOptions(question.options);
              setCorrectIndex(question.correctIndex);
              setError(null);
              setEditing(false);
            } else {
              onCancel?.();
            }
          }}
        >
          Cancel
        </button>
      </div>
    </li>
  );
}

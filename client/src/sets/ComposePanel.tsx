import { useState } from "react";
import Icon from "../components/Icon";
import {
  copyQuestionsTo,
  duplicateSet,
  type QuestionRow,
  type SetSummary,
} from "./api";

interface Props {
  source: SetSummary;
  questions: QuestionRow[];
  /** My own sets, offered as copy targets (the source itself is excluded). */
  mySets: SetSummary[];
  userId: string;
  onCopied: (count: number, targetTitle: string) => void;
  onDuplicated: (newSetId: string) => void;
}

/**
 * Composition = COPYING, never referencing: selected questions become brand
 * new rows in a set you own (with source_set_id provenance), so the copies
 * survive any change to — or deletion of — the source set.
 */
export default function ComposePanel({
  source,
  questions,
  mySets,
  userId,
  onCopied,
  onDuplicated,
}: Props) {
  const targets = mySets.filter((s) => s.id !== source.id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = async () => {
    const target = targets.find((s) => s.id === targetId);
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const picked = questions.filter((q) => selected.has(q.id));
      await copyQuestionsTo(target.id, picked, source.id);
      setSelected(new Set());
      onCopied(picked.length, target.title);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  const fork = async () => {
    setBusy(true);
    setError(null);
    try {
      const newId = await duplicateSet(source, questions, userId);
      onDuplicated(newId);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <section className="panel compose-panel">
      <h3>
        <Icon name="copy" /> Use these questions
      </h3>
      <p className="hint">
        Copies are independent — changing or deleting this set never touches them.
      </p>
      {questions.length > 0 && targets.length > 0 && (
        <>
          <div className="compose-pick">
            <button
              className="link-btn"
              onClick={() =>
                setSelected(
                  selected.size === questions.length
                    ? new Set()
                    : new Set(questions.map((q) => q.id)),
                )
              }
            >
              {selected.size === questions.length ? "Clear selection" : "Select all"}
            </button>
            <ul className="compose-list">
              {questions.map((q, i) => (
                <li key={q.id}>
                  <label className="compose-row">
                    <input
                      type="checkbox"
                      checked={selected.has(q.id)}
                      onChange={() => toggle(q.id)}
                    />
                    <span>
                      {i + 1}. {q.text}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="compose-actions">
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">Copy into…</option>
              {targets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
            <button
              className="btn primary"
              disabled={busy || selected.size === 0 || !targetId}
              onClick={() => void copy()}
            >
              <Icon name="copy" /> Copy {selected.size || ""} question
              {selected.size === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
      {questions.length > 0 && targets.length === 0 && (
        <p className="hint">Create another set of your own to copy questions into it.</p>
      )}
      <div className="lobby-buttons">
        <button className="btn" disabled={busy} onClick={() => void fork()}>
          <Icon name="copy" /> Duplicate this whole set to my sets
        </button>
      </div>
      {error && (
        <p className="used-warning">
          <Icon name="warning" /> {error}
        </p>
      )}
    </section>
  );
}

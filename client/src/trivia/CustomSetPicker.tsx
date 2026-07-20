import { useCallback, useEffect, useState } from "react";
import type { CustomSetInfo } from "@shared/trivia";
import { useAuth } from "../auth/AuthContext";
import { listMySets, listSharedSets, type SetSummary } from "../sets/api";
import Icon from "../components/Icon";

interface Props {
  isHost: boolean;
  isPublic: boolean;
  /** The lobby's current pick, as broadcast by the server. */
  customSet: CustomSetInfo | null;
  questionsPerGame: number;
  onPick: (setId: string | null) => void;
}

/**
 * Host-only question-source picker for PRIVATE lobbies: play OpenTDB (with the
 * usual category vote) or a custom set the host owns / has had shared with
 * them. Everyone in the lobby sees the current pick; the server re-validates
 * the host's access when the game starts.
 */
export default function CustomSetPicker({
  isHost,
  isPublic,
  customSet,
  questionsPerGame,
  onPick,
}: Props) {
  const { configured, user, openAuthModal } = useAuth();
  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [mine, shared] = await Promise.all([listMySets(user.id), listSharedSets(user.id)]);
      const seen = new Set<string>();
      const merged = [...mine, ...shared].filter((s) => {
        if (seen.has(s.id) || s.questionCount < 1) return false;
        seen.add(s.id);
        return true;
      });
      setSets(merged);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your sets.");
      setSets([]);
    }
  }, [user]);

  useEffect(() => {
    if (isHost && !isPublic && user) void load();
  }, [isHost, isPublic, user, load]);

  // Public lobbies always play OpenTDB, so there is nothing to show or pick.
  if (isPublic) return null;

  if (!isHost) {
    return (
      <div className="field custom-set-field">
        <span>Questions</span>
        <p className="hint">
          {customSet ? (
            <>
              <Icon name="article" /> Custom set: <strong>{customSet.title}</strong> (
              {customSet.questionCount} question{customSet.questionCount === 1 ? "" : "s"})
            </>
          ) : (
            "Category vote (host can pick a custom set)"
          )}
        </p>
      </div>
    );
  }

  if (!configured) return null;

  if (!user) {
    return (
      <div className="field custom-set-field">
        <span>Questions</span>
        <button className="btn small" onClick={openAuthModal}>
          <Icon name="article" /> Log in to play a custom set
        </button>
      </div>
    );
  }

  const chosenLength = customSet
    ? Math.min(customSet.questionCount, questionsPerGame)
    : questionsPerGame;

  return (
    <div className="field custom-set-field">
      <span>Questions</span>
      <select
        value={customSet?.setId ?? ""}
        onChange={(e) => onPick(e.target.value || null)}
      >
        <option value="">Category vote (OpenTDB)</option>
        {(sets ?? []).map((s) => (
          <option key={s.id} value={s.id}>
            {s.title} ({s.questionCount})
          </option>
        ))}
      </select>
      {error && <p className="hint error">{error}</p>}
      {!error && sets !== null && sets.length === 0 && (
        <p className="hint">
          No custom sets yet — build one on the <a href="/sets">My Sets</a> page.
        </p>
      )}
      {customSet && (
        <p className="hint">
          Playing {chosenLength} question{chosenLength === 1 ? "" : "s"} from this set
          {customSet.questionCount > questionsPerGame
            ? ` (a random ${questionsPerGame} of ${customSet.questionCount})`
            : ""}
          . No category vote.
        </p>
      )}
    </div>
  );
}

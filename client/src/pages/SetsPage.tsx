import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useSocial } from "../social/SocialContext";
import Icon from "../components/Icon";
import QuestionCard from "../sets/QuestionCard";
import ComposePanel from "../sets/ComposePanel";
import {
  createSet,
  deleteQuestion,
  deleteSet,
  getSet,
  insertQuestion,
  listMySets,
  listQuestions,
  listShares,
  listSharedSets,
  revokeShare,
  setQuestionPosition,
  shareSet,
  updateQuestion,
  updateSet,
  type QuestionDraft,
  type QuestionRow,
  type SetSummary,
  type ShareRow,
} from "../sets/api";

/**
 * Custom trivia sets — the content layer: create/edit, share with friends,
 * copy-based composition. Sets built here are playable two ways: a host can
 * pick one in a PRIVATE Speed Trivia lobby (see trivia/CustomSetPicker), or
 * anyone with access can practice at /solo/trivia?set=ID.
 *
 * Everything on this page requires login and runs through the user's OWN
 * Supabase session, so RLS is the authority (no service-role path here);
 * anonymous play never touches it.
 */
export default function SetsPage() {
  const { configured, user, loading, openAuthModal } = useAuth();
  const { friends, refresh: refreshFriends } = useSocial();
  const [params, setParams] = useSearchParams();
  const openSetId = params.get("set");

  const [mySets, setMySets] = useState<SetSummary[]>([]);
  const [sharedSets, setSharedSets] = useState<SetSummary[]>([]);
  const [listsReady, setListsReady] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [pageError, setPageError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [current, setCurrent] = useState<SetSummary | null>(null);
  const [detailMissing, setDetailMissing] = useState(false);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [shareSel, setShareSel] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [meta, setMeta] = useState({ title: "", description: "", category: "" });

  const say = useCallback((msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  }, []);

  const fail = useCallback((e: unknown) => {
    setPageError((e as Error).message);
    setTimeout(() => setPageError(null), 6000);
  }, []);

  const refreshLists = useCallback(async () => {
    if (!user) return;
    try {
      const [mine, shared] = await Promise.all([listMySets(user.id), listSharedSets(user.id)]);
      setMySets(mine);
      setSharedSets(shared);
      setListsReady(true);
    } catch (e) {
      fail(e);
    }
  }, [user, fail]);

  useEffect(() => {
    if (user) {
      void refreshLists();
      void refreshFriends();
    }
  }, [user, refreshLists, refreshFriends]);

  const loadDetail = useCallback(async () => {
    if (!openSetId || !user) return;
    try {
      const set = await getSet(openSetId);
      if (!set) {
        setDetailMissing(true);
        setCurrent(null);
        return;
      }
      setDetailMissing(false);
      setCurrent(set);
      setMeta({
        title: set.title,
        description: set.description ?? "",
        category: set.category ?? "",
      });
      const qs = await listQuestions(openSetId);
      setQuestions(qs);
      if (set.ownerId === user.id) setShares(await listShares(openSetId));
      else setShares([]);
    } catch (e) {
      fail(e);
    }
  }, [openSetId, user, fail]);

  useEffect(() => {
    setCurrent(null);
    setQuestions([]);
    setShares([]);
    setAddingQuestion(false);
    setShareSel(new Set());
    setConfirmDelete(false);
    setDetailMissing(false);
    if (openSetId && user) void loadDetail();
  }, [openSetId, user, loadDetail]);

  const isOwner = Boolean(current && user && current.ownerId === user.id);

  // ---------- actions ----------

  const createNewSet = async () => {
    if (!user || !newTitle.trim()) return;
    try {
      const id = await createSet(user.id, { title: newTitle });
      setNewTitle("");
      await refreshLists();
      setParams({ set: id });
    } catch (e) {
      fail(e);
    }
  };

  const saveMeta = async () => {
    if (!current || !meta.title.trim()) return;
    try {
      await updateSet(current.id, meta);
      say("Set details saved");
      await Promise.all([loadDetail(), refreshLists()]);
    } catch (e) {
      fail(e);
    }
  };

  const removeSet = async () => {
    if (!current) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await deleteSet(current.id);
      setParams({});
      await refreshLists();
      say("Set deleted");
    } catch (e) {
      fail(e);
    }
  };

  const saveNewQuestion = async (draft: QuestionDraft): Promise<string | null> => {
    if (!current) return "No set open.";
    try {
      await insertQuestion(current.id, draft, questions.length);
      setAddingQuestion(false);
      setQuestions(await listQuestions(current.id));
      void refreshLists();
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const saveExistingQuestion = async (
    questionId: string,
    draft: QuestionDraft,
  ): Promise<string | null> => {
    try {
      await updateQuestion(questionId, draft);
      if (current) setQuestions(await listQuestions(current.id));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const removeQuestion = async (questionId: string) => {
    try {
      await deleteQuestion(questionId);
      if (current) setQuestions(await listQuestions(current.id));
      void refreshLists();
    } catch (e) {
      fail(e);
    }
  };

  /** Move a question and renumber so positions stay 0..n-1. */
  const moveQuestion = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[index], next[j]] = [next[j], next[index]];
    const renumbered = next.map((q, i) => ({ ...q, position: i }));
    setQuestions(renumbered);
    try {
      await Promise.all(
        renumbered
          .filter((q, i) => questions.find((old) => old.id === q.id)!.position !== i)
          .map((q) => setQuestionPosition(q.id, q.position)),
      );
    } catch (e) {
      fail(e);
      void loadDetail();
    }
  };

  const doShare = async () => {
    if (!current || !user || shareSel.size === 0) return;
    try {
      await shareSet(current.id, user.id, [...shareSel]);
      setShareSel(new Set());
      setShares(await listShares(current.id));
      say("Shared!");
    } catch (e) {
      fail(e);
    }
  };

  const doRevoke = async (shareId: string) => {
    try {
      await revokeShare(shareId);
      if (current) setShares(await listShares(current.id));
    } catch (e) {
      fail(e);
    }
  };

  /** Recipient-side "remove from my shared list" (deletes own share row). */
  const removeFromMyList = async () => {
    if (!current || !user) return;
    try {
      const myShares = await listShares(current.id);
      const mine = myShares.find((s) => s.sharedWith === user.id);
      if (mine) await revokeShare(mine.id);
      setParams({});
      await refreshLists();
    } catch (e) {
      fail(e);
    }
  };

  // ---------- views ----------

  let body: JSX.Element;
  if (!configured) {
    body = (
      <div className="panel">
        <p className="hint">Accounts aren't configured on this deployment.</p>
      </div>
    );
  } else if (loading) {
    body = (
      <div className="panel account-signin">
        <div className="spinner" />
      </div>
    );
  } else if (!user) {
    body = (
      <div className="panel account-signin">
        <p>Sign in to build trivia sets, share them with friends, and remix theirs.</p>
        <button className="btn primary" onClick={openAuthModal}>
          <Icon name="user" /> Sign in
        </button>
      </div>
    );
  } else if (openSetId && detailMissing) {
    body = (
      <div className="panel">
        <p className="hint">
          That set doesn't exist anymore — or it isn't shared with you.
        </p>
        <button className="btn" onClick={() => setParams({})}>
          ← All sets
        </button>
      </div>
    );
  } else if (openSetId && !current) {
    body = (
      <div className="panel account-signin">
        <div className="spinner" />
      </div>
    );
  } else if (openSetId && current) {
    const shareable = friends.filter(
      (f) => !shares.some((s) => s.sharedWith === f.userId),
    );
    body = (
      <>
        <div className="panel">
          <div className="chat-list-head">
            <button className="btn small" onClick={() => setParams({})}>
              ← All sets
            </button>
            <h3>{current.title}</h3>
            {!isOwner && (
              <span className="hint chat-members-line">
                by @{current.ownerUsername ?? "?"} · read-only
              </span>
            )}
            {questions.length > 0 && (
              <Link className="btn small" to={`/solo/trivia?set=${current.id}`}>
                <Icon name="play" /> Play solo
              </Link>
            )}
          </div>

          {isOwner ? (
            <>
              <label className="field">
                <span>Title</span>
                <input
                  value={meta.title}
                  maxLength={120}
                  onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Description</span>
                <input
                  value={meta.description}
                  maxLength={300}
                  placeholder="What's in this set?"
                  onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Category / tag</span>
                <input
                  value={meta.category}
                  maxLength={40}
                  placeholder="e.g. movies"
                  onChange={(e) => setMeta((m) => ({ ...m, category: e.target.value }))}
                />
              </label>
              <div className="lobby-buttons">
                <button className="btn primary" disabled={!meta.title.trim()} onClick={() => void saveMeta()}>
                  Save details
                </button>
                <button className="btn danger" onClick={() => void removeSet()}>
                  {confirmDelete ? "Really delete this set?" : <><Icon name="trash" /> Delete set</>}
                </button>
              </div>
            </>
          ) : (
            <>
              {current.description && <p>{current.description}</p>}
              {current.category && (
                <p className="hint">Category: {current.category}</p>
              )}
              <div className="lobby-buttons">
                <button className="btn small danger" onClick={() => void removeFromMyList()}>
                  <Icon name="close" /> Remove from my shared list
                </button>
              </div>
            </>
          )}
        </div>

        {isOwner && (
          <section className="panel">
            <h3>
              <Icon name="share" /> Sharing
            </h3>
            {shares.length > 0 ? (
              <ul className="player-list">
                {shares.map((s) => (
                  <li key={s.id}>
                    <span className="player-name">@{s.username}</span>
                    <button className="btn small danger" onClick={() => void doRevoke(s.id)}>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">Not shared with anyone yet.</p>
            )}
            {shareable.length > 0 ? (
              <>
                <p className="hint">Share with friends (read-only for them):</p>
                <div className="players-bar">
                  {shareable.map((f) => (
                    <button
                      key={f.userId}
                      className={`player-chip chip-btn ${shareSel.has(f.userId) ? "locked" : ""}`}
                      onClick={() =>
                        setShareSel((prev) => {
                          const next = new Set(prev);
                          if (next.has(f.userId)) next.delete(f.userId);
                          else next.add(f.userId);
                          return next;
                        })
                      }
                    >
                      {shareSel.has(f.userId) ? <><Icon name="check" />{" "}</> : ""}@{f.username}
                    </button>
                  ))}
                </div>
                <div className="lobby-buttons">
                  <button
                    className="btn primary"
                    disabled={shareSel.size === 0}
                    onClick={() => void doShare()}
                  >
                    <Icon name="share" /> Share with {shareSel.size || ""} friend
                    {shareSel.size === 1 ? "" : "s"}
                  </button>
                </div>
              </>
            ) : (
              friends.length === 0 && (
                <p className="hint">
                  Add friends from the <Link to="/friends">friends page</Link> to share sets.
                </p>
              )
            )}
          </section>
        )}

        <section className="panel">
          <h3>
            <Icon name="article" /> Questions ({questions.length})
          </h3>
          {isOwner ? (
            <>
              <ul className="q-list">
                {questions.map((q, i) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    index={i}
                    total={questions.length}
                    onSave={(draft) => saveExistingQuestion(q.id, draft)}
                    onDelete={() => void removeQuestion(q.id)}
                    onMove={(dir) => void moveQuestion(i, dir)}
                  />
                ))}
                {addingQuestion && (
                  <QuestionCard
                    onSave={saveNewQuestion}
                    onCancel={() => setAddingQuestion(false)}
                  />
                )}
              </ul>
              {!addingQuestion && (
                <div className="lobby-buttons">
                  <button className="btn primary" onClick={() => setAddingQuestion(true)}>
                    <Icon name="plus" /> Add a question
                  </button>
                </div>
              )}
              {questions.length === 0 && !addingQuestion && (
                <p className="hint">No questions yet — add the first one!</p>
              )}
            </>
          ) : (
            <ul className="q-list">
              {questions.map((q, i) => (
                <li key={q.id} className="q-card">
                  <div className="q-head">
                    <span className="q-num">{i + 1}.</span>
                    <span className="q-text">{q.text}</span>
                  </div>
                  <ul className="q-options">
                    {q.options.map((opt, oi) => (
                      <li key={oi} className={oi === q.correctIndex ? "q-correct" : ""}>
                        {oi === q.correctIndex && <Icon name="check" className="ic-green" />} {opt}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {questions.length === 0 && <p className="hint">This set has no questions yet.</p>}
            </ul>
          )}
        </section>

        <ComposePanel
          source={current}
          questions={questions}
          mySets={mySets}
          userId={user.id}
          onCopied={(n, target) => {
            say(`Copied ${n} question${n === 1 ? "" : "s"} into "${target}"`);
            void refreshLists();
          }}
          onDuplicated={(newId) => {
            void refreshLists();
            setParams({ set: newId });
            say("Duplicated to your sets");
          }}
        />
      </>
    );
  } else {
    body = (
      <>
        <div className="panel">
          <h3>
            <Icon name="article" /> My sets
          </h3>
          <div className="join-row">
            <input
              value={newTitle}
              maxLength={120}
              placeholder="New set title…"
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createNewSet();
              }}
            />
            <button
              className="btn primary"
              disabled={!newTitle.trim()}
              onClick={() => void createNewSet()}
            >
              <Icon name="plus" /> Create
            </button>
          </div>
          <ul className="player-list set-list">
            {mySets.map((s) => (
              <li key={s.id}>
                <button className="chat-row" onClick={() => setParams({ set: s.id })}>
                  <span className="chat-info">
                    <span className="chat-title">{s.title}</span>
                    <span className="chat-preview">
                      {s.questionCount} question{s.questionCount === 1 ? "" : "s"}
                      {s.category ? ` · ${s.category}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {listsReady && mySets.length === 0 && (
              <p className="hint">No sets yet — create your first one above.</p>
            )}
          </ul>
        </div>

        <div className="panel">
          <h3>
            <Icon name="share" /> Shared with me
          </h3>
          <ul className="player-list set-list">
            {sharedSets.map((s) => (
              <li key={s.id}>
                <button className="chat-row" onClick={() => setParams({ set: s.id })}>
                  <span className="chat-info">
                    <span className="chat-title">{s.title}</span>
                    <span className="chat-preview">
                      by @{s.ownerUsername ?? "?"} · {s.questionCount} question
                      {s.questionCount === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {listsReady && sharedSets.length === 0 && (
              <p className="hint">Nothing shared with you yet.</p>
            )}
          </ul>
        </div>

        <p className="hint">
          Custom sets are content-only for now — playing them in Speed Trivia is coming next.
        </p>
      </>
    );
  }

  return (
    <div className="page sets">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">
          <Icon name="article" /> Trivia Sets
        </h1>
      </header>
      {body}
      {(notice || pageError) && (
        <div className="toasts">
          <div className={`toast ${pageError ? "error" : "info"}`}>
            {pageError ?? notice}
          </div>
        </div>
      )}
    </div>
  );
}

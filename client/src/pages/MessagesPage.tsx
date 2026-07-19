import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ChatMessageInfo, ChatSummary } from "@shared/social";
import { GAME_NAMES, GAME_PATHS } from "@shared/social";
import { useAuth } from "../auth/AuthContext";
import { useSocial } from "../social/SocialContext";
import Icon from "../components/Icon";

function chatTitle(chat: ChatSummary, myUserId: string | null): string {
  if (chat.kind === "group") return chat.name ?? "Group";
  const other = chat.members.find((m) => m.userId !== myUserId);
  return other ? `@${other.username}` : "DM";
}

export default function MessagesPage() {
  const { configured, user, loading, openAuthModal } = useAuth();
  const {
    chats,
    friends,
    refreshChats,
    fetchMessages,
    sendMessage,
    markRead,
    setActiveChat,
    subscribeMessages,
    createGroup,
    addToGroup,
    leaveGroup,
    deleteGroup,
  } = useSocial();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("chat");
  const [messages, setMessages] = useState<ChatMessageInfo[]>([]);
  const [draft, setDraft] = useState("");
  const [newGroup, setNewGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<Set<string>>(new Set());
  const [groupError, setGroupError] = useState<string | null>(null);
  const [manageAdd, setManageAdd] = useState(false);
  const [addSel, setAddSel] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<"leave" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const active = chats.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (user) void refreshChats();
  }, [user, refreshChats]);

  // Load + live-append messages for the open chat.
  useEffect(() => {
    setActiveChat(activeId);
    setMessages([]);
    if (!activeId || !user) return () => setActiveChat(null);
    let cancelled = false;
    void fetchMessages(activeId).then((msgs) => {
      if (!cancelled) setMessages(msgs);
    });
    markRead(activeId);
    const unsub = subscribeMessages((msg) => {
      if (msg.chatId === activeId) setMessages((prev) => [...prev, msg]);
    });
    return () => {
      cancelled = true;
      unsub();
      setActiveChat(null);
    };
  }, [activeId, user, fetchMessages, markRead, setActiveChat, subscribeMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Switching chats resets any half-done membership action.
  useEffect(() => {
    setManageAdd(false);
    setAddSel(new Set());
    setConfirmAction(null);
    setActionError(null);
  }, [activeId]);

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeId) return;
    setDraft("");
    await sendMessage(activeId, body); // echoes back via chatMessage
  };

  const submitGroup = async () => {
    setGroupError(null);
    const chatId = await createGroup(groupName, [...groupMembers]);
    if (!chatId) {
      setGroupError("Could not create the group — name it and pick at least one friend.");
      return;
    }
    setNewGroup(false);
    setGroupName("");
    setGroupMembers(new Set());
    setParams({ chat: chatId });
  };

  const isCreator = Boolean(active && active.kind === "group" && active.createdBy === user?.id);
  const addable = active
    ? friends.filter((f) => !active.members.some((m) => m.userId === f.userId))
    : [];

  const submitAdd = async () => {
    if (!active) return;
    setActionError(null);
    const err = await addToGroup(active.id, [...addSel]);
    if (err) setActionError(err);
    else {
      setManageAdd(false);
      setAddSel(new Set());
    }
  };

  const doLeave = async () => {
    if (!active) return;
    if (confirmAction !== "leave") {
      setConfirmAction("leave");
      return;
    }
    const err = await leaveGroup(active.id);
    if (err) {
      setActionError(err);
      setConfirmAction(null);
    } else {
      setParams({});
    }
  };

  const doDelete = async () => {
    if (!active) return;
    if (confirmAction !== "delete") {
      setConfirmAction("delete");
      return;
    }
    const err = await deleteGroup(active.id);
    if (err) {
      setActionError(err);
      setConfirmAction(null);
    } else {
      setParams({});
    }
  };

  let body: JSX.Element;
  if (!configured) {
    body = <div className="panel"><p className="hint">Accounts aren't configured on this deployment.</p></div>;
  } else if (loading) {
    body = <div className="panel account-signin"><div className="spinner" /></div>;
  } else if (!user) {
    body = (
      <div className="panel account-signin">
        <p>Sign in to message your friends and share game invites.</p>
        <button className="btn primary" onClick={openAuthModal}><Icon name="user" /> Sign in</button>
      </div>
    );
  } else if (!active) {
    body = (
      <div className="panel">
        <div className="chat-list-head">
          <h3>Conversations</h3>
          <button className="btn small" onClick={() => setNewGroup((v) => !v)}>
            {newGroup ? <><Icon name="close" /> Cancel</> : <><Icon name="plus" /> New group</>}
          </button>
        </div>
        {newGroup && (
          <div className="new-group">
            <label className="field">
              <span>Group name</span>
              <input
                value={groupName}
                maxLength={40}
                placeholder="e.g. game night crew"
                onChange={(e) => setGroupName(e.target.value)}
              />
            </label>
            <p className="hint">Add friends (1–9):</p>
            <div className="players-bar">
              {friends.map((f) => (
                <button
                  key={f.userId}
                  className={`player-chip chip-btn ${groupMembers.has(f.userId) ? "locked" : ""}`}
                  onClick={() =>
                    setGroupMembers((prev) => {
                      const next = new Set(prev);
                      if (next.has(f.userId)) next.delete(f.userId);
                      else next.add(f.userId);
                      return next;
                    })
                  }
                >
                  {groupMembers.has(f.userId) ? <><Icon name="check" />{" "}</> : ""}@{f.username}
                </button>
              ))}
              {friends.length === 0 && <p className="hint">No friends yet — add some first!</p>}
            </div>
            {groupError && <p className="used-warning"><Icon name="warning" /> {groupError}</p>}
            <div className="lobby-buttons">
              <button
                className="btn primary"
                disabled={!groupName.trim() || groupMembers.size === 0}
                onClick={() => void submitGroup()}
              >
                Create group
              </button>
            </div>
          </div>
        )}
        <ul className="chat-list">
          {chats.map((c) => (
            <li key={c.id}>
              <button className="chat-row" onClick={() => setParams({ chat: c.id })}>
                <span className="chat-avatar">{c.kind === "group" ? <Icon name="users" /> : <Icon name="message" />}</span>
                <span className="chat-info">
                  <span className="chat-title">
                    {chatTitle(c, user.id)}
                    {c.unread && <span className="chat-unread-dot" />}
                  </span>
                  <span className="chat-preview">
                    {c.lastMessage
                      ? `${c.lastMessage.senderName}: ${c.lastMessage.kind === "invite" ? "game invite" : c.lastMessage.body}`
                      : "No messages yet"}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {chats.length === 0 && (
            <p className="hint">
              No conversations yet — open one from the <Link to="/friends">friends page</Link>.
            </p>
          )}
        </ul>
      </div>
    );
  } else {
    body = (
      <div className="panel chat-view">
        <div className="chat-list-head">
          <button className="btn small" onClick={() => setParams({})}>← All chats</button>
          <h3>{chatTitle(active, user.id)}</h3>
          <span className="hint chat-members-line">
            {active.kind === "group"
              ? active.members.map((m) => `@${m.username}`).join(", ")
              : ""}
          </span>
        </div>
        {active.kind === "group" && (
          <div className="chat-manage">
            {isCreator && (
              <button
                className="btn small"
                onClick={() => {
                  setManageAdd((v) => !v);
                  setConfirmAction(null);
                  setActionError(null);
                }}
              >
                {manageAdd ? <><Icon name="close" /> Cancel</> : <><Icon name="user-plus" /> Add people</>}
              </button>
            )}
            <button className="btn small danger" onClick={() => void doLeave()}>
              {confirmAction === "leave" ? "Really leave?" : <><Icon name="logout" /> Leave group</>}
            </button>
            {isCreator && (
              <button className="btn small danger" onClick={() => void doDelete()}>
                {confirmAction === "delete" ? (
                  "Really delete for everyone?"
                ) : (
                  <><Icon name="trash" /> Delete group</>
                )}
              </button>
            )}
          </div>
        )}
        {active.kind === "group" && manageAdd && (
          <div className="new-group">
            <p className="hint">Add friends who aren't in the group yet:</p>
            <div className="players-bar">
              {addable.map((f) => (
                <button
                  key={f.userId}
                  className={`player-chip chip-btn ${addSel.has(f.userId) ? "locked" : ""}`}
                  onClick={() =>
                    setAddSel((prev) => {
                      const next = new Set(prev);
                      if (next.has(f.userId)) next.delete(f.userId);
                      else next.add(f.userId);
                      return next;
                    })
                  }
                >
                  {addSel.has(f.userId) ? <><Icon name="check" />{" "}</> : ""}@{f.username}
                </button>
              ))}
              {addable.length === 0 && (
                <p className="hint">All your friends are already in this group.</p>
              )}
            </div>
            <div className="lobby-buttons">
              <button
                className="btn primary"
                disabled={addSel.size === 0}
                onClick={() => void submitAdd()}
              >
                Add to group
              </button>
            </div>
          </div>
        )}
        {actionError && (
          <p className="used-warning"><Icon name="warning" /> {actionError}</p>
        )}
        <div className="chat-messages">
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.senderId === user.id ? "mine" : ""}`}>
              <span className="chat-msg-sender">{m.senderId === user.id ? "you" : m.senderName}</span>
              {m.kind === "invite" && m.invite ? (
                <span className="chat-bubble invite-bubble">
                  <Icon name="gamepad" /> {m.body}
                  <button
                    className="btn small primary"
                    onClick={() => navigate(`${GAME_PATHS[m.invite!.game]}?room=${m.invite!.code}`)}
                  >
                    Join {GAME_NAMES[m.invite.game]}
                  </button>
                </span>
              ) : (
                <span className="chat-bubble">{m.body}</span>
              )}
            </div>
          ))}
          {messages.length === 0 && <p className="hint">Say hi <Icon name="hand" /></p>}
          <div ref={bottomRef} />
        </div>
        <div className="word-row">
          <input
            value={draft}
            maxLength={500}
            placeholder="Message…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
          />
          <button className="btn primary" disabled={!draft.trim()} onClick={() => void send()}>
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page messages">
      <header className="mm-header">
        <Link to="/" className="back-link">← Arcade</Link>
        <h1 className="mm-title"><Icon name="message" /> Messages</h1>
      </header>
      {body}
    </div>
  );
}

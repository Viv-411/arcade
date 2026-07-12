import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import type { FriendPresence } from "@shared/social";
import { GAME_NAMES } from "@shared/social";
import { useAuth } from "../auth/AuthContext";
import { useSocial } from "../social/SocialContext";

export default function FriendsPage() {
  const { configured, user, username, loading, openAuthModal, requireAuth } = useAuth();
  const {
    friends,
    incoming,
    outgoing,
    sendRequest,
    acceptRequest,
    removeFriendship,
    refresh,
    fetchPresence,
  } = useSocial();
  const [params, setParams] = useSearchParams();
  const [addInput, setAddInput] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [presence, setPresence] = useState<Record<string, FriendPresence>>({});

  const addParam = params.get("add");
  const myLink = username ? `${window.location.origin}/friends?add=${username}` : null;

  useEffect(() => {
    if (user) void refresh();
  }, [user, refresh]);

  // Live presence for the friends list.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = () =>
      void fetchPresence().then((list) => {
        if (!cancelled) {
          setPresence(Object.fromEntries(list.map((f) => [f.userId, f])));
        }
      });
    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [user, fetchPresence]);

  // QR code of my invite link (scan with a phone camera to open the link).
  useEffect(() => {
    if (!myLink) {
      setQrUrl(null);
      return;
    }
    void QRCode.toDataURL(myLink, {
      width: 200,
      margin: 1,
      color: { dark: "#0d0d1f", light: "#f2f2ff" },
    }).then(setQrUrl, () => setQrUrl(null));
  }, [myLink]);

  const doSend = async (name: string) => {
    const error = await sendRequest(name);
    setMessage(
      error ? { kind: "error", text: error } : { kind: "ok", text: `Request sent to @${name.toLowerCase().replace(/^@/, "")}!` },
    );
    if (!error) setAddInput("");
  };

  const copyLink = () => {
    if (!myLink) return;
    void navigator.clipboard.writeText(myLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const statusOf = (userId: string): string => {
    const p = presence[userId];
    if (!p || !p.online) return "offline";
    if (!p.activity) return "🟢 online";
    return p.activity.state === "lobby"
      ? `🟢 in a ${GAME_NAMES[p.activity.game]} lobby`
      : `🎮 playing ${GAME_NAMES[p.activity.game]}`;
  };

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
        <p>
          {addParam
            ? `Sign in to add @${addParam} as a friend.`
            : "Sign in to add friends and see who's online."}
        </p>
        <button className="btn primary" onClick={openAuthModal}>
          👤 Sign in
        </button>
      </div>
    );
  } else {
    body = (
      <>
        {addParam && addParam !== username && (
          <div className="panel add-banner">
            <p>
              Add <strong>@{addParam}</strong> as a friend?
            </p>
            <div className="lobby-buttons">
              <button
                className="btn primary"
                onClick={() =>
                  requireAuth(() => {
                    void doSend(addParam);
                    setParams({}, { replace: true });
                  })
                }
              >
                Send friend request
              </button>
              <button className="btn" onClick={() => setParams({}, { replace: true })}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="panel">
          <h3>Add a friend</h3>
          <div className="word-row">
            <input
              value={addInput}
              maxLength={24}
              placeholder="their username"
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && addInput.trim()) void doSend(addInput);
              }}
            />
            <button
              className="btn primary"
              disabled={!addInput.trim()}
              onClick={() => void doSend(addInput)}
            >
              Add friend
            </button>
          </div>
          {message && (
            <p className={message.kind === "ok" ? "auth-notice" : "used-warning"}>
              {message.kind === "ok" ? "✓ " : "⚠ "}
              {message.text}
            </p>
          )}
          {myLink && (
            <div className="share-friend">
              <p className="hint">…or have them scan / open your invite link:</p>
              <div className="share-friend-row">
                {qrUrl && <img className="friend-qr" src={qrUrl} alt="Friend invite QR code" />}
                <div className="share-friend-actions">
                  <code className="friend-link">{myLink}</code>
                  <button className="btn small" onClick={copyLink}>
                    {copied ? "✓ Copied!" : "Copy link"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {incoming.length > 0 && (
          <div className="panel">
            <h3>Requests for you</h3>
            {incoming.map((r) => (
              <div key={r.rowId} className="notif-item">
                <span className="notif-text">
                  <strong>@{r.username}</strong>
                  {r.displayName ? ` (${r.displayName})` : ""}
                </span>
                <span className="notif-actions">
                  <button className="btn small primary" onClick={() => void acceptRequest(r.rowId)}>
                    Accept
                  </button>
                  <button className="btn small" onClick={() => void removeFriendship(r.rowId)}>
                    Decline
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {outgoing.length > 0 && (
          <div className="panel">
            <h3>Sent requests</h3>
            {outgoing.map((r) => (
              <div key={r.rowId} className="notif-item">
                <span className="notif-text">@{r.username} — pending</span>
                <button className="btn small" onClick={() => void removeFriendship(r.rowId)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="panel">
          <h3>
            Friends{" "}
            <span className="friend-count">
              ({friends.length})
            </span>
          </h3>
          {friends.length === 0 && <p className="hint">No friends yet — send a request above!</p>}
          <ul className="player-list">
            {friends.map((f) => (
              <li key={f.rowId} className={presence[f.userId]?.online ? "" : "disconnected"}>
                <span className={`dot ${presence[f.userId]?.online ? "on" : "off"}`} />
                <span className="player-name">
                  @{f.username}
                  {f.displayName ? ` · ${f.displayName}` : ""}
                </span>
                <span className="invite-status">{statusOf(f.userId)}</span>
                <button
                  className="btn small danger"
                  title="Remove friend"
                  onClick={() => void removeFriendship(f.rowId)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      </>
    );
  }

  return (
    <div className="page friends">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">👥 Friends</h1>
      </header>
      {body}
    </div>
  );
}

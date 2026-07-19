import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { GAME_NAMES } from "@shared/social";
import { useAuth } from "../auth/AuthContext";
import { useSocial } from "./SocialContext";
import Icon from "../components/Icon";

/** Corner bell: pending friend requests + live lobby invites. */
export default function NotificationBell() {
  const { user } = useAuth();
  const {
    ready,
    incoming,
    invites,
    unreadCount,
    unreadMessages,
    acceptRequest,
    removeFriendship,
    dismissInvite,
    refresh,
    refreshChats,
  } = useSocial();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  if (!user || !ready) return null;
  const totalBadge = unreadCount + unreadMessages;

  return (
    <>
      <button
        className="btn small bell-btn"
        title="Notifications"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) {
            void refresh();
            void refreshChats();
          }
        }}
      >
        <Icon name={totalBadge > 0 ? "bell-ring" : "bell"} label="Notifications" />{totalBadge > 0 && <span className="bell-badge">{totalBadge}</span>}
      </button>
      {open && (
        <div className="notif-panel panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            <button className="auth-close notif-close" onClick={() => setOpen(false)}>
              <Icon name="close" label="Close" />
            </button>
          </div>

          {invites.map((inv) => (
            <div key={inv.id} className="notif-item">
              <span className="notif-text">
                <Icon name="gamepad" /> <strong>@{inv.from.username}</strong> invited you to{" "}
                {GAME_NAMES[inv.game] ?? inv.game}
              </span>
              <span className="notif-actions">
                <button
                  className="btn small primary"
                  onClick={() => {
                    dismissInvite(inv.id);
                    setOpen(false);
                    navigate(inv.link);
                  }}
                >
                  Join
                </button>
                <button className="btn small" onClick={() => dismissInvite(inv.id)}>
                  <Icon name="close" label="Dismiss" />
                </button>
              </span>
            </div>
          ))}

          {incoming.map((req) => (
            <div key={req.rowId} className="notif-item">
              <span className="notif-text">
                <Icon name="users" /> <strong>@{req.username}</strong> wants to be friends
              </span>
              <span className="notif-actions">
                <button className="btn small primary" onClick={() => void acceptRequest(req.rowId)}>
                  Accept
                </button>
                <button className="btn small" onClick={() => void removeFriendship(req.rowId)}>
                  Decline
                </button>
              </span>
            </div>
          ))}

          {unreadMessages > 0 && (
            <div className="notif-item">
              <span className="notif-text">
                <Icon name="message" /> {unreadMessages} unread conversation{unreadMessages === 1 ? "" : "s"}
              </span>
              <button
                className="btn small primary"
                onClick={() => {
                  setOpen(false);
                  navigate("/messages");
                }}
              >
                Open
              </button>
            </div>
          )}
          {invites.length === 0 && incoming.length === 0 && unreadMessages === 0 && (
            <p className="hint">Nothing new.</p>
          )}
          <div className="notif-links">
            <Link to="/messages" className="link-btn" onClick={() => setOpen(false)}>
              <Icon name="message" /> Messages
            </Link>
            <Link to="/friends" className="link-btn" onClick={() => setOpen(false)}>
              <Icon name="users" /> Friends
            </Link>
          </div>
        </div>
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FriendPresence, GameKey } from "@shared/social";
import { GAME_NAMES } from "@shared/social";
import { useAuth } from "../auth/AuthContext";
import { useSocial } from "./SocialContext";
import Icon from "../components/Icon";

interface Props {
  game: GameKey;
  code: string;
  /** Seats left in this lobby — gates which group chats can be invited. */
  openSeats: number;
}

/**
 * Lobby invite panel. Presence can be glitchy, so it's informational — the
 * invites themselves go through Messages (a DM per friend, or a group chat),
 * where they persist even if the recipient is offline right now.
 */
export default function InviteFriends({ game, code, openSeats }: Props) {
  const { user } = useAuth();
  const { ready, fetchPresence, chats, refreshChats, openDm, sendChatInvite } = useSocial();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<FriendPresence[] | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({}); // friendId/chatId -> status
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () => {
      void fetchPresence().then((friends) => {
        if (!cancelled) setList(friends);
      });
    };
    load();
    void refreshChats();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [open, fetchPresence, refreshChats]);

  if (!user || !ready) return null;

  const statusOf = (f: FriendPresence): string => {
    if (!f.online) return "offline";
    if (!f.activity) return "online";
    return f.activity.state === "lobby"
      ? `in a ${GAME_NAMES[f.activity.game]} lobby`
      : `playing ${GAME_NAMES[f.activity.game]}`;
  };

  const inviteFriend = async (f: FriendPresence) => {
    setSent((s) => ({ ...s, [f.userId]: "…" }));
    const chatId = await openDm(f.userId);
    if (!chatId) {
      setSent((s) => ({ ...s, [f.userId]: "couldn't open DM" }));
      return;
    }
    const error = await sendChatInvite(chatId, game, code);
    setSent((s) => ({ ...s, [f.userId]: error ?? "sent to your DM" }));
  };

  const inviteChat = async (chatId: string) => {
    setSent((s) => ({ ...s, [chatId]: "…" }));
    const error = await sendChatInvite(chatId, game, code);
    setSent((s) => ({ ...s, [chatId]: error ?? "invite posted" }));
  };

  const groups = chats.filter((c) => c.kind === "group");

  return (
    <div className="invite-friends">
      <button className="btn small" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : <Icon name="send" />} Invite friends
      </button>
      {open && (
        <div className="invite-list">
          {list === null && <div className="spinner" />}
          {list !== null && list.length === 0 && (
            <p className="hint">
              No friends yet — add some from the <Icon name="bell" /> menu or your account page.
            </p>
          )}
          {list?.map((f) => (
            <div key={f.userId} className={`invite-row ${f.online ? "" : "disconnected"}`}>
              <span className={`dot ${f.online ? "on" : "off"}`} />
              <span className="player-name">@{f.username}</span>
              <span className="invite-status">{statusOf(f)}</span>
              {sent[f.userId] ? (
                <span className="invite-sent">{sent[f.userId]}</span>
              ) : (
                <button className="btn small primary" onClick={() => void inviteFriend(f)}>
                  <Icon name="send" /> Invite
                </button>
              )}
            </div>
          ))}
          {groups.length > 0 && (
            <>
              <p className="hint invite-section-label">…or post the invite in a group chat:</p>
              {groups.map((c) => {
                const recipients = c.members.length - 1;
                const fits = recipients <= openSeats;
                return (
                  <div key={c.id} className="invite-row">
                    <span className="chat-avatar"><Icon name="users" /></span>
                    <span className="player-name">{c.name ?? "Group"}</span>
                    <span className="invite-status">
                      {fits
                        ? `${recipients} people`
                        : `${recipients} people — only ${openSeats} seat${openSeats === 1 ? "" : "s"} left`}
                    </span>
                    {sent[c.id] ? (
                      <span className="invite-sent">{sent[c.id]}</span>
                    ) : (
                      <button
                        className="btn small primary"
                        disabled={!fits}
                        onClick={() => void inviteChat(c.id)}
                      >
                        <Icon name="send" /> Post
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
          <button className="link-btn" onClick={() => navigate("/messages")}>
            Open Messages →
          </button>
        </div>
      )}
    </div>
  );
}

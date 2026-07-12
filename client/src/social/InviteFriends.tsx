import { useEffect, useState } from "react";
import type { FriendPresence, GameKey } from "@shared/social";
import { GAME_NAMES } from "@shared/social";
import { useAuth } from "../auth/AuthContext";
import { useSocial } from "./SocialContext";

interface Props {
  game: GameKey;
  code: string;
}

/**
 * Lobby "invite friends" panel: online friends first, one-tap invites.
 * Renders nothing for anonymous players — inviting is an account feature.
 */
export default function InviteFriends({ game, code }: Props) {
  const { user } = useAuth();
  const { ready, fetchPresence, inviteToLobby } = useSocial();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<FriendPresence[] | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({}); // userId -> "✓" | error

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () => {
      void fetchPresence().then((friends) => {
        if (!cancelled) setList(friends);
      });
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [open, fetchPresence]);

  if (!user || !ready) return null;

  const statusOf = (f: FriendPresence): string => {
    if (!f.online) return "offline";
    if (!f.activity) return "🟢 online";
    return f.activity.state === "lobby"
      ? `🟢 in a ${GAME_NAMES[f.activity.game]} lobby`
      : `🎮 playing ${GAME_NAMES[f.activity.game]}`;
  };

  const invite = async (f: FriendPresence) => {
    setSent((s) => ({ ...s, [f.userId]: "…" }));
    const error = await inviteToLobby(f.userId, game, code);
    setSent((s) => ({ ...s, [f.userId]: error ?? "✓ invited" }));
  };

  return (
    <div className="invite-friends">
      <button className="btn small" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "📨"} Invite friends
      </button>
      {open && (
        <div className="invite-list">
          {list === null && <div className="spinner" />}
          {list !== null && list.length === 0 && (
            <p className="hint">
              No friends yet — add some from the 🔔 menu or your account page.
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
                <button
                  className="btn small primary"
                  disabled={!f.online}
                  onClick={() => void invite(f)}
                >
                  Invite
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

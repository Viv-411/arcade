import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../auth/supabaseClient";
import { useAuth } from "../auth/AuthContext";

interface ProfileRow {
  username: string;
  display_name: string | null;
  created_at: string;
}

interface StatsRow {
  games_played: number;
  wins: number;
  per_game: unknown;
}

const GAME_LABELS: Record<string, string> = {
  mindmeld: "🧠 Mind Meld",
  trivia: "⚡ Speed Trivia",
  bidbattle: "💰 Bid Battle",
};

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

export default function AccountPage() {
  const { configured, user, loading, openAuthModal, signOut, refreshProfile } = useAuth();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [stats, setStats] = useState<StatsRow | null>(null);
  const [fetched, setFetched] = useState(false);
  const [usernameInput, setUsernameInput] = useState("");
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!supabase || !user) {
      setProfile(null);
      setStats(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [{ data: prof }, { data: st }] = await Promise.all([
        supabase!
          .from("profiles")
          .select("username, display_name, created_at")
          .eq("id", user.id)
          .maybeSingle(),
        supabase!
          .from("player_stats")
          .select("games_played, wins, per_game")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setProfile(prof ?? null);
      setStats(st ?? null);
      setUsernameInput(prof?.username ?? "");
      setDisplayNameInput(prof?.display_name ?? "");
      setFetched(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const save = async () => {
    if (!supabase || !user) return;
    const username = usernameInput.trim().toLowerCase();
    if (!USERNAME_RE.test(username)) {
      setMessage({
        kind: "error",
        text: "Usernames are 3-24 characters: lowercase letters, numbers, underscores.",
      });
      return;
    }
    setSaving(true);
    setMessage(null);
    const { error } = await supabase
      .from("profiles")
      .update({ username, display_name: displayNameInput.trim() || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setMessage({
        kind: "error",
        text: error.code === "23505" ? "That username is taken — try another." : error.message,
      });
      return;
    }
    setProfile((p) => (p ? { ...p, username, display_name: displayNameInput.trim() || null } : p));
    refreshProfile();
    setMessage({ kind: "ok", text: "Saved!" });
  };

  const providers = user?.identities?.map((i) => i.provider) ?? [];
  const perGame =
    stats && typeof stats.per_game === "object" && stats.per_game !== null
      ? (stats.per_game as Record<string, { played?: number; wins?: number }>)
      : {};

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
        <p>Sign in to see your account and stats. Accounts are optional — every game is
          fully playable without one.</p>
        <button className="btn primary" onClick={openAuthModal}>
          👤 Sign in
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <div className="panel account-details">
          <h3>Account</h3>
          <dl className="account-dl">
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Sign-in methods</dt>
            <dd>
              {providers.length > 0
                ? providers.map((p) => (p === "email" ? "email + password" : p)).join(" · ")
                : "—"}
            </dd>
            <dt>Member since</dt>
            <dd>
              {profile?.created_at
                ? new Date(profile.created_at).toLocaleDateString()
                : new Date(user.created_at).toLocaleDateString()}
            </dd>
          </dl>
        </div>

        <div className="panel">
          <h3>Profile</h3>
          {fetched && !profile && (
            <p className="hint">No profile row found — try signing out and back in.</p>
          )}
          <label className="field">
            <span>Username</span>
            <input
              value={usernameInput}
              maxLength={24}
              onChange={(e) =>
                setUsernameInput(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
              }
            />
          </label>
          <label className="field">
            <span>Display name</span>
            <input
              value={displayNameInput}
              maxLength={40}
              placeholder="(optional)"
              onChange={(e) => setDisplayNameInput(e.target.value)}
            />
          </label>
          {message && (
            <p className={message.kind === "ok" ? "auth-notice" : "used-warning"}>
              {message.kind === "ok" ? "✓ " : "⚠ "}
              {message.text}
            </p>
          )}
          <div className="lobby-buttons">
            <button className="btn primary" disabled={saving} onClick={() => void save()}>
              {saving ? "…" : "Save changes"}
            </button>
          </div>
        </div>

        <div className="panel">
          <h3>Stats</h3>
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-value">{stats?.games_played ?? 0}</span>
              <span className="stat-label">games played</span>
            </div>
            <div className="stat-tile">
              <span className="stat-value">{stats?.wins ?? 0}</span>
              <span className="stat-label">wins</span>
            </div>
          </div>
          {Object.keys(perGame).length > 0 && (
            <ul className="player-list summary">
              {Object.entries(perGame).map(([key, g]) => (
                <li key={key}>
                  <span className="player-name">{GAME_LABELS[key] ?? key}</span>
                  <span className="badge ready-badge">
                    {g.wins ?? 0} win{(g.wins ?? 0) === 1 ? "" : "s"} / {g.played ?? 0} played
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            Stats count games finished while signed in — earlier anonymous games aren't
            attributed.
          </p>
        </div>

        <div className="lobby-buttons">
          <Link to="/friends" className="btn">
            👥 Friends
          </Link>
          <button className="btn danger" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="page account">
      <header className="mm-header">
        <Link to="/" className="back-link">
          ← Arcade
        </Link>
        <h1 className="mm-title">👤 {profile ? `@${profile.username}` : "Account"}</h1>
      </header>
      {body}
    </div>
  );
}

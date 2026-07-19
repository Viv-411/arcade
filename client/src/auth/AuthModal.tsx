import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { appBaseUrl, isAuthConfigured, supabase } from "./supabaseClient";
import Icon from "../components/Icon";

interface Props {
  user: User | null;
  username: string | null;
  onClose: () => void;
  onSignOut: () => void;
}

export default function AuthModal({ user, username, onClose, onSignOut }: Props) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [wantedUsername, setWantedUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async () => {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: appBaseUrl(),
            data: { username: wantedUsername.trim().toLowerCase() || undefined },
          },
        });
        if (err) setError(err.message);
        else if (!data.session) {
          setNotice("Almost there — check your email to confirm your account.");
        }
        // With a session, onAuthStateChange (SIGNED_IN) closes the modal.
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const googleSignIn = async () => {
    if (!supabase) return;
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: appBaseUrl() },
    });
    // On success the browser navigates away; only errors are worth showing.
    if (err) setError(err.message);
  };

  let body: JSX.Element;
  if (!isAuthConfigured) {
    body = (
      <>
        <h2 className="screen-title">Accounts not configured</h2>
        <p className="hint">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see{" "}
          <code>.env.example</code> and the README) to enable login. Everything else works
          without an account.
        </p>
      </>
    );
  } else if (user) {
    body = (
      <>
        <h2 className="screen-title">Your account</h2>
        <p className="auth-identity">
          <span className="auth-username">@{username ?? "…"}</span>
          <span className="auth-email">{user.email}</span>
        </p>
        <div className="lobby-buttons">
          <button className="btn danger" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className="auth-tabs">
          <button
            className={`btn small ${mode === "login" ? "primary" : ""}`}
            onClick={() => setMode("login")}
          >
            Log in
          </button>
          <button
            className={`btn small ${mode === "signup" ? "primary" : ""}`}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        <button className="btn google-btn" disabled={busy} onClick={() => void googleSignIn()}>
          <span className="google-g">G</span> Continue with Google
        </button>
        <div className="auth-divider">or with email</div>

        {mode === "signup" && (
          <label className="field">
            <span>Username</span>
            <input
              value={wantedUsername}
              maxLength={24}
              placeholder="lowercase letters, numbers, _"
              onChange={(e) =>
                setWantedUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
              }
            />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>

        {error && <p className="used-warning"><Icon name="warning" /> {error}</p>}
        {notice && <p className="auth-notice"><Icon name="mail" /> {notice}</p>}

        <div className="lobby-buttons">
          <button
            className="btn primary"
            disabled={busy || !email.trim() || password.length < 6}
            onClick={() => void submit()}
          >
            {busy ? "…" : mode === "signup" ? "Create account" : "Log in"}
          </button>
        </div>
        <p className="hint">
          Accounts are optional — every game is fully playable without one.
        </p>
      </>
    );
  }

  return (
    <div
      className="overlay auth-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel auth-modal">
        <button className="auth-close" onClick={onClose} aria-label="Close">
          <Icon name="close" label="Close" />
        </button>
        {body}
      </div>
    </div>
  );
}

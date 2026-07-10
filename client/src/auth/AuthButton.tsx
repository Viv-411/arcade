import { useAuth } from "./AuthContext";

/** Small corner button: "Sign in" when anonymous, @username when logged in. */
export default function AuthButton() {
  const { user, username, loading, openAuthModal } = useAuth();

  return (
    <button
      className={`btn small auth-corner ${user ? "authed" : ""}`}
      disabled={loading}
      onClick={openAuthModal}
      title={user ? "Your account" : "Sign in (optional)"}
    >
      {loading ? "…" : user ? `👤 @${username ?? "…"}` : "👤 Sign in"}
    </button>
  );
}

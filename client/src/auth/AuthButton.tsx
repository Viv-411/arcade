import { useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import Icon from "../components/Icon";

/**
 * Small corner button: opens the sign-in modal when anonymous; goes to the
 * account page when signed in.
 */
export default function AuthButton() {
  const { user, username, loading, openAuthModal } = useAuth();
  const navigate = useNavigate();

  return (
    <button
      className={`btn small auth-corner ${user ? "authed" : ""}`}
      disabled={loading}
      onClick={() => (user ? navigate("/account") : openAuthModal())}
      title={user ? "Your account" : "Sign in (optional)"}
    >
      {loading ? "…" : user ? <><Icon name="user" /> @{username ?? "…"}</> : <><Icon name="user" /> Sign in</>}
    </button>
  );
}

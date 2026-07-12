import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { isAuthConfigured, supabase } from "./supabaseClient";
import AuthModal from "./AuthModal";

interface AuthContextValue {
  /** Whether Supabase env vars are set; false = auth UI degrades gracefully. */
  configured: boolean;
  user: User | null;
  /** Username from the profiles table (created by the signup trigger). */
  username: string | null;
  loading: boolean;
  openAuthModal: () => void;
  signOut: () => Promise<void>;
  /** Re-fetch the profile row (e.g. after the user edits their username). */
  refreshProfile: () => void;
  /**
   * Reusable gate for future auth-required actions (none exist yet): runs the
   * action immediately when logged in, otherwise opens the login modal and
   * runs the action after a successful login. Returns whether it ran now.
   */
  requireAuth: (action?: () => void) => boolean;
}

const AuthContext = createContext<AuthContextValue>({
  configured: false,
  user: null,
  username: null,
  loading: false,
  openAuthModal: () => {},
  signOut: async () => {},
  refreshProfile: () => {},
  requireAuth: () => false,
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(isAuthConfigured);
  const [modalOpen, setModalOpen] = useState(false);
  const pendingAction = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "SIGNED_IN" && session?.user) {
        setModalOpen(false);
        const action = pendingAction.current;
        pendingAction.current = null;
        action?.();
      }
      if (event === "SIGNED_OUT") setUsername(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // The signup trigger creates the profile row; fetch its username (retry
  // once in case the trigger is a beat behind on a brand-new signup).
  const [profileNonce, setProfileNonce] = useState(0);
  useEffect(() => {
    if (!supabase || !user) {
      setUsername(null);
      return;
    }
    let cancelled = false;
    const fetchProfile = async (attempt: number): Promise<void> => {
      const { data } = await supabase!
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data?.username) {
        setUsername(data.username);
        // Sensible default for the game-entry name field on first login.
        if (!localStorage.getItem("arcade:name")) {
          localStorage.setItem("arcade:name", data.username);
        }
      } else if (attempt < 2) {
        setTimeout(() => void fetchProfile(attempt + 1), 1200);
      } else {
        setUsername(user.email?.split("@")[0] ?? "player");
      }
    };
    void fetchProfile(0);
    return () => {
      cancelled = true;
    };
  }, [user, profileNonce]);

  const refreshProfile = useCallback(() => setProfileNonce((n) => n + 1), []);

  const openAuthModal = useCallback(() => setModalOpen(true), []);

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    setModalOpen(false);
  }, []);

  const requireAuth = useCallback(
    (action?: () => void): boolean => {
      if (user) {
        action?.();
        return true;
      }
      pendingAction.current = action ?? null;
      setModalOpen(true);
      return false;
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        configured: isAuthConfigured,
        user,
        username,
        loading,
        openAuthModal,
        signOut,
        refreshProfile,
        requireAuth,
      }}
    >
      {children}
      {modalOpen && (
        <AuthModal
          user={user}
          username={username}
          onClose={() => {
            pendingAction.current = null;
            setModalOpen(false);
          }}
          onSignOut={() => void signOut()}
        />
      )}
    </AuthContext.Provider>
  );
}

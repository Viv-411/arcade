import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@shared/database.types";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Null when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are unset — the whole
 * app (all three games, fully anonymous) works without Supabase configured;
 * only the login button degrades to a "not configured" notice.
 */
export const supabase: SupabaseClient<Database> | null =
  url && anonKey ? createClient<Database>(url, anonKey) : null;

export const isAuthConfigured = supabase !== null;

// Keep the current access token synchronously readable so the Socket.IO
// handshake (which takes a sync callback) can attach it on every (re)connect.
let accessToken: string | null = null;
let lastIdentity: string | null = null;
const identityListeners = new Set<() => void>();

function applySession(session: { access_token: string; user: { id: string } } | null): void {
  accessToken = session?.access_token ?? null;
  const identity = session?.user?.id ?? null;
  if (identity !== lastIdentity) {
    // Signed in or out (NOT a routine token refresh) — sockets that
    // handshook with the old identity need to re-handshake.
    lastIdentity = identity;
    identityListeners.forEach((cb) => cb());
  }
}

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => applySession(data.session));
  supabase.auth.onAuthStateChange((_event, session) => applySession(session));
}

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Fires when the signed-in identity changes (sign-in, sign-out, or the
 * initial session resolving after page load) — never on routine token
 * refreshes. Game sockets use this to re-handshake so their server-side
 * userId matches; without it, a socket that connected before the session
 * loaded stays anonymous (breaking friend invites and stat attribution).
 */
export function onIdentityChange(cb: () => void): () => void {
  identityListeners.add(cb);
  return () => identityListeners.delete(cb);
}

/** OAuth redirect target; must be in Supabase's allowed-redirects list. */
export function appBaseUrl(): string {
  return import.meta.env.VITE_APP_BASE_URL || window.location.origin;
}

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
if (supabase) {
  void supabase.auth.getSession().then(({ data }) => {
    accessToken = data.session?.access_token ?? null;
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    accessToken = session?.access_token ?? null;
  });
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** OAuth redirect target; must be in Supabase's allowed-redirects list. */
export function appBaseUrl(): string {
  return import.meta.env.VITE_APP_BASE_URL || window.location.origin;
}

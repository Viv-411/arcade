import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../shared/database.types.js";

let cached: SupabaseClient<Database> | null | undefined;

/**
 * Server-side Supabase client using the SERVICE ROLE key — bypasses RLS, so
 * it must NEVER be exposed to the client or used to act on a user's behalf
 * without checking authorization first. Returns null when not configured
 * (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset); callers must handle that.
 *
 * No server-side DB access exists yet — this is the sanctioned entry point
 * for future phases (e.g. loading a user's trivia set for a multiplayer game).
 */
export function getSupabaseAdmin(): SupabaseClient<Database> | null {
  if (cached !== undefined) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached =
    url && key
      ? createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return cached;
}

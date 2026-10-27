import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../shared/database.types.js";

let cached: SupabaseClient<Database> | null | undefined;

/**
 * Server-side Supabase client using the SERVICE ROLE key — bypasses RLS, so
 * it must NEVER be exposed to the client or used to act on a user's behalf
 * without checking authorization first. Returns null when not configured
 * (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY unset); callers must handle that.
 *
 * This is the ONLY sanctioned service-role entry point. Current callers, each
 * of which validates authorization ITSELF because RLS is bypassed here:
 * - stats.ts — records finished games via record_game_result.
 * - social/manager.ts — friendships, presence, and the deny-all chat tables.
 * - trivia/customSets.ts — loads a host's custom set for a private lobby,
 *   re-implementing the owner-or-share access rule in code.
 * - hotlap/store.ts — the deny-all hotlap_records table; only ever writes
 *   times the server itself verified, for the authenticated caller.
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

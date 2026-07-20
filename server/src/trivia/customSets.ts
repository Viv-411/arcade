import type { CustomSetInfo } from "../../../shared/trivia.js";
import { getSupabaseAdmin } from "../supabaseAdmin.js";
import type { PreparedQuestion } from "./questionSource.js";

/**
 * Loads custom trivia sets for PRIVATE lobby games. These reads use the
 * service-role client (players other than the host may have no access of
 * their own, yet everyone in the lobby plays the questions), and the service
 * role BYPASSES RLS — so this module re-implements the access rule in code
 * and every caller passes the acting user's id: the user must OWN the set or
 * hold a trivia_set_shares row for it, and the set must not be removed.
 */

export type SetAccessResult =
  | { ok: true; info: CustomSetInfo }
  | { ok: false; error: string };

export type SetLoadResult =
  | { ok: true; info: CustomSetInfo; questions: PreparedQuestion[] }
  | { ok: false; error: string };

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Explicit in-code authorization: owner or share recipient, set not removed. */
async function checkAccess(
  userId: string,
  setId: string,
): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  const admin = getSupabaseAdmin();
  if (!admin) return { ok: false, error: "Custom sets aren't available on this server." };
  const { data: set, error } = await admin
    .from("trivia_sets")
    .select("id, owner_id, title, is_removed")
    .eq("id", setId)
    .maybeSingle();
  if (error) return { ok: false, error: "Could not look up that set." };
  if (!set || set.is_removed) return { ok: false, error: "That set no longer exists." };
  if (set.owner_id !== userId) {
    const { data: share } = await admin
      .from("trivia_set_shares")
      .select("id")
      .eq("set_id", setId)
      .eq("shared_with", userId)
      .maybeSingle();
    if (!share) return { ok: false, error: "That set isn't yours or shared with you." };
  }
  return { ok: true, title: set.title };
}

/** Lobby-time validation: confirm access and report the playable size. */
export async function describeAccessibleSet(
  userId: string,
  setId: string,
): Promise<SetAccessResult> {
  const access = await checkAccess(userId, setId);
  if (!access.ok) return access;
  const admin = getSupabaseAdmin()!;
  const { count, error } = await admin
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("set_id", setId);
  if (error) return { ok: false, error: "Could not read that set's questions." };
  if (!count || count < 1) return { ok: false, error: "That set has no questions yet." };
  return { ok: true, info: { setId, title: access.title, questionCount: count } };
}

/**
 * Game-start load: re-checks access (against the CURRENT host), fetches the
 * questions, drops malformed rows, shuffles question order AND each
 * question's options (recomputing the hidden correct index server-side).
 */
export async function loadAccessibleSet(
  userId: string,
  setId: string,
  maxQuestions: number,
): Promise<SetLoadResult> {
  const access = await checkAccess(userId, setId);
  if (!access.ok) return access;
  const admin = getSupabaseAdmin()!;
  const { data, error } = await admin
    .from("questions")
    .select("question_text, options, correct_index")
    .eq("set_id", setId)
    .order("position", { ascending: true });
  if (error) return { ok: false, error: "Could not read that set's questions." };

  const prepared: PreparedQuestion[] = [];
  for (const row of data ?? []) {
    const options = Array.isArray(row.options) ? row.options.map(String) : [];
    const text = String(row.question_text ?? "").trim();
    if (
      !text ||
      options.length < 2 ||
      options.length > 4 ||
      !Number.isInteger(row.correct_index) ||
      row.correct_index < 0 ||
      row.correct_index >= options.length
    ) {
      continue; // skip malformed rows rather than crashing the game
    }
    const correctAnswer = options[row.correct_index];
    const shuffled = shuffle(options);
    prepared.push({
      category: access.title,
      difficulty: "custom",
      questionText: text,
      options: shuffled,
      correctIndex: shuffled.indexOf(correctAnswer),
    });
  }
  if (prepared.length === 0) {
    return { ok: false, error: "That set has no playable questions." };
  }
  // Shuffle question order; a set larger than the game length contributes a
  // RANDOM subset (documented in the README).
  const picked = shuffle(prepared).slice(0, Math.max(1, maxQuestions));
  return {
    ok: true,
    info: { setId, title: access.title, questionCount: picked.length },
    questions: picked,
  };
}

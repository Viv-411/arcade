import { supabase } from "../auth/supabaseClient";

/**
 * Data layer for custom trivia sets (content management only — gameplay
 * wiring is a later phase). Every call runs through the client's OWN
 * Supabase session, so Postgres RLS is the server-side authority:
 * owners read/write their sets, recipients of a trivia_set_shares row can
 * read (never write), and the anon key can touch nothing. No service-role
 * path exists for this feature.
 */

export interface SetSummary {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  ownerId: string;
  ownerUsername: string | null;
  questionCount: number;
  updatedAt: string;
}

export interface QuestionRow {
  id: string;
  setId: string;
  position: number;
  text: string;
  options: string[];
  correctIndex: number;
  sourceSetId: string | null;
}

export interface ShareRow {
  id: string;
  sharedWith: string;
  username: string;
}

export interface QuestionDraft {
  text: string;
  options: string[];
  correctIndex: number;
}

export const MAX_QUESTION_TEXT = 300;
export const MAX_OPTIONS = 4;
export const MIN_OPTIONS = 2;

/** Editor validation — mirrors the DB check constraint and the Speed Trivia
 *  engine's shape (options array + correct_index). */
export function validateQuestion(draft: QuestionDraft): string | null {
  const text = draft.text.trim();
  if (!text) return "The question needs some text.";
  if (text.length > MAX_QUESTION_TEXT) return `Question text maxes out at ${MAX_QUESTION_TEXT} characters.`;
  const options = draft.options.map((o) => o.trim());
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    return `Questions need ${MIN_OPTIONS}-${MAX_OPTIONS} answer options.`;
  }
  if (options.some((o) => !o)) return "Every answer option needs text.";
  if (
    !Number.isInteger(draft.correctIndex) ||
    draft.correctIndex < 0 ||
    draft.correctIndex >= options.length
  ) {
    return "Mark exactly one option as correct.";
  }
  return null;
}

function sb() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function countOf(joined: unknown): number {
  const arr = joined as { count: number }[] | null;
  return arr?.[0]?.count ?? 0;
}

function toOptions(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String) : [];
}

export async function listMySets(userId: string): Promise<SetSummary[]> {
  const { data, error } = await sb()
    .from("trivia_sets")
    .select("id, title, description, category, owner_id, updated_at, questions!questions_set_id_fkey(count)")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    ownerId: row.owner_id,
    ownerUsername: null,
    questionCount: countOf(row.questions),
    updatedAt: row.updated_at,
  }));
}

export async function listSharedSets(userId: string): Promise<SetSummary[]> {
  const { data, error } = await sb()
    .from("trivia_set_shares")
    .select(
      "set:trivia_sets(id, title, description, category, owner_id, updated_at, owner:profiles!trivia_sets_owner_id_fkey(username), questions!questions_set_id_fkey(count))",
    )
    .eq("shared_with", userId);
  if (error) throw new Error(error.message);
  const sets: SetSummary[] = [];
  for (const row of data ?? []) {
    const set = row.set as unknown as {
      id: string;
      title: string;
      description: string | null;
      category: string | null;
      owner_id: string;
      updated_at: string;
      owner: { username: string } | null;
      questions: { count: number }[] | null;
    } | null;
    if (!set) continue; // set was deleted or is no longer readable
    sets.push({
      id: set.id,
      title: set.title,
      description: set.description,
      category: set.category,
      ownerId: set.owner_id,
      ownerUsername: set.owner?.username ?? null,
      questionCount: countOf(set.questions),
      updatedAt: set.updated_at,
    });
  }
  sets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sets;
}

export async function getSet(setId: string): Promise<SetSummary | null> {
  const { data, error } = await sb()
    .from("trivia_sets")
    .select(
      "id, title, description, category, owner_id, updated_at, owner:profiles!trivia_sets_owner_id_fkey(username), questions!questions_set_id_fkey(count)",
    )
    .eq("id", setId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    title: data.title,
    description: data.description,
    category: data.category,
    ownerId: data.owner_id,
    ownerUsername: (data.owner as unknown as { username: string } | null)?.username ?? null,
    questionCount: countOf(data.questions),
    updatedAt: data.updated_at,
  };
}

export async function createSet(
  userId: string,
  fields: { title: string; description?: string; category?: string },
): Promise<string> {
  const { data, error } = await sb()
    .from("trivia_sets")
    .insert({
      owner_id: userId,
      title: fields.title.trim().slice(0, 120),
      description: fields.description?.trim() || null,
      category: fields.category?.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create the set.");
  return data.id;
}

export async function updateSet(
  setId: string,
  fields: { title: string; description: string; category: string },
): Promise<void> {
  const { error } = await sb()
    .from("trivia_sets")
    .update({
      title: fields.title.trim().slice(0, 120),
      description: fields.description.trim() || null,
      category: fields.category.trim() || null,
    })
    .eq("id", setId);
  if (error) throw new Error(error.message);
}

export async function deleteSet(setId: string): Promise<void> {
  const { error } = await sb().from("trivia_sets").delete().eq("id", setId);
  if (error) throw new Error(error.message);
}

export async function listQuestions(setId: string): Promise<QuestionRow[]> {
  const { data, error } = await sb()
    .from("questions")
    .select("id, set_id, position, question_text, options, correct_index, source_set_id")
    .eq("set_id", setId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    setId: row.set_id,
    position: row.position,
    text: row.question_text,
    options: toOptions(row.options),
    correctIndex: row.correct_index,
    sourceSetId: row.source_set_id,
  }));
}

export async function insertQuestion(
  setId: string,
  draft: QuestionDraft,
  position: number,
): Promise<void> {
  const { error } = await sb().from("questions").insert({
    set_id: setId,
    position,
    question_text: draft.text.trim(),
    options: draft.options.map((o) => o.trim()),
    correct_index: draft.correctIndex,
  });
  if (error) throw new Error(error.message);
}

export async function updateQuestion(questionId: string, draft: QuestionDraft): Promise<void> {
  const { error } = await sb()
    .from("questions")
    .update({
      question_text: draft.text.trim(),
      options: draft.options.map((o) => o.trim()),
      correct_index: draft.correctIndex,
    })
    .eq("id", questionId);
  if (error) throw new Error(error.message);
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const { error } = await sb().from("questions").delete().eq("id", questionId);
  if (error) throw new Error(error.message);
}

/** Persist one row's position (reorders renumber every shifted row). */
export async function setQuestionPosition(questionId: string, position: number): Promise<void> {
  const { error } = await sb().from("questions").update({ position }).eq("id", questionId);
  if (error) throw new Error(error.message);
}

export async function listShares(setId: string): Promise<ShareRow[]> {
  const { data, error } = await sb()
    .from("trivia_set_shares")
    .select("id, shared_with, profile:profiles!trivia_set_shares_shared_with_fkey(username)")
    .eq("set_id", setId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    sharedWith: row.shared_with,
    username: (row.profile as unknown as { username: string } | null)?.username ?? "?",
  }));
}

export async function shareSet(
  setId: string,
  byUserId: string,
  withUserIds: string[],
): Promise<void> {
  if (withUserIds.length === 0) return;
  const { error } = await sb()
    .from("trivia_set_shares")
    .upsert(
      withUserIds.map((uid) => ({ set_id: setId, shared_with: uid, shared_by: byUserId })),
      { onConflict: "set_id,shared_with", ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await sb().from("trivia_set_shares").delete().eq("id", shareId);
  if (error) throw new Error(error.message);
}

/**
 * COPY questions into a set I own (composition is copy-not-reference: new
 * rows, new ids; source_set_id records provenance only). Appends after the
 * target's current questions.
 */
export async function copyQuestionsTo(
  targetSetId: string,
  questions: QuestionRow[],
  sourceSetId: string,
): Promise<number> {
  if (questions.length === 0) return 0;
  const client = sb();
  const { data: maxRows, error: maxErr } = await client
    .from("questions")
    .select("position")
    .eq("set_id", targetSetId)
    .order("position", { ascending: false })
    .limit(1);
  if (maxErr) throw new Error(maxErr.message);
  const start = (maxRows?.[0]?.position ?? -1) + 1;
  const { error } = await client.from("questions").insert(
    questions.map((q, i) => ({
      set_id: targetSetId,
      position: start + i,
      question_text: q.text,
      options: q.options,
      correct_index: q.correctIndex,
      source_set_id: sourceSetId,
    })),
  );
  if (error) throw new Error(error.message);
  return questions.length;
}

/** Fork a whole readable set into a brand-new set I own. */
export async function duplicateSet(
  source: SetSummary,
  questions: QuestionRow[],
  myUserId: string,
): Promise<string> {
  const newId = await createSet(myUserId, {
    title: `Copy of ${source.title}`.slice(0, 120),
    description: source.description ?? undefined,
    category: source.category ?? undefined,
  });
  if (questions.length > 0) {
    const { error } = await sb().from("questions").insert(
      questions.map((q, i) => ({
        set_id: newId,
        position: i,
        question_text: q.text,
        options: q.options,
        correct_index: q.correctIndex,
        source_set_id: source.id,
      })),
    );
    if (error) throw new Error(error.message);
  }
  return newId;
}

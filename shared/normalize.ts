import type { MatchMode } from "./types.js";

/**
 * Canonical word normalization, used identically for win-detection and the
 * no-repeat rule: lowercase, trim, collapse internal whitespace, strip
 * surrounding punctuation. In "loose" mode, simple trailing-s plurals are
 * also singularized ("cats" -> "cat", but "ss" endings like "glass" and
 * short words like "gas"/"is" are left alone).
 */
export function normalizeWord(raw: string, mode: MatchMode = "strict"): string {
  let word = raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  if (mode === "loose" && word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) {
    word = word.slice(0, -1);
  }
  return word;
}

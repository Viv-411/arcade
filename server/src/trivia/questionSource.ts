import type { TriviaDifficulty } from "../../../shared/trivia.js";

export interface TriviaCategory {
  id: number;
  name: string;
}

export interface PreparedQuestion {
  category: string;
  difficulty: string;
  questionText: string;
  /** Correct answer shuffled in with the incorrect ones. */
  options: string[];
  correctIndex: number;
}

export interface GetQuestionsOpts {
  /** OpenTDB category id; omit for "any". */
  category?: number;
  difficulty?: TriviaDifficulty;
  amount: number;
}

/**
 * All question fetching goes through this adapter so the source can be
 * swapped later (different API, local question packs, ...).
 */
export interface QuestionSource {
  getCategories(): Promise<TriviaCategory[]>;
  getQuestions(opts: GetQuestionsOpts): Promise<PreparedQuestion[]>;
}

// ---------------------------------------------------------------------------
// Open Trivia DB implementation — https://opentdb.com (free, no API key)
// ---------------------------------------------------------------------------

const OPENTDB = "https://opentdb.com";
const GENERAL_KNOWLEDGE_ID = 9;
// OpenTDB allows roughly one request per 5 seconds per IP.
const MIN_REQUEST_GAP_MS = 5500;

// Used if the category endpoint is unreachable; ids are OpenTDB's stable ids.
const FALLBACK_CATEGORIES: TriviaCategory[] = [
  { id: 9, name: "General Knowledge" },
  { id: 11, name: "Film" },
  { id: 12, name: "Music" },
  { id: 15, name: "Video Games" },
  { id: 17, name: "Science & Nature" },
  { id: 18, name: "Computers" },
  { id: 21, name: "Sports" },
  { id: 22, name: "Geography" },
  { id: 23, name: "History" },
  { id: 27, name: "Animals" },
];

// Last-resort built-in questions so a game can always start (e.g. offline dev).
const BUILTIN_QUESTIONS: Array<{ q: string; correct: string; wrong: string[] }> = [
  { q: "What is the largest planet in our solar system?", correct: "Jupiter", wrong: ["Saturn", "Neptune", "Earth"] },
  { q: "Which language runs natively in web browsers?", correct: "JavaScript", wrong: ["Python", "C++", "Java"] },
  { q: "How many continents are there on Earth?", correct: "7", wrong: ["5", "6", "8"] },
  { q: "What is the chemical symbol for gold?", correct: "Au", wrong: ["Ag", "Go", "Gd"] },
  { q: "Which ocean is the largest?", correct: "Pacific", wrong: ["Atlantic", "Indian", "Arctic"] },
  { q: "What year did the first human land on the Moon?", correct: "1969", wrong: ["1965", "1971", "1959"] },
  { q: "Which instrument has 88 keys?", correct: "Piano", wrong: ["Organ", "Accordion", "Harpsichord"] },
  { q: "What is the fastest land animal?", correct: "Cheetah", wrong: ["Lion", "Pronghorn", "Greyhound"] },
  { q: "Which country invented pizza?", correct: "Italy", wrong: ["France", "Greece", "Spain"] },
  { q: "How many sides does a hexagon have?", correct: "6", wrong: ["5", "7", "8"] },
  { q: "What gas do plants absorb from the atmosphere?", correct: "Carbon dioxide", wrong: ["Oxygen", "Nitrogen", "Hydrogen"] },
  { q: "Which planet is known as the Red Planet?", correct: "Mars", wrong: ["Venus", "Mercury", "Jupiter"] },
  { q: "What is the capital of Japan?", correct: "Tokyo", wrong: ["Osaka", "Kyoto", "Seoul"] },
  { q: "How many strings does a standard guitar have?", correct: "6", wrong: ["4", "5", "7"] },
  { q: "Which artist painted the Mona Lisa?", correct: "Leonardo da Vinci", wrong: ["Michelangelo", "Raphael", "Donatello"] },
];

function decodeBase64(s: string): string {
  return Buffer.from(s, "base64").toString("utf8");
}

/** Minimal HTML entity decoding for the category list (which isn't base64). */
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function prepare(raw: {
  category: string;
  difficulty: string;
  question: string;
  correct: string;
  incorrect: string[];
}): PreparedQuestion {
  const options = shuffle([
    { text: raw.correct, isCorrect: true },
    ...raw.incorrect.map((text) => ({ text, isCorrect: false })),
  ]);
  return {
    category: raw.category,
    difficulty: raw.difficulty,
    questionText: raw.question,
    options: options.map((o) => o.text),
    correctIndex: options.findIndex((o) => o.isCorrect),
  };
}

function builtinQuestions(amount: number, exclude: Set<string>): PreparedQuestion[] {
  return shuffle(BUILTIN_QUESTIONS)
    .filter((b) => !exclude.has(b.q))
    .slice(0, amount)
    .map((b) =>
      prepare({
        category: "General Knowledge",
        difficulty: "medium",
        question: b.q,
        correct: b.correct,
        incorrect: b.wrong,
      }),
    );
}

interface OpenTdbResponse {
  response_code: number;
  results?: Array<{
    category: string;
    difficulty: string;
    question: string;
    correct_answer: string;
    incorrect_answers: string[];
  }>;
  token?: string;
}

export class OpenTdbSource implements QuestionSource {
  private categories: TriviaCategory[] | null = null;
  private categoriesPromise: Promise<TriviaCategory[]> | null = null;
  private token: string | null = null;
  // Serialize every network call and space them out for the rate limit.
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  /** Fetch a URL, waiting in line so we never exceed ~1 request / 5s. */
  private throttledFetch(url: string): Promise<unknown> {
    const run = async () => {
      const wait = this.lastRequestAt + MIN_REQUEST_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`OpenTDB HTTP ${res.status}`);
      return res.json();
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /** Warm the category cache and session token; call once at server startup. */
  warmUp(): void {
    void this.getCategories().catch(() => {});
    void this.ensureToken().catch(() => {});
  }

  getCategories(): Promise<TriviaCategory[]> {
    if (this.categories) return Promise.resolve(this.categories);
    // Cache the list on first use (it rarely changes); share in-flight fetches.
    this.categoriesPromise ??= (async () => {
      try {
        const data = (await this.throttledFetch(`${OPENTDB}/api_category.php`)) as {
          trivia_categories?: Array<{ id: number; name: string }>;
        };
        const cats = (data.trivia_categories ?? []).map((c) => ({
          id: c.id,
          name: decodeHtml(c.name),
        }));
        this.categories = cats.length > 0 ? cats : FALLBACK_CATEGORIES;
      } catch (err) {
        console.warn("[opentdb] category fetch failed, using fallback list:", err);
        this.categories = FALLBACK_CATEGORIES;
        this.categoriesPromise = null; // allow a retry later
      }
      return this.categories;
    })();
    return this.categoriesPromise;
  }

  private async ensureToken(): Promise<string | null> {
    if (this.token) return this.token;
    try {
      const data = (await this.throttledFetch(
        `${OPENTDB}/api_token.php?command=request`,
      )) as OpenTdbResponse;
      this.token = data.token ?? null;
    } catch (err) {
      console.warn("[opentdb] token request failed (continuing without):", err);
      this.token = null;
    }
    return this.token;
  }

  private async resetToken(): Promise<void> {
    if (!this.token) return;
    try {
      await this.throttledFetch(`${OPENTDB}/api_token.php?command=reset&token=${this.token}`);
    } catch {
      this.token = null; // re-request next time
    }
  }

  /**
   * One batch fetch. Returns [] when OpenTDB has too few questions for the
   * filter (response_code 1) so the caller can relax filters.
   */
  private async fetchBatch(
    amount: number,
    category: number | undefined,
    difficulty: TriviaDifficulty | undefined,
    retries = 2,
  ): Promise<PreparedQuestion[]> {
    const token = await this.ensureToken();
    const params = new URLSearchParams({
      amount: String(amount),
      type: "multiple",
      encode: "base64", // avoids hand-rolling full HTML entity decoding
    });
    if (category !== undefined) params.set("category", String(category));
    if (difficulty) params.set("difficulty", difficulty);
    if (token) params.set("token", token);

    const data = (await this.throttledFetch(
      `${OPENTDB}/api.php?${params.toString()}`,
    )) as OpenTdbResponse;

    switch (data.response_code) {
      case 0:
        return (data.results ?? []).map((r) =>
          prepare({
            category: decodeBase64(r.category),
            difficulty: decodeBase64(r.difficulty),
            question: decodeBase64(r.question),
            correct: decodeBase64(r.correct_answer),
            incorrect: r.incorrect_answers.map(decodeBase64),
          }),
        );
      case 1: // not enough questions for this filter
        return [];
      case 3: // token not found
      case 4: // token exhausted
        if (retries > 0) {
          if (data.response_code === 4) await this.resetToken();
          else this.token = null;
          return this.fetchBatch(amount, category, difficulty, retries - 1);
        }
        return [];
      case 5: // rate limited; the throttle will space out the retry
        if (retries > 0) return this.fetchBatch(amount, category, difficulty, retries - 1);
        return [];
      default:
        console.warn(`[opentdb] unexpected response_code ${data.response_code}`);
        return [];
    }
  }

  /**
   * Fetch a full set of questions with fallbacks so a game ALWAYS gets one:
   * exact filter -> difficulty relaxed to any -> topped up from General
   * Knowledge -> built-in questions (e.g. offline).
   */
  async getQuestions(opts: GetQuestionsOpts): Promise<PreparedQuestion[]> {
    const collected: PreparedQuestion[] = [];
    const seen = new Set<string>();
    const collect = (batch: PreparedQuestion[]) => {
      for (const q of batch) {
        if (!seen.has(q.questionText) && collected.length < opts.amount) {
          seen.add(q.questionText);
          collected.push(q);
        }
      }
    };

    const attempts: Array<[number | undefined, TriviaDifficulty | undefined]> = [
      [opts.category, opts.difficulty],
    ];
    if (opts.difficulty) attempts.push([opts.category, undefined]);
    if (opts.category !== GENERAL_KNOWLEDGE_ID) attempts.push([GENERAL_KNOWLEDGE_ID, undefined]);

    for (const [category, difficulty] of attempts) {
      if (collected.length >= opts.amount) break;
      try {
        collect(await this.fetchBatch(opts.amount - collected.length, category, difficulty));
      } catch (err) {
        console.warn("[opentdb] question fetch failed:", err);
      }
    }
    if (collected.length < opts.amount) {
      collect(builtinQuestions(opts.amount - collected.length, seen));
    }
    return collected;
  }
}

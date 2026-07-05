// End-to-end: two clients play Speed Trivia to completion.
// Hits the real OpenTDB API when online; the built-in question fallback
// keeps this test passing offline or when rate-limited (e.g. CI).
import { connect, emit, waitFor, assert, sleep, globalTimeout } from "./helpers.mjs";

const timer = globalTimeout(120000, "trivia test");

const a = connect("/trivia");
const b = connect("/trivia");

// --- create & join on the /trivia namespace ---
const created = await emit(a, "createRoom", {
  name: "Alice",
  isPublic: false,
  settings: { questionsPerGame: 3, questionTimeSec: 10, revealPauseSec: 1, categoryVoteSec: 10 },
});
assert(created.ok, "Alice creates a trivia room");
const code = created.data.code;
assert(created.data.room.settings.questionsPerGame === 3, "settings applied (3 questions)");
assert(created.data.room.settings.difficulty === "medium", "default difficulty is medium");

const joined = await emit(b, "joinRoom", { code, name: "Bob" });
assert(joined.ok, "Bob joins via shared join-by-code");

// --- difficulty selector (host only) ---
a.emit("setDifficulty", { difficulty: "easy" });
const upd = await waitFor(b, "roomUpdate", (r) => r.settings.difficulty === "easy", 5000);
assert(upd.settings.difficulty === "easy", "host set difficulty to easy");

// --- ready & start -> category vote ---
const votePromise = waitFor(a, "voteStart");
a.emit("toggleReady");
b.emit("toggleReady");
await sleep(200);
a.emit("startGame");
const vote = await votePromise;
assert(vote.options.length >= 2, `vote has ${vote.options.length} category options`);
assert(vote.options.some((o) => o.id === -1), 'vote includes "Surprise Me (Any)"');

// --- both vote (early resolve) then wait for the first question ---
const q1Promise = waitFor(a, "questionStart", () => true, 90000);
const pick = vote.options[1].id;
a.emit("voteCategory", { categoryId: pick });
b.emit("voteCategory", { categoryId: pick });
const q1 = await q1Promise;
assert(q1.index === 0 && q1.total === 3, "question 1 of 3 started");
assert(q1.options.length >= 2, `question has ${q1.options.length} options`);
assert(typeof q1.questionText === "string" && q1.questionText.length > 0, "question text present");
assert(!("correctIndex" in q1), "correct answer NOT sent before reveal");
assert(!/&[a-z]+;|&#\d+;/i.test(q1.questionText + q1.options.join("")), "text is HTML-decoded");

// --- answer: lock, duplicate rejected, fast-path resolve ---
const reveal1Promise = waitFor(a, "questionReveal");
const ansA = await emit(a, "answer", { optionIndex: 0 });
assert(ansA.ok, "Alice's answer accepted");
const dup = await emit(a, "answer", { optionIndex: 1 });
assert(!dup.ok && /locked/.test(dup.error), "duplicate answer rejected");
const ansB = await emit(b, "answer", { optionIndex: 1 });
assert(ansB.ok, "Bob's answer accepted");
const rev1 = await reveal1Promise;
assert(rev1.correctIndex >= 0 && rev1.correctIndex < q1.options.length, "reveal has correctIndex");
assert(rev1.perPlayer.length === 2, "reveal covers both players");
for (const pp of rev1.perPlayer) {
  const expected = pp.correct
    ? pp.pointsEarned >= 500 && pp.pointsEarned <= 1000
    : pp.pointsEarned === 0;
  assert(expected, `${pp.name}: correct=${pp.correct} points=${pp.pointsEarned} within scoring rules`);
}
assert(rev1.scoreboard.length === 2, "scoreboard has both players");

// --- late answer after resolve is rejected ---
const late = await emit(b, "answer", { optionIndex: 0 });
assert(!late.ok, "answer after resolve rejected");

// --- play out remaining questions via the all-answered fast path ---
const overPromise = waitFor(a, "gameOver", () => true, 90000);
for (let i = 1; i < 3; i++) {
  await waitFor(a, "questionStart", (p) => p.index === i, 60000);
  await waitFor(b, "questionStart", (p) => p.index === i, 10000);
  await emit(a, "answer", { optionIndex: 0 });
  await emit(b, "answer", { optionIndex: 0 });
  await waitFor(a, "questionReveal", (p) => p.index === i, 15000);
  console.log(`  ok: question ${i + 1} resolved`);
}
const over = await overPromise;
assert(over.finalScoreboard.length === 2, "final scoreboard has both players");
assert(over.winners.length >= 1, `winner(s): ${over.winners.map((w) => w.name).join(", ")}`);
const sorted = [...over.finalScoreboard].every(
  (e, i, arr) => i === 0 || arr[i - 1].totalScore >= e.totalScore,
);
assert(sorted, "final scoreboard is sorted descending");

// --- play again returns to lobby with scores reset ---
const lobbyPromise = waitFor(b, "roomUpdate", (r) => r.state === "lobby", 10000);
a.emit("playAgain");
const lobby = await lobbyPromise;
assert(lobby.players.every((p) => p.score === 0 && !p.ready), "playAgain resets scores and ready");

console.log("TRIVIA TEST PASSED\n");
clearTimeout(timer);
a.close();
b.close();
process.exit(0);

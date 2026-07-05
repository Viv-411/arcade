// End-to-end: TEN players play Speed Trivia; an 11th is rejected;
// Mind Meld remains capped at 4.
import { connect, emit, waitFor, assert, sleep, globalTimeout } from "./helpers.mjs";

const timer = globalTimeout(120000, "10-player trivia test");

const N = 10;
const clients = Array.from({ length: N }, () => connect("/trivia"));
const [host, ...rest] = clients;

// --- create + 9 joins ---
const created = await emit(host, "createRoom", {
  name: "P1",
  isPublic: false,
  settings: { questionsPerGame: 3, questionTimeSec: 10, revealPauseSec: 1, categoryVoteSec: 10 },
});
assert(created.ok, "host creates a trivia room");
const code = created.data.code;

for (let i = 0; i < rest.length; i++) {
  const res = await emit(rest[i], "joinRoom", { code, name: `P${i + 2}` });
  assert(res.ok, `player ${i + 2} joined`);
}

// --- 11th player rejected ---
const extra = connect("/trivia");
const rejected = await emit(extra, "joinRoom", { code, name: "P11" });
assert(!rejected.ok && /full/.test(rejected.error), `11th player rejected: "${rejected.error}"`);
extra.close();

// --- mind meld still capped at 4 ---
const mm = Array.from({ length: 5 }, () => connect("/mindmeld"));
const mmCreated = await emit(mm[0], "createRoom", { name: "M1", isPublic: false });
assert(mmCreated.ok, "mind meld room created");
for (let i = 1; i < 4; i++) {
  const res = await emit(mm[i], "joinRoom", { code: mmCreated.data.code, name: `M${i + 1}` });
  assert(res.ok, `mind meld player ${i + 1} joined`);
}
const mmFifth = await emit(mm[4], "joinRoom", { code: mmCreated.data.code, name: "M5" });
assert(!mmFifth.ok && /full \(4/.test(mmFifth.error), "mind meld 5th player still rejected at 4");
mm.forEach((s) => s.close());

// --- all 10 ready, host starts, all vote ---
const votePromise = waitFor(host, "voteStart");
clients.forEach((c) => c.emit("toggleReady"));
await sleep(300);
host.emit("startGame");
const vote = await votePromise;
assert(vote.options.length >= 2, "vote started for 10 players");
const pick = vote.options[1].id;
const q1Promise = waitFor(host, "questionStart", () => true, 90000);
clients.forEach((c) => c.emit("voteCategory", { categoryId: pick }));
const q1 = await q1Promise;
assert(q1.index === 0 && q1.total === 3, "question 1 of 3 started after all-voted fast path");

// --- play all questions: everyone answers, fast-path resolves ---
const overPromise = waitFor(host, "gameOver", () => true, 90000);
for (let i = 0; i < 3; i++) {
  if (i > 0) await waitFor(host, "questionStart", (p) => p.index === i, 60000);
  await sleep(150); // let questionStart reach everyone
  const acks = await Promise.all(
    clients.map((c, idx) => emit(c, "answer", { optionIndex: idx % 4 })),
  );
  assert(acks.every((a) => a.ok), `all 10 answers accepted on question ${i + 1}`);
  const rev = await waitFor(host, "questionReveal", (p) => p.index === i, 20000);
  assert(rev.perPlayer.length === N, `reveal ${i + 1} covers all ${N} players`);
  assert(rev.scoreboard.length === N, `scoreboard ${i + 1} has ${N} entries`);
}

const over = await overPromise;
assert(over.finalScoreboard.length === N, "final scoreboard has all 10 players");
assert(over.winners.length >= 1, `winner(s): ${over.winners.map((w) => w.name).join(", ")}`);

console.log("10-PLAYER TRIVIA TEST PASSED\n");
clearTimeout(timer);
clients.forEach((c) => c.close());
process.exit(0);

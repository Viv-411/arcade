// End-to-end: Imposter online. Three matches:
//  A) 4p — secrecy assertions, tie -> runoff -> still tied -> new clue cycle,
//     then imposter caught and STEALS the word (imposters win).
//  B) 3p — forced vote after 1 round, a turn timeout skip, crew eliminated,
//     parity -> imposters win.
//  C) 3p — imposter caught, word guess misses -> crew wins.
import { connect, emit, waitFor, assert, sleep, globalTimeout } from "./helpers.mjs";

const timer = globalTimeout(150000, "imposter test");

// Queueing collector: consecutive server events (like back-to-back clueTurn)
// can arrive before a fresh waitFor registers — queue them all up front.
function makeCollector(sock, ev) {
  const queue = [];
  const waiters = [];
  sock.on(ev, (p) => {
    const w = waiters.shift();
    if (w) w(p);
    else queue.push(p);
  });
  return (timeoutMs = 30000, label = ev) =>
    new Promise((resolve, reject) => {
      if (queue.length > 0) return resolve(queue.shift());
      const t = setTimeout(() => reject(new Error(`collector timeout: ${label}`)), timeoutMs);
      waiters.push((p) => {
        clearTimeout(t);
        resolve(p);
      });
    });
}

async function setupRoom(n, settings) {
  const socks = Array.from({ length: n }, () => connect("/imposter"));
  const created = await emit(socks[0], "createRoom", { name: "P0", isPublic: false, settings });
  assert(created.ok, "room created");
  const code = created.data.code;
  const ids = [created.data.playerId];
  for (let k = 1; k < n; k++) {
    const j = await emit(socks[k], "joinRoom", { code, name: `P${k}` });
    assert(j.ok, `P${k} joined`);
    ids.push(j.data.playerId);
  }
  const col = {
    turn: makeCollector(socks[0], "clueTurn"),
    decision: makeCollector(socks[0], "decisionStart"),
    vote: makeCollector(socks[0], "voteStart"),
    result: makeCollector(socks[0], "voteResult"),
    end: makeCollector(socks[0], "gameEnd"),
  };
  return { socks, ids, code, col };
}

async function startAndCollectRoles(socks) {
  const rolePs = socks.map((s) => waitFor(s, "yourRole", () => true, 15000));
  socks.forEach((s) => s.emit("toggleReady"));
  await sleep(250);
  socks[0].emit("startGame");
  return Promise.all(rolePs);
}

/** One turn: wait for whose-turn, optionally submit, confirm the board entry. */
async function takeTurn(col, socks, ids, wordFor) {
  const turn = await col.turn(35000, "clueTurn");
  const k = ids.indexOf(turn.playerId);
  const cluedP = waitFor(socks[0], "clueSubmitted", (p) => p.playerId === turn.playerId, 35000);
  const word = wordFor(k, turn);
  if (word !== null) {
    const res = await emit(socks[k], "submitClue", { word });
    assert(res.ok, `clue from P${k} accepted (${res.error ?? "ok"})`);
  }
  return { k, entry: await cluedP };
}

// ============================ scenario A ============================
{
  const { socks, ids, code, col } = await setupRoom(4, {
    revealSec: 3,
    clueTurnSec: 25,
    decisionSec: 20,
    voteSec: 20,
    stealSec: 20,
    maxClueRounds: 3,
    hints: true,
    wordSteal: true,
  });

  // capture every snapshot to prove no secrets leak before the end
  const snapshots = [];
  socks.forEach((s) => s.on("roomUpdate", (r) => snapshots.push(r)));

  const roles = await startAndCollectRoles(socks);
  const imposterIdx = roles.findIndex((r) => r.role === "imposter");
  const crewIdx = roles.findIndex((r) => r.role === "crew");
  assert(roles.filter((r) => r.role === "imposter").length === 1, "exactly one imposter");
  assert(roles[imposterIdx].word === null, "imposter's client NEVER receives the word");
  assert(typeof roles[imposterIdx].hint === "string", "imposter sees the category hint");
  assert(
    roles.every((r, i) => i === imposterIdx || (typeof r.word === "string" && r.hint === null)),
    "crew see the word (and no hint field)",
  );
  const word = roles[crewIdx].word;
  assert(roles.every((r) => r.startingPlayerName === roles[0].startingPlayerName), "same starting player");

  // secrecy on rejoin mid-game
  const rj = await emit(socks[imposterIdx], "rejoin", { playerId: ids[imposterIdx], code });
  assert(rj.ok && rj.data.yourRole.role === "imposter" && rj.data.yourRole.word === null,
    "rejoin restores the imposter's card without the word");

  // round 1 with guards on the first turn
  let guarded = false;
  for (let t = 0; t < 4; t++) {
    await takeTurn(col, socks, ids, (k, turn) => {
      if (!guarded) {
        guarded = true;
        const wrongK = ids.findIndex((id) => id !== turn.playerId);
        void emit(socks[wrongK], "submitClue", { word: "sneaky" }).then((r) =>
          assert(!r.ok, "off-turn clue rejected"),
        );
        if (k !== imposterIdx && !/\s/.test(word)) {
          void emit(socks[k], "submitClue", { word }).then((r) =>
            assert(!r.ok && /secret word/i.test(r.error), "crew cannot say the secret word"),
          );
        }
      }
      return `cluea${k}`;
    });
  }

  await col.decision(20000, "A decision");
  socks.forEach((s) => s.emit("castDecisionVote", { choice: "accuse" }));
  const v1 = await col.vote(20000, "A vote 1");
  assert(!v1.runoff, "first vote is not a runoff");

  // 2-2 tie between two players -> runoff -> still tied -> new clue cycle
  const [tA, tB] = [ids[0], ids[1]];
  socks[1].emit("castAccusationVote", { targetId: tA });
  socks[2].emit("castAccusationVote", { targetId: tA });
  socks[0].emit("castAccusationVote", { targetId: tB });
  socks[3].emit("castAccusationVote", { targetId: tB });
  const r1 = await col.result(25000, "A tie result");
  assert(r1.eliminatedId === null && r1.runoffNext, "tie triggers a runoff");
  const v2 = await col.vote(25000, "A runoff");
  assert(v2.runoff && v2.candidates.length === 2, "runoff narrowed to the tied pair");
  socks[1].emit("castAccusationVote", { targetId: tA });
  socks[2].emit("castAccusationVote", { targetId: tA });
  socks[0].emit("castAccusationVote", { targetId: tB });
  socks[3].emit("castAccusationVote", { targetId: tB });
  const r2 = await col.result(25000, "A runoff result");
  assert(r2.eliminatedId === null && !r2.runoffNext, "runoff tie eliminates nobody");

  // clue round 2 (fresh cycle), then everyone piles on the imposter
  for (let t = 0; t < 4; t++) await takeTurn(col, socks, ids, (k) => `clueb${k}`);
  await col.decision(20000, "A decision 2");
  socks.forEach((s) => s.emit("castDecisionVote", { choice: "accuse" }));
  await col.vote(20000, "A vote 2");

  const stealP = waitFor(socks[imposterIdx], "wordStealPrompt", () => true, 30000);
  let leakedPrompt = false;
  socks.forEach((s, k) => {
    if (k !== imposterIdx) s.once("wordStealPrompt", () => (leakedPrompt = true));
  });
  socks.forEach((s, k) => {
    if (k !== imposterIdx) s.emit("castAccusationVote", { targetId: ids[imposterIdx] });
  });
  socks[imposterIdx].emit("castAccusationVote", { targetId: ids[crewIdx] });
  const elim = await col.result(25000, "A elimination");
  assert(elim.eliminatedId === ids[imposterIdx] && elim.revealedRole === "imposter",
    "imposter eliminated with role revealed");
  await stealP;
  assert(!leakedPrompt, "wordStealPrompt went ONLY to the caught imposter");
  const guess = await emit(socks[imposterIdx], "submitWordGuess", { word });
  assert(guess.ok && guess.data.correct, "correct steal guess accepted");
  const end = await col.end(15000, "A gameEnd");
  assert(end.winningSide === "imposters" && end.word === word && end.allRoles.length === 4,
    "imposters win by word steal; full reveal");

  // NO snapshot before "finished" ever contained the word or roles
  const leaky = snapshots.filter((r) => r.state !== "finished" && (r.word !== null || r.allRoles !== null));
  assert(leaky.length === 0, `no pre-finish snapshot leaks secrets (checked ${snapshots.length})`);

  const lobbyP = waitFor(socks[1], "roomUpdate", (r) => r.state === "lobby", 8000);
  socks[0].emit("playAgain");
  await lobbyP;
  console.log("  --- scenario A passed (secrecy, ties, runoff, word steal) ---");
  socks.forEach((s) => s.close());
}

// ============================ scenario B ============================
{
  const { socks, ids, col } = await setupRoom(3, {
    revealSec: 3,
    clueTurnSec: 5, // short: one player times out on purpose
    voteSec: 20,
    maxClueRounds: 1, // forced vote right after round 1
    wordSteal: true,
    hints: false,
  });
  const roles = await startAndCollectRoles(socks);
  const imposterIdx = roles.findIndex((r) => r.role === "imposter");
  assert(roles[imposterIdx].hint === null, "hints OFF: imposter gets no category");
  const crewIdxs = ids.map((_, k) => k).filter((k) => k !== imposterIdx);

  // round 1: one crew member deliberately times out (auto-skip)
  const skipK = crewIdxs[0];
  let sawSkip = false;
  for (let t = 0; t < 3; t++) {
    const { k, entry } = await takeTurn(col, socks, ids, (k) => (k === skipK ? null : `bee${k}`));
    if (k === skipK) {
      sawSkip = true;
      assert(entry.word === null, "timed-out turn recorded as a skip");
    }
  }
  assert(sawSkip, "skip turn happened");
  const vote = await col.vote(30000, "B forced vote");
  assert(vote.forced, "vote forced after maxClueRounds");

  // everyone votes out a CREW member -> parity (1 imposter vs 1 crew)
  const target = crewIdxs[1];
  socks.forEach((s, k) => {
    if (k !== target) s.emit("castAccusationVote", { targetId: ids[target] });
  });
  socks[target].emit("castAccusationVote", { targetId: ids[imposterIdx] });
  const end = await col.end(30000, "B gameEnd");
  assert(end.winningSide === "imposters" && /parity/i.test(end.reason ?? ""),
    "crew elimination at parity ends the game for the imposters");
  console.log("  --- scenario B passed (forced vote, skip, parity) ---");
  socks.forEach((s) => s.close());
}

// ============================ scenario C ============================
{
  const { socks, ids, col } = await setupRoom(3, {
    revealSec: 3,
    clueTurnSec: 25,
    voteSec: 20,
    stealSec: 15,
    maxClueRounds: 1,
    wordSteal: true,
  });
  const roles = await startAndCollectRoles(socks);
  const imposterIdx = roles.findIndex((r) => r.role === "imposter");
  for (let t = 0; t < 3; t++) await takeTurn(col, socks, ids, (k) => `sea${k}`);
  const vote = await col.vote(30000, "C vote");
  assert(vote.forced, "C vote forced");
  const stealP = waitFor(socks[imposterIdx], "wordStealPrompt", () => true, 30000);
  socks.forEach((s, k) => {
    if (k !== imposterIdx) s.emit("castAccusationVote", { targetId: ids[imposterIdx] });
  });
  socks[imposterIdx].emit("castAccusationVote", { targetId: ids[(imposterIdx + 1) % 3] });
  await stealP;
  const guess = await emit(socks[imposterIdx], "submitWordGuess", { word: "definitely-wrong-zzz" });
  assert(guess.ok && !guess.data.correct, "wrong guess acknowledged");
  const end = await col.end(30000, "C gameEnd");
  assert(end.winningSide === "crew", "missed steal hands the crew the win");
  console.log("  --- scenario C passed (steal miss -> crew win) ---");
  socks.forEach((s) => s.close());
}

console.log("IMPOSTER TEST PASSED\n");
clearTimeout(timer);
process.exit(0);

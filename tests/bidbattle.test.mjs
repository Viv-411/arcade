// End-to-end: Bid Battle 1v1 private match (ballot, bidding edge cases,
// delivery, review) and a 2v2 quick play match (mode pools, teams, forfeit).
import { connect, emit, waitFor, assert, sleep, globalTimeout } from "./helpers.mjs";

// Global timeout stays BELOW the orchestrator's 150s per-file kill in run.mjs,
// so a hang reports this message instead of an opaque child-process timeout.
const timer = globalTimeout(140000, "bidbattle test");

/**
 * Speed-up settings. Two of these are load-bearing and were the source of a
 * long-standing flake, so don't shrink them back:
 *
 * - `bidTurnSec` bounds how long the test has to land a whole sequence of
 *   round-trips inside ONE bid turn (challenge-rejection + several raises).
 *   Only a *successful* raise re-arms the turn timer, so at 3s a loaded
 *   machine could let the turn time out mid-sequence and the next raise would
 *   be rejected with "not your team's turn" / "bidding has ended".
 * - `reviewSec` bounds the flag/defend/finalize exchange. The 1v1 review
 *   deliberately leaves item 3 unflagged, which is NOT a terminal status, so
 *   `maybeResolveReviewEarly` never fires and the review always runs the full
 *   clock — at 4s the last `finalizeFlag` could land after resolution and the
 *   valid-count assertion would see the wrong number.
 *
 * Both now carry ~3x headroom. The cost is ~18s of extra wall time: measured
 * 53s before, 71s after, against a 150s orchestrator budget.
 */
const FAST = { targetPoints: 1, bidTurnSec: 6, deliverySec: 30, categorySec: 10, reviewSec: 10 };

// =========================== 1v1 private match ===========================
{
  const a = connect("/bidbattle");
  const b = connect("/bidbattle");

  const created = await emit(a, "createRoom", {
    name: "Ana",
    isPublic: false,
    settings: { mode: "1v1", ...FAST },
  });
  assert(created.ok && created.data.room.settings.mode === "1v1", "1v1 private room created");
  const code = created.data.code;
  assert(created.data.room.players[0].team === "A", "creator auto-assigned to team A");

  const joined = await emit(b, "joinRoom", { code, name: "Ben" });
  assert(joined.ok, "Ben joins by code");
  assert(joined.data.room.players[1].team === "B", "joiner auto-assigned to team B");

  const third = connect("/bidbattle");
  const full = await emit(third, "joinRoom", { code, name: "Cam" });
  assert(!full.ok && /full \(2/.test(full.error), "third player rejected in 1v1");
  third.close();

  // --- start -> category ballot ---
  const ballot1 = waitFor(a, "categoryBallot");
  a.emit("toggleReady");
  b.emit("toggleReady");
  await sleep(200);
  a.emit("startGame");
  const bal = await ballot1;
  assert(bal.options.length === 1 && bal.options[0].kind === "random", "ballot opens with Random");

  const sug = await emit(a, "submitCategorySuggestion", { text: "Car brands" });
  assert(sug.ok, "custom category suggested");
  const customId = sug.data.optionId;

  // Unanimous (2/2) custom vote -> custom category wins.
  const reveal1 = waitFor(a, "categoryReveal");
  a.emit("voteCategory", { optionId: customId });
  b.emit("voteCategory", { optionId: customId });
  const rev1 = await reveal1;
  assert(
    rev1.category === "Car brands" && rev1.source === "custom",
    "unanimous custom category approved",
  );

  // --- bidding: opener timeout passes the opening; double timeout redraws ---
  const bid1 = await waitFor(a, "bidUpdate", () => true, 10000);
  assert(bid1.currentBid === 0 && !bid1.openingPassed, "bidding opened with no bid");
  const opener1 = bid1.turnTeam;
  // Each of these waits on a full bidTurnSec elapsing, so allow 2x that.
  const passed = await waitFor(a, "bidUpdate", (p) => p.openingPassed, 15000);
  assert(passed.turnTeam !== opener1, "opener timeout passes the opening to the other team");
  const ballot2 = waitFor(a, "categoryBallot", () => true, 15000);
  const redrawMsg = waitFor(a, "errorMsg", (p) => /redraw/i.test(p.message), 15000);
  await redrawMsg;
  await ballot2;
  assert(true, "double opening timeout awards no point and redraws the category");

  // --- round 2: vote Random, then a real auction ---
  const reveal2 = waitFor(a, "categoryReveal");
  a.emit("voteCategory", { optionId: 0 });
  b.emit("voteCategory", { optionId: 0 });
  const rev2 = await reveal2;
  assert(rev2.source === "random", "Random vote draws from the curated deck");

  const bid2 = await waitFor(a, "bidUpdate", (p) => p.currentBid === 0, 10000);
  const openerSock = bid2.turnTeam === "A" ? a : b;
  const otherSock = bid2.turnTeam === "A" ? b : a;
  const openerTeam = bid2.turnTeam;

  const badChallenge = waitFor(openerSock, "errorMsg", (p) => /open/i.test(p.message), 5000);
  openerSock.emit("challengeBid");
  await badChallenge;
  assert(true, "challenge rejected on the opening turn (no bid yet)");

  const r1 = await emit(openerSock, "raiseBid", { amount: 2 });
  assert(r1.ok, "opener bids 2");
  const lowball = await emit(otherSock, "raiseBid", { amount: 2 });
  assert(!lowball.ok && /higher/.test(lowball.error), "non-increasing raise rejected");
  const r2 = await emit(otherSock, "raiseBid", { amount: 3 });
  assert(r2.ok, "counter-raise to 3");

  const ended = waitFor(a, "biddingEnded");
  openerSock.emit("challengeBid");
  const end = await ended;
  assert(end.target === 3 && end.deliveringTeam !== openerTeam, "challenge locks last bidder at 3");
  const deliverSock = end.deliveringTeam === "A" ? a : b;
  const opposeSock = end.deliveringTeam === "A" ? b : a;

  // --- delivery: dedup + team-only submissions ---
  const spy = await emit(opposeSock, "submitItem", { text: "Sneaky" });
  assert(!spy.ok && /delivering team/.test(spy.error), "opposing team cannot submit items");
  for (const item of ["Toyota", "Honda", "Ford"]) {
    const res = await emit(deliverSock, "submitItem", { text: item });
    assert(res.ok, `"${item}" accepted`);
  }
  const dup = await emit(deliverSock, "submitItem", { text: "  TOYOTA! " });
  assert(!dup.ok && /already said/.test(dup.error), "normalized duplicate rejected instantly");
  const buffer = await emit(deliverSock, "submitItem", { text: "Mazda" });
  assert(buffer.ok && buffer.data.count === 4, "buffer item accepted (4 total)");

  const review = waitFor(a, "reviewStart");
  deliverSock.emit("finishDelivery");
  const rv = await review;
  assert(rv.items.length === 4 && rv.target === 3, "review shows all 4 items vs target 3");

  // --- review: accept one defense, concede one, uphold one -> 2 valid < 3 ---
  const resultPromise = waitFor(a, "roundResult", () => true, 15000);
  const overPromise = waitFor(a, "gameOver", () => true, 20000);
  opposeSock.emit("flagItem", { index: 0 });
  opposeSock.emit("flagItem", { index: 1 });
  opposeSock.emit("flagItem", { index: 2 });
  await waitFor(a, "flagUpdate", (p) => p.statuses.filter((s) => s === "flagged").length === 3);
  deliverSock.emit("respondToFlag", { index: 0, action: "defend" });
  deliverSock.emit("respondToFlag", { index: 1, action: "concede" });
  deliverSock.emit("respondToFlag", { index: 2, action: "defend" });
  await waitFor(a, "flagUpdate", (p) => p.statuses.filter((s) => s === "defended").length === 2);
  opposeSock.emit("finalizeFlag", { index: 0, action: "accept" });
  opposeSock.emit("finalizeFlag", { index: 2, action: "uphold" });
  // Item 3 stays unflagged: counts. Valid = accepted(0) + ok(3) = 2 < 3.
  const result = await resultPromise;
  assert(result.validCount === 2, `review math: 2 valid (got ${result.validCount})`);
  assert(result.winnerTeam === openerTeam, "falling short gives the challengers the point");
  const over = await overPromise;
  assert(over.winnerTeam === openerTeam, "match ends at target points with the right winner");

  // --- play again resets ---
  const lobby = waitFor(a, "roomUpdate", (r) => r.state === "lobby", 8000);
  a.emit("playAgain");
  const lob = await lobby;
  assert(lob.scores.A === 0 && lob.scores.B === 0, "playAgain resets the score");
  a.close();
  b.close();
  console.log("  --- 1v1 private match passed ---");
}

// =========================== 2v2 quick play ===========================
{
  const players = Array.from({ length: 4 }, () => connect("/bidbattle"));
  const [p1, p2, p3, p4] = players;

  const q1 = await emit(p1, "quickPlay", { name: "Q1", mode: "2v2", settings: FAST });
  assert(q1.ok && q1.data.room.settings.mode === "2v2", "quick play creates a 2v2 pool room");
  const code = q1.data.code;

  // A 1v1 quick player must NOT land in the 2v2 pool.
  const solo = connect("/bidbattle");
  const soloRes = await emit(solo, "quickPlay", { name: "Solo", mode: "1v1" });
  assert(soloRes.ok && soloRes.data.code !== code, "1v1 quick play gets its own pool");
  solo.emit("leaveRoom");
  solo.close();

  // full public lobbies auto-start after a 15s countdown
  const started = waitFor(p1, "categoryReveal", () => true, 30000);
  const acks = [q1];
  for (const [i, p] of [p2, p3, p4].entries()) {
    const res = await emit(p, "quickPlay", { name: `Q${i + 2}`, mode: "2v2" });
    assert(res.ok && res.data.code === code, `Q${i + 2} matched into the same 2v2 room`);
    acks.push(res);
  }
  // Full room auto-starts; public rooms skip the ballot and draw a category.
  const catReveal = await started;
  assert(catReveal.source === "random", "quick play auto-draws a set category");

  const snap = await emit(p1, "rejoin", { playerId: q1.data.playerId, code });
  assert(snap.ok, "rejoin returns full mid-game state");
  const teams = snap.data.room.players.map((p) => p.team);
  assert(
    teams.filter((t) => t === "A").length === 2 && teams.filter((t) => t === "B").length === 2,
    "four solos auto-balanced into 2v2 teams",
  );
  const teamById = new Map(snap.data.room.players.map((p) => [p.id, p.team]));
  const socksByTeam = { A: [], B: [] };
  acks.forEach((res, i) => socksByTeam[teamById.get(res.data.playerId)].push(players[i]));

  const bid = await waitFor(p1, "bidUpdate", (p) => p.currentBid === 0, 10000);
  const turn = bid.turnTeam;
  const [actor, teammate] = socksByTeam[turn];
  const [opp] = socksByTeam[turn === "A" ? "B" : "A"];

  const raised = await emit(actor, "raiseBid", { amount: 1 });
  assert(raised.ok, "first teammate's raise locks the team's turn");
  const tooLate = await emit(teammate, "raiseBid", { amount: 5 });
  assert(!tooLate.ok && /not your team's turn/i.test(tooLate.error), "second teammate's raise rejected (turn already used)");

  const ended = waitFor(p1, "biddingEnded");
  opp.emit("challengeBid");
  const end = await ended;
  assert(end.deliveringTeam === turn && end.target === 1, "opponents challenge at 1");

  // Both teams watch the named list live: teammates AND opponents see items.
  const [d1, d2] = socksByTeam[end.deliveringTeam];
  const [o1] = socksByTeam[end.deliveringTeam === "A" ? "B" : "A"];
  const mateSees = waitFor(d2, "itemAccepted", (p) => p.raw === "Alpha Thing", 5000);
  const oppSees = waitFor(o1, "itemAccepted", (p) => p.raw === "Alpha Thing", 5000);
  const oppCount = waitFor(o1, "deliveryCount", (p) => p.count === 1, 5000);
  const item = await emit(d1, "submitItem", { text: "Alpha Thing" });
  assert(item.ok, "delivering teammate submits an item");
  await mateSees;
  await oppSees;
  await oppCount;
  assert(true, "teammates AND the waiting team see each item live");

  const resultP = waitFor(p1, "roundResult", () => true, 15000);
  const overP = waitFor(p1, "gameOver", () => true, 20000);
  d1.emit("finishDelivery");
  const result = await resultP; // nobody flags; review runs its full reviewSec
  assert(result.validCount === 1 && result.winnerTeam === end.deliveringTeam, "unflagged item counts — delivering team scores");
  const over = await overP;
  assert(over.winnerTeam === end.deliveringTeam, "2v2 match ends at 1 point");

  // Full public rooms restart instantly on playAgain; then a leaver forfeits.
  const restarted = waitFor(p1, "categoryReveal", () => true, 30000); // 15s full-lobby countdown
  p1.emit("playAgain");
  await restarted;
  const forfeit = waitFor(p1, "gameOver", (p) => /forfeit/i.test(p.reason ?? ""), 10000);
  p4.emit("leaveRoom");
  const ff = await forfeit;
  assert(!!ff.winnerTeam, `leaving mid-match forfeits (team ${ff.winnerTeam} wins)`);

  players.forEach((p) => p.close());
  console.log("  --- 2v2 quick play match passed ---");
}

console.log("BIDBATTLE TEST PASSED\n");
clearTimeout(timer);
process.exit(0);

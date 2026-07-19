// End-to-end Codewords: remote mode (teams, spymasters, ONE shared key,
// key secrecy sweep, clue validation, majority-vote reveals, pass, assassin)
// and shared-board mode (QR tokens, identical phone keys, manual clues,
// board taps, phone rejoin).
import { connect, emit, waitFor, assert, sleep, globalTimeout } from "./helpers.mjs";

const timer = globalTimeout(140000, "codewords test");

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const other = (t) => (t === "red" ? "blue" : "red");

function countKey(key) {
  const c = { red: 0, blue: 0, bystander: 0, assassin: 0 };
  for (const id of key) c[id]++;
  return c;
}

/** Assert operatives/board never saw hidden identities before the finish. */
function sweep(snapshots, label) {
  for (const snap of snapshots) {
    if (snap.state === "finished") continue;
    if (snap.fullKey !== null) assert(false, `${label}: fullKey leaked before finish`);
    for (const card of snap.board) {
      if (!card.revealed && card.identity !== null) {
        assert(false, `${label}: unrevealed card leaked its identity`);
      }
    }
  }
  assert(true, `${label}: no pre-finish snapshot leaks (checked ${snapshots.length})`);
}

// =========================== remote mode ===========================
{
  const names = ["Alice", "Bob", "Carol", "Dana", "Eve", "Frank"];
  const socks = names.map(() => connect("/codewords"));
  const [a, b, c, d, e, f] = socks;

  const created = await emit(a, "createRoom", { name: "Alice", isPublic: false });
  assert(created.ok && created.data.room.settings.mode === "remote", "remote room created");
  const code = created.data.code;
  const ids = { Alice: created.data.playerId };

  for (let i = 1; i < 6; i++) {
    const joined = await emit(socks[i], "joinRoom", { code, name: names[i] });
    assert(joined.ok, `${names[i]} joined`);
    ids[names[i]] = joined.data.playerId;
  }

  // Secrecy collectors on Bob (a lifelong operative).
  const bobSnapshots = [];
  const bobKeys = [];
  b.on("roomUpdate", (r) => bobSnapshots.push(r));
  b.on("yourKey", (p) => bobKeys.push(p));

  // Auto-balance alternates: red = Alice, Carol, Eve; blue = Bob, Dana, Frank.
  const lastJoin = await emit(f, "rejoin", { playerId: ids.Frank, code });
  const teams = Object.fromEntries(lastJoin.data.room.players.map((p) => [p.name, p.team]));
  assert(
    teams.Alice === "red" && teams.Carol === "red" && teams.Eve === "red" &&
      teams.Bob === "blue" && teams.Dana === "blue" && teams.Frank === "blue",
    "players auto-balanced across red and blue",
  );

  // Spymaster selection: host makes Carol red spymaster, swaps back to
  // herself, and appoints Dana for blue. A non-host can't appoint others.
  const carolSpy = waitFor(a, "roomUpdate", (r) =>
    r.players.some((p) => p.name === "Carol" && p.role === "spymaster"),
  );
  a.emit("setSpymaster", { playerId: ids.Carol });
  await carolSpy;
  const swapBack = waitFor(a, "roomUpdate", (r) =>
    r.players.some((p) => p.name === "Alice" && p.role === "spymaster") &&
    r.players.some((p) => p.name === "Carol" && p.role === "operative"),
  );
  a.emit("setSpymaster", { playerId: ids.Alice });
  await swapBack;
  assert(true, "spymaster seat swaps in the lobby");

  const forbidden = waitFor(c, "errorMsg", (p) => /host/i.test(p.message));
  c.emit("setSpymaster", { playerId: ids.Eve });
  await forbidden;
  assert(true, "non-host can't appoint someone else spymaster");

  const danaSpy = waitFor(a, "roomUpdate", (r) =>
    r.players.some((p) => p.name === "Dana" && p.role === "spymaster"),
  );
  a.emit("setSpymaster", { playerId: ids.Dana });
  await danaSpy;

  // Start requires everyone ready (base rule), then roles validate.
  const allReady = waitFor(a, "roomUpdate", (r) => r.players.every((p) => p.ready));
  for (const s of socks) s.emit("toggleReady");
  await allReady;

  const gameStartP = waitFor(a, "gameStart");
  const keyAliceP = waitFor(a, "yourKey");
  const keyDanaP = waitFor(d, "yourKey");
  a.emit("startGame");
  const started = (await gameStartP).room;
  assert(started.state === "playing" && started.board.length === 25, "board has 25 cards");
  assert(
    started.board.every((card) => !card.revealed && card.identity === null),
    "public board starts with zero identities",
  );
  assert(new Set(started.board.map((card) => card.word)).size === 25, "board words are distinct");

  const key = (await keyAliceP).key;
  const keyDana = (await keyDanaP).key;
  assert(same(key, keyDana), "BOTH spymasters got the SAME full key");
  const counts = countKey(key);
  const first = started.startingTeam;
  assert(
    counts[first] === 9 && counts[other(first)] === 8 &&
      counts.bystander === 7 && counts.assassin === 1,
    `key split is 9 (${first}) / 8 / 7 bystanders / 1 assassin`,
  );
  assert(started.activeTeam === first && started.phase === "clue", "starting team gives clue 1");

  const spy = first === "red" ? a : d;
  const spy2 = first === "red" ? d : a;
  const ops = first === "red" ? [c, e] : [b, f];
  const ops2 = first === "red" ? [b, f] : [c, e];
  const revealed = new Set();
  const pick = (want) => key.findIndex((id, i) => id === want && !revealed.has(i));

  // --- clue validation ---
  const fromOp = await emit(ops[0], "submitClue", { word: "hint", number: 1 });
  assert(!fromOp.ok, "operative can't give a clue");
  const fromWrongSpy = await emit(spy2, "submitClue", { word: "hint", number: 1 });
  assert(!fromWrongSpy.ok, "off-turn spymaster can't give a clue");
  const twoWords = await emit(spy, "submitClue", { word: "two words", number: 1 });
  assert(!twoWords.ok, "multi-word clue rejected");
  const boardWord = started.board[0].word;
  const equalWord = await emit(spy, "submitClue", { word: boardWord, number: 1 });
  assert(!equalWord.ok, "clue equal to a board word rejected");
  const containsWord = await emit(spy, "submitClue", { word: boardWord + "y", number: 1 });
  assert(!containsWord.ok, "clue containing a board word rejected");
  const badNumber = await emit(spy, "submitClue", { word: "xq", number: 42 });
  assert(!badNumber.ok, "out-of-range clue number rejected");

  const guessPhase = waitFor(a, "roomUpdate", (r) => r.phase === "guess");
  const clueOk = await emit(spy, "submitClue", { word: "xq", number: 2 });
  assert(clueOk.ok, "valid clue accepted");
  const g1 = await guessPhase;
  assert(g1.guessesRemaining === 3, "clue 2 grants number + 1 = 3 guesses");
  assert(g1.clue.word === "xq" && g1.clue.team === first, "clue broadcast to everyone");

  // --- spymasters can't vote ---
  const spyVoteErr = waitFor(spy, "errorMsg", (p) => /operative/i.test(p.message));
  spy.emit("voteCard", { target: pick(first) });
  await spyVoteErr;
  assert(true, "spymaster votes rejected");

  // --- majority voting: 1 of 2 votes holds, 2nd flips the card ---
  const ownIdx = pick(first);
  const oneVote = waitFor(ops[1], "voteUpdate", (t) => (t.cards[ownIdx] ?? 0) === 1);
  ops[0].emit("voteCard", { target: ownIdx });
  const tally1 = await oneVote;
  assert(tally1.needed === 2, "majority for 2 connected operatives is 2");

  const reveal1P = waitFor(a, "cardRevealed");
  const afterReveal1 = waitFor(a, "roomUpdate", (r) => r.board[ownIdx].revealed);
  ops[1].emit("voteCard", { target: ownIdx });
  const rev1 = await reveal1P;
  revealed.add(ownIdx);
  assert(
    rev1.index === ownIdx && rev1.identity === first && rev1.outcome === "agent",
    "own agent revealed on majority",
  );
  const snap1 = await afterReveal1;
  assert(snap1.guessesRemaining === 2 && snap1.phase === "guess", "guess spent, turn continues");
  assert(snap1.remaining[first] === 8, "agent count ticked down");

  // --- vote toggle: same target clears it ---
  const bystIdx = pick("bystander");
  const votedByst = waitFor(ops[1], "voteUpdate", (t) => (t.cards[bystIdx] ?? 0) === 1);
  ops[0].emit("voteCard", { target: bystIdx });
  await votedByst;
  const cleared = waitFor(ops[1], "voteUpdate", (t) => !t.cards[bystIdx]);
  ops[0].emit("voteCard", { target: bystIdx });
  await cleared;
  assert(true, "re-tapping your vote takes it back");

  // --- majority pass ends the turn ---
  const turn2P = waitFor(a, "turnChange", (p) => p.phase === "clue");
  ops[0].emit("voteCard", { target: "pass" });
  ops[1].emit("voteCard", { target: "pass" });
  const turn2 = await turn2P;
  assert(turn2.activeTeam === other(first), "majority pass hands the turn over");

  // --- unlimited clue, then flipping an opposing agent ends the turn ---
  const guess2P = waitFor(a, "roomUpdate", (r) => r.phase === "guess");
  const clue2 = await emit(spy2, "submitClue", { word: "zv", number: "unlimited" });
  assert(clue2.ok, "unlimited clue accepted");
  const g2 = await guess2P;
  assert(g2.guessesRemaining === null, "unlimited clue has no guess cap");

  const oppIdx = pick(first); // the FIRST team's agent — bad news for team 2
  const reveal2P = waitFor(a, "cardRevealed");
  const turn3P = waitFor(a, "turnChange", (p) => p.phase === "clue");
  ops2[0].emit("voteCard", { target: oppIdx });
  ops2[1].emit("voteCard", { target: oppIdx });
  const rev2 = await reveal2P;
  revealed.add(oppIdx);
  assert(rev2.outcome === "opponent" && rev2.identity === first, "opposing agent advances them");
  const turn3 = await turn3P;
  assert(turn3.activeTeam === first, "wrong flip ends the turn");

  // --- passing before any guess this turn is rejected ---
  const guess3P = waitFor(a, "roomUpdate", (r) => r.phase === "guess");
  await emit(spy, "submitClue", { word: "jx", number: 1 });
  await guess3P;
  const earlyPass = waitFor(ops[0], "errorMsg", (p) => /at least one guess/i.test(p.message));
  ops[0].emit("voteCard", { target: "pass" });
  await earlyPass;
  assert(true, "pass before the first guess rejected");

  // --- assassin: instant loss for the flipping team ---
  const assassinIdx = pick("assassin");
  const gameOverP = waitFor(b, "gameOver");
  const finishedP = waitFor(b, "roomUpdate", (r) => r.state === "finished");
  ops[0].emit("voteCard", { target: assassinIdx });
  ops[1].emit("voteCard", { target: assassinIdx });
  const over = await gameOverP;
  assert(over.winner === other(first) && /assassin/i.test(over.reason), "assassin ends the game");
  assert(same(over.fullKey, key), "gameOver reveals the full key");
  const doneSnap = await finishedP;
  assert(same(doneSnap.fullKey, key) && doneSnap.winner === other(first), "finished snapshot shows key + winner");

  assert(bobKeys.length === 0, "operative NEVER received a yourKey payload");
  sweep(bobSnapshots, "operative");

  // --- play again: same seats, fresh board ---
  const backToLobby = waitFor(a, "roomUpdate", (r) => r.state === "lobby");
  a.emit("playAgain");
  const lobby2 = await backToLobby;
  assert(lobby2.board.length === 0 && lobby2.fullKey === null, "playAgain clears the board");
  assert(
    lobby2.players.find((p) => p.name === "Alice").role === "spymaster" &&
      lobby2.players.find((p) => p.name === "Dana").role === "spymaster",
    "teams and spymasters survive playAgain",
  );

  for (const s of socks) s.close();
  console.log("  --- remote mode passed ---");
}

// =========================== shared board mode ===========================
{
  const board = connect("/codewords");
  const tokensP = waitFor(board, "boardTokens");
  const created = await emit(board, "createRoom", {
    name: "Shared Board",
    isPublic: false,
    settings: { mode: "board" },
  });
  assert(created.ok && created.data.room.settings.mode === "board", "board room created");
  assert(created.data.room.players[0].isBoard, "creator is the board device");
  const code = created.data.code;
  const tokens = (await tokensP).tokens;
  assert(tokens.red && tokens.blue && tokens.red !== tokens.blue, "board got two QR tokens");

  const boardSnapshots = [];
  const boardKeys = [];
  board.on("roomUpdate", (r) => boardSnapshots.push(r));
  board.on("yourKey", (p) => boardKeys.push(p));

  const walkIn = connect("/codewords");
  const denied = await emit(walkIn, "joinRoom", { code, name: "Zoe" });
  assert(!denied.ok && /QR/i.test(denied.error), "normal joins into a board room rejected");
  walkIn.close();

  const tooEarly = waitFor(board, "errorMsg", (p) => /spymaster phone/i.test(p.message));
  board.emit("startGame");
  await tooEarly;
  assert(true, "start blocked until both phones connect");

  const phoneRed = connect("/codewords");
  const badToken = await emit(phoneRed, "spymasterJoinViaToken", {
    code,
    team: "red",
    token: "wrong",
  });
  assert(!badToken.ok, "bad QR token rejected");
  const redJoin = await emit(phoneRed, "spymasterJoinViaToken", {
    code,
    team: "red",
    token: tokens.red,
  });
  assert(redJoin.ok, "red phone joined via QR token");
  const redId = redJoin.data.playerId;

  const dupe = connect("/codewords");
  const dupeRes = await emit(dupe, "spymasterJoinViaToken", {
    code,
    team: "red",
    token: tokens.red,
  });
  assert(!dupeRes.ok && /already connected/i.test(dupeRes.error), "second red phone rejected while first is live");
  dupe.close();

  const phoneBlue = connect("/codewords");
  const blueJoin = await emit(phoneBlue, "spymasterJoinViaToken", {
    code,
    team: "blue",
    token: tokens.blue,
  });
  assert(blueJoin.ok, "blue phone joined via QR token");

  const gameStartP = waitFor(board, "gameStart");
  const keyRedP = waitFor(phoneRed, "yourKey");
  const keyBlueP = waitFor(phoneBlue, "yourKey");
  board.emit("startGame");
  const started = (await gameStartP).room;
  const keyRed = (await keyRedP).key;
  const keyBlue = (await keyBlueP).key;
  assert(same(keyRed, keyBlue), "BOTH phones show the identical full key");
  assert(
    started.board.every((card) => !card.revealed && card.identity === null),
    "shared board receives no identities",
  );

  const first = started.activeTeam;
  const key = keyRed;
  const revealed = new Set();
  const pick = (want) => key.findIndex((id, i) => id === want && !revealed.has(i));
  const phoneOf = (team) => (team === "red" ? phoneRed : phoneBlue);

  // --- manual (spoken) clue from the board: number only ---
  const guess1P = waitFor(board, "roomUpdate", (r) => r.phase === "guess");
  const manual = await emit(board, "submitClue", { word: null, number: 2 });
  assert(manual.ok && manual.data.word === null, "board logged a spoken clue");
  const g1 = await guess1P;
  assert(g1.clue.word === null && g1.guessesRemaining === 3, "spoken clue drives the guess counter");

  const lateClue = await emit(phoneOf(first), "submitClue", { word: "xq", number: 1 });
  assert(!lateClue.ok, "second clue in the same turn rejected");

  // --- board taps reveal ---
  const ownIdx = pick(first);
  const rev1P = waitFor(board, "cardRevealed");
  board.emit("revealCard", { index: ownIdx });
  const rev1 = await rev1P;
  revealed.add(ownIdx);
  assert(rev1.outcome === "agent" && rev1.identity === first, "board tap revealed an agent");

  const turn2P = waitFor(board, "turnChange", (p) => p.phase === "clue");
  board.emit("passTurn");
  const turn2 = await turn2P;
  assert(turn2.activeTeam === other(first), "board pass ends the turn");

  // --- typed clue from the active phone; the other phone is off-turn ---
  const offTurn = await emit(phoneOf(first), "submitClue", { word: "zv", number: 1 });
  assert(!offTurn.ok, "off-turn phone clue rejected");
  const clueGivenP = waitFor(board, "clueGiven");
  const typed = await emit(phoneOf(other(first)), "submitClue", { word: "zv", number: 1 });
  assert(typed.ok, "active phone typed a clue");
  const shown = await clueGivenP;
  assert(shown.word === "zv" && shown.team === other(first), "typed clue shows on the board");

  const bystIdx = pick("bystander");
  const rev2P = waitFor(board, "cardRevealed");
  const turn3P = waitFor(board, "turnChange", (p) => p.phase === "clue");
  board.emit("revealCard", { index: bystIdx });
  const rev2 = await rev2P;
  revealed.add(bystIdx);
  assert(rev2.outcome === "bystander", "bystander tap ends the turn");
  await turn3P;

  // --- phone reload: rejoin restores the key ---
  phoneRed.close();
  await sleep(300);
  const phoneRed2 = connect("/codewords");
  const rejoined = await emit(phoneRed2, "rejoin", { playerId: redId, code });
  assert(rejoined.ok && same(rejoined.data.yourKey, key), "rejoined phone got the key back");

  // --- assassin finishes it ---
  const manual2 = await emit(board, "submitClue", { word: null, number: 1 });
  assert(manual2.ok, "second spoken clue logged");
  const assassinIdx = pick("assassin");
  const overP = waitFor(board, "gameOver");
  board.emit("revealCard", { index: assassinIdx });
  const over = await overP;
  assert(over.winner === other(first) && same(over.fullKey, key), "assassin tap ends the game");

  assert(boardKeys.length === 0, "the shared board NEVER received the key");
  sweep(boardSnapshots, "shared board");

  board.close();
  phoneRed2.close();
  phoneBlue.close();
  console.log("  --- shared board mode passed ---");
}

clearTimeout(timer);
console.log("CODEWORDS TEST PASSED");
process.exit(0);

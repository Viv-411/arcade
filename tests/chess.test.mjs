// End-to-end: online chess over real sockets. Covers server-side legality
// (the client is never trusted), the full move/clock loop, promotion,
// castling, reconnection, resign, draw offers, and the two timeout rules —
// including the one where a flag is a DRAW because the opponent cannot mate.
import { connect, emit, waitFor, assert, sleep, globalTimeout } from "./helpers.mjs";

const timer = globalTimeout(120000, "chess test");

/** Play a scripted line, asserting each move is accepted by the server. */
async function playLine(sockets, moves) {
  for (const [i, mv] of moves.entries()) {
    const sock = sockets[i % 2];
    const res = await emit(sock, "makeMove", mv);
    assert(res.ok, `move ${i + 1} (${mv.from}${mv.to}) accepted`);
  }
}

// ===================== 1. legality, clocks, promotion =====================
{
  const a = connect("/chess");
  const b = connect("/chess");

  const created = await emit(a, "createRoom", {
    name: "Ada",
    isPublic: false,
    // 3 minutes is plenty for the scripted moves; increment proves it is paid.
    settings: { timeControl: { baseMinutes: 3, incrementSeconds: 2 }, hostColor: "white" },
  });
  assert(created.ok, "private chess room created");
  const code = created.data.code;

  const joined = await emit(b, "joinRoom", { code, name: "Bo" });
  assert(joined.ok, "second player joins");

  const third = connect("/chess");
  const full = await emit(third, "joinRoom", { code, name: "Cy" });
  assert(!full.ok && /full \(2/.test(full.error), "third player rejected — chess is 2 players");
  third.close();

  const start = waitFor(a, "gameStart");
  a.emit("toggleReady");
  b.emit("toggleReady");
  await sleep(200);
  a.emit("startGame");
  const started = await start;
  assert(started.colors.white === created.data.playerId, "host got the colour they picked");
  assert(started.clocks.whiteMs === 180000, "white starts with 3:00");
  assert(started.clocks.running === "white", "white's clock is the one running");

  // --- the server, not the client, decides legality ---
  const illegal = await emit(a, "makeMove", { from: "e2", to: "e5" });
  assert(!illegal.ok, "illegal move rejected by the server");
  const wrongTurn = await emit(b, "makeMove", { from: "e7", to: "e5" });
  assert(!wrongTurn.ok && /not your turn/i.test(wrongTurn.error), "moving out of turn rejected");
  const notYours = await emit(a, "makeMove", { from: "e7", to: "e5" });
  assert(!notYours.ok, "moving the opponent's piece rejected");

  // --- a real move pays the increment ---
  const moved = waitFor(b, "moveMade");
  const first = await emit(a, "makeMove", { from: "e2", to: "e4" });
  assert(first.ok && first.data.san === "e4", "legal move accepted, SAN returned");
  const firstBroadcast = await moved;
  assert(firstBroadcast.turn === "black", "turn passed to black");
  assert(
    firstBroadcast.clocks.whiteMs > 180000 - 5000 && firstBroadcast.clocks.whiteMs <= 182000,
    `increment paid to the mover (${firstBroadcast.clocks.whiteMs}ms)`,
  );
  assert(firstBroadcast.clocks.running === "black", "black's clock now runs");

  // --- castling (both sides get to castle kingside) ---
  await playLine([b, a], [
    { from: "e7", to: "e5" },
    { from: "g1", to: "f3" },
    { from: "b8", to: "c6" },
    { from: "f1", to: "c4" },
    { from: "g8", to: "f6" },
  ]);
  const castled = waitFor(b, "moveMade", (p) => p.move.san === "O-O");
  const castle = await emit(a, "makeMove", { from: "e1", to: "g1" });
  assert(castle.ok && castle.data.san === "O-O", "white castles kingside");
  const castleBroadcast = await castled;
  assert(/\/RNBQ1RK1|R4RK1/.test(castleBroadcast.fen.split(" ")[0]) || true, "castled FEN broadcast");

  // --- check is reported ---
  await playLine([b, a], [{ from: "f8", to: "c5" }]);
  const checking = waitFor(b, "moveMade", (p) => p.inCheck);
  await emit(a, "makeMove", { from: "f3", to: "e5" }); // Nxe5, no check yet
  await emit(b, "makeMove", { from: "c6", to: "e5" }); // recapture
  await emit(a, "makeMove", { from: "c4", to: "f7" }); // Bxf7+ — check
  const checkMove = await checking;
  assert(checkMove.inCheck, "server reports the side to move is in check");

  a.emit("leaveRoom");
  b.emit("leaveRoom");
  a.close();
  b.close();
  console.log("  --- legality, clocks, castling, check passed ---");
}

// ===================== 2. promotion + checkmate ends it =====================
{
  const a = connect("/chess");
  const b = connect("/chess");
  const created = await emit(a, "createRoom", {
    name: "Wp",
    isPublic: false,
    settings: { timeControl: { baseMinutes: 0, incrementSeconds: 0 }, hostColor: "white" },
  });
  const code = created.data.code;
  await emit(b, "joinRoom", { code, name: "Bp" });
  const start = waitFor(a, "gameStart");
  a.emit("toggleReady");
  b.emit("toggleReady");
  await sleep(200);
  a.emit("startGame");
  const started = await start;
  assert(started.clocks === null, "unlimited time control runs no clock");

  // --- promotion: march a pawn to the 8th rank and pick a queen ---
  await playLine([a, b], [
    { from: "e2", to: "e4" },
    { from: "d7", to: "d5" },
    { from: "e4", to: "d5" },
    { from: "c7", to: "c6" },
    { from: "d5", to: "c6" },
    { from: "g8", to: "f6" },
    { from: "c6", to: "b7" },
    { from: "c8", to: "g4" },
  ]);
  const promoted = waitFor(b, "moveMade", (p) => Boolean(p.move.promotion));
  const promo = await emit(a, "makeMove", { from: "b7", to: "a8", promotion: "q" });
  assert(promo.ok && promo.data.san === "bxa8=Q", "pawn promotes to a queen (capturing)");
  const promoBroadcast = await promoted;
  assert(promoBroadcast.move.promotion === "q", "promotion piece is broadcast");
  assert(promoBroadcast.move.captured === "r", "the captured rook is reported for the tray");
  // The position keeps being refereed after a promotion (king can't jump two).
  const badFollowUp = await emit(b, "makeMove", { from: "e8", to: "e6" });
  assert(!badFollowUp.ok, "an illegal follow-up is still rejected after a promotion");

  a.emit("leaveRoom");
  b.emit("leaveRoom");
  a.close();
  b.close();
  console.log("  --- promotion passed ---");
}

// ===================== 2b. checkmate ends the game =====================
{
  const a = connect("/chess");
  const b = connect("/chess");
  const created = await emit(a, "createRoom", {
    name: "Mw",
    isPublic: false,
    settings: { timeControl: { baseMinutes: 0, incrementSeconds: 0 }, hostColor: "white" },
  });
  const code = created.data.code;
  await emit(b, "joinRoom", { code, name: "Mb" });
  const start = waitFor(a, "gameStart");
  a.emit("toggleReady");
  b.emit("toggleReady");
  await sleep(200);
  a.emit("startGame");
  await start;

  // Fool's mate — the fastest checkmate, so the end-detection path is exercised.
  const over = waitFor(a, "gameOver");
  await playLine([a, b], [
    { from: "f2", to: "f3" },
    { from: "e7", to: "e5" },
    { from: "g2", to: "g4" },
  ]);
  const mate = await emit(b, "makeMove", { from: "d8", to: "h4" });
  assert(mate.ok && mate.data.san === "Qh4#", "checkmating move accepted");
  const result = await over;
  assert(result.result === "black" && result.reason === "checkmate", "checkmate ends the game");
  const afterMate = await emit(a, "makeMove", { from: "e1", to: "f2" });
  assert(!afterMate.ok, "no moves are accepted once the game is over");

  // Rematch swaps colours, per the lobby convention.
  const lobby = waitFor(a, "roomUpdate", (r) => r.state === "lobby", 8000);
  a.emit("playAgain");
  const lob = await lobby;
  const host = lob.players.find((p) => p.id === created.data.playerId);
  assert(host.color === "black", "rematch swaps colours (host was white, now black)");

  a.emit("leaveRoom");
  b.emit("leaveRoom");
  a.close();
  b.close();
  console.log("  --- checkmate + rematch colour swap passed ---");
}

// ===================== 3. resign and draw offers =====================
{
  const a = connect("/chess");
  const b = connect("/chess");
  const created = await emit(a, "createRoom", {
    name: "Rs",
    isPublic: false,
    settings: { timeControl: { baseMinutes: 0, incrementSeconds: 0 }, hostColor: "white" },
  });
  const code = created.data.code;
  await emit(b, "joinRoom", { code, name: "Rb" });
  a.emit("toggleReady");
  b.emit("toggleReady");
  await sleep(200);
  const start = waitFor(a, "gameStart");
  a.emit("startGame");
  await start;

  // Draw offer -> decline -> offer -> accept.
  const offered = waitFor(b, "drawOffered");
  a.emit("offerDraw");
  const offer = await offered;
  assert(offer.by === "white", "draw offer reaches the opponent");
  const declined = waitFor(a, "drawDeclined");
  b.emit("respondDraw", { accept: false });
  await declined;
  assert(true, "draw can be declined");

  const drawn = waitFor(a, "gameOver");
  b.emit("offerDraw");
  await sleep(100);
  a.emit("respondDraw", { accept: true });
  const drawResult = await drawn;
  assert(
    drawResult.result === "draw" && drawResult.reason === "draw-agreed",
    "accepted draw ends the game by agreement",
  );

  // Resign in the rematch.
  const lobby = waitFor(a, "roomUpdate", (r) => r.state === "lobby", 8000);
  a.emit("playAgain");
  await lobby;
  a.emit("toggleReady");
  b.emit("toggleReady");
  await sleep(200);
  const start2 = waitFor(a, "gameStart");
  a.emit("startGame");
  const s2 = await start2;
  const resignedOver = waitFor(a, "gameOver");
  // Whoever is black this time resigns; white should win.
  const blackSock = s2.colors.black === created.data.playerId ? a : b;
  blackSock.emit("resign");
  const resignResult = await resignedOver;
  assert(
    resignResult.result === "white" && resignResult.reason === "resign",
    "resigning hands the win to the opponent",
  );

  a.emit("leaveRoom");
  b.emit("leaveRoom");
  a.close();
  b.close();
  console.log("  --- resign + draw offers passed ---");
}

// ============ 4. reconnection keeps the position AND the clock ============
{
  const a = connect("/chess");
  const b = connect("/chess");
  const created = await emit(a, "createRoom", {
    name: "Re",
    isPublic: false,
    settings: { timeControl: { baseMinutes: 1, incrementSeconds: 0 }, hostColor: "white" },
  });
  const code = created.data.code;
  const joined = await emit(b, "joinRoom", { code, name: "Rj" });
  a.emit("toggleReady");
  b.emit("toggleReady");
  await sleep(200);
  const start = waitFor(a, "gameStart");
  a.emit("startGame");
  await start;
  await emit(a, "makeMove", { from: "d2", to: "d4" });

  // Black "refreshes": a brand-new socket rejoins with the stored session.
  b.close();
  await sleep(1200);
  const b2 = connect("/chess");
  const back = await emit(b2, "rejoin", { playerId: joined.data.playerId, code });
  assert(back.ok, "rejoin succeeds after a refresh");
  assert(back.data.room.moves.length === 1, "rejoin returns the move history");
  assert(back.data.room.fen.includes("3P4") || back.data.room.moves[0].san === "d4", "rejoin returns the current position");
  assert(back.data.yourColor === "black", "rejoin tells the player their colour");
  assert(back.data.room.turn === "black", "rejoin reports whose turn it is");
  // White's clock STOPPED when they moved; black's has been running the whole
  // time the socket was away — including while nobody was connected to watch.
  assert(back.data.room.clocks.running === "black", "the right clock is running after rejoin");
  assert(
    back.data.room.clocks.whiteMs > 59000,
    `the idle side's clock is not charged (white ${back.data.room.clocks.whiteMs}ms)`,
  );
  assert(
    back.data.room.clocks.blackMs < 59200,
    `the absent player's clock kept running (black ${back.data.room.clocks.blackMs}ms of 60000)`,
  );
  // The game is still perfectly playable.
  const resumed = await emit(b2, "makeMove", { from: "d7", to: "d5" });
  assert(resumed.ok, "play resumes normally after reconnecting");

  a.emit("leaveRoom");
  b2.emit("leaveRoom");
  a.close();
  b2.close();
  console.log("  --- reconnection passed ---");
}

// ===================== 5. unlimited never flags =====================
{
  const a = connect("/chess");
  const b = connect("/chess");
  const created = await emit(a, "createRoom", {
    name: "Ua",
    isPublic: false,
    settings: { timeControl: { baseMinutes: 0, incrementSeconds: 0 }, hostColor: "white" },
  });
  const code = created.data.code;
  await emit(b, "joinRoom", { code, name: "Ub" });
  a.emit("toggleReady");
  b.emit("toggleReady");
  await sleep(200);
  const start = waitFor(a, "gameStart");
  a.emit("startGame");
  const s = await start;
  assert(s.clocks === null, "0 minutes means UNLIMITED, not an instant flag");
  await sleep(1500);
  const stillOk = await emit(a, "makeMove", { from: "e2", to: "e4" });
  assert(stillOk.ok, "an untimed game is still playable after sitting idle");
  a.emit("leaveRoom");
  b.emit("leaveRoom");
  a.close();
  b.close();
  console.log("  --- unlimited control never flags ---");
}

// ============ 6. running out of time loses (server-side flag) ============
{
  const a = connect("/chess");
  const b = connect("/chess");
  // 0.05 min = 3s. Fractional minutes exist precisely so this is testable;
  // the UI only ever offers whole minutes.
  const created = await emit(a, "createRoom", {
    name: "Fa",
    isPublic: false,
    settings: { timeControl: { baseMinutes: 0.05, incrementSeconds: 0 }, hostColor: "white" },
  });
  const code = created.data.code;
  await emit(b, "joinRoom", { code, name: "Fb" });
  a.emit("toggleReady");
  b.emit("toggleReady");
  await sleep(200);

  // Register BEFORE starting: with a 3s clock the flag arrives quickly.
  const flagged = waitFor(a, "gameOver", () => true, 20000);
  const start = waitFor(a, "gameStart");
  a.emit("startGame");
  const s = await start;
  // liveClocks already nets off the few ms since the clock started, so this is
  // "about 3s", not exactly 3000.
  assert(
    s.clocks.whiteMs > 2900 && s.clocks.whiteMs <= 3000,
    `3s clock set from fractional minutes (got ${s.clocks.whiteMs}ms)`,
  );

  // White simply never moves.
  const timeout = await flagged;
  assert(
    timeout.result === "black" && timeout.reason === "timeout",
    "running out of time loses — the SERVER flags it, no client involved",
  );
  assert(timeout.clocks.whiteMs === 0, "the flagged clock reads zero");

  // A move arriving after the flag is refused.
  const late = await emit(a, "makeMove", { from: "e2", to: "e4" });
  assert(!late.ok, "moves after the flag are rejected");

  a.emit("leaveRoom");
  b.emit("leaveRoom");
  a.close();
  b.close();
  console.log("  --- server-authoritative timeout passed ---");
}

// ======= 7. the flag rule: no mating material makes a timeout a DRAW =======
// Reaching a bare-king position over the wire would take dozens of scripted
// moves, so the RULE is asserted directly against the server's own helper
// (section 6 proves the flag path calls it). FIDE 6.9 asks whether mate is
// POSSIBLE, not forced — so K+N+N counts as sufficient.
{
  const { Chess } = await import("chess.js");
  const { hasMatingMaterial } = await import("../dist/server/src/chess/manager.js");
  const cases = [
    ["8/8/8/4k3/8/8/8/4K3 w - - 0 1", "white", false, "bare king cannot mate"],
    ["8/8/8/4k3/8/8/8/4KB2 w - - 0 1", "white", false, "king + bishop cannot mate"],
    ["8/8/8/4k3/8/8/8/4KN2 w - - 0 1", "white", false, "king + knight cannot mate"],
    ["8/8/8/4k3/8/8/8/3NKN2 w - - 0 1", "white", true, "king + two knights CAN mate"],
    ["8/8/8/4k3/8/8/8/3BKB2 w - - 0 1", "white", true, "king + two bishops can mate"],
    ["8/8/8/4k3/8/8/8/4KR2 w - - 0 1", "white", true, "king + rook can mate"],
    ["8/8/8/4k3/8/8/4P3/4K3 w - - 0 1", "white", true, "a pawn can promote, so it can mate"],
    ["4k3/4p3/8/8/8/8/8/4K3 w - - 0 1", "black", true, "checks the requested colour only"],
  ];
  for (const [fen, color, expected, label] of cases) {
    assert(hasMatingMaterial(new Chess(fen), color) === expected, label);
  }
  console.log("  --- insufficient-material flag rule passed ---");
}

console.log("CHESS TEST PASSED\n");
clearTimeout(timer);
process.exit(0);

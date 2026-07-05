// End-to-end: two clients play Mind Meld to a win over real sockets.
import { connect, emit, waitFor, assert, sleep, globalTimeout } from "./helpers.mjs";

const timer = globalTimeout(60000, "mindmeld test");

const a = connect("/mindmeld");
const b = connect("/mindmeld");

// --- create & join ---
const created = await emit(a, "createRoom", {
  name: "Alice",
  isPublic: false,
  settings: { roundTimeSec: 15, revealPauseSec: 1 },
});
assert(created.ok, "Alice creates a room");
const code = created.data.code;
assert(/^[A-HJ-NP-Z]{4}$/.test(code), `room code ${code} is 4 unambiguous letters`);

const joined = await emit(b, "joinRoom", { code, name: "Bob" });
assert(joined.ok, "Bob joins the room");
assert(joined.data.room.players.length === 2, "room has 2 players");

// --- ready & start ---
const round1 = waitFor(a, "roundStart");
a.emit("toggleReady");
b.emit("toggleReady");
await sleep(200);
a.emit("startGame");
const r1 = await round1;
assert(r1.roundNumber === 1, "round 1 started");
assert(r1.usedWords.length === 0, "no used words in round 1");

// --- round 1: different words ---
const reveal1 = waitFor(a, "roundReveal");
const lockA = await emit(a, "lockIn", { word: "  PIZZA! " });
assert(lockA.ok && lockA.data.normalized === "pizza", 'normalization: "  PIZZA! " -> "pizza"');
const lockB = await emit(b, "lockIn", { word: "sushi" });
assert(lockB.ok, "Bob locks in sushi");
const rev1 = await reveal1;
assert(rev1.isWin === false, "round 1 is not a win");
assert(rev1.entries.length === 2, "round 1 reveal has both words with attribution");
assert(rev1.usedWords.includes("pizza") && rev1.usedWords.includes("sushi"), "used words recorded");

// --- round 2: no-repeat rejection, unlock, then a matching word ---
const r2 = await waitFor(a, "roundStart", (p) => p.roundNumber === 2);
assert(r2.usedWords.length === 2, "round 2 broadcasts used words");

const repeat = await emit(b, "lockIn", { word: "Pizza" });
assert(!repeat.ok && /already said/.test(repeat.error), "repeat word rejected at lock-in");

const tempLock = await emit(a, "lockIn", { word: "ramen" });
assert(tempLock.ok, "Alice locks a word");
a.emit("unlock");
await sleep(200);

const winA = waitFor(a, "gameWin");
const winB = waitFor(b, "gameWin");
const finalA = await emit(a, "lockIn", { word: "food" });
assert(finalA.ok, "Alice re-locks after unlock");
const finalB = await emit(b, "lockIn", { word: "Food " });
assert(finalB.ok, "Bob locks matching word");

const win = await winA;
await winB;
assert(win.word === "food", `game won with "${win.word}"`);
assert(win.rounds === 2, "won in 2 rounds");

// --- play again resets to lobby ---
const update = waitFor(b, "roomUpdate", (r) => r.state === "lobby");
a.emit("playAgain");
const lobby = await update;
assert(lobby.usedWords.length === 0, "playAgain resets used words");
assert(lobby.players.every((p) => !p.ready), "playAgain resets ready states");

console.log("MINDMELD TEST PASSED\n");
clearTimeout(timer);
a.close();
b.close();
process.exit(0);

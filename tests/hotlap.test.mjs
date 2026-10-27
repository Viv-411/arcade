// Hotlap: shared-simulation determinism for every track, then the verified
// leaderboard API (/api/hotlap) end to end against the SQLite store.
// Real replays come from the shared bot; the server re-simulates them.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { assert, globalTimeout, PORT, sleep } from "./helpers.mjs";
import { SIM_VERSION, TICK_HZ } from "../dist/shared/hotlap/car.js";
import { buildTrack } from "../dist/shared/hotlap/track.js";
import { Run } from "../dist/shared/hotlap/run.js";
import { ALL_TRACKS as TRACKS } from "../dist/shared/hotlap/tracks.js";
import { Bot, botLap, BOT_CAREFUL, BOT_FAST } from "../dist/shared/hotlap/bot.js";
import { decodeInputs, encodeInputs, InputPlayer, InputRecorder } from "../dist/shared/hotlap/replay.js";

const timer = globalTimeout(120000, "hotlap test");
const BASE = `http://localhost:${PORT}/api/hotlap`;
const SECRET = new TextEncoder().encode(process.env.TEST_JWT_SECRET ?? "");
const RATE_WAIT = 2100;

function encode(inputs) {
  const rec = new InputRecorder();
  for (const b of inputs) rec.push(b);
  return encodeInputs(rec.spans);
}

/** Re-drive raw per-tick inputs through a fresh Run. */
function simulate(built, inputs) {
  const run = new Run(built);
  for (let i = 0; i < inputs.length && !run.finished; i++) run.step(inputs[i]);
  return run.finished ? run.finishMs : null;
}

/** Re-drive an encoded replay (what the server does). */
function simulateReplay(built, replay) {
  const spans = decodeInputs(replay);
  let ticks = 0;
  for (const s of spans) ticks += s.ticks;
  const run = new Run(built);
  const player = new InputPlayer(spans);
  while (!run.finished && run.tick < ticks) run.step(player.next());
  return run.finished ? run.finishMs : null;
}

/** The careful bot, but parked on the line for `idleTicks` first. */
function slowLap(built, idleTicks) {
  const run = new Run(built);
  const bot = new Bot(built, BOT_CAREFUL);
  const inputs = [];
  for (let i = 0; i < TICK_HZ * 600 && !run.finished; i++) {
    const bits = i < idleTicks ? 0 : bot.decide(run);
    inputs.push(bits);
    run.step(bits);
  }
  return { ms: run.finished ? run.finishMs : null, inputs };
}

async function token(userId) {
  return new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(SECRET);
}

async function api(method, path, { tok, body, rawBody } = {}) {
  const headers = {};
  if (tok) headers.authorization = `Bearer ${tok}`;
  if (body !== undefined || rawBody !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json };
}

// ------------------------------------------------ determinism, every track
console.log(`-- determinism across ${TRACKS.length} tracks`);
const laps = new Map();
for (const def of TRACKS) {
  const built = buildTrack(def);
  const lap = botLap(built, Run, BOT_CAREFUL);
  assert(lap.ms !== null && lap.respawns === 0, `${def.id}: careful bot finishes (${lap.ms} ms, ${lap.respawns} respawns)`);
  const again = simulate(built, lap.inputs);
  const replay = encode(lap.inputs);
  const decoded = simulateReplay(built, replay);
  assert(again === lap.ms && decoded === lap.ms, `${def.id}: re-sim + encode/decode/re-sim give ${lap.ms} ms`);
  laps.set(def.id, { built, lap, replay });
}

// ---------------------------------------------------------- the API
const def = TRACKS[0];
const { built, lap: careful, replay: carefulReplay } = laps.get(def.id);
const fast = botLap(built, Run, BOT_FAST);
assert(fast.ms !== null && fast.ms < careful.ms, `fast bot beats careful on ${def.id} (${fast.ms} < ${careful.ms})`);
const fastReplay = encode(fast.inputs);
const slow = slowLap(built, TICK_HZ);
assert(slow.ms !== null && slow.ms > careful.ms, `idle-start lap is slower (${slow.ms} > ${careful.ms})`);
const slowReplay = encode(slow.inputs);

const run = (replay, claimedMs, over = {}) => ({
  trackId: def.id,
  trackVersion: def.version,
  simVersion: SIM_VERSION,
  replay,
  claimedMs,
  ...over,
});

const A = randomUUID(), B = randomUUID(), C = randomUUID(), D = randomUUID();
const [tA, tB, tC, tD] = await Promise.all([A, B, C, D].map(token));
const extra = async () => token(randomUUID());

console.log("-- empty board");
let r = await api("GET", `/leaderboard/${def.id}`);
assert(r.status === 200 && r.json.entries.length === 0 && r.json.total === 0 && r.json.you === null, "board starts empty");
assert(r.json.trackVersion === def.version && r.json.simVersion === SIM_VERSION, "board reports current versions");
r = await api("GET", "/leaderboard/no-such-track");
assert(r.status === 404 && typeof r.json.error === "string", "unknown track board → 404");

console.log("-- submissions");
r = await api("POST", "/runs", { body: run(carefulReplay, careful.ms) });
assert(r.status === 401 && r.json.error, "POST without token → 401");

r = await api("POST", "/runs", { tok: tA, body: run(carefulReplay, careful.ms) });
assert(r.status === 200 && r.json.ok === true, "valid bot replay → 200");
assert(r.json.timeMs === careful.ms, `server-verified time equals local sim (${r.json.timeMs})`);
assert(r.json.rank === 1 && r.json.total === 1, "first record ranks 1 of 1");
assert(r.json.improved === true && r.json.previousMs === null, "first record: improved, no previous");

r = await api("POST", "/runs", { tok: tA, body: run(carefulReplay, careful.ms) });
assert(r.status === 429 && r.json.error, "second submission within 2s → 429");

await sleep(RATE_WAIT);
r = await api("POST", "/runs", { tok: tA, body: run(slowReplay, slow.ms) });
assert(r.status === 200 && r.json.improved === false, "slower run → improved false");
assert(r.json.timeMs === slow.ms && r.json.previousMs === careful.ms, "slower run reports its time and the standing record");
r = await api("GET", `/leaderboard/${def.id}`);
assert(r.json.entries[0].timeMs === careful.ms, "record unchanged after a slower run");
const carefulRunId = r.json.entries[0].runId;

await sleep(RATE_WAIT);
r = await api("POST", "/runs", { tok: tA, body: run(fastReplay, fast.ms) });
assert(r.status === 200 && r.json.improved === true, "faster run → improved true");
assert(r.json.timeMs === fast.ms && r.json.previousMs === careful.ms && r.json.rank === 1, "faster run replaces the record");

console.log("-- rejected submissions");
r = await api("POST", "/runs", { tok: tC, body: run(carefulReplay, careful.ms - 1) });
assert(r.status === 422 && /verification failed/.test(r.json.error), `tampered claimedMs → 422 (${r.json.error})`);
const truncated = encode(careful.inputs.slice(0, Math.floor(careful.inputs.length / 2)));
r = await api("POST", "/runs", { tok: await extra(), body: run(truncated, careful.ms) });
assert(r.status === 422 && r.json.error, `truncated replay → 422 (${r.json.error})`);
r = await api("POST", "/runs", { tok: await extra(), body: run("!!not-base64!!", careful.ms) });
assert(r.status === 400 && r.json.error, "garbage replay → 400");
r = await api("POST", "/runs", { tok: await extra(), body: run("A", careful.ms) });
assert(r.status === 400, "bad-length replay → 400");
r = await api("POST", "/runs", { tok: await extra(), body: { trackId: def.id } });
assert(r.status === 400, "missing fields → 400");
r = await api("POST", "/runs", { tok: await extra(), rawBody: "{nope" });
assert(r.status === 400 && r.json.error, "invalid JSON → 400 (JSON error body)");
r = await api("POST", "/runs", { tok: await extra(), body: run("A".repeat(200 * 1024), careful.ms) });
assert(r.status === 400 && r.json.error, "oversized body → 400");
r = await api("POST", "/runs", { tok: await extra(), body: run(carefulReplay, careful.ms, { simVersion: SIM_VERSION + 1 }) });
assert(r.status === 409 && r.json.error, "wrong simVersion → 409");
r = await api("POST", "/runs", { tok: await extra(), body: run(carefulReplay, careful.ms, { trackVersion: def.version + 1 }) });
assert(r.status === 409, "wrong trackVersion → 409");
r = await api("POST", "/runs", { tok: await extra(), body: run(carefulReplay, careful.ms, { trackId: "no-such-track" }) });
assert(r.status === 404 && r.json.error, "unknown track → 404");
// Cheap rejections (400/404/409) don't consume the rate-limit slot.
const tE = await extra();
r = await api("POST", "/runs", { tok: tE, body: run(carefulReplay, careful.ms, { simVersion: 0 }) });
r = await api("POST", "/runs", { tok: tE, body: run(carefulReplay, careful.ms, { trackVersion: 0 }) });
assert(r.status === 409, "stale-version rejections repeat without 429");

console.log("-- second racer + ranking");
r = await api("POST", "/runs", { tok: tB, body: run(carefulReplay, careful.ms) });
assert(r.status === 200 && r.json.rank === 2 && r.json.total === 2, "second racer ranks 2 of 2");
await sleep(5); // distinct set_at for the tie below
r = await api("POST", "/runs", { tok: tD, body: run(carefulReplay, careful.ms) });
assert(r.status === 200 && r.json.rank === 3 && r.json.total === 3, "equal time set later ranks behind (3 of 3)");

r = await api("GET", `/leaderboard/${def.id}`, { tok: tB });
const e = r.json.entries;
assert(r.status === 200 && e.length === 3 && r.json.total === 3, "board lists 3 racers");
assert(e.map((x) => x.userId).join() === [A, B, D].join(), "board order: A (fast), B, D (tie → earlier first)");
assert(e.map((x) => x.rank).join() === "1,2,3", "ranks 1..3");
assert(e[0].timeMs === fast.ms && e[1].timeMs === careful.ms && e[2].timeMs === careful.ms, "board times");
assert(e[0].name === `racer-${A.slice(0, 6)}`, `sqlite display name (${e[0].name})`);
assert(e.every((x) => !Number.isNaN(Date.parse(x.setAt)) && x.runId), "entries carry setAt + runId");
assert(r.json.you && r.json.you.userId === B && r.json.you.rank === 2, "`you` filled for a signed-in racer");
r = await api("GET", `/leaderboard/${def.id}?limit=1`, { tok: tD });
assert(r.json.entries.length === 1 && r.json.total === 3, "limit=1 returns one entry, total 3");
assert(r.json.you && r.json.you.userId === D && r.json.you.rank === 3 && r.json.you.name, "`you` filled even when off the visible page");
r = await api("GET", `/leaderboard/${def.id}`);
assert(r.json.you === null, "`you` null when anonymous");
r = await api("GET", `/leaderboard/${def.id}`, { tok: tC });
assert(r.json.you === null, "`you` null for a signed-in racer with no record");

console.log("-- replays");
const top = e[0];
r = await api("GET", `/replays/${top.runId}`);
assert(r.status === 200 && r.json.replay === fastReplay, "replay endpoint returns the identical replay string");
assert(
  r.json.runId === top.runId && r.json.trackId === def.id && r.json.timeMs === fast.ms &&
    r.json.trackVersion === def.version && r.json.simVersion === SIM_VERSION && r.json.name === top.name,
  "replay metadata matches the board entry",
);
assert(simulateReplay(built, r.json.replay) === fast.ms, "served ghost re-simulates to its time");
r = await api("GET", `/replays/${carefulRunId}`);
assert(r.status === 404, "superseded run id → 404");
r = await api("GET", `/replays/${randomUUID()}`);
assert(r.status === 404 && r.json.error, "unknown run → 404");

console.log("-- /me");
r = await api("GET", "/me");
assert(r.status === 401, "/me without token → 401");
r = await api("GET", "/me", { tok: tC });
assert(r.status === 200 && Object.keys(r.json.records).length === 0, "/me empty for a racer with no records");
if (TRACKS.length > 1) {
  const def2 = TRACKS[1];
  const l2 = laps.get(def2.id);
  await sleep(RATE_WAIT);
  r = await api("POST", "/runs", {
    tok: tA,
    body: { trackId: def2.id, trackVersion: def2.version, simVersion: SIM_VERSION, replay: l2.replay, claimedMs: l2.lap.ms },
  });
  assert(r.status === 200 && r.json.rank === 1 && r.json.total === 1, `record on a second track (${def2.id})`);
}
r = await api("GET", "/me", { tok: tA });
const mine = r.json.records;
assert(r.status === 200 && mine[def.id], "/me returns the caller's records");
assert(
  mine[def.id].timeMs === fast.ms && mine[def.id].rank === 1 && mine[def.id].total === 3 && mine[def.id].runId === top.runId,
  "/me record: time, rank, total, runId",
);
if (TRACKS.length > 1) {
  const m2 = mine[TRACKS[1].id];
  assert(m2 && m2.timeMs === laps.get(TRACKS[1].id).lap.ms && m2.rank === 1, "/me covers every track with a record");
}
r = await api("GET", "/me", { tok: tD });
assert(r.json.records[def.id].rank === 3 && Object.keys(r.json.records).length === 1, "/me for another racer");

clearTimeout(timer);
console.log("hotlap: all checks passed");
process.exit(0);

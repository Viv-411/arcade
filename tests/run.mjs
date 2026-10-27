// Test orchestrator: boots the built server on a test port with an isolated
// stats DB, waits for /healthz, runs each test file as a child process, then
// tears the server down. Requires `npm run build` first (npm test does both).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "dist", "server", "src", "index.js");
const PORT = Number(process.env.TEST_PORT) || 4123;
const TESTS = [
  "mindmeld.test.mjs",
  "trivia.test.mjs",
  "trivia-10p.test.mjs",
  "bidbattle.test.mjs",
  "imposter.test.mjs",
  "codewords.test.mjs",
  "chess.test.mjs",
  "hotlap.test.mjs",
];
// HS256 secret the server trusts for this run, so tests can mint Supabase-
// style access tokens for fake users (auth.ts tries HS256 before JWKS). The
// server's .env loading never overrides variables already set here, so these
// also win over the owner's local .env.
const TEST_JWT_SECRET = "arcade-test-jwt-secret-not-for-production";

if (!existsSync(SERVER)) {
  console.error("dist/ not found — run `npm run build` first (or use `npm test`).");
  process.exit(1);
}

const statsDb = path.join(mkdtempSync(path.join(os.tmpdir(), "arcade-test-")), "stats.db");
const server = spawn(process.execPath, [SERVER], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    STATS_DB: statsDb,
    SUPABASE_JWT_SECRET: TEST_JWT_SECRET,
    // Hotlap records go to the isolated SQLite file, never a real Supabase.
    HOTLAP_STORE: "sqlite",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
let serverExited = false;
server.on("exit", () => (serverExited = true));

function fail(msg) {
  console.error(`\n${msg}`);
  if (serverLog) console.error(`--- server output ---\n${serverLog}`);
  server.kill();
  process.exit(1);
}

// Wait for the server to come up (a stale process on the port shows up here
// as an EADDRINUSE crash in the captured server log).
const deadline = Date.now() + 15000;
let up = false;
while (Date.now() < deadline && !serverExited) {
  try {
    const res = await fetch(`http://localhost:${PORT}/healthz`);
    if (res.ok) {
      up = true;
      break;
    }
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 250));
}
if (!up) fail(`server did not become healthy on port ${PORT}`);
console.log(`server up on :${PORT}, running ${TESTS.length} test files\n`);

for (const file of TESTS) {
  console.log(`=== ${file} ===`);
  const result = spawnSync(
    process.execPath,
    [path.join(ROOT, "tests", file)],
    {
      env: { ...process.env, PORT: String(PORT), TEST_JWT_SECRET },
      stdio: "inherit",
      timeout: 150000,
    },
  );
  if (result.status !== 0) fail(`${file} FAILED`);
}

server.kill();
console.log("ALL TESTS PASSED");
process.exit(0);

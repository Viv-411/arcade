/**
 * Hotlap campaign checker + medal calibrator.
 *
 *   npx tsx tools/hotlap-tracks.ts                 # check every track
 *   npx tsx tools/hotlap-tracks.ts <trackId>       # check one track
 *   npx tsx tools/hotlap-tracks.ts --strict-medals # also FAIL when a track's
 *                                                  # medals differ from the
 *                                                  # calibrated values
 *
 * Run from the repo root. For each track in shared/hotlap/tracks.ts it runs:
 *   - validateTrack() (plus: unique ids, known theme, 2–5 checkpoints)
 *   - a self-overlap check: any two road frames more than OVERLAP_MIN_S apart
 *     along the track that come closer horizontally than (w1+w2)/2 + margin
 *     must be separated vertically by at least OVERLAP_MIN_DY (a clean bridge)
 *   - BOT_CAREFUL and BOT_FAST laps (careful must finish with 0 respawns;
 *     fast must finish, and may only respawn on expert tracks)
 *   - determinism: both bots are run twice and must produce identical times
 * and prints a summary table followed by one `medals: { ... }` line per track,
 * calibrated from the BOT_FAST time F:
 *   ace = F*0.94, gold = F*1.02, silver = F*1.12, bronze = F*1.30 (10 ms steps)
 * After any physics tuning, re-run this and paste the medal lines back into
 * tracks.ts (bump a track's `version` only if its GEOMETRY changed).
 *
 * Exits non-zero if any check fails.
 */
import { buildTrack, validateTrack, type TrackDef } from "../shared/hotlap/track.js";
import { Run } from "../shared/hotlap/run.js";
import { botLap, BOT_CAREFUL, BOT_FAST, type BotTuning } from "../shared/hotlap/bot.js";
import { ALL_TRACKS as TRACKS } from "../shared/hotlap/tracks.js";

const THEMES = ["dawn", "noon", "dusk", "night", "neon", "storm"];
const OVERLAP_MIN_S = 60;
const OVERLAP_MARGIN = 8;
const OVERLAP_MIN_DY = 9;

const args = process.argv.slice(2);
const strictMedals = args.includes("--strict-medals");
const only = args.find((a) => !a.startsWith("--"));

const r10 = (x: number) => Math.round(x / 10) * 10;
function calibrateMedals(fastMs: number) {
  return {
    bronze: r10(fastMs * 1.3),
    silver: r10(fastMs * 1.12),
    gold: r10(fastMs * 1.02),
    ace: r10(fastMs * 0.94),
  };
}

/** Worst self-overlap violation, or null when the road is clean. */
function overlapCheck(def: TrackDef) {
  const t = buildTrack(def);
  const frames = t.segFrames.flat();
  let worst: { s1: number; s2: number; dxz: number; dy: number; need: number } | null = null;
  for (let i = 0; i < frames.length; i++) {
    const a = frames[i];
    for (let j = i + 1; j < frames.length; j++) {
      const b = frames[j];
      if (b.s - a.s <= OVERLAP_MIN_S) continue;
      const need = (a.width + b.width) / 2 + OVERLAP_MARGIN;
      const dx = a.p.x - b.p.x;
      const dz = a.p.z - b.p.z;
      const dxz = Math.sqrt(dx * dx + dz * dz);
      if (dxz >= need) continue;
      const dy = Math.abs(a.p.y - b.p.y);
      if (dy >= OVERLAP_MIN_DY) continue;
      if (!worst || dy < worst.dy) worst = { s1: a.s, s2: b.s, dxz, dy, need };
    }
  }
  return worst;
}

const fmtS = (ms: number | null) => (ms === null ? "DNF" : (ms / 1000).toFixed(3) + "s");

interface Row {
  def: TrackDef;
  length: number;
  gates: number;
  careful: { ms: number | null; respawns: number };
  fast: { ms: number | null; respawns: number };
  problems: string[];
  warnings: string[];
}

function lap(def: TrackDef, tune: BotTuning) {
  const r = botLap(buildTrack(def), Run, tune);
  return { ms: r.ms, respawns: r.respawns };
}

const rows: Row[] = [];
const seen = new Set<string>();
for (const def of TRACKS) {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (seen.has(def.id)) problems.push(`duplicate id ${def.id}`);
  seen.add(def.id);
  if (only && def.id !== only) continue;

  problems.push(...validateTrack(def));
  if (!THEMES.includes(def.theme)) problems.push(`unknown theme "${def.theme}"`);
  const cps = def.segs.filter((s, i) => s.cp && i < def.segs.length - 1).length;
  if (cps < 2 || cps > 5) problems.push(`${cps} checkpoints (want 2–5)`);

  const ov = overlapCheck(def);
  if (ov) {
    problems.push(
      `self-overlap at s=${ov.s1.toFixed(0)}m vs s=${ov.s2.toFixed(0)}m ` +
        `(${ov.dxz.toFixed(1)}m apart < ${ov.need.toFixed(1)}m, only ${ov.dy.toFixed(1)}m vertical)`,
    );
  }

  const t = buildTrack(def);
  const careful = lap(def, BOT_CAREFUL);
  const fast = lap(def, BOT_FAST);
  const careful2 = lap(def, BOT_CAREFUL);
  const fast2 = lap(def, BOT_FAST);
  if (careful.ms !== careful2.ms || fast.ms !== fast2.ms) {
    problems.push(`NON-DETERMINISTIC: careful ${careful.ms}/${careful2.ms}, fast ${fast.ms}/${fast2.ms}`);
  }
  if (careful.ms === null) problems.push("BOT_CAREFUL did not finish");
  else if (careful.respawns > 0) problems.push(`BOT_CAREFUL respawned ${careful.respawns}x`);
  if (fast.ms === null) problems.push("BOT_FAST did not finish");
  else if (fast.respawns > 0) {
    if (def.difficulty === "expert") warnings.push(`BOT_FAST respawned ${fast.respawns}x (allowed on expert)`);
    else problems.push(`BOT_FAST respawned ${fast.respawns}x`);
  }
  if (fast.ms !== null) {
    const m = calibrateMedals(fast.ms);
    if (!(m.ace < m.gold && m.gold < m.silver && m.silver < m.bronze)) problems.push("calibrated medals not ordered");
    const cur = def.medals;
    if (cur.ace !== m.ace || cur.gold !== m.gold || cur.silver !== m.silver || cur.bronze !== m.bronze) {
      (strictMedals ? problems : warnings).push("medals in tracks.ts differ from calibration");
    }
  }
  rows.push({ def, length: t.totalLength, gates: t.gates.length, careful, fast, problems, warnings });
}

if (only && rows.length === 0) {
  console.error(`No track with id "${only}". Known: ${TRACKS.map((t) => t.id).join(", ")}`);
  process.exit(2);
}

const pad = (s: string | number, n: number) => String(s).padEnd(n);
console.log(
  pad("#", 3) + pad("id", 16) + pad("difficulty", 11) + pad("theme", 7) + pad("length", 8) + pad("cps", 4) +
    pad("careful", 18) + pad("fast", 18) + "status",
);
rows.forEach((r) => {
  const idx = TRACKS.indexOf(r.def) + 1;
  const c = `${fmtS(r.careful.ms)} r${r.careful.respawns}`;
  const f = `${fmtS(r.fast.ms)} r${r.fast.respawns}`;
  console.log(
    pad(idx, 3) + pad(r.def.id, 16) + pad(r.def.difficulty, 11) + pad(r.def.theme, 7) +
      pad(r.length.toFixed(0) + "m", 8) + pad(r.gates - 1, 4) + pad(c, 18) + pad(f, 18) +
      (r.problems.length ? "FAIL" : "ok") + (r.warnings.length ? " (warn)" : ""),
  );
});

console.log("\nCalibrated medals (paste into tracks.ts):");
rows.forEach((r) => {
  if (r.fast.ms === null) return console.log(`  ${pad(r.def.id, 16)} (no BOT_FAST time)`);
  const m = calibrateMedals(r.fast.ms);
  console.log(`  ${pad(r.def.id + ":", 17)} medals: { bronze: ${m.bronze}, silver: ${m.silver}, gold: ${m.gold}, ace: ${m.ace} },`);
});

let failed = 0;
for (const r of rows) {
  for (const w of r.warnings) console.log(`WARN ${r.def.id}: ${w}`);
  for (const p of r.problems) {
    console.log(`FAIL ${r.def.id}: ${p}`);
    failed++;
  }
}
console.log(failed ? `\n${failed} problem(s).` : `\nAll checks passed for ${rows.length} track(s).`);
process.exit(failed ? 1 : 0);

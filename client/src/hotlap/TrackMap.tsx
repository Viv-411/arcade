import { useMemo } from "react";
import { buildTrack, type TrackDef } from "@shared/hotlap/track";

/** Top-down outline of a track (start dot, checkpoints, finish flag). */
export default function TrackMap({ def, size = 120 }: { def: TrackDef; size?: number }) {
  const data = useMemo(() => {
    const t = buildTrack(def);
    const pts: { x: number; z: number; gap: boolean }[] = [];
    t.segFrames.forEach((frames, i) => {
      const gap = !!def.segs[i].gap;
      frames.forEach((f) => pts.push({ x: f.p.x, z: f.p.z, gap }));
    });
    const b = t.bounds;
    const w = b.maxX - b.minX;
    const h = b.maxZ - b.minZ;
    const scale = (size - 16) / Math.max(w, h, 1);
    const ox = (size - w * scale) / 2;
    const oy = (size - h * scale) / 2;
    // Mirror X so the map reads like the driver's view (left is left).
    const px = (x: number) => size - (ox + (x - b.minX) * scale);
    const py = (z: number) => size - (oy + (z - b.minZ) * scale);
    const runs: string[] = [];
    let cur = "";
    let prevGap = true;
    for (const p of pts) {
      if (p.gap) {
        if (cur) runs.push(cur);
        cur = "";
        prevGap = true;
        continue;
      }
      cur += `${prevGap ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.z).toFixed(1)} `;
      prevGap = false;
    }
    if (cur) runs.push(cur);
    const start = t.spawn.p;
    const gates = t.gates.map((g) => ({ x: px(g.frame.p.x), y: py(g.frame.p.z), finish: g.isFinish }));
    return { runs, start: { x: px(start.x), y: py(start.z) }, gates };
  }, [def, size]);

  return (
    <svg className="hl-map" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {data.runs.map((d, i) => (
        <path key={`o${i}`} d={d} className="hl-map-casing" />
      ))}
      {data.runs.map((d, i) => (
        <path key={`r${i}`} d={d} className="hl-map-road" />
      ))}
      {data.gates.map((g, i) => (
        <circle key={i} cx={g.x} cy={g.y} r={g.finish ? 4.5 : 3} className={g.finish ? "hl-map-finish" : "hl-map-cp"} />
      ))}
      <circle cx={data.start.x} cy={data.start.y} r={4} className="hl-map-start" />
    </svg>
  );
}

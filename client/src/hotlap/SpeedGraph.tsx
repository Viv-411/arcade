import { useMemo } from "react";
import { TICK_HZ } from "@shared/hotlap/car";
import { SPEED_SAMPLE_TICKS } from "./session";

export interface Trace {
  label: string;
  speeds: number[];
  color: string;
}

const W = 560;
const H = 210;
const PAD = { l: 38, r: 10, t: 10, b: 24 };

/** Speed (km/h) over time (s) for this run, optionally overlaid on another. */
export default function SpeedGraph({ traces }: { traces: Trace[] }) {
  const data = useMemo(() => {
    const dt = SPEED_SAMPLE_TICKS / TICK_HZ;
    const maxT = Math.max(1, ...traces.map((t) => t.speeds.length * dt));
    const maxV = Math.max(100, ...traces.flatMap((t) => t.speeds));
    const vTop = Math.ceil(maxV / 50) * 50;
    const tStep = maxT > 40 ? 5 : maxT > 16 ? 2 : 1;
    const tTop = Math.ceil(maxT / tStep) * tStep;
    const x = (t: number) => PAD.l + (t / tTop) * (W - PAD.l - PAD.r);
    const y = (v: number) => H - PAD.b - (v / vTop) * (H - PAD.t - PAD.b);
    const paths = traces.map((tr) => {
      // Downsample to at most ~W points so long runs stay cheap to draw.
      const step = Math.max(1, Math.floor(tr.speeds.length / W));
      let d = `M${x(0).toFixed(1)},${y(0).toFixed(1)}`;
      for (let i = 0; i < tr.speeds.length; i += step) d += ` L${x((i + 1) * dt).toFixed(1)},${y(tr.speeds[i]).toFixed(1)}`;
      const top = Math.max(...tr.speeds, 0);
      const avg = tr.speeds.length ? tr.speeds.reduce((a, b) => a + b, 0) / tr.speeds.length : 0;
      return { ...tr, d, top, avg };
    });
    const vLines: number[] = [];
    for (let v = 0; v <= vTop; v += vTop > 300 ? 100 : 50) vLines.push(v);
    const tLines: number[] = [];
    for (let t = 0; t <= tTop; t += tStep) tLines.push(t);
    return { paths, vLines, tLines, x, y };
  }, [traces]);

  return (
    <div className="hl-graph">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Speed over time">
        {data.vLines.map((v) => (
          <g key={`v${v}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={data.y(v)} y2={data.y(v)} className="hl-graph-grid" />
            <text x={PAD.l - 6} y={data.y(v) + 4} className="hl-graph-label" textAnchor="end">{v}</text>
          </g>
        ))}
        {data.tLines.map((t) => (
          <g key={`t${t}`}>
            <line x1={data.x(t)} x2={data.x(t)} y1={PAD.t} y2={H - PAD.b} className="hl-graph-grid" />
            <text x={data.x(t)} y={H - 6} className="hl-graph-label" textAnchor="middle">{t}</text>
          </g>
        ))}
        {[...data.paths].reverse().map((p) => (
          <path key={p.label} d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
      </svg>
      <div className="hl-graph-legend">
        {data.paths.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} /> {p.label}: top {Math.round(p.top)} · avg {Math.round(p.avg)} km/h
          </span>
        ))}
        <span className="hl-graph-axis">km/h over seconds</span>
      </div>
    </div>
  );
}

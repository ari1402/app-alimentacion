import { useMemo, useRef, useState } from "react";
import { fmtShort } from "@core";

export interface Series {
  key: string;
  label: string;
  color: string;
  points: { x: string; y: number | null }[];
  kind: "line" | "dots";
}

interface Props {
  series: Series[];
  band?: { from: number; to: number; label: string };
  height?: number;
  unit: string;
  yPad?: number;
  decimals?: number;
}

/** Gráfico de línea SVG: un solo eje, crosshair + tooltip, leyenda y etiqueta directa del último valor. */
export function LineChart({ series, band, height = 190, unit, yPad = 0.6, decimals = 1 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 340, H = height, L = 34, R = 44, T = 10, B = 22;

  const { xs, minY, maxY } = useMemo(() => {
    const set = new Set<string>();
    series.forEach((s) => s.points.forEach((p) => set.add(p.x)));
    const xs = [...set].sort();
    const ys = series.flatMap((s) => s.points.map((p) => p.y).filter((v): v is number => v != null));
    if (band) ys.push(band.from, band.to);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    return { xs, minY: Math.floor((lo - yPad) * 2) / 2, maxY: Math.ceil((hi + yPad) * 2) / 2 };
  }, [series, band, yPad]);

  if (xs.length < 2) return <div className="faint">Con 2 registros o más aparece el gráfico.</div>;
  const t0 = Date.parse(xs[0]), t1 = Date.parse(xs[xs.length - 1]);
  const X = (d: string) => L + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v: number) => T + (1 - (v - minY) / Math.max(0.001, maxY - minY)) * (H - T - B);
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => minY + ((maxY - minY) * i) / ticks);
  const xLabels = [xs[0], xs[Math.floor(xs.length / 2)], xs[xs.length - 1]];

  const onMove = (e: React.PointerEvent) => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    let best = 0, bd = Infinity;
    xs.forEach((d, i) => {
      const dd = Math.abs(X(d) - px);
      if (dd < bd) { bd = dd; best = i; }
    });
    setHover(best);
  };

  const hx = hover != null ? xs[hover] : null;
  const fmt = (v: number) => v.toFixed(decimals).replace(".", ",");

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Gráfico">
        {band && (
          <g>
            <rect x={L} width={W - L - R} y={Y(band.to)} height={Math.max(0, Y(band.from) - Y(band.to))} fill="var(--good)" opacity={0.1} />
            <text x={W - R + 4} y={Y((band.from + band.to) / 2)} fontSize="10" fill="var(--text-3)" dominantBaseline="middle">{band.label}</text>
          </g>
        )}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={L - 6} y={Y(v)} fontSize="10" fill="var(--text-3)" textAnchor="end" dominantBaseline="middle">{fmt(v).replace(/,0$/, "")}</text>
          </g>
        ))}
        {xLabels.map((d, i) => (
          <text key={d + i} x={X(d)} y={H - 6} fontSize="10" fill="var(--text-3)" textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>{fmtShort(d)}</text>
        ))}
        {series.map((s) => {
          const pts = s.points.filter((p) => p.y != null) as { x: string; y: number }[];
          if (s.kind === "dots") {
            return <g key={s.key}>{pts.map((p) => <circle key={p.x} cx={X(p.x)} cy={Y(p.y)} r={3} fill={s.color} opacity={0.55} />)}</g>;
          }
          const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
          const last = pts[pts.length - 1];
          return (
            <g key={s.key}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {last && (
                <>
                  <circle cx={X(last.x)} cy={Y(last.y)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
                  <text x={X(last.x) + 7} y={Y(last.y)} fontSize="11" fontWeight="650" fill="var(--text)" dominantBaseline="middle">{fmt(last.y)}</text>
                </>
              )}
            </g>
          );
        })}
        {hx && <line x1={X(hx)} x2={X(hx)} y1={T} y2={H - B} stroke="var(--text-3)" strokeWidth={1} strokeDasharray="3 3" />}
        <rect x={0} y={0} width={W} height={H} fill="transparent" />
      </svg>
      {hx && ref.current && (
        <div className="tip" style={{ left: `${(X(hx) / W) * 100}%`, top: 0 }}>
          <div className="faint" style={{ fontSize: 11 }}>{fmtShort(hx)}</div>
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hx);
            return p?.y != null ? (
              <div key={s.key}><strong>{fmt(p.y)} {unit}</strong> <span className="muted">{s.label}</span></div>
            ) : null;
          })}
        </div>
      )}
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}><span className={`sw ${s.kind === "dots" ? "dot" : ""}`} style={{ background: s.color }} />{s.label}</span>
          ))}
          {band && <span><span className="sw" style={{ background: "var(--good)", opacity: 0.4, height: 8 }} />{band.label}</span>}
        </div>
      )}
    </div>
  );
}

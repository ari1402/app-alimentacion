import type { Macros, UserConfig } from "@core";

interface RingProps { value: number; target: number; color: string; label: string; unit: string; size?: number; min?: number; max?: number }

/** Anillo de progreso con rango aceptable marcado (no es un único número que se "falla") */
export function Ring({ value, target, color, label, unit, size = 74, min, max }: RingProps) {
  const sw = 7;
  const r = (size - sw) / 2;
  const C = 2 * Math.PI * r;
  const pct = target > 0 ? Math.min(value / target, 1.25) : 0;
  const shown = Math.min(pct, 1);
  const over = pct > 1;
  const remaining = Math.round(target - value);
  const inRange = min != null && max != null ? value >= min && value <= max : min != null ? value >= min : false;
  const tick = (v: number | undefined) => {
    if (v == null || !target) return null;
    const a = (Math.min(v / target, 1) * 360 - 90) * (Math.PI / 180);
    const c = size / 2;
    return <line x1={c + (r - 6) * Math.cos(a)} y1={c + (r - 6) * Math.sin(a)} x2={c + (r + 6) * Math.cos(a)} y2={c + (r + 6) * Math.sin(a)} stroke="var(--text-3)" strokeWidth={1.5} />;
  };
  return (
    <div className="ring" aria-label={`${label}: ${Math.round(value)} de ${target} ${unit}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--track)" strokeWidth={sw} fill="none" />
        {shown > 0.005 && <circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round"
          strokeDasharray={`${C * shown} ${C}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray .5s ease" }}
        />}
        {tick(min)}
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fontSize="15" fontWeight="650" fill="var(--text)">
          {Math.round(value)}
        </text>
      </svg>
      <div className="l">{label}{inRange ? " ✓" : ""}</div>
      <div className="r num">{over ? `+${-remaining}` : `faltan ${Math.max(0, remaining)}`}{unit === "kcal" ? "" : " g"}</div>
    </div>
  );
}

export function MacroRings({ totals, target, ranges, simple }: { totals: Macros; target: Macros; ranges: UserConfig["ranges"]; simple?: boolean }) {
  const t = target;
  const r = ranges;
  return (
    <div className="rings" style={simple ? { gridTemplateColumns: "1fr 1fr" } : undefined}>
      <Ring value={totals.kcal} target={t.kcal} color="var(--s1)" label="kcal" unit="kcal" min={r.kcal[0]} max={r.kcal[1]} />
      <Ring value={totals.p} target={t.p} color="var(--s2)" label="Proteína" unit="g" min={r.pMin} />
      {!simple && <Ring value={totals.c} target={t.c} color="var(--s3)" label="Carbos" unit="g" min={r.c[0]} max={r.c[1]} />}
      {!simple && <Ring value={totals.f} target={t.f} color="var(--s4)" label="Grasas" unit="g" min={r.f[0]} max={r.f[1]} />}
    </div>
  );
}

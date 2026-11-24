import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { addDays, daySummaries, fmtRange, fmtShort, weekStart, weightTrend } from "@core";
import { useStore } from "../lib/store";
import { LineChart } from "../components/LineChart";
import { Sheet } from "../components/Sheet";
import { WeightSheet } from "./Today";
import { uid } from "../lib/uid";
import { IconTrash } from "../components/Icons";

function MeasureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snap, actions, toast } = useStore();
  const [v, setV] = useState({ waist: "", hip: "", thigh: "" });
  const save = async () => {
    const n = (s: string) => (s ? Number(s.replace(",", ".")) : null);
    if (!v.waist && !v.hip && !v.thigh) return;
    await actions.saveMetric({ id: uid(), local_date: snap.today, waist_cm: n(v.waist), hip_cm: n(v.hip), thigh_cm: n(v.thigh) });
    toast("Medidas guardadas. Próximo recordatorio en 3 semanas.");
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Medidas">
      <p className="faint" style={{ marginTop: 0 }}>Cinta a la altura del ombligo (cintura), parte más ancha (cadera) y mitad del muslo. Mismo lugar cada vez.</p>
      <div className="grid4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <label className="field"><span>Cintura</span><input type="number" inputMode="decimal" value={v.waist} onChange={(e) => setV({ ...v, waist: e.target.value })} /></label>
        <label className="field"><span>Cadera</span><input type="number" inputMode="decimal" value={v.hip} onChange={(e) => setV({ ...v, hip: e.target.value })} /></label>
        <label className="field"><span>Muslo</span><input type="number" inputMode="decimal" value={v.thigh} onChange={(e) => setV({ ...v, thigh: e.target.value })} /></label>
      </div>
      <button className="btn primary block" style={{ marginTop: 12 }} onClick={save}>Guardar</button>
    </Sheet>
  );
}

function Reintros() {
  const { data, snap, actions } = useStore();
  const [food, setFood] = useState(data.config.reintroductions[0] ?? "");
  const [rating, setRating] = useState(3);
  const [note, setNote] = useState("");
  if (!data.config.reintroductions.length && !data.reintros.length) return null;
  return (
    <details className="card">
      <summary><strong>Reintroducciones</strong> <span className="faint">({data.reintros.length} registros)</span></summary>
      <p className="faint">Probar de a poco, sin presión. Registrá cómo te cayó para ver la evolución.</p>
      <div className="chips">
        {data.config.reintroductions.map((f) => <button key={f} className={`chip ${food === f ? "on" : ""}`} onClick={() => setFood(f)}>{f}</button>)}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => <button key={n} className={`chip ${rating === n ? "on" : ""}`} onClick={() => setRating(n)} aria-label={`${n} de 5`}>{n}</button>)}
        <span className="faint">1 = mal · 5 = muy bien</span>
      </div>
      <input type="text" style={{ marginTop: 8 }} placeholder="Nota (cantidad, preparación…)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn block" style={{ marginTop: 8 }} disabled={!food} onClick={() => { actions.saveReintro({ id: uid(), local_date: snap.today, food, rating, note: note || null }); setNote(""); }}>Registrar intento</button>
      {[...data.reintros].reverse().slice(0, 12).map((r) => (
        <div className="list-item small" key={r.id}>
          <span className="grow">{fmtShort(r.local_date)} · <strong>{r.food}</strong> · {r.rating}/5 {r.note ? `— ${r.note}` : ""}</span>
          <button className="icon-btn" aria-label="Borrar" onClick={() => actions.deleteReintro(r.id)}><IconTrash /></button>
        </div>
      ))}
    </details>
  );
}

export default function Progress() {
  const { data, snap } = useStore();
  const [params] = useSearchParams();
  const [weightOpen, setWeightOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(params.get("medidas") === "1");
  const [range, setRange] = useState<30 | 90 | 365>(90);
  useEffect(() => { if (params.get("medidas") === "1") setMeasureOpen(true); }, [params]);
  const cfg = data.config;
  const p = snap.projection;

  const trend = useMemo(() => weightTrend(data.metrics), [data.metrics]);
  const from = addDays(snap.today, -range);
  const shown = trend.filter((t) => t.date >= from);
  const measures = data.metrics.filter((m) => m.waist_cm || m.hip_cm || m.thigh_cm);

  const weeks = useMemo(() => {
    const start = weekStart(addDays(snap.today, -7 * 7));
    return daySummaries(data.meals, cfg, start, addDays(weekStart(snap.today), 6));
  }, [data.meals, cfg, snap.today]);

  const label: Record<string, string> = { on: "en rango", near: "cerca", off: "lejos", empty: "sin registro" };

  return (
    <div>
      <div className="header">
        <div>
          <h1>Progreso</h1>
          <div className="sub">Tendencia, no ruido diario.</div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setMeasureOpen(true)}>Medidas</button>
          <button className="btn sm primary" onClick={() => setWeightOpen(true)}>+ Peso</button>
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <div>
            <div className="faint">Tendencia</div>
            <div className="big num">{p.currentTrend != null ? p.currentTrend.toFixed(1) : "—"} <span className="faint" style={{ fontSize: 15 }}>kg</span></div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="faint">Ritmo</div>
            <div className="num" style={{ fontWeight: 650 }}>{p.kgPerWeek != null ? `${p.kgPerWeek > 0 ? "+" : ""}${p.kgPerWeek.toFixed(2)} kg/sem` : "—"}</div>
            <div className="faint" style={{ fontSize: 11 }}>{p.basis === "tendencia" ? "según tu balanza" : "según el plan (faltan pesos)"}</div>
          </div>
        </div>
        <div className="seg" style={{ margin: "10px 0" }}>
          {[30, 90, 365].map((r) => <button key={r} className={range === r ? "on" : ""} onClick={() => setRange(r as 30 | 90 | 365)}>{r === 365 ? "1 año" : `${r} días`}</button>)}
        </div>
        <LineChart
          unit="kg"
          band={{ from: cfg.goal.target_min, to: cfg.goal.target_max, label: "objetivo" }}
          series={[
            { key: "raw", label: "Peso del día", color: "var(--text-3)", kind: "dots", points: shown.map((t) => ({ x: t.date, y: t.kg })) },
            { key: "trend", label: "Tendencia", color: "var(--s1)", kind: "line", points: shown.map((t) => ({ x: t.date, y: t.trend })) },
          ]}
        />
      </div>

      <div className="card">
        <h2>¿Cuándo llego?</h2>
        {p.dateRange ? (
          <p style={{ marginTop: 0 }}>
            A ≤{cfg.goal.target_max} kg: <strong>{fmtRange(p.dateRange[0], p.dateRange[1])}</strong>
            {p.dateRangeMin && <> · a {cfg.goal.target_min} kg: {fmtRange(p.dateRangeMin[0], p.dateRangeMin[1])}</>}
            <br /><span className="faint">Rango, no promesa: la baja no es lineal.</span>
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>Todavía no hay una baja sostenida para proyectar. {p.needs[0] ?? ""}</p>
        )}
        {p.scenarios.map((s) => (
          <div key={s.key} className="list-item small">
            <div className="grow">{s.label}<div className="faint">{s.kgPerWeek.toFixed(2)} kg/sem</div></div>
            <div className="num" style={{ textAlign: "right" }}>{s.dateRange ? fmtRange(s.dateRange[0], s.dateRange[1]) : "—"}</div>
          </div>
        ))}
        {p.needs.length > 0 && <div className="banner" style={{ marginTop: 8 }}>{p.needs.join(" ")}</div>}
        <div className="faint" style={{ marginTop: 8 }}>Gasto estimado: {p.tdee.kcal} kcal/día ({p.tdee.basis === "datos" ? "calculado con tus datos" : p.tdee.basis === "mixto" ? "mezcla de tus datos y la fórmula" : "estimación teórica"}).</div>
      </div>

      <div className="card">
        <h2>Hitos</h2>
        {p.milestones.map((m) => (
          <div key={m.kg} className="row between small" style={{ padding: "4px 0" }}>
            <span>{m.reached ? "✓" : "○"} {m.kg} kg{m.kg === cfg.goal.target_max ? " · objetivo" : ""}</span>
            <span className="faint num">{m.reached ? "logrado" : p.currentTrend != null ? `faltan ${m.remainingKg.toFixed(1)} kg${m.etaDays ? ` · ~${m.etaDays} d` : ""}` : ""}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Adherencia (8 semanas)</h2>
        <div className="heat" role="grid" aria-label="Días en rango">
          {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <div key={i} className="faint" style={{ fontSize: 11, textAlign: "center" }}>{d}</div>)}
          {weeks.map((d) => (
            <div
              key={d.date}
              className={`c st-${d.date > snap.today ? "empty" : d.status} ${d.date === snap.today ? "today" : ""}`}
              title={`${fmtShort(d.date)}: ${label[d.date > snap.today ? "empty" : d.status]}${d.meals ? ` · ${d.kcal} kcal · ${Math.round(d.p)} g P` : ""}`}
              style={d.date > snap.today ? { opacity: 0.3 } : undefined}
            />
          ))}
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          <span><span className="status-dot st-on" /> en rango</span>
          <span><span className="status-dot st-near" /> cerca</span>
          <span><span className="status-dot st-off" /> lejos</span>
          <span><span className="status-dot st-empty" /> sin registro</span>
        </div>
        <p className="faint" style={{ marginBottom: 0 }}>80% sostenido vale más que 100% dos semanas. Últimos 14 días: {snap.streak.last14Pct}%.</p>
      </div>

      {measures.length > 0 && (
        <div className="card">
          <h2>Medidas (cm)</h2>
          <div className="row between small faint"><span style={{ width: 70 }}>Fecha</span><span>Cintura</span><span>Cadera</span><span>Muslo</span></div>
          {[...measures].reverse().map((m) => (
            <div key={m.id} className="row between small num" style={{ padding: "4px 0", borderTop: "1px solid var(--border)" }}>
              <span style={{ width: 70 }}>{fmtShort(m.local_date)}</span><span>{m.waist_cm ?? "—"}</span><span>{m.hip_cm ?? "—"}</span><span>{m.thigh_cm ?? "—"}</span>
            </div>
          ))}
        </div>
      )}

      <Reintros />
      <WeightSheet open={weightOpen} onClose={() => setWeightOpen(false)} />
      <MeasureSheet open={measureOpen} onClose={() => setMeasureOpen(false)} />
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { coachCard, dayName, fmtRange, fmtShort, localParts, slotLabel, type Meal } from "@core";
import { useStore } from "../lib/store";
import { MacroRings } from "../components/Rings";
import { IconGear, IconTrash } from "../components/Icons";
import { Sheet } from "../components/Sheet";
import { uid } from "../lib/uid";

export function WeightSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snap, actions, toast, data } = useStore();
  const last = [...data.metrics].reverse().find((m) => m.weight_kg);
  const [kg, setKg] = useState<string>(last?.weight_kg ? String(last.weight_kg) : "");
  const save = async () => {
    const v = Number(kg.replace(",", "."));
    if (!v || v < 30 || v > 250) return toast("Peso inválido", "error");
    await actions.saveMetric({ id: uid(), local_date: snap.today, weight_kg: v });
    toast("Peso guardado. La proyección usa la tendencia, no el número de hoy.");
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Peso de hoy">
      <p className="faint" style={{ marginTop: 0 }}>Idealmente a la mañana, en ayunas, después del baño. El número de un día tiene ruido (agua, sodio, ciclo): mirá la tendencia.</p>
      {snap.cycle?.retention && <div className="banner" style={{ marginBottom: 8 }}>{snap.cycle.note}</div>}
      <div className="row">
        <input type="number" inputMode="decimal" step="0.1" value={kg} onChange={(e) => setKg(e.target.value)} placeholder="kg" autoFocus aria-label="Peso en kg" />
        <button className="btn primary" onClick={save}>Guardar</button>
      </div>
    </Sheet>
  );
}

function MealRow({ m }: { m: Meal }) {
  const { actions, data } = useStore();
  const tz = data.config.timezone;
  const lp = localParts(new Date(m.eaten_at), tz);
  return (
    <div className="meal">
      <div className="grow">
        <div className="row between">
          <span className="slot">{slotLabel(m.slot)} · {String(lp.hour).padStart(2, "0")}:{String(lp.minute).padStart(2, "0")}</span>
          <span className="faint num">{m.totals.kcal} kcal · {Math.round(m.totals.p)} P · {Math.round(m.totals.c)} C · {Math.round(m.totals.f)} G</span>
        </div>
        <div className="small" style={{ marginTop: 2 }}>{m.items.map((i) => `${i.name} (${i.grams} g)`).join(", ")}</div>
      </div>
      <button className="icon-btn" aria-label="Borrar comida" onClick={() => confirm("¿Borrar esta comida?") && actions.deleteMeal(m.id)}><IconTrash /></button>
    </div>
  );
}

export default function Today() {
  const { snap, data, actions } = useStore();
  const nav = useNavigate();
  const [weightOpen, setWeightOpen] = useState(false);
  const cfg = data.config;
  const card = coachCard(snap);
  const d = snap.day;
  const p = snap.projection;
  const w = snap.week;

  const toggleGuardia = () => {
    const until = snap.guardia ? null : new Date(Date.now() + 26 * 3600 * 1000).toISOString();
    actions.saveConfig({ ...cfg, guardia_until: until });
  };

  return (
    <div>
      <div className="header">
        <div>
          <h1>Hoy</h1>
          <div className="sub" style={{ textTransform: "capitalize" }}>{dayName(snap.today)} {fmtShort(snap.today)}</div>
        </div>
        <div className="row">
          <button className={`chip ${snap.guardia ? "on" : ""}`} onClick={toggleGuardia} title="Silencia recordatorios de rutina por 26 h">
            {snap.guardia ? "En guardia" : "Guardia"}
          </button>
          <Link to="/ajustes" className="icon-btn" aria-label="Ajustes"><IconGear /></Link>
        </div>
      </div>

      <div className="card coach" role="status">
        <div className="title">{card.title}</div>
        <div className="muted">{card.body}</div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary sm" onClick={() => nav(card.url)}>{card.url.startsWith("/registrar") ? "Registrar" : card.url === "/progreso" ? "Ver progreso" : "Registrar comida"}</button>
          <Link className="btn sm ghost" to="/coach">Hablar con el coach</Link>
        </div>
      </div>

      <div className="card">
        <MacroRings totals={d.totals} target={d.target} ranges={d.ranges} simple={cfg.simple_mode} />
        {(d.adjust.cardioBonusKcal > 0 || d.adjust.dietBreak) && (
          <div className="faint" style={{ marginTop: 8, textAlign: "center" }}>
            Objetivo de hoy {d.target.kcal} kcal
            {d.adjust.cardioBonusKcal > 0 && <> · +{d.adjust.cardioBonusKcal} por cardio ({d.adjust.cardioNetKcal} netas × {Math.round(cfg.cardio.eatback * 100)}%, a carbos)</>}
            {d.adjust.dietBreak && <> · pausa de mantenimiento</>}
          </div>
        )}
        {d.carbRule.active && <div className="banner" style={{ marginTop: 12 }}>{d.carbRule.reason}</div>}
        <div className="grid3" style={{ marginTop: 12 }}>
          <Link to="/registrar" className="btn primary">+ Comida</Link>
          <button className="btn" onClick={() => setWeightOpen(true)}>{snap.weighedToday ? "Peso ✓" : "+ Peso"}</button>
          <Link to="/entrenos/nuevo?tipo=cardio" className="btn">+ Cardio</Link>
        </div>
      </div>

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Semana</h2>
          <span className="faint num">margen {w.marginKcal >= 0 ? "+" : ""}{w.marginKcal} kcal</span>
        </div>
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          {w.days.map((x) => (
            <div key={x.date} style={{ flex: 1, textAlign: "center" }} title={`${x.date}: ${x.kcal} kcal, ${Math.round(x.p)} g P`}>
              <div className="faint" style={{ fontSize: 11 }}>{["D", "L", "M", "M", "J", "V", "S"][new Date(x.date + "T12:00:00Z").getUTCDay()]}</div>
              <span className={`status-dot st-${x.date > snap.today ? "empty" : x.status}`} style={{ width: 22, height: 22, borderRadius: 7, outline: x.date === snap.today ? "2px solid var(--text)" : undefined, outlineOffset: 1 }} />
            </div>
          ))}
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          <span><span className="status-dot st-on" /> en rango</span>
          <span><span className="status-dot st-near" /> cerca</span>
          <span><span className="status-dot st-off" /> lejos</span>
        </div>
        <hr />
        <div className="grid2">
          <div>
            <div className="faint">Entrenos</div>
            <div className="num" style={{ fontWeight: 650 }}>{snap.workouts.done} / {snap.workouts.goalMin}–{snap.workouts.goalMax}{snap.workouts.ramp ? " (retomando)" : ""}</div>
          </div>
          <div>
            <div className="faint">Racha en rango</div>
            <div className="num" style={{ fontWeight: 650 }}>{snap.streak.current} días · {snap.streak.last14Pct}% (14 d)</div>
          </div>
          <div>
            <div className="faint">Tendencia</div>
            <div className="num" style={{ fontWeight: 650 }}>{p.currentTrend != null ? `${p.currentTrend.toFixed(1)} kg` : "—"}{p.lostKg ? ` (−${p.lostKg})` : ""}</div>
          </div>
          <div>
            <div className="faint">Objetivo {cfg.goal.target_max} kg</div>
            <div className="num" style={{ fontWeight: 650 }}>{p.dateRange ? fmtRange(p.dateRange[0], p.dateRange[1]) : "con más datos"}</div>
          </div>
        </div>
        {p.nextMilestone && p.currentTrend != null && (
          <div className="faint" style={{ marginTop: 8 }}>
            Próximo hito: {p.nextMilestone.kg} kg — faltan {p.nextMilestone.remainingKg.toFixed(1)} kg{p.nextMilestone.etaDays ? ` (~${p.nextMilestone.etaDays} días a este ritmo)` : ""}.
          </div>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Comidas de hoy</h2>
          <span className="faint">{d.meals.length}/{cfg.meals_per_day}</span>
        </div>
        {d.meals.length === 0 && <div className="faint" style={{ marginTop: 8 }}>Todavía nada. Una frase alcanza: “yogur griego con avena y banana”.</div>}
        {d.meals.map((m) => <MealRow key={m.id} m={m} />)}
        {d.meals.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="faint">Checklist de cierre ({d.checklist.filter((c) => c.ok).length}/4)</summary>
            <div style={{ marginTop: 6 }}>
              {d.checklist.map((c) => (
                <div key={c.key} className="row between small" style={{ padding: "3px 0" }}>
                  <span>{c.ok ? "✓" : "○"} {c.label} <span className="faint">({c.target})</span></span>
                  <span className="num">{c.value}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {cfg.auto_adjust.enabled && (snap.targetRec.action === "subir" || snap.targetRec.action === "bajar") && (
        <Link to="/progreso" className="card" style={{ display: "block", textDecoration: "none", color: "inherit", borderLeft: "3px solid var(--warning)" }}>
          <strong>Revisión semanal del objetivo</strong>
          <div className="muted small">{snap.targetRec.title}. Tocá para ver por qué y aplicarlo.</div>
        </Link>
      )}

      {snap.adaptive.notes.length > 0 && (
        <details className="card">
          <summary><strong>El coach se ajustó a vos</strong> <span className="faint">({snap.adaptive.notes.length})</span></summary>
          <ul className="small muted" style={{ paddingLeft: 18, marginBottom: 0 }}>
            {snap.adaptive.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </details>
      )}
      <WeightSheet open={weightOpen} onClose={() => setWeightOpen(false)} />
    </div>
  );
}

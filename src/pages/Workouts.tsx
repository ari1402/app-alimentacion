import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  bestSet, CARDIO_TYPES, type CardioIntensity, type CardioModality, detectPRs, estimateCardio, exerciseHistory, fmtShort,
  lastSetsByExercise, normalizeExercise, SEED_EXERCISES, targetsForDay, type Workout, type WorkoutExercise, type WorkoutType,
} from "@core";
import { useStore } from "../lib/store";
import { LineChart } from "../components/LineChart";
import { IconTrash } from "../components/Icons";
import { uid } from "../lib/uid";

export default function Workouts() {
  const { data, snap, actions } = useStore();
  const w = snap.workouts;
  const names = useMemo(() => {
    const s = new Map<string, string>();
    for (const wo of data.workouts) for (const e of wo.exercises) s.set(normalizeExercise(e.name), e.name);
    return [...s.values()];
  }, [data.workouts]);
  const [ex, setEx] = useState<string>(names[0] ?? "Sentadilla");
  const hist = exerciseHistory(data.workouts, ex);
  const ref = SEED_EXERCISES.find((e) => normalizeExercise(e.name) === normalizeExercise(ex))?.ref_kg;

  return (
    <div>
      <div className="header">
        <div>
          <h1>Entrenos</h1>
          <div className="sub">Fuerza para sostener el músculo mientras bajás.</div>
        </div>
        <Link to="/entrenos/nuevo" className="btn primary sm">+ Entreno</Link>
      </div>

      <div className="card">
        <div className="row between">
          <div>
            <div className="faint">Esta semana</div>
            <div className="big num">{w.done} <span className="faint" style={{ fontSize: 15 }}>/ {w.goalMin}–{w.goalMax}</span></div>
          </div>
          <div className="faint" style={{ textAlign: "right", maxWidth: 200 }}>
            {w.ramp ? "Retomando: esta semana con 2 ya es avance real." : w.done >= w.goalMin ? "Semana cumplida ✓" : `Quedan ${w.plannedRemaining} días planificados.`}
          </div>
        </div>
        <div className="bar" style={{ marginTop: 10 }}><i style={{ width: `${Math.min(100, (w.done / Math.max(1, w.goalMin)) * 100)}%`, background: "var(--s1)" }} /></div>
        <div className="faint" style={{ marginTop: 6 }}>Últimos 14 días: {w.last14} sesiones.</div>
      </div>

      {snap.volume.length > 0 && (
        <div className="card">
          <h2>Series por grupo (últimos 7 días)</h2>
          {snap.volume.map((v) => (
            <div key={v.muscle} style={{ marginBottom: 8 }}>
              <div className="row between small"><span>{v.muscle}</span><span className="num faint">{v.sets} series · {v.status}</span></div>
              <div className="bar"><i style={{ width: `${Math.min(100, (v.sets / 20) * 100)}%`, background: v.sets >= 10 ? "var(--good)" : "var(--s1)" }} /></div>
            </div>
          ))}
          <p className="faint" style={{ marginBottom: 0 }}>Para progresar: ≥10 series duras por grupo por semana (Schoenfeld 2017). En déficit, lo clave para conservar músculo es sostener las cargas aunque bajes algo el volumen.</p>
        </div>
      )}

      {snap.strength.signals.length > 0 && (
        <div className="card">
          <h2>¿Se mantiene la fuerza?</h2>
          {snap.strength.signals.map((x) => (
            <div key={x.exercise} className="row between small" style={{ padding: "3px 0" }}>
              <span>{x.changePct <= -7 ? "⚠" : "✓"} {x.exercise}</span>
              <span className="num faint">{x.changePct > 0 ? "+" : ""}{x.changePct}% (1RM est. {x.recentBest} vs {x.priorBest} kg)</span>
            </div>
          ))}
          <p className="faint" style={{ marginBottom: 0 }}>Últimas 2 semanas vs las 8 anteriores. Una caída &gt;7% bajando rápido indica déficit demasiado agresivo, poco sueño o poca proteína.</p>
        </div>
      )}

      {names.length > 0 && (
        <div className="card">
          <h2>Progresión</h2>
          <div className="chips" style={{ marginBottom: 8 }}>
            {names.map((n) => <button key={n} className={`chip ${n === ex ? "on" : ""}`} onClick={() => setEx(n)}>{n}</button>)}
          </div>
          <LineChart unit="kg" yPad={2} decimals={0} series={[{ key: "e1rm", label: "1RM estimado", color: "var(--s1)", kind: "line", points: hist.map((h) => ({ x: h.date, y: h.e1rm })) }]} />
          <div className="faint" style={{ marginTop: 6 }}>
            1RM estimado (Epley) para comparar series con distintas reps.{ref ? ` Referencia previa: ${ref} kg.` : ""}
          </div>
        </div>
      )}

      <div className="card">
        <h2>Historial</h2>
        {data.workouts.length === 0 && <div className="faint">Sin entrenos todavía. El primero precarga tus cargas de referencia.</div>}
        {[...data.workouts].reverse().slice(0, 30).map((wo) => (
          <div className="list-item" key={wo.id}>
            <div className="grow">
              <div style={{ fontWeight: 550 }}>{fmtShort(wo.local_date)} · {wo.type}{wo.duration_min ? ` · ${wo.duration_min} min` : ""}</div>
              <div className="faint">
                {wo.cardio
                  ? `${CARDIO_TYPES[wo.cardio.modality]?.label ?? "Cardio"} ${wo.cardio.intensity} · ~${wo.cardio.net_kcal} kcal netas`
                  : wo.exercises.map((e) => { const b = bestSet(e); return `${e.name}${b ? ` ${b.kg}×${b.reps}` : ""}`; }).join(" · ")}
              </div>
            </div>
            <Link className="btn sm ghost" to={`/entrenos/nuevo?id=${wo.id}`}>Editar</Link>
            <button className="icon-btn" aria-label="Borrar entreno" onClick={() => confirm("¿Borrar este entreno?") && actions.deleteWorkout(wo.id)}><IconTrash /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkoutNew() {
  const { data, snap, actions, toast } = useStore();
  const nav = useNavigate();
  const qs = new URLSearchParams(location.search);
  const editId = qs.get("id");
  const editing = data.workouts.find((w) => w.id === editId);
  const last = useMemo(() => lastSetsByExercise(data.workouts), [data.workouts]);
  const [type, setType] = useState<WorkoutType>(editing?.type ?? (qs.get("tipo") === "cardio" ? "cardio" : "fuerza"));
  const [duration, setDuration] = useState(editing?.duration_min ? String(editing.duration_min) : "");
  const [modality, setModality] = useState<CardioModality>(editing?.cardio?.modality ?? "caminata_inclinada");
  const [intensity, setIntensity] = useState<CardioIntensity>(editing?.cardio?.intensity ?? "moderada");
  const [hr, setHr] = useState(editing?.cardio?.avg_hr ? String(editing.cardio.avg_hr) : "");
  const [deviceKcal, setDeviceKcal] = useState(editing?.cardio?.device_kcal ? String(editing.cardio.device_kcal) : "");
  const weightKg = snap.projection.currentTrend ?? data.config.goal.start_kg;
  const minutes = Number(duration) || 0;
  const est = estimateCardio({ modality, minutes, intensity, avg_hr: Number(hr) || null, device_kcal: Number(deviceKcal) || null }, weightKg, data.config.profile);
  const bonusPreview = Math.min(data.config.cardio.max_bonus, Math.round((est.net_kcal * data.config.cardio.eatback) / 10) * 10);
  const [date, setDate] = useState(editing?.local_date ?? snap.today);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [exs, setExs] = useState<WorkoutExercise[]>(editing?.exercises ?? []);
  const [custom, setCustom] = useState("");

  const catalog = useMemo(() => {
    const s = new Map<string, string>();
    for (const e of SEED_EXERCISES) s.set(normalizeExercise(e.name), e.name);
    for (const [k, e] of last) s.set(k, e.name);
    return [...s.values()];
  }, [last]);

  const addExercise = (name: string) => {
    if (!name.trim() || exs.some((e) => normalizeExercise(e.name) === normalizeExercise(name))) return;
    const prev = last.get(normalizeExercise(name));
    const ref = SEED_EXERCISES.find((e) => normalizeExercise(e.name) === normalizeExercise(name))?.ref_kg;
    const sets = prev?.sets.map((s) => ({ ...s })) ?? [1, 2, 3].map(() => ({ reps: 10, kg: ref ? Math.round(ref * 0.7 / 2.5) * 2.5 : 0 }));
    setExs((x) => [...x, { name, sets }]);
  };

  const setSet = (i: number, j: number, k: "reps" | "kg", v: number) =>
    setExs((x) => x.map((e, ii) => (ii !== i ? e : { ...e, sets: e.sets.map((s, jj) => (jj !== j ? s : { ...s, [k]: v })) })));

  const save = async () => {
    const w: Workout = {
      id: editing?.id ?? uid(), local_date: date, type, exercises: type === "cardio" ? [] : exs.filter((e) => e.sets.length),
      cardio: type === "cardio"
        ? { modality, minutes, intensity, avg_hr: Number(hr) || null, device_kcal: Number(deviceKcal) || null, net_kcal: est.net_kcal, method: est.method }
        : null,
      duration_min: duration ? Number(duration) : null, notes: notes || null,
    };
    await actions.saveWorkout(w);
    if (type === "cardio") {
      const others = data.workouts.filter((x) => x.id !== w.id);
      const t = targetsForDay(data.config, date, [...others, w]);
      toast(`~${est.net_kcal} kcal netas. ${t.cardioBonusKcal ? `Objetivo de ${date === snap.today ? "hoy" : "ese día"}: ${t.targets.kcal} kcal (+${t.cardioBonusKcal}, van a carbos).` : ""}`);
      nav("/");
      return;
    }
    const prs = detectPRs(w, data.workouts);
    const wk = snap.workouts.done + (editing || snap.workouts.trainedToday || date !== snap.today ? 0 : 1);
    toast(prs.length ? `Récord en ${prs.map((p) => `${p.exercise} (1RM est. ${p.e1rm} kg)`).join(", ")} ✓` : `Entreno guardado. Semana: ${wk}/${snap.workouts.goalMin}. Sumá 30–40 g de proteína en la próxima comida.`);
    nav("/entrenos");
  };

  return (
    <div>
      <div className="header"><h1>{editing ? "Editar entreno" : "Nuevo entreno"}</h1></div>
      <div className="card">
        <div className="seg">
          {(["fuerza", "cardio", "otro"] as WorkoutType[]).map((t) => <button key={t} className={type === t ? "on" : ""} onClick={() => setType(t)}>{t}</button>)}
        </div>
        <div className="grid2" style={{ marginTop: 10 }}>
          <label className="field"><span>Fecha</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field"><span>Minutos</span><input type="number" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
        </div>
      </div>

      {type === "cardio" && (
        <div className="card">
          <h2>Cardio</h2>
          <div className="chips" style={{ flexWrap: "wrap" }}>
            {(Object.keys(CARDIO_TYPES) as CardioModality[]).map((m) => (
              <button key={m} className={`chip ${modality === m ? "on" : ""}`} onClick={() => setModality(m)}>{CARDIO_TYPES[m].label}</button>
            ))}
          </div>
          <div className="seg" style={{ marginTop: 10 }}>
            {(["suave", "moderada", "intensa"] as CardioIntensity[]).map((x, i) => (
              <button key={x} className={intensity === x ? "on" : ""} onClick={() => setIntensity(x)}>
                {x}<div className="faint" style={{ fontSize: 11, fontWeight: 400 }}>{CARDIO_TYPES[modality].hint[i]}</div>
              </button>
            ))}
          </div>
          <div className="grid2" style={{ marginTop: 10 }}>
            <label className="field"><span>FC promedio (opcional)</span><input type="number" inputMode="numeric" value={hr} onChange={(e) => setHr(e.target.value)} placeholder="lpm" /></label>
            <label className="field"><span>kcal del reloj (opcional)</span><input type="number" inputMode="numeric" value={deviceKcal} onChange={(e) => setDeviceKcal(e.target.value)} /></label>
          </div>
          {!data.config.profile.age && hr && <div className="faint" style={{ marginTop: 6 }}>Para usar la FC cargá tu edad en Ajustes.</div>}
          <div className="banner" style={{ marginTop: 10 }}>
            {minutes > 0
              ? <>≈ <strong>{est.net_kcal} kcal netas</strong> ({est.detail}). Suma <strong>+{bonusPreview} kcal</strong> al objetivo del día ({Math.round(data.config.cardio.eatback * 100)}%), sobre todo en carbos.</>
              : "Cargá los minutos para estimar el gasto."}
          </div>
          <p className="faint" style={{ marginBottom: 0 }}>Bici y caminata inclinada interfieren menos con la fuerza que correr. Si es día de piernas, mejor después de entrenar o separado ≥6 h.</p>
        </div>
      )}

      {type !== "cardio" && exs.map((e, i) => (
        <div className="card" key={e.name}>
          <div className="row between">
            <h3 style={{ margin: 0 }}>{e.name}</h3>
            <button className="icon-btn" aria-label={`Quitar ${e.name}`} onClick={() => setExs((x) => x.filter((_, ii) => ii !== i))}><IconTrash /></button>
          </div>
          {e.sets.map((s, j) => (
            <div className="row" key={j} style={{ marginTop: 6 }}>
              <span className="faint" style={{ width: 26 }}>{j + 1}</span>
              <input type="number" inputMode="decimal" step="2.5" value={s.kg || ""} onChange={(ev) => setSet(i, j, "kg", Number(ev.target.value))} aria-label="kg" style={{ flex: 1, minWidth: 0 }} />
              <span className="faint" style={{ whiteSpace: "nowrap" }}>kg ×</span>
              <input type="number" inputMode="numeric" value={s.reps || ""} onChange={(ev) => setSet(i, j, "reps", Number(ev.target.value))} aria-label="reps" style={{ flex: 1, minWidth: 0 }} />
              <span className="faint">reps</span>
              <button className="icon-btn" aria-label="Quitar serie" onClick={() => setExs((x) => x.map((ee, ii) => (ii !== i ? ee : { ...ee, sets: ee.sets.filter((_, jj) => jj !== j) })))}>−</button>
            </div>
          ))}
          <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setExs((x) => x.map((ee, ii) => (ii !== i ? ee : { ...ee, sets: [...ee.sets, { ...(ee.sets[ee.sets.length - 1] ?? { reps: 10, kg: 0 }) }] })))}>+ Serie</button>
        </div>
      ))}

      <div className="card" style={type === "cardio" ? { display: "none" } : undefined}>
        <h2>Agregar ejercicio</h2>
        <div className="chips" style={{ flexWrap: "wrap" }}>
          {catalog.filter((n) => !exs.some((e) => normalizeExercise(e.name) === normalizeExercise(n))).map((n) => (
            <button key={n} className="chip" onClick={() => addExercise(n)}>{n}</button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input type="text" placeholder="Otro ejercicio…" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <button className="btn" onClick={() => { addExercise(custom); setCustom(""); }}>Agregar</button>
        </div>
        <textarea style={{ marginTop: 8, minHeight: 60 }} placeholder="Notas (cómo te sentiste, dolor, etc.)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {type === "cardio" && <textarea style={{ marginBottom: 12, minHeight: 60 }} placeholder="Notas" value={notes} onChange={(e) => setNotes(e.target.value)} />}
      <button className="btn primary block" onClick={save} disabled={(type === "fuerza" && !exs.length) || (type === "cardio" && minutes <= 0)}>Guardar {type === "cardio" ? "cardio" : "entreno"}</button>
    </div>
  );
}

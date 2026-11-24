import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  type Food, itemFromFood, type MealTemplate, type NudgeKind, type ReminderKey, totalsOf, type UserConfig,
} from "@core";
import { useStore } from "../lib/store";
import { supabase } from "../lib/supabase";
import { disablePush, enablePush, pushState, type PushState, testPush } from "../lib/push";
import { Sheet } from "../components/Sheet";
import { deleteKey, keyStatus, type KeyStatus, saveKey } from "../lib/apiKey";
import { ItemsEditor } from "../components/ItemsEditor";
import { IconBack } from "../components/Icons";

const REMINDERS: [ReminderKey, string][] = [
  ["manana", "Plan de la mañana"], ["desayuno", "Desayuno"], ["almuerzo", "Almuerzo"], ["merienda", "Merienda"],
  ["cena", "Cena"], ["tarde", "Proyección de la tarde"], ["noche", "Cierre del día"], ["semanal", "Cierre semanal"],
];
const KINDS: [NudgeKind, string][] = [
  ["manana", "Plan de la mañana"], ["desayuno", "Desayuno"], ["almuerzo", "Almuerzo"], ["merienda", "Merienda"], ["cena", "Cena"],
  ["pre_entreno", "Pre entreno"], ["post_entreno", "Post entreno"], ["tarde", "Proyección"], ["noche", "Cierre del día"],
  ["semanal", "Cierre semanal"], ["medidas", "Medidas"],
];
const DAYS = ["D", "L", "M", "M", "J", "V", "S"];

function Num({ label, value, onChange, step = 1 }: { label: string; value: number | null | undefined; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="field"><span>{label}</span>
      <input type="number" inputMode="decimal" step={step} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function FoodEditor({ food, onClose }: { food: Food | null; onClose: () => void }) {
  const { actions } = useStore();
  const [f, setF] = useState<Food>(food ?? { id: "", name: "", portion_label: "100 g", portion_g: 100, kcal: 0, p: 0, c: 0, f: 0, aliases: [] });
  useEffect(() => { if (food) setF(food); }, [food]);
  const save = async () => {
    const id = f.id || f.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!f.name || !id || f.portion_g <= 0) return;
    await actions.saveFood({ ...f, id });
    onClose();
  };
  const k = f.p * 4 + f.c * 4 + f.f * 9;
  return (
    <div className="stack">
      <label className="field"><span>Nombre</span><input type="text" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Alias (separados por coma) — ayudan a la IA</span><input type="text" value={(f.aliases ?? []).join(", ")} onChange={(e) => setF({ ...f, aliases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></label>
      <div className="grid2">
        <label className="field"><span>Porción (texto)</span><input type="text" value={f.portion_label} onChange={(e) => setF({ ...f, portion_label: e.target.value })} /></label>
        <Num label="Gramos de la porción" value={f.portion_g} onChange={(v) => setF({ ...f, portion_g: v })} />
      </div>
      <div className="grid4">
        <Num label="kcal" value={f.kcal} onChange={(v) => setF({ ...f, kcal: v })} />
        <Num label="P" value={f.p} step={0.1} onChange={(v) => setF({ ...f, p: v })} />
        <Num label="C" value={f.c} step={0.1} onChange={(v) => setF({ ...f, c: v })} />
        <Num label="G" value={f.f} step={0.1} onChange={(v) => setF({ ...f, f: v })} />
      </div>
      {f.kcal > 0 && Math.abs(k - f.kcal) / f.kcal > 0.15 && <div className="banner">Ojo: 4·P + 4·C + 9·G = {Math.round(k)} kcal, distinto de {f.kcal}.</div>}
      <div className="row">
        {food && <button className="btn danger" onClick={async () => { await actions.deleteFood(food.id); onClose(); }}>Borrar</button>}
        <button className="btn primary grow" onClick={save}>Guardar</button>
      </div>
    </div>
  );
}

function TemplateEditor({ tpl, onClose }: { tpl: MealTemplate | null; onClose: () => void }) {
  const { actions, data } = useStore();
  const [t, setT] = useState<MealTemplate>(tpl ?? { id: "", code: "", slot: "almuerzo", name: "", items: [], totals: { kcal: 0, p: 0, c: 0, f: 0 } });
  const [q, setQ] = useState("");
  const results = q ? data.foods.filter((f) => f.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  const save = async () => {
    if (!t.code || !t.name) return;
    await actions.saveTemplate({ ...t, id: t.id || t.code.toLowerCase(), totals: totalsOf(t.items) });
    onClose();
  };
  return (
    <div className="stack">
      <div className="grid2">
        <label className="field"><span>Código</span><input type="text" value={t.code} onChange={(e) => setT({ ...t, code: e.target.value.toUpperCase() })} placeholder="A16" /></label>
        <label className="field"><span>Momento</span>
          <select value={t.slot} onChange={(e) => setT({ ...t, slot: e.target.value as MealTemplate["slot"] })}>
            <option value="desayuno">Desayuno</option><option value="almuerzo">Almuerzo</option><option value="merienda">Merienda</option><option value="cena">Cena</option>
          </select>
        </label>
      </div>
      <label className="field"><span>Nombre</span><input type="text" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
      <ItemsEditor items={t.items} foods={data.foods} onChange={(items) => setT({ ...t, items })} />
      <input type="search" placeholder="Agregar alimento…" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.map((f) => (
        <button key={f.id} className="btn sm ghost block" style={{ justifyContent: "flex-start" }} onClick={() => { setT({ ...t, items: [...t.items, itemFromFood(f, f.portion_g)] }); setQ(""); }}>+ {f.name}</button>
      ))}
      <div className="row">
        {tpl && <button className="btn danger" onClick={async () => { await actions.deleteTemplate(tpl.id); onClose(); }}>Borrar</button>}
        <button className="btn primary grow" onClick={save}>Guardar</button>
      </div>
    </div>
  );
}

function parseFoodsCSV(text: string): Food[] {
  // nombre;porcion;gramos;kcal;p;c;g[;alias1|alias2]  (también acepta coma como separador)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sep = lines[0]?.includes(";") ? ";" : ",";
  const out: Food[] = [];
  for (const l of lines) {
    const c = l.split(sep).map((s) => s.trim());
    if (c.length < 7 || isNaN(Number(c[2]))) continue;
    const id = c[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    out.push({ id, name: c[0], portion_label: c[1], portion_g: Number(c[2]), kcal: Number(c[3]), p: Number(c[4]), c: Number(c[5]), f: Number(c[6]), aliases: c[7] ? c[7].split("|").map((s) => s.trim()) : [] });
  }
  return out;
}

function ApiKeyCard() {
  const { toast, repo } = useStore();
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { keyStatus().then(setStatus).catch(() => setStatus(null)); }, []);
  const save = async () => {
    setBusy(true);
    try {
      setStatus(await saveKey(value));
      setValue("");
      toast(repo.mode === "cloud" ? "Key validada y guardada cifrada en el servidor ✓" : "Key guardada en este dispositivo ✓");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2>API key de Claude</h2>
      {status?.configured ? (
        <p className="small" style={{ marginTop: 0 }}>
          ✓ Configurada {status.last4 ? <span className="kbd">sk-ant-…{status.last4}</span> : null}
          {status.source === "servidor" ? " (key del servidor)" : status.source === "dispositivo" ? " (en este dispositivo)" : " (cifrada en tu Supabase)"}
        </p>
      ) : (
        <p className="small muted" style={{ marginTop: 0 }}>Sin key: la IA (registro por texto/foto y coach) no funciona; todo lo demás sí.</p>
      )}
      <div className="row">
        <input
          type="password" autoComplete="off" spellCheck={false} placeholder={status?.configured ? "Reemplazar por otra key" : "sk-ant-…"}
          value={value} onChange={(e) => setValue(e.target.value)} aria-label="API key de Claude"
        />
        <button className="btn primary" onClick={save} disabled={busy || !value.trim()}>{busy ? <span className="spinner" /> : "Guardar"}</button>
      </div>
      {status?.source === "app" || status?.source === "dispositivo" ? (
        <button className="btn sm ghost danger" style={{ marginTop: 6 }} onClick={() => confirm("¿Borrar la API key?") && deleteKey().then(setStatus).catch((e) => toast(e.message, "error"))}>Borrar key</button>
      ) : null}
      <p className="faint" style={{ marginBottom: 0 }}>
        {repo.mode === "cloud"
          ? "Se valida con Anthropic y se guarda cifrada en Supabase Vault. No queda en el código, en GitHub ni en este navegador, y la app nunca la vuelve a mostrar."
          : "Modo local: queda guardada solo en este dispositivo y se usa con el servidor de desarrollo. No queda en el código ni en GitHub."}
        {" "}La sacás en console.anthropic.com → API Keys. Te conviene ponerle un límite de gasto mensual ahí.
      </p>
    </div>
  );
}

export default function Settings() {
  const { data, actions, toast, repo, snap } = useStore();
  const [cfg, setCfg] = useState<UserConfig>(data.config);
  const [push, setPush] = useState<PushState>("unsupported");
  const [foodEdit, setFoodEdit] = useState<Food | null | "new">(null);
  const [tplEdit, setTplEdit] = useState<MealTemplate | null | "new">(null);
  const [foodQ, setFoodQ] = useState("");
  const [usage, setUsage] = useState<number | null>(null);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(data.config);

  useEffect(() => {
    setCfg(data.config);
  }, [data.config]);
  useEffect(() => { pushState().then(setPush).catch(() => {}); }, []);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("ai_usage").select("id", { count: "exact", head: true }).eq("local_date", snap.today).then(({ count }) => setUsage(count ?? 0));
  }, [snap.today]);

  const set = <K extends keyof UserConfig>(k: K, v: UserConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const save = async () => { await actions.saveConfig(cfg); toast("Ajustes guardados"); };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exported_at: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `coach-nutricion-${snap.today}.json`;
    a.click();
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    try {
      if (file.name.endsWith(".csv") || file.name.endsWith(".txt")) {
        const foods = parseFoodsCSV(text);
        if (!foods.length) throw new Error("No encontré filas válidas");
        for (const f of foods) await actions.saveFood(f);
        toast(`${foods.length} alimentos importados`);
      } else {
        const j = JSON.parse(text);
        if (!confirm("Esto reemplaza/actualiza tus datos con los del archivo. ¿Seguir?")) return;
        await actions.importAll(j);
        toast("Datos importados");
      }
    } catch (e) {
      toast(`No pude importar: ${(e as Error).message}`, "error");
    }
  };

  const foods = data.foods.filter((f) => !foodQ || f.name.toLowerCase().includes(foodQ.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const tpls = [...data.templates].sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }));

  return (
    <div>
      <div className="header">
        <div className="row"><Link to="/" className="icon-btn" aria-label="Volver"><IconBack /></Link><h1>Ajustes</h1></div>
        {dirty && <button className="btn primary sm" onClick={save}>Guardar</button>}
      </div>

      <div className="card">
        <h2>Cuenta y datos</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          {repo.mode === "cloud" ? "Modo nube: tus datos están en tu proyecto de Supabase, protegidos por RLS, y se sincronizan entre dispositivos." : "Modo local: tus datos quedan solo en este dispositivo. Exportá un respaldo de vez en cuando."}
          {" "}Privado: no hay función de compartir.
        </p>
        <div className="row wrap">
          <button className="btn sm" onClick={exportData}>Exportar respaldo</button>
          <label className="btn sm">Importar (JSON o CSV de alimentos)<input type="file" accept=".json,.csv,.txt" hidden onChange={(e) => importFile(e.target.files?.[0])} /></label>
          {supabase && <button className="btn sm ghost" onClick={() => supabase!.auth.signOut().then(() => location.reload())}>Cerrar sesión</button>}
        </div>
      </div>

      <div className="card">
        <h2>Objetivos diarios</h2>
        <div className="grid4">
          <Num label="kcal" value={cfg.targets.kcal} onChange={(v) => set("targets", { ...cfg.targets, kcal: v })} />
          <Num label="Proteína" value={cfg.targets.p} onChange={(v) => set("targets", { ...cfg.targets, p: v })} />
          <Num label="Carbos" value={cfg.targets.c} onChange={(v) => set("targets", { ...cfg.targets, c: v })} />
          <Num label="Grasas" value={cfg.targets.f} onChange={(v) => set("targets", { ...cfg.targets, f: v })} />
        </div>
        <h3 style={{ marginTop: 12 }}>Rangos aceptables (checklist de cierre)</h3>
        <div className="grid4">
          <Num label="kcal mín" value={cfg.ranges.kcal[0]} onChange={(v) => set("ranges", { ...cfg.ranges, kcal: [v, cfg.ranges.kcal[1]] })} />
          <Num label="kcal máx" value={cfg.ranges.kcal[1]} onChange={(v) => set("ranges", { ...cfg.ranges, kcal: [cfg.ranges.kcal[0], v] })} />
          <Num label="P mín" value={cfg.ranges.pMin} onChange={(v) => set("ranges", { ...cfg.ranges, pMin: v })} />
          <Num label="Regla carbos (g)" value={cfg.carb_rule_threshold} onChange={(v) => set("carb_rule_threshold", v)} />
          <Num label="C mín" value={cfg.ranges.c[0]} onChange={(v) => set("ranges", { ...cfg.ranges, c: [v, cfg.ranges.c[1]] })} />
          <Num label="C máx" value={cfg.ranges.c[1]} onChange={(v) => set("ranges", { ...cfg.ranges, c: [cfg.ranges.c[0], v] })} />
          <Num label="G mín" value={cfg.ranges.f[0]} onChange={(v) => set("ranges", { ...cfg.ranges, f: [v, cfg.ranges.f[1]] })} />
          <Num label="G máx" value={cfg.ranges.f[1]} onChange={(v) => set("ranges", { ...cfg.ranges, f: [cfg.ranges.f[0], v] })} />
        </div>
        <label className="row small" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={cfg.simple_mode} onChange={(e) => set("simple_mode", e.target.checked)} />
          Modo simple: mostrar solo kcal y proteína (menos números, menos obsesión)
        </label>
      </div>

      <div className="card">
        <h2>Base científica</h2>
        <p className="faint" style={{ marginTop: 0 }}>Tus objetivos contra la evidencia (con tu peso de tendencia y gasto estimado actuales).</p>
        {snap.evidence.map((e) => (
          <div key={e.key} className="list-item small" style={{ alignItems: "flex-start" }}>
            <span style={{ width: 18 }}>{e.ok ? "✓" : "⚠"}</span>
            <div className="grow">
              <div><strong>{e.label}:</strong> {e.value}</div>
              <div className="faint">Guía: {e.guide} · {e.source}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Cardio y ajuste automático</h2>
        <label className="field"><span>Del gasto neto del cardio, cuánto se suma al objetivo del día</span>
          <div className="seg">
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <button key={v} className={cfg.cardio.eatback === v ? "on" : ""} onClick={() => set("cardio", { ...cfg.cardio, eatback: v })}>{v * 100}%</button>
            ))}
          </div>
        </label>
        <p className="faint">50% recomendado: las estimaciones (y los relojes) sobreestiman el gasto y el cuerpo compensa una parte. 0% = el cardio suma todo al déficit.</p>
        <div className="grid2">
          <Num label="Tope por día (kcal)" value={cfg.cardio.max_bonus} onChange={(v) => set("cardio", { ...cfg.cardio, max_bonus: v })} />
          <Num label="Pasos objetivo" value={cfg.steps_goal} step={500} onChange={(v) => set("steps_goal", v)} />
        </div>
        <label className="row small" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={cfg.auto_adjust.enabled} onChange={(e) => set("auto_adjust", { ...cfg.auto_adjust, enabled: e.target.checked })} />
          Revisión semanal del objetivo (te propone subir/bajar 100–150 kcal según tu ritmo real; vos lo aplicás)
        </label>
        <label className="row small" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={cfg.cycle.enabled} onChange={(e) => set("cycle", { ...cfg.cycle, enabled: e.target.checked })} />
          Registrar ciclo (para interpretar subidas de agua en la balanza)
        </label>
        {cfg.cycle.enabled && <div style={{ marginTop: 8 }}><Num label="Duración del ciclo (días)" value={cfg.cycle.length} onChange={(v) => set("cycle", { ...cfg.cycle, length: v })} /></div>}
        {cfg.target_history.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary className="faint">Historial de ajustes ({cfg.target_history.length})</summary>
            {[...cfg.target_history].reverse().map((h, i) => <div key={i} className="small faint">{h.date}: {h.kcal} kcal — {h.reason}</div>)}
          </details>
        )}
      </div>

      <div className="card">
        <h2>Objetivo y perfil</h2>
        <div className="grid4" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <Num label="Peso inicial" step={0.1} value={cfg.goal.start_kg} onChange={(v) => set("goal", { ...cfg.goal, start_kg: v })} />
          <Num label="Objetivo mín" step={0.5} value={cfg.goal.target_min} onChange={(v) => set("goal", { ...cfg.goal, target_min: v })} />
          <Num label="Objetivo máx" step={0.5} value={cfg.goal.target_max} onChange={(v) => set("goal", { ...cfg.goal, target_max: v })} />
          <Num label="Altura (cm)" value={cfg.profile.height_cm} onChange={(v) => set("profile", { ...cfg.profile, height_cm: v || null })} />
          <Num label="Edad" value={cfg.profile.age} onChange={(v) => set("profile", { ...cfg.profile, age: v || null })} />
        </div>
        <p className="faint">Altura y edad mejoran la estimación inicial del gasto; después se ajusta sola con tus datos.</p>
        <label className="field"><span>Tu “por qué”, en tus palabras (el coach lo usa cuando la semana viene floja)</span>
          <textarea value={cfg.why} onChange={(e) => set("why", e.target.value)} placeholder="ej: sentirme liviana y con energía en las guardias" />
        </label>
        <label className="field" style={{ marginTop: 8 }}><span>Reintroducciones (separadas por coma)</span>
          <input type="text" value={cfg.reintroductions.join(", ")} onChange={(e) => set("reintroductions", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />
        </label>
      </div>

      <div className="card">
        <h2>Horarios</h2>
        <div className="grid2">
          {REMINDERS.map(([k, label]) => (
            <label className="field" key={k}><span>{label}</span>
              <input type="time" value={cfg.reminders[k] ?? ""} onChange={(e) => set("reminders", { ...cfg.reminders, [k]: e.target.value || null })} />
            </label>
          ))}
        </div>
        <label className="field" style={{ marginTop: 8 }}><span>Día del cierre semanal</span>
          <select value={cfg.weekly_review_day} onChange={(e) => set("weekly_review_day", Number(e.target.value))}>
            {["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"].map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </label>
        <h3 style={{ marginTop: 12 }}>Entreno</h3>
        <div className="row" style={{ gap: 4 }}>
          {DAYS.map((d, i) => (
            <button key={i} className={`chip ${cfg.workout.days.includes(i) ? "on" : ""}`} onClick={() => set("workout", { ...cfg.workout, days: cfg.workout.days.includes(i) ? cfg.workout.days.filter((x) => x !== i) : [...cfg.workout.days, i].sort() })}>{d}</button>
          ))}
        </div>
        <div className="grid4" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 8 }}>
          <label className="field"><span>Hora</span><input type="time" value={cfg.workout.time} onChange={(e) => set("workout", { ...cfg.workout, time: e.target.value })} /></label>
          <Num label="Mín/sem" value={cfg.workout.weekly_min} onChange={(v) => set("workout", { ...cfg.workout, weekly_min: v })} />
          <Num label="Máx/sem" value={cfg.workout.weekly_max} onChange={(v) => set("workout", { ...cfg.workout, weekly_max: v })} />
        </div>
        <h3 style={{ marginTop: 12 }}>Silencio</h3>
        <div className="grid2">
          <label className="field"><span>Desde</span><input type="time" value={cfg.quiet_hours.start} onChange={(e) => set("quiet_hours", { ...cfg.quiet_hours, start: e.target.value })} /></label>
          <label className="field"><span>Hasta</span><input type="time" value={cfg.quiet_hours.end} onChange={(e) => set("quiet_hours", { ...cfg.quiet_hours, end: e.target.value })} /></label>
        </div>
      </div>

      <div className="card">
        <h2>Notificaciones</h2>
        {push === "needs-install" && <div className="banner">En iPhone: tocá Compartir → <strong>Agregar a inicio</strong> y abrí la app desde ese ícono. iOS solo permite notificaciones así (iOS 16.4+).</div>}
        {push === "no-server" && <div className="banner">Las push programadas necesitan el modo nube (Supabase + clave VAPID). En modo local, el coach te habla dentro de la app.</div>}
        {push === "unsupported" && <div className="banner">Este navegador no soporta notificaciones push.</div>}
        {push === "denied" && <div className="banner">Bloqueaste las notificaciones: habilitalas desde los ajustes del sistema para esta app.</div>}
        {(push === "off" || push === "on") && (
          <div className="row wrap">
            {push === "off"
              ? <button className="btn primary sm" onClick={() => enablePush().then(() => { setPush("on"); toast("Notificaciones activadas en este dispositivo"); }).catch((e) => toast(e.message, "error"))}>Activar en este dispositivo</button>
              : <button className="btn sm" onClick={() => disablePush().then(() => setPush("off"))}>Desactivar en este dispositivo</button>}
            {push === "on" && <button className="btn sm" onClick={() => testPush().then((m) => toast(m)).catch((e) => toast(e.message, "error"))}>Enviar prueba</button>}
          </div>
        )}
        <label className="row small" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={cfg.notifications.enabled} onChange={(e) => set("notifications", { ...cfg.notifications, enabled: e.target.checked })} />
          Coach proactivo activo
        </label>
        <div className="grid2" style={{ marginTop: 6 }}>
          {KINDS.map(([k, label]) => (
            <label key={k} className="row small">
              <input type="checkbox" checked={cfg.notifications.kinds[k] !== false} onChange={(e) => set("notifications", { ...cfg.notifications, kinds: { ...cfg.notifications.kinds, [k]: e.target.checked } })} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <ApiKeyCard />

      <div className="card">
        <h2>IA</h2>
        <Num label="Límite de consultas por día (presupuesto)" value={cfg.ai_daily_limit} onChange={(v) => set("ai_daily_limit", v)} />
        <p className="faint">
          Parseo de comidas con un modelo chico y rápido; coach y análisis con uno más potente. Los recordatorios usan plantillas (sin costo).
          {usage != null ? ` Hoy: ${usage}/${cfg.ai_daily_limit}.` : ""} La API key vive solo en el servidor.
        </p>
      </div>

      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Alimentos ({data.foods.length})</h2><button className="btn sm" onClick={() => setFoodEdit("new")}>+ Nuevo</button></div>
        <p className="faint">CSV: <span className="kbd">nombre;porción;gramos;kcal;p;c;g;alias1|alias2</span></p>
        <input type="search" placeholder="Buscar…" value={foodQ} onChange={(e) => setFoodQ(e.target.value)} />
        <div style={{ maxHeight: 300, overflow: "auto", marginTop: 6 }}>
          {foods.map((f) => (
            <div className="list-item small" key={f.id} onClick={() => setFoodEdit(f)} style={{ cursor: "pointer" }}>
              <span className="grow">{f.name} <span className="faint">· {f.portion_label}</span></span>
              <span className="faint num">{f.kcal} kcal · P {f.p}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="row between"><h2 style={{ margin: 0 }}>Plantillas ({data.templates.length})</h2><button className="btn sm" onClick={() => setTplEdit("new")}>+ Nueva</button></div>
        <p className="faint">Opciones del proyecto Nutrición: A1–A15 almuerzos, C1–C10 cenas, D desayunos, M meriendas. Reemplazalas por las tuyas.</p>
        {tpls.map((t) => (
          <div className="list-item small" key={t.id} onClick={() => setTplEdit(t)} style={{ cursor: "pointer" }}>
            <span className="grow"><strong>{t.code}</strong> {t.name}</span>
            <span className="faint num">{Math.round(t.totals.kcal)} kcal · P {Math.round(t.totals.p)}</span>
          </div>
        ))}
      </div>

      {dirty && <button className="btn primary block" onClick={save}>Guardar ajustes</button>}

      <Sheet open={foodEdit !== null} onClose={() => setFoodEdit(null)} title={foodEdit === "new" ? "Nuevo alimento" : "Editar alimento"}>
        {foodEdit !== null && <FoodEditor food={foodEdit === "new" ? null : foodEdit} onClose={() => setFoodEdit(null)} />}
      </Sheet>
      <Sheet open={tplEdit !== null} onClose={() => setTplEdit(null)} title={tplEdit === "new" ? "Nueva plantilla" : "Editar plantilla"}>
        {tplEdit !== null && <TemplateEditor tpl={tplEdit === "new" ? null : tplEdit} onClose={() => setTplEdit(null)} />}
      </Sheet>
    </div>
  );
}

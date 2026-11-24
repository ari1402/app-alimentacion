// Ajustes y chequeos basados en evidencia. Cada regla cita su fuente para que
// el coach (y Ari) sepan de dónde sale. Nada cambia solo: el coach propone y ella aplica.
//
// Referencias principales:
// - Ritmo de baja 0.5–1.0 %/sem para preservar masa magra en entrenadas en fuerza:
//   Helms, Aragon & Fitschen 2014 (JISSN); Garthe 2011 (IJSNEM: 0.7 %/sem preservó
//   más masa magra y fuerza que 1.4 %/sem).
// - Proteína 1.6–2.2 g/kg/día (Morton 2018, BJSM, meta-análisis); en déficit con
//   fuerza, parte alta (Helms 2014: 2.3–3.1 g/kg de masa magra).
// - Reparto 0.3–0.4 g/kg por comida en 3–5 comidas (Schoenfeld & Aragon 2018, JISSN).
// - Proteína antes de dormir (~30–40 g de caseína) mejora la síntesis nocturna
//   (Res 2012; Snijders 2015).
// - Grasas ≥ 20 % de las kcal / ≥ 0.5 g/kg (posición ISSN; salud hormonal).
// - Volumen: ≥ 10 series duras/grupo/semana para hipertrofia (Schoenfeld 2017,
//   dosis-respuesta); para mantener, con la intensidad (carga) alta alcanza con
//   bastante menos volumen (Bickel 2011; Spiering 2021).
// - Pausas de mantenimiento: MATADOR (Byrne 2018, 2 sem déficit / 2 sem mantenimiento:
//   más pérdida de grasa y menos adaptación) y Peos 2021 (ICECAP: menos hambre).
// - Sueño corto aumenta la pérdida de masa magra en déficit (Nedeltcheva 2010).
// - Fase lútea: retención de agua típica de 0.5–2 kg (Bunt 1989; White 2011).
// - Concurrencia: el cardio de bajo impacto (bici, caminata inclinada) interfiere menos
//   con la fuerza que correr (Wilson 2012, meta-análisis); separar ≥ 6 h o hacerlo después.
import type { BodyMetric, Macros, Meal, UserConfig, Workout } from "./types.ts";
import { addDays, diffDays } from "./dates.ts";
import { bestSet, normalizeExercise } from "./workouts.ts";
import { daySummaries } from "./week.ts";
import { type Projection, SAFETY_FLOOR_KCAL } from "./weight.ts";
import { weeksInDeficit } from "./cardio.ts";
import { sleepStats } from "./health.ts";

// ─────────────────────────── Fuerza: ¿se mantiene? ───────────────────────────

export interface StrengthSignal {
  exercise: string;
  recentBest: number;
  priorBest: number;
  changePct: number;
}

/** Mejor 1RM estimado de las últimas 2 semanas vs las 8 previas, por ejercicio */
export function strengthCheck(workouts: Workout[], today: string): { signals: StrengthSignal[]; dropping: StrengthSignal[] } {
  const recentFrom = addDays(today, -14);
  const priorFrom = addDays(today, -70);
  const map = new Map<string, { name: string; recent: number; prior: number }>();
  for (const w of workouts) {
    if (w.local_date < priorFrom || w.local_date > today) continue;
    for (const e of w.exercises) {
      const b = bestSet(e);
      if (!b || b.e1rm <= 0) continue;
      const k = normalizeExercise(e.name);
      const cur = map.get(k) ?? { name: e.name, recent: 0, prior: 0 };
      if (w.local_date >= recentFrom) cur.recent = Math.max(cur.recent, b.e1rm);
      else cur.prior = Math.max(cur.prior, b.e1rm);
      map.set(k, cur);
    }
  }
  const signals = [...map.values()]
    .filter((x) => x.recent > 0 && x.prior > 0)
    .map((x) => ({ exercise: x.name, recentBest: x.recent, priorBest: x.prior, changePct: Math.round(((x.recent - x.prior) / x.prior) * 1000) / 10 }));
  return { signals, dropping: signals.filter((s) => s.changePct <= -7) };
}

// ─────────────────────────── Volumen semanal por grupo ───────────────────────────

const MUSCLES: [RegExp, string[]][] = [
  [/prensa|sentadilla|squat|hack|estocada|zancada|bulgara|step ?up/, ["Cuádriceps", "Glúteos"]],
  [/sillon|extension de cuad|cuadriceps/, ["Cuádriceps"]],
  [/peso muerto|rumano|good morning/, ["Isquios", "Glúteos"]],
  [/camilla|curl femoral|isquio|nordic/, ["Isquios"]],
  [/hip thrust|puente|gluteo|patada|abductor/, ["Glúteos"]],
  [/jalon|dominada|remo|pull|espalda|serrucho/, ["Espalda"]],
  [/press banca|pecho|apertura|flexion|fondos/, ["Pecho"]],
  [/press militar|hombro|vuelos|elevacion lateral|arnold/, ["Hombros"]],
  [/biceps|curl(?! femoral)/, ["Brazos"]],
  [/triceps|frances|extension de triceps/, ["Brazos"]],
  [/plancha|abdominal|core|crunch|pallof/, ["Core"]],
];

export function musclesFor(exercise: string): string[] {
  const n = normalizeExercise(exercise);
  for (const [re, m] of MUSCLES) if (re.test(n)) return m;
  return ["Otros"];
}

export interface MuscleVolume {
  muscle: string;
  sets: number;
  status: "bajo" | "mantenimiento" | "óptimo" | "alto";
}

/** Series por grupo muscular en los últimos 7 días (una serie cuenta para cada grupo principal) */
export function weeklySets(workouts: Workout[], today: string): MuscleVolume[] {
  const from = addDays(today, -6);
  const acc = new Map<string, number>();
  for (const w of workouts) {
    if (w.local_date < from || w.local_date > today) continue;
    for (const e of w.exercises) for (const m of musclesFor(e.name)) acc.set(m, (acc.get(m) ?? 0) + e.sets.length);
  }
  return [...acc.entries()]
    .filter(([m]) => m !== "Otros")
    .map(([muscle, sets]) => ({ muscle, sets, status: (sets < 4 ? "bajo" : sets < 10 ? "mantenimiento" : sets <= 20 ? "óptimo" : "alto") as MuscleVolume["status"] }))
    .sort((a, b) => b.sets - a.sets);
}

// ─────────────────────────── Ciclo ───────────────────────────

export interface CyclePhase {
  day: number;
  phase: "menstrual" | "folicular" | "ovulatoria" | "lútea";
  retention: boolean;
  note: string;
}

export function cyclePhase(cfg: UserConfig, date: string): CyclePhase | null {
  if (!cfg.cycle.enabled || !cfg.cycle.last_start) return null;
  const len = Math.min(40, Math.max(21, cfg.cycle.length || 28));
  const d = diffDays(date, cfg.cycle.last_start);
  if (d < 0 || d > len * 2) return null; // dato viejo: no inventamos
  const day = (d % len) + 1;
  const luteal = day > len - 14;
  const phase: CyclePhase["phase"] = day <= 5 ? "menstrual" : luteal ? "lútea" : day >= len - 16 ? "ovulatoria" : "folicular";
  const retention = day <= 3 || day > len - 7;
  return {
    day,
    phase,
    retention,
    note: retention
      ? "Fase con retención de agua típica (0.5–2 kg). Si la balanza sube, es agua: la tendencia lo absorbe. Puede haber más hambre; priorizá proteína y fibra."
      : phase === "folicular"
        ? "Fase folicular: suele haber mejor tolerancia al entrenamiento intenso."
        : "",
  };
}

// ─────────────────────────── Revisión de objetivos ───────────────────────────

export interface EvidenceItem {
  key: string;
  label: string;
  value: string;
  ok: boolean;
  guide: string;
  source: string;
}

export function evidenceReview(cfg: UserConfig, weightKg: number, tdeeKcal: number): EvidenceItem[] {
  const t = cfg.targets;
  const pkg = t.p / weightKg;
  const fkg = t.f / weightKg;
  const fatPct = (t.f * 9) / t.kcal;
  const ratePct = ((tdeeKcal - t.kcal) * 7) / 7700 / weightKg * 100;
  const perMeal = Math.round(0.4 * weightKg);
  return [
    { key: "proteina", label: "Proteína", value: `${pkg.toFixed(2)} g/kg`, ok: pkg >= 1.6 && pkg <= 2.6, guide: "1.6–2.2 g/kg; en déficit con fuerza, la parte alta", source: "Morton 2018; Helms 2014" },
    { key: "reparto", label: "Proteína por comida", value: `~${Math.round(t.p / Math.max(1, cfg.meals_per_day))} g × ${cfg.meals_per_day}`, ok: t.p / Math.max(1, cfg.meals_per_day) >= 0.3 * weightKg - 2, guide: `0.3–0.4 g/kg por comida (~${Math.round(0.3 * weightKg)}–${perMeal} g), 3–5 comidas`, source: "Schoenfeld & Aragon 2018" },
    { key: "grasas", label: "Grasas", value: `${fkg.toFixed(2)} g/kg · ${Math.round(fatPct * 100)}% kcal`, ok: fkg >= 0.5 && fatPct >= 0.2, guide: "≥ 0.5 g/kg y ≥ 20% de las kcal (salud hormonal)", source: "ISSN; Helms 2014" },
    { key: "ritmo", label: "Ritmo que implica el plan", value: `${ratePct.toFixed(2)} %/sem`, ok: ratePct >= 0.45 && ratePct <= 1.05, guide: "0.5–1.0 % del peso por semana (ideal ~0.7)", source: "Garthe 2011; Helms 2014" },
    { key: "piso", label: "Piso calórico", value: `${t.kcal} kcal`, ok: t.kcal >= SAFETY_FLOOR_KCAL, guide: `nunca por debajo de ${SAFETY_FLOOR_KCAL} kcal con este nivel de entrenamiento`, source: "práctica clínica; riesgo de baja disponibilidad energética" },
    { key: "pasos", label: "Pasos objetivo", value: `${cfg.steps_goal.toLocaleString("es-AR")}`, ok: cfg.steps_goal >= 7000, guide: "7.000–10.000/día; el NEAT cae en déficit y es la palanca más barata", source: "Levine 2005; Paluch 2022 (Lancet Public Health)" },
  ];
}

export interface TargetRecommendation {
  action: "mantener" | "subir" | "bajar" | "consistencia" | "datos" | "esperar";
  deltaKcal: number;
  newTargets: Macros | null;
  title: string;
  reasons: string[];
  alternatives: string[];
  ratePctWeek: number | null;
  idealKgWeek: [number, number];
  dietBreakSuggested: boolean;
}

/**
 * Revisión semanal del objetivo (al estilo de un check-in de coach):
 * 1) ¿hay datos suficientes? 2) ¿se sostuvo el plan? (si no, NO se recorta: primero consistencia)
 * 3) ¿el ritmo está en 0.5–1 %/sem? 4) ¿la fuerza se mantiene? → mantener / subir / bajar.
 * Cambios chicos (±100–150 kcal), solo carbos/grasas, proteína fija, nunca bajo el piso.
 */
export function recommendTargets(
  cfg: UserConfig,
  p: Projection,
  meals: Meal[],
  workouts: Workout[],
  today: string,
  metrics: BodyMetric[] = [],
): TargetRecommendation {
  const sleep = sleepStats(metrics, today);
  // Dormir < 6.5 h en promedio aumenta la pérdida de músculo en déficit (Nedeltcheva 2010)
  const shortSleep = sleep.avg7 != null && sleep.nights7 >= 4 && sleep.avg7 < 6.5;
  const w = p.currentTrend ?? cfg.goal.start_kg;
  const ideal: [number, number] = [Math.round(w * 0.005 * 100) / 100, Math.round(w * 0.01 * 100) / 100];
  const base: TargetRecommendation = { action: "mantener", deltaKcal: 0, newTargets: null, title: "", reasons: [], alternatives: [], ratePctWeek: null, idealKgWeek: ideal, dietBreakSuggested: false };
  const weeks = weeksInDeficit(cfg, today);
  const dietBreakDue = weeks >= 12 && !cfg.diet_break;
  const breakAlt = dietBreakDue ? [`Llevás ${weeks} semanas en déficit: podés hacer 1–2 semanas en mantenimiento. Reduce hambre y adaptación sin frenar el resultado a largo plazo (MATADOR, Byrne 2018).`] : [];

  const last = cfg.target_history[cfg.target_history.length - 1];
  if (last && diffDays(today, last.date) < 14) {
    return { ...base, action: "esperar", title: "Ajuste reciente: esperamos 2 semanas", reasons: [`El último cambio fue el ${last.date}. Hacen falta ~2 semanas para ver el efecto real en la tendencia (el agua y el glucógeno distorsionan la primera).`], alternatives: breakAlt, dietBreakSuggested: dietBreakDue };
  }
  if (p.basis !== "tendencia" || p.kgPerWeek == null) {
    return { ...base, action: "datos", title: "Faltan pesos para evaluar", reasons: ["Para ajustar con criterio necesito 4+ pesos en las últimas 3 semanas (mejor todos los días, a la mañana)."], alternatives: [] };
  }
  const days = daySummaries(meals, cfg, addDays(today, -14), addDays(today, -1), workouts);
  const logged = days.filter((d) => d.status !== "empty");
  const good = logged.filter((d) => d.status === "on" || d.status === "near").length;
  const adherence = logged.length ? good / logged.length : 0;
  const rate = -p.kgPerWeek; // kg/sem perdidos (positivo = baja)
  const pct = (rate / w) * 100;
  base.ratePctWeek = Math.round(pct * 100) / 100;

  if (logged.length < 9) {
    return { ...base, action: "consistencia", title: "Primero, registrar más días", reasons: [`Solo ${logged.length} de 14 días registrados: no se puede distinguir si el plan no funciona o si faltó registrar. Recortar ahora sería a ciegas.`], alternatives: ["Registrar al menos lo principal todos los días durante 2 semanas, aunque sea aproximado."] };
  }
  const strength = strengthCheck(workouts, today);
  const strengthDrop = strength.dropping.length > 0;

  const mk = (delta: number): Macros => {
    const t = cfg.targets;
    let c = t.c + Math.round((delta * 0.75) / 4);
    let f = t.f + Math.round((delta * 0.25) / 9);
    const minF = Math.ceil(0.5 * w);
    if (f < minF) { c -= Math.round(((minF - f) * 9) / 4); f = minF; }
    return { kcal: t.kcal + delta, p: t.p, c: Math.max(80, c), f };
  };

  if (pct > 1.0 || (pct > 0.8 && strengthDrop)) {
    const delta = pct > 1.25 ? 150 : 100;
    return {
      ...base, action: "subir", deltaKcal: delta, newTargets: mk(delta),
      title: `Subir ${delta} kcal: estás bajando más rápido de lo ideal`,
      reasons: [
        `Ritmo: ${pct.toFixed(2)} %/sem (${rate.toFixed(2)} kg). Lo que mejor preserva músculo y fuerza es 0.5–1 %/sem (Garthe 2011).`,
        ...(strengthDrop ? [`La fuerza viene bajando: ${strength.dropping.map((s) => `${s.exercise} ${s.changePct}%`).join(", ")}. Señal de déficit demasiado agresivo.`] : []),
        ...(shortSleep ? [`Además dormís ${sleep.avg7} h en promedio: más razón para no apretar el déficit.`] : []),
        "Las kcal extra van a carbos (mejor rendimiento en el entreno); la proteína queda igual.",
      ],
      alternatives: breakAlt, dietBreakSuggested: dietBreakDue,
    };
  }
  if (adherence < 0.65) {
    return {
      ...base, action: "consistencia", title: "Mantener: el foco es sostener el plan actual",
      reasons: [`${Math.round(adherence * 100)}% de los días registrados estuvieron en rango o cerca. Antes de recortar, conviene que el plan actual sea sostenible: bajar más las calorías suele empeorar la adherencia.`],
      alternatives: ["Elegí UN cambio para la semana (ej. proteína en el desayuno o la cena de plantilla). El paso más chico que puedas sostener.", ...breakAlt],
      dietBreakSuggested: dietBreakDue,
    };
  }
  if (pct < 0.35 && shortSleep) {
    return {
      ...base, action: "mantener", title: "Mantener: primero el sueño",
      reasons: [
        `Ritmo: ${pct.toFixed(2)} %/sem, pero venís durmiendo ${sleep.avg7} h en promedio. Con poco sueño, recortar calorías aumenta la pérdida de músculo y el hambre (Nedeltcheva 2010).`,
        "Antes de bajar calorías: sumar pasos y cuidar el descanso cuando se pueda.",
      ],
      alternatives: ["Sumar ~2.000 pasos/día (≈ 80–100 kcal).", ...breakAlt],
      dietBreakSuggested: dietBreakDue,
    };
  }
  if (pct < 0.35) {
    const room = cfg.targets.kcal - SAFETY_FLOOR_KCAL;
    const delta = room >= 150 ? -150 : room >= 100 ? -100 : 0;
    const alts = [
      `Sumar ~2.000–3.000 pasos/día (≈ 80–150 kcal) en vez de comer menos: el NEAT es lo primero que cae en déficit.`,
      "2 sesiones de 30–40 min de cardio de bajo impacto (cinta inclinada o bici) por semana, idealmente no antes de piernas.",
      ...breakAlt,
    ];
    if (delta === 0) {
      return { ...base, action: "mantener", title: "Estancada, pero ya estás en el piso calórico", reasons: [`Ritmo: ${pct.toFixed(2)} %/sem con buena adherencia. No conviene bajar de ${SAFETY_FLOOR_KCAL} kcal.`], alternatives: alts, dietBreakSuggested: dietBreakDue };
    }
    return {
      ...base, action: "bajar", deltaKcal: delta, newTargets: mk(delta),
      title: `Bajar ${-delta} kcal (o moverte más): el ritmo viene lento`,
      reasons: [
        `Ritmo: ${pct.toFixed(2)} %/sem con ${Math.round(adherence * 100)}% de adherencia. Con el plan bien cumplido, eso indica que el gasto real es menor que el estimado (gasto estimado actual: ${p.tdee.kcal} kcal).`,
        "Se recorta de carbos y grasas; la proteína no se toca.",
      ],
      alternatives: alts, dietBreakSuggested: dietBreakDue,
    };
  }
  const slowish = pct < 0.5;
  return {
    ...base, action: "mantener",
    title: slowish ? "Mantener: ritmo algo lento pero aceptable" : "Mantener: el ritmo está en la zona ideal",
    reasons: [
      slowish
        ? `Ritmo: ${pct.toFixed(2)} %/sem (${rate.toFixed(2)} kg/sem), un poco debajo de 0.5–1 %/sem. Más lento protege más el músculo; si querés acelerar, empezá por los pasos.`
        : `Ritmo: ${pct.toFixed(2)} %/sem (${rate.toFixed(2)} kg/sem), dentro de 0.5–1 %/sem.`,
      strength.signals.length ? (strengthDrop ? `Ojo con la fuerza: ${strength.dropping.map((s) => `${s.exercise} ${s.changePct}%`).join(", ")}. Priorizá sueño y proteína.` : "La fuerza se mantiene: el músculo está protegido.") : "",
    ].filter(Boolean),
    alternatives: slowish ? ["Sumar ~2.000 pasos/día (≈ 80–100 kcal) antes que recortar comida.", ...breakAlt] : breakAlt,
    dietBreakSuggested: dietBreakDue,
  };
}

/** Aplica una recomendación: nuevos objetivos + rangos desplazados + historial */
export function applyTargets(cfg: UserConfig, t: Macros, today: string, reason: string): UserConfig {
  const dk = t.kcal - cfg.targets.kcal;
  const dc = t.c - cfg.targets.c;
  const df = t.f - cfg.targets.f;
  const r = cfg.ranges;
  return {
    ...cfg,
    targets: t,
    ranges: { kcal: [r.kcal[0] + dk, r.kcal[1] + dk], pMin: r.pMin, c: [r.c[0] + dc, r.c[1] + dc], f: [r.f[0] + df, r.f[1] + df] },
    target_history: [...cfg.target_history, { date: today, kcal: t.kcal, reason }].slice(-50),
  };
}

export function stepsAverage(metrics: BodyMetric[], today: string, days = 7): { avg: number | null; n: number } {
  const from = addDays(today, -days);
  const xs = metrics.filter((m) => m.local_date >= from && m.local_date <= today && m.steps && m.steps > 0).map((m) => m.steps as number);
  return { avg: xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null, n: xs.length };
}

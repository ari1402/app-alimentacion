// Peso: tendencia (media móvil exponencial), gasto estimado adaptativo y proyección a objetivo.
import type { BodyMetric, Meal, UserConfig } from "./types.ts";
import { addDays, diffDays } from "./dates.ts";
import { round1 } from "./macros.ts";

export const KCAL_PER_KG = 7700;
/** Piso de seguridad: nunca sugerimos comer menos que esto */
export const SAFETY_FLOOR_KCAL = 1500;
/** Ritmo máximo sostenible que el coach propone (% del peso por semana) */
export const MAX_RATE_PCT_WEEK = 0.01;

export interface TrendPoint {
  date: string;
  kg: number | null; // peso medido ese día (si hubo)
  trend: number;
}

/**
 * Media móvil exponencial que tolera huecos: con α diario = 0.1, un día sin
 * pesarse no "arrastra" la curva. La pantalla muestra la tendencia, no el ruido.
 */
export function weightTrend(metrics: BodyMetric[], alpha = 0.1): TrendPoint[] {
  const pts = metrics
    .filter((m) => typeof m.weight_kg === "number" && m.weight_kg! > 0)
    .sort((a, b) => a.local_date.localeCompare(b.local_date));
  if (!pts.length) return [];
  const out: TrendPoint[] = [];
  let trend = pts[0].weight_kg!;
  let prevDate = pts[0].local_date;
  for (const p of pts) {
    const gap = Math.max(1, diffDays(p.local_date, prevDate));
    const k = 1 - Math.pow(1 - alpha, gap);
    trend = out.length === 0 ? p.weight_kg! : trend + k * (p.weight_kg! - trend);
    out.push({ date: p.local_date, kg: p.weight_kg!, trend });
    prevDate = p.local_date;
  }
  return out.map((p) => ({ ...p, trend: Math.round(p.trend * 100) / 100 }));
}

export interface Slope {
  kgPerDay: number;
  se: number; // error estándar de la pendiente
  n: number;
  spanDays: number;
}

/** Regresión lineal sobre los pesos medidos de los últimos `days` días */
export function weightSlope(trend: TrendPoint[], today: string, days = 21): Slope | null {
  const from = addDays(today, -days);
  const pts = trend.filter((p) => p.date >= from && p.kg != null);
  if (pts.length < 4) return null;
  const xs = pts.map((p) => diffDays(p.date, from));
  const ys = pts.map((p) => p.kg as number);
  const span = xs[xs.length - 1] - xs[0];
  if (span < 7) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - (a + b * xs[i])) ** 2;
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : Math.abs(b);
  return { kgPerDay: b, se, n, spanDays: span };
}

/** Gasto basal estimado (Mifflin-St Jeor) × factor de actividad */
export function priorTDEE(cfg: UserConfig, weightKg: number): number {
  const { height_cm, age, sex } = cfg.profile;
  if (!height_cm || !age) return cfg.targets.kcal + 500; // supuesto: el plan apunta a ~500 de déficit
  const bmr = 10 * weightKg + 6.25 * height_cm - 5 * age + (sex === "f" ? -161 : 5);
  return Math.round(bmr * 1.45);
}

export interface IntakeStats {
  avgKcal: number | null;
  daysLogged: number;
}

/** Promedio de ingesta de días "completos" (≥ 3 comidas o ≥ 1000 kcal) en la ventana */
export function intakeStats(meals: Meal[], today: string, days = 14): IntakeStats {
  const from = addDays(today, -days);
  const byDay = new Map<string, { kcal: number; n: number }>();
  for (const m of meals) {
    if (m.local_date < from || m.local_date >= today) continue;
    const d = byDay.get(m.local_date) ?? { kcal: 0, n: 0 };
    d.kcal += m.totals.kcal;
    d.n += 1;
    byDay.set(m.local_date, d);
  }
  const full = [...byDay.values()].filter((d) => d.n >= 3 || d.kcal >= 1000);
  if (!full.length) return { avgKcal: null, daysLogged: 0 };
  return { avgKcal: Math.round(full.reduce((a, d) => a + d.kcal, 0) / full.length), daysLogged: full.length };
}

export interface TDEEEstimate {
  kcal: number;
  basis: "datos" | "mixto" | "estimado";
  confidence: number; // 0..1
}

/**
 * Gasto real estimado (adaptativo): ingesta promedio + lo que la balanza dice
 * que se perdió. Con pocos datos se mezcla con la estimación teórica.
 */
export function estimateTDEE(cfg: UserConfig, trend: TrendPoint[], meals: Meal[], today: string): TDEEEstimate {
  const current = trend.length ? trend[trend.length - 1].trend : cfg.goal.start_kg;
  const prior = priorTDEE(cfg, current);
  const slope = weightSlope(trend, today, 21);
  const intake = intakeStats(meals, today, 21);
  if (!slope || intake.avgKcal == null || intake.daysLogged < 5) {
    return { kcal: prior, basis: "estimado", confidence: 0.2 };
  }
  const observed = intake.avgKcal - slope.kgPerDay * KCAL_PER_KG;
  const w = Math.min(1, intake.daysLogged / 14) * Math.min(1, slope.n / 8);
  const kcal = Math.round(w * observed + (1 - w) * prior);
  return { kcal, basis: w > 0.7 ? "datos" : "mixto", confidence: round1(0.2 + 0.7 * w) };
}

export interface Scenario {
  key: "actual" | "plan" | "ajuste";
  label: string;
  kgPerWeek: number;
  dateRange: [string, string] | null; // llegada a target_max
  dateRangeMin: [string, string] | null; // llegada a target_min
}

export interface Milestone {
  kg: number;
  reached: boolean;
  remainingKg: number;
  etaDays: number | null;
}

export interface Projection {
  currentTrend: number | null;
  lastWeighDate: string | null;
  basis: "tendencia" | "plan";
  kgPerWeek: number | null;
  /** Rango de fechas para entrar al objetivo (≤ target_max) */
  dateRange: [string, string] | null;
  dateRangeMin: [string, string] | null;
  scenarios: Scenario[];
  milestones: Milestone[];
  nextMilestone: Milestone | null;
  lostKg: number | null;
  remainingKg: number | null;
  tdee: TDEEEstimate;
  needs: string[]; // qué datos faltan para proyectar mejor
  daysPerKg: number | null;
}

function etaRange(today: string, distanceKg: number, kgPerDay: number, uncertainty: number): [string, string] | null {
  if (distanceKg <= 0) return [today, today];
  if (kgPerDay >= -0.005) return null;
  const v = Math.abs(kgPerDay);
  const fast = distanceKg / (v * (1 + uncertainty));
  const slow = distanceKg / (v * Math.max(0.15, 1 - uncertainty));
  if (slow > 730) return null; // más de 2 años: no tiene sentido mostrarlo
  return [addDays(today, Math.round(fast)), addDays(today, Math.round(slow))];
}

export function buildMilestones(start: number, targetMax: number, targetMin: number): number[] {
  const out: number[] = [];
  // Hitos cada 2 kg desde el inicio hasta el objetivo, más el objetivo bajo
  for (let kg = Math.floor(start) - 2; kg > targetMax; kg -= 2) out.push(kg);
  out.push(targetMax);
  if (targetMin < targetMax) out.push(targetMin);
  return out;
}

export function projectGoal(
  cfg: UserConfig,
  metrics: BodyMetric[],
  meals: Meal[],
  today: string,
): Projection {
  const trend = weightTrend(metrics);
  const last = trend.length ? trend[trend.length - 1] : null;
  const tdee = estimateTDEE(cfg, trend, meals, today);
  const needs: string[] = [];
  const current = last?.trend ?? null;
  if (!last) needs.push("Registrá tu peso (idealmente a la mañana, en ayunas) para proyectar.");
  else if (diffDays(today, last.date) > 3) needs.push("Hace unos días que no hay peso; con uno nuevo se recalcula la curva.");
  const intake = intakeStats(meals, today, 14);
  if (intake.daysLogged < 5) needs.push("Con 5+ días completos registrados la estimación del gasto mejora mucho.");

  const slope = weightSlope(trend, today, 21);
  const ref = current ?? cfg.goal.start_kg;
  const planKgPerDay = -(tdee.kcal - cfg.targets.kcal) / KCAL_PER_KG;
  let basis: Projection["basis"] = "plan";
  let kgPerDay = planKgPerDay;
  let unc = 0.45;
  if (slope) {
    basis = "tendencia";
    kgPerDay = slope.kgPerDay;
    unc = Math.min(0.6, Math.max(0.2, Math.abs(slope.se / (slope.kgPerDay || 1e-6)) * 1.5));
  }
  const distMax = ref - cfg.goal.target_max;
  const distMin = ref - cfg.goal.target_min;

  const maxRatePerDay = -(ref * MAX_RATE_PCT_WEEK) / 7;
  const adjustPerDay = Math.max(maxRatePerDay, Math.min(kgPerDay, planKgPerDay) - 200 / KCAL_PER_KG);

  const scenarios: Scenario[] = [];
  if (basis === "tendencia") {
    scenarios.push({
      key: "actual",
      label: "Si sostenés el ritmo actual",
      kgPerWeek: Math.round(kgPerDay * 7 * 100) / 100,
      dateRange: etaRange(today, distMax, kgPerDay, unc),
      dateRangeMin: etaRange(today, distMin, kgPerDay, unc),
    });
  }
  scenarios.push({
    key: "plan",
    label: `Cumpliendo el plan (${cfg.targets.kcal} kcal)`,
    kgPerWeek: Math.round(planKgPerDay * 7 * 100) / 100,
    dateRange: etaRange(today, distMax, planKgPerDay, 0.3),
    dateRangeMin: etaRange(today, distMin, planKgPerDay, 0.3),
  });
  scenarios.push({
    key: "ajuste",
    label: "Con ~200 kcal/día menos (sin bajar de " + SAFETY_FLOOR_KCAL + ")",
    kgPerWeek: Math.round(adjustPerDay * 7 * 100) / 100,
    dateRange: etaRange(today, distMax, adjustPerDay, 0.3),
    dateRangeMin: etaRange(today, distMin, adjustPerDay, 0.3),
  });

  const ms = buildMilestones(cfg.goal.start_kg, cfg.goal.target_max, cfg.goal.target_min).map((kg) => {
    const remainingKg = current == null ? kg - cfg.goal.start_kg : round1(current - kg);
    const reached = current != null && current <= kg;
    const etaDays = !reached && kgPerDay < -0.005 ? Math.round(remainingKg / Math.abs(kgPerDay)) : null;
    return { kg, reached, remainingKg: Math.max(0, remainingKg), etaDays };
  });

  return {
    currentTrend: current,
    lastWeighDate: last?.date ?? null,
    basis,
    kgPerWeek: Math.round(kgPerDay * 7 * 100) / 100,
    dateRange: etaRange(today, distMax, kgPerDay, unc),
    dateRangeMin: etaRange(today, distMin, kgPerDay, unc),
    scenarios,
    milestones: ms,
    nextMilestone: ms.find((m) => !m.reached) ?? null,
    lostKg: current == null ? null : round1(cfg.goal.start_kg - current),
    remainingKg: current == null ? null : Math.max(0, round1(current - cfg.goal.target_max)),
    tdee,
    needs,
    daysPerKg: kgPerDay < -0.005 ? Math.round(1 / Math.abs(kgPerDay)) : null,
  };
}

/** Días de demora en la fecha estimada por un excedente de kcal */
export function delayDaysForKcal(extraKcal: number, dailyDeficit: number): number {
  if (dailyDeficit <= 50) return Math.round(extraKcal / 300); // supuesto conservador
  return Math.round((extraKcal / dailyDeficit) * 10) / 10;
}

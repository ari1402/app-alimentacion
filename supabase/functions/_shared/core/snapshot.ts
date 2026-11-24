// Foto completa del estado de la usuaria en un momento: la usan la pantalla
// principal, los nudges programados y el contexto que recibe la IA.
import type { BodyMetric, CoachEvent, Macros, Meal, MealTemplate, Slot, UserConfig, Workout } from "./types.ts";
import { addDays, localParts } from "./dates.ts";
import { buildDayState, type DayState, typicalBySlot } from "./macros.ts";
import { projectGoal, type Projection } from "./weight.ts";
import { streak, type Streak, weekBudget, type WeekBudget } from "./week.ts";
import { weekWorkoutStatus, type WeekWorkoutStatus } from "./workouts.ts";
import { type AdaptivePlan, computeAdaptive } from "./adaptive.ts";

export interface CoachData {
  meals: Meal[]; // idealmente últimos ~60 días
  workouts: Workout[];
  metrics: BodyMetric[];
  templates: MealTemplate[];
  events: CoachEvent[];
}

export interface Snapshot {
  now: string;
  today: string;
  minutes: number;
  weekday: number;
  cfg: UserConfig;
  day: DayState;
  yesterday: DayState;
  week: WeekBudget;
  workouts: WeekWorkoutStatus;
  projection: Projection;
  streak: Streak;
  typical: Partial<Record<Slot, Macros>>;
  templates: MealTemplate[];
  weighedToday: boolean;
  lastMeasureDate: string | null;
  guardia: boolean;
  adaptive: AdaptivePlan;
}

export function isGuardia(cfg: UserConfig, now: Date): boolean {
  return !!cfg.guardia_until && Date.parse(cfg.guardia_until) > now.getTime();
}

export function buildSnapshot(cfg: UserConfig, data: CoachData, now: Date = new Date()): Snapshot {
  const lp = localParts(now, cfg.timezone);
  const today = lp.date;
  const measures = data.metrics
    .filter((m) => m.waist_cm || m.hip_cm || m.thigh_cm)
    .map((m) => m.local_date)
    .sort();
  return {
    now: now.toISOString(),
    today,
    minutes: lp.minutes,
    weekday: lp.weekday,
    cfg,
    day: buildDayState(today, data.meals, cfg),
    yesterday: buildDayState(addDays(today, -1), data.meals, cfg),
    week: weekBudget(data.meals, cfg, today),
    workouts: weekWorkoutStatus(cfg, data.workouts, today),
    projection: projectGoal(cfg, data.metrics, data.meals, today),
    streak: streak(data.meals, cfg, today),
    typical: typicalBySlot(data.meals, 14, today),
    templates: data.templates,
    weighedToday: data.metrics.some((m) => m.local_date === today && m.weight_kg),
    lastMeasureDate: measures.length ? measures[measures.length - 1] : null,
    guardia: isGuardia(cfg, now),
    adaptive: computeAdaptive(cfg, data.meals, data.events, today),
  };
}

/** Contexto compacto (texto) para que la IA no tenga que hacer cuentas */
export function snapshotForAI(s: Snapshot): string {
  const c = s.cfg;
  const d = s.day;
  const p = s.projection;
  const lines = [
    `Fecha local: ${s.today} (${["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][s.weekday]}), hora ${String(Math.floor(s.minutes / 60)).padStart(2, "0")}:${String(s.minutes % 60).padStart(2, "0")}.`,
    s.guardia ? "MODO GUARDIA ACTIVO: está de guardia en el hospital; priorizar opciones portables y simples." : "",
    `Objetivo diario: ${c.targets.kcal} kcal / ${c.targets.p} g P / ${c.targets.c} g C / ${c.targets.f} g G. Rangos: kcal ${c.ranges.kcal.join("–")}, P ≥${c.ranges.pMin}, C ${c.ranges.c.join("–")}, G ${c.ranges.f.join("–")}.`,
    `Hoy lleva: ${d.totals.kcal} kcal / ${d.totals.p} P / ${d.totals.c} C / ${d.totals.f} G. Restante: ${d.remaining.kcal} kcal / ${d.remaining.p} P / ${d.remaining.c} C / ${d.remaining.f} G.`,
    `Comidas registradas hoy: ${d.meals.map((m) => `${m.slot} (${m.totals.kcal} kcal, ${m.totals.p} P, ${m.totals.c} C: ${m.items.map((i) => i.name).join(", ")})`).join("; ") || "ninguna"}. Pendientes: ${d.pendingSlots.join(", ") || "ninguna"}.`,
    d.carbRule.active ? `Regla de carbos activa: ${d.carbRule.reason}` : "",
    `Ayer: ${s.yesterday.totals.kcal} kcal, ${s.yesterday.totals.p} g P (estado: ${s.yesterday.status}).`,
    `Semana (${s.week.start} a ${s.week.end}): margen acumulado ${s.week.marginKcal >= 0 ? "+" : ""}${s.week.marginKcal} kcal (positivo = por debajo del objetivo), ${s.week.perDayLeft} kcal/día disponibles para cerrar la semana en objetivo. Días en rango: ${s.week.adherence.on}, cerca: ${s.week.adherence.near}, lejos: ${s.week.adherence.off}, sin registro: ${s.week.adherence.empty}.`,
    `Racha: ${s.streak.current} días seguidos en rango o cerca (mejor: ${s.streak.best}). Adherencia 14 días: ${s.streak.last14Pct}% de ${s.streak.last14Logged} días con registro.`,
    `Entrenos esta semana: ${s.workouts.done} (objetivo ${s.workouts.goalMin}–${s.workouts.goalMax}${s.workouts.ramp ? ", objetivo progresivo porque está retomando" : ""}). Últimos 14 días: ${s.workouts.last14}. Hoy ${s.workouts.isTrainingDay ? "es día de fuerza" : "no es día de entreno"}${s.workouts.trainedToday ? " y ya entrenó" : ""}. Días planificados: ${c.workout.days.join(",")} a las ${c.workout.time}.`,
    p.currentTrend != null
      ? `Peso (tendencia): ${p.currentTrend} kg, bajó ${p.lostKg} kg desde ${c.goal.start_kg}. Ritmo: ${p.kgPerWeek} kg/semana (base: ${p.basis}). Llegada estimada a ≤${c.goal.target_max} kg: ${p.dateRange ? p.dateRange.join(" a ") : "sin proyección todavía"}. Próximo hito: ${p.nextMilestone ? `${p.nextMilestone.kg} kg (faltan ${p.nextMilestone.remainingKg} kg)` : "—"}.`
      : `Sin pesos registrados todavía. Inicio declarado: ${c.goal.start_kg} kg.`,
    `Gasto estimado: ${p.tdee.kcal} kcal/día (${p.tdee.basis}, confianza ${p.tdee.confidence}).`,
    `Objetivo de peso: ${c.goal.start_kg} → ${c.goal.target_min}–${c.goal.target_max} kg.`,
    c.why ? `Su "por qué", en sus palabras: "${c.why}"` : "",
    c.reintroductions.length ? `Está reintroduciendo: ${c.reintroductions.join(", ")}.` : "",
    s.adaptive.notes.length ? `Ajustes adaptativos vigentes: ${s.adaptive.notes.join(" ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

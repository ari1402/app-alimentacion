// Entrenos: consistencia semanal, progresión de cargas y récords.
import type { UserConfig, Workout, WorkoutExercise } from "./types.ts";
import { addDays, diffDays, weekStart, weekdayOf } from "./dates.ts";

/** 1RM estimado (Epley). Útil para comparar series con distintas reps. */
export function e1rm(kg: number, reps: number): number {
  if (reps <= 0 || kg <= 0) return 0;
  if (reps === 1) return kg;
  return Math.round(kg * (1 + reps / 30) * 10) / 10;
}

export function bestSet(ex: WorkoutExercise): { kg: number; reps: number; e1rm: number } | null {
  let best: { kg: number; reps: number; e1rm: number } | null = null;
  for (const s of ex.sets) {
    const v = e1rm(s.kg, s.reps);
    if (!best || v > best.e1rm) best = { kg: s.kg, reps: s.reps, e1rm: v };
  }
  return best;
}

export function volume(ex: WorkoutExercise): number {
  return ex.sets.reduce((a, s) => a + s.kg * s.reps, 0);
}

export interface ExerciseHistoryPoint {
  date: string;
  topKg: number;
  e1rm: number;
  volume: number;
}

export function normalizeExercise(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function exerciseHistory(workouts: Workout[], name: string): ExerciseHistoryPoint[] {
  const key = normalizeExercise(name);
  return workouts
    .flatMap((w) =>
      w.exercises
        .filter((e) => normalizeExercise(e.name) === key)
        .map((e) => {
          const b = bestSet(e);
          return { date: w.local_date, topKg: Math.max(0, ...e.sets.map((s) => s.kg)), e1rm: b?.e1rm ?? 0, volume: volume(e) };
        }),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Últimos valores usados por ejercicio (para precargar el formulario) */
export function lastSetsByExercise(workouts: Workout[]): Map<string, WorkoutExercise> {
  const out = new Map<string, WorkoutExercise>();
  const sorted = [...workouts].sort((a, b) => a.local_date.localeCompare(b.local_date));
  for (const w of sorted) for (const e of w.exercises) out.set(normalizeExercise(e.name), e);
  return out;
}

export interface PR {
  exercise: string;
  e1rm: number;
  previous: number;
}

/** Récords nuevos de un entreno contra el historial previo */
export function detectPRs(workout: Workout, history: Workout[]): PR[] {
  const prs: PR[] = [];
  const prev = history.filter((w) => w.id !== workout.id && w.local_date <= workout.local_date);
  for (const ex of workout.exercises) {
    const b = bestSet(ex);
    if (!b) continue;
    const hist = exerciseHistory(prev, ex.name);
    if (!hist.length) continue;
    const max = Math.max(...hist.map((h) => h.e1rm));
    if (b.e1rm > max) prs.push({ exercise: ex.name, e1rm: b.e1rm, previous: max });
  }
  return prs;
}

/** Objetivo semanal progresivo: las 2 primeras semanas desde que retomó, 2 sesiones ya cuentan como avance */
export function weeklyWorkoutGoal(cfg: UserConfig, today: string): { min: number; max: number; ramp: boolean } {
  const r = cfg.workout.restart_date;
  if (r) {
    const d = diffDays(today, r);
    if (d >= 0 && d < 14) return { min: Math.min(2, cfg.workout.weekly_min), max: cfg.workout.weekly_max, ramp: true };
  }
  return { min: cfg.workout.weekly_min, max: cfg.workout.weekly_max, ramp: false };
}

export interface WeekWorkoutStatus {
  done: number;
  goalMin: number;
  goalMax: number;
  ramp: boolean;
  plannedRemaining: number; // días de entreno que quedan en la semana (incluye hoy si no entrenó)
  trainedToday: boolean;
  isTrainingDay: boolean;
  last14: number;
}

export function weekWorkoutStatus(cfg: UserConfig, workouts: Workout[], today: string): WeekWorkoutStatus {
  const ws = weekStart(today);
  const we = addDays(ws, 6);
  // El objetivo semanal (3–4) es de FUERZA; el cardio se registra aparte y ajusta calorías.
  const strength = workouts.filter((w) => w.type === "fuerza");
  const thisWeek = strength.filter((w) => w.local_date >= ws && w.local_date <= we);
  const trainedToday = thisWeek.some((w) => w.local_date === today);
  const todayWd = weekdayOf(today);
  const isTrainingDay = cfg.workout.days.includes(todayWd);
  let planned = 0;
  for (let d = today; d <= we; d = addDays(d, 1)) {
    if (d === today && trainedToday) continue;
    if (cfg.workout.days.includes(weekdayOf(d))) planned++;
  }
  const g = weeklyWorkoutGoal(cfg, today);
  const from14 = addDays(today, -13);
  return {
    done: new Set(thisWeek.map((w) => w.local_date)).size,
    goalMin: g.min,
    goalMax: g.max,
    ramp: g.ramp,
    plannedRemaining: planned,
    trainedToday,
    isTrainingDay,
    last14: new Set(strength.filter((w) => w.local_date >= from14 && w.local_date <= today).map((w) => w.local_date)).size,
  };
}

/** Negociación de entreno: mover o saltear, con el impacto en la semana */
export function simulateWorkoutChange(
  cfg: UserConfig,
  workouts: Workout[],
  today: string,
  action: "mover" | "saltear",
): { message: string; weekTotal: number; goalMin: number; meetsGoal: boolean } {
  const s = weekWorkoutStatus(cfg, workouts, today);
  const projected = s.done + s.plannedRemaining;
  const after = action === "mover" ? projected : projected - 1;
  const meets = after >= s.goalMin;
  const daysLeft = 6 - ((weekdayOf(today) + 6) % 7);
  let message: string;
  if (action === "mover") {
    message = daysLeft > 0
      ? `Si lo movés a mañana, la semana queda en ${after} sesiones (objetivo ${s.goalMin}–${s.goalMax}). ${meets ? "Cerrás la semana igual." : "Igual quedarías abajo; sumá un día más si podés."}`
      : `Hoy es el último día de la semana: moverlo a mañana lo pasa a la semana que viene. Esta semana quedaría en ${after - 1}.`;
  } else {
    message = `Si lo salteás quedás en ${after} esta semana (objetivo ${s.goalMin}–${s.goalMax}). ${meets ? "Todavía cumplís el mínimo." : "Quedarías abajo del objetivo; una sesión corta de 30 min mantiene la continuidad."}`;
  }
  return { message, weekTotal: after, goalMin: s.goalMin, meetsGoal: meets };
}

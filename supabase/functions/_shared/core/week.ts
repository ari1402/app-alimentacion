// Semana: presupuesto semanal de calorías, adherencia, rachas y negociación.
import type { Macros, Meal, UserConfig } from "./types.ts";
import { addDays, dateRange, weekStart } from "./dates.ts";
import { buildDayState, type DayStatus, round1 } from "./macros.ts";
import { SAFETY_FLOOR_KCAL, delayDaysForKcal } from "./weight.ts";

export interface DaySummary {
  date: string;
  status: DayStatus;
  kcal: number;
  p: number;
  meals: number;
}

export function daySummaries(meals: Meal[], cfg: UserConfig, from: string, to: string): DaySummary[] {
  const byDate = new Map<string, Meal[]>();
  for (const m of meals) {
    if (m.local_date < from || m.local_date > to) continue;
    const l = byDate.get(m.local_date) ?? [];
    l.push(m);
    byDate.set(m.local_date, l);
  }
  return dateRange(from, to).map((d) => {
    const st = buildDayState(d, byDate.get(d) ?? [], cfg);
    return { date: d, status: st.status, kcal: st.totals.kcal, p: st.totals.p, meals: st.meals.length };
  });
}

export interface WeekBudget {
  start: string;
  end: string;
  budgetKcal: number; // objetivo × 7
  consumedKcal: number; // días cerrados + hoy
  /** Margen acumulado de días cerrados: + = quedó por debajo del objetivo */
  marginKcal: number;
  closedDays: number;
  daysLeft: number; // incluye hoy
  /** Kcal por día que quedan disponibles para cerrar la semana en objetivo */
  perDayLeft: number;
  adherence: { on: number; near: number; off: number; empty: number };
  proteinDaysOk: number;
  days: DaySummary[];
}

export function weekBudget(meals: Meal[], cfg: UserConfig, today: string): WeekBudget {
  const start = weekStart(today);
  const end = addDays(start, 6);
  const days = daySummaries(meals, cfg, start, end);
  const closed = days.filter((d) => d.date < today && d.status !== "empty");
  const todayDay = days.find((d) => d.date === today);
  const marginKcal = Math.round(closed.reduce((a, d) => a + (cfg.targets.kcal - d.kcal), 0));
  const consumed = Math.round(closed.reduce((a, d) => a + d.kcal, 0) + (todayDay?.kcal ?? 0));
  const daysLeft = days.filter((d) => d.date >= today).length;
  // días sin registro se asumen en objetivo (no inventamos excesos)
  const emptyPast = days.filter((d) => d.date < today && d.status === "empty").length;
  const budget = cfg.targets.kcal * 7;
  const perDayLeft = daysLeft ? Math.round((budget - consumed - emptyPast * cfg.targets.kcal + (todayDay?.kcal ?? 0)) / daysLeft) : 0;
  const adherence = { on: 0, near: 0, off: 0, empty: 0 };
  for (const d of days.filter((x) => x.date < today || (x.date === today && x.status !== "empty"))) adherence[d.status]++;
  return {
    start,
    end,
    budgetKcal: budget,
    consumedKcal: consumed,
    marginKcal,
    closedDays: closed.length,
    daysLeft,
    perDayLeft,
    adherence,
    proteinDaysOk: closed.filter((d) => d.p >= cfg.ranges.pMin).length,
    days,
  };
}

export interface Streak {
  current: number; // días seguidos "on" (o "near" si el modo es flexible)
  best: number;
  last14Pct: number; // % de días on/near en los últimos 14 con registro
  last14Logged: number;
}

/** Racha que perdona: un día "near" no corta la racha, solo un "off" o un día sin registro. */
export function streak(meals: Meal[], cfg: UserConfig, today: string, lookback = 120): Streak {
  const days = daySummaries(meals, cfg, addDays(today, -lookback), addDays(today, -1));
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].status === "on" || days[i].status === "near") current++;
    else break;
  }
  let best = 0, run = 0;
  for (const d of days) {
    if (d.status === "on" || d.status === "near") best = Math.max(best, ++run);
    else run = 0;
  }
  const last14 = days.slice(-14).filter((d) => d.status !== "empty");
  const good = last14.filter((d) => d.status === "on" || d.status === "near").length;
  return { current, best, last14Pct: last14.length ? Math.round((good / last14.length) * 100) : 0, last14Logged: last14.length };
}

export interface NegotiationOption {
  key: "hoy" | "semana" | "aceptar";
  title: string;
  detail: string;
  feasible: boolean;
}

export interface Negotiation {
  extra: Macros;
  dayAfter: Macros;
  overDay: number; // kcal por encima del máximo del rango
  options: NegotiationOption[];
  delayDays: number;
  summary: string;
}

/**
 * "¿Puedo comer X?" → trade-offs concretos. Nunca propone saltear comidas ni
 * entrenar para "pagar": solo reacomodar carbos/grasas o usar el margen semanal.
 */
export function negotiateExtra(
  extra: Macros,
  meals: Meal[],
  cfg: UserConfig,
  today: string,
  tdeeKcal: number,
): Negotiation {
  const day = buildDayState(today, meals, cfg);
  const week = weekBudget(meals, cfg, today);
  const dayAfter = {
    kcal: Math.round(day.totals.kcal + extra.kcal),
    p: round1(day.totals.p + extra.p),
    c: round1(day.totals.c + extra.c),
    f: round1(day.totals.f + extra.f),
  };
  // Lo que todavía va a comer hoy según el plan
  const plannedRest = Math.max(0, day.remaining.kcal);
  const projectedDay = Math.max(dayAfter.kcal, day.totals.kcal + plannedRest + extra.kcal);
  const overDay = Math.max(0, Math.round(projectedDay - cfg.ranges.kcal[1]));
  const options: NegotiationOption[] = [];
  const pending = day.pendingSlots.length;

  if (overDay === 0) {
    options.push({ key: "hoy", title: "Entra en el día", detail: `Con eso seguís dentro del rango (${cfg.ranges.kcal[0]}–${cfg.ranges.kcal[1]}). Cuidá que lo que falta tenga proteína: te quedan ${Math.max(0, Math.round(day.remaining.p - extra.p))} g.`, feasible: true });
  } else {
    // Opción A: ajustar comidas que faltan hoy (sin tocar proteína, sin bajar del piso)
    const maxCut = pending * 200;
    const cut = Math.min(overDay, maxCut);
    const carbsG = Math.round((cut * 0.65) / 4);
    const fatG = Math.round((cut * 0.35) / 9);
    const floorOk = projectedDay - cut >= SAFETY_FLOOR_KCAL;
    if (pending > 0 && floorOk) {
      options.push({
        key: "hoy",
        title: "Reacomodar lo que queda de hoy",
        detail: `Bajá ~${carbsG} g de carbos y ~${fatG} g de grasa en ${pending === 1 ? "la comida que falta" : `las ${pending} comidas que faltan`} (la proteína queda igual).${cut < overDay ? ` Igual quedarías ${overDay - cut} kcal arriba del rango, que van al margen semanal.` : ""}`,
        feasible: true,
      });
    }
    // Opción B: absorber en la semana
    const daysAfter = Math.max(0, week.daysLeft - 1);
    const perDay = daysAfter ? Math.round(overDay / daysAfter) : overDay;
    const weekFeasible = daysAfter > 0 && perDay <= 150 && cfg.targets.kcal - perDay >= SAFETY_FLOOR_KCAL;
    options.push({
      key: "semana",
      title: "Absorberlo en la semana",
      detail: daysAfter
        ? week.marginKcal >= overDay
          ? `Tu margen de la semana es de ${week.marginKcal} kcal: ya lo cubre, no hace falta tocar nada.`
          : `Son ~${perDay} kcal menos por día los ${daysAfter} días que quedan (${cfg.targets.kcal - perDay} en vez de ${cfg.targets.kcal}).${weekFeasible ? "" : " Es mucho por día; mejor combinarlo con la opción de hoy o aceptarlo."}`
        : "Es el último día de la semana; si te pasás, arranca limpia la próxima.",
      feasible: weekFeasible || week.marginKcal >= overDay,
    });
  }
  const deficit = tdeeKcal - cfg.targets.kcal;
  const delay = delayDaysForKcal(overDay, deficit);
  options.push({
    key: "aceptar",
    title: "Comerlo y seguir",
    detail: overDay > 0
      ? `Impacto real: ~${overDay / 7700 >= 0.1 ? round1(overDay / 7700) : "<0.1"} kg, ≈ ${delay} día(s) en la fecha estimada. Un día no define la tendencia.`
      : "No cambia la fecha estimada.",
    feasible: true,
  });
  return {
    extra,
    dayAfter,
    overDay,
    options,
    delayDays: delay,
    summary: overDay > 0
      ? `+${Math.round(extra.kcal)} kcal / +${Math.round(extra.c)} g carbos. Te deja ~${overDay} kcal arriba del rango de hoy.`
      : `+${Math.round(extra.kcal)} kcal. Entra en el rango de hoy.`,
  };
}

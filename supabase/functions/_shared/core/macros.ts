// Motor de macros: acumulado, restante, reglas y checklist de cierre.
import type { Food, Macros, Meal, MealItem, MealTemplate, Slot, UserConfig } from "./types.ts";
import { MAIN_SLOTS } from "./types.ts";

export const ZERO: Macros = { kcal: 0, p: 0, c: 0, f: 0 };

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function roundMacros(m: Macros): Macros {
  return { kcal: Math.round(m.kcal), p: round1(m.p), c: round1(m.c), f: round1(m.f) };
}

export function add(a: Macros, b: Macros): Macros {
  return { kcal: a.kcal + b.kcal, p: a.p + b.p, c: a.c + b.c, f: a.f + b.f };
}

export function sub(a: Macros, b: Macros): Macros {
  return { kcal: a.kcal - b.kcal, p: a.p - b.p, c: a.c - b.c, f: a.f - b.f };
}

export function scale(m: Macros, k: number): Macros {
  return { kcal: m.kcal * k, p: m.p * k, c: m.c * k, f: m.f * k };
}

export function sum(list: Macros[]): Macros {
  return roundMacros(list.reduce(add, ZERO));
}

/** Macros para `grams` de un alimento (los macros del alimento son por portion_g) */
export function itemFromFood(food: Food, grams: number, phrase?: string | null): MealItem {
  const k = food.portion_g > 0 ? grams / food.portion_g : 0;
  const m = roundMacros(scale(food, k));
  return { food_id: food.id, name: food.name, grams: Math.round(grams), phrase: phrase ?? null, ...m };
}

/** Recalcula un ítem cuando la usuaria cambia los gramos */
export function rescaleItem(item: MealItem, grams: number, food?: Food): MealItem {
  if (food) return { ...itemFromFood(food, grams, item.phrase), estimated: item.estimated };
  if (item.grams <= 0) return { ...item, grams };
  const m = roundMacros(scale(item, grams / item.grams));
  return { ...item, ...m, grams: Math.round(grams) };
}

/** kcal a partir de macros (útil para validar estimaciones de IA) */
export function kcalFromMacros(m: Pick<Macros, "p" | "c" | "f">): number {
  return m.p * 4 + m.c * 4 + m.f * 9;
}

export function totalsOf(items: MealItem[]): Macros {
  return sum(items);
}

// ─────────────────────────── Estado del día ───────────────────────────

export interface ChecklistItem {
  key: "kcal" | "p" | "c" | "f";
  label: string;
  value: number;
  ok: boolean;
  target: string;
  /** cuánto falta (negativo) o sobra (positivo) respecto del rango */
  delta: number;
}

export type DayStatus = "empty" | "on" | "near" | "off";

export interface DayState {
  date: string;
  meals: Meal[];
  totals: Macros;
  target: Macros;
  remaining: Macros;
  pct: Macros; // 0..1+ por macro
  slotsLogged: Slot[];
  pendingSlots: Slot[];
  lastMeal: Meal | null;
  carbRule: { active: boolean; reason: string | null };
  checklist: ChecklistItem[];
  status: DayStatus;
  /** proteína sugerida por cada comida que falta */
  proteinPerPendingMeal: number;
}

export function checklist(t: Macros, cfg: UserConfig): ChecklistItem[] {
  const r = cfg.ranges;
  const inRange = (v: number, [a, b]: [number, number]) => (v < a ? v - a : v > b ? v - b : 0);
  return [
    { key: "kcal", label: "Calorías", value: Math.round(t.kcal), target: `${r.kcal[0]}–${r.kcal[1]}`, delta: inRange(t.kcal, r.kcal), ok: inRange(t.kcal, r.kcal) === 0 },
    { key: "p", label: "Proteína", value: round1(t.p), target: `≥${r.pMin} g`, delta: t.p >= r.pMin ? 0 : t.p - r.pMin, ok: t.p >= r.pMin },
    { key: "c", label: "Carbos", value: round1(t.c), target: `${r.c[0]}–${r.c[1]} g`, delta: inRange(t.c, r.c), ok: inRange(t.c, r.c) === 0 },
    { key: "f", label: "Grasas", value: round1(t.f), target: `${r.f[0]}–${r.f[1]} g`, delta: inRange(t.f, r.f), ok: inRange(t.f, r.f) === 0 },
  ];
}

/**
 * Estado de un día cerrado:
 *  on   = calorías en rango y proteína ≥ mínimo (lo central)
 *  near = cerca (±10% kcal, proteína ≥ 90%)
 *  off  = lejos
 *  empty = sin registros
 */
export function dayStatus(t: Macros, cfg: UserConfig, mealsCount: number): DayStatus {
  if (mealsCount === 0) return "empty";
  const [lo, hi] = cfg.ranges.kcal;
  const kcalOk = t.kcal >= lo && t.kcal <= hi;
  const pOk = t.p >= cfg.ranges.pMin;
  if (kcalOk && pOk) return "on";
  const kcalNear = t.kcal >= lo * 0.9 && t.kcal <= hi * 1.1;
  const pNear = t.p >= cfg.ranges.pMin * 0.9;
  return kcalNear && pNear ? "near" : "off";
}

export function buildDayState(date: string, meals: Meal[], cfg: UserConfig): DayState {
  const dayMeals = meals
    .filter((m) => m.local_date === date && m.confirmed !== false)
    .sort((a, b) => a.eaten_at.localeCompare(b.eaten_at));
  const totals = sum(dayMeals.map((m) => m.totals));
  const target = cfg.targets;
  const remaining = roundMacros(sub(target, totals));
  const pct = {
    kcal: target.kcal ? totals.kcal / target.kcal : 0,
    p: target.p ? totals.p / target.p : 0,
    c: target.c ? totals.c / target.c : 0,
    f: target.f ? totals.f / target.f : 0,
  };
  const slotsLogged = Array.from(new Set(dayMeals.map((m) => m.slot)));
  const pendingSlots = MAIN_SLOTS.filter((s) => !slotsLogged.includes(s));
  const lastMeal = dayMeals.length ? dayMeals[dayMeals.length - 1] : null;

  let carbRule: DayState["carbRule"] = { active: false, reason: null };
  if (lastMeal && lastMeal.totals.c > cfg.carb_rule_threshold) {
    carbRule = {
      active: true,
      reason: `${slotLabel(lastMeal.slot)} tuvo ${Math.round(lastMeal.totals.c)} g de carbos (más de ${cfg.carb_rule_threshold}); la próxima comida conviene baja en carbos.`,
    };
  }
  const pending = Math.max(1, pendingSlots.length);
  return {
    date,
    meals: dayMeals,
    totals,
    target,
    remaining,
    pct,
    slotsLogged,
    pendingSlots,
    lastMeal,
    carbRule,
    checklist: checklist(totals, cfg),
    status: dayStatus(totals, cfg, dayMeals.length),
    proteinPerPendingMeal: Math.max(0, Math.round(remaining.p / pending)),
  };
}

export function slotLabel(s: Slot): string {
  return { desayuno: "Desayuno", almuerzo: "Almuerzo", merienda: "Merienda", cena: "Cena", snack: "Colación" }[s];
}

/** Slot sugerido según la hora local */
export function slotForTime(minutes: number): Slot {
  if (minutes < 11 * 60) return "desayuno";
  if (minutes < 16 * 60) return "almuerzo";
  if (minutes < 19 * 60 + 30) return "merienda";
  return "cena";
}

// ─────────────────────────── Sugerencias ───────────────────────────

export interface TemplateFit {
  template: MealTemplate;
  score: number;
  fits: boolean;
  why: string;
}

/**
 * Ordena plantillas por qué tan bien encajan en lo que queda del día.
 * Prioriza: cubrir proteína, no pasarse de kcal, respetar la regla de carbos.
 */
export function rankTemplates(
  templates: MealTemplate[],
  slot: Slot,
  day: DayState,
): TemplateFit[] {
  // Presupuesto razonable para esta comida = restante / comidas que faltan (ponderado)
  const share = slot === "almuerzo" || slot === "cena" ? 1.35 : 0.65;
  const totalShares = day.pendingSlots.reduce((acc, s) => acc + (s === "almuerzo" || s === "cena" ? 1.35 : 0.65), 0) || share;
  const budgetKcal = Math.max(250, (day.remaining.kcal * share) / totalShares);
  const budgetP = Math.max(20, (day.remaining.p * share) / totalShares);
  const lowCarb = day.carbRule.active;
  const pool = templates.filter((t) => t.slot === slot || (slot === "snack" && t.slot === "merienda"));
  return pool
    .map((t) => {
      const overKcal = Math.max(0, t.totals.kcal - budgetKcal);
      const pCover = Math.min(1, t.totals.p / budgetP);
      const carbPenalty = lowCarb && t.totals.c > 30 ? (t.totals.c - 30) * 4 : 0;
      const score = pCover * 100 - overKcal * 0.25 - carbPenalty;
      const fits = overKcal < 80 && (!lowCarb || t.totals.c <= 35);
      const why = [
        `${Math.round(t.totals.kcal)} kcal · ${Math.round(t.totals.p)} g P`,
        lowCarb ? (t.totals.c <= 35 ? "baja en carbos ✓" : `${Math.round(t.totals.c)} g carbos`) : null,
        overKcal > 0 ? `+${Math.round(overKcal)} kcal sobre lo ideal` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return { template: t, score, fits, why };
    })
    .sort((a, b) => b.score - a.score);
}

/** Proyección del día: con lo registrado + lo que suele comer en lo pendiente */
/** Reparto típico del objetivo entre comidas (si todavía no hay historial) */
export const SLOT_SHARE: Record<Slot, number> = { desayuno: 0.22, almuerzo: 0.3, merienda: 0.16, cena: 0.32, snack: 0.05 };

export function projectDayClose(
  day: DayState,
  typicalBySlot: Partial<Record<Slot, Macros>>,
): Macros {
  const pending = day.pendingSlots.map((s) => typicalBySlot[s] ?? scale(day.target, SLOT_SHARE[s]));
  return sum([day.totals, ...pending]);
}

/** Promedio de macros por slot en los últimos días (para proyectar el cierre) */
export function typicalBySlot(meals: Meal[], days = 14, today?: string): Partial<Record<Slot, Macros>> {
  const out: Partial<Record<Slot, Macros>> = {};
  const bySlotDay = new Map<string, Macros>();
  for (const m of meals) {
    if (today && m.local_date >= today) continue;
    const k = `${m.slot}|${m.local_date}`;
    bySlotDay.set(k, add(bySlotDay.get(k) ?? ZERO, m.totals));
  }
  const groups = new Map<Slot, Macros[]>();
  for (const [k, v] of bySlotDay) {
    const slot = k.split("|")[0] as Slot;
    const g = groups.get(slot) ?? [];
    g.push(v);
    groups.set(slot, g);
  }
  for (const [slot, list] of groups) {
    const recent = list.slice(-days);
    out[slot] = roundMacros(scale(recent.reduce(add, ZERO), 1 / recent.length));
  }
  return out;
}

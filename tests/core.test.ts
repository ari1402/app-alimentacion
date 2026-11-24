import { describe, expect, it } from "vitest";
import {
  buildDayState, buildMilestones, buildSnapshot, coachCard, decideNudges, defaultConfig, detectPRs, e1rm,
  itemFromFood, learnPortions, localParts, mergeConfig, negotiateExtra, projectGoal, rankTemplates,
  SEED_FOODS, SEED_TEMPLATES, simulateWorkoutChange, streak, weekBudget, weekStart, weightTrend, computeAdaptive,
  type BodyMetric, type Meal, type Workout,
} from "@core";

const TODAY = "2026-11-24"; // martes
const cfg = defaultConfig("2026-11-01");
const food = (id: string) => SEED_FOODS.find((f) => f.id === id)!;

function meal(date: string, slot: Meal["slot"], items: [string, number][], hhmm = "13:00"): Meal {
  const its = items.map(([id, g]) => itemFromFood(food(id), g));
  const totals = its.reduce((a, i) => ({ kcal: a.kcal + i.kcal, p: a.p + i.p, c: a.c + i.c, f: a.f + i.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  // 13:00 en Buenos Aires = 16:00 UTC
  const [h, m] = hhmm.split(":").map(Number);
  const eaten = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h + 3, m)).toISOString();
  return { id: `${date}-${slot}-${hhmm}`, local_date: date, slot, eaten_at: eaten, items: its, totals, source: "list", confirmed: true };
}

describe("fechas", () => {
  it("usa la hora de Buenos Aires", () => {
    const lp = localParts(new Date("2026-11-24T02:30:00Z"), cfg.timezone);
    expect(lp.date).toBe("2026-11-23");
    expect(lp.hour).toBe(23);
  });
  it("semana arranca el lunes", () => {
    expect(weekStart("2026-11-24")).toBe("2026-11-23");
    expect(weekStart("2026-11-29")).toBe("2026-11-23");
  });
});

describe("macros", () => {
  it("escala por gramos", () => {
    const it = itemFromFood(food("pollo-pechuga"), 150);
    expect(it.kcal).toBe(248);
    expect(it.p).toBe(46.5);
  });
  it("estado del día, restante y regla de carbos", () => {
    const meals = [meal(TODAY, "almuerzo", [["fideos", 250], ["carne-picada-5", 100]])];
    const d = buildDayState(TODAY, meals, cfg);
    expect(d.totals.c).toBeGreaterThan(50);
    expect(d.carbRule.active).toBe(true);
    expect(d.remaining.kcal).toBe(cfg.targets.kcal - d.totals.kcal);
    expect(d.pendingSlots).toEqual(["desayuno", "merienda", "cena"]);
  });
  it("plantillas bajas en carbos primero si la regla está activa", () => {
    const meals = [meal(TODAY, "almuerzo", [["fideos", 250], ["carne-picada-5", 100]])];
    const d = buildDayState(TODAY, meals, cfg);
    const ranked = rankTemplates(SEED_TEMPLATES, "cena", d);
    expect(ranked[0].template.totals.c).toBeLessThanOrEqual(35);
  });
  it("las plantillas sembradas tienen macros coherentes", () => {
    for (const t of SEED_TEMPLATES) {
      expect(t.totals.kcal).toBeGreaterThan(150);
      expect(t.totals.p).toBeGreaterThan(10);
    }
    expect(SEED_TEMPLATES.filter((t) => t.code.startsWith("A"))).toHaveLength(15);
    expect(SEED_TEMPLATES.filter((t) => t.code.startsWith("C"))).toHaveLength(10);
  });
});

function weights(start: number, perDay: number, days: number, endDate = TODAY): BodyMetric[] {
  const out: BodyMetric[] = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(Date.parse(endDate) - i * 86400000).toISOString().slice(0, 10);
    const noise = ((i * 7919) % 7) / 10 - 0.3;
    out.push({ id: d, local_date: d, weight_kg: Math.round((start + perDay * (days - i) + noise) * 10) / 10 });
  }
  return out;
}

describe("peso y proyección", () => {
  it("la tendencia suaviza el ruido", () => {
    const t = weightTrend(weights(83, -0.07, 20));
    const raw = t.map((p) => p.kg!);
    const sm = t.map((p) => p.trend);
    const vol = (xs: number[]) => xs.slice(1).reduce((a, x, i) => a + Math.abs(x - xs[i]), 0);
    expect(vol(sm)).toBeLessThan(vol(raw));
  });
  it("proyecta un rango de fechas, no una fecha exacta", () => {
    const p = projectGoal(cfg, weights(83, -0.07, 21), [], TODAY);
    expect(p.basis).toBe("tendencia");
    expect(p.kgPerWeek!).toBeLessThan(-0.3);
    expect(p.dateRange).not.toBeNull();
    expect(p.dateRange![0] < p.dateRange![1]).toBe(true);
    expect(p.scenarios.length).toBe(3);
    expect(p.nextMilestone).not.toBeNull();
  });
  it("sin pesos usa el plan y pide datos", () => {
    const p = projectGoal(cfg, [], [], TODAY);
    expect(p.basis).toBe("plan");
    expect(p.needs.length).toBeGreaterThan(0);
  });
  it("hitos cada 2 kg hasta el objetivo", () => {
    expect(buildMilestones(83, 75, 73)).toEqual([81, 79, 77, 75, 73]);
  });
});

describe("semana y negociación", () => {
  const meals = [
    meal("2026-11-23", "desayuno", [["panqueque-proteico", 150], ["cafe-leche-proteica", 150]], "08:30"),
    meal("2026-11-23", "almuerzo", [["carne-magra", 150], ["arroz-integral", 150], ["hojas", 100]], "13:00"),
    meal("2026-11-23", "merienda", [["yogur-griego", 170], ["whey", 30]], "17:30"),
    meal("2026-11-23", "cena", [["salmon", 130], ["hojas", 100], ["papa", 150]], "21:00"),
    meal(TODAY, "desayuno", [["yogur-griego", 170], ["avena", 30]], "08:30"),
  ];
  it("presupuesto semanal", () => {
    const w = weekBudget(meals, cfg, TODAY);
    expect(w.start).toBe("2026-11-23");
    expect(w.closedDays).toBe(1);
    expect(w.daysLeft).toBe(6);
  });
  it("negociar algo extra da opciones sin castigo", () => {
    const n = negotiateExtra({ kcal: 450, p: 6, c: 55, f: 22 }, meals, cfg, TODAY, 2200);
    expect(n.options.length).toBeGreaterThanOrEqual(2);
    const txt = n.options.map((o) => o.detail + o.title).join(" ").toLowerCase();
    for (const bad of ["saltear", "trampa", "castigo", "ganarte", "permitido"]) expect(txt).not.toContain(bad);
  });
  it("racha perdona días 'cerca'", () => {
    const s = streak(meals, cfg, TODAY);
    expect(s.current).toBeGreaterThanOrEqual(0);
  });
});

describe("entrenos", () => {
  const w = (id: string, date: string, kg: number, reps: number): Workout => ({ id, local_date: date, type: "fuerza", exercises: [{ name: "Sentadilla", sets: [{ kg, reps }] }] });
  it("e1RM y PR", () => {
    expect(e1rm(90, 5)).toBe(105);
    const hist = [w("a", "2026-11-10", 90, 5)];
    expect(detectPRs(w("b", "2026-11-24", 92.5, 5), hist)).toHaveLength(1);
    expect(detectPRs(w("c", "2026-11-24", 85, 5), hist)).toHaveLength(0);
  });
  it("mover vs saltear muestra el impacto", () => {
    const r = simulateWorkoutChange(cfg, [w("a", "2026-11-23", 90, 5)], TODAY, "saltear");
    expect(r.message).toContain("objetivo");
  });
});

describe("coach proactivo", () => {
  const data = { meals: [] as Meal[], workouts: [], metrics: [], templates: SEED_TEMPLATES, events: [] };
  it("manda el plan de la mañana en su ventana y no lo repite", () => {
    const now = new Date("2026-11-24T10:40:00Z"); // 07:40 BA
    const s = buildSnapshot(cfg, data, now);
    const n = decideNudges(s, new Set());
    expect(n.map((x) => x.kind)).toContain("manana");
    const again = decideNudges(s, new Set(n.map((x) => x.dedupe_key)));
    expect(again.map((x) => x.kind)).not.toContain("manana");
  });
  it("recordatorio de almuerzo solo si no registró", () => {
    const now = new Date("2026-11-24T16:10:00Z"); // 13:10 BA
    const s = buildSnapshot(cfg, data, now);
    expect(decideNudges(s, new Set()).map((x) => x.kind)).toContain("almuerzo");
    const s2 = buildSnapshot(cfg, { ...data, meals: [meal(TODAY, "almuerzo", [["carne-magra", 150]], "12:50")] }, now);
    expect(decideNudges(s2, new Set()).map((x) => x.kind)).not.toContain("almuerzo");
  });
  it("respeta horas de silencio y modo guardia", () => {
    const s = buildSnapshot(cfg, data, new Date("2026-11-25T03:00:00Z")); // 00:00 BA
    expect(decideNudges(s, new Set())).toHaveLength(0);
    const g = mergeConfig({ ...cfg, guardia_until: "2026-11-25T12:00:00Z" }, TODAY);
    const sg = buildSnapshot(g, data, new Date("2026-11-24T15:35:00Z")); // 12:35 BA
    expect(decideNudges(sg, new Set()).map((x) => x.kind)).toEqual(["guardia"]);
  });
  it("tarjeta del coach siempre tiene algo útil", () => {
    for (const h of [8, 12, 16, 19, 23]) {
      const s = buildSnapshot(cfg, data, new Date(Date.UTC(2026, 10, 24, h + 3, 0)));
      const c = coachCard(s);
      expect(c.body.length).toBeGreaterThan(20);
    }
  });
  it("el tono no moraliza", () => {
    const s = buildSnapshot(cfg, data, new Date("2026-11-25T01:40:00Z"));
    const all = decideNudges(s, new Set()).map((n) => n.title + n.body).join(" ").toLowerCase();
    for (const bad of ["trampa", "permitido", "ganarte", "culpa", "mal"]) expect(all).not.toContain(bad);
  });
});

describe("adaptativo y porciones", () => {
  it("mueve el recordatorio a la hora real", () => {
    const meals: Meal[] = [];
    for (let i = 1; i <= 8; i++) {
      const d = new Date(Date.parse(TODAY) - i * 86400000).toISOString().slice(0, 10);
      meals.push(meal(d, "almuerzo", [["carne-magra", 150]], "14:40"));
    }
    const a = computeAdaptive(cfg, meals, [], TODAY);
    expect(a.reminderTimes.almuerzo).toBe("14:20");
    expect(a.notes[0]).toContain("almuerzo");
  });
  it("aprende porciones", () => {
    const it = { ...itemFromFood(food("panqueque-proteico"), 100), phrase: "Un panqueque" };
    let p = learnPortions([], [it]);
    p = learnPortions(p, [{ ...it, grams: 120 }]);
    expect(p[0].phrase).toBe("un panqueque");
    expect(p[0].grams).toBe(110);
    expect(p[0].count).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyTargets, buildDayState, cyclePhase, defaultConfig, estimateCardio, evidenceReview, itemFromFood, keytelKcalPerMin,
  mergeConfig, negotiateExtra, projectGoal, recommendTargets, SEED_FOODS, simulateCardio, strengthCheck, targetsForDay,
  weekBudget, weeklySets, type BodyMetric, type Meal, type Workout,
} from "@core";

const TODAY = "2026-11-24";
const cfg = defaultConfig("2026-09-01");
const food = (id: string) => SEED_FOODS.find((f) => f.id === id)!;

function cardio(date: string, minutes: number, net: number): Workout {
  return { id: `c-${date}-${minutes}`, local_date: date, type: "cardio", exercises: [], cardio: { modality: "caminata_inclinada", minutes, intensity: "moderada", net_kcal: net, method: "MET" } };
}

describe("cardio", () => {
  it("usa kcal netas (sin el reposo) con METs del Compendium", () => {
    const e = estimateCardio({ modality: "caminata_inclinada", minutes: 40, intensity: "moderada" }, 82, cfg.profile);
    // (6.3 − 1) × 82 kg × 0.667 h ≈ 290
    expect(e.net_kcal).toBeGreaterThan(270);
    expect(e.net_kcal).toBeLessThan(310);
  });
  it("descuenta la sobreestimación del reloj y combina con FC (Keytel)", () => {
    const p = { ...cfg.profile, age: 30 };
    const watch = estimateCardio({ modality: "bici", minutes: 45, intensity: "moderada", device_kcal: 600 }, 82, p);
    const met = estimateCardio({ modality: "bici", minutes: 45, intensity: "moderada" }, 82, p);
    expect(watch.net_kcal).toBeLessThan(600);
    expect(watch.method).toContain("reloj");
    expect(keytelKcalPerMin(140, 82, 30, "f")).toBeGreaterThan(5);
    expect(met.net_kcal).toBeGreaterThan(0);
  });
  it("suma solo el % configurado al objetivo del día, a carbos y grasas, con tope", () => {
    const t = targetsForDay(cfg, TODAY, [cardio(TODAY, 40, 300)]);
    expect(t.cardioBonusKcal).toBe(150);
    expect(t.targets.kcal).toBe(1850);
    expect(t.targets.p).toBe(cfg.targets.p);
    expect(t.targets.c).toBeGreaterThan(cfg.targets.c);
    expect(t.ranges.kcal).toEqual([1750, 1950]);
    const capped = targetsForDay(cfg, TODAY, [cardio(TODAY, 200, 2000)]);
    expect(capped.cardioBonusKcal).toBe(cfg.cardio.max_bonus);
    const none = targetsForDay({ ...cfg, cardio: { ...cfg.cardio, eatback: 0 } }, TODAY, [cardio(TODAY, 40, 300)]);
    expect(none.targets.kcal).toBe(1700);
  });
  it("el estado del día y la semana usan el objetivo ajustado", () => {
    const m: Meal = { id: "m", local_date: TODAY, slot: "cena", eaten_at: "2026-11-24T23:00:00Z", items: [itemFromFood(food("carne-magra"), 100)], totals: { kcal: 1820, p: 150, c: 190, f: 55 }, source: "list", confirmed: true };
    const sinCardio = buildDayState(TODAY, [m], cfg, []);
    const conCardio = buildDayState(TODAY, [m], cfg, [cardio(TODAY, 40, 300)]);
    expect(sinCardio.checklist.find((c) => c.key === "kcal")!.ok).toBe(false);
    expect(conCardio.checklist.find((c) => c.key === "kcal")!.ok).toBe(true);
    expect(weekBudget([m], cfg, TODAY, [cardio(TODAY, 40, 300)]).budgetKcal).toBe(1700 * 7 + 150);
  });
  it("simulación de cardio para negociar", () => {
    const r = simulateCardio(cfg, [], TODAY, { modality: "bici", minutes: 40, intensity: "moderada" }, 82);
    expect(r.bonus_kcal).toBeGreaterThan(100);
    expect(r.newTarget).toBe(1700 + r.bonus_kcal);
    const n = negotiateExtra({ kcal: 500, p: 5, c: 60, f: 25 }, [], cfg, TODAY, 2200);
    expect(n.options.some((o) => o.key === "cardio") || n.overDay < 150).toBe(true);
  });
});

function weights(start: number, perWeek: number, days: number): BodyMetric[] {
  const out: BodyMetric[] = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(Date.parse(TODAY) - i * 86400000).toISOString().slice(0, 10);
    out.push({ id: d, local_date: d, weight_kg: Math.round((start + (perWeek / 7) * (days - i)) * 10) / 10 });
  }
  return out;
}

function goodDays(n: number, kcal = 1700, p = 150): Meal[] {
  const out: Meal[] = [];
  for (let i = 1; i <= n; i++) {
    const d = new Date(Date.parse(TODAY) - i * 86400000).toISOString().slice(0, 10);
    out.push({ id: d, local_date: d, slot: "almuerzo", eaten_at: `${d}T16:00:00Z`, items: [], totals: { kcal, p, c: 180, f: 50 }, source: "list", confirmed: true });
  }
  return out;
}

describe("revisión semanal del objetivo", () => {
  it("baja muy rápida → propone subir, proteína intacta", () => {
    const metrics = weights(82, -1.2, 21);
    const meals = goodDays(14);
    const r = recommendTargets(cfg, projectGoal(cfg, metrics, meals, TODAY), meals, [], TODAY);
    expect(r.action).toBe("subir");
    expect(r.newTargets!.kcal).toBeGreaterThan(cfg.targets.kcal);
    expect(r.newTargets!.p).toBe(cfg.targets.p);
  });
  it("estancada con buena adherencia → propone bajar o moverse más, sin pasar el piso", () => {
    const metrics = weights(82, 0, 21);
    const meals = goodDays(14);
    const r = recommendTargets(cfg, projectGoal(cfg, metrics, meals, TODAY), meals, [], TODAY);
    expect(r.action).toBe("bajar");
    expect(r.newTargets!.kcal).toBeGreaterThanOrEqual(1500);
    expect(r.alternatives.join(" ")).toContain("pasos");
    const atFloor = mergeConfig({ ...cfg, targets: { ...cfg.targets, kcal: 1500 } }, TODAY);
    const r2 = recommendTargets(atFloor, projectGoal(atFloor, metrics, meals, TODAY), meals, [], TODAY);
    expect(r2.newTargets).toBeNull();
  });
  it("con poca adherencia NO recorta: primero consistencia", () => {
    const metrics = weights(82, 0, 21);
    const meals = goodDays(14, 2300, 100);
    const r = recommendTargets(cfg, projectGoal(cfg, metrics, meals, TODAY), meals, [], TODAY);
    expect(r.action).toBe("consistencia");
    expect(r.newTargets).toBeNull();
  });
  it("sin pesos pide datos; ajuste reciente espera 2 semanas", () => {
    expect(recommendTargets(cfg, projectGoal(cfg, [], [], TODAY), [], [], TODAY).action).toBe("datos");
    const recent = { ...cfg, target_history: [{ date: "2026-11-20", kcal: 1700, reason: "x" }] };
    const m = weights(82, -0.6, 21);
    expect(recommendTargets(recent, projectGoal(recent, m, goodDays(14), TODAY), goodDays(14), [], TODAY).action).toBe("esperar");
  });
  it("ritmo ideal → mantener; aplicar mueve rangos e historial", () => {
    const metrics = weights(82, -0.6, 21);
    const meals = goodDays(14);
    const r = recommendTargets(cfg, projectGoal(cfg, metrics, meals, TODAY), meals, [], TODAY);
    expect(r.action).toBe("mantener");
    const next = applyTargets(cfg, { kcal: 1800, p: 155, c: 199, f: 53 }, TODAY, "test");
    expect(next.ranges.kcal).toEqual([1700, 1900]);
    expect(next.target_history).toHaveLength(1);
  });
  it("sugiere pausa de mantenimiento tras 12+ semanas", () => {
    const longCfg = defaultConfig("2026-08-01");
    const metrics = weights(82, -0.6, 21);
    const r = recommendTargets(longCfg, projectGoal(longCfg, metrics, goodDays(14), TODAY), goodDays(14), [], TODAY);
    expect(r.dietBreakSuggested).toBe(true);
  });
});

describe("fuerza, volumen, ciclo y evidencia", () => {
  const w = (d: string, kg: number): Workout => ({ id: d, local_date: d, type: "fuerza", exercises: [{ name: "Sentadilla", sets: [{ kg, reps: 5 }, { kg, reps: 5 }, { kg, reps: 5 }] }, { name: "Jalón al pecho (espalda)", sets: [{ kg: 50, reps: 10 }] }] });
  it("detecta caída de fuerza > 7%", () => {
    const s = strengthCheck([w("2026-10-10", 90), w("2026-11-20", 80)], TODAY);
    expect(s.dropping[0].exercise).toBe("Sentadilla");
  });
  it("cuenta series por grupo muscular", () => {
    const v = weeklySets([w("2026-11-20", 90), w("2026-11-23", 90)], TODAY);
    expect(v.find((x) => x.muscle === "Cuádriceps")!.sets).toBe(6);
    expect(v.find((x) => x.muscle === "Espalda")!.sets).toBe(2);
  });
  it("fase del ciclo con retención", () => {
    const c = cyclePhase({ ...cfg, cycle: { enabled: true, last_start: "2026-10-31", length: 28 } }, TODAY);
    expect(c!.day).toBe(25);
    expect(c!.phase).toBe("lútea");
    expect(c!.retention).toBe(true);
  });
  it("los objetivos por defecto cumplen la evidencia", () => {
    const e = evidenceReview(cfg, 83, 2200);
    const byKey = Object.fromEntries(e.map((x) => [x.key, x.ok]));
    expect(byKey.proteina).toBe(true);
    expect(byKey.grasas).toBe(true);
    expect(byKey.piso).toBe(true);
  });
});

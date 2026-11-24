import { describe, expect, it } from "vitest";
import {
  buildSnapshot, decideNudges, defaultConfig, morningMessage, parseHealthPayload, parseSleepHours, projectGoal,
  recommendTargets, SEED_TEMPLATES, sleepStats, type BodyMetric, type Meal,
} from "@core";
import { parseHealthText } from "../src/lib/health";

const TODAY = "2026-11-24";

describe("parser de Apple Salud (Atajos)", () => {
  it("sueño en cualquier formato", () => {
    expect(parseSleepHours(7.5)).toBe(7.5);
    expect(parseSleepHours("7,5")).toBe(7.5);
    expect(parseSleepHours(450)).toBe(7.5); // minutos
    expect(parseSleepHours(27000)).toBe(7.5); // segundos
    expect(parseSleepHours([10800, 9000, 7200])).toBe(7.5); // tramos en segundos
    expect(parseSleepHours("10800\n9000\n7200")).toBe(7.5); // lista como texto
    expect(parseSleepHours("7 h 30 min")).toBe(7.5);
    expect(parseSleepHours("7:30")).toBe(7.5);
    expect(parseSleepHours(0)).toBeNull();
  });
  it("payload completo: hoy y ayer, números con formato argentino", () => {
    const u = parseHealthPayload({ sueno: "6,2", pasos_ayer: "8.432", peso: "82,1", fc_reposo: "58" }, TODAY);
    expect(u).toEqual([
      { date: TODAY, fields: { sleep_h: 6.2, weight_kg: 82.1, resting_hr: 58 } },
      { date: "2026-11-23", fields: { steps: 8432 } },
    ]);
  });
  it("ignora valores imposibles", () => {
    expect(parseHealthPayload({ peso: 900, fc_reposo: 300, sueno: 40 }, TODAY)).toEqual([]);
  });
  it("texto pegado tipo clave: valor", () => {
    const u = parseHealthText("sueno: 5,5\npasos_ayer: 10200", TODAY);
    expect(u[0].fields.sleep_h).toBe(5.5);
    expect(u[1].fields.steps).toBe(10200);
  });
});

describe("coaching según el sueño", () => {
  const cfg = defaultConfig("2026-11-01");
  const m = (d: string, sleep: number, kg?: number): BodyMetric => ({ id: d, local_date: d, sleep_h: sleep, weight_kg: kg ?? null });
  it("estadísticas", () => {
    const s = sleepStats([m("2026-11-22", 7), m("2026-11-23", 6), m(TODAY, 4)], TODAY);
    expect(s.lastNight).toBe(4);
    expect(s.avg7).toBe(5.7);
    expect(s.veryShort).toBe(true);
  });
  it("después de dormir poco, el mensaje de la mañana no aprieta", () => {
    const s = buildSnapshot(cfg, { meals: [], workouts: [], metrics: [m(TODAY, 4)], templates: SEED_TEMPLATES, events: [] }, new Date("2026-11-24T10:40:00Z"));
    const msg = morningMessage(s).body;
    expect(msg).toContain("Dormiste 4 h");
    expect(msg).toMatch(/nada de recortes/);
    expect(decideNudges(s, new Set()).find((n) => n.kind === "manana")!.body).toContain("Dormiste");
  });
  it("estancada pero durmiendo poco → no recorta calorías", () => {
    const metrics: BodyMetric[] = [];
    for (let i = 21; i >= 0; i--) {
      const d = new Date(Date.parse(TODAY) - i * 86400000).toISOString().slice(0, 10);
      metrics.push(m(d, 5.5, 82));
    }
    const meals: Meal[] = [];
    for (let i = 1; i <= 14; i++) {
      const d = new Date(Date.parse(TODAY) - i * 86400000).toISOString().slice(0, 10);
      meals.push({ id: d, local_date: d, slot: "almuerzo", eaten_at: `${d}T16:00:00Z`, items: [], totals: { kcal: 1700, p: 150, c: 180, f: 50 }, source: "list", confirmed: true });
    }
    const r = recommendTargets(cfg, projectGoal(cfg, metrics, meals, TODAY), meals, [], TODAY, metrics);
    expect(r.action).toBe("mantener");
    expect(r.title).toContain("sueño");
    expect(r.newTargets).toBeNull();
  });
});

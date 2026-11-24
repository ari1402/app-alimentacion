// Cardio → gasto estimado → objetivo del día.
//
// Base científica:
// - METs del Compendium of Physical Activities (Ainsworth 2011; actualización 2024).
//   Usamos kcal NETAS = (MET − 1) × kg × h: el reposo ya está en tu gasto basal,
//   sumarlo de nuevo duplicaría calorías.
// - Frecuencia cardíaca: ecuación de Keytel et al. 2005 (J Sports Sci), válida
//   aprox. entre 90 y 170 lpm.
// - Relojes y máquinas sobreestiman el gasto (Shcherbina 2017, J Pers Med: error
//   medio 27–93% según dispositivo): aplicamos un descuento del 20% y promediamos
//   con la estimación MET.
// - "Comerse de vuelta" solo una parte (por defecto 50%): las estimaciones tienen
//   error de ±20–30% y el cuerpo compensa parte del gasto (Thomas 2012; Pontzer
//   2016, gasto restringido). Así el cardio suma déficit sin dejarte con hambre.
// - Las kcal extra van a carbos (75%) y grasas (25%): la proteína ya está cubierta
//   y el glucógeno es lo que más se gasta en cardio moderado/intenso.
// - La fuerza NO suma: el plan base ya asume 3–4 sesiones por semana.
import type { CardioIntensity, CardioModality, CardioSession, Macros, UserConfig, Workout } from "./types.ts";
import { diffDays } from "./dates.ts";

export const CARDIO_TYPES: Record<CardioModality, { label: string; met: [number, number, number]; hint: [string, string, string] }> = {
  caminata: { label: "Caminata", met: [2.8, 3.5, 4.3], hint: ["paseo, ~3 km/h", "~5 km/h", "rápida, ~5.6 km/h"] },
  caminata_inclinada: { label: "Cinta inclinada", met: [5.0, 6.3, 8.0], hint: ["5% de inclinación", "10%, ~5 km/h", "12–15%"] },
  bici: { label: "Bici / spinning", met: [4.8, 6.8, 8.8], hint: ["charlando cómodo", "esfuerzo sostenido", "clase de spinning fuerte"] },
  eliptico: { label: "Elíptico", met: [4.6, 5.0, 6.8], hint: ["suave", "moderado", "intenso"] },
  correr: { label: "Correr / trotar", met: [7.0, 9.0, 11.0], hint: ["~6.5 km/h", "~8–9 km/h", "~11 km/h"] },
  natacion: { label: "Natación", met: [5.8, 7.0, 9.8], hint: ["libre suave", "libre moderado", "libre rápido"] },
  remo: { label: "Remo", met: [4.8, 7.0, 8.5], hint: ["suave", "moderado", "intenso"] },
  escaladora: { label: "Escaladora", met: [6.8, 8.8, 9.0], hint: ["lento", "moderado", "rápido"] },
  hiit: { label: "HIIT / funcional", met: [6.0, 8.0, 10.0], hint: ["con pausas largas", "circuito", "muy intenso"] },
  baile: { label: "Baile / zumba", met: [5.0, 6.5, 7.8], hint: ["suave", "clase", "intensa"] },
  otro: { label: "Otro", met: [3.5, 5.0, 7.0], hint: ["suave", "moderado", "intenso"] },
};

const IDX: Record<CardioIntensity, 0 | 1 | 2> = { suave: 0, moderada: 1, intensa: 2 };

export interface CardioEstimate {
  net_kcal: number;
  method: string;
  detail: string;
}

/** kcal/min brutas por frecuencia cardíaca (Keytel 2005) */
export function keytelKcalPerMin(hr: number, kg: number, age: number, sex: "f" | "m"): number {
  const kj = sex === "f"
    ? -20.4022 + 0.4472 * hr - 0.1263 * kg + 0.074 * age
    : -55.0969 + 0.6309 * hr + 0.1988 * kg + 0.2017 * age;
  return Math.max(0, kj / 4.184);
}

export function estimateCardio(
  s: Pick<CardioSession, "modality" | "minutes" | "intensity" | "avg_hr" | "device_kcal">,
  weightKg: number,
  profile: UserConfig["profile"],
): CardioEstimate {
  const h = Math.max(0, s.minutes) / 60;
  const met = CARDIO_TYPES[s.modality]?.met[IDX[s.intensity]] ?? 5;
  const rest = 1 * weightKg * h; // 1 MET ≈ 1 kcal/kg/h
  const metNet = Math.max(0, (met - 1) * weightKg * h);
  const parts: { v: number; w: number; name: string }[] = [{ v: metNet, w: 1, name: `MET ${met}` }];
  if (s.avg_hr && s.avg_hr >= 90 && s.avg_hr <= 190 && profile.age) {
    const gross = keytelKcalPerMin(s.avg_hr, weightKg, profile.age, profile.sex) * s.minutes;
    parts.push({ v: Math.max(0, gross - rest), w: 1.5, name: `FC ${s.avg_hr} lpm` });
  }
  if (s.device_kcal && s.device_kcal > 0) {
    parts.push({ v: Math.max(0, s.device_kcal * 0.8 - rest), w: 1, name: "reloj −20%" });
  }
  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const net = Math.round(parts.reduce((a, p) => a + p.v * p.w, 0) / wsum);
  return {
    net_kcal: net,
    method: parts.map((p) => p.name).join(" + "),
    detail: parts.length > 1 ? `promedio de ${parts.map((p) => `${p.name}: ${Math.round(p.v)}`).join(", ")}` : `${met} MET × ${Math.round(weightKg)} kg × ${Math.round(s.minutes)} min, menos el reposo`,
  };
}

export interface DayTargets {
  targets: Macros;
  ranges: UserConfig["ranges"];
  cardioNetKcal: number;
  cardioBonusKcal: number;
  cardioSessions: number;
  dietBreak: boolean;
}

function shift(base: { targets: Macros; ranges: UserConfig["ranges"] }, kcal: number): { targets: Macros; ranges: UserConfig["ranges"] } {
  if (!kcal) return base;
  const dc = Math.round((kcal * 0.75) / 4);
  const df = Math.round((kcal * 0.25) / 9);
  const r = base.ranges;
  return {
    targets: { kcal: base.targets.kcal + kcal, p: base.targets.p, c: base.targets.c + dc, f: base.targets.f + df },
    ranges: { kcal: [r.kcal[0] + kcal, r.kcal[1] + kcal], pMin: r.pMin, c: [r.c[0] + dc, r.c[1] + dc], f: [r.f[0] + df, r.f[1] + df] },
  };
}

export function isDietBreak(cfg: UserConfig, date: string): boolean {
  const b = cfg.diet_break;
  return !!b && date >= b.from && date <= b.until;
}

/** Objetivos de un día concreto: base + pausa de mantenimiento + cardio registrado */
export function targetsForDay(cfg: UserConfig, date: string, workouts: Workout[] = []): DayTargets {
  let cur = { targets: { ...cfg.targets }, ranges: cfg.ranges };
  const dietBreak = isDietBreak(cfg, date);
  if (dietBreak && cfg.diet_break) cur = shift(cur, Math.max(0, cfg.diet_break.kcal - cfg.targets.kcal));
  const cardio = workouts.filter((w) => w.local_date === date && (w.type === "cardio" || w.cardio));
  let net = 0;
  for (const w of cardio) {
    if (w.cardio) net += w.cardio.net_kcal;
    else if (w.duration_min) net += estimateCardio({ modality: "otro", minutes: w.duration_min, intensity: "moderada" }, cfg.goal.start_kg, cfg.profile).net_kcal;
  }
  const bonus = Math.min(cfg.cardio.max_bonus, Math.round((net * cfg.cardio.eatback) / 10) * 10);
  cur = shift(cur, bonus);
  return { ...cur, cardioNetKcal: net, cardioBonusKcal: bonus, cardioSessions: cardio.length, dietBreak };
}

/** "Si hago X de cardio, ¿cuánto más puedo comer hoy?" */
export function simulateCardio(
  cfg: UserConfig,
  workouts: Workout[],
  date: string,
  s: Pick<CardioSession, "modality" | "minutes" | "intensity">,
  weightKg: number,
): { net_kcal: number; bonus_kcal: number; newTarget: number; detail: string } {
  const est = estimateCardio(s, weightKg, cfg.profile);
  const before = targetsForDay(cfg, date, workouts);
  const fake: Workout = { id: "sim", local_date: date, type: "cardio", exercises: [], cardio: { ...s, net_kcal: est.net_kcal, method: est.method } };
  const after = targetsForDay(cfg, date, [...workouts, fake]);
  return { net_kcal: est.net_kcal, bonus_kcal: after.cardioBonusKcal - before.cardioBonusKcal, newTarget: after.targets.kcal, detail: est.detail };
}

/** Días desde el inicio del plan o de la última pausa */
export function weeksInDeficit(cfg: UserConfig, today: string): number {
  const from = cfg.diet_break?.until && cfg.diet_break.until < today ? cfg.diet_break.until : cfg.goal.start_date;
  return Math.max(0, Math.floor(diffDays(today, from) / 7));
}

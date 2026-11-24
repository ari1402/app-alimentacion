// Datos de Apple Salud / Apple Watch que llegan desde un Atajo de iPhone.
// Los Atajos mandan números con formatos variados ("7,5", "27000 s", listas de
// duraciones de cada tramo de sueño), así que el parser es tolerante.
import type { BodyMetric } from "./types.ts";
import { addDays } from "./dates.ts";

export interface HealthUpdate {
  date: string;
  fields: Partial<Pick<BodyMetric, "sleep_h" | "steps" | "weight_kg" | "resting_hr">>;
}

/** "7,5" → 7.5 ; "8.432 pasos" → 8432 ; [1,2] → [1,2] */
function toNumbers(v: unknown): number[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(toNumbers);
  if (typeof v === "number") return Number.isFinite(v) ? [v] : [];
  if (typeof v === "object") return toNumbers((v as Record<string, unknown>).value ?? (v as Record<string, unknown>).cantidad);
  const parts = String(v).split(/[\n;]+|,\s+/);
  return parts.flatMap((p) => {
    let t = p.trim().toLowerCase();
    if (!t) return [];
    // Duraciones compuestas: "7 h 23 min", "7h23m", "7:23", "7 horas 23 minutos"
    const hm = /^(\d+)\s*(?:h|hs|hr|horas?)\s*(\d+)\s*(?:m|min|minutos?)?$/.exec(t) ?? /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t);
    if (hm) return [Number(hm[1]) * 3600 + Number(hm[2]) * 60];
    // separadores: "8.432" (miles) vs "7,5" (decimal) vs "82.4" (decimal)
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
    t = t.replace(",", ".");
    const m = /-?\d+(\.\d+)?/.exec(t);
    if (!m) return [];
    let n = Number(m[0]);
    if (/\bh(s|r|oras?)?\b/.test(t) && !/min/.test(t)) n = n * 3600;
    else if (/min/.test(t)) n = n * 60;
    return [n];
  });
}

/**
 * Sueño: puede venir como horas (7.2), minutos (432), segundos (25920) o una
 * lista de duraciones de cada tramo (en segundos, como las devuelve Salud).
 */
export function parseSleepHours(v: unknown): number | null {
  const ns = toNumbers(v).filter((n) => n > 0);
  if (!ns.length) return null;
  const total = ns.reduce((a, b) => a + b, 0);
  let h: number;
  if (total <= 24) h = total; // horas
  else if (total <= 24 * 60) h = total / 60; // minutos
  else h = total / 3600; // segundos
  if (h < 1 || h > 16) return null; // menos de 1 h para una noche = dato mal leído
  return Math.round(h * 10) / 10;
}

function sum(v: unknown): number | null {
  const ns = toNumbers(v).filter((n) => n >= 0);
  return ns.length ? ns.reduce((a, b) => a + b, 0) : null;
}

function last(v: unknown): number | null {
  const ns = toNumbers(v).filter((n) => n > 0);
  return ns.length ? ns[ns.length - 1] : null;
}

const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (o[k] != null && o[k] !== "") return o[k];
  return undefined;
};

/**
 * Payload del Atajo (claves en español o inglés):
 *   sueno | sleep           → horas de la noche que terminó HOY
 *   pasos_ayer | steps_yesterday → pasos totales de AYER (día completo)
 *   pasos | steps           → pasos de hoy hasta ahora (se guardan como del día)
 *   peso | weight           → kg (el último valor)
 *   fc_reposo | resting_hr  → lpm
 *   fecha | date            → YYYY-MM-DD opcional (por defecto hoy)
 */
export function parseHealthPayload(payload: unknown, today: string): HealthUpdate[] {
  if (!payload || typeof payload !== "object") return [];
  const o = payload as Record<string, unknown>;
  const d = String(pick(o, ["fecha", "date"]) ?? "");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  const todayFields: HealthUpdate["fields"] = {};
  const sleep = parseSleepHours(pick(o, ["sueno", "sueño", "sleep", "sleep_h"]));
  if (sleep != null) todayFields.sleep_h = sleep;
  const w = last(pick(o, ["peso", "weight", "weight_kg"]));
  if (w != null && w >= 30 && w <= 250) todayFields.weight_kg = Math.round(w * 10) / 10;
  const hr = last(pick(o, ["fc_reposo", "resting_hr", "frecuencia_reposo"]));
  if (hr != null && hr >= 30 && hr <= 120) todayFields.resting_hr = Math.round(hr);
  const stepsToday = sum(pick(o, ["pasos", "steps"]));
  if (stepsToday != null && stepsToday < 100000) todayFields.steps = Math.round(stepsToday);
  const out: HealthUpdate[] = [];
  if (Object.keys(todayFields).length) out.push({ date, fields: todayFields });
  const stepsY = sum(pick(o, ["pasos_ayer", "steps_yesterday"]));
  if (stepsY != null && stepsY < 100000) out.push({ date: addDays(date, -1), fields: { steps: Math.round(stepsY) } });
  return out;
}

export interface SleepStats {
  lastNight: number | null;
  avg7: number | null;
  nights7: number;
  short: boolean; // < 6 h anoche
  veryShort: boolean; // < 4.5 h (típico post guardia)
}

export function sleepStats(metrics: BodyMetric[], today: string): SleepStats {
  const from = addDays(today, -6);
  const recent = metrics.filter((m) => m.local_date >= from && m.local_date <= today && m.sleep_h);
  const lastNight = metrics.find((m) => m.local_date === today)?.sleep_h ?? null;
  const avg7 = recent.length ? Math.round((recent.reduce((a, m) => a + (m.sleep_h as number), 0) / recent.length) * 10) / 10 : null;
  return { lastNight, avg7, nights7: recent.length, short: lastNight != null && lastNight < 6, veryShort: lastNight != null && lastNight < 4.5 };
}

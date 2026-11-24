// Parte adaptativa: aprende de la adherencia real y ajusta horarios/frecuencia
// en vez de repetir el mismo recordatorio que no funciona.
import type { CoachEvent, Meal, NudgeKind, ReminderKey, UserConfig } from "./types.ts";
import { addDays, hhmmToMinutes, localParts, minutesToHHMM } from "./dates.ts";

export interface AdaptivePlan {
  reminderTimes: Partial<Record<ReminderKey, string>>;
  /** Tipos de nudge que hoy no se mandan (frecuencia reducida o desactivados) */
  skip: Partial<Record<NudgeKind, boolean>>;
  /** Explicación transparente de cada ajuste */
  notes: string[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const SLOT_KEYS = ["desayuno", "almuerzo", "merienda", "cena"] as const;
const LABEL: Record<string, string> = { desayuno: "desayuno", almuerzo: "almuerzo", merienda: "merienda", cena: "cena" };

export function computeAdaptive(
  cfg: UserConfig,
  meals: Meal[],
  events: CoachEvent[],
  today: string,
): AdaptivePlan {
  const plan: AdaptivePlan = { reminderTimes: {}, skip: {}, notes: [] };
  const from = addDays(today, -21);
  const recent = meals.filter((m) => m.local_date >= from && m.local_date < today);
  const daysWithData = new Set(recent.map((m) => m.local_date)).size;

  for (const slot of SLOT_KEYS) {
    const cfgMin = hhmmToMinutes(cfg.reminders[slot]);
    if (cfgMin == null) continue;
    const times = recent
      .filter((m) => m.slot === slot)
      .map((m) => localParts(new Date(m.eaten_at), cfg.timezone).minutes);
    if (times.length >= 5) {
      const med = median(times);
      // El recordatorio tiene que llegar ANTES de la decisión, no después.
      const ideal = Math.round((med - 20) / 5) * 5;
      if (Math.abs(ideal - cfgMin) >= 30) {
        plan.reminderTimes[slot] = minutesToHHMM(ideal);
        plan.notes.push(
          `Recordatorio de ${LABEL[slot]} a las ${minutesToHHMM(ideal)} (no ${cfg.reminders[slot]}): solés comer cerca de las ${minutesToHHMM(med)}.`,
        );
      }
    }
    // Slot que casi nunca se registra: no insistir
    if (daysWithData >= 10) {
      const logged = new Set(recent.filter((m) => m.slot === slot).map((m) => m.local_date)).size;
      if (logged / daysWithData < 0.2 && slot === "merienda") {
        plan.skip[slot] = true;
        plan.notes.push(`Casi no registrás ${LABEL[slot]}: dejamos de recordarla. Si la querés de vuelta, activala en Ajustes.`);
      }
    }
  }

  // Nudges ignorados repetidamente → bajar frecuencia (día por medio)
  const byKind = new Map<string, CoachEvent[]>();
  for (const e of events) {
    if (e.channel !== "push") continue;
    const l = byKind.get(e.kind) ?? [];
    l.push(e);
    byKind.set(e.kind, l);
  }
  const dayNum = Math.floor(Date.parse(today + "T12:00:00Z") / 86400000);
  for (const [kind, list] of byKind) {
    const sorted = list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    let ignored = 0;
    for (const e of sorted) {
      if (e.response === "opened" || e.response === "logged") break;
      ignored++;
    }
    if (ignored >= 5 && kind !== "noche" && kind !== "semanal") {
      if (dayNum % 2 === 1) plan.skip[kind as NudgeKind] = true;
      plan.notes.push(`El aviso de "${kind}" no te estaba sirviendo (${ignored} seguidos sin abrir): ahora sale día por medio.`);
    }
  }
  return plan;
}

/** Hora efectiva de un recordatorio (adaptada si corresponde) */
export function effectiveTime(cfg: UserConfig, plan: AdaptivePlan | null, key: ReminderKey): string | null {
  return plan?.reminderTimes[key] ?? cfg.reminders[key];
}

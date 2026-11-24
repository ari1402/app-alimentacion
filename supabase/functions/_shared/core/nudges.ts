// Coach proactivo: decide QUÉ decir y CUÁNDO, con plantillas (sin IA → sin costo,
// instantáneo, predecible). Tono: directo, técnico, calmado, rioplatense, sin moralizar.
import type { Meal, MealTemplate, NudgeKind, ReminderKey, Slot } from "./types.ts";
import { fmtRange, hhmmToMinutes, inWindow } from "./dates.ts";
import { type DayState, projectDayClose, rankTemplates, slotLabel } from "./macros.ts";
import { effectiveTime } from "./adaptive.ts";
import type { Snapshot } from "./snapshot.ts";

export interface Nudge {
  kind: NudgeKind;
  dedupe_key: string;
  title: string;
  body: string;
  url: string;
  /** acciones rápidas para la notificación */
  actions?: { action: string; title: string }[];
}

/** Ventana (min) durante la cual un nudge programado todavía puede salir */
export const NUDGE_WINDOW_MIN = 50;

function pick<T>(list: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

const r = Math.round;

// ─────────────────────────── piezas de texto ───────────────────────────

function bestOption(s: Snapshot, slot: Slot): MealTemplate | null {
  const ranked = rankTemplates(s.templates, slot, s.day);
  return ranked.find((x) => x.fits)?.template ?? ranked[0]?.template ?? null;
}

function optionLine(t: MealTemplate | null): string {
  if (!t) return "";
  return `${t.code} · ${t.name} (${r(t.totals.kcal)} kcal, ${r(t.totals.p)} g P)`;
}

function momentumLine(s: Snapshot): string {
  if (s.streak.current >= 3) return `Venís ${s.streak.current} días seguidos en rango.`;
  const good = s.week.adherence.on + s.week.adherence.near;
  if (good >= 2) return `Esta semana ya van ${good} días en rango.`;
  if (s.projection.lostKg != null && s.projection.lostKg >= 0.5) return `Ya bajaste ${s.projection.lostKg} kg de tendencia.`;
  return "";
}

function proteinIdea(gap: number, lowCarb: boolean, guardia: boolean): string {
  if (guardia) return gap > 30 ? "yogur griego + scoop de whey, o sándwich de pavo" : "un yogur griego o una barrita proteica";
  if (gap >= 40) return lowCarb ? "150 g de carne magra o 2 huevos + 3 claras" : "150 g de carne magra o una lata de atún";
  if (gap >= 20) return "un yogur griego o un scoop de whey en leche";
  return "un huevo o 2 fetas de pavo";
}

function preWorkoutLine(s: Snapshot): string {
  return s.day.remaining.c > 40
    ? "60–90 min antes: carbos + proteína (ej. yogur griego con banana, o tostadas con pavo)."
    : "60–90 min antes algo chico con proteína y algo de carbo (ej. yogur con fruta).";
}

/** Ajuste concreto para mañana según lo que más se alejó hoy */
export function tomorrowAdjustment(day: DayState, s: Snapshot): string {
  const cfg = s.cfg;
  const t = day.totals;
  if (day.meals.length === 0) return "Mañana arrancamos de cero: registrá el desayuno y ya estás.";
  if (t.kcal < 1100 && day.meals.length >= 2)
    return "Hoy quedaste bastante abajo. Comer de menos no acelera la baja y te cuesta el músculo: mañana apuntá al rango completo.";
  const pGap = cfg.ranges.pMin - t.p;
  if (pGap > 15) return `Mañana: sumá proteína temprano (el desayuno con ~35 g, ej. panqueque proteico o yogur griego + whey). Hoy faltaron ${r(pGap)} g.`;
  if (t.kcal > cfg.ranges.kcal[1] + 150) return "Mañana: día normal, sin compensar. Si querés, una cena baja en carbos y el margen semanal hace el resto.";
  if (t.c > cfg.ranges.c[1] + 20) return "Mañana: repartí mejor los carbos (que ninguna comida pase de 50 g) y listo.";
  if (t.f > cfg.ranges.f[1] + 10) return "Mañana: mirá el aceite y los quesos; medir 1 cda de aceite cambia bastante.";
  if (t.kcal < cfg.ranges.kcal[0] - 150) return "Mañana: comé las 4 comidas completas, no hace falta recortar.";
  return "Día redondo. Mañana, lo mismo.";
}

// ─────────────────────────── mensajes por momento ───────────────────────────

export function morningMessage(s: Snapshot): Omit<Nudge, "dedupe_key"> {
  const c = s.cfg;
  const parts: string[] = [`Objetivo: ${c.targets.kcal} kcal y ≥${c.ranges.pMin} g de proteína.`];
  if (s.guardia) parts.push("Modo guardia: priorizá proteína cada 4–5 h, lo demás se acomoda.");
  else if (s.workouts.isTrainingDay && !s.workouts.trainedToday) parts.push(`Hoy toca fuerza (${c.workout.time}). ${preWorkoutLine(s)}`);
  if (!s.day.slotsLogged.includes("desayuno")) {
    const o = bestOption(s, "desayuno");
    if (o) parts.push(`Desayuno que entra: ${optionLine(o)}.`);
  }
  if (!s.weighedToday) parts.push("Si podés, pesate ahora en ayunas: recalcula la proyección.");
  const m = momentumLine(s);
  if (m) parts.push(m);
  if (s.yesterday.status === "off" && c.why) parts.push(`Tu porqué: "${c.why}".`);
  return { kind: "manana", title: pick(["Plan de hoy", "Arrancamos", "Buen día"], s.today), body: parts.join(" "), url: "/" };
}

export function slotMessage(s: Snapshot, slot: Exclude<Slot, "snack">): Omit<Nudge, "dedupe_key"> {
  const d = s.day;
  const o = bestOption(s, slot);
  const parts = [`Te quedan ${Math.max(0, d.remaining.kcal)} kcal y ${Math.max(0, r(d.remaining.p))} g de proteína.`];
  if (d.carbRule.active) parts.push("Venís de una comida alta en carbos: esta conviene baja en carbos.");
  if (o) parts.push(`Una opción que entra: ${optionLine(o)}.`);
  else parts.push(`Apuntá a ~${d.proteinPerPendingMeal} g de proteína.`);
  const titles: Record<string, string[]> = {
    desayuno: ["¿Desayuno?", "Antes de desayunar"],
    almuerzo: ["Antes de almorzar", "¿Almuerzo?"],
    merienda: ["Merienda", "¿Merienda?"],
    cena: ["Antes de cenar", "Para la cena"],
  };
  return {
    kind: slot,
    title: pick(titles[slot], s.today + slot),
    body: parts.join(" "),
    url: `/registrar?slot=${slot}`,
    actions: [{ action: "log", title: "Registrar" }],
  };
}

export function afternoonMessage(s: Snapshot): Omit<Nudge, "dedupe_key"> {
  const c = s.cfg;
  const proj = projectDayClose(s.day, s.typical);
  const parts = [`Llevás ${s.day.totals.kcal} kcal y ${r(s.day.totals.p)} g P. Con lo que solés comer en lo que falta, cerrarías en ~${proj.kcal} kcal y ${r(proj.p)} g de proteína.`];
  const pGap = c.ranges.pMin - proj.p;
  if (pGap > 5) parts.push(`Para cerrar la proteína sumá ~${r(pGap)} g: ${proteinIdea(pGap, s.day.carbRule.active, s.guardia)}.`);
  else if (proj.kcal > c.ranges.kcal[1]) parts.push(`Viene ~${r(proj.kcal - c.ranges.kcal[1])} kcal alto: una cena con menos carbos lo acomoda.`);
  else if (proj.kcal < c.ranges.kcal[0] - 150) parts.push("Viene bajo: cená completo, no hace falta recortar.");
  else parts.push("Venís bien encaminada.");
  return { kind: "tarde", title: "Proyección del día", body: parts.join(" "), url: "/" };
}

export function nightMessage(s: Snapshot): Omit<Nudge, "dedupe_key"> {
  const d = s.day;
  if (!d.meals.length) {
    return {
      kind: "noche",
      title: "Cierre del día",
      body: "Hoy no hay registros. Si querés, cargá lo principal (15 s); si no, mañana arrancamos de cero.",
      url: "/registrar",
    };
  }
  const ok = d.checklist.filter((x) => x.ok).length;
  const t = d.totals;
  const body = [
    `${t.kcal} kcal · ${r(t.p)} P · ${r(t.c)} C · ${r(t.f)} G → ${ok}/4 del checklist.`,
    tomorrowAdjustment(d, s),
  ];
  const m = momentumLine(s);
  if (m && d.status !== "off") body.push(m);
  return { kind: "noche", title: d.status === "on" ? "Día en objetivo ✓" : "Cierre del día", body: body.join(" "), url: "/progreso" };
}

export function weeklyMessage(s: Snapshot): Omit<Nudge, "dedupe_key"> {
  const w = s.week;
  const good = w.adherence.on + w.adherence.near;
  const logged = good + w.adherence.off;
  const p = s.projection;
  const parts = [`${good}/${logged || 7} días en rango, proteína ok ${w.proteinDaysOk} días. Entrenos: ${s.workouts.done}/${s.workouts.goalMin}.`];
  if (p.currentTrend != null) parts.push(`Tendencia: ${p.currentTrend} kg (${p.kgPerWeek != null && p.kgPerWeek < 0 ? `${p.kgPerWeek} kg/sem` : "estable"}).`);
  if (p.dateRange) parts.push(`Llegada estimada a ${s.cfg.goal.target_max} kg: ${fmtRange(p.dateRange[0], p.dateRange[1])}.`);
  if (logged && good / logged >= 0.8) parts.push("Eso es sostenible: seguí igual.");
  else if (w.adherence.off >= 3) parts.push("La semana que viene, un solo foco: proteína en el desayuno. Lo demás se ordena solo.");
  return { kind: "semanal", title: "Cierre de la semana", body: parts.join(" "), url: "/progreso" };
}

export function guardiaMessage(s: Snapshot): Omit<Nudge, "dedupe_key"> {
  return {
    kind: "guardia",
    title: "Guardia",
    body: `¿Comiste algo con proteína en las últimas 4–5 h? Opciones portables: yogur griego, barrita proteica, sándwich de pavo. Llevás ${r(s.day.totals.p)} g P.`,
    url: "/registrar",
  };
}

export function mealFeedback(meal: Meal, after: DayState, s: Snapshot): string {
  const c = s.cfg;
  const parts: string[] = [];
  const p = r(meal.totals.p);
  if (after.totals.p >= c.ranges.pMin && after.totals.p - meal.totals.p < c.ranges.pMin)
    parts.push(`Con esta ${slotLabel(meal.slot).toLowerCase()} cerrás la proteína del día ✓.`);
  else parts.push(`${p} g de proteína en esta comida; te quedan ${Math.max(0, r(after.remaining.p))} g y ${Math.max(0, after.remaining.kcal)} kcal.`);
  if (meal.totals.c > c.carb_rule_threshold) parts.push(`Tuvo ${r(meal.totals.c)} g de carbos: la próxima, baja en carbos.`);
  if (after.remaining.kcal < -100) parts.push(`Quedás ${-after.remaining.kcal} kcal sobre el objetivo; va al margen de la semana (${s.week.marginKcal >= 0 ? "+" : ""}${s.week.marginKcal}).`);
  else if (after.pendingSlots.length && after.remaining.p > 0)
    parts.push(`Para lo que falta: ~${after.proteinPerPendingMeal} g de proteína por comida.`);
  return parts.join(" ");
}

// ─────────────────────────── decisión programada ───────────────────────────

const SLOT_REMINDERS: Exclude<Slot, "snack">[] = ["desayuno", "almuerzo", "merienda", "cena"];

function due(now: number, at: number | null): boolean {
  return at != null && inWindow(now, at, at + NUDGE_WINDOW_MIN);
}

function enabled(s: Snapshot, kind: NudgeKind): boolean {
  const k = s.cfg.notifications.kinds[kind];
  return k !== false && !s.adaptive.skip[kind];
}

/**
 * Qué nudges corresponde mandar AHORA. Se llama cada ~15 min desde el cron.
 * `sent` = dedupe_keys ya enviados (para no repetir).
 */
export function decideNudges(s: Snapshot, sent: Set<string>): Nudge[] {
  const cfg = s.cfg;
  if (!cfg.notifications.enabled) return [];
  const quietStart = hhmmToMinutes(cfg.quiet_hours.start) ?? 23 * 60 + 30;
  const quietEnd = hhmmToMinutes(cfg.quiet_hours.end) ?? 7 * 60;
  if (inWindow(s.minutes, quietStart, quietEnd)) return [];
  const out: Nudge[] = [];
  const push = (n: Omit<Nudge, "dedupe_key">, key: string) => {
    const dk = `${s.today}:${key}`;
    if (!sent.has(dk) && enabled(s, n.kind)) out.push({ ...n, dedupe_key: dk });
  };
  const at = (k: ReminderKey) => hhmmToMinutes(effectiveTime(cfg, s.adaptive, k));

  if (s.guardia) {
    // En guardia: solo dos chequeos suaves de proteína
    for (const t of [12 * 60 + 30, 19 * 60 + 30]) if (due(s.minutes, t)) push(guardiaMessage(s), `guardia-${t}`);
    return out;
  }

  if (due(s.minutes, at("manana"))) push(morningMessage(s), "manana");
  for (const slot of SLOT_REMINDERS) {
    if (s.day.slotsLogged.includes(slot)) continue;
    if (due(s.minutes, at(slot))) push(slotMessage(s, slot), slot);
  }
  const wt = hhmmToMinutes(cfg.workout.time);
  if (wt != null && s.workouts.isTrainingDay) {
    if (!s.workouts.trainedToday && due(s.minutes, wt - 90)) {
      push({ kind: "pre_entreno", title: "Entreno en 1 h 30", body: preWorkoutLine(s) + ` Te quedan ${Math.max(0, r(s.day.remaining.c))} g de carbos para el día.`, url: "/" }, "pre_entreno");
    }
    if (due(s.minutes, wt + 90)) {
      push({
        kind: "post_entreno",
        title: "Post entreno",
        body: s.workouts.trainedToday
          ? `Sumá 30–40 g de proteína en la próxima comida. Semana: ${s.workouts.done}/${s.workouts.goalMin}.`
          : "¿Entrenaste? Registralo en 20 s (precarga tus últimas cargas). Después, 30–40 g de proteína.",
        url: s.workouts.trainedToday ? "/registrar" : "/entrenos/nuevo",
      }, "post_entreno");
    }
  }
  if (due(s.minutes, at("tarde"))) push(afternoonMessage(s), "tarde");
  if (due(s.minutes, at("noche"))) push(nightMessage(s), "noche");
  if (s.weekday === cfg.weekly_review_day && due(s.minutes, at("semanal"))) push(weeklyMessage(s), "semanal");

  // Medidas cada N días, junto al mensaje de la mañana (+10 min)
  const m = at("manana");
  const lastM = s.lastMeasureDate;
  const daysSince = lastM ? (Date.parse(s.today) - Date.parse(lastM)) / 86400000 : Infinity;
  if (m != null && daysSince >= cfg.measure_every_days && due(s.minutes, m + 10)) {
    push({
      kind: "medidas",
      title: lastM ? "Toca medir" : "Medidas iniciales",
      body: lastM
        ? "Cintura, cadera y muslo: 2 minutos. Las medidas muestran avances que la balanza a veces no."
        : "Tomá cintura, cadera y muslo hoy (2 min): son el punto de partida para ver el avance real.",
      url: "/progreso?medidas=1",
    }, "medidas");
  }
  return out;
}

/** Mensaje principal para la tarjeta del coach en la pantalla Hoy (sin push) */
export function coachCard(s: Snapshot): Omit<Nudge, "dedupe_key"> {
  const cfg = s.cfg;
  const m = s.minutes;
  if (s.guardia) return guardiaMessage(s);
  const tNoche = hhmmToMinutes(cfg.reminders.noche) ?? 22 * 60 + 30;
  const tTarde = hhmmToMinutes(cfg.reminders.tarde) ?? 18 * 60 + 30;
  if (m >= tNoche || m < 5 * 60) return nightMessage(s);
  if (m >= tTarde) {
    if (!s.day.slotsLogged.includes("cena")) return { ...afternoonMessage(s), title: "Para la cena" };
    return nightMessage(s);
  }
  if (!s.day.meals.length && m < 11 * 60) return morningMessage(s);
  if (!s.day.meals.length) {
    return {
      kind: "tarde",
      title: "Arrancá por lo simple",
      body: `Todavía no hay registros hoy. Cargá lo que comiste en una frase (15 s) y te digo qué conviene para lo que falta. Objetivo: ${cfg.targets.kcal} kcal y ≥${cfg.ranges.pMin} g de proteína.`,
      url: "/registrar",
    };
  }
  // El slot pendiente cuya ventana incluye ahora (desde 90 min antes hasta 2 h 30 después)
  const candidates = SLOT_REMINDERS.filter((slot) => {
    const t = hhmmToMinutes(effectiveTime(cfg, s.adaptive, slot));
    return t != null && !s.day.slotsLogged.includes(slot) && m >= t - 90 && m <= t + 150;
  });
  const next = candidates[candidates.length - 1];
  if (next) return slotMessage(s, next);
  return afternoonMessage(s);
}

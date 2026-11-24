// Utilidades de fecha con zona horaria explícita (por defecto Buenos Aires).
// Trabajamos con fechas locales como strings YYYY-MM-DD para evitar errores de TZ.

export const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

export interface LocalParts {
  date: string; // YYYY-MM-DD
  hour: number;
  minute: number;
  weekday: number; // 0 = domingo
  minutes: number; // minutos desde medianoche
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(at: Date, tz: string = DEFAULT_TZ): LocalParts {
  const parts = fmt(tz).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour,
    minute,
    weekday: WD[get("weekday")] ?? 0,
    minutes: hour * 60 + minute,
  };
}

export function localDate(at: Date = new Date(), tz: string = DEFAULT_TZ): string {
  return localParts(at, tz).date;
}

function toUTC(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function addDays(d: string, n: number): string {
  const dt = toUTC(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86400000);
}

export function weekdayOf(d: string): number {
  return toUTC(d).getUTCDay();
}

/** Lunes de la semana de `d` */
export function weekStart(d: string): string {
  const wd = weekdayOf(d);
  return addDays(d, -((wd + 6) % 7));
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function hhmmToMinutes(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** ¿`min` está dentro del rango [start,end) que puede cruzar medianoche? */
export function inWindow(min: number, start: number, end: number): boolean {
  if (start <= end) return min >= start && min < end;
  return min >= start || min < end;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export function fmtShort(d: string): string {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${MESES[m - 1]}`;
}

export function dayName(d: string): string {
  return DIAS[weekdayOf(d)];
}

export function fmtRange(a: string, b: string): string {
  if (a === b) return fmtShort(a);
  const [ya, ma] = a.split("-");
  const [yb, mb] = b.split("-");
  const [, , da] = a.split("-").map(Number);
  if (ya === yb && ma === mb) return `${da}–${fmtShort(b)}`;
  return `${fmtShort(a)} – ${fmtShort(b)}`;
}

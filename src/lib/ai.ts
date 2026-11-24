// Cliente de IA del frontend. La key NUNCA está en el código:
// - Modo nube: pasa por la Edge Function; la key vive cifrada en Supabase Vault.
// - Modo local con key cargada en Ajustes: la key está solo en este dispositivo
//   (IndexedDB) y la app llama a api.anthropic.com directo por HTTPS.
// - Modo local sin key: servidor de desarrollo (`npm run dev` + .env.local).
import { localDate, mergeConfig, type Food, type LearnedPortion, type MealItem, type Slot, type UserConfig } from "@core";
import type { CoachData } from "@core";
import { supabase } from "./supabase";
import { getLocalKey } from "./apiKey";
import { kvGet, kvSet } from "./idb";

export class AIUnavailable extends Error {}

export interface ParseResult {
  items: MealItem[];
  slot: Slot | null;
  clarification: string | null;
}

export interface CoachReply {
  text: string;
  proposals: { slot: Slot; items: MealItem[]; totals: MealItem }[];
}

async function call<T>(fn: "parse-meal" | "coach", body: Record<string, unknown>, localExtra: () => Record<string, unknown>): Promise<T> {
  if (supabase) {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) {
      let msg = error.message;
      try {
        const ctx = (error as { context?: Response }).context;
        if (ctx && typeof ctx.json === "function") msg = (await ctx.json()).error ?? msg;
      } catch { /* sin cuerpo */ }
      throw new Error(msg);
    }
    return data as T;
  }
  // Modo local con key en el dispositivo: llamada directa a Anthropic desde el navegador
  const key = await getLocalKey();
  if (key) return direct<T>(fn, key, { ...body, ...localExtra() });

  // Modo local sin key: servidor de desarrollo (`npm run dev` con ANTHROPIC_API_KEY en .env.local)
  let res: Response;
  try {
    res = await fetch(`${import.meta.env.BASE_URL}api/${fn}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, ...localExtra() }) });
  } catch {
    throw new AIUnavailable("IA no disponible sin conexión.");
  }
  if (res.status === 404 || res.status === 405 || res.status === 503 || !(res.headers.get("content-type") ?? "").includes("json")) {
    throw new AIUnavailable((await res.json().catch(() => ({}))).error ?? "Falta la API key: cargala en Ajustes → API key de Claude.");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json as T;
}

/** Límite diario de consultas también en modo local */
async function bumpLocalBudget(): Promise<void> {
  const cfg = mergeConfig(await kvGet<UserConfig>("config"), localDate());
  const today = localDate(new Date(), cfg.timezone);
  const u = (await kvGet<{ date: string; count: number }>("ai_usage")) ?? { date: today, count: 0 };
  const count = u.date === today ? u.count : 0;
  if (count >= cfg.ai_daily_limit) throw new Error(`Llegaste al límite de ${cfg.ai_daily_limit} consultas de IA por hoy (Ajustes → IA). La carga por lista sigue funcionando.`);
  await kvSet("ai_usage", { date: today, count: count + 1 });
}

async function direct<T>(fn: "parse-meal" | "coach", key: string, body: Record<string, any>): Promise<T> {
  await bumpLocalBudget();
  // Carga diferida: el SDK solo se descarga la primera vez que se usa la IA
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  try {
    if (fn === "parse-meal") {
      const { parseMeal } = await import("@ai/parseMeal.ts");
      return (await parseMeal(client, body as any)) as T;
    }
    const { runCoach } = await import("@ai/coach.ts");
    return (await runCoach(client, { ...(body as any), now: new Date() })) as T;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new AIUnavailable("La API key no es válida o fue revocada. Cargá una nueva en Ajustes → API key de Claude.");
    }
    if (e instanceof Anthropic.RateLimitError) throw new Error("La IA está saturada o llegaste al límite de tu cuenta. Probá en un minuto.");
    if (e instanceof Anthropic.APIConnectionError) throw new AIUnavailable("Sin conexión con la IA.");
    throw e;
  }
}

export function parseMealAI(
  req: { text?: string; image?: { media_type: string; data: string } | null; slot?: Slot | null },
  local: { foods: Food[]; portions: LearnedPortion[] },
): Promise<ParseResult> {
  return call("parse-meal", req, () => local);
}

export function coachAI(
  req: { mode: "chat" | "analisis_dia" | "analisis_semana"; messages: { role: "user" | "assistant"; content: string }[] },
  local: { cfg: UserConfig; data: CoachData; foods: Food[] },
): Promise<CoachReply> {
  return call("coach", { ...req, now: new Date().toISOString() }, () => local);
}

/** Reduce una foto a ≤1280 px JPEG para que el parseo sea rápido y barato */
export async function fileToImagePayload(file: File): Promise<{ media_type: "image/jpeg"; data: string }> {
  const bmp = await createImageBitmap(file);
  const max = 1280;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  return { media_type: "image/jpeg", data: dataUrl.split(",")[1] };
}

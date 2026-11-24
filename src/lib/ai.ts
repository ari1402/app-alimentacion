// Cliente de IA del frontend. NUNCA llama a Anthropic directo: pasa por la Edge
// Function (nube) o por el servidor de Vite (dev local). La key no está acá.
import type { Food, LearnedPortion, MealItem, Slot, UserConfig } from "@core";
import type { CoachData } from "@core";
import { supabase } from "./supabase";
import { localKeyHeader } from "./apiKey";

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
  // Modo local: solo existe con `npm run dev` y ANTHROPIC_API_KEY en .env.local
  let res: Response;
  try {
    res = await fetch(`/api/${fn}`, { method: "POST", headers: { "content-type": "application/json", ...(await localKeyHeader()) }, body: JSON.stringify({ ...body, ...localExtra() }) });
  } catch {
    throw new AIUnavailable("IA no disponible sin conexión.");
  }
  if (res.status === 404 || res.status === 503) throw new AIUnavailable((await res.json().catch(() => ({}))).error ?? "IA no disponible en modo local.");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json as T;
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

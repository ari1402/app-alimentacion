// API key de Claude cargada desde la app.
// - Modo nube: se manda UNA vez a la Edge Function `api-key`, que la valida y la guarda
//   cifrada en Supabase Vault. El navegador no la guarda y el servidor nunca la devuelve.
// - Modo local (por ej. GitHub Pages sin Supabase): queda solo en este dispositivo
//   (IndexedDB) y la app llama a api.anthropic.com directo. Nunca entra al código ni a Git.
import { supabase } from "./supabase";
import { kvGet, kvSet } from "./idb";

export interface KeyStatus {
  configured: boolean;
  last4: string | null;
  source: "app" | "servidor" | "dispositivo" | null;
}

const LOCAL = "anthropic_key";

async function invoke(body: Record<string, unknown>): Promise<KeyStatus> {
  const { data, error } = await supabase!.functions.invoke("api-key", { body });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") msg = (await ctx.json()).error ?? msg;
    } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  return data as KeyStatus;
}

export async function keyStatus(): Promise<KeyStatus> {
  if (supabase) return invoke({ action: "status" });
  const k = await kvGet<string>(LOCAL);
  return { configured: !!k, last4: k ? k.slice(-4) : null, source: k ? "dispositivo" : null };
}

export async function saveKey(key: string): Promise<KeyStatus> {
  const k = key.trim();
  if (!/^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(k)) throw new Error("Eso no parece una API key de Claude (empieza con sk-ant-).");
  if (supabase) return invoke({ action: "set", key: k });
  await kvSet(LOCAL, k);
  return { configured: true, last4: k.slice(-4), source: "dispositivo" };
}

export async function deleteKey(): Promise<KeyStatus> {
  if (supabase) return invoke({ action: "delete" });
  await kvSet(LOCAL, "");
  return { configured: false, last4: null, source: null };
}

/** Solo modo local: la key guardada en este dispositivo (o null) */
export async function getLocalKey(): Promise<string | null> {
  if (supabase) return null;
  return (await kvGet<string>(LOCAL)) || null;
}

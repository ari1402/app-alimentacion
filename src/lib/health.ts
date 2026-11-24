// Puente con Apple Salud vía Atajos de iPhone.
// - Modo nube: el Atajo hace POST a la Edge Function health-ingest con un token personal.
//   Acá generamos el token, guardamos SOLO su hash y se lo mostramos una vez.
// - Modo local: el Atajo copia los datos y la app los pega (Ajustes → Pegar datos de Salud).
import { parseHealthPayload, type HealthUpdate } from "@core";
import { supabase } from "./supabase";
import { SUPABASE_URL } from "./env";

export const INGEST_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/health-ingest` : "";

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createIngestToken(): Promise<string> {
  if (!supabase) throw new Error("Solo en modo nube.");
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase.from("ingest_tokens").upsert({ user_id: u.user!.id, token_hash: await sha256(token), created_at: new Date().toISOString(), last_used_at: null });
  if (error) throw new Error(error.message);
  return token;
}

export async function ingestStatus(): Promise<{ configured: boolean; last_used_at: string | null }> {
  if (!supabase) return { configured: false, last_used_at: null };
  const { data } = await supabase.from("ingest_tokens").select("last_used_at").maybeSingle();
  return { configured: !!data, last_used_at: data?.last_used_at ?? null };
}

/** Lee lo que copió el Atajo y devuelve las actualizaciones a guardar */
export async function readClipboardHealth(today: string): Promise<HealthUpdate[]> {
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    throw new Error("No pude leer el portapapeles. Permití el acceso o pegá el texto a mano.");
  }
  return parseHealthText(text, today);
}

export function parseHealthText(text: string, today: string): HealthUpdate[] {
  let obj: unknown = null;
  try {
    obj = JSON.parse(text);
  } catch {
    // También acepta "sueno: 7,2\npasos_ayer: 8432\npeso: 82,1"
    const o: Record<string, string> = {};
    for (const line of text.split(/\n+/)) {
      const m = /^\s*([a-zA-Zñ_]+)\s*[:=]\s*(.+)$/.exec(line);
      if (m) o[m[1].toLowerCase()] = m[2];
    }
    obj = o;
  }
  return parseHealthPayload(obj, today);
}

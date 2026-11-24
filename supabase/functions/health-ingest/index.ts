// POST /functions/v1/health-ingest
// Lo llama un Atajo de iPhone con datos de Apple Salud (sueño, pasos, peso, FC en reposo).
// Auth: "Authorization: Bearer <token personal>" (generado en Ajustes; acá solo se compara el hash).
import { localDate, mergeConfig, parseHealthPayload } from "../_shared/core/index.ts";
import { handler, json, serviceClient } from "../_shared/server/http.ts";

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(handler(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[a-f0-9]{48,128}$/.test(token)) return json({ ok: false, error: "Token inválido. Generalo en Ajustes → Apple Salud." }, 401);
  const svc = serviceClient();
  const { data: row } = await svc.from("ingest_tokens").select("user_id").eq("token_hash", await sha256(token)).maybeSingle();
  if (!row) return json({ ok: false, error: "Token no reconocido (¿lo regeneraste?)." }, 401);

  const body = await req.json().catch(() => null);
  const { data: cfgRow } = await svc.from("user_config").select("config").eq("user_id", row.user_id).maybeSingle();
  const cfg = mergeConfig(cfgRow?.config ?? null, localDate());
  const today = localDate(new Date(), cfg.timezone);
  const updates = parseHealthPayload(body, today);
  if (!updates.length) return json({ ok: false, error: "No llegaron datos reconocibles (sueno, pasos, pasos_ayer, peso, fc_reposo)." }, 400);

  for (const u of updates) {
    const { error } = await svc.from("body_metrics").upsert({ user_id: row.user_id, local_date: u.date, ...u.fields }, { onConflict: "user_id,local_date" });
    if (error) throw new Error(error.message);
  }
  await svc.from("ingest_tokens").update({ last_used_at: new Date().toISOString(), last_payload: body }).eq("user_id", row.user_id);
  const resumen = updates.map((u) => `${u.date}: ${Object.entries(u.fields).map(([k, v]) => `${k}=${v}`).join(", ")}`).join(" | ");
  return json({ ok: true, guardado: resumen });
}));

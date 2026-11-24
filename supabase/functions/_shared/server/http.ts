// Utilidades de las Edge Functions (Deno). Acá viven los secretos: se leen de
// Deno.env (cargados con `supabase secrets set`) y nunca se devuelven al cliente.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { localDate, mergeConfig, type UserConfig } from "../core/index.ts";
import { AIError, type AIUsage } from "../ai/models.ts";

export const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

export function env(name: string, required = true): string {
  const v = Deno.env.get(name);
  if (!v && required) throw new Error(`Falta el secreto ${name} (supabase secrets set ${name}=...)`);
  return v ?? "";
}

export function serviceClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

export interface AuthedUser {
  id: string;
  email: string | null;
  /** Cliente con el JWT de la usuaria: respeta RLS */
  db: SupabaseClient;
}

/** Valida el JWT y que el email esté autorizado (app de una sola usuaria). */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw new HttpError(401, "No autenticada");
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await db.auth.getUser(auth.slice(7));
  if (error || !data.user) throw new HttpError(401, "Sesión inválida");
  return { id: data.user.id, email: data.user.email?.toLowerCase() ?? null, db };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Key de la usuaria guardada desde la app (Vault, cifrada). Solo la lee el service role. */
export async function userApiKey(userId: string): Promise<string | null> {
  const { data, error } = await serviceClient().rpc("get_anthropic_key", { p_user: userId });
  if (error) {
    console.error("vault", error.message);
    return null;
  }
  return typeof data === "string" && data ? data : null;
}

/**
 * Cliente de Claude para esta usuaria:
 * 1) su propia key cargada desde Ajustes (Vault), o
 * 2) la key global del proyecto (`supabase secrets`), solo para emails en ALLOWED_EMAILS
 *    (falla cerrado: si la lista está vacía, nadie usa la key global).
 */
export async function anthropicFor(user: AuthedUser): Promise<Anthropic> {
  const own = await userApiKey(user.id);
  if (own) return new Anthropic({ apiKey: own });
  const global = Deno.env.get("ANTHROPIC_API_KEY");
  if (global) {
    const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && user.email && allowed.includes(user.email)) return new Anthropic({ apiKey: global });
  }
  throw new AIError("Falta la API key de Claude: cargala en Ajustes → IA.", "unavailable");
}

export async function loadConfig(db: SupabaseClient, userId: string): Promise<UserConfig> {
  const { data } = await db.from("user_config").select("config").eq("user_id", userId).maybeSingle();
  return mergeConfig(data?.config ?? null, localDate());
}

/** Límite diario de llamadas a la IA (presupuesto). */
export async function checkBudget(cfg: UserConfig, userId: string): Promise<void> {
  const svc = serviceClient();
  const today = localDate(new Date(), cfg.timezone);
  const { count } = await svc.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("local_date", today);
  if ((count ?? 0) >= cfg.ai_daily_limit) {
    throw new AIError(`Llegaste al límite de ${cfg.ai_daily_limit} consultas de IA por hoy (configurable en Ajustes). La carga por lista sigue funcionando.`, "budget");
  }
}

export async function logUsage(userId: string, cfg: UserConfig, kind: string, u: AIUsage): Promise<void> {
  await serviceClient().from("ai_usage").insert({
    user_id: userId,
    local_date: localDate(new Date(), cfg.timezone),
    kind,
    model: u.model,
    input_tokens: u.input_tokens,
    output_tokens: u.output_tokens,
    cache_read_tokens: u.cache_read_tokens,
  });
}

/** Envuelve un handler con CORS y manejo de errores uniforme */
export function handler(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      if (e instanceof AIError) return json({ error: e.message, code: e.code }, e.code === "budget" ? 429 : e.code === "invalid" ? 400 : e.code === "unavailable" ? 412 : 502);
      if (e instanceof Anthropic.AuthenticationError) return json({ error: "La API key de Claude no es válida o fue revocada. Cargá una nueva en Ajustes → IA.", code: "unavailable" }, 412);
      if (e instanceof Anthropic.RateLimitError) return json({ error: "La IA está saturada, probá en un minuto.", code: "api" }, 429);
      if (e instanceof Anthropic.APIError) {
        console.error("anthropic", e.status, e.message);
        return json({ error: "Error de la IA. Probá de nuevo o cargá por lista.", code: "api" }, 502);
      }
      console.error(e);
      return json({ error: "Error interno" }, 500);
    }
  };
}

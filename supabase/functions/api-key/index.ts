// POST /functions/v1/api-key
//   { action: "status" }          → { configured, last4, source }
//   { action: "set", key: "..." } → valida la key contra la API y la guarda cifrada en Vault
//   { action: "delete" }          → la borra
// La key NUNCA se devuelve al cliente ni se escribe en logs.
import Anthropic from "@anthropic-ai/sdk";
import { handler, HttpError, json, requireUser, serviceClient, userApiKey } from "../_shared/server/http.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const svc = serviceClient();

  if (body.action === "status") {
    const own = await userApiKey(user.id);
    const allowed = (Deno.env.get("ALLOWED_EMAILS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const global = !!Deno.env.get("ANTHROPIC_API_KEY") && !!user.email && allowed.includes(user.email);
    return json({ configured: !!own || global, last4: own ? own.slice(-4) : null, source: own ? "app" : global ? "servidor" : null });
  }

  if (body.action === "delete") {
    const { error } = await svc.rpc("delete_anthropic_key", { p_user: user.id });
    if (error) throw new Error(error.message);
    return json({ configured: false });
  }

  if (body.action === "set") {
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!/^sk-ant-[A-Za-z0-9_-]{20,200}$/.test(key)) throw new HttpError(400, "Eso no parece una API key de Claude (empieza con sk-ant-).");
    // Validación barata antes de guardar: listar modelos no consume tokens.
    try {
      await new Anthropic({ apiKey: key, maxRetries: 1 }).models.list({ limit: 1 });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        throw new HttpError(400, "Anthropic rechazó la key: revisá que esté completa y activa.");
      }
      throw new HttpError(502, "No pude validar la key con Anthropic. Probá de nuevo en un rato.");
    }
    const { error } = await svc.rpc("set_anthropic_key", { p_user: user.id, p_key: key });
    if (error) throw new Error("No pude guardar la key en Vault: " + error.message);
    return json({ configured: true, last4: key.slice(-4), source: "app" });
  }

  return json({ error: "acción inválida" }, 400);
}));

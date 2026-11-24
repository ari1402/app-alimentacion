// POST /functions/v1/coach  { mode: "chat"|"analisis_dia"|"analisis_semana", messages: [...] }
// Coach conversacional con herramientas deterministas (negociación, escenarios, sugerencias).
import { anthropic, checkBudget, handler, json, loadConfig, logUsage, requireUser } from "../_shared/server/http.ts";
import { loadCoachData, loadFoods } from "../_shared/server/data.ts";
import { runCoach } from "../_shared/ai/coach.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const cfg = await loadConfig(user.db, user.id);
  await checkBudget(cfg, user.id);
  const [data, foods] = await Promise.all([loadCoachData(user.db, user.id, cfg.timezone), loadFoods(user.db, user.id)]);
  const messages = Array.isArray(body.messages)
    ? body.messages
      .filter((m: { role?: string; content?: unknown }) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content.slice(0, 4000) }))
    : [];
  const mode = ["chat", "analisis_dia", "analisis_semana"].includes(body.mode) ? body.mode : "chat";
  const out = await runCoach(anthropic(), { mode, messages, cfg, data, foods, model: Deno.env.get("MODEL_COACH") || undefined });
  await logUsage(user.id, cfg, `coach_${mode}`, out.usage);
  return json(out);
}));

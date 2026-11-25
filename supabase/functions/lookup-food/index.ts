// POST /functions/v1/lookup-food  { query: "barrita proteica Integra" }
// Busca los macros reales de un producto de marca (Open Food Facts + búsqueda web).
import { anthropicFor, checkBudget, handler, json, loadConfig, logUsage, requireUser } from "../_shared/server/http.ts";
import { lookupFood } from "../_shared/ai/productSearch.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const cfg = await loadConfig(user.db, user.id);
  await checkBudget(cfg, user.id);
  const out = await lookupFood(await anthropicFor(user), { query: String(body.query ?? ""), model: Deno.env.get("MODEL_COACH") || undefined });
  await logUsage(user.id, cfg, "lookup_food", out.usage);
  if (out.food) await user.db.from("foods").upsert({ ...out.food, user_id: user.id });
  return json(out);
}));

// POST /functions/v1/parse-meal  { text?, image?, slot? }
// Interpreta una comida en lenguaje natural (o foto) contra la tabla de alimentos.
import { anthropicFor, checkBudget, handler, json, loadConfig, logUsage, requireUser } from "../_shared/server/http.ts";
import { loadFoods, loadPortions } from "../_shared/server/data.ts";
import { parseMeal } from "../_shared/ai/parseMeal.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const cfg = await loadConfig(user.db, user.id);
  await checkBudget(cfg, user.id);
  const [foods, portions] = await Promise.all([loadFoods(user.db, user.id), loadPortions(user.db, user.id)]);
  if (body.image && typeof body.image.data === "string" && body.image.data.length > 7_000_000) {
    return json({ error: "La foto es muy pesada" }, 413);
  }
  const out = await parseMeal(await anthropicFor(user), {
    text: typeof body.text === "string" ? body.text.slice(0, 1000) : null,
    image: body.image ?? null,
    slot: body.slot ?? null,
    foods,
    portions,
    model: Deno.env.get("MODEL_PARSE") || undefined,
  });
  await logUsage(user.id, cfg, body.image ? "parse_photo" : "parse", out.usage);
  return json(out);
}));

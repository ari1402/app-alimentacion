// POST /functions/v1/recipe  { slot, target, servings, max_minutes, have?, wish?, low_carb?, portable?, reintroduce?, avoid? }
// Genera una receta con IA ajustada a los macros pedidos.
import { anthropicFor, checkBudget, handler, json, loadConfig, logUsage, requireUser } from "../_shared/server/http.ts";
import { loadFoods } from "../_shared/server/data.ts";
import { generateRecipe } from "../_shared/ai/recipe.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const cfg = await loadConfig(user.db, user.id);
  await checkBudget(cfg, user.id);
  const foods = await loadFoods(user.db, user.id);
  const n = (v: unknown, d: number) => (typeof v === "number" && isFinite(v) ? v : d);
  const out = await generateRecipe(await anthropicFor(user), {
    slot: ["desayuno", "almuerzo", "merienda", "cena"].includes(body.slot) ? body.slot : "almuerzo",
    target: { kcal: n(body.target?.kcal, 500), p: n(body.target?.p, 40), c: n(body.target?.c, 45), f: n(body.target?.f, 15) },
    servings: n(body.servings, 1),
    max_minutes: n(body.max_minutes, 30),
    have: typeof body.have === "string" ? body.have.slice(0, 500) : null,
    wish: typeof body.wish === "string" ? body.wish.slice(0, 300) : null,
    low_carb: !!body.low_carb,
    portable: !!body.portable,
    reintroduce: typeof body.reintroduce === "string" ? body.reintroduce.slice(0, 60) : null,
    avoid: Array.isArray(body.avoid) ? body.avoid.filter((x: unknown) => typeof x === "string").slice(0, 30) : [],
    foods,
    model: Deno.env.get("MODEL_COACH") || undefined,
  });
  await logUsage(user.id, cfg, "recipe", out.usage);
  return json(out);
}));

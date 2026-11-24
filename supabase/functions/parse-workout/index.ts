// POST /functions/v1/parse-workout  { text?, image? }
// Interpreta un entrenamiento contado en lenguaje natural (o foto) usando el historial de la usuaria.
import { anthropicFor, checkBudget, handler, json, loadConfig, logUsage, requireUser } from "../_shared/server/http.ts";
import { lastSetsByExercise, SEED_EXERCISES, type Workout } from "../_shared/core/index.ts";
import { parseWorkout } from "../_shared/ai/parseWorkout.ts";

Deno.serve(handler(async (req) => {
  const user = await requireUser(req);
  const body = await req.json().catch(() => ({}));
  const cfg = await loadConfig(user.db, user.id);
  await checkBudget(cfg, user.id);
  const { data } = await user.db.from("workouts").select("*").eq("user_id", user.id).order("local_date").limit(400);
  const last = lastSetsByExercise((data ?? []) as Workout[]);
  const known = [...new Set([...SEED_EXERCISES.map((e) => e.name), ...[...last.values()].map((e) => e.name)])];
  if (body.image && typeof body.image.data === "string" && body.image.data.length > 7_000_000) return json({ error: "La foto es muy pesada" }, 413);
  const out = await parseWorkout(await anthropicFor(user), {
    text: typeof body.text === "string" ? body.text.slice(0, 1500) : null,
    image: body.image ?? null,
    known,
    last: [...last.values()].map((e) => `${e.name}: ${e.sets.map((s) => `${s.reps}×${s.kg}`).join(", ")}`),
    model: Deno.env.get("MODEL_PARSE") || undefined,
  });
  await logUsage(user.id, cfg, "parse_workout", out.usage);
  return json(out);
}));

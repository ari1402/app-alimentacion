// Generador de recetas: crea una receta que entra en tus macros, con lo que tenés
// en casa y el tiempo disponible. Los números finales salen de tu tabla de alimentos.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Food, Macros, MealItem, Recipe, RecipeTag, Slot } from "../core/types.ts";
import { itemFromFood, kcalFromMacros, roundMacros } from "../core/macros.ts";
import { autoTags, perServing, withTotals } from "../core/recipes.ts";
import { AIError, type AIUsage, DEFAULT_MODEL_COACH } from "./models.ts";

export interface RecipeRequest {
  slot: Exclude<Slot, "snack">;
  /** Macros objetivo POR PORCIÓN */
  target: Macros;
  servings: number;
  max_minutes: number;
  /** Lo que tiene en casa (texto libre) */
  have?: string | null;
  /** Pedido libre: "algo dulce", "sin horno", "estilo mexicano"... */
  wish?: string | null;
  low_carb?: boolean;
  portable?: boolean;
  /** Alimento que está reintroduciendo (ej. "merluza") */
  reintroduce?: string | null;
  /** Nombres de recetas que ya tiene, para no repetir */
  avoid?: string[];
  foods: Food[];
  model?: string;
}

export interface RecipeResult {
  recipe: Recipe;
  perServing: Macros;
  deviation: { kcal: number; p: number };
  usage: AIUsage;
}

const Schema = z.object({
  name: z.string(),
  prep_min: z.number(),
  ingredients: z.array(z.object({
    food_id: z.string().nullable().describe("id de la tabla si existe; null si no"),
    name: z.string(),
    grams: z.number().describe("gramos TOTALES de la receta completa, en el estado que indica la tabla (cocido/crudo)"),
    kcal: z.number(), p: z.number(), c: z.number(), f: z.number(),
  })),
  steps: z.array(z.string()),
  tips: z.string().nullable(),
  tags: z.array(z.enum(["alta proteína", "baja en carbos", "rápida", "meal prep", "portable", "sin horno", "dulce", "reintroducción"])),
});

const SYSTEM = `Sos cocinero/a y nutricionista deportivo/a en Argentina. Creás recetas caseras, ricas y realistas para una residente de anestesiología que entrena fuerza y está bajando de peso cuidando el músculo.

Reglas:
- Ingredientes que se consiguen en cualquier súper o verdulería de Argentina. Nada rebuscado.
- Usá la TABLA DE ALIMENTOS siempre que puedas (devolvé su food_id). Los gramos van en el mismo estado que la tabla (si dice "cocido", gramos cocidos). Si algo no está en la tabla, food_id null y macros estándar coherentes (kcal ≈ 4·P + 4·C + 9·G).
- Condimentos, especias, caldo, limón, vinagre, edulcorante: mencionalos en los pasos, no como ingredientes (aportan casi nada).
- Apuntá a los macros POR PORCIÓN pedidos (±10% kcal, proteína igual o mayor). La proteína es la prioridad.
- Los gramos de ingredientes son de la receta COMPLETA (todas las porciones).
- Pasos cortos y concretos (máximo 7), con tiempos y temperaturas. Respetá el tiempo máximo.
- Si es meal prep (3+ porciones), indicá en tips cómo guardar y cuántos días dura.
- Si hay un alimento en reintroducción, integralo "disimulado" (procesado, en salsa, con sabores que gusten) y en poca cantidad.
- Nada de lenguaje moralizante ("culpa", "permitido", "sano vs. malo").`;

function table(foods: Food[]): string {
  return foods.map((f) => `${f.id} | ${f.name} | ${f.portion_label} = ${f.portion_g} g | ${f.kcal} kcal, P ${f.p}, C ${f.c}, G ${f.f}`).join("\n");
}

export async function generateRecipe(client: Anthropic, req: RecipeRequest): Promise<RecipeResult> {
  const servings = Math.min(8, Math.max(1, Math.round(req.servings || 1)));
  const t = req.target;
  const ask = [
    `Momento: ${req.slot}. Porciones: ${servings}. Tiempo máximo: ${req.max_minutes} min.`,
    `Macros por porción: ~${Math.round(t.kcal)} kcal, ≥${Math.round(t.p)} g proteína, ~${Math.round(t.c)} g carbos, ~${Math.round(t.f)} g grasas.`,
    req.low_carb ? "Que sea baja en carbos (≤ 30 g por porción)." : "",
    req.portable ? "Que se pueda llevar al hospital y comer fría o recalentada en microondas." : "",
    req.reintroduce ? `Incluí ${req.reintroduce} de forma disimulada (está reintroduciéndolo).` : "",
    req.have?.trim() ? `Tengo en casa: ${req.have.trim()}. Priorizá esto.` : "",
    req.wish?.trim() ? `Pedido: ${req.wish.trim()}` : "",
    req.avoid?.length ? `Ya tengo estas recetas, proponé algo distinto: ${req.avoid.slice(0, 30).join("; ")}.` : "",
  ].filter(Boolean).join("\n");

  const model = req.model ?? DEFAULT_MODEL_COACH;
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(Schema) },
    system: [
      { type: "text", text: SYSTEM },
      { type: "text", text: `TABLA DE ALIMENTOS (id | nombre | porción | macros por porción):\n${table(req.foods)}`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: ask }],
  });
  if (response.stop_reason === "refusal") throw new AIError("No pude generar esa receta. Probá con otro pedido.", "refusal");
  const out = response.parsed_output;
  if (!out || !out.ingredients.length) throw new AIError("La receta no salió bien. Probá de nuevo.", "invalid");

  const byId = new Map(req.foods.map((f) => [f.id, f]));
  const ingredients: MealItem[] = out.ingredients.filter((i) => i.grams > 0).map((i) => {
    const f = i.food_id ? byId.get(i.food_id) : undefined;
    if (f) return itemFromFood(f, i.grams);
    const m = roundMacros({ kcal: i.kcal, p: Math.max(0, i.p), c: Math.max(0, i.c), f: Math.max(0, i.f) });
    const k = kcalFromMacros(m);
    if (k > 0 && Math.abs(m.kcal - k) / k > 0.25) m.kcal = Math.round(k);
    return { food_id: null, name: i.name, grams: Math.round(i.grams), estimated: true, ...m };
  });

  const base = withTotals({
    id: `ia-${Date.now().toString(36)}`,
    name: out.name,
    slots: [req.slot],
    servings,
    prep_min: Math.round(out.prep_min) || req.max_minutes,
    ingredients,
    steps: out.steps.slice(0, 10),
    tips: out.tips,
    tags: out.tags as RecipeTag[],
    source: "ia",
    created_at: new Date().toISOString(),
  });
  const recipe = { ...base, tags: autoTags(base) };
  const ps = perServing(recipe);
  return {
    recipe,
    perServing: ps,
    deviation: { kcal: Math.round(ps.kcal - t.kcal), p: Math.round(ps.p - t.p) },
    usage: {
      model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

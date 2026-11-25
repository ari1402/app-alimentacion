// Registro por lenguaje natural (o foto): texto → ítems con gramos y macros.
// La IA interpreta; los números finales salen de la tabla de alimentos cuando hay match.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Food, LearnedPortion, MealItem, Slot } from "../core/types.ts";
import { itemFromFood, kcalFromMacros, roundMacros } from "../core/macros.ts";
import { portionsForPrompt } from "../core/portions.ts";
import { AIError, type AIUsage, DEFAULT_MODEL_PARSE } from "./models.ts";

export interface ParseMealInput {
  text?: string | null;
  image?: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string } | null;
  slot?: Slot | null;
  foods: Food[];
  portions: LearnedPortion[];
  model?: string;
}

export interface ParseMealOutput {
  items: MealItem[];
  slot: Slot | null;
  clarification: string | null;
  usage: AIUsage;
}

const ItemSchema = z.object({
  phrase: z.string().describe("Fragmento exacto del texto de la usuaria que describe este ítem, ej 'medio panqueque proteico'"),
  food_id: z.string().nullable().describe("id de la tabla si hay match; null si no está"),
  name: z.string(),
  grams: z.number().describe("gramos (o ml) estimados de lo que comió"),
  kcal: z.number(),
  p: z.number(),
  c: z.number(),
  f: z.number(),
  estimated: z.boolean().describe("true si NO está en la tabla y estimaste los macros"),
});

const OutputSchema = z.object({
  items: z.array(ItemSchema),
  slot: z.enum(["desayuno", "almuerzo", "merienda", "cena", "snack"]).nullable(),
  clarification: z.string().nullable().describe("Pregunta corta si algo es realmente ambiguo; si no, null"),
});

const RULES = `Sos el módulo de registro de comidas de una app de nutrición personal (Argentina, español rioplatense).
Tu tarea: convertir lo que la usuaria comió en ítems con gramos y macros.

Reglas:
- Usá SIEMPRE la tabla de alimentos cuando haya un match razonable (por nombre o alias) y devolvé su food_id. Los macros de la tabla son por la porción indicada; escalá a los gramos.
- Respetá las porciones aprendidas de la usuaria: si dice una frase que coincide, usá esos gramos.
- Cantidades: "medio" = 0.5 porción, "un/una" = 1 porción de la tabla salvo porción aprendida, "un plato" de pasta/arroz cocido ≈ 200 g, "una taza" de leche ≈ 200 ml, "un puñado" ≈ 15 g. Si no dice cantidad, asumí la porción de referencia.
- Preparaciones compuestas (ej. "café con leche proteica") pueden existir como un ítem de la tabla; si no, descomponé en ingredientes.
- Si algo no está en la tabla, estimá con valores estándar (food_id null, estimated true). Las kcal tienen que ser coherentes con 4·P + 4·C + 9·G.
- Si menciona una MARCA (ej. "barrita Integra", "yogur Ser"), incluí la marca en name ("Barrita proteica Integra") aunque estimes: la app después busca los macros reales de la etiqueta. Productos de marca de la tabla (food_id que empieza con "m-") tienen prioridad.
- No juzgues lo que comió ni agregues comentarios. Solo datos.
- slot: inferilo del texto si lo menciona ("en el almuerzo"); si no, null.
- clarification: solo si es imposible estimar algo importante; en general, estimá y dejá que ella corrija.`;

function foodsTable(foods: Food[]): string {
  return foods
    .map((f) => `${f.id} | ${f.name}${f.aliases?.length ? ` (${f.aliases.join(", ")})` : ""} | ${f.portion_label} = ${f.portion_g} g | ${f.kcal} kcal, P ${f.p}, C ${f.c}, G ${f.f}`)
    .join("\n");
}

export async function parseMeal(client: Anthropic, input: ParseMealInput): Promise<ParseMealOutput> {
  if (!input.text?.trim() && !input.image) throw new AIError("Escribí qué comiste o subí una foto.", "invalid");
  const model = input.model ?? DEFAULT_MODEL_PARSE;
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: input.image.media_type, data: input.image.data } });
    content.push({ type: "text", text: "Foto de lo que comí. Identificá cada alimento y estimá los gramos por tamaño visual (plato estándar ≈ 26 cm)." });
  }
  if (input.text?.trim()) content.push({ type: "text", text: `Comí: ${input.text.trim()}${input.slot ? `\n(momento: ${input.slot})` : ""}` });

  const portions = portionsForPrompt(input.portions);
  const response = await client.messages.parse({
    model,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(OutputSchema) },
    system: [
      { type: "text", text: RULES },
      { type: "text", text: `TABLA DE ALIMENTOS (id | nombre (alias) | porción | macros por porción):\n${foodsTable(input.foods)}`, cache_control: { type: "ephemeral" } },
      { type: "text", text: portions ? `PORCIONES APRENDIDAS DE LA USUARIA:\n${portions}` : "Sin porciones aprendidas todavía." },
    ],
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") throw new AIError("No pude interpretar eso. Probá cargarlo desde la lista.", "refusal");
  const out = response.parsed_output;
  if (!out) throw new AIError("La respuesta de la IA no fue válida. Probá de nuevo o usá la lista.", "invalid");

  const byId = new Map(input.foods.map((f) => [f.id, f]));
  const items: MealItem[] = out.items
    .filter((i) => i.grams > 0)
    .map((i) => {
      const food = i.food_id ? byId.get(i.food_id) : undefined;
      if (food) return itemFromFood(food, i.grams, i.phrase); // números de la tabla, no del modelo
      const m = roundMacros({ kcal: i.kcal, p: Math.max(0, i.p), c: Math.max(0, i.c), f: Math.max(0, i.f) });
      const k = kcalFromMacros(m);
      if (k > 0 && Math.abs(m.kcal - k) / k > 0.25) m.kcal = Math.round(k);
      return { food_id: null, name: i.name, grams: Math.round(i.grams), phrase: i.phrase, estimated: true, ...m };
    });

  return {
    items,
    slot: out.slot,
    clarification: out.clarification,
    usage: {
      model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

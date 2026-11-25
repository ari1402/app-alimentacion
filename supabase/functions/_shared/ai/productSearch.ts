// Búsqueda de productos de marca con macros REALES:
// 1) Open Food Facts (base pública, productos escaneados; buena cobertura en Argentina)
// 2) Búsqueda web de Claude (sitio de la marca, supermercados) si OFF no lo tiene.
// El resultado se guarda en la tabla de alimentos para no volver a buscarlo.
import Anthropic from "@anthropic-ai/sdk";
import type { Food } from "../core/types.ts";
import { kcalFromMacros, round1 } from "../core/macros.ts";
import { AIError, type AIUsage, DEFAULT_MODEL_COACH } from "./models.ts";

export interface OffProduct {
  nombre: string;
  marca: string | null;
  codigo: string | null;
  porcion: string | null;
  porcion_g: number | null;
  por_100g: { kcal: number | null; p: number | null; c: number | null; f: number | null };
  argentina: boolean;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : typeof v === "string" && v.trim() && !isNaN(Number(v)) ? Number(v) : null);

/** Busca en Open Food Facts. Prioriza productos vendidos en Argentina. */
export async function searchOpenFoodFacts(query: string, fetchImpl: typeof fetch = fetch): Promise<OffProduct[]> {
  const q = query.trim().slice(0, 120);
  if (!q) return [];
  const url = "https://world.openfoodfacts.org/cgi/search.pl?" + new URLSearchParams({
    search_terms: q, search_simple: "1", action: "process", json: "1", page_size: "12",
    fields: "product_name,product_name_es,brands,code,serving_size,serving_quantity,countries_tags,nutriments",
  });
  const isBrowser = typeof window !== "undefined";
  const res = await fetchImpl(url, isBrowser ? {} : { headers: { "User-Agent": "CoachNutricion/1.0 (app personal)" } });
  if (!res.ok) throw new Error(`Open Food Facts respondió ${res.status}`);
  const json = await res.json() as { products?: Record<string, any>[] };
  return (json.products ?? [])
    .map((p) => {
      const n = p.nutriments ?? {};
      const kcal = num(n["energy-kcal_100g"]) ?? (num(n["energy_100g"]) != null ? Math.round((num(n["energy_100g"]) as number) / 4.184) : null);
      return {
        nombre: String(p.product_name_es || p.product_name || "").trim(),
        marca: p.brands ? String(p.brands).split(",")[0].trim() : null,
        codigo: p.code ? String(p.code) : null,
        porcion: p.serving_size ? String(p.serving_size) : null,
        porcion_g: num(p.serving_quantity),
        por_100g: { kcal, p: num(n.proteins_100g), c: num(n.carbohydrates_100g), f: num(n.fat_100g) },
        argentina: Array.isArray(p.countries_tags) && p.countries_tags.includes("en:argentina"),
      };
    })
    .filter((p) => p.nombre && p.por_100g.kcal != null && p.por_100g.p != null)
    .sort((a, b) => Number(b.argentina) - Number(a.argentina))
    .slice(0, 6);
}

export const WEB_SEARCH_TOOL: Anthropic.Beta.BetaWebSearchTool20260209 = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 3,
  user_location: { type: "approximate", country: "AR", city: "Buenos Aires", timezone: "America/Argentina/Buenos_Aires" },
};

export const PRODUCT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "buscar_producto",
    description: "Busca un producto envasado o de marca en Open Food Facts (macros reales de la etiqueta, por 100 g y por porción). Usala primero para cualquier producto de marca (barritas, yogures, leches, galletitas, suplementos…). Consultá con marca + producto, ej. 'integra barrita proteica'.",
    input_schema: {
      type: "object",
      properties: { consulta: { type: "string" } },
      required: ["consulta"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "guardar_alimento",
    description: "Guarda un producto con sus macros REALES en la tabla de alimentos de Ari, para usarlo al registrar. Usala cuando encontraste la tabla nutricional (Open Food Facts o web). Los macros van por la porción indicada.",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string", description: "Nombre del producto, ej. 'Barrita proteica sabor chocolate'" },
        marca: { type: "string" },
        porcion_texto: { type: "string", description: "ej. '1 barrita (46 g)'" },
        porcion_g: { type: "number" },
        kcal: { type: "number" },
        p: { type: "number" },
        c: { type: "number" },
        f: { type: "number" },
        fuente: { type: "string", description: "Open Food Facts (código) o la URL/sitio de donde sacaste la tabla" },
      },
      required: ["nombre", "marca", "porcion_texto", "porcion_g", "kcal", "p", "c", "f", "fuente"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export const PRODUCT_RULES = `PRODUCTOS DE MARCA
- Si Ari nombra un producto de marca (ej. "barrita proteica Integra", "yogur Ser proteína", "leche La Serenísima Protein"), NO estimes: buscá los macros reales.
- Primero buscar_producto (Open Food Facts). Si no aparece, o faltan macros, usá web_search: sitio oficial de la marca o supermercados argentinos (Carrefour, Coto, Jumbo, Disco, Día, farmacias) y leé la tabla nutricional.
- Verificá que sea el producto correcto (marca, sabor, tamaño). Si hay variantes y no sabés cuál, elegí la más común y decilo en una línea.
- Cuando tengas la tabla, llamá guardar_alimento con los macros por porción de la etiqueta y la fuente. Después registrá con proponer_registro usando ese producto.
- Si después de buscar no encontrás datos confiables, decilo y usá una estimación marcada como tal.`;

function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/** Convierte el input de guardar_alimento en un Food válido (con chequeo de coherencia) */
export function foodFromTool(a: Record<string, unknown>): Food {
  const nombre = String(a.nombre ?? "").trim();
  const marca = String(a.marca ?? "").trim();
  const p = Math.max(0, Number(a.p) || 0), c = Math.max(0, Number(a.c) || 0), f = Math.max(0, Number(a.f) || 0);
  let kcal = Math.max(0, Number(a.kcal) || 0);
  const k = kcalFromMacros({ p, c, f });
  if (k > 0 && (kcal === 0 || Math.abs(kcal - k) / k > 0.35)) kcal = Math.round(k);
  const portion_g = Math.max(1, Number(a.porcion_g) || 100);
  const name = marca && !nombre.toLowerCase().includes(marca.toLowerCase()) ? `${nombre} ${marca}` : nombre;
  return {
    id: `m-${slug(`${marca} ${nombre}`)}`,
    name,
    brand: marca || null,
    aliases: [marca, nombre, `${nombre} ${marca}`].map((x) => x.toLowerCase()).filter(Boolean),
    portion_label: String(a.porcion_texto ?? `${portion_g} g`),
    portion_g,
    kcal: Math.round(kcal),
    p: round1(p), c: round1(c), f: round1(f),
    category: "marca",
    source: String(a.fuente ?? "").slice(0, 200) || null,
  };
}

export interface LookupResult {
  food: Food | null;
  message: string;
  usage: AIUsage;
}

/**
 * Buscador dedicado (Registrar → "Buscar macros reales"): un mini agente con
 * Open Food Facts + búsqueda web que termina llamando guardar_alimento.
 */
export async function lookupFood(
  client: Anthropic,
  input: { query: string; model?: string; fetchImpl?: typeof fetch },
): Promise<LookupResult> {
  const query = input.query.trim().slice(0, 200);
  if (!query) throw new AIError("¿Qué producto busco?", "invalid");
  const usage: AIUsage = { model: input.model ?? DEFAULT_MODEL_COACH, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
  let tools: Anthropic.Beta.BetaToolUnion[] = [...PRODUCT_TOOLS, WEB_SEARCH_TOOL];
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: `Buscá los macros reales de: ${query}. Cuando los tengas, llamá guardar_alimento. Respondé en una línea con lo que encontraste y la fuente.` }];
  let food: Food | null = null;
  let text = "";
  for (let i = 0; i < 6; i++) {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({
        model: usage.model, max_tokens: 4000, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "low" },
        system: `Sos el buscador de productos de una app de nutrición en Argentina. Respondé en español rioplatense, breve.\n\n${PRODUCT_RULES}`,
        tools, messages,
      });
    } catch (e) {
      // Si la organización no tiene habilitada la búsqueda web, seguimos solo con Open Food Facts
      if (e instanceof Anthropic.BadRequestError && tools.includes(WEB_SEARCH_TOOL) && /web_search|tool/i.test(e.message)) {
        tools = [...PRODUCT_TOOLS];
        i--;
        continue;
      }
      throw e;
    }
    usage.model = res.model;
    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    usage.cache_read_tokens += res.usage.cache_read_input_tokens ?? 0;
    if (res.stop_reason === "refusal") throw new AIError("No pude buscar ese producto.", "refusal");
    const t = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
    if (t) text = t;
    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason === "pause_turn") continue;
    if (res.stop_reason !== "tool_use") break;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      const args = (b.input ?? {}) as Record<string, unknown>;
      try {
        if (b.name === "buscar_producto") {
          const r = await searchOpenFoodFacts(String(args.consulta ?? ""), input.fetchImpl);
          results.push({ type: "tool_result", tool_use_id: b.id, content: r.length ? JSON.stringify(r) : "Sin resultados en Open Food Facts. Probá la búsqueda web." });
        } else if (b.name === "guardar_alimento") {
          food = foodFromTool(args);
          results.push({ type: "tool_result", tool_use_id: b.id, content: `Guardado como "${food.name}" (${food.portion_label}: ${food.kcal} kcal, P ${food.p}, C ${food.c}, G ${food.f}).` });
        } else {
          results.push({ type: "tool_result", tool_use_id: b.id, content: "Herramienta no disponible", is_error: true });
        }
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: b.id, content: `Error: ${(e as Error).message}. Probá la búsqueda web.`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { food, message: text || (food ? `Encontré ${food.name}.` : "No encontré datos confiables."), usage };
}

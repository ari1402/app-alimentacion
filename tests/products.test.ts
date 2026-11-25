import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { defaultConfig, SEED_FOODS, SEED_TEMPLATES } from "@core";
import { foodFromTool, lookupFood, searchOpenFoodFacts } from "../supabase/functions/_shared/ai/productSearch.ts";
import { runCoach } from "../supabase/functions/_shared/ai/coach.ts";

// Respuesta simulada de Open Food Facts
const OFF = {
  products: [
    { product_name: "Barra proteica chocolate", brands: "Otra marca", code: "1", serving_quantity: 40, serving_size: "40 g", countries_tags: ["en:spain"], nutriments: { "energy-kcal_100g": 380, proteins_100g: 30, carbohydrates_100g: 35, fat_100g: 12 } },
    { product_name: "Barrita proteica sabor chocolate", brands: "Integra", code: "779", serving_quantity: 46, serving_size: "1 barrita (46 g)", countries_tags: ["en:argentina"], nutriments: { energy_100g: 1590, proteins_100g: 32.6, carbohydrates_100g: 39.1, fat_100g: 10.9 } },
    { product_name: "Sin macros", brands: "X", nutriments: {} },
  ],
};
const offFetch = (async (url: RequestInfo | URL) => {
  expect(String(url)).toContain("openfoodfacts.org");
  return new Response(JSON.stringify(OFF), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

function anthropicMock(responses: unknown[], bodies: any[]) {
  let i = 0;
  const f = async (_u: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const r = responses[i++] as { status?: number; body: unknown };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", "request-id": "req" } });
  };
  return new Anthropic({ apiKey: "test-not-real", fetch: f as typeof globalThis.fetch, maxRetries: 0 });
}
const msg = (content: unknown[], stop_reason: string) => ({ body: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } } });

describe("Open Food Facts", () => {
  it("prioriza Argentina, pasa kJ a kcal y descarta productos sin macros", async () => {
    const r = await searchOpenFoodFacts("integra barrita proteica", offFetch);
    expect(r).toHaveLength(2);
    expect(r[0].marca).toBe("Integra");
    expect(r[0].argentina).toBe(true);
    expect(r[0].por_100g.kcal).toBe(380); // 1590 kJ / 4.184
    expect(r[0].porcion_g).toBe(46);
  });
  it("guardar_alimento → Food coherente", () => {
    const f = foodFromTool({ nombre: "Barrita proteica chocolate", marca: "Integra", porcion_texto: "1 barrita (46 g)", porcion_g: 46, kcal: 999, p: 15, c: 18, f: 5, fuente: "Open Food Facts 779" });
    expect(f.id).toBe("m-integra-barrita-proteica-chocolate");
    expect(f.name).toBe("Barrita proteica chocolate Integra");
    expect(f.kcal).toBe(177); // 999 incoherente → 4·15 + 4·18 + 9·5
    expect(f.brand).toBe("Integra");
    expect(f.aliases).toContain("integra");
  });
});

describe("coach con productos de marca", () => {
  it("busca en OFF, guarda el producto y propone el registro con macros reales", async () => {
    const bodies: any[] = [];
    const client = anthropicMock([
      msg([{ type: "tool_use", id: "t1", name: "buscar_producto", input: { consulta: "integra barrita proteica" } }], "tool_use"),
      msg([
        { type: "tool_use", id: "t2", name: "guardar_alimento", input: { nombre: "Barrita proteica sabor chocolate", marca: "Integra", porcion_texto: "1 barrita (46 g)", porcion_g: 46, kcal: 175, p: 15, c: 18, f: 5, fuente: "Open Food Facts 779" } },
      ], "tool_use"),
      msg([
        { type: "tool_use", id: "t3", name: "proponer_registro", input: { momento: "merienda", items: [{ food_id: "m-integra-barrita-proteica-sabor-chocolate", nombre: "una barrita Integra", gramos: 46, kcal: 0, p: 0, c: 0, f: 0 }] } },
      ], "tool_use"),
      msg([{ type: "text", text: "Listo: 175 kcal y 15 g de proteína (etiqueta de Open Food Facts)." }], "end_turn"),
    ], bodies);
    const r = await runCoach(client, {
      mode: "chat",
      messages: [{ role: "user", content: "me comí una barrita proteica integra de chocolate en la merienda" }],
      cfg: defaultConfig("2026-11-01"),
      data: { meals: [], workouts: [], metrics: [], templates: SEED_TEMPLATES, events: [] },
      foods: SEED_FOODS,
      fetchImpl: offFetch,
    });
    expect(r.toolsUsed).toEqual(["buscar_producto", "guardar_alimento", "proponer_registro"]);
    expect(r.newFoods[0].name).toContain("Integra");
    expect(r.proposals[0].totals).toMatchObject({ kcal: 175, p: 15 });
    expect(bodies[0].tools.some((t: any) => t.type === "web_search_20260209")).toBe(true);
    expect(bodies[0].system).toContain("PRODUCTOS DE MARCA");
    // el resultado de OFF llega al modelo con la barrita argentina primero
    const offResult = bodies[1].messages.at(-1).content[0].content;
    expect(JSON.parse(offResult)[0].marca).toBe("Integra");
  });

  it("si la organización no tiene búsqueda web, sigue con Open Food Facts", async () => {
    const bodies: any[] = [];
    const client = anthropicMock([
      { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "web_search tool is not enabled for this organization" } } },
      msg([{ type: "text", text: "Ok" }], "end_turn"),
    ], bodies);
    const r = await runCoach(client, {
      mode: "chat", messages: [{ role: "user", content: "hola" }], cfg: defaultConfig("2026-11-01"),
      data: { meals: [], workouts: [], metrics: [], templates: SEED_TEMPLATES, events: [] }, foods: SEED_FOODS,
    });
    expect(r.text).toBe("Ok");
    expect(bodies[1].tools.some((t: any) => t.type === "web_search_20260209")).toBe(false);
    expect(bodies[1].tools.some((t: any) => t.name === "buscar_producto")).toBe(true);
  });
});

describe("buscador dedicado (Registrar)", () => {
  it("termina con el producto guardado", async () => {
    const bodies: any[] = [];
    const client = anthropicMock([
      msg([{ type: "tool_use", id: "t1", name: "buscar_producto", input: { consulta: "integra barrita" } }], "tool_use"),
      msg([{ type: "tool_use", id: "t2", name: "guardar_alimento", input: { nombre: "Barrita proteica sabor chocolate", marca: "Integra", porcion_texto: "1 barrita (46 g)", porcion_g: 46, kcal: 175, p: 15, c: 18, f: 5, fuente: "Open Food Facts 779" } }], "tool_use"),
      msg([{ type: "text", text: "Integra chocolate: 175 kcal, 15 g P por barrita (Open Food Facts)." }], "end_turn"),
    ], bodies);
    const r = await lookupFood(client, { query: "Barrita proteica Integra — una barrita integra", fetchImpl: offFetch });
    expect(r.food!.portion_g).toBe(46);
    expect(r.message).toContain("175 kcal");
  });
});

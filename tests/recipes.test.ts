import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildDayState, defaultConfig, itemFromFood, perServing, rankRecipes, recipeAsText, SEED_FOODS, SEED_RECIPES,
  servingItems, shoppingList, slotBudget, totalsOf, type Meal,
} from "@core";
import { generateRecipe } from "../supabase/functions/_shared/ai/recipe.ts";

const cfg = defaultConfig("2026-11-01");
const TODAY = "2026-11-24";
const byId = (id: string) => SEED_RECIPES.find((r) => r.id === id)!;

describe("recetas base", () => {
  it("tienen macros coherentes y alta proteína", () => {
    expect(SEED_RECIPES.length).toBeGreaterThanOrEqual(8);
    for (const r of SEED_RECIPES) {
      const ps = perServing(r);
      expect(ps.kcal).toBeGreaterThan(150);
      expect(ps.p).toBeGreaterThan(15);
      expect(r.steps.length).toBeGreaterThan(1);
    }
  });
  it("una porción = receta / porciones", () => {
    const r = byId("r-albondigas");
    const one = totalsOf(servingItems(r, 1));
    expect(Math.abs(one.kcal - r.totals.kcal / r.servings)).toBeLessThan(5);
    expect(servingItems(r, 1)[0].grams).toBe(150); // 600 g de pollo / 4
  });
  it("texto para copiar", () => {
    expect(recipeAsText(byId("r-panqueques"))).toContain("Pasos:");
  });
});

describe("sugerencias, heladera y compras", () => {
  it("prioriza lo que hay en la heladera y respeta la regla de carbos", () => {
    const carbs: Meal = { id: "m", local_date: TODAY, slot: "almuerzo", eaten_at: `${TODAY}T16:00:00Z`, items: [itemFromFood(SEED_FOODS.find((f) => f.id === "fideos")!, 250)], totals: { kcal: 400, p: 15, c: 78, f: 2 }, source: "list", confirmed: true };
    const day = buildDayState(TODAY, [carbs], cfg);
    const recipes = SEED_RECIPES.map((r) => (r.id === "r-tarta-ricota" ? { ...r, batch_left: 2 } : r));
    const ranked = rankRecipes(recipes, "cena", day);
    expect(ranked[0].recipe.id).toBe("r-tarta-ricota");
    expect(ranked[0].why).toContain("heladera");
  });
  it("presupuesto por porción según lo que queda", () => {
    const b = slotBudget(buildDayState(TODAY, [], cfg), "cena");
    expect(b.kcal).toBeGreaterThan(400);
    expect(b.p).toBeGreaterThan(35);
  });
  it("lista de compras suma ingredientes por tandas", () => {
    const list = shoppingList([{ recipe: byId("r-albondigas"), batches: 2 }, { recipe: byId("r-panqueques"), batches: 1 }], SEED_FOODS);
    const pollo = list.find((i) => i.key === "pollo-pechuga")!;
    expect(pollo.grams).toBe(1200);
    expect(pollo.label).toContain("crudo"); // se compra crudo: 1200 g cocido ≈ 1,67 kg crudo
    const huevo = list.find((i) => i.key === "huevo")!;
    expect(huevo.grams).toBe(200); // 50×2 + 100
    expect(huevo.label).toContain("unidad");
    expect(list[0].category).toBe("proteína");
  });
});

describe("generador con IA", () => {
  it("recalcula macros con la tabla y calcula la desviación por porción", async () => {
    const bodies: any[] = [];
    const out = {
      name: "Wok de pollo con zapallitos",
      prep_min: 20,
      ingredients: [
        { food_id: "pollo-pechuga", name: "Pollo", grams: 300, kcal: 1, p: 1, c: 1, f: 1 },
        { food_id: "zapallito", name: "Zapallitos", grams: 300, kcal: 1, p: 1, c: 1, f: 1 },
        { food_id: null, name: "Salsa de soja", grams: 20, kcal: 200, p: 2, c: 2, f: 0 },
      ],
      steps: ["Cortar", "Saltear"],
      tips: null,
      tags: ["alta proteína"],
    };
    const fetch = async (_u: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new Anthropic({ apiKey: "test-not-real", fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
    const r = await generateRecipe(client, { slot: "cena", target: { kcal: 330, p: 50, c: 10, f: 8 }, servings: 2, max_minutes: 20, have: "pollo, zapallitos", foods: SEED_FOODS, low_carb: true });
    expect(r.recipe.servings).toBe(2);
    expect(r.perServing.p).toBeGreaterThan(45); // 300 g pollo cocido / 2
    expect(r.recipe.ingredients[2].kcal).toBe(16); // 4·2 + 4·2 corregido (el modelo dijo 200)
    expect(r.recipe.tags).toContain("baja en carbos");
    expect(r.recipe.source).toBe("ia");
    const b = bodies[0];
    expect(b.fallbacks).toBe("default");
    expect(b.output_config.format.type).toBe("json_schema");
    expect(b.messages[0].content).toContain("pollo, zapallitos");
    expect(b.messages[0].content).toContain("baja en carbos");
  });
});

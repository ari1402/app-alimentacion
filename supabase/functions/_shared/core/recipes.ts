// Recetas: porciones, sugerencias según lo que queda del día, meal prep y lista de compras.
import type { Food, Macros, MealItem, Recipe, RecipeTag, Slot } from "./types.ts";
import { itemFromFood, roundMacros, scale, totalsOf } from "./macros.ts";
import type { DayState } from "./macros.ts";
import { SEED_FOODS } from "./seed.ts";

export function perServing(r: Recipe): Macros {
  return roundMacros(scale(r.totals, 1 / Math.max(1, r.servings)));
}

/** Ítems de UNA porción (para registrar) */
export function servingItems(r: Recipe, portions = 1): MealItem[] {
  const k = portions / Math.max(1, r.servings);
  return r.ingredients.map((i) => ({ ...i, ...roundMacros(scale(i, k)), grams: Math.round(i.grams * k) }));
}

export function withTotals(r: Omit<Recipe, "totals"> & { totals?: Macros }): Recipe {
  return { ...r, totals: totalsOf(r.ingredients) } as Recipe;
}

/** Etiquetas calculadas a partir de los macros por porción */
export function autoTags(r: Recipe): RecipeTag[] {
  const ps = perServing(r);
  const tags = new Set<RecipeTag>(r.tags);
  if (ps.kcal > 0 && (ps.p * 4) / ps.kcal >= 0.3) tags.add("alta proteína");
  if (ps.c <= 25) tags.add("baja en carbos");
  if (r.prep_min <= 15) tags.add("rápida");
  if (r.servings >= 3) tags.add("meal prep");
  return [...tags];
}

export interface RecipeFit {
  recipe: Recipe;
  perServing: Macros;
  fits: boolean;
  score: number;
  why: string;
}

/** Recetas que mejor entran en lo que queda del día (porciones en la heladera primero) */
export function rankRecipes(recipes: Recipe[], slot: Slot, day: DayState): RecipeFit[] {
  const pending = Math.max(1, day.pendingSlots.length);
  const budgetKcal = Math.max(250, day.remaining.kcal / pending * (slot === "almuerzo" || slot === "cena" ? 1.3 : 0.7));
  const budgetP = Math.max(20, day.remaining.p / pending);
  return recipes
    .filter((r) => slot === "snack" || r.slots.includes(slot as Exclude<Slot, "snack">) || r.slots.length === 0)
    .map((r) => {
      const ps = perServing(r);
      const over = Math.max(0, ps.kcal - budgetKcal);
      const lowCarbOk = !day.carbRule.active || ps.c <= 35;
      // Lo ya cocinado (meal prep) va primero si entra: es lo más práctico y evita desperdicio
      const batch = r.batch_left && r.batch_left > 0 ? 60 : 0;
      const score = Math.min(1, ps.p / budgetP) * 100 - over * 0.25 - (lowCarbOk ? 0 : 40) + batch + (r.favorite ? 10 : 0);
      const fits = over < 80 && lowCarbOk;
      const why = [
        `${ps.kcal} kcal · ${Math.round(ps.p)} g P por porción`,
        r.batch_left ? `${r.batch_left} porción(es) en la heladera` : null,
        day.carbRule.active ? (lowCarbOk ? "baja en carbos ✓" : `${Math.round(ps.c)} g carbos`) : null,
      ].filter(Boolean).join(" · ");
      return { recipe: r, perServing: ps, fits, score, why };
    })
    .sort((a, b) => b.score - a.score);
}

/** Macros sugeridos para UNA porción de este momento, según lo que queda del día */
export function slotBudget(day: DayState, slot: Exclude<Slot, "snack">): Macros {
  const W: Record<string, number> = { desayuno: 0.22, almuerzo: 0.3, merienda: 0.16, cena: 0.32, snack: 0.05 };
  const pending = day.pendingSlots.length ? day.pendingSlots : [slot];
  const total = pending.reduce((a, s) => a + (W[s] ?? 0.2), 0) || 1;
  const share = (W[slot] ?? 0.25) / total;
  const r = day.remaining;
  return {
    kcal: Math.max(250, Math.round((r.kcal * share) / 10) * 10),
    p: Math.max(25, Math.round(r.p * share)),
    c: Math.max(day.carbRule.active ? 0 : 15, Math.round(Math.min(day.carbRule.active ? 30 : 999, r.c * share))),
    f: Math.max(8, Math.round(r.f * share)),
  };
}

export interface ShoppingItem {
  key: string;
  name: string;
  grams: number;
  category: string;
  /** texto amigable: "≈ 3 unidades (150 g)" */
  label: string;
}

/** Cocido → crudo/seco para comprar (rendimientos de cocción típicos) */
const RAW_FACTOR: Record<string, [number, string]> = {
  "pollo-pechuga": [1 / 0.72, "crudo"], "carne-magra": [1 / 0.72, "crudo"], "bife-chorizo": [1 / 0.72, "crudo"],
  "cerdo-solomillo": [1 / 0.72, "crudo"], "merluza": [1 / 0.8, "crudo"], "salmon": [1 / 0.8, "crudo"],
  "arroz-blanco": [1 / 2.8, "seco"], "arroz-integral": [1 / 2.6, "seco"], "fideos": [1 / 2.4, "secos"],
  "quinoa": [1 / 2.7, "seca"], "polenta": [1 / 4.5, "seca"], "lentejas": [1 / 2.4, "secas"], "garbanzos": [1 / 2.3, "secos"],
};

const CATEGORY_ORDER = ["proteína", "lácteo", "legumbre", "carbo", "verdura", "fruta", "grasa", "suplemento", "receta", "bebida", "otros"];

/** Lista de compras: suma los ingredientes de las recetas elegidas (× tandas) */
export function shoppingList(selection: { recipe: Recipe; batches: number }[], foods: Food[]): ShoppingItem[] {
  const byId = new Map(foods.map((f) => [f.id, f]));
  const acc = new Map<string, ShoppingItem>();
  for (const { recipe, batches } of selection) {
    for (const i of recipe.ingredients) {
      const f = i.food_id ? byId.get(i.food_id) : undefined;
      const key = f?.id ?? i.name.toLowerCase().trim();
      const cur = acc.get(key) ?? { key, name: f?.name ?? i.name, grams: 0, category: f?.category ?? "otros", label: "" };
      cur.grams += i.grams * batches;
      acc.set(key, cur);
    }
  }
  return [...acc.values()]
    .map((it) => {
      const f = byId.get(it.key);
      const g = Math.round(it.grams);
      let label = `${g} g`;
      const raw = RAW_FACTOR[it.key];
      if (raw) {
        const rg = Math.round((g * raw[0]) / 10) * 10;
        label = `≈ ${rg >= 1000 ? `${(rg / 1000).toFixed(2).replace(/0$/, "").replace(".", ",")} kg` : `${rg} g`} ${raw[1]} (${g} g cocido)`;
      } else if (f && /unidad|feta|lata|pote|scoop|clara/.test(f.portion_label)) {
        const n = Math.ceil((g / f.portion_g) * 10) / 10;
        label = `≈ ${n % 1 === 0 ? n : n.toFixed(1)} × ${f.portion_label.replace(/\s*\(.*\)/, "")} (${g} g)`;
      }
      return { ...it, grams: g, label };
    })
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
}

export function recipeAsText(r: Recipe): string {
  const ps = perServing(r);
  return [
    r.name,
    `${r.servings} porción(es) · ${r.prep_min} min · por porción: ${ps.kcal} kcal, P ${Math.round(ps.p)} g, C ${Math.round(ps.c)} g, G ${Math.round(ps.f)} g`,
    "",
    "Ingredientes:",
    ...r.ingredients.map((i) => `- ${i.name}: ${i.grams} g`),
    "",
    "Pasos:",
    ...r.steps.map((s, n) => `${n + 1}. ${s}`),
    r.tips ? `\nTip: ${r.tips}` : "",
  ].join("\n").trim();
}

// ─────────────────────────── Recetas base ───────────────────────────

const F = new Map(SEED_FOODS.map((f) => [f.id, f]));
function ing(list: [string, number][]): MealItem[] {
  return list.map(([id, g]) => {
    const f = F.get(id);
    if (!f) throw new Error(`receta base: alimento ${id} no existe`);
    return itemFromFood(f, g);
  });
}

type Base = [id: string, name: string, slots: Recipe["slots"], servings: number, min: number, items: [string, number][], steps: string[], tags: RecipeTag[], tips?: string];

const BASE: Base[] = [
  ["r-panqueques", "Panqueques proteicos", ["desayuno", "merienda"], 3, 15,
    [["huevo", 100], ["clara", 99], ["avena", 60], ["whey", 30], ["leche-desc", 60]],
    ["Licuá todo hasta que quede liso (1 min).", "Sartén antiadherente a fuego medio, apenas rociada.", "Cociná 2 min por lado, de a uno.", "Se guardan 3 días en la heladera o se congelan separados con papel."],
    ["alta proteína", "rápida", "meal prep"], "Con frutillas y un poco de queso untable arriba quedan muy bien."],
  ["r-overnight", "Avena overnight proteica", ["desayuno", "merienda"], 1, 5,
    [["avena", 40], ["yogur-griego", 170], ["whey", 15], ["leche-desc", 80], ["arandanos", 60], ["chia", 5]],
    ["Mezclá todo en un frasco.", "Heladera toda la noche (mínimo 4 h).", "Comé frío; se puede llevar a la guardia."],
    ["alta proteína", "rápida", "portable", "sin horno"]],
  ["r-albondigas", "Albóndigas de pollo en salsa", ["almuerzo", "cena"], 4, 40,
    [["pollo-pechuga", 600], ["huevo", 50], ["avena", 30], ["cebolla", 100], ["salsa-tomate", 500], ["queso-rallado", 20]],
    ["Procesá el pollo crudo con cebolla, huevo, avena, sal y especias (orégano, ajo).", "Formá ~20 albóndigas.", "Doralas en sartén o al horno 10 min a 200 °C.", "Terminá 15 min en la salsa de tomate a fuego bajo.", "Porcioná en 4 tápers: 4 días en heladera o 2 meses en freezer."],
    ["alta proteína", "meal prep", "reintroducción"], "El pollo procesado y en salsa es una buena forma de reintroducirlo: textura distinta, sabor a tuco."],
  ["r-tortilla", "Tortilla de papa al horno", ["almuerzo", "cena"], 2, 35,
    [["papa", 400], ["huevo", 150], ["clara", 132], ["cebolla", 100], ["aceite-oliva", 5]],
    ["Papa en rodajas finas al microondas 6–8 min tapada (o hervida).", "Cebolla rehogada con el aceite.", "Batí huevos y claras con sal, sumá papa y cebolla.", "Molde de horno, 20 min a 190 °C."],
    ["alta proteína"]],
  ["r-wok-cerdo", "Wok de cerdo y verduras", ["almuerzo", "cena"], 2, 25,
    [["cerdo-solomillo", 300], ["morron", 150], ["cebolla", 100], ["zanahoria", 100], ["brocoli", 150], ["aceite-oliva", 10], ["arroz-blanco", 200]],
    ["Cortá el cerdo en tiras finas, salpimentá.", "Wok o sartén bien caliente: sellá el cerdo 3 min y sacalo.", "Salteá las verduras 5 min (que queden crocantes).", "Volvé el cerdo, salsa de soja y jengibre a gusto.", "Serví con el arroz (o sin arroz si venís de una comida alta en carbos)."],
    ["alta proteína"]],
  ["r-guiso-lentejas", "Guiso de lentejas con carne magra", ["almuerzo", "cena"], 4, 50,
    [["lentejas", 600], ["carne-magra", 400], ["cebolla", 150], ["zanahoria", 150], ["morron", 100], ["salsa-tomate", 300], ["aceite-oliva", 10]],
    ["Rehogá cebolla, morrón y zanahoria con el aceite.", "Sumá la carne en cubos y sellá.", "Agregá salsa, lentejas cocidas y caldo; 25 min a fuego bajo.", "Pimentón y comino a gusto. Rinde 4 porciones; se congela muy bien."],
    ["alta proteína", "meal prep"]],
  ["r-tarta-ricota", "Tarta sin masa de espinaca y ricota", ["almuerzo", "cena"], 3, 40,
    [["espinaca", 400], ["ricota-desc", 300], ["huevo", 150], ["clara", 99], ["cebolla", 100], ["queso-rallado", 20]],
    ["Espinaca cocida y bien escurrida, picada.", "Mezclá con ricota, huevos, claras, cebolla rehogada, sal y nuez moscada.", "Molde aceitado, queso rallado arriba.", "30 min a 180 °C. Firme en el centro = lista."],
    ["alta proteína", "baja en carbos", "meal prep"]],
  ["r-bowl-atun", "Bowl frío de atún, papa y huevo", ["almuerzo", "cena"], 1, 15,
    [["atun-natural", 120], ["papa", 150], ["huevo", 50], ["tomate", 120], ["hojas", 60], ["aceite-oliva", 5]],
    ["Papa hervida en cubos (podés usar del día anterior).", "Huevo duro.", "Armá el bowl con hojas, tomate, atún; aceite, limón y sal."],
    ["alta proteína", "rápida", "portable", "sin horno"]],
  ["r-hamburguesas", "Hamburguesas caseras magras", ["almuerzo", "cena"], 4, 25,
    [["carne-picada-5", 600], ["cebolla", 80], ["huevo", 50], ["avena", 20]],
    ["Mezclá la carne con cebolla rallada, huevo, avena, sal y pimienta.", "Formá 4 medallones de ~180 g.", "Plancha bien caliente 4 min por lado.", "Se congelan crudas separadas con film."],
    ["alta proteína", "baja en carbos", "meal prep"]],
  ["r-mousse", "Mousse proteica de chocolate", ["merienda", "cena"], 1, 5,
    [["yogur-griego", 170], ["whey", 15], ["chocolate-70", 10]],
    ["Mezclá yogur y whey hasta que quede liso.", "Cacao amargo en polvo a gusto (suma sabor sin kcal) y edulcorante si querés.", "Chocolate rallado arriba. Ideal como cierre del día si falta proteína."],
    ["alta proteína", "rápida", "sin horno", "dulce"]],
];

export const SEED_RECIPES: Recipe[] = BASE.map(([id, name, slots, servings, prep_min, items, steps, tags, tips]) =>
  withTotals({ id, name, slots, servings, prep_min, ingredients: ing(items), steps, tags, tips: tips ?? null, source: "base" }),
);

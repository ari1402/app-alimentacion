// Datos precargados. ⚠️ La fuente de verdad es el documento del proyecto "Nutrición":
// reemplazá/ajustá esta tabla y las opciones A1–A15 / C1–C10 desde Ajustes → Importar,
// o editándolas en la app. Los valores de acá son referencias estándar razonables.
import type { Food, MealTemplate, UserConfig } from "./types.ts";
import { itemFromFood, totalsOf } from "./macros.ts";
import { DEFAULT_TZ } from "./dates.ts";

type Row = [id: string, name: string, portion: string, g: number, kcal: number, p: number, c: number, f: number, cat: string, aliases?: string[]];

// Macros por la porción indicada
const ROWS: Row[] = [
  // Proteínas
  ["pollo-pechuga", "Pechuga de pollo cocida", "100 g", 100, 165, 31, 0, 3.6, "proteína", ["pollo", "pechuga"]],
  ["carne-magra", "Carne vacuna magra cocida (peceto, lomo, nalga)", "100 g", 100, 180, 28, 0, 7, "proteína", ["carne", "bife magro", "peceto", "lomo", "nalga", "milanesa al horno sin rebozar"]],
  ["carne-picada-5", "Carne picada especial 5% (cruda)", "100 g", 100, 137, 21, 0, 5, "proteína", ["picada", "carne picada"]],
  ["bife-chorizo", "Bife de chorizo cocido", "100 g", 100, 250, 26, 0, 16, "proteína", ["bife", "asado"]],
  ["cerdo-solomillo", "Solomillo de cerdo cocido", "100 g", 100, 165, 28, 0, 5, "proteína", ["cerdo", "bondiola magra"]],
  ["merluza", "Merluza cocida", "100 g", 100, 90, 19, 0, 1.3, "proteína", ["pescado blanco", "filet"]],
  ["salmon", "Salmón cocido", "100 g", 100, 206, 22, 0, 12, "proteína", ["salmón"]],
  ["atun-natural", "Atún al natural escurrido", "1 lata (120 g)", 120, 130, 29, 0, 1, "proteína", ["atún", "lata de atún"]],
  ["huevo", "Huevo entero", "1 unidad (50 g)", 50, 72, 6.3, 0.4, 4.8, "proteína", ["huevos", "huevo duro", "huevo revuelto"]],
  ["clara", "Clara de huevo", "1 clara (33 g)", 33, 17, 3.6, 0.2, 0.1, "proteína", ["claras"]],
  ["jamon-cocido", "Jamón cocido natural", "1 feta (20 g)", 20, 22, 3.6, 0.3, 0.6, "proteína", ["jamón", "fiambre"]],
  ["pavo-fiambre", "Pechuga de pavo (fiambre)", "1 feta (20 g)", 20, 20, 3.8, 0.5, 0.3, "proteína", ["pavo", "fetas de pavo"]],
  ["queso-port-light", "Queso port salut light", "30 g", 30, 63, 6.6, 0.3, 3.9, "lácteo", ["queso", "port salut", "queso fresco light"]],
  ["queso-untable-light", "Queso untable descremado", "2 cdas (30 g)", 30, 40, 3, 1.5, 2.5, "lácteo", ["queso crema", "casancrem light", "untable"]],
  ["ricota-desc", "Ricota descremada", "100 g", 100, 120, 11, 4, 6, "lácteo", ["ricota"]],
  ["cottage", "Queso cottage", "100 g", 100, 98, 11, 3.4, 4.3, "lácteo"],
  ["yogur-griego", "Yogur griego natural descremado", "1 pote (170 g)", 170, 100, 17, 6, 0.7, "lácteo", ["griego", "yogur"]],
  ["yogur-bebible-desc", "Yogur bebible descremado", "200 ml", 200, 90, 7, 13, 0.5, "lácteo", ["yogur bebible"]],
  ["leche-desc", "Leche descremada", "200 ml", 200, 70, 6.6, 9.8, 0.4, "lácteo", ["leche"]],
  ["leche-proteica", "Leche proteica", "200 ml", 200, 110, 16, 9, 1, "lácteo", ["leche protein", "leche con proteína"]],
  ["whey", "Proteína whey", "1 scoop (30 g)", 30, 120, 24, 3, 1.5, "suplemento", ["proteína en polvo", "scoop", "whey protein"]],
  ["panqueque-proteico", "Panqueque proteico (huevo, clara, avena, whey)", "1 unidad (100 g)", 100, 180, 18, 15, 5, "receta", ["panqueque", "pancake proteico", "panqueques"]],
  ["barrita-proteica", "Barrita de proteína", "1 unidad (45 g)", 45, 180, 15, 18, 6, "suplemento", ["barrita", "barra proteica"]],
  ["tofu", "Tofu firme", "100 g", 100, 145, 15, 3, 8, "proteína"],
  ["lentejas", "Lentejas cocidas", "100 g", 100, 116, 9, 20, 0.4, "legumbre"],
  ["garbanzos", "Garbanzos cocidos", "100 g", 100, 164, 8.9, 27, 2.6, "legumbre"],
  // Carbohidratos
  ["arroz-blanco", "Arroz blanco cocido", "100 g", 100, 130, 2.7, 28, 0.3, "carbo", ["arroz"]],
  ["arroz-integral", "Arroz integral cocido", "100 g", 100, 123, 2.7, 25.6, 1, "carbo"],
  ["fideos", "Fideos cocidos", "100 g", 100, 158, 5.8, 31, 0.9, "carbo", ["pasta", "fideos secos cocidos"]],
  ["papa", "Papa hervida / al horno sin aceite", "100 g", 100, 87, 1.9, 20, 0.1, "carbo", ["papas", "puré de papa"]],
  ["batata", "Batata hervida / al horno", "100 g", 100, 86, 1.6, 20, 0.1, "carbo", ["boniato"]],
  ["avena", "Avena en hojuelas", "3 cdas (30 g)", 30, 117, 4, 20, 2, "carbo", ["copos de avena"]],
  ["pan-integral", "Pan integral", "1 rebanada (30 g)", 30, 75, 3.5, 13, 1, "carbo", ["pan de molde integral", "tostada integral"]],
  ["pan-frances", "Pan francés", "50 g", 50, 135, 4.5, 28, 0.6, "carbo", ["pan", "flauta", "mignon"]],
  ["tostada-arroz", "Tostada / galleta de arroz", "1 unidad (8 g)", 8, 31, 0.6, 6.5, 0.2, "carbo", ["galletas de arroz", "tostadas de arroz"]],
  ["wrap-integral", "Rapidita / wrap integral", "1 unidad (40 g)", 40, 120, 4, 20, 3, "carbo", ["rapiditas", "tortilla", "wrap"]],
  ["quinoa", "Quinoa cocida", "100 g", 100, 120, 4.4, 21, 1.9, "carbo"],
  ["choclo", "Choclo", "100 g", 100, 96, 3.4, 21, 1.5, "carbo", ["maíz"]],
  ["polenta", "Polenta cocida", "100 g", 100, 70, 1.6, 15, 0.3, "carbo"],
  // Frutas
  ["banana", "Banana", "1 unidad (120 g)", 120, 107, 1.3, 27, 0.4, "fruta"],
  ["manzana", "Manzana", "1 unidad (150 g)", 150, 78, 0.4, 21, 0.3, "fruta"],
  ["naranja", "Naranja", "1 unidad (150 g)", 150, 70, 1.4, 17.6, 0.2, "fruta"],
  ["mandarina", "Mandarina", "1 unidad (90 g)", 90, 48, 0.7, 12, 0.3, "fruta"],
  ["frutillas", "Frutillas", "1 taza (150 g)", 150, 48, 1, 11.5, 0.5, "fruta"],
  ["arandanos", "Arándanos", "100 g", 100, 57, 0.7, 14.5, 0.3, "fruta"],
  ["kiwi", "Kiwi", "1 unidad (75 g)", 75, 46, 0.9, 11, 0.4, "fruta"],
  // Verduras
  ["hojas", "Ensalada de hojas (lechuga, rúcula)", "1 plato (100 g)", 100, 17, 1.3, 3, 0.2, "verdura", ["ensalada", "lechuga", "rúcula"]],
  ["tomate", "Tomate", "1 unidad (120 g)", 120, 22, 1, 4.7, 0.2, "verdura"],
  ["brocoli", "Brócoli cocido", "100 g", 100, 35, 2.4, 7, 0.4, "verdura", ["brócoli"]],
  ["calabaza", "Calabaza / zapallo cocido", "100 g", 100, 40, 1, 10, 0.1, "verdura", ["zapallo", "puré de calabaza"]],
  ["zapallito", "Zapallito / zucchini", "100 g", 100, 17, 1.2, 3.1, 0.3, "verdura", ["zucchini"]],
  ["zanahoria", "Zanahoria", "100 g", 100, 41, 0.9, 10, 0.2, "verdura"],
  ["espinaca", "Espinaca / acelga cocida", "100 g", 100, 23, 3, 3.8, 0.3, "verdura", ["acelga"]],
  ["champinones", "Champiñones", "100 g", 100, 22, 3.1, 3.3, 0.3, "verdura", ["hongos"]],
  ["morron", "Morrón", "100 g", 100, 26, 1, 6, 0.3, "verdura", ["pimiento"]],
  ["cebolla", "Cebolla", "100 g", 100, 40, 1.1, 9.3, 0.1, "verdura"],
  ["verduras-horno", "Verduras al horno mixtas (sin aceite)", "1 porción (150 g)", 150, 70, 2, 14, 0.5, "verdura", ["verduras asadas", "vegetales"]],
  // Grasas
  ["aceite-oliva", "Aceite de oliva", "1 cda (10 g)", 10, 88, 0, 0, 10, "grasa", ["aceite"]],
  ["palta", "Palta", "1/4 unidad (50 g)", 50, 80, 1, 4.3, 7.3, "grasa", ["aguacate"]],
  ["almendras", "Almendras", "1 puñado (15 g)", 15, 87, 3.2, 3.2, 7.5, "grasa", ["frutos secos"]],
  ["nueces", "Nueces", "1 puñado (15 g)", 15, 98, 2.3, 2, 9.8, "grasa"],
  ["mani-pasta", "Mantequilla de maní", "1 cda (15 g)", 15, 90, 3.8, 3, 7.5, "grasa", ["pasta de maní"]],
  ["manteca", "Manteca", "10 g", 10, 72, 0, 0, 8.1, "grasa"],
  ["queso-rallado", "Queso rallado", "1 cda (10 g)", 10, 39, 3.5, 0.4, 2.6, "lácteo"],
  ["chia", "Semillas de chía", "1 cda (10 g)", 10, 49, 1.7, 4.2, 3.1, "grasa", ["chía"]],
  // Bebidas y otros
  ["cafe-con-leche", "Café con leche descremada", "1 taza (150 ml leche)", 150, 55, 5, 7.5, 0.3, "bebida", ["cortado", "café con leche"]],
  ["cafe-leche-proteica", "Café con leche proteica", "1 taza (150 ml leche)", 150, 85, 12, 7, 0.8, "bebida", ["café con leche proteica"]],
  ["cafe", "Café solo / mate sin azúcar", "1 taza", 1, 2, 0.3, 0, 0, "bebida", ["café", "mate", "té"]],
  ["miel", "Miel", "1 cdita (7 g)", 7, 21, 0, 5.7, 0, "otros"],
  ["mermelada-light", "Mermelada light", "1 cda (20 g)", 20, 20, 0, 5, 0, "otros", ["mermelada"]],
  ["chocolate-70", "Chocolate amargo 70%", "2 cuadraditos (10 g)", 10, 60, 0.8, 4.6, 4.3, "otros", ["chocolate"]],
  ["alfajor", "Alfajor simple", "1 unidad (50 g)", 50, 220, 2.5, 30, 10, "otros"],
  ["medialuna", "Medialuna", "1 unidad (40 g)", 40, 170, 3, 20, 8.5, "otros", ["factura"]],
  ["empanada-carne", "Empanada de carne al horno", "1 unidad (100 g)", 100, 280, 10, 28, 14, "otros", ["empanada"]],
  ["pizza-muzza", "Pizza de muzzarella", "1 porción (120 g)", 120, 300, 12, 34, 12, "otros", ["pizza"]],
  ["helado", "Helado de crema", "1 bocha (100 g)", 100, 210, 4, 25, 11, "otros"],
  ["vino", "Vino tinto", "1 copa (150 ml)", 150, 125, 0.1, 3.8, 0, "bebida"],
  ["cerveza", "Cerveza", "1 lata (355 ml)", 355, 150, 1.6, 13, 0, "bebida", ["birra"]],
  ["salsa-tomate", "Salsa de tomate casera", "100 g", 100, 35, 1.5, 7, 0.3, "otros", ["salsa", "tuco"]],
];

export const SEED_FOODS: Food[] = ROWS.map(([id, name, portion_label, portion_g, kcal, p, c, f, category, aliases]) => ({
  id, name, portion_label, portion_g, kcal, p, c, f, category, aliases: aliases ?? [],
}));

const FOOD = new Map(SEED_FOODS.map((f) => [f.id, f]));

type T = [code: string, slot: MealTemplate["slot"], name: string, items: [string, number][], desc?: string];

const TPL: T[] = [
  // Desayunos / meriendas
  ["D1", "desayuno", "Panqueque proteico + café con leche proteica", [["panqueque-proteico", 150], ["cafe-leche-proteica", 150], ["frutillas", 100]]],
  ["D2", "desayuno", "Yogur griego + whey + avena + fruta", [["yogur-griego", 170], ["whey", 15], ["avena", 30], ["arandanos", 80]]],
  ["D3", "desayuno", "Tostadas integrales con huevos revueltos", [["pan-integral", 60], ["huevo", 100], ["clara", 66], ["cafe-con-leche", 150]]],
  ["D4", "desayuno", "Tostadas con queso untable y pavo", [["pan-integral", 60], ["queso-untable-light", 30], ["pavo-fiambre", 60], ["cafe-leche-proteica", 150]]],
  ["M1", "merienda", "Yogur griego con fruta", [["yogur-griego", 170], ["banana", 60]]],
  ["M2", "merienda", "Leche proteica + tostadas de arroz con pavo", [["leche-proteica", 200], ["tostada-arroz", 24], ["pavo-fiambre", 40]]],
  ["M3", "merienda", "Batido whey + banana", [["whey", 30], ["leche-desc", 200], ["banana", 120]]],
  ["M4", "merienda", "Barrita proteica + café con leche", [["barrita-proteica", 45], ["cafe-con-leche", 150]], "Portable: ideal para guardia"],
  // Almuerzos A1–A15
  ["A1", "almuerzo", "Bowl de carne magra con arroz integral y verduras", [["carne-magra", 150], ["arroz-integral", 120], ["zapallito", 100], ["morron", 50], ["aceite-oliva", 5]]],
  ["A2", "almuerzo", "Wrap de atún con queso untable", [["wrap-integral", 40], ["atun-natural", 120], ["queso-untable-light", 30], ["tomate", 120], ["hojas", 50]]],
  ["A3", "almuerzo", "Solomillo de cerdo con batata y ensalada", [["cerdo-solomillo", 150], ["batata", 200], ["hojas", 100], ["aceite-oliva", 5]]],
  ["A4", "almuerzo", "Fideos con salsa bolognesa magra", [["fideos", 150], ["carne-picada-5", 130], ["salsa-tomate", 120], ["queso-rallado", 10]]],
  ["A5", "almuerzo", "Tortilla de papa al horno (huevos + claras)", [["huevo", 100], ["clara", 99], ["papa", 200], ["cebolla", 50], ["aceite-oliva", 5], ["hojas", 80]]],
  ["A6", "almuerzo", "Salmón con quinoa y brócoli", [["salmon", 130], ["quinoa", 120], ["brocoli", 100]]],
  ["A7", "almuerzo", "Ensalada completa con atún, huevo y papa", [["atun-natural", 120], ["huevo", 100], ["papa", 150], ["tomate", 120], ["hojas", 80], ["aceite-oliva", 5]]],
  ["A8", "almuerzo", "Hamburguesa casera en pan integral", [["carne-picada-5", 150], ["pan-integral", 60], ["tomate", 60], ["hojas", 30], ["queso-port-light", 30]]],
  ["A9", "almuerzo", "Albóndigas de pollo en salsa con arroz", [["pollo-pechuga", 150], ["salsa-tomate", 150], ["arroz-blanco", 120]], "Pollo 'disimulado' en salsa (reintroducción)"],
  ["A10", "almuerzo", "Guiso de lentejas con carne magra", [["lentejas", 150], ["carne-magra", 100], ["zanahoria", 60], ["cebolla", 50]]],
  ["A11", "almuerzo", "Tarta sin tapa de espinaca y ricota", [["wrap-integral", 40], ["ricota-desc", 150], ["huevo", 50], ["espinaca", 150], ["queso-rallado", 10], ["pavo-fiambre", 40]]],
  ["A12", "almuerzo", "Carne magra con puré mixto", [["carne-magra", 150], ["papa", 100], ["calabaza", 150]]],
  ["A13", "almuerzo", "Poke de atún con arroz y palta", [["atun-natural", 120], ["arroz-blanco", 120], ["palta", 40], ["zanahoria", 50], ["hojas", 50]]],
  ["A14", "almuerzo", "Sándwich de pavo y queso + yogur", [["pan-integral", 90], ["pavo-fiambre", 80], ["queso-port-light", 30], ["tomate", 60], ["yogur-griego", 170]], "Portable"],
  ["A15", "almuerzo", "Wok de cerdo con arroz y verduras", [["cerdo-solomillo", 150], ["arroz-blanco", 100], ["morron", 80], ["cebolla", 50], ["zanahoria", 50], ["aceite-oliva", 5]]],
  // Cenas C1–C10 (en general más bajas en carbos)
  ["C1", "cena", "Carne magra con verduras al horno", [["carne-magra", 150], ["calabaza", 150], ["zapallito", 100], ["aceite-oliva", 5]]],
  ["C2", "cena", "Omelette de espinaca y queso con tostadas de arroz", [["huevo", 100], ["clara", 99], ["queso-port-light", 30], ["espinaca", 100], ["tostada-arroz", 16]]],
  ["C3", "cena", "Salmón con ensalada y palta", [["salmon", 130], ["hojas", 100], ["tomate", 120], ["palta", 40]]],
  ["C4", "cena", "Revuelto de zapallitos con huevos y pavo", [["huevo", 100], ["clara", 66], ["zapallito", 200], ["pavo-fiambre", 60], ["cebolla", 50]]],
  ["C5", "cena", "Atún con papa, huevo y tomate", [["atun-natural", 120], ["papa", 150], ["huevo", 50], ["tomate", 120]]],
  ["C6", "cena", "Cerdo con brócoli y batata", [["cerdo-solomillo", 150], ["brocoli", 150], ["batata", 100]]],
  ["C7", "cena", "Hamburguesa al plato con ensalada y queso", [["carne-picada-5", 150], ["hojas", 100], ["tomate", 120], ["queso-port-light", 30]]],
  ["C8", "cena", "Tofu salteado con verduras y arroz integral", [["tofu", 150], ["verduras-horno", 200], ["arroz-integral", 80], ["aceite-oliva", 5]]],
  ["C9", "cena", "Pizza de rapidita con jamón y queso", [["wrap-integral", 40], ["queso-port-light", 45], ["jamon-cocido", 60], ["salsa-tomate", 50], ["hojas", 50]]],
  ["C10", "cena", "Cena rápida: yogur griego, whey, frutos rojos y almendras", [["yogur-griego", 170], ["whey", 30], ["arandanos", 100], ["almendras", 15]], "Para noches de guardia o sin ganas de cocinar"],
];

export const SEED_TEMPLATES: MealTemplate[] = TPL.map(([code, slot, name, items, description]) => {
  const its = items.map(([id, g]) => {
    const f = FOOD.get(id);
    if (!f) throw new Error(`seed: alimento ${id} no existe`);
    return itemFromFood(f, g);
  });
  return { id: code.toLowerCase(), code, slot, name, description, items: its, totals: totalsOf(its) };
});

export const SEED_EXERCISES: { name: string; ref_kg?: number }[] = [
  { name: "Prensa", ref_kg: 240 },
  { name: "Sentadilla", ref_kg: 90 },
  { name: "Jalón al pecho (espalda)", ref_kg: 55 },
  { name: "Peso muerto rumano" },
  { name: "Hip thrust" },
  { name: "Remo con barra" },
  { name: "Press banca" },
  { name: "Press militar" },
  { name: "Estocadas" },
  { name: "Camilla de isquios" },
  { name: "Sillón de cuádriceps" },
  { name: "Abductores" },
  { name: "Remo en polea" },
  { name: "Plancha" },
];

export function defaultConfig(today: string): UserConfig {
  return {
    name: "Ari",
    timezone: DEFAULT_TZ,
    targets: { kcal: 1700, p: 155, c: 180, f: 50 },
    ranges: { kcal: [1600, 1800], pMin: 145, c: [150, 200], f: [40, 60] },
    meals_per_day: 4,
    carb_rule_threshold: 50,
    reminders: {
      manana: "07:30",
      desayuno: "09:00",
      almuerzo: "13:00",
      merienda: "17:00",
      cena: "21:00",
      tarde: "18:30",
      noche: "22:30",
      semanal: "20:00",
    },
    weekly_review_day: 0,
    workout: { days: [1, 3, 5], time: "19:00", weekly_min: 3, weekly_max: 4, restart_date: today },
    goal: { start_kg: 83, start_date: today, target_min: 73, target_max: 75 },
    profile: { sex: "f", height_cm: null, age: null },
    why: "",
    guardia_until: null,
    quiet_hours: { start: "23:30", end: "07:00" },
    ai_daily_limit: 60,
    notifications: { enabled: true, kinds: {} },
    simple_mode: false,
    reintroductions: ["merluza", "pollo (disimulado)"],
    measure_every_days: 21,
    cardio: { eatback: 0.5, max_bonus: 400 },
    auto_adjust: { enabled: true, target_rate_pct: 0.7 },
    target_history: [],
    diet_break: null,
    cycle: { enabled: false, last_start: null, length: 28 },
    steps_goal: 8000,
  };
}

/** Completa claves nuevas cuando la config guardada es de una versión anterior */
export function mergeConfig(saved: Partial<UserConfig> | null | undefined, today: string): UserConfig {
  const d = defaultConfig(today);
  if (!saved) return d;
  return {
    ...d,
    ...saved,
    targets: { ...d.targets, ...saved.targets },
    ranges: { ...d.ranges, ...saved.ranges },
    reminders: { ...d.reminders, ...saved.reminders },
    workout: { ...d.workout, ...saved.workout },
    goal: { ...d.goal, ...saved.goal },
    profile: { ...d.profile, ...saved.profile },
    quiet_hours: { ...d.quiet_hours, ...saved.quiet_hours },
    cardio: { ...d.cardio, ...saved.cardio },
    auto_adjust: { ...d.auto_adjust, ...saved.auto_adjust },
    cycle: { ...d.cycle, ...saved.cycle },
    target_history: saved.target_history ?? [],
    notifications: { ...d.notifications, ...saved.notifications, kinds: { ...d.notifications.kinds, ...saved.notifications?.kinds } },
  };
}

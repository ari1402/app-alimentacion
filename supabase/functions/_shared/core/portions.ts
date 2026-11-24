// Aprendizaje de porciones: "un panqueque" = 100 g para Ari, y la IA lo usa la próxima vez.
import type { LearnedPortion, MealItem } from "./types.ts";

export function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Actualiza porciones aprendidas con los ítems confirmados (promedio móvil) */
export function learnPortions(existing: LearnedPortion[], items: MealItem[]): LearnedPortion[] {
  const map = new Map(existing.map((p) => [p.phrase, { ...p }]));
  for (const it of items) {
    if (!it.phrase || !it.grams) continue;
    const key = normalizePhrase(it.phrase);
    if (!key || key.length > 60) continue;
    const prev = map.get(key);
    if (prev && prev.food_id === (it.food_id ?? null)) {
      const n = Math.min(prev.count, 9);
      prev.grams = Math.round((prev.grams * n + it.grams) / (n + 1));
      prev.count += 1;
    } else {
      map.set(key, { phrase: key, food_id: it.food_id ?? null, grams: it.grams, count: 1 });
    }
  }
  return [...map.values()];
}

export function portionsForPrompt(portions: LearnedPortion[], limit = 60): string {
  return portions
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((p) => `"${p.phrase}" = ${p.grams} g${p.food_id ? ` [${p.food_id}]` : ""}`)
    .join("\n");
}

// Modo nube: Supabase (Postgres + RLS). Sincroniza entre dispositivos.
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, type BodyMetric, localDate, mergeConfig, type Recipe, SEED_FOODS, SEED_RECIPES, SEED_TEMPLATES } from "@core";
import type { AllData, Repo } from "./types";

function check<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? []) as NonNullable<T>;
}

const num = (v: unknown) => (v == null ? null : Number(v));

export function cloudRepo(sb: SupabaseClient, userId: string): Repo {
  const own = { user_id: userId };
  return {
    mode: "cloud",
    async loadAll() {
      const today = localDate();
      const cfgRes = await sb.from("user_config").select("config").eq("user_id", userId).maybeSingle();
      if (cfgRes.error) throw new Error(cfgRes.error.message);
      const cfgRow = cfgRes.data;
      let config = mergeConfig(cfgRow?.config ?? null, today);
      if (!cfgRow) {
        // Primer ingreso: precarga objetivos, tabla de alimentos y plantillas
        check(await sb.from("user_config").insert({ ...own, config }));
        check(await sb.from("foods").upsert(SEED_FOODS.map((f) => ({ ...f, ...own }))));
        check(await sb.from("meal_templates").upsert(SEED_TEMPLATES.map((t) => ({ ...t, ...own }))));
        config = mergeConfig(config, today);
      }
      // Recetas base una sola vez (marca en la config para no volver a sembrar si las borrás)
      if (!(config as { recipes_seeded?: boolean }).recipes_seeded) {
        check(await sb.from("recipes").upsert(SEED_RECIPES.map((r) => ({ ...r, ...own })), { onConflict: "user_id,id", ignoreDuplicates: true }));
        config = { ...config, recipes_seeded: true } as typeof config;
        check(await sb.from("user_config").upsert({ ...own, config, updated_at: new Date().toISOString() }));
      }
      const since = addDays(today, -400);
      const [foods, templates, meals, workouts, metrics, events, portions, chat, reintros, recipes] = await Promise.all([
        sb.from("foods").select("*").limit(5000),
        sb.from("meal_templates").select("*"),
        sb.from("meals_logged").select("*").gte("local_date", since).order("eaten_at").limit(10000),
        sb.from("workouts").select("*").order("local_date").limit(5000),
        sb.from("body_metrics").select("*").order("local_date").limit(5000),
        sb.from("coach_events").select("*").gte("local_date", addDays(today, -45)).order("created_at"),
        sb.from("portions").select("*"),
        sb.from("chat_messages").select("*").order("created_at", { ascending: false }).limit(100),
        sb.from("reintroductions").select("*").order("local_date"),
        sb.from("recipes").select("*").order("created_at"),
      ]);
      return {
        config,
        foods: check(foods).map((f) => ({ ...f, portion_g: Number(f.portion_g), kcal: Number(f.kcal), p: Number(f.p), c: Number(f.c), f: Number(f.f) })),
        templates: check(templates),
        meals: check(meals),
        workouts: check(workouts),
        metrics: check(metrics).map((m) => ({ ...m, weight_kg: num(m.weight_kg), waist_cm: num(m.waist_cm), hip_cm: num(m.hip_cm), thigh_cm: num(m.thigh_cm), steps: num(m.steps), sleep_h: num(m.sleep_h), resting_hr: num(m.resting_hr) })),
        events: check(events),
        portions: check(portions).map((p) => ({ ...p, grams: Number(p.grams) })),
        chat: check(chat).reverse(),
        reintros: check(reintros),
        recipes: check(recipes) as Recipe[],
      } as AllData;
    },
    async saveConfig(c) {
      check(await sb.from("user_config").upsert({ ...own, config: c, updated_at: new Date().toISOString() }));
    },
    async upsertFood(f) { check(await sb.from("foods").upsert({ ...f, ...own })); },
    async deleteFood(id) { check(await sb.from("foods").delete().eq("id", id)); },
    async upsertTemplate(t) { check(await sb.from("meal_templates").upsert({ ...t, ...own })); },
    async deleteTemplate(id) { check(await sb.from("meal_templates").delete().eq("id", id)); },
    async upsertMeal(m) {
      const { created_at: _c, ...row } = m;
      check(await sb.from("meals_logged").upsert({ ...row, ...own }));
    },
    async deleteMeal(id) { check(await sb.from("meals_logged").delete().eq("id", id)); },
    async upsertWorkout(w) {
      const { created_at: _c, ...row } = w;
      check(await sb.from("workouts").upsert({ ...row, ...own }));
    },
    async deleteWorkout(id) { check(await sb.from("workouts").delete().eq("id", id)); },
    async upsertMetric(m) {
      // Un registro por día: se combinan los campos presentes
      const { id: _id, ...rest } = m;
      const fields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null));
      const row = check(await sb.from("body_metrics").upsert({ ...fields, ...own }, { onConflict: "user_id,local_date" }).select("*").single());
      return { ...row, weight_kg: num(row.weight_kg), waist_cm: num(row.waist_cm), hip_cm: num(row.hip_cm), thigh_cm: num(row.thigh_cm), steps: num(row.steps), sleep_h: num(row.sleep_h), resting_hr: num(row.resting_hr) } as BodyMetric;
    },
    async deleteMetric(id) { check(await sb.from("body_metrics").delete().eq("id", id)); },
    async savePortions(p) {
      if (!p.length) return;
      check(await sb.from("portions").upsert(p.map((x) => ({ ...x, ...own, updated_at: new Date().toISOString() }))));
    },
    async addEvent(e) {
      const r = await sb.from("coach_events").insert({ ...e, ...own });
      if (r.error && !r.error.message.includes("duplicate")) throw new Error(r.error.message);
    },
    async respondEvent(id, r) {
      check(await sb.from("coach_events").update({ response: r, responded_at: new Date().toISOString() }).eq("id", id).is("response", null));
    },
    async addChat(m) { check(await sb.from("chat_messages").insert({ ...m, ...own })); },
    async clearChat() { check(await sb.from("chat_messages").delete().eq("user_id", userId)); },
    async addReintro(r) { check(await sb.from("reintroductions").upsert({ ...r, ...own })); },
    async deleteReintro(id) { check(await sb.from("reintroductions").delete().eq("id", id)); },
    async upsertRecipe(r) {
      const { created_at: _c, ...row } = r;
      check(await sb.from("recipes").upsert({ ...row, batch_left: row.batch_left ?? 0, ...own }));
    },
    async deleteRecipe(id) { check(await sb.from("recipes").delete().eq("id", id)); },
    async importAll(d) {
      if (d.config) await this.saveConfig(d.config);
      const map: [keyof AllData, string][] = [
        ["foods", "foods"], ["templates", "meal_templates"], ["meals", "meals_logged"], ["workouts", "workouts"],
        ["metrics", "body_metrics"], ["portions", "portions"], ["reintros", "reintroductions"], ["recipes", "recipes"],
      ];
      for (const [k, table] of map) {
        const rows = d[k] as Record<string, unknown>[] | undefined;
        if (!Array.isArray(rows) || !rows.length) continue;
        const clean = rows.map(({ created_at: _c, user_id: _u, ...r }) => ({ ...r, ...own }));
        for (let i = 0; i < clean.length; i += 500) {
          check(await sb.from(table).upsert(clean.slice(i, i + 500), k === "metrics" ? { onConflict: "user_id,local_date" } : undefined));
        }
      }
    },
  };
}

// Carga de datos de la usuaria desde Postgres para el coach y los nudges.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays, type BodyMetric, type CoachData, type CoachEvent, type Food, type LearnedPortion, localDate,
  type Meal, type MealTemplate, type Recipe, type Workout,
} from "../core/index.ts";

export async function loadFoods(db: SupabaseClient, userId: string): Promise<Food[]> {
  const { data, error } = await db.from("foods").select("*").eq("user_id", userId).limit(2000);
  if (error) throw error;
  return (data ?? []).map((r) => ({ ...r, portion_g: Number(r.portion_g), kcal: Number(r.kcal), p: Number(r.p), c: Number(r.c), f: Number(r.f) })) as Food[];
}

export async function loadPortions(db: SupabaseClient, userId: string): Promise<LearnedPortion[]> {
  const { data } = await db.from("portions").select("phrase, food_id, grams, count").eq("user_id", userId).order("count", { ascending: false }).limit(200);
  return (data ?? []).map((r) => ({ ...r, grams: Number(r.grams) })) as LearnedPortion[];
}

export async function loadCoachData(db: SupabaseClient, userId: string, tz: string): Promise<CoachData> {
  const today = localDate(new Date(), tz);
  const [meals, workouts, metrics, templates, events] = await Promise.all([
    db.from("meals_logged").select("*").eq("user_id", userId).gte("local_date", addDays(today, -60)).order("eaten_at"),
    db.from("workouts").select("*").eq("user_id", userId).gte("local_date", addDays(today, -180)).order("local_date"),
    db.from("body_metrics").select("*").eq("user_id", userId).gte("local_date", addDays(today, -400)).order("local_date"),
    db.from("meal_templates").select("*").eq("user_id", userId),
    db.from("coach_events").select("*").eq("user_id", userId).gte("local_date", addDays(today, -30)).order("created_at"),
  ]);
  for (const r of [meals, workouts, metrics, templates, events]) if (r.error) throw r.error;
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    meals: (meals.data ?? []) as Meal[],
    workouts: (workouts.data ?? []) as Workout[],
    metrics: (metrics.data ?? []).map((m) => ({ ...m, weight_kg: num(m.weight_kg), waist_cm: num(m.waist_cm), hip_cm: num(m.hip_cm), thigh_cm: num(m.thigh_cm), steps: num(m.steps) })) as BodyMetric[],
    templates: (templates.data ?? []) as MealTemplate[],
    events: (events.data ?? []) as CoachEvent[],
  };
}

export async function loadRecipes(db: SupabaseClient, userId: string): Promise<Recipe[]> {
  const { data } = await db.from("recipes").select("*").eq("user_id", userId).limit(500);
  return (data ?? []) as Recipe[];
}

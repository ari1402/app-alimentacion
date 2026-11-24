// Modo local: todo queda en el dispositivo (IndexedDB). Sin cuenta, sin servidor.
import { defaultConfig, localDate, mergeConfig, SEED_FOODS, SEED_TEMPLATES, type UserConfig } from "@core";
import { kvGet, kvSet } from "../idb";
import type { AllData, Repo } from "./types";

type Coll = Exclude<keyof AllData, "config">;
type Keyed = { id: string };

async function list<T>(c: Coll): Promise<T[]> {
  return (await kvGet<T[]>(c)) ?? [];
}

async function upsert<T extends Keyed>(c: Coll, item: T) {
  const l = await list<T>(c);
  const i = l.findIndex((x) => x.id === item.id);
  if (i >= 0) l[i] = item;
  else l.push(item);
  await kvSet(c, l);
}

async function remove(c: Coll, id: string) {
  const l = await list<Keyed>(c);
  await kvSet(c, l.filter((x) => x.id !== id));
}

export function localRepo(): Repo {
  return {
    mode: "local",
    async loadAll() {
      const today = localDate();
      let config = await kvGet<UserConfig>("config");
      if (!config) {
        config = defaultConfig(today);
        await kvSet("config", config);
        await kvSet("foods", SEED_FOODS);
        await kvSet("templates", SEED_TEMPLATES);
      }
      const [foods, templates, meals, workouts, metrics, events, portions, chat, reintros] = await Promise.all([
        list<AllData["foods"][number]>("foods"),
        list<AllData["templates"][number]>("templates"),
        list<AllData["meals"][number]>("meals"),
        list<AllData["workouts"][number]>("workouts"),
        list<AllData["metrics"][number]>("metrics"),
        list<AllData["events"][number]>("events"),
        list<AllData["portions"][number]>("portions"),
        list<AllData["chat"][number]>("chat"),
        list<AllData["reintros"][number]>("reintros"),
      ]);
      return { config: mergeConfig(config, today), foods, templates, meals, workouts, metrics, events, portions, chat, reintros };
    },
    saveConfig: (c) => kvSet("config", c),
    upsertFood: (f) => upsert("foods", f),
    deleteFood: (id) => remove("foods", id),
    upsertTemplate: (t) => upsert("templates", t),
    deleteTemplate: (id) => remove("templates", id),
    upsertMeal: (m) => upsert("meals", m),
    deleteMeal: (id) => remove("meals", id),
    upsertWorkout: (w) => upsert("workouts", w),
    deleteWorkout: (id) => remove("workouts", id),
    async upsertMetric(m) {
      const l = await list<typeof m>("metrics");
      const same = l.find((x) => x.local_date === m.local_date && x.id !== m.id);
      const merged = same ? { ...same, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v != null)), id: same.id } : m;
      await upsert("metrics", merged);
      return merged;
    },
    deleteMetric: (id) => remove("metrics", id),
    savePortions: (p) => kvSet("portions", p),
    async addEvent(e) {
      const l = await list<typeof e>("events");
      if (l.some((x) => x.dedupe_key === e.dedupe_key)) return;
      l.push(e);
      await kvSet("events", l.slice(-500));
    },
    async respondEvent(id, r) {
      const l = await list<AllData["events"][number]>("events");
      const e = l.find((x) => x.id === id);
      if (e && !e.response) {
        e.response = r;
        e.responded_at = new Date().toISOString();
        await kvSet("events", l);
      }
    },
    async addChat(m) {
      const l = await list<typeof m>("chat");
      l.push(m);
      await kvSet("chat", l.slice(-200));
    },
    clearChat: () => kvSet("chat", []),
    addReintro: (r) => upsert("reintros", r),
    deleteReintro: (id) => remove("reintros", id),
    async importAll(d) {
      if (d.config) await kvSet("config", d.config);
      for (const k of ["foods", "templates", "meals", "workouts", "metrics", "events", "portions", "chat", "reintros"] as Coll[]) {
        if (Array.isArray(d[k])) await kvSet(k, d[k]);
      }
    },
  };
}

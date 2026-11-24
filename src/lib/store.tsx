import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDayState, buildSnapshot, type BodyMetric, type ChatMessage, type CoachEvent, type EventResponse, type Food,
  learnPortions, localDate, type Meal, mealFeedback, type MealTemplate, type Recipe, type Reintroduction, type Snapshot, type UserConfig, type Workout,
} from "@core";
import type { AllData, Repo } from "./repo/types";

interface Actions {
  saveConfig(c: UserConfig): Promise<void>;
  logMeal(m: Meal): Promise<string>;
  deleteMeal(id: string): Promise<void>;
  saveWorkout(w: Workout): Promise<void>;
  deleteWorkout(id: string): Promise<void>;
  saveMetric(m: BodyMetric): Promise<void>;
  deleteMetric(id: string): Promise<void>;
  saveFood(f: Food): Promise<void>;
  deleteFood(id: string): Promise<void>;
  saveTemplate(t: MealTemplate): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  addChat(m: ChatMessage): Promise<void>;
  clearChat(): Promise<void>;
  saveReintro(r: Reintroduction): Promise<void>;
  deleteReintro(id: string): Promise<void>;
  saveRecipe(r: Recipe): Promise<void>;
  deleteRecipe(id: string): Promise<void>;
  respondEvent(id: string, r: EventResponse): Promise<void>;
  addEvent(e: CoachEvent): Promise<void>;
  importAll(d: Partial<AllData>): Promise<void>;
  reload(): Promise<void>;
}

interface StoreValue {
  repo: Repo;
  data: AllData;
  snap: Snapshot;
  now: Date;
  actions: Actions;
  toast(msg: string, kind?: "ok" | "error"): void;
}

const Ctx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore fuera de StoreProvider");
  return v;
}

function upsertBy<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i < 0) return [...list, item];
  const out = list.slice();
  out[i] = item;
  return out;
}

export function StoreProvider({ repo, initial, children }: { repo: Repo; initial: AllData; children: ReactNode }) {
  const [data, setData] = useState<AllData>(initial);
  const [now, setNow] = useState(() => new Date());
  const [toastMsg, setToast] = useState<{ msg: string; kind: "ok" | "error"; id: number } | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    const vis = () => document.visibilityState === "visible" && setNow(new Date());
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  const toast = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now();
    setToast({ msg, kind, id });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), kind === "error" ? 6000 : 4200);
  }, []);

  const snap = useMemo(
    () => buildSnapshot(data.config, { meals: data.meals, workouts: data.workouts, metrics: data.metrics, templates: data.templates, events: data.events }, now),
    [data, now],
  );

  const actions = useMemo<Actions>(() => {
    const wrap = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
      try {
        return await fn(...a);
      } catch (e) {
        toast((e as Error).message || "Algo falló", "error");
        throw e;
      }
    };
    return {
      saveConfig: wrap(async (c) => {
        setData((d) => ({ ...d, config: c }));
        await repo.saveConfig(c);
      }),
      logMeal: wrap(async (m) => {
        const d0 = dataRef.current;
        setData((d) => ({ ...d, meals: upsertBy(d.meals, m) }));
        await repo.upsertMeal(m);
        const portions = learnPortions(d0.portions, m.items);
        setData((d) => ({ ...d, portions }));
        repo.savePortions(portions).catch(() => {});
        // Si había un recordatorio de este momento, cuenta como respuesta "registró"
        const ev = d0.events.find((e) => e.local_date === m.local_date && e.kind === m.slot && !e.response);
        if (ev) {
          repo.respondEvent(ev.id, "logged").catch(() => {});
          setData((d) => ({ ...d, events: d.events.map((e) => (e.id === ev.id ? { ...e, response: "logged" } : e)) }));
        }
        const meals = upsertBy(d0.meals, m);
        const after = buildDayState(m.local_date, meals, d0.config, d0.workouts);
        const s = buildSnapshot(d0.config, { meals, workouts: d0.workouts, metrics: d0.metrics, templates: d0.templates, events: d0.events }, new Date());
        return mealFeedback(m, after, s);
      }),
      deleteMeal: wrap(async (id) => {
        setData((d) => ({ ...d, meals: d.meals.filter((x) => x.id !== id) }));
        await repo.deleteMeal(id);
      }),
      saveWorkout: wrap(async (w) => {
        setData((d) => ({ ...d, workouts: upsertBy(d.workouts, w).sort((a, b) => a.local_date.localeCompare(b.local_date)) }));
        await repo.upsertWorkout(w);
      }),
      deleteWorkout: wrap(async (id) => {
        setData((d) => ({ ...d, workouts: d.workouts.filter((x) => x.id !== id) }));
        await repo.deleteWorkout(id);
      }),
      saveMetric: wrap(async (m) => {
        const saved = await repo.upsertMetric(m);
        setData((d) => ({
          ...d,
          metrics: [...d.metrics.filter((x) => x.local_date !== saved.local_date), saved].sort((a, b) => a.local_date.localeCompare(b.local_date)),
        }));
      }),
      deleteMetric: wrap(async (id) => {
        setData((d) => ({ ...d, metrics: d.metrics.filter((x) => x.id !== id) }));
        await repo.deleteMetric(id);
      }),
      saveFood: wrap(async (f) => {
        setData((d) => ({ ...d, foods: upsertBy(d.foods, f) }));
        await repo.upsertFood(f);
      }),
      deleteFood: wrap(async (id) => {
        setData((d) => ({ ...d, foods: d.foods.filter((x) => x.id !== id) }));
        await repo.deleteFood(id);
      }),
      saveTemplate: wrap(async (t) => {
        setData((d) => ({ ...d, templates: upsertBy(d.templates, t) }));
        await repo.upsertTemplate(t);
      }),
      deleteTemplate: wrap(async (id) => {
        setData((d) => ({ ...d, templates: d.templates.filter((x) => x.id !== id) }));
        await repo.deleteTemplate(id);
      }),
      addChat: wrap(async (m) => {
        setData((d) => ({ ...d, chat: [...d.chat, m] }));
        await repo.addChat(m);
      }),
      clearChat: wrap(async () => {
        setData((d) => ({ ...d, chat: [] }));
        await repo.clearChat();
      }),
      saveReintro: wrap(async (r) => {
        setData((d) => ({ ...d, reintros: upsertBy(d.reintros, r) }));
        await repo.addReintro(r);
      }),
      deleteReintro: wrap(async (id) => {
        setData((d) => ({ ...d, reintros: d.reintros.filter((x) => x.id !== id) }));
        await repo.deleteReintro(id);
      }),
      saveRecipe: wrap(async (r) => {
        setData((d) => ({ ...d, recipes: upsertBy(d.recipes, r) }));
        await repo.upsertRecipe(r);
      }),
      deleteRecipe: wrap(async (id) => {
        setData((d) => ({ ...d, recipes: d.recipes.filter((x) => x.id !== id) }));
        await repo.deleteRecipe(id);
      }),
      respondEvent: async (id, r) => {
        setData((d) => ({ ...d, events: d.events.map((e) => (e.id === id && !e.response ? { ...e, response: r } : e)) }));
        await repo.respondEvent(id, r).catch(() => {});
      },
      addEvent: async (e) => {
        if (dataRef.current.events.some((x) => x.dedupe_key === e.dedupe_key)) return;
        setData((d) => ({ ...d, events: [...d.events, e] }));
        await repo.addEvent(e).catch(() => {});
      },
      importAll: wrap(async (d) => {
        await repo.importAll(d);
        setData(await repo.loadAll());
      }),
      reload: wrap(async () => setData(await repo.loadAll())),
    };
  }, [repo, toast]);

  const value = useMemo(() => ({ repo, data, snap, now, actions, toast }), [repo, data, snap, now, actions, toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && (
        <div className={`toast ${toastMsg.kind}`} role="status" onClick={() => setToast(null)}>
          {toastMsg.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function todayLocal(cfg: UserConfig): string {
  return localDate(new Date(), cfg.timezone);
}

import type {
  BodyMetric, ChatMessage, CoachEvent, EventResponse, Food, LearnedPortion, Meal, MealTemplate, Reintroduction, UserConfig, Workout,
} from "@core";

export interface AllData {
  config: UserConfig;
  foods: Food[];
  templates: MealTemplate[];
  meals: Meal[];
  workouts: Workout[];
  metrics: BodyMetric[];
  events: CoachEvent[];
  portions: LearnedPortion[];
  chat: ChatMessage[];
  reintros: Reintroduction[];
}

export interface Repo {
  mode: "local" | "cloud";
  loadAll(): Promise<AllData>;
  saveConfig(c: UserConfig): Promise<void>;
  upsertFood(f: Food): Promise<void>;
  deleteFood(id: string): Promise<void>;
  upsertTemplate(t: MealTemplate): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
  upsertMeal(m: Meal): Promise<void>;
  deleteMeal(id: string): Promise<void>;
  upsertWorkout(w: Workout): Promise<void>;
  deleteWorkout(id: string): Promise<void>;
  /** Une por fecha (un registro por día) y devuelve la fila resultante */
  upsertMetric(m: BodyMetric): Promise<BodyMetric>;
  deleteMetric(id: string): Promise<void>;
  savePortions(p: LearnedPortion[]): Promise<void>;
  addEvent(e: CoachEvent): Promise<void>;
  respondEvent(id: string, r: EventResponse): Promise<void>;
  addChat(m: ChatMessage): Promise<void>;
  clearChat(): Promise<void>;
  addReintro(r: Reintroduction): Promise<void>;
  deleteReintro(id: string): Promise<void>;
  importAll(d: Partial<AllData>): Promise<void>;
}

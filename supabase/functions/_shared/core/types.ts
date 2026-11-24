// Tipos del dominio. Este módulo es TypeScript puro (sin dependencias) para que
// lo usen tanto el frontend (Vite) como las Edge Functions (Deno).

export interface Macros {
  kcal: number;
  p: number; // proteína (g)
  c: number; // carbohidratos (g)
  f: number; // grasas (g)
}

export type Slot = "desayuno" | "almuerzo" | "merienda" | "cena" | "snack";
export const SLOTS: Slot[] = ["desayuno", "almuerzo", "merienda", "cena", "snack"];
export const MAIN_SLOTS: Exclude<Slot, "snack">[] = ["desayuno", "almuerzo", "merienda", "cena"];

export interface Food extends Macros {
  id: string;
  name: string;
  aliases?: string[];
  /** Texto de la porción de referencia, ej "1 unidad (50 g)" */
  portion_label: string;
  /** Gramos (o ml) de la porción de referencia. Los macros son por esta porción. */
  portion_g: number;
  category?: string;
  favorite?: boolean;
}

export interface MealItem extends Macros {
  food_id?: string | null;
  name: string;
  grams: number;
  /** Frase original de la usuaria para este ítem ("un panqueque"), sirve para aprender porciones */
  phrase?: string | null;
  /** true si el ítem no estaba en la tabla y la IA estimó los macros */
  estimated?: boolean;
}

export type MealSource = "ai" | "photo" | "list" | "template" | "repeat" | "quick";

export interface Meal {
  id: string;
  local_date: string; // YYYY-MM-DD en la zona horaria de la usuaria
  slot: Slot;
  eaten_at: string; // ISO
  raw_text?: string | null;
  items: MealItem[];
  totals: Macros;
  source: MealSource;
  confirmed: boolean;
  created_at?: string;
}

export interface MealTemplate {
  id: string;
  code: string; // A1..A15, C1..C10, D1...
  slot: Exclude<Slot, "snack">;
  name: string;
  description?: string;
  items: MealItem[];
  totals: Macros;
}

export type RecipeTag = "alta proteína" | "baja en carbos" | "rápida" | "meal prep" | "portable" | "sin horno" | "dulce" | "reintroducción";

export interface Recipe {
  id: string;
  name: string;
  /** Momentos en los que encaja */
  slots: Exclude<Slot, "snack">[];
  /** Porciones que rinde la receta completa */
  servings: number;
  prep_min: number;
  /** Ingredientes de la receta COMPLETA (gramos totales) */
  ingredients: MealItem[];
  steps: string[];
  tips?: string | null;
  tags: RecipeTag[];
  /** Macros de la receta completa */
  totals: Macros;
  favorite?: boolean;
  source: "base" | "ia" | "manual";
  /** Meal prep: porciones cocinadas que quedan en la heladera */
  batch_left?: number;
  batch_cooked_at?: string | null;
  created_at?: string;
}

export interface WorkoutSet {
  reps: number;
  kg: number;
}
export interface WorkoutExercise {
  name: string;
  sets: WorkoutSet[];
}
export type WorkoutType = "fuerza" | "cardio" | "otro";

export type CardioModality =
  | "caminata" | "caminata_inclinada" | "bici" | "eliptico" | "correr" | "natacion"
  | "remo" | "escaladora" | "hiit" | "baile" | "otro";
export type CardioIntensity = "suave" | "moderada" | "intensa";

export interface CardioSession {
  modality: CardioModality;
  minutes: number;
  intensity: CardioIntensity;
  /** Frecuencia cardíaca promedio (opcional, mejora la estimación) */
  avg_hr?: number | null;
  /** kcal que marcó el reloj/máquina (opcional; se corrige por sobreestimación) */
  device_kcal?: number | null;
  /** kcal netas estimadas (por encima del reposo), calculadas al registrar */
  net_kcal: number;
  method: string;
}

export interface Workout {
  id: string;
  local_date: string;
  type: WorkoutType;
  exercises: WorkoutExercise[];
  cardio?: CardioSession | null;
  duration_min?: number | null;
  notes?: string | null;
  created_at?: string;
}

export interface BodyMetric {
  id: string;
  local_date: string;
  weight_kg?: number | null;
  waist_cm?: number | null;
  hip_cm?: number | null;
  thigh_cm?: number | null;
  /** Pasos del día (NEAT) */
  steps?: number | null;
  note?: string | null;
}

export type NudgeKind =
  | "manana"
  | "desayuno"
  | "almuerzo"
  | "merienda"
  | "cena"
  | "pre_entreno"
  | "post_entreno"
  | "tarde"
  | "noche"
  | "semanal"
  | "medidas"
  | "guardia";

export type EventResponse = "opened" | "logged" | "dismissed" | "snoozed";

export interface CoachEvent {
  id: string;
  created_at: string;
  local_date: string;
  kind: NudgeKind | "chat" | "analysis";
  dedupe_key: string;
  channel: "push" | "inapp";
  title: string;
  body: string;
  url?: string | null;
  response?: EventResponse | null;
  responded_at?: string | null;
}

export interface LearnedPortion {
  phrase: string; // normalizada
  food_id?: string | null;
  grams: number;
  count: number;
}

export interface Reintroduction {
  id: string;
  local_date: string;
  food: string;
  amount?: string | null;
  /** 1 = mal, 5 = muy bien */
  rating: number;
  note?: string | null;
}

export interface ChatMessage {
  id: string;
  created_at: string;
  role: "user" | "assistant";
  content: string;
}

export type ReminderKey =
  | "manana"
  | "desayuno"
  | "almuerzo"
  | "merienda"
  | "cena"
  | "tarde"
  | "noche"
  | "semanal";

export interface UserConfig {
  name: string;
  timezone: string;
  targets: Macros;
  ranges: {
    kcal: [number, number];
    pMin: number;
    c: [number, number];
    f: [number, number];
  };
  meals_per_day: number;
  /** Si una comida supera estos g de carbos, la siguiente va baja en carbos */
  carb_rule_threshold: number;
  /** Horarios HH:MM. null = desactivado */
  reminders: Record<ReminderKey, string | null>;
  /** Día de la semana del cierre semanal (0 = domingo) */
  weekly_review_day: number;
  workout: {
    days: number[]; // 0=domingo ... 6=sábado
    time: string; // HH:MM
    weekly_min: number;
    weekly_max: number;
    /** Fecha en que retomó; las primeras semanas el objetivo es progresivo */
    restart_date?: string | null;
  };
  goal: {
    start_kg: number;
    start_date: string;
    target_min: number;
    target_max: number;
  };
  profile: {
    sex: "f" | "m";
    height_cm?: number | null;
    age?: number | null;
  };
  /** El "por qué" en sus palabras */
  why: string;
  /** Modo guardia activo hasta (ISO). Silencia recordatorios de rutina. */
  guardia_until?: string | null;
  quiet_hours: { start: string; end: string };
  ai_daily_limit: number;
  notifications: {
    enabled: boolean;
    kinds: Partial<Record<NudgeKind, boolean>>;
  };
  /** Modo simple: muestra solo kcal y proteína, menos números */
  simple_mode: boolean;
  /** v3: alimentos que está reintroduciendo */
  reintroductions: string[];
  /** Cada cuántos días pedir medidas */
  measure_every_days: number;
  /** Ajuste del objetivo por cardio */
  cardio: {
    /** Fracción de las kcal netas del cardio que se suman al objetivo del día (0–1). 0.5 por defecto. */
    eatback: number;
    /** Tope de kcal que puede sumar el cardio en un día */
    max_bonus: number;
  };
  /** Revisión semanal del objetivo (adaptativa) */
  auto_adjust: {
    enabled: boolean;
    /** Ritmo buscado, % del peso por semana */
    target_rate_pct: number;
  };
  /** Historial de cambios de objetivo (para no ajustar antes de 2 semanas) */
  target_history: { date: string; kcal: number; reason: string }[];
  /** Pausa de mantenimiento (diet break) */
  diet_break?: { from: string; until: string; kcal: number } | null;
  /** Ciclo menstrual (opcional): explica variaciones de agua en la balanza */
  cycle: { enabled: boolean; last_start?: string | null; length: number };
  /** Pasos diarios objetivo (NEAT) */
  steps_goal: number;
}

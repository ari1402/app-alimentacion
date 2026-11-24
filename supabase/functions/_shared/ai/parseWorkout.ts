// Registro de entrenos por lenguaje natural (o foto de la libreta / pizarra / reloj):
// "prensa 4x10 con 200, sentadilla 3x8 con 80 y 30 min de cinta inclinada"
// → ejercicios con series × reps × kg + cardio. Ari revisa antes de guardar.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { CardioIntensity, CardioModality, WorkoutExercise } from "../core/types.ts";
import { normalizeExercise } from "../core/workouts.ts";
import { AIError, type AIUsage, DEFAULT_MODEL_PARSE } from "./models.ts";

export interface ParseWorkoutInput {
  text?: string | null;
  image?: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string } | null;
  /** Nombres de ejercicios que ya usa (para nombrarlos igual y ver la progresión) */
  known: string[];
  /** Últimas series por ejercicio: "Sentadilla: 3×8×80" (para "lo mismo que la vez pasada") */
  last: string[];
  model?: string;
}

export interface ParsedCardio {
  modality: CardioModality;
  minutes: number;
  intensity: CardioIntensity;
  avg_hr: number | null;
  device_kcal: number | null;
}

export interface ParseWorkoutOutput {
  exercises: WorkoutExercise[];
  cardio: ParsedCardio[];
  duration_min: number | null;
  day_offset: number;
  notes: string | null;
  assumptions: string[];
  usage: AIUsage;
}

const MODALITIES = ["caminata", "caminata_inclinada", "bici", "eliptico", "correr", "natacion", "remo", "escaladora", "hiit", "baile", "otro"] as const;

const Schema = z.object({
  exercises: z.array(z.object({
    name: z.string().describe("Nombre del ejercicio; si coincide con uno conocido, usá EXACTAMENTE ese nombre"),
    sets: z.array(z.object({ reps: z.number(), kg: z.number() })),
  })),
  cardio: z.array(z.object({
    modality: z.enum(MODALITIES),
    minutes: z.number(),
    intensity: z.enum(["suave", "moderada", "intensa"]),
    avg_hr: z.number().nullable(),
    device_kcal: z.number().nullable(),
  })),
  duration_min: z.number().nullable().describe("Duración total de la sesión si la menciona"),
  day_offset: z.number().describe("0 = hoy, -1 = ayer, -2 = anteayer"),
  notes: z.string().nullable().describe("Sensaciones, dolor, RPE u otros comentarios que mencione"),
  assumptions: z.array(z.string()).describe("Supuestos que hiciste (ej. 'tomé 20 kg de barra'). Vacío si no hubo."),
});

const RULES = `Sos el módulo de registro de entrenamientos de una app de fitness (Argentina, español rioplatense).
Convertí lo que la usuaria cuenta en ejercicios con series (reps × kg) y sesiones de cardio.

Reglas:
- Expandí la notación: "4x10 con 200" = 4 series de 10 reps con 200 kg. "3x8 80kg" igual. "12/10/8 con 60/65/70" = 3 series distintas. "3 series de 12" sin peso = kg 0.
- "Subí a 85 en la última" → solo la última serie con 85. "Lo mismo que la vez pasada" → copiá las ÚLTIMAS SERIES de ese ejercicio.
- Peso corporal (dominadas, fondos, plancha, abdominales) → kg 0. Plancha: reps = segundos.
- "X por lado" con barra libre → kg total = 2·X + 20 (barra olímpica) y anotalo en assumptions. En prensa o máquinas con discos, "por lado" → 2·X (sin sumar el carro) y anotalo.
- Si el ejercicio coincide con uno de los EJERCICIOS CONOCIDOS (aunque lo escriba distinto: "jalón", "espalda en polea", "hip"), usá exactamente ese nombre. Si no, usá un nombre claro en español.
- Cardio: elegí la modalidad más cercana. Intensidad: suave si dice tranqui/suave/charlando; intensa si dice fuerte/a full/sprints/HIIT; si no, moderada. Cinta con inclinación = caminata_inclinada. Spinning/bici fija = bici.
- No inventes series que no dijo. Si algo es ambiguo, hacé el supuesto más razonable y anotalo en assumptions.
- No juzgues ni comentes el entrenamiento. Solo datos.`;

export async function parseWorkout(client: Anthropic, input: ParseWorkoutInput): Promise<ParseWorkoutOutput> {
  if (!input.text?.trim() && !input.image) throw new AIError("Contá qué entrenaste o subí una foto.", "invalid");
  const content: Anthropic.ContentBlockParam[] = [];
  if (input.image) {
    content.push({ type: "image", source: { type: "base64", media_type: input.image.media_type, data: input.image.data } });
    content.push({ type: "text", text: "Foto de mi entrenamiento (libreta, pizarra, app o reloj). Extraé ejercicios, series, reps, kg y cardio." });
  }
  if (input.text?.trim()) content.push({ type: "text", text: `Entrené: ${input.text.trim()}` });

  const response = await client.messages.parse({
    model: input.model ?? DEFAULT_MODEL_PARSE,
    max_tokens: 4000,
    output_config: { effort: "low", format: zodOutputFormat(Schema) },
    system: [
      { type: "text", text: RULES },
      { type: "text", text: `EJERCICIOS CONOCIDOS:\n${input.known.join("\n") || "(ninguno)"}\n\nÚLTIMAS SERIES:\n${input.last.join("\n") || "(sin historial)"}` },
    ],
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new AIError("No pude interpretar eso. Cargalo a mano.", "refusal");
  const out = response.parsed_output;
  if (!out) throw new AIError("La respuesta no fue válida. Probá de nuevo o cargalo a mano.", "invalid");

  // Nombres: unificar con los conocidos (para que la progresión no se parta en dos ejercicios)
  const known = new Map(input.known.map((n) => [normalizeExercise(n), n]));
  const clean = (n: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n * 2) / 2)) : 0);
  const exercises: WorkoutExercise[] = out.exercises
    .map((e) => ({
      name: known.get(normalizeExercise(e.name)) ?? e.name.trim(),
      sets: e.sets.map((s) => ({ reps: Math.round(clean(s.reps, 500)), kg: clean(s.kg, 1000) })).filter((s) => s.reps > 0),
    }))
    .filter((e) => e.name && e.sets.length);
  const cardio: ParsedCardio[] = out.cardio
    .filter((c) => c.minutes > 0)
    .map((c) => ({ ...c, minutes: Math.round(Math.min(600, c.minutes)), avg_hr: c.avg_hr && c.avg_hr > 40 && c.avg_hr < 220 ? Math.round(c.avg_hr) : null, device_kcal: c.device_kcal && c.device_kcal > 0 ? Math.round(c.device_kcal) : null }));

  return {
    exercises,
    cardio,
    duration_min: out.duration_min && out.duration_min > 0 ? Math.round(out.duration_min) : null,
    day_offset: Math.max(-7, Math.min(0, Math.round(out.day_offset || 0))),
    notes: out.notes,
    assumptions: out.assumptions,
    usage: {
      model: response.model,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

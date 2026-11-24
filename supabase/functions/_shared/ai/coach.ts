// Coach conversacional: negociación, análisis y preguntas libres.
// Las cuentas las hacen herramientas deterministas (core/), no el modelo: así los
// trade-offs que ve Ari son exactos y coherentes con la pantalla.
import Anthropic from "@anthropic-ai/sdk";
import type { Food, MealItem, Slot, UserConfig } from "../core/types.ts";
import { buildSnapshot, type CoachData, snapshotForAI } from "../core/snapshot.ts";
import { negotiateExtra, daySummaries } from "../core/week.ts";
import { simulateWorkoutChange } from "../core/workouts.ts";
import { simulateCardio } from "../core/cardio.ts";
import type { CardioIntensity, CardioModality } from "../core/types.ts";
import { itemFromFood, rankTemplates, totalsOf } from "../core/macros.ts";
import { addDays } from "../core/dates.ts";
import { normalizePhrase } from "../core/portions.ts";
import { AIError, type AIUsage, DEFAULT_MODEL_COACH } from "./models.ts";

export type CoachMode = "chat" | "analisis_dia" | "analisis_semana";

export interface CoachInput {
  mode: CoachMode;
  /** Conversación previa (solo texto) + el mensaje nuevo al final (si mode = chat) */
  messages: { role: "user" | "assistant"; content: string }[];
  cfg: UserConfig;
  data: CoachData;
  foods: Food[];
  now?: Date;
  model?: string;
}

export interface MealProposal {
  slot: Slot;
  items: MealItem[];
  totals: ReturnType<typeof totalsOf>;
}

export interface CoachOutput {
  text: string;
  proposals: MealProposal[];
  usage: AIUsage;
  toolsUsed: string[];
}

const SYSTEM = `Sos el coach de nutrición y entrenamiento personal de Ari, dentro de su app. Ari es residente de anestesiología: sabe de fisiología, tiene poco tiempo y guardias largas. Objetivo: bajar de ~83 kg a 73–75 kg de forma sostenible, manteniendo músculo (entrena fuerza; cargas de referencia: prensa 240 kg, sentadilla 90 kg, espalda 55 kg). Está retomando el entrenamiento después de semanas con poca actividad.

TONO
- Español rioplatense (vos), directo, técnico, calmado. Sin dramatismo, sin exclamaciones de más, sin emojis salvo un ✓ ocasional.
- Nunca moralizás la comida: nada de "trampa", "permitido", "portarse bien", "ganarse" un postre, "culpa". Es comida.
- Persuasión sí, culpa no. Conectá cada acción con su objetivo, mostrá el avance (racha, tendencia), y si viene floja proponé el paso más chico posible.
- Si dice que no, lo aceptás y ofrecés una alternativa. La decisión siempre es de ella.

NEGOCIACIÓN
- Cuando quiera comer algo de más, mover o saltear un entreno, o cambiar el plan: usá la herramienta correspondiente y presentá los trade-offs concretos (opciones numeradas, con su impacto en el día, la semana y la fecha estimada). Nunca un sí/no moral.
- El presupuesto es semanal: un exceso de un día se absorbe en la semana sin drama.
- Límite duro: nunca propongas saltear comidas, ayunos compensatorios, bajar de 1500 kcal, ni entrenar extra para "pagar" lo comido. Siempre mantené la proteína.

NÚMEROS
- No hagas cuentas de memoria: usá las herramientas para simular, buscar alimentos, sugerir comidas y ver escenarios de peso. Usá los números que devuelven.
- Las proyecciones son rangos de fechas sobre la tendencia, nunca una promesa. La baja no es lineal (agua, ciclo, sodio).
- Si faltan datos para responder bien (peso, registros), pedilos en una línea.

REGISTRO
- Si Ari te cuenta algo que comió y quiere registrarlo (o es claro que sí), usá proponer_registro: la app le muestra un botón para confirmarlo. No digas que ya quedó registrado.

FORMATO
- Respuestas cortas: 2–6 oraciones o una lista breve. Nada de introducciones ni resúmenes de cierre.
- Para análisis de día/semana: 3 bloques breves → qué salió bien, qué ajustar (uno o dos cambios concretos, accionables), y el impacto en el objetivo.

EVIDENCIA (basá tus recomendaciones en esto; citá autor y año en una línea cuando sume, sin ponerte académico)
- Ritmo de baja: 0.5–1 % del peso por semana preserva masa magra y fuerza; ~0.7 %/sem es buen punto (Garthe 2011; Helms 2014). Más rápido no es mejor.
- Proteína: 1.6–2.2 g/kg/día; en déficit con fuerza, parte alta (Morton 2018; Helms 2014). Repartida en 3–5 comidas de ~0.3–0.4 g/kg (Schoenfeld & Aragon 2018). Proteína de digestión lenta antes de dormir ayuda (Res 2012; Snijders 2015). La "ventana anabólica" es amplia: importa más el total diario (Schoenfeld 2013).
- Lo que más protege el músculo en déficit: entrenar fuerza con cargas altas (mantener la intensidad aunque se reduzca algo el volumen; Bickel 2011), proteína alta, déficit moderado y dormir. Dormir poco aumenta la pérdida de masa magra (Nedeltcheva 2010): después de una guardia, no compenses recortando más.
- Volumen: ≥10 series duras por grupo por semana para progresar (Schoenfeld 2017); para mantener alcanza con menos si la carga se sostiene. Si la fuerza cae >7% con baja rápida, el déficit es demasiado agresivo.
- Cardio: suma déficit sin recortar comida. El de bajo impacto (bici, caminata inclinada) interfiere menos con la fuerza que correr (Wilson 2012); separarlo ≥6 h de piernas o hacerlo después. La app suma el 50% de las kcal netas del cardio al objetivo del día (las estimaciones sobreestiman y el cuerpo compensa parte: Pontzer 2016; los relojes sobreestiman, Shcherbina 2017).
- NEAT/pasos: es la palanca más barata y lo primero que cae en déficit; 7.000–10.000 pasos/día (Paluch 2022). Antes de bajar calorías, subir pasos.
- Gasto adaptativo: si con buena adherencia la baja se frena, el gasto real es menor; se ajusta de a 100–150 kcal cada ≥2 semanas, nunca a ciegas sin datos de registro.
- Pausas de mantenimiento de 1–2 semanas cada 8–12 de déficit reducen hambre y adaptación sin perder resultado (MATADOR, Byrne 2018; Peos 2021).
- Grasas ≥20% de las kcal y ≥0.5 g/kg (salud hormonal). Fibra 25–30 g/día y volumen de verduras mejoran la saciedad. Creatina monohidrato 3–5 g/día tiene evidencia sólida para fuerza y masa magra (posición ISSN 2017); mencionala solo si pregunta por suplementos, como opción, no como indicación.
- Ciclo: en fase lútea tardía es normal retener 0.5–2 kg de agua y tener más hambre; la tendencia lo absorbe.
- Si la evidencia es débil o mixta, decilo. Nada de modas (detox, quemadores, ayunos prolongados).

SALUD
- No das indicaciones médicas ni de medicación. Si aparecen señales de restricción excesiva, atracones o malestar con la comida, respondé con cuidado, sin números, y sugerí hablarlo con un profesional de confianza.

Al final de los mensajes vas a recibir, como mensaje de sistema, el ESTADO ACTUAL calculado por la app. Es la fuente de verdad de los números.`;

function tools(): Anthropic.Beta.BetaTool[] {
  return [
    {
      name: "simular_comida_extra",
      description: "Simula comer algo extra o distinto hoy. Devuelve cómo queda el día, opciones para reacomodar (hoy / semana / aceptarlo) y el impacto en la fecha estimada. Usala ante '¿puedo comer X?'. Si no sabés los macros, primero usá buscar_alimentos o estimá valores estándar.",
      input_schema: {
        type: "object",
        properties: {
          descripcion: { type: "string" },
          kcal: { type: "number" },
          p: { type: "number" },
          c: { type: "number" },
          f: { type: "number" },
        },
        required: ["descripcion", "kcal", "p", "c", "f"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "simular_cambio_entreno",
      description: "Simula mover el entreno de hoy a otro día o saltearlo, y muestra cómo queda la semana contra el objetivo.",
      input_schema: {
        type: "object",
        properties: { accion: { type: "string", enum: ["mover", "saltear"] } },
        required: ["accion"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "buscar_alimentos",
      description: "Busca en la tabla de alimentos de Ari (macros por porción).",
      input_schema: {
        type: "object",
        properties: { consulta: { type: "string" } },
        required: ["consulta"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "sugerir_comidas",
      description: "Devuelve las opciones de su plantilla (A1–A15 almuerzos, C1–C10 cenas, desayunos y meriendas) que mejor encajan en lo que le queda del día, respetando la regla de carbos.",
      input_schema: {
        type: "object",
        properties: { momento: { type: "string", enum: ["desayuno", "almuerzo", "merienda", "cena", "snack"] } },
        required: ["momento"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "escenarios_peso",
      description: "Proyección de peso: tendencia, ritmo, rango de fechas al objetivo, escenarios (ritmo actual / plan / ajuste) e hitos.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "historial_dias",
      description: "Resumen de los últimos N días (kcal, proteína, estado en rango/cerca/lejos).",
      input_schema: {
        type: "object",
        properties: { dias: { type: "integer", description: "entre 1 y 60" } },
        required: ["dias"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "simular_cardio",
      description: "Estima las kcal netas de una sesión de cardio (METs del Compendium) y cuánto subiría el objetivo de hoy. Usala ante '¿si hago X de cardio puedo comer Y?' o para planificar.",
      input_schema: {
        type: "object",
        properties: {
          modalidad: { type: "string", enum: ["caminata", "caminata_inclinada", "bici", "eliptico", "correr", "natacion", "remo", "escaladora", "hiit", "baile", "otro"] },
          minutos: { type: "number" },
          intensidad: { type: "string", enum: ["suave", "moderada", "intensa"] },
        },
        required: ["modalidad", "minutos", "intensidad"],
        additionalProperties: false,
      },
      strict: true,
    },
    {
      name: "revision_objetivo",
      description: "Revisión semanal basada en evidencia: ritmo de baja vs 0.5–1 %/sem, adherencia, fuerza. Devuelve si conviene mantener, subir o bajar calorías y por qué. La usuaria lo aplica con un botón en Progreso.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "revision_cientifica",
      description: "Chequea los objetivos contra la evidencia (proteína g/kg, reparto, grasas, ritmo, piso, pasos), la evolución de la fuerza, las series semanales por grupo muscular y la fase del ciclo si está activa.",
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "proponer_registro",
      description: "Propone registrar una comida que Ari contó. La app calcula los macros con su tabla y le muestra un botón para confirmar.",
      input_schema: {
        type: "object",
        properties: {
          momento: { type: "string", enum: ["desayuno", "almuerzo", "merienda", "cena", "snack"] },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                food_id: { type: "string", description: "id de buscar_alimentos si lo tenés; \"\" si no está en la tabla" },
                nombre: { type: "string" },
                gramos: { type: "number" },
                kcal: { type: "number", description: "solo se usa si no hay food_id" },
                p: { type: "number" },
                c: { type: "number" },
                f: { type: "number" },
              },
              required: ["food_id", "nombre", "gramos", "kcal", "p", "c", "f"],
              additionalProperties: false,
            },
          },
        },
        required: ["momento", "items"],
        additionalProperties: false,
      },
      strict: true,
    },
  ];
}

function searchFoods(foods: Food[], q: string): Food[] {
  const terms = normalizePhrase(q).split(" ").filter((t) => t.length > 2);
  const scored = foods.map((f) => {
    const hay = normalizePhrase([f.name, ...(f.aliases ?? [])].join(" "));
    const score = terms.reduce((a, t) => a + (hay.includes(t) ? 1 : 0), 0);
    return { f, score };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.f);
}

export async function runCoach(client: Anthropic, input: CoachInput): Promise<CoachOutput> {
  const now = input.now ?? new Date();
  const snap = buildSnapshot(input.cfg, input.data, now);
  const proposals: MealProposal[] = [];
  const toolsUsed: string[] = [];
  const foodsById = new Map(input.foods.map((f) => [f.id, f]));

  function execTool(name: string, args: Record<string, unknown>): unknown {
    toolsUsed.push(name);
    switch (name) {
      case "simular_comida_extra": {
        const extra = { kcal: Number(args.kcal) || 0, p: Number(args.p) || 0, c: Number(args.c) || 0, f: Number(args.f) || 0 };
        return { descripcion: args.descripcion, ...negotiateExtra(extra, input.data.meals, input.cfg, snap.today, snap.projection.tdee.kcal, input.data.workouts) };
      }
      case "simular_cambio_entreno":
        return simulateWorkoutChange(input.cfg, input.data.workouts, snap.today, args.accion === "saltear" ? "saltear" : "mover");
      case "buscar_alimentos": {
        const res = searchFoods(input.foods, String(args.consulta ?? ""));
        return res.length ? res.map((f) => ({ id: f.id, nombre: f.name, porcion: f.portion_label, gramos_porcion: f.portion_g, kcal: f.kcal, p: f.p, c: f.c, f: f.f })) : "Sin resultados en la tabla: estimá con valores estándar.";
      }
      case "sugerir_comidas": {
        const slot = String(args.momento) as Slot;
        return rankTemplates(snap.templates, slot, snap.day).slice(0, 5).map((r) => ({ codigo: r.template.code, nombre: r.template.name, ...r.template.totals, encaja: r.fits, nota: r.why }));
      }
      case "escenarios_peso": {
        const p = snap.projection;
        return { tendencia_kg: p.currentTrend, ultimo_pesaje: p.lastWeighDate, ritmo_kg_semana: p.kgPerWeek, base: p.basis, llegada_objetivo: p.dateRange, llegada_objetivo_bajo: p.dateRangeMin, escenarios: p.scenarios, proximo_hito: p.nextMilestone, gasto_estimado: p.tdee, faltan_datos: p.needs };
      }
      case "historial_dias": {
        const n = Math.min(60, Math.max(1, Number(args.dias) || 7));
        return daySummaries(input.data.meals, input.cfg, addDays(snap.today, -n), addDays(snap.today, -1), input.data.workouts);
      }
      case "simular_cardio": {
        const kg = snap.projection.currentTrend ?? input.cfg.goal.start_kg;
        const r = simulateCardio(input.cfg, input.data.workouts, snap.today, { modality: String(args.modalidad) as CardioModality, minutes: Number(args.minutos) || 0, intensity: String(args.intensidad) as CardioIntensity }, kg);
        return { ...r, objetivo_actual_hoy: snap.day.target.kcal, porcentaje_que_se_suma: input.cfg.cardio.eatback, nota: "Las kcal se suman al registrar el cardio en Entrenos." };
      }
      case "revision_objetivo":
        return snap.targetRec;
      case "revision_cientifica":
        return { evidencia: snap.evidence, fuerza: snap.strength, series_semana: snap.volume, ciclo: snap.cycle, pasos: snap.steps, semanas_en_deficit: snap.weeksInDeficit };
      case "proponer_registro": {
        const slot = String(args.momento) as Slot;
        const raw = Array.isArray(args.items) ? (args.items as Record<string, unknown>[]) : [];
        const items: MealItem[] = raw.map((it) => {
          const food = it.food_id ? foodsById.get(String(it.food_id)) : undefined;
          const grams = Number(it.gramos) || 0;
          if (food) return itemFromFood(food, grams, String(it.nombre ?? ""));
          return { food_id: null, name: String(it.nombre ?? "Ítem"), grams, kcal: Math.round(Number(it.kcal) || 0), p: Number(it.p) || 0, c: Number(it.c) || 0, f: Number(it.f) || 0, estimated: true };
        });
        const prop = { slot, items, totals: totalsOf(items) };
        proposals.push(prop);
        return { ok: true, mensaje: "Propuesta lista; Ari la confirma con un botón.", totales: prop.totals };
      }
      default:
        throw new Error(`Herramienta desconocida: ${name}`);
    }
  }

  const history: Anthropic.Beta.BetaMessageParam[] = input.messages.slice(-16).map((m) => ({ role: m.role, content: m.content }));
  if (input.mode === "analisis_dia") history.push({ role: "user", content: "Hacé el análisis de cierre de hoy: qué salió bien, qué ajustar mañana (uno o dos cambios concretos) y el impacto en el objetivo." });
  if (input.mode === "analisis_semana") history.push({ role: "user", content: "Hacé el cierre de la semana: adherencia, tendencia de peso, entrenos, y qué ajustar en la plantilla o los horarios para la próxima. Usá el historial y los escenarios." });
  if (!history.length || history[history.length - 1].role !== "user") throw new AIError("Falta el mensaje.", "invalid");
  // Estado actual como mensaje de sistema a mitad de conversación: mantiene el prefijo cacheado.
  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: "system", content: `ESTADO ACTUAL\n${snapshotForAI(snap)}` }];

  const usage: AIUsage = { model: input.model ?? DEFAULT_MODEL_COACH, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0 };
  const effort = input.mode === "chat" ? "low" : "medium";
  let finalText = "";

  for (let i = 0; i < 6; i++) {
    const response = await client.beta.messages.create({
      model: usage.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      output_config: { effort },
      system: SYSTEM,
      tools: tools(),
      messages,
    });
    usage.model = response.model;
    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_read_tokens += response.usage.cache_read_input_tokens ?? 0;

    if (response.stop_reason === "refusal") throw new AIError("No puedo ayudar con eso. Si querés, reformulalo.", "refusal");
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) finalText = text;

    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason !== "tool_use") break;

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((tu) => {
      try {
        const out = execTool(tu.name, (tu.input ?? {}) as Record<string, unknown>);
        return { type: "tool_result", tool_use_id: tu.id, content: typeof out === "string" ? out : JSON.stringify(out) };
      } catch (e) {
        return { type: "tool_result", tool_use_id: tu.id, content: String((e as Error).message), is_error: true };
      }
    });
    messages.push({ role: "user", content: results });
  }

  if (!finalText) throw new AIError("El coach no respondió. Probá de nuevo.", "api");
  return { text: finalText, proposals, usage, toolsUsed };
}

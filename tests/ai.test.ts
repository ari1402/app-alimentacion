import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { parseMeal } from "../supabase/functions/_shared/ai/parseMeal.ts";
import { runCoach } from "../supabase/functions/_shared/ai/coach.ts";
import { defaultConfig, SEED_FOODS, SEED_TEMPLATES } from "@core";

function msg(content: unknown[], stop_reason: string, model = "claude-haiku-5-5") {
  return {
    id: "msg_1", type: "message", role: "assistant", model, content, stop_reason, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function mockClient(responses: unknown[], bodies: any[]) {
  let i = 0;
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(responses[i++]), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
  };
  return new Anthropic({ apiKey: "test-key-not-real", fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
}

describe("parseMeal", () => {
  it("usa los macros de la tabla cuando hay match y corrige estimaciones incoherentes", async () => {
    const bodies: any[] = [];
    const out = {
      items: [
        { phrase: "medio panqueque proteico", food_id: "panqueque-proteico", name: "Panqueque", grams: 50, kcal: 999, p: 0, c: 0, f: 0, estimated: false },
        { phrase: "un mantecol", food_id: null, name: "Mantecol", grams: 25, kcal: 500, p: 3, c: 12, f: 8, estimated: true },
      ],
      slot: "desayuno",
      clarification: null,
    };
    const client = mockClient([msg([{ type: "text", text: JSON.stringify(out) }], "end_turn")], bodies);
    const r = await parseMeal(client, { text: "medio panqueque proteico y un mantecol", foods: SEED_FOODS, portions: [{ phrase: "un panqueque", grams: 100, count: 3, food_id: "panqueque-proteico" }] });
    expect(r.items[0].kcal).toBe(90); // tabla: 180 kcal / 100 g → 50 g
    expect(r.items[1].kcal).toBe(132); // 3*4 + 12*4 + 8*9 = 132 (el modelo dijo 500)
    expect(r.slot).toBe("desayuno");
    const b = bodies[0];
    expect(b.model).toBe("claude-haiku-5-5");
    expect(b.output_config.format.type).toBe("json_schema");
    expect(b.system[1].text).toContain("panqueque-proteico");
    expect(b.system[2].text).toContain('"un panqueque" = 100 g');
  });
});

describe("coach", () => {
  it("ejecuta herramientas deterministas y devuelve propuestas de registro", async () => {
    const bodies: any[] = [];
    const client = mockClient([
      msg([
        { type: "tool_use", id: "tu_1", name: "simular_comida_extra", input: { descripcion: "alfajor", kcal: 220, p: 2.5, c: 30, f: 10 } },
        { type: "tool_use", id: "tu_2", name: "proponer_registro", input: { momento: "merienda", items: [{ food_id: "alfajor", nombre: "alfajor", gramos: 50, kcal: 0, p: 0, c: 0, f: 0 }] } },
      ], "tool_use", "claude-opus-5-5"),
      msg([{ type: "text", text: "Entra en el día. Opciones: ..." }], "end_turn", "claude-opus-5-5"),
    ], bodies);
    const r = await runCoach(client, {
      mode: "chat",
      messages: [{ role: "user", content: "¿Puedo comer un alfajor?" }],
      cfg: defaultConfig("2026-11-01"),
      data: { meals: [], workouts: [], metrics: [], templates: SEED_TEMPLATES, events: [] },
      foods: SEED_FOODS,
    });
    expect(r.text).toContain("Entra");
    expect(r.toolsUsed).toEqual(["simular_comida_extra", "proponer_registro"]);
    expect(r.proposals[0].totals.kcal).toBe(220);
    const first = bodies[0];
    expect(first.model).toBe("claude-opus-5-5");
    expect(first.fallbacks).toBe("default");
    expect(first.messages.at(-1).role).toBe("system");
    expect(first.messages.at(-1).content).toContain("ESTADO ACTUAL");
    // La segunda llamada devuelve todos los resultados en un único mensaje de usuario
    const second = bodies[1];
    const last = second.messages.at(-1);
    expect(last.role).toBe("user");
    expect(last.content.map((c: any) => c.type)).toEqual(["tool_result", "tool_result"]);
    expect(JSON.parse(last.content[0].content).options.length).toBeGreaterThan(0);
  });
});

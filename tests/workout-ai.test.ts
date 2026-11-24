import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { parseWorkout } from "../supabase/functions/_shared/ai/parseWorkout.ts";

function client(out: unknown, bodies: any[]) {
  const fetch = async (_u: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return new Anthropic({ apiKey: "test-not-real", fetch: fetch as typeof globalThis.fetch, maxRetries: 0 });
}

describe("entrenos con IA", () => {
  it("unifica nombres con el historial, limpia datos y separa cardio", async () => {
    const bodies: any[] = [];
    const out = {
      exercises: [
        { name: "sentadilla", sets: [{ reps: 8, kg: 80 }, { reps: 8, kg: 80 }, { reps: 8, kg: 85 }] },
        { name: "PRENSA", sets: [{ reps: 10, kg: 200 }, { reps: 0, kg: 200 }] },
        { name: "Dominadas", sets: [{ reps: 6, kg: 0 }] },
      ],
      cardio: [{ modality: "caminata_inclinada", minutes: 25, intensity: "moderada", avg_hr: 300, device_kcal: null }],
      duration_min: 75,
      day_offset: -1,
      notes: "rodilla bien",
      assumptions: ["tomé 20 kg de barra"],
    };
    const r = await parseWorkout(client(out, bodies), {
      text: "ayer: sentadilla 3x8 con 80 la última 85, prensa 200, dominadas 6, 25 min cinta inclinada",
      known: ["Sentadilla", "Prensa", "Jalón al pecho (espalda)"],
      last: ["Sentadilla: 8×80, 8×80, 8×80"],
    });
    expect(r.exercises.map((e) => e.name)).toEqual(["Sentadilla", "Prensa", "Dominadas"]);
    expect(r.exercises[0].sets[2].kg).toBe(85);
    expect(r.exercises[1].sets).toHaveLength(1); // la serie con 0 reps se descarta
    expect(r.cardio[0].avg_hr).toBeNull(); // 300 lpm no es plausible
    expect(r.day_offset).toBe(-1);
    expect(r.assumptions[0]).toContain("barra");
    expect(bodies[0].model).toBe("claude-haiku-5-5");
    expect(bodies[0].system[1].text).toContain("Sentadilla: 8×80");
  });
  it("pide texto o foto", async () => {
    await expect(parseWorkout(client({}, []), { text: " ", known: [], last: [] })).rejects.toThrow();
  });
});

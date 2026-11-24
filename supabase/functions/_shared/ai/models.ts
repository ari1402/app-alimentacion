// Modelos: uno chico y rápido para parsear comidas (< 15 s, barato) y uno
// potente para el coach (negociación, análisis). Se pueden cambiar por env.
export const DEFAULT_MODEL_PARSE = "claude-haiku-5-5";
export const DEFAULT_MODEL_COACH = "claude-opus-5-5";

export interface AIUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
}

export class AIError extends Error {
  constructor(message: string, public code: "refusal" | "invalid" | "api" | "budget" | "unavailable" = "api") {
    super(message);
  }
}

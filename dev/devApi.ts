// Solo para `npm run dev` en modo local (sin Supabase): expone /api/parse-meal y
// /api/coach en el servidor de Vite. La API key se lee del entorno del proceso Node
// (.env.local, sin prefijo VITE_) y NUNCA llega al navegador ni al build.
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { parseMeal } from "../supabase/functions/_shared/ai/parseMeal.ts";
import { runCoach } from "../supabase/functions/_shared/ai/coach.ts";
import { generateRecipe } from "../supabase/functions/_shared/ai/recipe.ts";
import { AIError } from "../supabase/functions/_shared/ai/models.ts";

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

export function devApi(env: Record<string, string>): Plugin {
  return {
    name: "coach-dev-api",
    apply: "serve",
    configureServer(server) {
      const envKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        if (req.method !== "POST") return send(res, 405, { error: "POST" });
        // Key cargada en la app (modo local, header) o la de .env.local. Nunca se loguea.
        const headerKey = typeof req.headers["x-anthropic-key"] === "string" ? req.headers["x-anthropic-key"] : "";
        const key = headerKey || envKey;
        if (!key) return send(res, 503, { error: "IA no configurada: cargá tu API key en Ajustes → IA (o en .env.local)", code: "unavailable" });
        const client = new Anthropic({ apiKey: key });
        try {
          const body = await readJson(req);
          if (req.url.startsWith("/api/parse-meal")) return send(res, 200, await parseMeal(client, body));
          if (req.url.startsWith("/api/recipe")) return send(res, 200, await generateRecipe(client, body));
          if (req.url.startsWith("/api/coach")) {
            return send(res, 200, await runCoach(client, { ...body, now: body.now ? new Date(body.now) : undefined }));
          }
          return send(res, 404, { error: "not found" });
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError) {
            return send(res, 503, { error: "La API key de Claude no es válida o fue revocada. Cargá una nueva en Ajustes → IA.", code: "unavailable" });
          }
          const err = e as Error;
          const code = e instanceof AIError ? e.code : e instanceof Anthropic.APIError ? "api" : "api";
          console.error("[dev-api]", err.message);
          return send(res, e instanceof AIError && e.code === "invalid" ? 400 : 502, { error: err.message, code });
        }
      });
    },
  };
}

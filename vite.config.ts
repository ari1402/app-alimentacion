import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { devApi } from "./dev/devApi.ts";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  // loadEnv con prefijo "" lee TODAS las variables, pero solo las VITE_* se
  // inyectan al bundle. ANTHROPIC_API_KEY queda en el proceso de Node (dev).
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), devApi(env)],
    resolve: {
      alias: {
        "@core": r("./supabase/functions/_shared/core/index.ts"),
        "@ai": r("./supabase/functions/_shared/ai"),
      },
    },
    server: { host: true, port: 5173 },
    build: { target: "es2022", sourcemap: false },
    test: { include: ["tests/**/*.test.ts"], environment: "node" },
  };
});

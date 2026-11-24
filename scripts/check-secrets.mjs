#!/usr/bin/env node
// Bloquea commits que incluyan claves. Corre en el hook pre-commit y en CI.
// Uso: node scripts/check-secrets.mjs            (archivos staged)
//      node scripts/check-secrets.mjs --all      (todo el repo trackeado)
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const all = process.argv.includes("--all");
const files = execSync(all ? "git ls-files" : "git diff --cached --name-only --diff-filter=ACMR", { encoding: "utf8" })
  .split("\n").map((s) => s.trim()).filter(Boolean);

const PATTERNS = [
  [/sk-ant-[a-zA-Z0-9_-]{20,}/, "API key de Anthropic"],
  [/sb_secret_[a-zA-Z0-9_-]{20,}/, "Secret key de Supabase"],
  [/eyJhbGciOi[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, "JWT (¿service_role key de Supabase?)"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Clave privada"],
  // Valores literales (no variables tipo ${x} o $VAR)
  [/VAPID_PRIVATE_KEY\s*=\s*[A-Za-z0-9_-]{30,}/, "Clave privada VAPID"],
  [/CRON_SECRET\s*=\s*[A-Za-z0-9_+\/-]{12,}/, "CRON_SECRET"],
  [/ANTHROPIC_API_KEY\s*=\s*[A-Za-z0-9_-]{12,}/, "ANTHROPIC_API_KEY con valor"],
];
const FORBIDDEN_FILES = [/(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/, /supabase\/functions\/\.env$/, /\.pem$/, /vapid.*\.json$/i];

let bad = 0;
for (const f of files) {
  if (FORBIDDEN_FILES.some((r) => r.test(f))) {
    console.error(`✗ ${f}: este archivo no debe subirse (está pensado para secretos)`);
    bad++;
    continue;
  }
  if (!existsSync(f) || /\.(png|jpg|jpeg|webp|ico|lock)$/.test(f) || f === "package-lock.json") continue;
  const text = readFileSync(f, "utf8");
  for (const [re, what] of PATTERNS) {
    if (re.test(text)) {
      console.error(`✗ ${f}: parece contener ${what}`);
      bad++;
    }
  }
}
if (bad) {
  console.error(`\n${bad} problema(s). Mové los secretos a .env.local / supabase secrets y volvé a intentar.`);
  process.exit(1);
}
console.log(`✓ Sin secretos en ${files.length} archivo(s).`);

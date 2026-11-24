#!/usr/bin/env node
// Configura el backend en Supabase en un solo paso:
//   base de datos + funciones + claves de notificaciones + secretos.
// No escribe ningún secreto en archivos del repo: los manda directo a Supabase.
//
// Uso:  npm run setup:supabase
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import webpush from "web-push";

const CLI = ["-y", "supabase@3.3.0"];
const isWin = process.platform === "win32";
const rl = createInterface({ input: process.stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();
async function ask(q) {
  process.stdout.write(q);
  const { value, done } = await lines.next();
  if (done) { console.error("\nSin respuesta: cancelado."); process.exit(1); }
  return String(value);
}
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

function sb(args, { quiet = false, capture = false } = {}) {
  const r = spawnSync(isWin ? "npx.cmd" : "npx", [...CLI, ...args], {
    stdio: capture ? ["inherit", "pipe", "inherit"] : quiet ? "ignore" : "inherit",
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(`\n✗ Falló: supabase ${args.filter((a) => !a.includes("=")).join(" ")}`);
    process.exit(1);
  }
  return r.stdout ?? "";
}

function step(n, total, text) {
  console.log(`\n${bold(`[${n}/${total}]`)} ${text}`);
}

if (!existsSync("supabase/config.toml")) {
  console.error("Corré esto desde la carpeta del proyecto (donde está package.json).");
  process.exit(1);
}

console.log(bold("\nConfiguración de Supabase para el Coach\n"));
console.log("Necesitás: un proyecto creado en supabase.com y su contraseña de base de datos.\n");

let ref = "";
while (!/^[a-z]{20}$/.test(ref)) {
  const ans = (await ask("Pegá la URL de tu proyecto (o el Project ref de 20 letras): ")).trim();
  ref = (ans.match(/([a-z]{20})/) ?? [])[1] ?? "";
  if (!ref) console.log("  No encontré el ref. Está en Project Settings → General → Project ID.");
}
const email = (await ask("Tu email (para las notificaciones push, no se publica): ")).trim();
rl.close();

const TOTAL = 6;
step(1, TOTAL, "Iniciando sesión en Supabase (se abre el navegador)…");
sb(["login"]);

step(2, TOTAL, "Vinculando el proyecto (te va a pedir la contraseña de la base de datos)…");
sb(["link", "--project-ref", ref]);

step(3, TOTAL, "Creando las tablas, la seguridad (RLS) y la bóveda de la API key…");
sb(["db", "push", "--yes"]);

step(4, TOTAL, "Generando claves de notificaciones y guardándolas como secretos de Supabase…");
const vapid = webpush.generateVAPIDKeys();
const cronSecret = randomBytes(32).toString("hex");
sb([
  "secrets", "set",
  `VAPID_PUBLIC_KEY=${vapid.publicKey}`,
  `VAPID_PRIVATE_KEY=${vapid.privateKey}`,
  `VAPID_SUBJECT=mailto:${email || "coach@example.com"}`,
  `CRON_SECRET=${cronSecret}`,
], { quiet: true });
console.log(green("  ✓ Secretos guardados en Supabase (no en archivos)."));

step(5, TOTAL, "Publicando las funciones del servidor (IA, coach, notificaciones)…");
sb(["functions", "deploy", "--use-api", "--yes"]);

step(6, TOTAL, "Buscando la clave pública del proyecto…");
let anon = "";
try {
  const out = sb(["projects", "api-keys", "-o", "json"], { capture: true });
  const keys = JSON.parse(out);
  const list = Array.isArray(keys) ? keys : keys.keys ?? [];
  const k = list.find((x) => /anon|publishable/i.test(`${x.name} ${x.type ?? ""}`));
  anon = k?.api_key ?? k?.key ?? "";
} catch { /* se completa a mano */ }

const url = `https://${ref}.supabase.co`;
console.log(`
${green(bold("✓ Backend listo."))} Faltan 3 cosas que solo se hacen desde la web:

${bold("A) Notificaciones programadas (cron)")}
   Supabase → Database → Extensions: activá ${bold("pg_cron")} y ${bold("pg_net")}.
   Después Supabase → SQL Editor → pegá esto y tocá Run:

------------------------------------------------------------------
select vault.create_secret('${url}/functions/v1/coach-tick', 'coach_tick_url');
select vault.create_secret('${cronSecret}', 'coach_tick_secret');
select cron.schedule('coach-tick', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'coach_tick_url'),
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'coach_tick_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 25000);
$$);
------------------------------------------------------------------

${bold("B) Conectar la app de GitHub Pages con Supabase")}
   GitHub → tu repo → Settings → Secrets and variables → Actions → pestaña ${bold("Variables")} → New variable:
     VITE_SUPABASE_URL       = ${url}
     VITE_SUPABASE_ANON_KEY  = ${anon || "(copiala de Supabase → Project Settings → API Keys → anon / publishable)"}
     VITE_VAPID_PUBLIC_KEY   = ${vapid.publicKey}
   (Son públicas por diseño.) Después: Actions → "Publicar en GitHub Pages" → Run workflow.

${bold("C) Login")}
   Supabase → Authentication → URL Configuration → Site URL:
     https://<tu-usuario>.github.io/app-alimentacion/
   Abrí la app, creá tu cuenta, y después en Authentication → Sign In / Providers
   desactivá "Allow new users to sign up".

Por último, en la app: Ajustes → API key de Claude (queda cifrada en Supabase Vault)
y Ajustes → Notificaciones → Activar → Enviar prueba.

Si ya usabas la app en modo local: antes de pasarte, Ajustes → Exportar respaldo;
después de entrar con tu cuenta, Ajustes → Importar.
`);

// Coach proactivo programado. Lo llama pg_cron cada 15 min (header x-cron-secret).
// Para cada usuaria: arma el estado del día, decide qué nudges tocan (plantillas,
// sin IA → sin costo) y los manda por Web Push aunque la app esté cerrada.
//
// También acepta, con JWT de la usuaria:
//   { "test": true }     → manda una notificación de prueba
//   { "preview": true }  → devuelve qué nudges saldrían ahora (sin mandarlos)
import webpush from "web-push";
import { buildSnapshot, decideNudges, localDate, mergeConfig, type Nudge, type UserConfig } from "../_shared/core/index.ts";
import { env, handler, json, requireUser, serviceClient } from "../_shared/server/http.ts";
import { loadCoachData } from "../_shared/server/data.ts";

let vapidReady = false;
function setupVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
  vapidReady = true;
}

interface Sub { id: string; endpoint: string; p256dh: string; auth: string }

async function sendTo(subs: Sub[], payload: Record<string, unknown>): Promise<{ sent: number; gone: string[] }> {
  setupVapid();
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.id); // suscripción vencida
      else console.error("push error", code, (e as Error).message);
    }
  }));
  return { sent, gone };
}

async function tickUser(userId: string, cfg: UserConfig, subs: Sub[], now: Date) {
  const svc = serviceClient();
  const data = await loadCoachData(svc, userId, cfg.timezone);
  const snap = buildSnapshot(cfg, data, now);
  const sent = new Set(data.events.map((e) => e.dedupe_key));
  const nudges: Nudge[] = decideNudges(snap, sent).slice(0, 2); // nunca más de 2 juntos
  let delivered = 0;
  for (const n of nudges) {
    const { data: ev, error } = await svc.from("coach_events").insert({
      user_id: userId, local_date: snap.today, kind: n.kind, dedupe_key: n.dedupe_key, channel: "push", title: n.title, body: n.body, url: n.url,
    }).select("id").single();
    if (error) continue; // dedupe por unique(user_id, dedupe_key): otra ejecución ya lo mandó
    const r = await sendTo(subs, { title: n.title, body: n.body, url: n.url, tag: n.kind, eventId: ev.id, actions: n.actions ?? [] });
    delivered += r.sent;
    if (r.gone.length) await svc.from("push_subscriptions").delete().in("id", r.gone);
  }
  return { userId, nudges: nudges.map((n) => n.kind), delivered };
}

Deno.serve(handler(async (req) => {
  const body = await req.json().catch(() => ({}));
  const now = new Date();

  // Modo usuaria (prueba / vista previa)
  if (body.test || body.preview) {
    const user = await requireUser(req);
    const svc = serviceClient();
    const { data: row } = await svc.from("user_config").select("config").eq("user_id", user.id).maybeSingle();
    const cfg = mergeConfig(row?.config ?? null, localDate());
    if (body.preview) {
      const data = await loadCoachData(svc, user.id, cfg.timezone);
      const snap = buildSnapshot(cfg, data, now);
      return json({ nudges: decideNudges(snap, new Set(data.events.map((e) => e.dedupe_key))), adaptive: snap.adaptive });
    }
    const { data: subs } = await svc.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", user.id);
    if (!subs?.length) return json({ error: "No hay dispositivos suscriptos. Activá las notificaciones primero." }, 400);
    const r = await sendTo(subs, { title: "Prueba ✓", body: "Las notificaciones funcionan. El coach te va a escribir en los momentos clave.", url: "/", tag: "test" });
    if (r.gone.length) await svc.from("push_subscriptions").delete().in("id", r.gone);
    return json(r);
  }

  // Modo cron
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return json({ error: "forbidden" }, 403);
  const svc = serviceClient();
  const { data: subs, error } = await svc.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth");
  if (error) throw error;
  const byUser = new Map<string, Sub[]>();
  for (const s of subs ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
  if (!byUser.size) return json({ users: 0 });
  const { data: cfgs } = await svc.from("user_config").select("user_id, config").in("user_id", [...byUser.keys()]);
  const results = [];
  for (const row of cfgs ?? []) {
    try {
      results.push(await tickUser(row.user_id, mergeConfig(row.config, localDate()), byUser.get(row.user_id)!, now));
    } catch (e) {
      console.error("tick", row.user_id, e);
    }
  }
  return json({ users: results.length, results });
}));

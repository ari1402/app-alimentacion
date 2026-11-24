#!/usr/bin/env node
// Genera el par de claves VAPID para Web Push. NO se guardan en ningún archivo:
// copiá la pública a .env.local y ambas a `supabase secrets set`.
import webpush from "web-push";
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`
Clave PÚBLICA (va en el frontend y en Supabase):
  VITE_VAPID_PUBLIC_KEY=${publicKey}     → .env.local / variables del hosting
  VAPID_PUBLIC_KEY=${publicKey}          → supabase secrets

Clave PRIVADA (solo en Supabase, nunca en el repo):
  supabase secrets set VAPID_PRIVATE_KEY=${privateKey}
`);

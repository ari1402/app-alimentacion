# Coach — nutrición + entrenamiento

App personal (un solo usuario) que funciona como coach: registra comidas y entrenos, analiza el día contra los objetivos de macros y empuja con recordatorios en los momentos clave. Objetivo: de ~83 kg a 73–75 kg de forma sostenible.

**Stack:** PWA en React + Vite · Supabase (Postgres + Auth + Edge Functions + pg_cron) · API de Claude · Web Push.

> 🔐 **La API key de Claude nunca está en el repo ni en el navegador.** Vive como secreto de Supabase y solo la usan las Edge Functions. Ver [Seguridad de secretos](#seguridad-de-secretos).

---

## Qué hace

| Módulo | Estado | Detalle |
|---|---|---|
| A. Registro de comidas | ✅ | Texto libre con IA, **dictado por voz**, **foto del plato**, lista, plantillas que encajan en lo que queda del día, repetir comidas recientes. Siempre se revisa y corrige antes de confirmar. Si la IA falla, cae a la lista. |
| B. Motor de macros | ✅ | Acumulado, restante, rangos (no un número que se "falla"), regla de carbos (>50 g → la siguiente baja), proteína por comida restante. |
| C. Estado del día | ✅ | Anillos con rango aceptable, tarjeta del coach según la hora, semana (margen, días en rango), tendencia y fecha estimada. |
| D. Coach proactivo | ✅ | Mañana, recordatorios por comida (antes de la decisión), pre/post entreno, proyección de la tarde, cierre de noche con un ajuste concreto, cierre semanal, medidas cada 3 semanas. |
| E. Notificaciones | ✅ | Web Push desde el servidor (llegan con la app cerrada), cada 15 min vía pg_cron. Horas de silencio, dedupe, máximo 2 juntas. |
| F. Entrenos | ✅ | Sesiones, series × reps × kg precargadas con tus últimas cargas, 1RM estimado, récords, consistencia semanal con objetivo progresivo al retomar. |
| G. Seguimiento | ✅ | Peso con media móvil exponencial, gráfico con banda objetivo, medidas, adherencia de 8 semanas, hitos. |
| H. Base de conocimiento | ✅ | Tabla de alimentos editable, plantillas A1–A15 / C1–C10 / desayunos / meriendas, importación CSV/JSON. |
| Negociación | ✅ | "¿Puedo comer X?" → opciones con trade-off concreto (hoy / semana / aceptarlo) e impacto en la fecha. "¿Muevo el entreno?" → cómo queda la semana. Nunca compensación punitiva. |
| Proyecciones | ✅ | Rango de fechas (no una fecha), escenarios (ritmo actual / plan / ajuste), hitos cada 2 kg, gasto real estimado con tus datos. |
| v3 adaptativo | ✅ | Mueve recordatorios a tu horario real, baja la frecuencia de avisos que ignorás, deja de insistir con comidas que no hacés. Te muestra qué ajustó y por qué. |
| v3 reintroducciones | ✅ | Registro de intentos (merluza, pollo disimulado) con puntaje 1–5. |

### Ajuste del objetivo y base científica

**Cardio → objetivo del día (automático).** Al registrar cardio (modalidad, minutos, intensidad y, opcionalmente, frecuencia cardíaca o las kcal del reloj) la app estima las **kcal netas** y suma una parte al objetivo de ese día:
- Gasto con METs del *Compendium of Physical Activities* (Ainsworth 2011/2024), **netos del reposo** (el basal ya está en tu plan; sumarlo de nuevo duplicaría kcal).
- Con FC usa la ecuación de Keytel 2005; las kcal del reloj se descuentan un 20% (los wearables sobreestiman, Shcherbina 2017) y se promedian con la estimación MET.
- Se suma el **50%** por defecto (configurable 0–100%, con tope diario): las estimaciones tienen error y el cuerpo compensa parte del gasto (Pontzer 2016). Las kcal extra van a carbos (75%) y grasas (25%); la proteína no cambia.
- La fuerza no suma: el plan base ya asume 3–4 sesiones. El objetivo de 3–4 sesiones semanales cuenta solo fuerza.

**Revisión semanal del objetivo (propuesta, vos la aplicás con un botón).** Cada semana evalúa, en este orden:
1. ¿Hay datos? (4+ pesos en 3 semanas; si no, los pide).
2. ¿Se sostuvo el plan? Con menos de 9 días registrados o menos de 65% de adherencia **no recorta**: el foco es la consistencia.
3. ¿El ritmo está en **0.5–1 % del peso por semana**? (Garthe 2011; Helms 2014). Si es más rápido, o la fuerza cae más de 7%, propone **+100–150 kcal**. Si está estancada con buena adherencia, propone **−100–150 kcal** o, como alternativa, más pasos o cardio de bajo impacto.
4. Nunca baja de 1500 kcal, nunca toca la proteína y espera ≥2 semanas entre ajustes.
5. Después de 12+ semanas en déficit ofrece una **pausa de mantenimiento** de 2 semanas (MATADOR, Byrne 2018).

**Chequeos con evidencia (Ajustes → Base científica):**
- Proteína en g/kg (1.6–2.2; Morton 2018) y reparto por comida (0.3–0.4 g/kg; Schoenfeld & Aragon 2018).
- Grasas ≥ 20% de las kcal, ritmo implícito del plan, piso calórico y pasos (Paluch 2022).
- En Entrenos: series semanales por grupo muscular (≥10 para progresar; Schoenfeld 2017) y si la **fuerza se mantiene** (1RM estimado, últimas 2 semanas vs las 8 anteriores).
- **Ciclo** opcional: en fase con retención explica que la suba de la balanza es agua.
- **Pasos diarios** (NEAT) como primera palanca antes de recortar comida.
- Proteína de digestión lenta antes de dormir cuando falta (Res 2012).
- El coach con IA tiene este marco de evidencia en su prompt y herramientas para simular cardio, revisar el objetivo y hacer el chequeo científico.

### Mejoras sobre el spec

- **Foto y voz** para registrar en <15 s, además de texto.
- **Modo guardia** (residencia): un toque silencia la rutina por 26 h y deja solo 2 chequeos suaves de proteína con opciones portables.
- **Gasto energético adaptativo** (TDEE): se calcula con tu ingesta y tu tendencia real; la proyección mejora sola con los datos.
- **Coach con herramientas**: el modelo no hace cuentas de memoria. Llama funciones deterministas (simular comida extra, mover entreno, escenarios de peso, sugerir plantillas, buscar alimentos) y usa sus números. También puede **proponer un registro** ("comí 2 empanadas") que confirmás con un botón.
- **Simulador sin IA** que funciona offline.
- **Racha que perdona**: un día "cerca" no corta la racha; 80% sostenido es el objetivo.
- **Modo simple** (solo kcal y proteína) para cuando los números agobian.
- **Piso de seguridad**: nunca sugiere bajar de 1500 kcal ni más de 1% del peso por semana.
- **Modo local** sin cuenta (datos en el dispositivo) para probar o usar sin servidor; **exportar/importar** respaldo.
- **Presupuesto de IA** diario configurable y registro de consumo.
- **Lista de emails autorizados** (`ALLOWED_EMAILS`, obligatoria): si no está configurada, la IA no responde a nadie; así nadie más puede gastar tus créditos.

### Decisiones tomadas (las "abiertas" del spec)

1. **Plataforma: PWA.** Funciona ya, sin App Store. En iPhone las push requieren instalarla en la pantalla de inicio (iOS 16.4+): la app lo detecta y lo explica. El dominio (`core/`) es TypeScript puro, así que portar a Expo más adelante reutiliza toda la lógica.
2. **Modelos:** `claude-haiku-5-5` para parsear comidas (rápido y barato), `claude-opus-5-5` para el coach y los análisis. Configurables con `MODEL_PARSE` / `MODEL_COACH`. El coach tiene *fallback* del lado del servidor activado (si el modelo declina por política, reintenta con el modelo de respaldo por defecto).
3. **Mensajes:** plantillas para todos los nudges programados (sin costo, instantáneos); IA solo para parseo, chat/negociación y análisis bajo demanda.
4. **Presupuesto:** 60 llamadas/día por defecto (Ajustes → IA). Prompt caching en la tabla de alimentos y el system prompt.

---

## Puesta en marcha

### Opción 1 — probar en local (sin Supabase)

```bash
npm install
cp .env.example .env.local      # .env.local está en .gitignore
# opcional: poné tu ANTHROPIC_API_KEY en .env.local para tener IA en dev
npm run dev
```

Sin variables `VITE_SUPABASE_*` la app corre en **modo local**: los datos quedan en el navegador (IndexedDB). La IA en local la sirve el servidor de Vite (`dev/devApi.ts`), que lee la key del proceso de Node — nunca llega al bundle.

### Publicar en GitHub Pages (link público, gratis)

1. En GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → "Publicar en GitHub Pages" → Run workflow** (después se publica solo en cada push).
3. Link: **https://ari1402.github.io/app-alimentacion/**

Sin más configuración funciona en modo local (datos en el dispositivo, sin IA ni push). Para tener todo, seguí la opción 2 y cargá en **Settings → Secrets and variables → Actions → Variables** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` y `VITE_VAPID_PUBLIC_KEY` (públicas por diseño). La API key de Claude **no** va ahí: se carga desde la app.

### Opción 2 — producción (Supabase + push)

1. **Crear el proyecto** en [supabase.com](https://supabase.com) e instalar el CLI (`npm i -g supabase`).
2. **Base de datos:**
   ```bash
   supabase link --project-ref <tu-ref>
   supabase db push                 # aplica supabase/migrations (tablas + RLS + cardio/pasos)
   ```
3. **Claves VAPID** (push): `npm run vapid` y guardá lo que imprime (no se escribe a disco).
4. **API key de Claude — dos opciones:**
   - **Desde la app (lo más simple):** Ajustes → *API key de Claude* → pegarla → Guardar. La Edge Function `api-key` la valida contra Anthropic y la guarda **cifrada en Supabase Vault**. No queda en el código, en GitHub ni en el navegador, y la app nunca la vuelve a mostrar (solo los últimos 4 caracteres).
   - **Como secreto del proyecto:** `ANTHROPIC_API_KEY` + `ALLOWED_EMAILS` en `supabase secrets` (paso siguiente). Si cargaste una key desde la app, se usa esa primero.

   **Secretos de las funciones** (push y cron; la API key es opcional si la cargás desde la app):
   ```bash
   cp supabase/functions/.env.example supabase/functions/.env   # está en .gitignore
   # completá ANTHROPIC_API_KEY, ALLOWED_EMAILS, VAPID_*, CRON_SECRET
   supabase secrets set --env-file supabase/functions/.env
   ```
5. **Funciones:**
   ```bash
   supabase functions deploy parse-meal
   supabase functions deploy coach
   supabase functions deploy api-key
   supabase functions deploy coach-tick --no-verify-jwt
   ```
6. **Cron del coach:** en Database → Extensions habilitá `pg_cron` y `pg_net`. Copiá `supabase/setup/cron.sql`, completá la URL de tu proyecto y el `CRON_SECRET`, y corrélo en el SQL Editor (los valores quedan cifrados en Vault, no en el repo).
7. **Frontend:** desplegá en Vercel / Netlify / Cloudflare Pages con `npm run build` → `dist/`, y estas variables (públicas por diseño):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`.
8. **Cuenta:** abrí la app, creá tu cuenta y después **cerrá el registro** en Supabase (Authentication → Sign In / Providers → desactivar "Allow new users to sign up").
9. En el iPhone: Safari → Compartir → **Agregar a inicio**, abrí desde el ícono → Ajustes → Notificaciones → Activar → Enviar prueba.

### Datos del proyecto "Nutrición"

La tabla de alimentos y las plantillas A1–A15 / C1–C10 vienen precargadas con **valores de referencia razonables**, porque el documento del proyecto Nutrición no estaba disponible. Reemplazalos desde **Ajustes → Importar**:

- Alimentos en CSV: `nombre;porción;gramos;kcal;p;c;g;alias1|alias2`
- Todo (alimentos, plantillas, config) en el JSON de **Exportar respaldo** — editalo y volvé a importarlo.

---

## Seguridad de secretos

| Dato | Dónde vive | ¿En GitHub? |
|---|---|---|
| `ANTHROPIC_API_KEY` | Supabase Vault (cargada desde Ajustes), o `supabase secrets`, o `.env.local` en dev (sin prefijo `VITE_`) | ❌ nunca |
| `VAPID_PRIVATE_KEY`, `CRON_SECRET` | `supabase secrets` + Vault | ❌ nunca |
| Service role key | La inyecta Supabase en las funciones | ❌ nunca |
| URL + anon key de Supabase, VAPID pública | Variables `VITE_*` del hosting | Públicas por diseño (la seguridad es RLS) |

Capas de protección:
- `.gitignore` excluye `.env`, `.env.*`, `supabase/functions/.env` y similares.
- **Hook pre-commit** (`.githooks/pre-commit`, se instala con `npm install`) corre `scripts/check-secrets.mjs` y bloquea commits con claves `sk-ant-…`, JWTs, claves privadas o archivos `.env`.
- **CI** (GitHub Actions) corre gitleaks sobre todo el historial + el mismo escáner + tests + build.
- El frontend **nunca** llama a Anthropic: pasa por la Edge Function, que valida tu sesión, tu email y el presupuesto diario.
- Verificado: el build (`dist/`) no contiene el SDK de Anthropic ni ninguna key.

Si alguna vez se filtra una key: revocála en console.anthropic.com, generá otra y `supabase secrets set ANTHROPIC_API_KEY=…`.

---

## Estructura

```
src/                         Frontend (React)
  pages/                     Hoy, Registrar, Coach, Progreso, Entrenos, Ajustes
  lib/repo/                  local (IndexedDB) y cloud (Supabase) con la misma interfaz
  lib/ai.ts                  llama a las Edge Functions (sin keys)
supabase/
  migrations/                esquema + RLS
  functions/
    _shared/core/            dominio puro: macros, proyecciones, negociación, nudges, adaptativo, seed
    _shared/ai/              prompts y loop del coach con herramientas
    parse-meal/  coach/      Edge Functions con IA
    coach-tick/              nudges programados + Web Push
  setup/cron.sql             plantilla para pg_cron (sin valores reales)
public/sw.js                 service worker (offline + push)
tests/                       vitest: dominio + IA con fetch simulado
```

## Scripts

| | |
|---|---|
| `npm run dev` | servidor local |
| `npm test` | tests del dominio y de la capa de IA |
| `npm run build` | typecheck + build de producción |
| `npm run vapid` | genera claves VAPID |
| `npm run check-secrets` | escanea archivos staged |

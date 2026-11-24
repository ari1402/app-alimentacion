-- Coach de nutrición: esquema inicial.
-- Todas las tablas tienen RLS: cada fila pertenece a un usuario y solo ese
-- usuario (auth.uid()) la puede leer o escribir. La anon key es pública; la
-- seguridad está acá.

create extension if not exists pgcrypto;

-- Configuración (objetivos, horarios, zona horaria, "por qué", etc.)
create table public.user_config (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  config jsonb not null,
  updated_at timestamptz not null default now()
);

-- Tabla de alimentos (macros por porción de referencia)
create table public.foods (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  name text not null,
  aliases text[] not null default '{}',
  portion_label text not null,
  portion_g numeric not null check (portion_g > 0),
  kcal numeric not null,
  p numeric not null,
  c numeric not null,
  f numeric not null,
  category text,
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.meals_logged (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  local_date date not null,
  slot text not null check (slot in ('desayuno','almuerzo','merienda','cena','snack')),
  eaten_at timestamptz not null default now(),
  raw_text text,
  items jsonb not null default '[]',
  totals jsonb not null,
  source text not null default 'list',
  confirmed boolean not null default true,
  created_at timestamptz not null default now()
);
create index meals_user_date on public.meals_logged (user_id, local_date);

-- Opciones de comidas del proyecto (A1–A15, C1–C10, desayunos, meriendas)
create table public.meal_templates (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  code text not null,
  slot text not null,
  name text not null,
  description text,
  items jsonb not null default '[]',
  totals jsonb not null,
  primary key (user_id, id)
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  local_date date not null,
  type text not null default 'fuerza',
  exercises jsonb not null default '[]',
  duration_min int,
  notes text,
  created_at timestamptz not null default now()
);
create index workouts_user_date on public.workouts (user_id, local_date);

create table public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  local_date date not null,
  weight_kg numeric,
  waist_cm numeric,
  hip_cm numeric,
  thigh_cm numeric,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, local_date)
);

-- Nudges enviados y respuesta (para medir adherencia y alimentar lo adaptativo)
create table public.coach_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  local_date date not null,
  kind text not null,
  dedupe_key text not null,
  channel text not null default 'push',
  title text not null,
  body text not null,
  url text,
  response text check (response in ('opened','logged','dismissed','snoozed')),
  responded_at timestamptz,
  unique (user_id, dedupe_key)
);
create index coach_events_user_date on public.coach_events (user_id, local_date);

-- Porciones aprendidas ("un panqueque" = 100 g)
create table public.portions (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  phrase text not null,
  food_id text,
  grams numeric not null,
  count int not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, phrase)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Conversación con el coach
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  role text not null check (role in ('user','assistant')),
  content text not null
);
create index chat_user_created on public.chat_messages (user_id, created_at);

-- v3: seguimiento de reintroducciones (merluza, pollo disimulado, ...)
create table public.reintroductions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  local_date date not null,
  food text not null,
  amount text,
  rating int not null check (rating between 1 and 5),
  note text,
  created_at timestamptz not null default now()
);

-- Presupuesto de llamadas de IA (lo escribe la Edge Function)
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  local_date date not null,
  kind text not null,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0
);
create index ai_usage_user_date on public.ai_usage (user_id, local_date);

-- ───────────────────────── RLS ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['user_config','foods','meals_logged','meal_templates','workouts','body_metrics',
                           'coach_events','portions','push_subscriptions','chat_messages','reintroductions']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "own rows" on public.%I for all to authenticated
                    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ai_usage: la usuaria puede ver su consumo; solo el backend (service role) escribe.
alter table public.ai_usage enable row level security;
create policy "read own usage" on public.ai_usage for select to authenticated using (user_id = (select auth.uid()));

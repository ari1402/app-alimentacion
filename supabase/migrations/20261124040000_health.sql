-- Datos de Apple Salud / Apple Watch (vía Atajo de iPhone): sueño y FC en reposo.
alter table public.body_metrics add column if not exists sleep_h numeric check (sleep_h is null or sleep_h between 0 and 24);
alter table public.body_metrics add column if not exists resting_hr int check (resting_hr is null or resting_hr between 20 and 200);

-- Token personal para que el Atajo mande datos sin iniciar sesión.
-- Se guarda solo el HASH (SHA-256): si alguien lee la tabla, no puede usar el token.
create table if not exists public.ingest_tokens (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_payload jsonb
);
alter table public.ingest_tokens enable row level security;
create policy "own rows" on public.ingest_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

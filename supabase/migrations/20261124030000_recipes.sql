-- Recetas guardadas (base, generadas con IA o propias) + seguimiento de meal prep.
create table if not exists public.recipes (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null,
  name text not null,
  slots text[] not null default '{}',
  servings int not null default 1 check (servings between 1 and 20),
  prep_min int not null default 20,
  ingredients jsonb not null default '[]',
  steps jsonb not null default '[]',
  tips text,
  tags text[] not null default '{}',
  totals jsonb not null,
  favorite boolean not null default false,
  source text not null default 'manual',
  batch_left int not null default 0,
  batch_cooked_at date,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.recipes enable row level security;
create policy "own rows" on public.recipes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

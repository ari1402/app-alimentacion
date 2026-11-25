-- Productos de marca con macros reales (Open Food Facts / web de la marca).
alter table public.foods add column if not exists brand text;
alter table public.foods add column if not exists source text;

-- Cardio con estimación de gasto (ajusta el objetivo del día) y pasos diarios (NEAT).
alter table public.workouts add column if not exists cardio jsonb;
alter table public.body_metrics add column if not exists steps int check (steps is null or steps between 0 and 100000);

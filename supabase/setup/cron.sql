-- Programa el coach proactivo (nudges) cada 15 minutos con pg_cron + pg_net.
--
-- ⚠️  NO pegues valores reales en este archivo del repo. Copialo, completá los
--     dos valores y corrélo en el SQL Editor de Supabase. Los valores quedan en
--     Supabase Vault (cifrados), no en el código.
--
-- Requisitos: Database → Extensions → habilitar pg_cron y pg_net.

select vault.create_secret('https://<TU-PROYECTO>.supabase.co/functions/v1/coach-tick', 'coach_tick_url');
select vault.create_secret('<EL MISMO CRON_SECRET QUE CARGASTE EN supabase secrets>', 'coach_tick_secret');

select cron.schedule(
  'coach-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'coach_tick_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'coach_tick_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- Para ver ejecuciones:  select * from cron.job_run_details order by start_time desc limit 20;
-- Para desprogramar:     select cron.unschedule('coach-tick');

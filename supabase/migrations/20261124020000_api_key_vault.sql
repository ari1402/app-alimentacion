-- API key de Claude cargada desde la app y guardada CIFRADA en Supabase Vault.
-- Solo el backend (service_role) puede leerla o escribirla: ni la anon key ni la
-- sesión de la usuaria tienen permiso sobre estas funciones. La app nunca recibe
-- la key de vuelta (solo "configurada" + últimos 4 caracteres).

create extension if not exists supabase_vault with schema vault;

create or replace function public.set_anthropic_key(p_user uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := 'anthropic_key_' || p_user::text;
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(p_key, v_name, 'API key de Claude del coach (cargada desde la app)');
  else
    perform vault.update_secret(v_id, p_key);
  end if;
end;
$$;

create or replace function public.get_anthropic_key(p_user uuid)
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_key_' || p_user::text limit 1;
$$;

create or replace function public.delete_anthropic_key(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where name = 'anthropic_key_' || p_user::text;
$$;

revoke all on function public.set_anthropic_key(uuid, text) from public, anon, authenticated;
revoke all on function public.get_anthropic_key(uuid) from public, anon, authenticated;
revoke all on function public.delete_anthropic_key(uuid) from public, anon, authenticated;
grant execute on function public.set_anthropic_key(uuid, text) to service_role;
grant execute on function public.get_anthropic_key(uuid) to service_role;
grant execute on function public.delete_anthropic_key(uuid) to service_role;

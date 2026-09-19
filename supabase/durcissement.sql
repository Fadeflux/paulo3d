-- =============================================================================
-- Durcissement d'un projet en service (Paulo3D, Anais3D) — à coller UNE fois dans
-- Supabase → SQL Editor → Run, APRÈS schema.sql. Se relance sans risque.
--   1. Toute table, séquence ou fonction créée plus tard dans « public » reste fermée aux
--      visiteurs sans compte (anon) : rien ne s'ouvre par oubli.
--   2. Toute nouvelle table de « public » a sa sécurité par ligne (RLS) activée d'office,
--      si le projet n'a pas déjà ce réflexe (option « RLS automatique » de Supabase).
--   3. Double authentification OBLIGATOIRE : sans code, la base ne donne ni ne prend rien.
--      (L'appli fait activer le code à la première connexion.)
-- Ne lit, ne modifie et ne supprime AUCUNE donnée.
-- =============================================================================

-- 1. Futurs objets : jamais ouverts aux visiteurs sans compte
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- 2. RLS automatique sur les nouvelles tables (sauf si le projet l'a déjà)
create schema if not exists p3d_private;
revoke all on schema p3d_private from public;

create or replace function p3d_private.rls_auto()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in select * from pg_event_trigger_ddl_commands()
           where object_type = 'table' and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', r.object_identity);
  end loop;
end
$$;
revoke execute on function p3d_private.rls_auto() from public;

do $$
begin
  if not exists (select 1 from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid
                 where p.proname in ('rls_auto_enable', 'rls_auto') and e.evtenabled <> 'D') then
    create event trigger p3d_rls_auto on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function p3d_private.rls_auto();
  end if;
end
$$;

-- 3. Double authentification obligatoire
create or replace function p3d_private.mfa_obligatoire()
returns boolean language sql immutable set search_path = '' as 'select true';
revoke execute on function p3d_private.mfa_obligatoire() from public;

-- contrôle du code (même version que schema.sql) : exige le code aussi pour un compte qui ne l'a pas encore activé
create or replace function p3d_private.mfa_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' then
    if exists (select 1 from auth.mfa_factors f
               where f.user_id = (select auth.uid()) and f.status = 'verified') then
      raise exception using errcode = '42501', message = 'Code de double authentification requis.', hint = 'P3D2F';
    end if;
    -- obligatoire et pas encore activée : l'appli ouvre l'activation (même indice P3D2F)
    if (select p3d_private.mfa_obligatoire()) then
      raise exception using errcode = '42501', message = 'Double authentification obligatoire : active-la pour continuer.', hint = 'P3D2F';
    end if;
  end if;
  return true;
end
$$;
revoke execute on function p3d_private.mfa_ok() from public;
grant usage on schema p3d_private to authenticated;
grant execute on function p3d_private.mfa_ok() to authenticated;

-- Vérification : doit renvoyer « true »
select p3d_private.mfa_obligatoire() as double_authentification_obligatoire;

-- Imitation minimale de Supabase pour les tests LOCAUX (jamais utilisé en production).
-- Rôles, schéma auth, auth.uid() identique à Supabase, publication temps réel.

do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator login noinherit password 'authenticator-local'; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;

create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

-- Comme Supabase : jeton de la requête, et facteurs de double authentification (table interne d'Auth,
-- NON lisible par les comptes : seules des fonctions « security definer » peuvent la consulter)
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create table if not exists auth.mfa_factors (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  friendly_name text,
  factor_type   text not null default 'totp',
  status        text not null default 'unverified',
  secret        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
revoke all on table auth.mfa_factors from public;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Comme Supabase : tout NOUVEL objet du schéma public est ouvert aux rôles de l'API.
-- Le script doit donc retirer lui-même chaque droit qu'il ne veut pas donner.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Comme un projet Supabase créé avec « RLS automatique » : fonction de déclencheur d'évènement
-- (security definer) dans public, appelable par tous tant que le script ne l'a pas fermée.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  r record;
begin
  for r in select * from pg_event_trigger_ddl_commands() where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO') loop
    execute format('alter table if exists %s enable row level security', r.object_identity);
  end loop;
end
$$;
do $$ begin
  create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    execute function public.rls_auto_enable();
exception when duplicate_object then null; end $$;

do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;

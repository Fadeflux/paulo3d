-- =============================================================================
--  Paulo3D — Base de données Supabase (PostgreSQL)
--  Version du schéma : 3
-- -----------------------------------------------------------------------------
--  COMMENT L'INSTALLER
--    1. Supabase > ton projet > « SQL Editor » > « New query »
--    2. Colle TOUT ce fichier, puis « Run ».
--    3. C'est tout. Le script peut être relancé sans rien perdre (il ne supprime
--       aucune donnée) : c'est aussi comme ça qu'on appliquera les mises à jour.
--
--  SÉCURITÉ
--    - Chaque ligne appartient à un compte (owner_id) et la base refuse de la
--      montrer ou de la modifier pour quelqu'un d'autre (Row Level Security).
--    - Sans connexion (clé « anon » seule), on ne peut RIEN lire ni écrire.
--    - Conseil : une fois ton compte créé, désactive les inscriptions
--      (Authentication > Sign In / Providers > « Allow new users to sign up »).
--
--  PRINCIPES
--    - Le poids restant d'une bobine et le stock disponible d'un lot sont
--      calculés PAR LA BASE à partir de l'historique (mouvements, ventes,
--      retraits). L'application n'écrit jamais ces chiffres directement :
--      deux appareils hors-ligne ne peuvent pas s'écraser mutuellement.
--    - Les identifiants sont créés par l'appareil : renvoyer deux fois la même
--      action (coupure réseau pendant l'envoi) ne la compte qu'une seule fois.
--    - Le coût de revient est figé au moment de la production.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Fonctions utilitaires
-- -----------------------------------------------------------------------------

create or replace function public.p3d_version()
returns integer
language sql
stable
set search_path = ''
as $$ select 3 $$;

create or replace function public.p3d_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- clock_timestamp() et non now() : deux modifications de la même ligne dans une
  -- même transaction doivent avoir deux heures différentes, sinon un appareil ne
  -- peut pas savoir laquelle est la plus récente
  new.updated_at := clock_timestamp();
  return new;
end
$$;

-- Vérifie la liste des matières d'un template :
-- [{ "material": "PLA", "color_name": "Noir", "color_hex": "#111111", "grams": 12.5, "spool_id": null }]
create or replace function public.p3d_materials_valid(m jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  e jsonb;
begin
  if m is null or jsonb_typeof(m) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(m) > 16 then
    return false;
  end if;
  for e in select value from jsonb_array_elements(m)
  loop
    if jsonb_typeof(e) <> 'object' then
      return false;
    end if;
    if jsonb_typeof(e -> 'grams') is distinct from 'number' then
      return false;
    end if;
    if (e ->> 'grams')::numeric < 0 then
      return false;
    end if;
    if jsonb_typeof(e -> 'material') is distinct from 'string' then
      return false;
    end if;
    if coalesce(e ->> 'color_hex', '') !~ '^#[0-9A-Fa-f]{6}$' then
      return false;
    end if;
    if e ? 'spool_id' then
      if jsonb_typeof(e -> 'spool_id') not in ('string', 'null') then
        return false;
      end if;
      if jsonb_typeof(e -> 'spool_id') = 'string' and (e ->> 'spool_id') !~ '^[0-9a-fA-F-]{36}$' then
        return false;
      end if;
    end if;
  end loop;
  return true;
end
$$;


-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- Réglages de l'atelier (une ligne par compte)
create table if not exists public.settings (
  owner_id          uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  workshop_name     text not null default 'Paulo3D' check (char_length(workshop_name) <= 80),
  machine_rate      numeric(10,4) not null default 0.30 check (machine_rate >= 0),        -- €/h électricité + usure (machine par défaut)
  labor_rate        numeric(10,2) not null default 20.00 check (labor_rate >= 0),         -- €/h main-d'œuvre
  filament_price_kg numeric(10,2) not null default 20.00 check (filament_price_kg >= 0), -- €/kg si aucune bobine ne correspond
  pricing_mode      text not null default 'coef' check (pricing_mode in ('coef', 'margin')),
  price_coef        numeric(6,3) not null default 2.5 check (price_coef > 0 and price_coef <= 100),
  target_margin_pct numeric(5,2) not null default 65 check (target_margin_pct >= 0 and target_margin_pct < 100),
  price_rounding    text not null default 'x.90' check (price_rounding in ('none', '0.10', '0.50', '1', 'x.90')),
  spool_low_g       numeric(10,2) not null default 300 check (spool_low_g >= 0),
  spool_critical_g  numeric(10,2) not null default 150 check (spool_critical_g >= 0),
  sales_channels    jsonb not null default '[
      {"id":"direct","name":"Main propre","pct":0,"fixed":0},
      {"id":"etsy","name":"Etsy","pct":0,"fixed":0},
      {"id":"vinted","name":"Vinted","pct":0,"fixed":0},
      {"id":"leboncoin","name":"Leboncoin","pct":0,"fixed":0},
      {"id":"site","name":"Site web","pct":0,"fixed":0},
      {"id":"salon","name":"Salon / marché","pct":0,"fixed":0}
    ]'::jsonb check (jsonb_typeof(sales_channels) = 'array'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Date de la dernière sauvegarde complète (JSON) : l'appli rappelle d'en refaire une chaque mois
alter table public.settings add column if not exists last_backup_at timestamptz;

-- Machines (chacune avec son coût horaire)
create table if not exists public.machines (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  model       text check (model is null or char_length(model) <= 80),
  hourly_rate numeric(10,4) not null default 0.30 check (hourly_rate >= 0),
  is_default  boolean not null default false,
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, owner_id)
);

-- Bobines (consommables)
create table if not exists public.spools (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  brand              text not null default '' check (char_length(brand) <= 80),
  material           text not null default 'PLA' check (char_length(btrim(material)) between 1 and 40),
  color_name         text not null default '' check (char_length(color_name) <= 60),
  color_hex          text not null default '#FFFFFF' check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  price              numeric(10,2) not null default 0 check (price >= 0),
  initial_weight_g   numeric(10,2) not null default 1000 check (initial_weight_g > 0),
  tare_g             numeric(10,2) check (tare_g is null or tare_g >= 0),              -- poids de la bobine vide
  remaining_weight_g numeric(10,2) not null default 0,                                  -- calculé par la base
  cost_per_g         numeric(14,6) generated always as (round(price / initial_weight_g, 6)) stored,
  purchased_at       date,
  notes              text check (notes is null or char_length(notes) <= 1000),
  archived           boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, owner_id)
);

-- Templates (modèles récurrents). Toutes les valeurs sont PAR PIÈCE.
create table if not exists public.templates (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 1 and 120),
  description       text check (description is null or char_length(description) <= 2000),
  photo             text check (photo is null or (char_length(photo) <= 300000 and photo like 'data:image/%')),
  machine_id        uuid,
  pieces_per_print  integer not null default 1 check (pieces_per_print between 1 and 10000),
  materials         jsonb not null default '[]'::jsonb check (public.p3d_materials_valid(materials)),
  purge_g           numeric(10,2) not null default 0 check (purge_g >= 0),
  hardware_cost     numeric(10,2) not null default 0 check (hardware_cost >= 0),
  print_time_min    numeric(10,2) not null default 0 check (print_time_min >= 0),
  labor_min         numeric(10,2) not null default 0 check (labor_min >= 0),
  pricing_mode      text check (pricing_mode is null or pricing_mode in ('coef', 'margin')),
  price_coef        numeric(6,3) check (price_coef is null or (price_coef > 0 and price_coef <= 100)),
  target_margin_pct numeric(5,2) check (target_margin_pct is null or (target_margin_pct >= 0 and target_margin_pct < 100)),
  catalog_price     numeric(10,2) check (catalog_price is null or catalog_price >= 0),
  archived          boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (machine_id, owner_id) references public.machines (id, owner_id) on delete set null (machine_id)
);

-- Productions ET prints ratés (coûts figés au lancement, totaux pour la quantité)
create table if not exists public.productions (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind                 text not null check (kind in ('production', 'failure')),
  template_id          uuid,
  item_name            text not null check (char_length(btrim(item_name)) between 1 and 120),
  quantity             integer not null check (quantity between 1 and 100000),
  failed_pct           numeric(5,2) not null default 100 check (failed_pct > 0 and failed_pct <= 100),
  failure_reason       text check (failure_reason is null or char_length(failure_reason) <= 120),
  machine_id           uuid,
  machine_rate         numeric(10,4) not null default 0 check (machine_rate >= 0),
  labor_rate           numeric(10,2) not null default 0 check (labor_rate >= 0),
  grams_total          numeric(12,2) not null default 0 check (grams_total >= 0),
  purge_g_total        numeric(12,2) not null default 0 check (purge_g_total >= 0),
  print_time_min_total numeric(12,2) not null default 0 check (print_time_min_total >= 0),
  labor_min_total      numeric(12,2) not null default 0 check (labor_min_total >= 0),
  material_cost        numeric(12,4) not null default 0 check (material_cost >= 0),
  purge_cost           numeric(12,4) not null default 0 check (purge_cost >= 0),
  hardware_cost        numeric(12,4) not null default 0 check (hardware_cost >= 0),
  machine_cost         numeric(12,4) not null default 0 check (machine_cost >= 0),
  labor_cost           numeric(12,4) not null default 0 check (labor_cost >= 0),
  total_cost           numeric(12,4) not null default 0 check (total_cost >= 0),
  unit_cost            numeric(12,4) not null default 0 check (unit_cost >= 0),
  consumption          jsonb not null default '[]'::jsonb check (jsonb_typeof(consumption) = 'array'),
  note                 text check (note is null or char_length(note) <= 1000),
  occurred_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, owner_id),
  check (kind = 'failure' or failed_pct = 100),
  check (abs(total_cost - (material_cost + purge_cost + hardware_cost + machine_cost + labor_cost)) < 0.05),
  foreign key (template_id, owner_id) references public.templates (id, owner_id) on delete set null (template_id),
  foreign key (machine_id, owner_id) references public.machines (id, owner_id) on delete set null (machine_id)
);

-- Mouvements de bobine : consommation, pesée (poids net mesuré)
create table if not exists public.spool_movements (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  spool_id      uuid not null,
  production_id uuid,
  kind          text not null check (kind in ('production', 'failure', 'weigh', 'adjust')),
  delta_g       numeric(10,2) not null default 0,
  measured_g    numeric(10,2) check (measured_g is null or measured_g >= 0),
  note          text check (note is null or char_length(note) <= 500),
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((kind = 'weigh') = (measured_g is not null)),
  check (kind <> 'weigh' or delta_g = 0),
  check ((kind in ('production', 'failure')) = (production_id is not null)),
  -- Une bobine qui a un historique ne peut pas être supprimée (on l'archive).
  foreign key (spool_id, owner_id) references public.spools (id, owner_id),
  foreign key (production_id, owner_id) references public.productions (id, owner_id) on delete cascade
);

-- Stock de pièces finies (un lot par production, ou ajout manuel)
create table if not exists public.production_stock (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  production_id uuid unique,
  template_id   uuid,
  item_name     text not null check (char_length(btrim(item_name)) between 1 and 120),
  unit_cost     numeric(12,4) not null default 0 check (unit_cost >= 0),
  quantity      integer not null check (quantity between 1 and 100000),
  qty_available integer not null default 0,                                              -- calculé par la base
  note          text check (note is null or char_length(note) <= 1000),
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, owner_id),
  check (qty_available >= 0 and qty_available <= quantity),
  foreign key (production_id, owner_id) references public.productions (id, owner_id) on delete cascade,
  foreign key (template_id, owner_id) references public.templates (id, owner_id) on delete set null (template_id)
);

-- Pièces retirées du stock sans vente (casse, perte, usage perso, correction)
create table if not exists public.stock_adjustments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  group_id    uuid not null,
  lot_id      uuid not null,
  quantity    integer not null check (quantity between 1 and 100000),
  reason      text not null default 'casse' check (reason in ('casse', 'perte', 'perso', 'correction')),
  unit_cost   numeric(12,4) not null default 0 check (unit_cost >= 0),
  note        text check (note is null or char_length(note) <= 500),
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (lot_id, owner_id) references public.production_stock (id, owner_id) on delete cascade
);

-- Ventes
create table if not exists public.sales (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel          text not null default 'direct' check (char_length(channel) <= 40),
  customer         text check (customer is null or char_length(customer) <= 120),
  note             text check (note is null or char_length(note) <= 1000),
  amount           numeric(12,2) not null default 0 check (amount >= 0),           -- total encaissé (articles + port facturé)
  shipping_charged numeric(12,2) not null default 0 check (shipping_charged >= 0), -- port payé par le client
  shipping_cost    numeric(12,2) not null default 0 check (shipping_cost >= 0),    -- port payé par l'atelier
  packaging_cost   numeric(12,2) not null default 0 check (packaging_cost >= 0),
  platform_fee     numeric(12,2) not null default 0 check (platform_fee >= 0),
  cogs             numeric(12,4) not null default 0 check (cogs >= 0),             -- coût de revient des pièces vendues
  net_margin       numeric(12,4) generated always as (amount - cogs - shipping_cost - packaging_cost - platform_fee) stored,
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, owner_id)
);

create table if not exists public.sale_items (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sale_id     uuid not null,
  template_id uuid,
  item_name   text not null check (char_length(btrim(item_name)) between 1 and 120),
  quantity    integer not null check (quantity between 1 and 100000),
  unit_price  numeric(12,2) not null check (unit_price >= 0),
  from_stock  boolean not null default true,
  unit_cost   numeric(12,4) not null default 0 check (unit_cost >= 0),
  cogs        numeric(12,4) not null default 0 check (cogs >= 0),
  position    smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (sale_id, owner_id) references public.sales (id, owner_id) on delete cascade,
  foreign key (template_id, owner_id) references public.templates (id, owner_id) on delete set null (template_id)
);

-- Quelles pièces du stock ont servi à quelle vente (premier produit, premier vendu)
create table if not exists public.sale_allocations (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sale_item_id uuid not null,
  lot_id       uuid not null,
  quantity     integer not null check (quantity between 1 and 100000),
  unit_cost    numeric(12,4) not null default 0 check (unit_cost >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (sale_item_id, owner_id) references public.sale_items (id, owner_id) on delete cascade,
  -- Un lot déjà vendu ne peut pas disparaître : il faut d'abord supprimer la vente.
  foreign key (lot_id, owner_id) references public.production_stock (id, owner_id)
);

-- Commandes clients : ce qui a été promis (pièce, quantité, prix, date), jusqu'à la livraison
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  customer    text not null default '' check (char_length(customer) <= 120),
  template_id uuid,
  item_name   text not null check (char_length(btrim(item_name)) between 1 and 120),
  quantity    integer not null default 1 check (quantity between 1 and 10000),
  unit_price  numeric(10,2) check (unit_price is null or unit_price >= 0),
  due_date    date,
  channel     text check (channel is null or char_length(channel) <= 40),
  note        text check (note is null or char_length(note) <= 1000),
  status      text not null default 'todo' check (status in ('todo', 'ready', 'delivered', 'cancelled')),
  sale_id     uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (template_id, owner_id) references public.templates (id, owner_id) on delete set null (template_id),
  foreign key (sale_id, owner_id) references public.sales (id, owner_id) on delete set null (sale_id)
);


-- -----------------------------------------------------------------------------
-- 2. Index
-- -----------------------------------------------------------------------------

create index if not exists machines_owner_updated_idx          on public.machines (owner_id, updated_at);
create index if not exists spools_owner_updated_idx            on public.spools (owner_id, updated_at);
create index if not exists templates_owner_updated_idx         on public.templates (owner_id, updated_at);
create index if not exists templates_machine_idx               on public.templates (machine_id);
create index if not exists productions_owner_updated_idx       on public.productions (owner_id, updated_at);
create index if not exists productions_owner_occurred_idx      on public.productions (owner_id, occurred_at desc);
create index if not exists productions_template_idx            on public.productions (template_id);
create index if not exists productions_machine_idx             on public.productions (machine_id);
create index if not exists spool_movements_owner_updated_idx   on public.spool_movements (owner_id, updated_at);
create index if not exists spool_movements_spool_idx           on public.spool_movements (spool_id, occurred_at);
create index if not exists spool_movements_production_idx      on public.spool_movements (production_id);
create index if not exists production_stock_owner_updated_idx  on public.production_stock (owner_id, updated_at);
create index if not exists production_stock_template_idx       on public.production_stock (template_id, occurred_at);
create index if not exists production_stock_available_idx      on public.production_stock (owner_id, item_name) where qty_available > 0;
create index if not exists stock_adjustments_owner_updated_idx on public.stock_adjustments (owner_id, updated_at);
create index if not exists stock_adjustments_lot_idx           on public.stock_adjustments (lot_id);
create index if not exists stock_adjustments_group_idx         on public.stock_adjustments (group_id);
create index if not exists sales_owner_updated_idx             on public.sales (owner_id, updated_at);
create index if not exists sales_owner_occurred_idx            on public.sales (owner_id, occurred_at desc);
create index if not exists sale_items_owner_updated_idx        on public.sale_items (owner_id, updated_at);
create index if not exists sale_items_sale_idx                 on public.sale_items (sale_id);
create index if not exists sale_items_template_idx             on public.sale_items (template_id);
create index if not exists sale_allocations_owner_updated_idx  on public.sale_allocations (owner_id, updated_at);
create index if not exists orders_owner_updated_idx            on public.orders (owner_id, updated_at);
create index if not exists orders_template_idx                 on public.orders (template_id);
create index if not exists orders_sale_idx                     on public.orders (sale_id);
create index if not exists sale_allocations_item_idx           on public.sale_allocations (sale_item_id);
create index if not exists sale_allocations_lot_idx            on public.sale_allocations (lot_id);


-- -----------------------------------------------------------------------------
-- 3. Calculs tenus par la base (déclencheurs)
-- -----------------------------------------------------------------------------

-- Droits des déclencheurs :
--  - ceux qui MODIFIENT une autre table APRÈS une écriture (p3d_movement_touch_spool, p3d_touch_lot,
--    p3d_remember_delete) utilisent les droits du propriétaire (security definer) : quand Supabase
--    supprime un compte, les suppressions en cascade sont faites par le rôle interne d'Auth, qui n'a
--    aucun droit sur ces tables. Ils ne s'exécutent qu'après les contrôles de sécurité et de clés
--    étrangères, donc uniquement sur des lignes du même compte.
--  - ceux qui CALCULENT une valeur AVANT l'écriture (p3d_spool_recompute, p3d_lot_recompute) gardent
--    les droits de l'utilisateur : ils s'exécutent avant le contrôle de sécurité, et avec les droits du
--    propriétaire un autre compte pourrait deviner, par essais, les chiffres d'un compte qui n'est pas le sien.

-- Poids restant = dernière pesée (ou poids initial) + consommations postérieures
create or replace function public.p3d_spool_recompute()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_measured numeric;
  v_at       timestamptz;
begin
  select m.measured_g, m.occurred_at
    into v_measured, v_at
    from public.spool_movements m
   where m.spool_id = new.id and m.kind = 'weigh'
   order by m.occurred_at desc, m.created_at desc
   limit 1;

  if found then
    new.remaining_weight_g := v_measured + coalesce((
      select sum(m.delta_g) from public.spool_movements m
       where m.spool_id = new.id and m.kind <> 'weigh' and m.occurred_at > v_at), 0);
  else
    new.remaining_weight_g := new.initial_weight_g + coalesce((
      select sum(m.delta_g) from public.spool_movements m
       where m.spool_id = new.id and m.kind <> 'weigh'), 0);
  end if;
  return new;
end
$$;

create or replace function public.p3d_movement_touch_spool()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.spools set updated_at = now() where id = old.spool_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.spools set updated_at = now() where id = new.spool_id;
  end if;
  return null;
end
$$;

-- Stock disponible = quantité produite − ventes − retraits
create or replace function public.p3d_lot_recompute()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.qty_available := new.quantity
    - coalesce((select sum(a.quantity) from public.sale_allocations a where a.lot_id = new.id), 0)
    - coalesce((select sum(s.quantity) from public.stock_adjustments s where s.lot_id = new.id), 0);
  return new;
end
$$;

create or replace function public.p3d_touch_lot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.production_stock set updated_at = now() where id = old.lot_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.production_stock set updated_at = now() where id = new.lot_id;
  end if;
  return null;
end
$$;

-- Une seule machine « par défaut » par compte
create or replace function public.p3d_machine_single_default()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_default then
    update public.machines
       set is_default = false
     where owner_id = new.owner_id and id <> new.id and is_default;
  end if;
  return new;
end
$$;

-- Horodatage updated_at sur toutes les tables (heure réelle, précise à la microseconde)
do $$
declare
  t text;
begin
  foreach t in array array['settings', 'machines', 'spools', 'templates', 'productions', 'spool_movements',
                           'production_stock', 'stock_adjustments', 'sales', 'sale_items', 'sale_allocations', 'orders']
  loop
    execute format('alter table public.%I alter column updated_at set default clock_timestamp()', t);
    execute format('drop trigger if exists p3d_a_touch on public.%I', t);
    execute format('create trigger p3d_a_touch before update on public.%I for each row execute function public.p3d_touch_updated_at()', t);
  end loop;
end
$$;

-- Lignes supprimées : une action rejouée plus tard (réponse perdue, appareil resté
-- hors-ligne) ne doit pas faire revenir une vente, une production ou une bobine supprimée
create table if not exists public.deleted_rows (
  owner_id   uuid not null,
  table_name text not null,
  row_id     uuid not null,
  deleted_at timestamptz not null default clock_timestamp(),
  primary key (owner_id, table_name, row_id)
);

create or replace function public.p3d_remember_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row uuid;
begin
  -- un retrait de stock est rejoué par son groupe (une action = plusieurs lignes)
  if tg_table_name = 'stock_adjustments' then
    v_row := old.group_id;
  else
    v_row := old.id;
  end if;
  insert into public.deleted_rows (owner_id, table_name, row_id)
  values (old.owner_id, tg_table_name, v_row)
  on conflict do nothing;
  return null;
end
$$;

create or replace function public.p3d_block_resurrection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.deleted_rows d
              where d.owner_id = new.owner_id and d.table_name = tg_table_name and d.row_id = new.id) then
    return null;
  end if;
  return new;
end
$$;

-- Second contrôle, APRÈS l'ajout : si la suppression a été validée pendant que l'ajout attendait
-- (même ligne supprimée sur un autre appareil au même instant), le contrôle « avant » ne pouvait
-- pas encore la voir. L'ajout est alors annulé au lieu de faire revenir la ligne.
create or replace function public.p3d_resurrection_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.deleted_rows d
              where d.owner_id = new.owner_id and d.table_name = tg_table_name and d.row_id = new.id) then
    raise exception using errcode = 'P3D10', message = 'Cet élément a été supprimé sur un autre appareil.';
  end if;
  return null;
end
$$;

create or replace function public.p3d_is_deleted(p_table text, p_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.deleted_rows d
                  where d.owner_id = (select auth.uid()) and d.table_name = p_table and d.row_id = p_id)
$$;

do $$
declare
  t text;
begin
  foreach t in array array['machines', 'spools', 'templates', 'productions', 'production_stock', 'stock_adjustments', 'sales', 'orders']
  loop
    execute format('drop trigger if exists p3d_z_remember_delete on public.%I', t);
    execute format('create trigger p3d_z_remember_delete after delete on public.%I for each row execute function public.p3d_remember_delete()', t);
  end loop;
  foreach t in array array['machines', 'spools', 'templates', 'orders']
  loop
    execute format('drop trigger if exists p3d_0_block_resurrection on public.%I', t);
    execute format('create trigger p3d_0_block_resurrection before insert on public.%I for each row execute function public.p3d_block_resurrection()', t);
    execute format('drop trigger if exists p3d_z_resurrection_check on public.%I', t);
    execute format('create trigger p3d_z_resurrection_check after insert on public.%I for each row execute function public.p3d_resurrection_check()', t);
  end loop;
end
$$;

drop trigger if exists p3d_b_spool_recompute on public.spools;
create trigger p3d_b_spool_recompute
  before insert or update on public.spools
  for each row execute function public.p3d_spool_recompute();

drop trigger if exists p3d_movement_touch_spool on public.spool_movements;
create trigger p3d_movement_touch_spool
  after insert or update or delete on public.spool_movements
  for each row execute function public.p3d_movement_touch_spool();

drop trigger if exists p3d_b_lot_recompute on public.production_stock;
create trigger p3d_b_lot_recompute
  before insert or update on public.production_stock
  for each row execute function public.p3d_lot_recompute();

drop trigger if exists p3d_allocation_touch_lot on public.sale_allocations;
create trigger p3d_allocation_touch_lot
  after insert or update or delete on public.sale_allocations
  for each row execute function public.p3d_touch_lot();

drop trigger if exists p3d_adjustment_touch_lot on public.stock_adjustments;
create trigger p3d_adjustment_touch_lot
  after insert or update or delete on public.stock_adjustments
  for each row execute function public.p3d_touch_lot();

drop trigger if exists p3d_b_machine_single_default on public.machines;
create trigger p3d_b_machine_single_default
  before insert or update on public.machines
  for each row execute function public.p3d_machine_single_default();


-- -----------------------------------------------------------------------------
-- 4. Actions de l'atelier (appelées par l'application)
--    Toutes renvoient les lignes à jour. Toutes sont rejouables sans doublon.
-- -----------------------------------------------------------------------------

create or replace function public.p3d_require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception using errcode = 'P3D00', message = 'Session expirée : reconnecte-toi.';
  end if;
  return v;
end
$$;

-- Production + mouvements + lot
create or replace function public.p3d_production_bundle(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'productions',      coalesce((select jsonb_agg(to_jsonb(p)) from public.productions p where p.id = p_id), '[]'::jsonb),
    'spool_movements',  coalesce((select jsonb_agg(to_jsonb(m)) from public.spool_movements m where m.production_id = p_id), '[]'::jsonb),
    'production_stock', coalesce((select jsonb_agg(to_jsonb(l)) from public.production_stock l where l.production_id = p_id), '[]'::jsonb),
    'spools',           coalesce((select jsonb_agg(to_jsonb(s)) from public.spools s
                                   where s.id in (select m.spool_id from public.spool_movements m where m.production_id = p_id)), '[]'::jsonb)
  )
$$;

-- Lancer une production (kind = production) ou déclarer un print raté (kind = failure)
create or replace function public.p3d_launch_production(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id   uuid := nullif(p ->> 'id', '')::uuid;
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'production');
  v_at   timestamptz := coalesce(nullif(p ->> 'occurred_at', '')::timestamptz, now());
  v_c    jsonb;
  v_g    numeric;
  v_template uuid := nullif(p ->> 'template_id', '')::uuid;
  v_machine  uuid := nullif(p ->> 'machine_id', '')::uuid;
  v_spool    uuid;
begin
  perform public.p3d_require_user();
  if v_id is null then
    raise exception using errcode = 'P3D09', message = 'Identifiant de production manquant.';
  end if;
  -- Déjà enregistrée ? Vérifié AVANT le registre des suppressions : une suppression en cours
  -- (pas encore validée) laisse la ligne visible ici ; une suppression validée est visible au registre.
  if exists (select 1 from public.productions where id = v_id) then
    return public.p3d_production_bundle(v_id);
  end if;
  if public.p3d_is_deleted('productions', v_id) then
    return jsonb_build_object('tombstoned', true);
  end if;
  -- Template ou machine supprimés entre-temps (autre appareil) : la production garde son nom et ses coûts
  if v_template is not null and public.p3d_is_deleted('templates', v_template) then
    v_template := null;
  end if;
  if v_machine is not null and public.p3d_is_deleted('machines', v_machine) then
    v_machine := null;
  end if;

  begin
    insert into public.productions (
      id, kind, template_id, item_name, quantity, failed_pct, failure_reason,
      machine_id, machine_rate, labor_rate, grams_total, purge_g_total,
      print_time_min_total, labor_min_total, material_cost, purge_cost,
      hardware_cost, machine_cost, labor_cost, total_cost, unit_cost,
      consumption, note, occurred_at)
    values (
      v_id, v_kind, v_template, btrim(p ->> 'item_name'),
      (p ->> 'quantity')::integer,
      coalesce(nullif(p ->> 'failed_pct', '')::numeric, 100), nullif(p ->> 'failure_reason', ''),
      v_machine,
      coalesce(nullif(p ->> 'machine_rate', '')::numeric, 0), coalesce(nullif(p ->> 'labor_rate', '')::numeric, 0),
      coalesce(nullif(p ->> 'grams_total', '')::numeric, 0), coalesce(nullif(p ->> 'purge_g_total', '')::numeric, 0),
      coalesce(nullif(p ->> 'print_time_min_total', '')::numeric, 0), coalesce(nullif(p ->> 'labor_min_total', '')::numeric, 0),
      coalesce(nullif(p ->> 'material_cost', '')::numeric, 0), coalesce(nullif(p ->> 'purge_cost', '')::numeric, 0),
      coalesce(nullif(p ->> 'hardware_cost', '')::numeric, 0), coalesce(nullif(p ->> 'machine_cost', '')::numeric, 0),
      coalesce(nullif(p ->> 'labor_cost', '')::numeric, 0), coalesce(nullif(p ->> 'total_cost', '')::numeric, 0),
      coalesce(nullif(p ->> 'unit_cost', '')::numeric, 0),
      coalesce(p -> 'consumption', '[]'::jsonb), nullif(p ->> 'note', ''), v_at);
  exception when unique_violation then
    -- même action envoyée deux fois en même temps
    return public.p3d_production_bundle(v_id);
  end;

  for v_c in select value from jsonb_array_elements(coalesce(p -> 'consumption', '[]'::jsonb))
  loop
    v_g := coalesce(nullif(v_c ->> 'grams', '')::numeric, 0);
    if v_g < 0 then
      raise exception using errcode = 'P3D09', message = 'Consommation négative refusée.';
    end if;
    v_spool := nullif(v_c ->> 'spool_id', '')::uuid;
    -- bobine supprimée entre-temps (possible seulement si elle n'avait aucun historique) : rien à déduire
    if v_spool is not null and v_g > 0 and not public.p3d_is_deleted('spools', v_spool) then
      insert into public.spool_movements (id, spool_id, production_id, kind, delta_g, occurred_at)
      values (coalesce(nullif(v_c ->> 'movement_id', '')::uuid, gen_random_uuid()),
              v_spool, v_id, v_kind, -v_g, v_at);
    end if;
  end loop;

  if v_kind = 'production' then
    insert into public.production_stock (id, production_id, template_id, item_name, unit_cost, quantity, occurred_at)
    values (coalesce(nullif(p ->> 'lot_id', '')::uuid, gen_random_uuid()), v_id,
            v_template, btrim(p ->> 'item_name'),
            coalesce(nullif(p ->> 'unit_cost', '')::numeric, 0), (p ->> 'quantity')::integer, v_at);
  end if;

  return public.p3d_production_bundle(v_id);
end
$$;

-- Annuler une production / un print raté (rend le filament aux bobines)
create or replace function public.p3d_delete_production(p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_spools uuid[];
  v_lots   uuid[];
  v_moves  uuid[];
  v_adjs   uuid[];
  v_done   uuid[];
begin
  perform public.p3d_require_user();

  select coalesce(array_agg(distinct m.spool_id), '{}'), coalesce(array_agg(m.id), '{}')
    into v_spools, v_moves
    from public.spool_movements m where m.production_id = p_id;
  select coalesce(array_agg(l.id), '{}') into v_lots
    from public.production_stock l where l.production_id = p_id;
  select coalesce(array_agg(s.id), '{}') into v_adjs
    from public.stock_adjustments s where s.lot_id = any (v_lots);

  if exists (select 1 from public.sale_allocations a where a.lot_id = any (v_lots)) then
    raise exception using errcode = 'P3D02',
      message = 'Des pièces de cette production ont déjà été vendues : supprime d''abord les ventes concernées.';
  end if;

  with d as (delete from public.productions where id = p_id returning id)
  select coalesce(array_agg(d.id), '{}') into v_done from d;

  if cardinality(v_done) = 0 then
    v_lots := '{}'; v_moves := '{}'; v_adjs := '{}';
  end if;

  return jsonb_build_object(
    'deleted', jsonb_build_object(
      'productions',       to_jsonb(v_done),
      'production_stock',  to_jsonb(v_lots),
      'stock_adjustments', to_jsonb(v_adjs),
      'spool_movements',   to_jsonb(v_moves)),
    'spools', coalesce((select jsonb_agg(to_jsonb(s)) from public.spools s where s.id = any (v_spools)), '[]'::jsonb)
  );
end
$$;

-- Pesée d'une bobine (poids NET, sans la bobine vide)
create or replace function public.p3d_weigh_spool(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id    uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_spool uuid := (p ->> 'spool_id')::uuid;
begin
  perform public.p3d_require_user();
  if not exists (select 1 from public.spool_movements where id = v_id) then
    -- pesée d'une bobine supprimée entre-temps sur un autre appareil
    if public.p3d_is_deleted('spools', v_spool) then
      return jsonb_build_object('tombstoned', true);
    end if;
    -- plus de 5 % au-dessus du poids initial : bobine vide oubliée (même règle que weighProblem() de l'appli)
    if (p ->> 'measured_g')::numeric > (select round(s.initial_weight_g * 1.05, 2) from public.spools s where s.id = v_spool) then
      raise exception using errcode = 'P3D09',
        message = 'Poids pesé supérieur au poids initial de la bobine : as-tu retiré le poids de la bobine vide ? Sinon, corrige le poids initial de la bobine.';
    end if;
    insert into public.spool_movements (id, spool_id, kind, measured_g, note, occurred_at)
    values (v_id, v_spool, 'weigh', (p ->> 'measured_g')::numeric, nullif(p ->> 'note', ''),
            coalesce(nullif(p ->> 'occurred_at', '')::timestamptz, now()))
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'spool_movements', coalesce((select jsonb_agg(to_jsonb(m)) from public.spool_movements m where m.id = v_id), '[]'::jsonb),
    'spools',          coalesce((select jsonb_agg(to_jsonb(s)) from public.spools s where s.id = v_spool), '[]'::jsonb)
  );
end
$$;

-- Ajouter des pièces déjà fabriquées (stock existant, sans consommer de filament)
create or replace function public.p3d_add_stock(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id       uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_template uuid := nullif(p ->> 'template_id', '')::uuid;
begin
  perform public.p3d_require_user();
  -- existence d'abord, registre des suppressions ensuite (voir p3d_launch_production)
  if not exists (select 1 from public.production_stock where id = v_id) then
    if public.p3d_is_deleted('production_stock', v_id) then
      return jsonb_build_object('tombstoned', true);
    end if;
    if v_template is not null and public.p3d_is_deleted('templates', v_template) then
      v_template := null;
    end if;
    insert into public.production_stock (id, template_id, item_name, unit_cost, quantity, note, occurred_at)
    values (v_id, v_template, btrim(p ->> 'item_name'),
            coalesce(nullif(p ->> 'unit_cost', '')::numeric, 0), (p ->> 'quantity')::integer,
            nullif(p ->> 'note', ''), coalesce(nullif(p ->> 'occurred_at', '')::timestamptz, now()))
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'production_stock', coalesce((select jsonb_agg(to_jsonb(l)) from public.production_stock l where l.id = v_id), '[]'::jsonb)
  );
end
$$;

-- Retirer des pièces du stock (les plus anciennes d'abord)
create or replace function public.p3d_adjust_stock(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_group    uuid := nullif(p ->> 'id', '')::uuid;
  v_template uuid := nullif(p ->> 'template_id', '')::uuid;
  v_name     text := btrim(coalesce(p ->> 'item_name', ''));
  v_need     integer := (p ->> 'quantity')::integer;
  v_lot      record;
  v_take     integer;
  v_lots     uuid[] := '{}';
begin
  perform public.p3d_require_user();
  if v_group is null then
    raise exception using errcode = 'P3D09', message = 'Identifiant de retrait manquant.';
  end if;
  -- deux envois simultanés du même retrait : le second attend puis voit le premier
  perform pg_advisory_xact_lock(hashtextextended('p3d_adjust:' || v_group::text, 0));

  if not exists (select 1 from public.stock_adjustments where group_id = v_group) then
    -- retrait déjà fait puis effacé (production supprimée ensuite) : on ne le refait pas
    if public.p3d_is_deleted('stock_adjustments', v_group) then
      return jsonb_build_object('tombstoned', true);
    end if;
    if v_template is not null and public.p3d_is_deleted('templates', v_template) then
      v_template := null;
    end if;
    if v_need is null or v_need < 1 then
      raise exception using errcode = 'P3D09', message = 'Quantité à retirer invalide.';
    end if;

    for v_lot in
      select l.id, l.unit_cost, l.qty_available
        from public.production_stock l
       where l.qty_available > 0
         and ((v_template is not null and l.template_id = v_template)
           or (v_template is null and l.template_id is null and l.item_name = v_name))
       order by l.occurred_at, l.created_at, l.id
       for update
    loop
      exit when v_need = 0;
      v_take := least(v_need, v_lot.qty_available);
      insert into public.stock_adjustments (group_id, lot_id, quantity, reason, unit_cost, note, occurred_at)
      values (v_group, v_lot.id, v_take, coalesce(nullif(p ->> 'reason', ''), 'casse'), v_lot.unit_cost,
              nullif(p ->> 'note', ''), coalesce(nullif(p ->> 'occurred_at', '')::timestamptz, now()));
      v_need := v_need - v_take;
    end loop;

    if v_need > 0 then
      raise exception using errcode = 'P3D01',
        message = format('Stock insuffisant pour « %s » : il manque %s %s.', v_name, v_need, case when v_need >= 2 then 'pièces' else 'pièce' end);
    end if;
  end if;

  select coalesce(array_agg(distinct s.lot_id), '{}') into v_lots
    from public.stock_adjustments s where s.group_id = v_group;

  return jsonb_build_object(
    'stock_adjustments', coalesce((select jsonb_agg(to_jsonb(s)) from public.stock_adjustments s where s.group_id = v_group), '[]'::jsonb),
    'production_stock',  coalesce((select jsonb_agg(to_jsonb(l)) from public.production_stock l where l.id = any (v_lots)), '[]'::jsonb)
  );
end
$$;

-- Vente + articles + pièces prises dans le stock
create or replace function public.p3d_sale_bundle(p_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'sales',            coalesce((select jsonb_agg(to_jsonb(s)) from public.sales s where s.id = p_id), '[]'::jsonb),
    'sale_items',       coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.sale_items i where i.sale_id = p_id), '[]'::jsonb),
    'sale_allocations', coalesce((select jsonb_agg(to_jsonb(a)) from public.sale_allocations a
                                   join public.sale_items i on i.id = a.sale_item_id where i.sale_id = p_id), '[]'::jsonb),
    'production_stock', coalesce((select jsonb_agg(to_jsonb(l)) from public.production_stock l
                                   where l.id in (select a.lot_id from public.sale_allocations a
                                                    join public.sale_items i on i.id = a.sale_item_id
                                                   where i.sale_id = p_id)), '[]'::jsonb),
    'orders',           coalesce((select jsonb_agg(to_jsonb(o)) from public.orders o where o.sale_id = p_id), '[]'::jsonb)
  )
$$;

create or replace function public.p3d_record_sale(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id        uuid := nullif(p ->> 'id', '')::uuid;
  v_item      jsonb;
  v_item_id   uuid;
  v_template  uuid;
  v_name      text;
  v_qty       integer;
  v_price     numeric;
  v_stock     boolean;
  v_need      integer;
  v_lot       record;
  v_take      integer;
  v_item_cogs numeric;
  v_cogs      numeric := 0;
  v_amount    numeric := 0;
  v_pos       integer := 0;
  v_order     uuid := nullif(p ->> 'order_id', '')::uuid;
  v_status    text;
begin
  perform public.p3d_require_user();
  if v_id is null then
    raise exception using errcode = 'P3D09', message = 'Identifiant de vente manquant.';
  end if;
  -- existence d'abord, registre des suppressions ensuite (voir p3d_launch_production)
  if exists (select 1 from public.sales where id = v_id) then
    return public.p3d_sale_bundle(v_id);
  end if;
  if public.p3d_is_deleted('sales', v_id) then
    return jsonb_build_object('tombstoned', true);
  end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception using errcode = 'P3D09', message = 'Une vente doit contenir au moins un article.';
  end if;
  -- vente d'une commande : jamais deux ventes pour la même commande (même règle dans l'appli).
  -- « for update » : deux appareils qui livrent en même temps passent l'un après l'autre.
  if v_order is not null then
    select o.status into v_status from public.orders o where o.id = v_order for update;
    if v_status = 'delivered' then
      raise exception using errcode = 'P3D11', message = 'Cette commande est déjà livrée (vente déjà enregistrée, peut-être sur un autre appareil).';
    elsif v_status = 'cancelled' then
      raise exception using errcode = 'P3D11', message = 'Cette commande est annulée : remets-la « à faire » avant de la livrer.';
    end if;
  end if;

  begin
    insert into public.sales (id, channel, customer, note, shipping_charged, shipping_cost, packaging_cost, platform_fee, occurred_at)
    values (v_id, coalesce(nullif(p ->> 'channel', ''), 'direct'), nullif(p ->> 'customer', ''), nullif(p ->> 'note', ''),
            coalesce(nullif(p ->> 'shipping_charged', '')::numeric, 0), coalesce(nullif(p ->> 'shipping_cost', '')::numeric, 0),
            coalesce(nullif(p ->> 'packaging_cost', '')::numeric, 0), coalesce(nullif(p ->> 'platform_fee', '')::numeric, 0),
            coalesce(nullif(p ->> 'occurred_at', '')::timestamptz, now()));
  exception when unique_violation then
    return public.p3d_sale_bundle(v_id);
  end;

  for v_item in select value from jsonb_array_elements(p -> 'items')
  loop
    v_item_id  := coalesce(nullif(v_item ->> 'id', '')::uuid, gen_random_uuid());
    v_template := nullif(v_item ->> 'template_id', '')::uuid;
    if v_template is not null and public.p3d_is_deleted('templates', v_template) then
      v_template := null; -- template supprimé entre-temps : ses lots sont retrouvés par leur nom
    end if;
    v_name     := btrim(coalesce(v_item ->> 'item_name', ''));
    v_qty      := (v_item ->> 'quantity')::integer;
    v_price    := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0);
    v_stock    := coalesce((v_item ->> 'from_stock')::boolean, true);

    insert into public.sale_items (id, sale_id, template_id, item_name, quantity, unit_price, from_stock, position)
    values (v_item_id, v_id, v_template, v_name, v_qty, v_price, v_stock, v_pos);
    v_pos := v_pos + 1;
    v_amount := v_amount + v_qty * v_price;

    if v_stock then
      v_need := v_qty;
      v_item_cogs := 0;
      for v_lot in
        select l.id, l.unit_cost, l.qty_available
          from public.production_stock l
         where l.qty_available > 0
           and ((v_template is not null and l.template_id = v_template)
             or (v_template is null and l.template_id is null and l.item_name = v_name))
         order by l.occurred_at, l.created_at, l.id
         for update
      loop
        exit when v_need = 0;
        v_take := least(v_need, v_lot.qty_available);
        insert into public.sale_allocations (sale_item_id, lot_id, quantity, unit_cost)
        values (v_item_id, v_lot.id, v_take, v_lot.unit_cost);
        v_item_cogs := v_item_cogs + v_take * v_lot.unit_cost;
        v_need := v_need - v_take;
      end loop;
      if v_need > 0 then
        raise exception using errcode = 'P3D01',
          message = format('Stock insuffisant pour « %s » : il manque %s %s.', v_name, v_need, case when v_need >= 2 then 'pièces' else 'pièce' end);
      end if;
    else
      v_item_cogs := v_qty * coalesce(nullif(v_item ->> 'unit_cost', '')::numeric, 0);
    end if;

    update public.sale_items
       set cogs = v_item_cogs, unit_cost = round(v_item_cogs / v_qty, 4)
     where id = v_item_id;
    v_cogs := v_cogs + v_item_cogs;
  end loop;

  update public.sales
     set amount = v_amount + shipping_charged, cogs = v_cogs
   where id = v_id;

  -- la commande est livrée dans la MÊME transaction : jamais la vente sans la commande, ni l'inverse
  if v_order is not null then
    update public.orders set status = 'delivered', sale_id = v_id
     where id = v_order and status in ('todo', 'ready');
  end if;

  return public.p3d_sale_bundle(v_id);
end
$$;

-- Annuler une vente (les pièces reviennent dans le stock)
create or replace function public.p3d_delete_sale(p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lots  uuid[];
  v_items uuid[];
  v_alloc uuid[];
  v_done  uuid[];
  v_orders uuid[];
begin
  perform public.p3d_require_user();
  -- commande livrée par cette vente : elle redevient « prête » (même règle dans l'appli) ;
  -- la clé étrangère efface ensuite son lien vers la vente
  with u as (update public.orders set status = case when status = 'delivered' then 'ready' else status end
              where sale_id = p_id returning id)
  select coalesce(array_agg(u.id), '{}') into v_orders from u;
  select coalesce(array_agg(i.id), '{}') into v_items from public.sale_items i where i.sale_id = p_id;
  select coalesce(array_agg(distinct a.lot_id), '{}'), coalesce(array_agg(a.id), '{}')
    into v_lots, v_alloc
    from public.sale_allocations a where a.sale_item_id = any (v_items);

  with d as (delete from public.sales where id = p_id returning id)
  select coalesce(array_agg(d.id), '{}') into v_done from d;

  if cardinality(v_done) = 0 then
    v_items := '{}'; v_alloc := '{}'; v_lots := '{}';
  end if;

  return jsonb_build_object(
    'deleted', jsonb_build_object(
      'sales',            to_jsonb(v_done),
      'sale_items',       to_jsonb(v_items),
      'sale_allocations', to_jsonb(v_alloc)),
    'production_stock', coalesce((select jsonb_agg(to_jsonb(l)) from public.production_stock l where l.id = any (v_lots)), '[]'::jsonb),
    'orders',           coalesce((select jsonb_agg(to_jsonb(o)) from public.orders o where o.id = any (v_orders)), '[]'::jsonb)
  );
end
$$;


-- -----------------------------------------------------------------------------
-- 5. Sécurité : chacun ne voit et ne modifie que ses propres données
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['settings', 'machines', 'spools', 'templates', 'productions', 'spool_movements',
                           'production_stock', 'stock_adjustments', 'sales', 'sale_items', 'sale_allocations', 'orders']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists p3d_owner_all on public.%I', t);
    execute format('create policy p3d_owner_all on public.%I for all to authenticated '
                   'using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end
$$;

-- Double authentification (facultative, activée dans l'appli : Paramètres → Double authentification).
-- Pour un compte qui a activé un code, toute lecture ou écriture exige une session validée par le
-- mot de passe ET le code (niveau « aal2 »). Erreur explicite plutôt qu'un résultat vide : l'appli sait
-- qu'il faut demander le code, et ne croit jamais les données effacées.
-- La fonction est dans un schéma privé, que l'API de Supabase n'expose pas (personne ne peut l'appeler).
create schema if not exists p3d_private;
revoke all on schema p3d_private from public;
grant usage on schema p3d_private to authenticated;

create or replace function p3d_private.mfa_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2'
     and exists (select 1 from auth.mfa_factors f
                 where f.user_id = (select auth.uid()) and f.status = 'verified') then
    raise exception using errcode = '42501', message = 'Code de double authentification requis.', hint = 'P3D2F';
  end if;
  return true;
end
$$;

revoke execute on function p3d_private.mfa_ok() from public;
grant execute on function p3d_private.mfa_ok() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['settings', 'machines', 'spools', 'templates', 'productions', 'spool_movements',
                           'production_stock', 'stock_adjustments', 'sales', 'sale_items', 'sale_allocations', 'orders']
  loop
    execute format('drop policy if exists p3d_mfa on public.%I', t);
    execute format('create policy p3d_mfa on public.%I as restrictive for all to authenticated '
                   'using ((select p3d_private.mfa_ok())) with check ((select p3d_private.mfa_ok()))', t);
  end loop;
end
$$;

-- Registre des suppressions : rempli uniquement par la base (déclencheur), lecture seule pour les comptes
alter table public.deleted_rows enable row level security;
drop policy if exists p3d_deleted_select on public.deleted_rows;
create policy p3d_deleted_select on public.deleted_rows for select to authenticated
  using (owner_id = (select auth.uid()));
drop policy if exists p3d_deleted_insert on public.deleted_rows;
revoke all on table public.deleted_rows from anon, authenticated;
grant select on table public.deleted_rows to authenticated;
drop policy if exists p3d_mfa on public.deleted_rows;
create policy p3d_mfa on public.deleted_rows as restrictive for select to authenticated
  using ((select p3d_private.mfa_ok()));

grant usage on schema public to authenticated;

revoke execute on function
  public.p3d_launch_production(jsonb), public.p3d_delete_production(uuid),
  public.p3d_weigh_spool(jsonb), public.p3d_add_stock(jsonb), public.p3d_adjust_stock(jsonb),
  public.p3d_record_sale(jsonb), public.p3d_delete_sale(uuid),
  public.p3d_production_bundle(uuid), public.p3d_sale_bundle(uuid), public.p3d_require_user(),
  public.p3d_is_deleted(text, uuid),
  public.p3d_spool_recompute(), public.p3d_movement_touch_spool(), public.p3d_lot_recompute(),
  public.p3d_touch_lot(), public.p3d_machine_single_default(), public.p3d_touch_updated_at(),
  public.p3d_remember_delete(), public.p3d_block_resurrection(), public.p3d_resurrection_check(),
  public.p3d_version(), public.p3d_materials_valid(jsonb)
from public, anon;

grant execute on function
  public.p3d_launch_production(jsonb), public.p3d_delete_production(uuid),
  public.p3d_weigh_spool(jsonb), public.p3d_add_stock(jsonb), public.p3d_adjust_stock(jsonb),
  public.p3d_record_sale(jsonb), public.p3d_delete_sale(uuid),
  public.p3d_production_bundle(uuid), public.p3d_sale_bundle(uuid), public.p3d_require_user(),
  public.p3d_is_deleted(text, uuid), public.p3d_version(), public.p3d_materials_valid(jsonb)
to authenticated;

-- Fonctions des déclencheurs : personne ne peut les appeler directement, même connecté (Supabase donne
-- ce droit par défaut à tout nouvel objet). Les déclencheurs, eux, n'ont pas besoin de ce droit.
revoke execute on function
  public.p3d_spool_recompute(), public.p3d_movement_touch_spool(), public.p3d_lot_recompute(),
  public.p3d_touch_lot(), public.p3d_machine_single_default(), public.p3d_touch_updated_at(),
  public.p3d_remember_delete(), public.p3d_block_resurrection(), public.p3d_resurrection_check()
from authenticated;

-- Fonction ajoutée par Supabase à la création du projet (option « RLS automatique ») : c'est une
-- fonction de déclencheur d'évènement, qui marche sans ce droit. On retire seulement la possibilité
-- de l'appeler par l'API (avertissement du Security Advisor). Absente = rien à faire.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable' and p.pronargs = 0
               and p.prorettype = 'event_trigger'::regtype) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 6. Temps réel : le PC et le téléphone se mettent à jour instantanément
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['settings', 'machines', 'spools', 'templates', 'productions', 'spool_movements',
                             'production_stock', 'stock_adjustments', 'sales', 'sale_items', 'sale_allocations', 'orders']
    loop
      if not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 7. Signe de vie (voir .github/workflows/veille-supabase.yml)
--    Un projet Supabase gratuit sans aucune requête pendant 7 jours est mis en pause : l'appli ne
--    marcherait plus jusqu'à un clic « Restore ». Deux fois par semaine, GitHub appelle cette fonction.
--    Elle ne lit ni n'écrit AUCUNE donnée : c'est la seule fonction appelable sans compte.
-- -----------------------------------------------------------------------------

create or replace function public.p3d_ping()
returns boolean
language sql
stable
set search_path = ''
as $$ select true $$;

revoke execute on function public.p3d_ping() from public;
grant execute on function public.p3d_ping() to anon, authenticated;

-- Fin du script. Vérification rapide : « select public.p3d_version(); » doit renvoyer 3.

-- Casa Compras: esquema inicial (MVP)
-- Todas las tablas cuelgan de un hogar (household). El acceso se restringe con RLS
-- a los miembros del hogar.

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

create or replace function public.norm(t text) returns text
language sql immutable parallel safe as $$
  select regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '\s+', ' ', 'g')
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Hogar y miembros
-- ---------------------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 40),
  email text,
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index members_user_idx on public.members(user_id);

-- Lista de emails autorizados. Al crearse un usuario con uno de estos emails
-- se le añade automáticamente al hogar.
create table public.household_invites (
  email text primary key check (email = lower(email)),
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null
);

create or replace function public.is_member(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where household_id = hid and user_id = auth.uid())
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.members (household_id, user_id, display_name, email)
  select i.household_id, new.id, i.display_name, lower(new.email)
  from public.household_invites i
  where i.email = lower(new.email)
  on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

create type public.budget_group as enum ('alimentacion', 'limpieza', 'higiene', 'papel_lavanderia', 'otros');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  travel text not null default 'coche' check (travel in ('andando', 'coche', 'online')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index stores_name_uq on public.stores(household_id, public.norm(name));

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  grp public.budget_group not null default 'alimentacion',
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create unique index categories_name_uq on public.categories(household_id, public.norm(name));

create table public.products (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  name_norm text not null default '',
  category_id uuid references public.categories(id) on delete set null,
  -- Unidad de medida comparable y tamaño del formato habitual en esa unidad.
  -- Ej.: arroz 1 kg -> unit 'kg', pack_size 1; papel 12 rollos -> unit 'ud', pack_size 12.
  unit text not null default 'ud' check (unit in ('ud', 'kg', 'l', 'dosis')),
  pack_size numeric(10, 3) check (pack_size is null or pack_size > 0),
  usual_store_id uuid references public.stores(id) on delete set null,
  is_staple boolean not null default false,
  min_qty numeric(10, 2) check (min_qty is null or min_qty >= 0),
  restock_days int check (restock_days is null or restock_days > 0),
  location text check (location is null or location in ('nevera', 'congelador', 'despensa', 'bano', 'limpieza', 'otro')),
  last_price numeric(10, 2) check (last_price is null or last_price >= 0),
  notes text check (notes is null or length(notes) <= 500),
  archived boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_name_uq on public.products(household_id, name_norm) where not archived;

create or replace function public.products_before_write() returns trigger
language plpgsql as $$
begin
  new.name := btrim(new.name);
  new.name_norm := public.norm(new.name);
  new.updated_at := now();
  return new;
end $$;
create trigger products_before_write before insert or update on public.products
  for each row execute function public.products_before_write();

-- ---------------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------------

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  purchased_on date not null default current_date,
  total_paid numeric(10, 2) not null check (total_paid >= 0),
  paid_by uuid references auth.users(id) on delete set null,
  source text not null default 'lista' check (source in ('lista', 'manual', 'foto', 'pdf')),
  unplanned boolean not null default false,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index purchases_month_idx on public.purchases(household_id, purchased_on);

create table public.purchase_lines (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  qty numeric(10, 3) not null default 1 check (qty > 0),
  unit text not null default 'ud' check (unit in ('ud', 'kg', 'l', 'dosis')),
  pack_size numeric(10, 3) check (pack_size is null or pack_size > 0),
  line_total numeric(10, 2) not null check (line_total >= 0),
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  grp public.budget_group not null default 'otros'
);
create index purchase_lines_purchase_idx on public.purchase_lines(purchase_id);
create index purchase_lines_product_idx on public.purchase_lines(product_id);

create table public.shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  qty numeric(10, 3) not null default 1 check (qty > 0),
  est_price numeric(10, 2) check (est_price is null or est_price >= 0),
  store_id uuid references public.stores(id) on delete set null,
  note text check (note is null or length(note) <= 200),
  added_by uuid references auth.users(id) on delete set null default auth.uid(),
  added_at timestamptz not null default now(),
  checked boolean not null default false,
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  purchase_id uuid references public.purchases(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- Un producto solo puede estar una vez en la lista activa: evita duplicados
-- aunque los dos lo añadan a la vez.
create unique index shopping_items_active_uq on public.shopping_items(household_id, product_id)
  where purchase_id is null;
create trigger shopping_items_touch before update on public.shopping_items
  for each row execute function public.touch_updated_at();

create table public.price_observations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  observed_on date not null default current_date,
  price numeric(10, 2) not null check (price >= 0), -- precio de un formato
  unit text not null default 'ud' check (unit in ('ud', 'kg', 'l', 'dosis')),
  pack_size numeric(10, 3) check (pack_size is null or pack_size > 0),
  unit_price numeric(12, 4) generated always as (case when pack_size > 0 then price / pack_size end) stored,
  source text not null check (source in ('ticket', 'manual', 'estimado', 'oferta')),
  purchase_line_id uuid references public.purchase_lines(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index price_obs_product_idx on public.price_observations(product_id, observed_on desc);

-- ---------------------------------------------------------------------------
-- Inventario, presupuesto, eventos
-- ---------------------------------------------------------------------------

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  qty numeric(10, 3) not null default 0 check (qty >= 0),
  location text check (location is null or location in ('nevera', 'congelador', 'despensa', 'bano', 'limpieza', 'otro')),
  expires_on date,
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (household_id, product_id)
);
create trigger inventory_touch before update on public.inventory
  for each row execute function public.touch_updated_at();

create table public.budgets (
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  grp text not null check (grp in ('alimentacion', 'limpieza', 'higiene', 'papel_lavanderia', 'otros', 'total')),
  amount numeric(10, 2) not null check (amount >= 0),
  primary key (household_id, month, grp)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  kind text not null check (kind in ('duplicate_avoided', 'ran_out', 'wasted', 'purchase_closed', 'session')),
  product_id uuid references public.products(id) on delete set null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_kind_idx on public.events(household_id, kind, created_at);

-- ---------------------------------------------------------------------------
-- Seguridad: RLS por hogar
-- ---------------------------------------------------------------------------

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.household_invites enable row level security;

create policy households_select on public.households for select to authenticated using (public.is_member(id));
create policy households_update on public.households for update to authenticated using (public.is_member(id)) with check (public.is_member(id));
create policy members_select on public.members for select to authenticated using (public.is_member(household_id));
create policy members_update_self on public.members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Cada uno solo puede cambiar su nombre visible, nunca de hogar.
revoke update on public.members from authenticated, anon;
grant update (display_name) on public.members to authenticated;
-- household_invites: sin políticas, solo accesible desde el editor SQL.

do $$
declare t text;
begin
  foreach t in array array['stores', 'categories', 'products', 'purchases', 'purchase_lines',
                           'shopping_items', 'price_observations', 'inventory', 'budgets', 'events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id))', t || '_member', t);
  end loop;
end $$;

-- El precio de una línea o un producto de otro hogar no puede colarse por clave ajena:
-- comprobamos que las referencias pertenecen al mismo hogar.
create or replace function public.check_same_household() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ref record;
  ok boolean;
begin
  for ref in
    select * from (values
      ('products', to_jsonb(new) ->> 'product_id'),
      ('stores', coalesce(to_jsonb(new) ->> 'store_id', to_jsonb(new) ->> 'usual_store_id')),
      ('categories', to_jsonb(new) ->> 'category_id'),
      ('purchases', to_jsonb(new) ->> 'purchase_id')
    ) v(tbl, id)
    where v.id is not null
  loop
    -- EXECUTE no actualiza FOUND: usamos exists() con INTO.
    execute format('select exists(select 1 from public.%I where id = $1 and household_id = $2)', ref.tbl)
      into ok using ref.id::uuid, new.household_id;
    if not ok then
      raise exception 'referencia a % de otro hogar', ref.tbl;
    end if;
  end loop;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['products', 'purchases', 'purchase_lines', 'shopping_items',
                           'price_observations', 'inventory'] loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.check_same_household()', t || '_same_hh', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Cerrar una compra: crea compra + líneas + precios, suma al inventario y
-- retira de la lista lo comprado. Todo en una transacción.
--
-- p_lines: [{ "product_id": uuid, "qty": n, "line_total": n,
--             "shopping_item_id": uuid|null, "pack_size": n|null, "unit": text|null }]
-- ---------------------------------------------------------------------------

create or replace function public.close_purchase(
  p_household uuid,
  p_store uuid,
  p_date date,
  p_total numeric,
  p_paid_by uuid,
  p_unplanned boolean,
  p_lines jsonb,
  p_notes text default null,
  p_source text default 'lista',
  p_purchase_id uuid default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_purchase uuid := coalesce(p_purchase_id, gen_random_uuid());
  l jsonb;
  v_prod public.products;
  v_line uuid;
  v_qty numeric;
  v_total numeric;
  v_pack numeric;
  v_unit text;
  v_grp public.budget_group;
begin
  if not public.is_member(p_household) then
    raise exception 'sin acceso a este hogar';
  end if;
  if p_total is null or p_total < 0 then
    raise exception 'el importe pagado debe ser 0 o mayor';
  end if;
  -- Idempotente: si ya existe (reintento sin conexión), no se duplica.
  if exists (select 1 from public.purchases where id = v_purchase) then
    return v_purchase;
  end if;

  insert into public.purchases (id, household_id, store_id, purchased_on, total_paid, paid_by, source, unplanned, notes)
  values (v_purchase, p_household, p_store, coalesce(p_date, current_date), round(p_total, 2),
          p_paid_by, coalesce(p_source, 'lista'), coalesce(p_unplanned, false), nullif(btrim(p_notes), ''));

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into v_prod from public.products
      where id = (l ->> 'product_id')::uuid and household_id = p_household;
    if not found then
      raise exception 'producto no encontrado';
    end if;
    v_qty := coalesce((l ->> 'qty')::numeric, 1);
    v_total := (l ->> 'line_total')::numeric;
    v_pack := coalesce((l ->> 'pack_size')::numeric, v_prod.pack_size);
    v_unit := coalesce(l ->> 'unit', v_prod.unit);
    if v_qty <= 0 then
      raise exception 'cantidad no válida para %', v_prod.name;
    end if;

    select coalesce(c.grp, 'otros') into v_grp from public.categories c where c.id = v_prod.category_id;
    v_grp := coalesce(v_grp, 'otros');

    if v_total is not null then
      insert into public.purchase_lines (household_id, purchase_id, product_id, name, qty, unit, pack_size, line_total, grp)
      values (p_household, v_purchase, v_prod.id, v_prod.name, v_qty, v_unit, v_pack, round(v_total, 2), v_grp)
      returning id into v_line;

      insert into public.price_observations (household_id, product_id, store_id, observed_on, price, unit, pack_size, source, purchase_line_id)
      values (p_household, v_prod.id, p_store, coalesce(p_date, current_date), round(v_total / v_qty, 2),
              v_unit, v_pack, 'ticket', v_line);

      update public.products set last_price = round(v_total / v_qty, 2) where id = v_prod.id;
    end if;

    insert into public.inventory (household_id, product_id, qty, location)
    values (p_household, v_prod.id, v_qty, v_prod.location)
    on conflict (household_id, product_id) do update set qty = public.inventory.qty + excluded.qty;

    if l ? 'shopping_item_id' and l ->> 'shopping_item_id' is not null then
      update public.shopping_items set purchase_id = v_purchase, checked = true,
        checked_by = coalesce(checked_by, auth.uid()), checked_at = coalesce(checked_at, now())
      where id = (l ->> 'shopping_item_id')::uuid and household_id = p_household and purchase_id is null;
    end if;
  end loop;

  insert into public.events (household_id, kind, data)
  values (p_household, 'purchase_closed', jsonb_build_object('purchase_id', v_purchase, 'total', p_total));

  return v_purchase;
end $$;

-- Borrar una compra deshace su efecto en el inventario (sin bajar de 0).
create or replace function public.delete_purchase(p_purchase uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_hh uuid;
begin
  select household_id into v_hh from public.purchases where id = p_purchase;
  if v_hh is null or not public.is_member(v_hh) then
    raise exception 'compra no encontrada';
  end if;
  update public.inventory i set qty = greatest(0, i.qty - s.qty)
  from (select product_id, sum(qty) qty from public.purchase_lines where purchase_id = p_purchase group by product_id) s
  where i.product_id = s.product_id and i.household_id = v_hh;
  delete from public.purchases where id = p_purchase;
end $$;

-- ---------------------------------------------------------------------------
-- Alta del hogar con datos iniciales. Se ejecuta una vez desde el editor SQL.
-- ---------------------------------------------------------------------------

create or replace function public.setup_household(p_name text, p_invites jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_hh uuid;
  i jsonb;
begin
  insert into public.households(name) values (p_name) returning id into v_hh;

  insert into public.categories (household_id, name, grp, sort) values
    (v_hh, 'Fruta y verdura', 'alimentacion', 10),
    (v_hh, 'Carne y pescado', 'alimentacion', 20),
    (v_hh, 'Lácteos y huevos', 'alimentacion', 30),
    (v_hh, 'Panadería', 'alimentacion', 40),
    (v_hh, 'Despensa', 'alimentacion', 50),
    (v_hh, 'Congelados', 'alimentacion', 60),
    (v_hh, 'Platos preparados', 'alimentacion', 70),
    (v_hh, 'Bebidas', 'alimentacion', 80),
    (v_hh, 'Limpieza', 'limpieza', 100),
    (v_hh, 'Higiene personal', 'higiene', 110),
    (v_hh, 'Papel', 'papel_lavanderia', 120),
    (v_hh, 'Lavandería', 'papel_lavanderia', 130),
    (v_hh, 'Otros', 'otros', 200);

  insert into public.stores (household_id, name, travel, sort) values
    (v_hh, 'Mercadona', 'coche', 10),
    (v_hh, 'Ahorramas', 'coche', 20),
    (v_hh, 'La Despensa', 'andando', 30),
    (v_hh, 'Alcampo', 'coche', 40),
    (v_hh, 'Carrefour', 'coche', 50);

  for i in select * from jsonb_array_elements(p_invites) loop
    insert into public.household_invites (email, household_id, display_name)
    values (lower(i ->> 'email'), v_hh, i ->> 'name')
    on conflict (email) do update set household_id = excluded.household_id, display_name = excluded.display_name;
  end loop;

  -- Usuarios que ya existían antes del alta.
  insert into public.members (household_id, user_id, display_name, email)
  select v_hh, u.id, inv.display_name, lower(u.email)
  from auth.users u join public.household_invites inv on inv.email = lower(u.email)
  where inv.household_id = v_hh
  on conflict do nothing;

  return v_hh;
end $$;

revoke execute on function public.setup_household(text, jsonb) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sincronización en vivo
-- ---------------------------------------------------------------------------

alter table public.shopping_items replica identity full;
alter table public.inventory replica identity full;
alter table public.products replica identity full;

alter publication supabase_realtime add table
  public.shopping_items, public.inventory, public.products, public.purchases,
  public.stores, public.categories, public.budgets, public.members;

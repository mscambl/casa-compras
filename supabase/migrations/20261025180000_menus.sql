-- Casa Compras: recetas y menú semanal.

-- Preferencias del hogar (ingredientes excluidos, tiempo máximo, equipamiento...).
alter table public.households add column if not exists prefs jsonb not null default '{}';

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  slot text not null default 'ambas' check (slot in ('comida', 'cena', 'ambas')),
  prep_min int not null default 15 check (prep_min between 0 and 240),
  equipment text not null default 'ninguno' check (equipment in ('ninguno', 'microondas', 'fuego', 'horno')),
  tags text[] not null default '{}',
  -- [{ "name": "Pechuga de pollo", "amount": 150, "unit": "g", "basic": false }] por ración
  ingredients jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array'),
  steps text check (steps is null or length(steps) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index recipes_household_idx on public.recipes(household_id);

create table public.meal_plan (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  day date not null,
  slot text not null check (slot in ('comida', 'cena')),
  recipe_id uuid references public.recipes(id) on delete set null,
  servings numeric(4, 1) not null default 1 check (servings > 0 and servings <= 20),
  status text not null default 'plan' check (status in ('plan', 'fuera', 'sobras')),
  note text check (note is null or length(note) <= 200),
  updated_by uuid references auth.users(id) on delete set null default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (household_id, day, slot)
);

alter table public.recipes enable row level security;
alter table public.meal_plan enable row level security;
create policy recipes_member on public.recipes for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy meal_plan_member on public.meal_plan for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

create trigger meal_plan_touch before update on public.meal_plan
  for each row execute function public.touch_updated_at();

-- La receta del menú tiene que ser del mismo hogar.
create or replace function public.check_plan_recipe() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recipe_id is not null and not exists (
    select 1 from public.recipes where id = new.recipe_id and household_id = new.household_id
  ) then
    raise exception 'receta de otro hogar';
  end if;
  return new;
end $$;
create trigger meal_plan_same_hh before insert or update on public.meal_plan
  for each row execute function public.check_plan_recipe();

alter table public.meal_plan replica identity full;
alter publication supabase_realtime add table public.recipes, public.meal_plan, public.households;

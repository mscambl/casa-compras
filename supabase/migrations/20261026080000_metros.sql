-- Formato en metros (papel de aluminio, film, bolsas de rollo…). En la app se
-- puede escribir en m o cm; se guarda en metros.
alter table public.products drop constraint if exists products_unit_check;
alter table public.products add constraint products_unit_check check (unit in ('ud', 'kg', 'l', 'dosis', 'm'));
alter table public.purchase_lines drop constraint if exists purchase_lines_unit_check;
alter table public.purchase_lines add constraint purchase_lines_unit_check check (unit in ('ud', 'kg', 'l', 'dosis', 'm'));
alter table public.price_observations drop constraint if exists price_observations_unit_check;
alter table public.price_observations add constraint price_observations_unit_check check (unit in ('ud', 'kg', 'l', 'dosis', 'm'));

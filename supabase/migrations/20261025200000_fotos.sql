-- Fotos e información de productos: código de barras, fotos propias y datos
-- de Open Food Facts (ingredientes, alérgenos, nutrición).

alter table public.products
  add column if not exists barcode text check (barcode is null or barcode ~ '^[0-9]{8,14}$'),
  add column if not exists photos text[] not null default '{}' check (cardinality(photos) <= 8),
  add column if not exists info jsonb check (info is null or jsonb_typeof(info) = 'object');

create index if not exists products_barcode_idx on public.products(household_id, barcode) where barcode is not null;

-- Almacenamiento privado. Cada foto va en <household_id>/<product_id>/<id>.jpg
-- y solo la ven los miembros de ese hogar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', false, 3145728, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

create or replace function public.photo_household_ok(path text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare hid uuid;
begin
  begin
    hid := split_part(path, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return public.is_member(hid);
end $$;
revoke all on function public.photo_household_ok(text) from public;
grant execute on function public.photo_household_ok(text) to authenticated;

drop policy if exists product_photos_select on storage.objects;
drop policy if exists product_photos_insert on storage.objects;
drop policy if exists product_photos_update on storage.objects;
drop policy if exists product_photos_delete on storage.objects;
create policy product_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and public.photo_household_ok(name));
create policy product_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and public.photo_household_ok(name));
create policy product_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'product-photos' and public.photo_household_ok(name))
  with check (bucket_id = 'product-photos' and public.photo_household_ok(name));
create policy product_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and public.photo_household_ok(name));

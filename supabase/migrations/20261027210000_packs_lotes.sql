-- Packs y caducidades por lotes.
-- products.codes: todos los códigos de barras del producto con sus unidades
--   [{"code": "8410000001235", "units": 1}, {"code": "8410000001242", "units": 6}]
-- inventory.lots: lo que hay repartido por fechas de caducidad
--   [{"id": "...", "qty": 4, "expires_on": "2026-11-02"}]; inventory.expires_on guarda la más próxima.
alter table public.products
  add column if not exists codes jsonb not null default '[]' check (jsonb_typeof(codes) = 'array' and jsonb_array_length(codes) <= 20);
alter table public.inventory
  add column if not exists lots jsonb not null default '[]' check (jsonb_typeof(lots) = 'array' and jsonb_array_length(lots) <= 50);

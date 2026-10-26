-- Para cuántas personas están escritas las cantidades de cada receta (1 o 2 normalmente).
-- La lista de la compra divide por este número y multiplica por los comensales del día.
alter table public.recipes
  add column if not exists yields smallint not null default 1 check (yields between 1 and 8);

-- Nuevos métodos de cocina para las recetas: airfryer y vaporera.
alter table public.recipes drop constraint if exists recipes_equipment_check;
alter table public.recipes add constraint recipes_equipment_check
  check (equipment in ('ninguno', 'microondas', 'fuego', 'horno', 'airfryer', 'vaporera'));

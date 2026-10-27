-- Editar una compra ya cerrada: cambiar tienda, fecha, importe, cantidades y precios,
-- quitar o añadir líneas y separarla en varias compras (una por tienda).
--
-- p_parts es una lista de compras. La primera conserva el id de la compra original;
-- las demás son compras nuevas (con su id, para que un reintento no duplique nada):
--   [{ id, store_id, purchased_on, total_paid, paid_by, unplanned, notes,
--      lines: [{ product_id, qty, line_total }] }]
-- «En casa» solo cambia por la diferencia de cantidades entre antes y después, y el
-- historial de precios se rehace con la tienda y la fecha nuevas.

create or replace function public.edit_purchase(p_purchase uuid, p_parts jsonb) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_old public.purchases;
  part jsonb;
  l jsonb;
  v_id uuid;
  v_first boolean := true;
  v_prod public.products;
  v_line uuid;
  v_qty numeric;
  v_total numeric;
  v_date date;
  v_store uuid;
  v_grp public.budget_group;
begin
  select * into v_old from public.purchases where id = p_purchase for update;
  if not found or not public.is_member(v_old.household_id) then
    raise exception 'compra no encontrada';
  end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 or jsonb_array_length(p_parts) > 10 then
    raise exception 'partes de la compra no válidas';
  end if;
  if (p_parts -> 0 ->> 'id')::uuid is distinct from p_purchase then
    raise exception 'la primera parte tiene que ser la compra original';
  end if;
  -- Reintento: si alguna compra nueva ya existe, el cambio ya se aplicó.
  if exists (
    select 1 from jsonb_array_elements(p_parts) with ordinality x(p, n)
    join public.purchases pu on pu.id = (x.p ->> 'id')::uuid
    where x.n > 1
  ) then
    return;
  end if;

  -- Lo que había entrado en casa con esta compra.
  create temp table if not exists _edit_old (product_id uuid primary key, qty numeric) on commit drop;
  create temp table if not exists _edit_new (product_id uuid primary key, qty numeric) on commit drop;
  delete from _edit_old where true; -- Supabase exige WHERE en los DELETE
  delete from _edit_new where true; -- Supabase exige WHERE en los DELETE
  insert into _edit_old
    select product_id, sum(qty) from public.purchase_lines
    where purchase_id = p_purchase and product_id is not null group by product_id;

  -- Las líneas se rehacen (su precio en el historial se borra en cascada).
  delete from public.purchase_lines where purchase_id = p_purchase;

  for part in select * from jsonb_array_elements(p_parts) loop
    v_id := (part ->> 'id')::uuid;
    v_store := nullif(part ->> 'store_id', '')::uuid;
    v_date := coalesce((part ->> 'purchased_on')::date, v_old.purchased_on);
    v_total := (part ->> 'total_paid')::numeric;
    if v_total is null or v_total < 0 then
      raise exception 'el importe pagado debe ser 0 o mayor';
    end if;
    if v_store is not null and not exists (select 1 from public.stores where id = v_store and household_id = v_old.household_id) then
      raise exception 'tienda no encontrada';
    end if;

    if v_first then
      update public.purchases set store_id = v_store, purchased_on = v_date, total_paid = round(v_total, 2),
        paid_by = case when part ? 'paid_by' then nullif(part ->> 'paid_by', '')::uuid else paid_by end,
        unplanned = coalesce((part ->> 'unplanned')::boolean, unplanned),
        notes = case when part ? 'notes' then nullif(btrim(part ->> 'notes'), '') else notes end
      where id = p_purchase;
      v_first := false;
    else
      insert into public.purchases (id, household_id, store_id, purchased_on, total_paid, paid_by, source, unplanned, notes)
      values (v_id, v_old.household_id, v_store, v_date, round(v_total, 2),
              case when part ? 'paid_by' then nullif(part ->> 'paid_by', '')::uuid else v_old.paid_by end,
              v_old.source, coalesce((part ->> 'unplanned')::boolean, v_old.unplanned),
              case when part ? 'notes' then nullif(btrim(part ->> 'notes'), '') else v_old.notes end);
    end if;

    for l in select * from jsonb_array_elements(coalesce(part -> 'lines', '[]'::jsonb)) loop
      select * into v_prod from public.products
        where id = (l ->> 'product_id')::uuid and household_id = v_old.household_id;
      if not found then
        raise exception 'producto no encontrado';
      end if;
      v_qty := (l ->> 'qty')::numeric;
      if v_qty is null or v_qty <= 0 then
        raise exception 'cantidad no válida para %', v_prod.name;
      end if;
      v_total := (l ->> 'line_total')::numeric;
      if v_total is null or v_total < 0 then
        raise exception 'falta el importe de %', v_prod.name;
      end if;
      select coalesce(c.grp, 'otros') into v_grp from public.categories c where c.id = v_prod.category_id;
      v_grp := coalesce(v_grp, 'otros');

      insert into public.purchase_lines (household_id, purchase_id, product_id, name, qty, unit, pack_size, line_total, grp)
      values (v_old.household_id, v_id, v_prod.id, v_prod.name, v_qty, v_prod.unit, v_prod.pack_size, round(v_total, 2), v_grp)
      returning id into v_line;

      insert into public.price_observations (household_id, product_id, store_id, observed_on, price, unit, pack_size, source, purchase_line_id)
      values (v_old.household_id, v_prod.id, v_store, v_date, round(v_total / v_qty, 2), v_prod.unit, v_prod.pack_size, 'ticket', v_line);

      insert into _edit_new values (v_prod.id, v_qty)
      on conflict (product_id) do update set qty = _edit_new.qty + excluded.qty;
    end loop;
  end loop;

  -- «En casa»: solo la diferencia.
  create temp table if not exists _edit_delta (product_id uuid primary key, delta numeric) on commit drop;
  delete from _edit_delta where true; -- Supabase exige WHERE en los DELETE
  insert into _edit_delta
    select coalesce(n.product_id, o.product_id), coalesce(n.qty, 0) - coalesce(o.qty, 0)
    from _edit_new n full join _edit_old o on o.product_id = n.product_id;
  update public.inventory i set qty = greatest(0, i.qty + d.delta)
  from _edit_delta d
  where i.household_id = v_old.household_id and i.product_id = d.product_id and d.delta <> 0;
  insert into public.inventory (household_id, product_id, qty, location)
  select v_old.household_id, d.product_id, d.delta, p.location
  from _edit_delta d join public.products p on p.id = d.product_id
  where d.delta > 0
  on conflict (household_id, product_id) do nothing;

  -- Último precio de cada producto tocado, según el historial que queda.
  update public.products p set last_price = h.price
  from (
    select distinct on (product_id) product_id, price from public.price_observations
    where household_id = v_old.household_id
      and product_id in (select product_id from _edit_old union select product_id from _edit_new)
    order by product_id, observed_on desc, created_at desc
  ) h
  where p.id = h.product_id;
end $$;

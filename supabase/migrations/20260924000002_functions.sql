-- PrintFlow — database functions
--
-- Business rules (pricing, costing, status workflow) live in the TypeScript
-- domain layer (src/lib/domain). These functions exist only where the database
-- must guarantee atomicity: creating an organization, allocating order
-- numbers, writing an order with its items/jobs in one transaction, and
-- decrementing filament stock without races.

-- ---------------------------------------------------------------------------
-- New auth user -> profile
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Organization bootstrap
-- ---------------------------------------------------------------------------

create or replace function public.create_organization(p_name text, p_currency text default 'GBP')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_ad5x uuid;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Business name is required' using errcode = '22023';
  end if;

  insert into public.organizations (name) values (trim(p_name)) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_user, 'owner');

  -- The two printers this business actually owns. Status is manual in Phase 1.
  insert into public.printers (organization_id, name, manufacturer, model, status, capabilities, build_volume, notes)
  values (v_org, 'Flashforge AD5X', 'Flashforge', 'AD5X', 'idle',
          array['PLA', 'PETG', 'TPU', 'Multi-colour (4 spools)'], '220 × 220 × 220 mm', null)
  returning id into v_ad5x;
  insert into public.printers (organization_id, name, manufacturer, model, status, capabilities, build_volume, notes)
  values (v_org, 'Flashforge Adventurer 5M', 'Flashforge', 'Adventurer 5M', 'idle',
          array['PLA', 'PETG', 'TPU'], '220 × 220 × 220 mm', null);

  insert into public.settings (organization_id, business_name, currency, default_printer_id)
  values (v_org, trim(p_name), upper(coalesce(nullif(trim(p_currency), ''), 'GBP')), v_ad5x);

  update public.profiles set active_organization_id = v_org where id = v_user;

  insert into public.audit_logs (organization_id, actor_id, event, entity_type, entity_id, summary)
  values (v_org, v_user, 'organization.created', 'organization', v_org, 'Business created');

  return v_org;
end;
$$;

revoke execute on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Order numbers
-- ---------------------------------------------------------------------------

-- Allocates the next order number for an organization. The UPDATE takes a row
-- lock on the settings row, so concurrent orders never share a number.
create or replace function public.next_order_number(p_org uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_seq int;
  v_prefix text;
  v_format text;
  v_padding int;
  v_tz text;
  v_now timestamp;
begin
  update public.settings
     set next_order_number = next_order_number + 1
   where organization_id = p_org
  returning next_order_number - 1, order_number_prefix, order_number_format, order_number_padding, timezone
    into v_seq, v_prefix, v_format, v_padding, v_tz;

  if v_seq is null then
    raise exception 'Organization settings not found' using errcode = '42501';
  end if;

  v_now := now() at time zone v_tz;
  return replace(replace(replace(replace(replace(v_format,
    '{PREFIX}', v_prefix),
    '{YYYY}', to_char(v_now, 'YYYY')),
    '{YY}', to_char(v_now, 'YY')),
    '{MM}', to_char(v_now, 'MM')),
    '{SEQ}', lpad(v_seq::text, v_padding, '0'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Atomic order creation
-- ---------------------------------------------------------------------------

-- Inserts an order, its line items, one production job per line, the shipment
-- record, the initial status history and audit entries — all or nothing.
-- Monetary values are calculated by the application's domain layer and passed
-- in; RLS still applies because this runs as the calling user.
--
-- p_order    : order columns (see below)
-- p_items    : [{product_id, variant_id, sku, product_name, variant_name, quantity,
--               unit_price, unit_cost, material, colour, estimated_minutes,
--               estimated_grams, printer_id}]
-- p_shipment : {provider, service, shipping_cost}
create or replace function public.create_order(
  p_org uuid,
  p_order jsonb,
  p_items jsonb,
  p_shipment jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_order_id uuid;
  v_number text;
  v_item jsonb;
  v_item_id uuid;
  v_job_id uuid;
  v_is_demo boolean := coalesce((p_order ->> 'is_demo')::boolean, false);
  v_status public.order_status := coalesce((p_order ->> 'status')::public.order_status, 'new');
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not public.is_org_member(p_org) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item' using errcode = '22023';
  end if;

  v_number := public.next_order_number(p_org);

  insert into public.orders (
    organization_id, order_number, sales_channel, external_order_id, order_date,
    customer_id, customer_name, customer_email, customer_phone,
    billing_address, shipping_address,
    subtotal, shipping_charged, discount, product_cost, fees, estimated_profit,
    status, payment_status, customer_notes, internal_notes, is_demo, created_by
  ) values (
    p_org, v_number,
    coalesce((p_order ->> 'sales_channel')::public.sales_channel, 'manual'),
    nullif(trim(p_order ->> 'external_order_id'), ''),
    coalesce((p_order ->> 'order_date')::timestamptz, now()),
    nullif(p_order ->> 'customer_id', '')::uuid,
    p_order ->> 'customer_name',
    nullif(p_order ->> 'customer_email', ''),
    nullif(p_order ->> 'customer_phone', ''),
    p_order -> 'billing_address',
    p_order -> 'shipping_address',
    coalesce((p_order ->> 'subtotal')::numeric, 0),
    coalesce((p_order ->> 'shipping_charged')::numeric, 0),
    coalesce((p_order ->> 'discount')::numeric, 0),
    coalesce((p_order ->> 'product_cost')::numeric, 0),
    coalesce((p_order ->> 'fees')::numeric, 0),
    coalesce((p_order ->> 'estimated_profit')::numeric, 0),
    v_status,
    coalesce((p_order ->> 'payment_status')::public.payment_status, 'pending'),
    nullif(p_order ->> 'customer_notes', ''),
    nullif(p_order ->> 'internal_notes', ''),
    v_is_demo,
    v_user
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      organization_id, order_id, product_id, variant_id, sku, product_name, variant_name,
      quantity, unit_price, unit_cost
    ) values (
      p_org, v_order_id,
      nullif(v_item ->> 'product_id', '')::uuid,
      nullif(v_item ->> 'variant_id', '')::uuid,
      v_item ->> 'sku',
      v_item ->> 'product_name',
      nullif(v_item ->> 'variant_name', ''),
      (v_item ->> 'quantity')::int,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'unit_cost')::numeric, 0)
    )
    returning id into v_item_id;

    insert into public.production_jobs (
      organization_id, order_id, order_item_id, product_id, variant_id, product_name,
      quantity, printer_id, priority, material, colour, estimated_minutes, estimated_grams, is_demo
    ) values (
      p_org, v_order_id, v_item_id,
      nullif(v_item ->> 'product_id', '')::uuid,
      nullif(v_item ->> 'variant_id', '')::uuid,
      concat_ws(' — ', v_item ->> 'product_name', nullif(v_item ->> 'variant_name', '')),
      (v_item ->> 'quantity')::int,
      nullif(v_item ->> 'printer_id', '')::uuid,
      coalesce((p_order ->> 'priority')::public.job_priority, 'normal'),
      nullif(v_item ->> 'material', ''),
      nullif(v_item ->> 'colour', ''),
      coalesce((v_item ->> 'estimated_minutes')::int, 0),
      coalesce((v_item ->> 'estimated_grams')::numeric, 0),
      v_is_demo
    )
    returning id into v_job_id;

    insert into public.status_history (organization_id, entity_type, entity_id, from_status, to_status, changed_by)
    values (p_org, 'production_job', v_job_id, null, 'queued', v_user);
    insert into public.audit_logs (organization_id, actor_id, event, entity_type, entity_id, summary, metadata)
    values (p_org, v_user, 'production_job.created', 'production_job', v_job_id,
            format('Job created for %s × %s', v_item ->> 'quantity', v_item ->> 'product_name'),
            jsonb_build_object('order_id', v_order_id, 'order_number', v_number));
  end loop;

  insert into public.shipments (organization_id, order_id, provider, service, shipping_cost, is_demo)
  values (
    p_org, v_order_id,
    coalesce((p_shipment ->> 'provider')::public.shipping_provider, 'royal_mail'),
    nullif(p_shipment ->> 'service', ''),
    coalesce((p_shipment ->> 'shipping_cost')::numeric, 0),
    v_is_demo
  );

  insert into public.status_history (organization_id, entity_type, entity_id, from_status, to_status, changed_by)
  values (p_org, 'order', v_order_id, null, v_status::text, v_user);
  insert into public.audit_logs (organization_id, actor_id, event, entity_type, entity_id, summary, metadata)
  values (p_org, v_user, 'order.created', 'order', v_order_id,
          format('Order %s created', v_number),
          jsonb_build_object('order_number', v_number, 'sales_channel', p_order ->> 'sales_channel',
                             'items', jsonb_array_length(p_items)));

  return v_order_id;
end;
$$;

revoke execute on function public.create_order(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_order(uuid, jsonb, jsonb, jsonb) to authenticated;
revoke execute on function public.next_order_number(uuid) from public, anon;
grant execute on function public.next_order_number(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Filament usage (atomic stock decrement)
-- ---------------------------------------------------------------------------

create or replace function public.record_filament_usage(
  p_filament uuid,
  p_grams numeric,
  p_job uuid default null,
  p_note text default null
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_org uuid;
  v_remaining numeric;
  v_cpg numeric;
  v_threshold int;
  v_status public.spool_status;
begin
  if p_grams is null or p_grams <= 0 then
    raise exception 'Filament usage must be greater than zero' using errcode = '22023';
  end if;

  -- Row lock prevents two completions racing on the same spool.
  select organization_id, remaining_g, cost_per_gram, status
    into v_org, v_remaining, v_cpg, v_status
    from public.filaments
   where id = p_filament
   for update;

  if v_org is null then
    raise exception 'Filament spool not found' using errcode = 'P0002';
  end if;

  select low_filament_threshold_g into v_threshold from public.settings where organization_id = v_org;

  v_remaining := greatest(v_remaining - p_grams, 0);

  update public.filaments
     set remaining_g = v_remaining,
         status = case
           when v_status = 'archived' then v_status
           when v_remaining = 0 then 'empty'
           when v_remaining <= coalesce(v_threshold, 0) then 'low'
           else 'in_use'
         end
   where id = p_filament;

  insert into public.filament_usage (organization_id, filament_id, production_job_id, grams, cost, note, recorded_by)
  values (v_org, p_filament, p_job, p_grams, round(p_grams * coalesce(v_cpg, 0), 4), p_note, v_user);

  return v_remaining;
end;
$$;

revoke execute on function public.record_filament_usage(uuid, numeric, uuid, text) from public, anon;
grant execute on function public.record_filament_usage(uuid, numeric, uuid, text) to authenticated;

revoke execute on function public.is_org_member(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated;
revoke execute on function public.has_org_role(uuid, public.member_role[]) from public, anon;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;

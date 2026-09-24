-- PrintFlow — Phase 2: marketplace & shipping integrations
--
-- Security model
--   * integration_connections: non-secret connection metadata. Members can read
--     it (the Settings page shows status); only the server writes it.
--   * integration_credentials and oauth_states: secrets. RLS is enabled with NO
--     policies, so the anon/authenticated roles can never read them. Only the
--     server, using the service-role key, can. Token values are additionally
--     encrypted by the application (AES-256-GCM) before they are stored.

-- ---------------------------------------------------------------------------
-- Connections
-- ---------------------------------------------------------------------------

create type public.integration_status as enum ('connected', 'disconnected', 'auth_required', 'error', 'restricted');

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (provider in ('etsy', 'ebay', 'royal_mail_click_drop')),
  kind text not null check (kind in ('marketplace', 'shipping')),
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  status public.integration_status not null default 'disconnected',
  external_account_id text,
  external_account_name text,
  scopes text[] not null default '{}',
  -- Non-secret settings, e.g. sync cursor, import window, carrier options.
  config jsonb not null default '{}'::jsonb,
  connected_by uuid references auth.users (id) on delete set null,
  connected_at timestamptz,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);
create index integration_connections_account_idx on public.integration_connections (provider, external_account_id);

create table public.integration_credentials (
  connection_id uuid primary key references public.integration_connections (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  access_token_encrypted text,
  refresh_token_encrypted text,
  api_key_encrypted text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  -- Short lease so two requests never refresh (and rotate) the same token at once.
  refresh_lock_until timestamptz,
  updated_at timestamptz not null default now()
);

create table public.oauth_states (
  state_hash text primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  code_verifier_encrypted text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_states_expiry_idx on public.oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- Sync history
-- ---------------------------------------------------------------------------

create table public.integration_sync_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connection_id uuid references public.integration_connections (id) on delete set null,
  provider text not null,
  operation text not null, -- order_sync, webhook, fulfillment, label, tracking, connect, disconnect, token_refresh
  trigger text not null default 'manual' check (trigger in ('manual', 'webhook', 'schedule', 'system')),
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  records_processed int not null default 0,
  records_created int not null default 0,
  records_updated int not null default 0,
  records_skipped int not null default 0,
  error_count int not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  initiated_by uuid references auth.users (id) on delete set null
);
create index integration_sync_logs_org_idx on public.integration_sync_logs (organization_id, started_at desc);

-- ---------------------------------------------------------------------------
-- External orders (every marketplace order we have seen)
-- ---------------------------------------------------------------------------

create table public.external_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  connection_id uuid references public.integration_connections (id) on delete set null,
  sales_channel public.sales_channel not null,
  external_order_id text not null,
  order_id uuid references public.orders (id) on delete set null,
  -- imported | mapping_required | awaiting_payment | skipped | cancelled | error
  import_status text not null check (import_status in ('imported', 'mapping_required', 'awaiting_payment', 'skipped', 'cancelled', 'error')),
  import_note text,
  external_status text,
  currency text,
  buyer_name text,
  buyer_ref text,
  ordered_at timestamptz,
  external_updated_at timestamptz,
  normalized jsonb not null,
  unmatched_lines jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sales_channel, external_order_id)
);
create index external_orders_attention_idx on public.external_orders (organization_id, import_status);

-- ---------------------------------------------------------------------------
-- Product mappings (marketplace listing/SKU -> PrintFlow product/variant)
-- ---------------------------------------------------------------------------

create table public.product_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sales_channel public.sales_channel not null,
  external_listing_id text,
  external_product_id text,
  external_sku text,
  external_title text,
  product_id uuid not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  source text not null default 'manual' check (source in ('auto', 'manual')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (external_listing_id is not null or external_product_id is not null or external_sku is not null)
);
create unique index product_mappings_identity_idx on public.product_mappings (
  organization_id, sales_channel, coalesce(external_listing_id, ''), coalesce(external_product_id, ''), coalesce(external_sku, '')
);
create index product_mappings_sku_idx on public.product_mappings (organization_id, sales_channel, external_sku);

-- ---------------------------------------------------------------------------
-- Marketplace fulfilment updates (tracking pushed back to Etsy/eBay)
-- ---------------------------------------------------------------------------

create table public.marketplace_fulfillments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  connection_id uuid references public.integration_connections (id) on delete set null,
  sales_channel public.sales_channel not null,
  status text not null default 'pending' check (status in ('pending', 'synced', 'failed')),
  tracking_number text,
  carrier text,
  external_fulfillment_id text,
  attempts int not null default 0,
  last_attempt_at timestamptz,
  synced_at timestamptz,
  response jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Webhook events (idempotency + audit)
-- ---------------------------------------------------------------------------

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  organization_id uuid references public.organizations (id) on delete cascade,
  event_type text,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored')),
  error text,
  attempts int not null default 1,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- Extensions to Phase 1 tables
-- ---------------------------------------------------------------------------

alter table public.orders
  add column integration_connection_id uuid references public.integration_connections (id) on delete set null,
  add column external_status text,
  add column last_external_sync_at timestamptz;

alter table public.order_items
  add column external_line_id text,
  add column external_listing_id text;

alter table public.shipments
  add column package_weight_g int check (package_weight_g is null or package_weight_g > 0),
  add column package_length_mm int check (package_length_mm is null or package_length_mm > 0),
  add column package_width_mm int check (package_width_mm is null or package_width_mm > 0),
  add column package_height_mm int check (package_height_mm is null or package_height_mm > 0),
  add column package_format text,
  add column label_provider text,
  add column label_storage_path text,
  add column label_created_at timestamptz,
  add column label_error text;

-- ---------------------------------------------------------------------------
-- Triggers & RLS
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.integration_connections for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.integration_credentials for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.external_orders for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.marketplace_fulfillments for each row execute function public.set_updated_at();

-- Secrets: no policies at all -> invisible to anon/authenticated.
alter table public.integration_credentials enable row level security;
alter table public.oauth_states enable row level security;
alter table public.webhook_events enable row level security;
revoke all on public.integration_credentials, public.oauth_states from anon, authenticated;

create policy "members select" on public.webhook_events for select to authenticated
  using (organization_id is not null and public.is_org_member(organization_id));

-- Connection metadata: members read; writes happen server-side.
alter table public.integration_connections enable row level security;
create policy "members select" on public.integration_connections for select to authenticated
  using (public.is_org_member(organization_id));

-- Operational tables: members read and write within their organization.
do $$
declare
  t text;
begin
  foreach t in array array['integration_sync_logs', 'external_orders', 'product_mappings', 'marketplace_fulfillments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members select" on public.%I for select to authenticated using (public.is_org_member(organization_id))', t);
    execute format('create policy "members insert" on public.%I for insert to authenticated with check (public.is_org_member(organization_id))', t);
    execute format('create policy "members update" on public.%I for update to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))', t);
  end loop;
end;
$$;
create policy "members delete" on public.product_mappings for delete to authenticated using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- create_order: also callable by the server's service role (webhooks,
-- scheduled syncs) and records marketplace line identifiers.
-- ---------------------------------------------------------------------------

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
  v_is_service boolean := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
  v_actor uuid;
  v_order_id uuid;
  v_number text;
  v_item jsonb;
  v_item_id uuid;
  v_job_id uuid;
  v_is_demo boolean := coalesce((p_order ->> 'is_demo')::boolean, false);
  v_status public.order_status := coalesce((p_order ->> 'status')::public.order_status, 'new');
begin
  if v_user is null and not v_is_service then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if not v_is_service and not public.is_org_member(p_org) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'An order needs at least one item' using errcode = '22023';
  end if;
  -- System-initiated orders are attributed to the user who connected the integration (if given).
  v_actor := coalesce(v_user, nullif(p_order ->> 'actor_id', '')::uuid);

  v_number := public.next_order_number(p_org);

  insert into public.orders (
    organization_id, order_number, sales_channel, external_order_id, order_date,
    customer_id, customer_name, customer_email, customer_phone,
    billing_address, shipping_address,
    subtotal, shipping_charged, discount, product_cost, fees, estimated_profit,
    status, payment_status, customer_notes, internal_notes, is_demo, created_by,
    integration_connection_id, external_status, last_external_sync_at
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
    v_actor,
    nullif(p_order ->> 'integration_connection_id', '')::uuid,
    nullif(p_order ->> 'external_status', ''),
    case when p_order ? 'integration_connection_id' then now() else null end
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (
      organization_id, order_id, product_id, variant_id, sku, product_name, variant_name,
      quantity, unit_price, unit_cost, external_line_id, external_listing_id
    ) values (
      p_org, v_order_id,
      nullif(v_item ->> 'product_id', '')::uuid,
      nullif(v_item ->> 'variant_id', '')::uuid,
      v_item ->> 'sku',
      v_item ->> 'product_name',
      nullif(v_item ->> 'variant_name', ''),
      (v_item ->> 'quantity')::int,
      (v_item ->> 'unit_price')::numeric,
      coalesce((v_item ->> 'unit_cost')::numeric, 0),
      nullif(v_item ->> 'external_line_id', ''),
      nullif(v_item ->> 'external_listing_id', '')
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

    insert into public.status_history (organization_id, entity_type, entity_id, from_status, to_status, changed_by, note)
    values (p_org, 'production_job', v_job_id, null, 'queued', v_actor, case when v_user is null then 'Created by marketplace import' end);
    insert into public.audit_logs (organization_id, actor_id, event, entity_type, entity_id, summary, metadata)
    values (p_org, v_actor, 'production_job.created', 'production_job', v_job_id,
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

  insert into public.status_history (organization_id, entity_type, entity_id, from_status, to_status, changed_by, note)
  values (p_org, 'order', v_order_id, null, v_status::text, v_actor, case when v_user is null then 'Imported from marketplace' end);
  insert into public.audit_logs (organization_id, actor_id, event, entity_type, entity_id, summary, metadata)
  values (p_org, v_actor, 'order.created', 'order', v_order_id,
          format('Order %s created', v_number),
          jsonb_build_object('order_number', v_number, 'sales_channel', p_order ->> 'sales_channel',
                             'items', jsonb_array_length(p_items),
                             'source', case when v_user is null then 'integration' else 'user' end));

  return v_order_id;
end;
$$;

revoke execute on function public.create_order(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_order(uuid, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.next_order_number(uuid) to service_role;
grant execute on function public.record_filament_usage(uuid, numeric, uuid, text) to service_role;

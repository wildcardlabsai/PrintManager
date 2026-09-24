-- PrintFlow — Phase 1 core schema
--
-- Tenancy model: every business record belongs to an organization. Users join
-- organizations through organization_members, and Row Level Security grants
-- access to rows whose organization the current user is a member of. Phase 1
-- creates one organization per signup; inviting additional users later only
-- requires inserting organization_members rows.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.member_role as enum ('owner', 'admin', 'staff');

create type public.sales_channel as enum (
  'etsy', 'ebay', 'facebook_marketplace', 'website', 'manual', 'other'
);

create type public.order_status as enum (
  'new', 'confirmed', 'awaiting_print', 'printing', 'printed', 'packing',
  'ready_to_ship', 'shipped', 'completed', 'cancelled', 'on_hold'
);

create type public.payment_status as enum ('pending', 'paid', 'refunded', 'partially_refunded');
create type public.production_status as enum ('not_started', 'in_progress', 'completed', 'failed');
create type public.packing_status as enum ('not_packed', 'packing', 'packed');
create type public.shipping_status as enum ('not_shipped', 'ready', 'shipped', 'delivered');

create type public.job_status as enum ('queued', 'printing', 'paused', 'printed', 'failed', 'cancelled');
create type public.job_priority as enum ('low', 'normal', 'high', 'urgent');

create type public.printer_status as enum ('online', 'offline', 'idle', 'printing', 'error', 'maintenance');
create type public.spool_status as enum ('sealed', 'in_use', 'low', 'empty', 'archived');

create type public.shipping_provider as enum ('royal_mail', 'evri', 'dpd', 'yodel', 'other');
-- not_created: nothing generated yet. manual: user bought postage elsewhere and
-- entered tracking by hand. pending/created/void are reserved for Phase 2
-- carrier integrations.
create type public.label_status as enum ('not_created', 'manual', 'pending', 'created', 'void');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizations, members, profiles
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  active_organization_id uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Membership check used by every RLS policy. SECURITY DEFINER so the policy on
-- organization_members does not recurse into itself.
create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_org_role(org uuid, roles public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = (select auth.uid())
      and m.role = any (roles)
  );
$$;

-- ---------------------------------------------------------------------------
-- Printers
-- ---------------------------------------------------------------------------

create table public.printers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  manufacturer text not null default '',
  model text not null default '',
  -- Phase 1: set manually by the user. Phase 3 integrations will write here.
  status public.printer_status not null default 'idle',
  status_source text not null default 'manual' check (status_source in ('manual', 'integration')),
  status_updated_at timestamptz not null default now(),
  ip_address text,
  location text,
  capabilities text[] not null default '{}',
  build_volume text,
  notes text,
  -- Phase 3: identifies which PrinterIntegration adapter drives this printer.
  -- Credentials never live here; they come from server-side environment/secrets.
  integration_provider text,
  integration_device_id text,
  is_demo boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index printers_org_idx on public.printers (organization_id);

-- ---------------------------------------------------------------------------
-- Settings (one row per organization)
-- ---------------------------------------------------------------------------

create table public.settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  business_name text not null default 'My 3D Print Shop',
  currency char(3) not null default 'GBP',
  timezone text not null default 'Europe/London',
  electricity_cost_per_hour numeric(10, 4) not null default 0.20 check (electricity_cost_per_hour >= 0),
  default_filament_cost_per_kg numeric(10, 2) not null default 20.00 check (default_filament_cost_per_kg >= 0),
  default_packaging_cost numeric(10, 2) not null default 0.40 check (default_packaging_cost >= 0),
  default_shipping_provider public.shipping_provider not null default 'royal_mail',
  default_printer_id uuid references public.printers (id) on delete set null,
  order_number_prefix text not null default 'PF' check (char_length(order_number_prefix) <= 12),
  -- Tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ}
  order_number_format text not null default '{PREFIX}-{SEQ}' check (position('{SEQ}' in order_number_format) > 0),
  order_number_padding int not null default 4 check (order_number_padding between 1 and 10),
  next_order_number int not null default 1001 check (next_order_number > 0),
  low_filament_threshold_g int not null default 150 check (low_filament_threshold_g >= 0),
  notifications jsonb not null default '{"new_order": true, "job_failed": true, "low_filament": true, "daily_summary": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  email text,
  phone text,
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postcode text,
  country text default 'United Kingdom',
  notes text,
  is_demo boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_org_name_idx on public.customers (organization_id, name);
create index customers_org_email_idx on public.customers (organization_id, lower(email));

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 64),
  name text not null check (char_length(name) between 1 and 200),
  description text,
  selling_price numeric(12, 2) not null default 0 check (selling_price >= 0),
  -- Costing inputs
  filament_grams numeric(10, 2) not null default 0 check (filament_grams >= 0),
  print_minutes int not null default 0 check (print_minutes >= 0),
  filament_cost_per_kg numeric(10, 2) check (filament_cost_per_kg >= 0), -- null = settings default
  packaging_cost numeric(10, 2) check (packaging_cost >= 0),             -- null = settings default
  other_cost numeric(10, 2) not null default 0 check (other_cost >= 0),
  -- Snapshot of the calculated unit cost (recalculated whenever inputs or settings change)
  cost_price numeric(12, 2) not null default 0,
  material text not null default 'PLA',
  default_colour text,
  packaging_type text,
  default_printer_id uuid references public.printers (id) on delete set null,
  notes text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);
create index products_org_name_idx on public.products (organization_id, name);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 64),
  name text not null check (char_length(name) between 1 and 120),
  colour text,
  material text,
  -- Null values fall back to the parent product.
  selling_price numeric(12, 2) check (selling_price >= 0),
  filament_grams numeric(10, 2) check (filament_grams >= 0),
  print_minutes int check (print_minutes >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);
create index product_variants_product_idx on public.product_variants (product_id);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  url text not null,
  storage_path text,
  alt text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, position);

create table public.product_compatible_printers (
  product_id uuid not null references public.products (id) on delete cascade,
  printer_id uuid not null references public.printers (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  primary key (product_id, printer_id)
);
create index product_compatible_printers_printer_idx on public.product_compatible_printers (printer_id);

-- ---------------------------------------------------------------------------
-- Filament
-- ---------------------------------------------------------------------------

create table public.filaments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  brand text not null default '',
  material text not null default 'PLA',
  colour text not null default '',
  colour_hex text check (colour_hex is null or colour_hex ~ '^#[0-9A-Fa-f]{6}$'),
  weight_purchased_g numeric(10, 2) not null check (weight_purchased_g > 0),
  remaining_g numeric(10, 2) not null check (remaining_g >= 0),
  cost numeric(10, 2) not null default 0 check (cost >= 0),
  cost_per_gram numeric(12, 6) generated always as (cost / weight_purchased_g) stored,
  status public.spool_status not null default 'sealed',
  purchased_on date,
  notes text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index filaments_org_idx on public.filaments (organization_id, material, colour);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_number text not null,
  -- Marketplace-agnostic identity: the channel plus the ID the channel uses.
  sales_channel public.sales_channel not null default 'manual',
  external_order_id text,
  order_date timestamptz not null default now(),
  customer_id uuid references public.customers (id) on delete set null,
  -- Snapshots so historical orders keep the details they were placed with.
  customer_name text not null,
  customer_email text,
  customer_phone text,
  billing_address jsonb,
  shipping_address jsonb,
  -- Money (currency is the organization's currency)
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  shipping_charged numeric(12, 2) not null default 0 check (shipping_charged >= 0),
  discount numeric(12, 2) not null default 0 check (discount >= 0),
  total numeric(12, 2) generated always as (subtotal + shipping_charged - discount) stored,
  product_cost numeric(12, 2) not null default 0,
  fees numeric(12, 2) not null default 0 check (fees >= 0), -- marketplace/payment fees
  estimated_profit numeric(12, 2) not null default 0,
  -- Status
  status public.order_status not null default 'new',
  payment_status public.payment_status not null default 'pending',
  production_status public.production_status not null default 'not_started',
  packing_status public.packing_status not null default 'not_packed',
  shipping_status public.shipping_status not null default 'not_shipped',
  customer_notes text,
  internal_notes text,
  shipped_at timestamptz,
  completed_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, order_number),
  check (discount <= subtotal + shipping_charged)
);
-- Prevents importing the same marketplace order twice (Phase 2 relies on this).
create unique index orders_external_unique_idx
  on public.orders (organization_id, sales_channel, external_order_id)
  where external_order_id is not null;
create index orders_org_date_idx on public.orders (organization_id, order_date desc);
create index orders_org_status_idx on public.orders (organization_id, status);
create index orders_customer_idx on public.orders (customer_id);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  sku text,
  product_name text not null,
  variant_name text,
  quantity int not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  line_total numeric(12, 2) generated always as (unit_price * quantity) stored,
  line_cost numeric(12, 2) generated always as (unit_cost * quantity) stored,
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_product_idx on public.order_items (product_id);

-- ---------------------------------------------------------------------------
-- Production jobs
-- ---------------------------------------------------------------------------

create table public.production_jobs (
  id uuid primary key default gen_random_uuid(),
  job_number bigint generated always as identity,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid references public.orders (id) on delete cascade,
  order_item_id uuid references public.order_items (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  product_name text not null,
  quantity int not null check (quantity > 0),
  printer_id uuid references public.printers (id) on delete set null,
  status public.job_status not null default 'queued',
  priority public.job_priority not null default 'normal',
  queue_position double precision not null default extract(epoch from now()),
  material text,
  colour text,
  estimated_minutes int not null default 0 check (estimated_minutes >= 0),
  actual_minutes int check (actual_minutes >= 0),
  estimated_grams numeric(10, 2) not null default 0 check (estimated_grams >= 0),
  actual_grams numeric(10, 2) check (actual_grams >= 0),
  filament_id uuid references public.filaments (id) on delete set null,
  -- Time tracking for pause/resume: minutes accumulated before the current run segment.
  accumulated_minutes int not null default 0,
  last_resumed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  attempts int not null default 1 check (attempts > 0),
  notes text,
  -- Phase 3: reference to the job on the physical printer.
  external_job_ref text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live job per order line: stops duplicate production for the same item.
create unique index production_jobs_item_unique_idx
  on public.production_jobs (order_item_id)
  where order_item_id is not null and status <> 'cancelled';
create index production_jobs_org_status_idx on public.production_jobs (organization_id, status, queue_position);
create index production_jobs_order_idx on public.production_jobs (order_id);
create index production_jobs_printer_idx on public.production_jobs (printer_id) where status in ('printing', 'paused');
create index production_jobs_completed_idx on public.production_jobs (organization_id, completed_at);

create table public.filament_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  filament_id uuid not null references public.filaments (id) on delete cascade,
  production_job_id uuid references public.production_jobs (id) on delete set null,
  grams numeric(10, 2) not null check (grams > 0),
  cost numeric(12, 4) not null default 0,
  note text,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index filament_usage_org_date_idx on public.filament_usage (organization_id, created_at);
create index filament_usage_filament_idx on public.filament_usage (filament_id);

-- ---------------------------------------------------------------------------
-- Shipping
-- ---------------------------------------------------------------------------

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null unique references public.orders (id) on delete cascade,
  provider public.shipping_provider not null default 'royal_mail',
  service text,
  shipping_cost numeric(12, 2) not null default 0 check (shipping_cost >= 0), -- postage paid by the business
  tracking_number text,
  label_status public.label_status not null default 'not_created',
  shipped_at timestamptz,
  delivered_at timestamptz,
  notes text,
  -- Phase 2: carrier-side identifiers
  external_shipment_id text,
  label_url text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index shipments_org_idx on public.shipments (organization_id, shipped_at);

-- ---------------------------------------------------------------------------
-- History & audit
-- ---------------------------------------------------------------------------

create table public.status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null check (entity_type in ('order', 'production_job', 'printer')),
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index status_history_entity_idx on public.status_history (entity_type, entity_id, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  event text not null,
  entity_type text not null,
  entity_id uuid,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_date_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'organizations', 'profiles', 'printers', 'settings', 'customers', 'products',
    'product_variants', 'filaments', 'orders', 'production_jobs', 'shipments'
  ]
  loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.profiles enable row level security;

create policy "members read their organizations" on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy "owners update their organizations" on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']::public.member_role[]))
  with check (public.has_org_role(id, array['owner', 'admin']::public.member_role[]));

create policy "members read memberships" on public.organization_members
  for select to authenticated using (public.is_org_member(organization_id));
create policy "owners manage memberships" on public.organization_members
  for all to authenticated
  using (public.has_org_role(organization_id, array['owner']::public.member_role[]))
  with check (public.has_org_role(organization_id, array['owner']::public.member_role[]));

create policy "users read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
-- Teammates can see each other's names in activity history.
create or replace function public.shares_org_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other
  );
$$;

create policy "members read teammate profiles" on public.profiles
  for select to authenticated using (public.shares_org_with(id));
create policy "users update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (active_organization_id is null or public.is_org_member(active_organization_id))
  );

-- Standard tenant policies: members of the owning organization can read and write.
do $$
declare
  t text;
begin
  foreach t in array array[
    'printers', 'settings', 'customers', 'products', 'product_variants', 'product_images',
    'product_compatible_printers', 'filaments', 'orders', 'order_items', 'production_jobs',
    'filament_usage', 'shipments'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "members select" on public.%I for select to authenticated using (public.is_org_member(organization_id))', t);
    execute format(
      'create policy "members insert" on public.%I for insert to authenticated with check (public.is_org_member(organization_id))', t);
    execute format(
      'create policy "members update" on public.%I for update to authenticated using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id))', t);
  end loop;
end;
$$;

-- Deletes are limited to tables where removal is a normal operation. Orders,
-- customers, products and printers are archived/cancelled rather than deleted.
create policy "members delete" on public.product_variants for delete to authenticated using (public.is_org_member(organization_id));
create policy "members delete" on public.product_images for delete to authenticated using (public.is_org_member(organization_id));
create policy "members delete" on public.product_compatible_printers for delete to authenticated using (public.is_org_member(organization_id));
create policy "members delete" on public.order_items for delete to authenticated using (public.is_org_member(organization_id));
create policy "members delete" on public.filaments for delete to authenticated using (public.is_org_member(organization_id));
-- Admins may remove records outright (used for clearing demo data).
create policy "admins delete" on public.orders for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy "admins delete" on public.customers for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy "admins delete" on public.products for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy "admins delete" on public.production_jobs for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy "admins delete" on public.shipments for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));
create policy "admins delete" on public.filament_usage for delete to authenticated
  using (public.has_org_role(organization_id, array['owner', 'admin']::public.member_role[]));

-- History tables are append-only for normal users.
alter table public.status_history enable row level security;
alter table public.audit_logs enable row level security;
create policy "members select" on public.status_history for select to authenticated using (public.is_org_member(organization_id));
create policy "members insert" on public.status_history for insert to authenticated
  with check (public.is_org_member(organization_id) and changed_by = (select auth.uid()));
create policy "members select" on public.audit_logs for select to authenticated using (public.is_org_member(organization_id));
create policy "members insert" on public.audit_logs for insert to authenticated
  with check (public.is_org_member(organization_id) and actor_id = (select auth.uid()));

-- Anonymous users get nothing.
revoke all on all tables in schema public from anon;

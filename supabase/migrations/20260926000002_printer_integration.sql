-- PrintFlow Phase 3 — Flashforge printer integration and production automation.
--
-- Printers on a local network cannot be reached from a cloud-hosted app, so a
-- PrintFlow Printer Agent runs on the business's own network. It pairs with a
-- one-time code, authenticates with a rotating bearer token, reports telemetry
-- and executes a fixed whitelist of printer commands. The agent never receives
-- a printer's LAN check code from the cloud: that stays in the agent's local
-- configuration.
--
-- Writes to agent, command, event and telemetry data happen server-side with
-- the service role after the application has checked the user's permission.
-- Members can read them through RLS.

-- ---------------------------------------------------------------------------
-- Roles: viewers read, operators (staff) run production, owners/admins configure
-- ---------------------------------------------------------------------------

create or replace function public.can_write_org(org uuid)
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
      and m.role in ('owner', 'admin', 'staff')
  );
$$;

-- Re-point every member write policy at can_write_org so viewers are read-only
-- at the database level, not just in the UI.
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname, cmd
    from pg_policies
    where schemaname = 'public'
      and policyname in ('members insert', 'members update', 'members delete')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.cmd = 'INSERT' then
      if r.tablename in ('status_history', 'audit_logs') then
        continue; -- recreated below with their extra actor checks
      end if;
      execute format(
        'create policy %I on %I.%I for insert to authenticated with check (public.can_write_org(organization_id))',
        r.policyname, r.schemaname, r.tablename);
    elsif r.cmd = 'UPDATE' then
      execute format(
        'create policy %I on %I.%I for update to authenticated using (public.can_write_org(organization_id)) with check (public.can_write_org(organization_id))',
        r.policyname, r.schemaname, r.tablename);
    elsif r.cmd = 'DELETE' then
      execute format(
        'create policy %I on %I.%I for delete to authenticated using (public.can_write_org(organization_id))',
        r.policyname, r.schemaname, r.tablename);
    end if;
  end loop;
end;
$$;

create policy "members insert" on public.status_history for insert to authenticated
  with check (public.can_write_org(organization_id) and changed_by = (select auth.uid()));
create policy "members insert" on public.audit_logs for insert to authenticated
  with check (public.can_write_org(organization_id) and actor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Printer Agents
-- ---------------------------------------------------------------------------

create table public.printer_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked')),
  -- One-time pairing code (SHA-256). Cleared once used.
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  -- Bearer token (SHA-256). The previous token stays valid until the agent
  -- first authenticates with the rotated one, so a lost response can't lock it out.
  token_hash text,
  token_prev_hash text,
  token_issued_at timestamptz,
  version text,
  platform text,
  driver text check (driver in ('flashforge_lan', 'mock')),
  library_version text,
  last_seen_at timestamptz,
  last_ip text,
  created_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index printer_agents_org_idx on public.printer_agents (organization_id);
create unique index printer_agents_token_idx on public.printer_agents (token_hash) where token_hash is not null;
create unique index printer_agents_prev_token_idx on public.printer_agents (token_prev_hash) where token_prev_hash is not null;
create unique index printer_agents_pairing_idx on public.printer_agents (pairing_code_hash) where pairing_code_hash is not null;

-- ---------------------------------------------------------------------------
-- Printers: connection, identity and telemetry
-- ---------------------------------------------------------------------------

alter table public.printers
  add column serial_number text check (serial_number is null or char_length(serial_number) between 1 and 128),
  add column connection_mode text not null default 'manual' check (connection_mode in ('manual', 'agent_lan')),
  add column agent_id uuid references public.printer_agents (id) on delete set null,
  add column lan_port int check (lan_port is null or lan_port between 1 and 65535),
  add column firmware_version text,
  add column connection_state text not null default 'not_configured'
    check (connection_state in ('not_configured', 'waiting', 'connected', 'unreachable', 'auth_failed', 'error', 'offline')),
  add column consecutive_failures int not null default 0,
  add column last_seen_at timestamptz,
  add column last_heartbeat_at timestamptz,
  add column latency_ms int,
  add column last_error text,
  add column last_error_at timestamptz,
  add column telemetry jsonb,
  add column telemetry_at timestamptz,
  add column telemetry_source text check (telemetry_source in ('flashforge_lan', 'mock')),
  add column raw_status text,
  add column current_external_job_id text,
  -- No foreign key on purpose: a second printers↔production_jobs relationship
  -- would make PostgREST embeds of printers from jobs ambiguous.
  add column current_job_id uuid,
  add column multi_colour boolean not null default false,
  add column colour_channels int not null default 1 check (colour_channels between 1 and 16),
  add column camera text not null default 'unknown' check (camera in ('unknown', 'none', 'built_in', 'optional')),
  -- A printer must pass the live-test checklist before PrintFlow sends it production jobs.
  add column live_checklist jsonb not null default '{}'::jsonb,
  add column live_verified_at timestamptz,
  add column live_verified_by uuid references auth.users (id) on delete set null,
  -- After a print finishes the part is still on the plate. Automatic dispatch
  -- waits until someone confirms the bed is clear.
  add column bed_clear boolean not null default true,
  add column bed_clear_confirmed_at timestamptz;

create unique index printers_serial_idx on public.printers (organization_id, serial_number)
  where serial_number is not null and archived_at is null;
create index printers_agent_idx on public.printers (agent_id) where agent_id is not null;

update public.printers
set multi_colour = true, colour_channels = 4
where model ilike '%AD5X%';

-- New businesses: the AD5X is created as multi-colour capable (4-slot IFS).
-- Whether a given print uses the IFS is decided per print file.
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

  -- The two printers this business owns. They start as manually tracked
  -- until someone connects them through a Printer Agent.
  insert into public.printers (organization_id, name, manufacturer, model, status, capabilities, build_volume, notes, multi_colour, colour_channels)
  values (v_org, 'Flashforge AD5X', 'Flashforge', 'AD5X', 'idle',
          array['PLA', 'PETG', 'TPU', 'Multi-colour (4 spools)'], '220 × 220 × 220 mm', null, true, 4)
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

-- A printer may only be driven by an agent of its own organization.
create or replace function public.printers_agent_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.agent_id is not null and not exists (
    select 1 from public.printer_agents a where a.id = new.agent_id and a.organization_id = new.organization_id
  ) then
    raise exception 'Printer agent belongs to another organization' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Connection settings are admin-only, and telemetry columns are written only by
-- the server (service role), even though members can update printers generally.
create or replace function public.printers_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if (new.serial_number, new.connection_mode, new.agent_id, new.lan_port, new.ip_address, new.live_verified_at, new.live_checklist)
     is distinct from
     (old.serial_number, old.connection_mode, old.agent_id, old.lan_port, old.ip_address, old.live_verified_at, old.live_checklist)
     and not public.has_org_role(old.organization_id, array['owner', 'admin']::public.member_role[]) then
    raise exception 'Only an owner or admin can change printer connection settings' using errcode = '42501';
  end if;
  if (new.telemetry, new.telemetry_at, new.telemetry_source, new.last_seen_at, new.last_heartbeat_at, new.connection_state,
      new.firmware_version, new.raw_status, new.current_external_job_id, new.current_job_id, new.consecutive_failures, new.latency_ms)
     is distinct from
     (old.telemetry, old.telemetry_at, old.telemetry_source, old.last_seen_at, old.last_heartbeat_at, old.connection_state,
      old.firmware_version, old.raw_status, old.current_external_job_id, old.current_job_id, old.consecutive_failures, old.latency_ms) then
    raise exception 'Printer telemetry is written by the Printer Agent only' using errcode = '42501';
  end if;
  if old.connection_mode = 'agent_lan' and new.status is distinct from old.status then
    raise exception 'This printer''s status comes from live telemetry and can''t be set manually' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger printers_agent_same_org before insert or update of agent_id, organization_id on public.printers
  for each row execute function public.printers_agent_same_org();
create trigger printers_guard_update before update on public.printers
  for each row execute function public.printers_guard_update();

-- ---------------------------------------------------------------------------
-- Print files (sliced files ready for a specific printer)
-- ---------------------------------------------------------------------------

create table public.print_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  name text not null check (char_length(name) between 1 and 200),
  file_name text not null check (char_length(file_name) between 1 and 255),
  file_type text not null check (file_type in ('gcode', 'gx', '3mf')),
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  compatible_models text[] not null default '{}',
  slicer text,
  slicer_version text,
  printer_profile text,
  material text,
  colour text,
  nozzle_diameter numeric(4, 2),
  multi_colour boolean not null default false,
  colour_channels int not null default 1 check (colour_channels between 1 and 16),
  ifs_required boolean not null default false,
  -- [{ "channel": 1, "material": "PLA", "colour": "#FF0000", "grams": 12.3 }]
  filament_assignments jsonb not null default '[]'::jsonb check (jsonb_typeof(filament_assignments) = 'array'),
  estimated_minutes int check (estimated_minutes is null or estimated_minutes >= 0),
  estimated_grams numeric(10, 2) check (estimated_grams is null or estimated_grams >= 0),
  metadata jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  -- Set when a print of this file has completed successfully on a printer.
  -- Automatic dispatch only uses proven files.
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index print_files_org_idx on public.print_files (organization_id, created_at desc);
create index print_files_product_idx on public.print_files (product_id) where product_id is not null;
-- A product can have one default file per printer model (enforced by the app).
create index print_files_default_idx on public.print_files (product_id) where is_default and archived_at is null;

create trigger set_updated_at before update on public.print_files for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.printer_agents for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Production jobs: printer dispatch and telemetry
-- ---------------------------------------------------------------------------

alter table public.production_jobs
  add column print_file_id uuid references public.print_files (id) on delete set null,
  add column external_printer_job_id text,
  add column printer_file_name text,
  add column printer_status text,
  add column progress numeric(5, 2) check (progress is null or progress between 0 and 100),
  add column remaining_seconds int check (remaining_seconds is null or remaining_seconds >= 0),
  add column printer_elapsed_seconds int,
  add column current_layer int,
  add column total_layers int,
  add column last_telemetry_at timestamptz,
  add column sent_at timestamptz,
  add column multi_colour boolean not null default false,
  add column colour_channels int not null default 1 check (colour_channels between 1 and 16),
  add column ifs_required boolean not null default false,
  add column filament_assignments jsonb not null default '[]'::jsonb,
  add column needs_attention boolean not null default false,
  add column attention_code text check (attention_code is null or attention_code in (
    'printer_offline', 'printer_error', 'stopped_at_printer', 'not_started', 'missed_completion', 'other_job',
    'dispatch_failed', 'print_failed'
  )),
  add column attention_reason text,
  add column auto_dispatched boolean not null default false,
  add column filament_recorded boolean not null default false;

create index production_jobs_attention_idx on public.production_jobs (organization_id) where needs_attention;
create index production_jobs_print_file_idx on public.production_jobs (print_file_id) where print_file_id is not null;
-- One job at a time per printer from dispatch through printing.
create unique index production_jobs_printer_active_idx on public.production_jobs (printer_id)
  where printer_id is not null and status in ('sending', 'sent', 'printing');

-- Existing completed jobs had filament handled in Phase 1's completion dialog.
update public.production_jobs set filament_recorded = true where status = 'printed';

-- ---------------------------------------------------------------------------
-- Printer commands (whitelisted, queued for the agent)
-- ---------------------------------------------------------------------------

create table public.printer_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  printer_id uuid not null references public.printers (id) on delete cascade,
  agent_id uuid not null references public.printer_agents (id) on delete cascade,
  production_job_id uuid references public.production_jobs (id) on delete set null,
  print_file_id uuid references public.print_files (id) on delete set null,
  type text not null check (type in ('start_print', 'pause', 'resume', 'stop', 'refresh', 'test_connection', 'clear_platform')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'succeeded', 'failed', 'expired', 'cancelled')),
  requested_by uuid references auth.users (id) on delete set null,
  automatic boolean not null default false,
  expires_at timestamptz not null,
  sent_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error_code text,
  error text,
  created_at timestamptz not null default now()
);
create index printer_commands_agent_pending_idx on public.printer_commands (agent_id, created_at) where status = 'pending';
create index printer_commands_printer_idx on public.printer_commands (printer_id, created_at desc);
-- Never two print starts in flight for one printer.
create unique index printer_commands_one_start_idx on public.printer_commands (printer_id)
  where type = 'start_print' and status in ('pending', 'sent');

-- ---------------------------------------------------------------------------
-- Printer events
-- ---------------------------------------------------------------------------

create table public.printer_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  printer_id uuid not null references public.printers (id) on delete cascade,
  production_job_id uuid references public.production_jobs (id) on delete set null,
  type text not null check (type in (
    'connected', 'disconnected', 'print_started', 'print_paused', 'print_resumed', 'print_stopped',
    'print_completed', 'print_failed', 'error', 'status_changed', 'command_failed', 'firmware_changed'
  )),
  from_status text,
  to_status text,
  message text,
  data jsonb not null default '{}'::jsonb,
  source text not null default 'telemetry' check (source in ('telemetry', 'command', 'agent', 'user', 'system')),
  created_at timestamptz not null default now()
);
create index printer_events_printer_idx on public.printer_events (printer_id, created_at desc);
create index printer_events_org_idx on public.printer_events (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- In-app notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- null = everyone in the organization
  user_id uuid references auth.users (id) on delete cascade,
  type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'error', 'success')),
  title text not null,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  created_at timestamptz not null default now()
);
create index notifications_org_idx on public.notifications (organization_id, created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

alter table public.settings
  add column auto_print_enabled boolean not null default false,
  add column printer_offline_after_seconds int not null default 90 check (printer_offline_after_seconds between 30 and 3600),
  add column printer_command_timeout_seconds int not null default 120 check (printer_command_timeout_seconds between 30 and 900);

alter table public.settings
  alter column notifications set default
    '{"new_order": true, "job_failed": true, "low_filament": true, "daily_summary": false, "printer_offline": true, "print_completed": true}'::jsonb;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.printer_agents enable row level security;
alter table public.printer_commands enable row level security;
alter table public.printer_events enable row level security;
alter table public.print_files enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;

create policy "members select" on public.printer_agents for select to authenticated using (public.is_org_member(organization_id));
-- Token and pairing hashes are never readable by users, even hashed.
revoke select on public.printer_agents from authenticated;
grant select (id, organization_id, name, status, pairing_expires_at, token_issued_at, version, platform, driver,
              library_version, last_seen_at, last_ip, created_by, revoked_at, revoked_by, created_at, updated_at)
  on public.printer_agents to authenticated;

create policy "members select" on public.printer_commands for select to authenticated using (public.is_org_member(organization_id));
create policy "members select" on public.printer_events for select to authenticated using (public.is_org_member(organization_id));

create policy "members select" on public.print_files for select to authenticated using (public.is_org_member(organization_id));
create policy "members insert" on public.print_files for insert to authenticated with check (public.can_write_org(organization_id));
create policy "members update" on public.print_files for update to authenticated
  using (public.can_write_org(organization_id)) with check (public.can_write_org(organization_id));

create policy "members select" on public.notifications for select to authenticated
  using (public.is_org_member(organization_id) and (user_id is null or user_id = (select auth.uid())));
create policy "users read own" on public.notification_reads for select to authenticated using (user_id = (select auth.uid()));
create policy "users mark read" on public.notification_reads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.notifications n
      where n.id = notification_id
        and public.is_org_member(n.organization_id)
        and (n.user_id is null or n.user_id = (select auth.uid()))
    )
  );

revoke all on public.printer_agents, public.printer_commands, public.printer_events, public.print_files,
  public.notifications, public.notification_reads from anon;

-- ---------------------------------------------------------------------------
-- Storage: print files (private; the agent downloads through the server)
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present; skipping print file bucket setup';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('print-files', 'print-files', false, 209715200)
  on conflict (id) do nothing;

  execute $p$
    create policy "org members read print files" on storage.objects
      for select to authenticated
      using (bucket_id = 'print-files' and public.is_org_member(((storage.foldername(name))[1])::uuid))
  $p$;
  execute $p$
    create policy "org writers upload print files" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'print-files' and public.can_write_org(((storage.foldername(name))[1])::uuid))
  $p$;
  execute $p$
    create policy "org writers delete print files" on storage.objects
      for delete to authenticated
      using (bucket_id = 'print-files' and public.can_write_org(((storage.foldername(name))[1])::uuid))
  $p$;

  -- Viewers can see product images but not change them.
  drop policy if exists "org members upload product images" on storage.objects;
  drop policy if exists "org members update product images" on storage.objects;
  drop policy if exists "org members delete product images" on storage.objects;
  execute $p$
    create policy "org members upload product images" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'product-images' and public.can_write_org(((storage.foldername(name))[1])::uuid))
  $p$;
  execute $p$
    create policy "org members update product images" on storage.objects
      for update to authenticated
      using (bucket_id = 'product-images' and public.can_write_org(((storage.foldername(name))[1])::uuid))
  $p$;
  execute $p$
    create policy "org members delete product images" on storage.objects
      for delete to authenticated
      using (bucket_id = 'product-images' and public.can_write_org(((storage.foldername(name))[1])::uuid))
  $p$;
end;
$$;

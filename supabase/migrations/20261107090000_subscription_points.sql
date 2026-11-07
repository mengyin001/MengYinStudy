-- ---------------------------------------------------------------------------
-- 0.8.0 — subscriptions, point balance and the spend ledger
--
-- One wallet per account. The browser never writes a balance: every grant and
-- every charge goes through a security-definer function that reads auth.uid()
-- and appends to the ledger in the same transaction. Requests carry a request
-- id, so a retried charge (network resend, SSE reconnect) is applied once.
--
-- Plan prices and point rates live in packages/core/src/billing.ts. The
-- database stores the plan id and the resulting balance only; the API passes
-- the plan's cap and monthly grant so a price change needs no migration.
-- ---------------------------------------------------------------------------

create table if not exists public.billing_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free'
    check (plan in ('free', 'light', 'standard', 'pro')),
  points integer not null default 0 check (points >= 0),
  lifetime_points integer not null default 0 check (lifetime_points >= 0),
  period_start timestamptz not null default date_trunc('month', now()),
  period_end timestamptz not null default date_trunc('month', now()) + interval '1 month',
  images_used integer not null default 0 check (images_used >= 0),
  daily_date date not null default (now() at time zone 'utc')::date,
  daily_generations integer not null default 0 check (daily_generations >= 0),
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_accounts is
  'One row per account: current plan, point balance and the current billing period.';

create unique index if not exists billing_accounts_stripe_customer
  on public.billing_accounts (stripe_customer_id)
  where stripe_customer_id is not null;
create unique index if not exists billing_accounts_stripe_subscription
  on public.billing_accounts (stripe_subscription_id)
  where stripe_subscription_id is not null;

create table if not exists public.point_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  balance_after integer not null,
  kind text not null,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.point_ledger is
  'Append-only record of every grant, charge and refund. `request_id` makes a retry idempotent.';

create index if not exists point_ledger_user_created
  on public.point_ledger (user_id, created_at desc);
create unique index if not exists point_ledger_request
  on public.point_ledger (user_id, request_id)
  where request_id is not null;

-- Webhook idempotency. Stripe retries an event for up to three days; the event
-- id is recorded before any work so a retry is a no-op.
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

comment on table public.stripe_events is
  'Stripe webhook receipt log. Written with the service key only.';

drop trigger if exists billing_accounts_set_updated_at on public.billing_accounts;
create trigger billing_accounts_set_updated_at
before update on public.billing_accounts
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: read your own balance and ledger, nothing else.
-- ---------------------------------------------------------------------------

alter table public.billing_accounts enable row level security;
alter table public.point_ledger enable row level security;
alter table public.stripe_events enable row level security;

drop policy if exists billing_accounts_select_own on public.billing_accounts;
create policy billing_accounts_select_own
on public.billing_accounts for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists billing_accounts_select_admin on public.billing_accounts;
create policy billing_accounts_select_admin
on public.billing_accounts for select
to authenticated
using ((select private.is_admin()));

drop policy if exists point_ledger_select_own on public.point_ledger;
create policy point_ledger_select_own
on public.point_ledger for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists point_ledger_select_admin on public.point_ledger;
create policy point_ledger_select_admin
on public.point_ledger for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.billing_accounts from anon, authenticated;
revoke all on table public.point_ledger from anon, authenticated;
revoke all on table public.stripe_events from anon, authenticated;
grant select on table public.billing_accounts to authenticated;
grant select on table public.point_ledger to authenticated;
grant all on table public.billing_accounts to service_role;
grant all on table public.point_ledger to service_role;
grant all on table public.stripe_events to service_role;

-- ---------------------------------------------------------------------------
-- Account creation
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_billing_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.billing_accounts (user_id, plan, points, period_start, period_end)
  values (
    new.id,
    'free',
    0,
    date_trunc('month', now()),
    date_trunc('month', now()) + interval '1 month'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_billing on auth.users;
create trigger on_auth_user_created_billing
after insert on auth.users
for each row execute function public.handle_new_billing_user();

-- Backfill accounts that existed before this migration.
insert into public.billing_accounts (user_id, plan, points)
select u.id, 'free', 0
from auth.users u
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Helpers (not exposed over RPC)
-- ---------------------------------------------------------------------------

create or replace function private.billing_row(p_user uuid)
returns public.billing_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.billing_accounts;
begin
  insert into public.billing_accounts (user_id, plan, points)
  values (p_user, 'free', 0)
  on conflict (user_id) do nothing;

  select * into row_out
  from public.billing_accounts
  where user_id = p_user
  for update;
  return row_out;
end;
$$;

create or replace function private.ledger_append(
  p_user uuid,
  p_delta integer,
  p_balance integer,
  p_kind text,
  p_request_id text,
  p_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.point_ledger (user_id, delta, balance_after, kind, request_id, metadata)
  values (p_user, p_delta, p_balance, p_kind, p_request_id, coalesce(p_metadata, '{}'::jsonb))
  on conflict (user_id, request_id) where request_id is not null do nothing;
  return found;
end;
$$;

revoke all on function private.billing_row(uuid) from public, anon, authenticated, service_role;
revoke all on function private.ledger_append(uuid, integer, integer, text, text, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Browser-callable RPCs (authenticated users, own account only)
-- ---------------------------------------------------------------------------

create or replace function public.billing_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  row_out public.billing_accounts;
  today date := (now() at time zone 'utc')::date;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  row_out := private.billing_row(uid);

  return jsonb_build_object(
    'plan', row_out.plan,
    'points', row_out.points,
    'lifetimePoints', row_out.lifetime_points,
    'periodStart', row_out.period_start,
    'periodEnd', row_out.period_end,
    'imagesUsed', row_out.images_used,
    'dailyDate', row_out.daily_date,
    'dailyGenerations', case when row_out.daily_date = today then row_out.daily_generations else 0 end,
    'status', row_out.subscription_status,
    'cancelAtPeriodEnd', row_out.cancel_at_period_end,
    'stripeCustomerId', row_out.stripe_customer_id,
    'stripeSubscriptionId', row_out.stripe_subscription_id
  );
end;
$$;

/**
 * Charge points for one request.
 *
 * `p_request_id` is the idempotency key. A repeated call with the same id
 * returns the balance that is already on record and `duplicate: true`, so a
 * retried generation is never charged twice.
 */
create or replace function public.billing_spend(
  p_points integer,
  p_kind text,
  p_request_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  row_out public.billing_accounts;
  charge integer := greatest(0, coalesce(p_points, 0));
  existing public.point_ledger;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if charge = 0 then
    return jsonb_build_object('ok', true, 'balance', (private.billing_row(uid)).points, 'duplicate', false);
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'request id is required' using errcode = '22023';
  end if;

  row_out := private.billing_row(uid);

  select * into existing
  from public.point_ledger l
  where l.user_id = uid and l.request_id = p_request_id;
  if found then
    return jsonb_build_object('ok', true, 'balance', row_out.points, 'duplicate', true);
  end if;

  if row_out.points < charge then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  update public.billing_accounts
  set points = points - charge
  where user_id = uid
  returning * into row_out;

  perform private.ledger_append(
    uid, -charge, row_out.points, coalesce(p_kind, 'spend'), p_request_id, p_metadata
  );

  return jsonb_build_object('ok', true, 'balance', row_out.points, 'charged', charge, 'duplicate', false);
end;
$$;

/** Return reserved points that were not delivered. Idempotent per request id. */
create or replace function public.billing_refund(
  p_points integer,
  p_kind text,
  p_request_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  row_out public.billing_accounts;
  amount integer := greatest(0, coalesce(p_points, 0));
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if amount = 0 then
    return jsonb_build_object('ok', true, 'balance', (private.billing_row(uid)).points);
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'request id is required' using errcode = '22023';
  end if;

  row_out := private.billing_row(uid);

  if private.ledger_append(uid, amount, row_out.points + amount, coalesce(p_kind, 'refund'), p_request_id, p_metadata) then
    update public.billing_accounts
    set points = points + amount
    where user_id = uid
    returning * into row_out;
  end if;

  return jsonb_build_object('ok', true, 'balance', row_out.points);
end;
$$;

/**
 * Count one generation against the account's daily allowance.
 *
 * The row is locked, so two parallel requests cannot both take the last slot.
 * The counter resets on the first request of a new UTC day.
 */
create or replace function public.billing_daily_take(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  row_out public.billing_accounts;
  today date := (now() at time zone 'utc')::date;
  cap integer := greatest(0, coalesce(p_limit, 0));
  used integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  row_out := private.billing_row(uid);
  used := case when row_out.daily_date = today then row_out.daily_generations else 0 end;

  if cap > 0 and used + 1 > cap then
    return jsonb_build_object('allowed', false, 'used', used, 'limit', cap);
  end if;

  update public.billing_accounts
  set daily_date = today,
      daily_generations = used + 1
  where user_id = uid;

  return jsonb_build_object('allowed', true, 'used', used + 1, 'limit', cap);
end;
$$;

/**
 * Take `p_count` images from this month's included quota.
 *
 * Returns how many images the quota covered; the caller charges points for the
 * rest. `p_quota` comes from the plan table, so a plan change needs no SQL edit.
 */
create or replace function public.billing_image_take(p_count integer, p_quota integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  row_out public.billing_accounts;
  wanted integer := greatest(0, coalesce(p_count, 0));
  quota integer := greatest(0, coalesce(p_quota, 0));
  free_left integer;
  included integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  row_out := private.billing_row(uid);
  free_left := greatest(0, quota - row_out.images_used);
  included := least(wanted, free_left);

  if included > 0 then
    update public.billing_accounts
    set images_used = images_used + included
    where user_id = uid;
  end if;

  return jsonb_build_object(
    'included', included,
    'extra', wanted - included,
    'imagesUsed', row_out.images_used + included,
    'quota', quota
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role RPCs (webhook and admin tooling)
-- ---------------------------------------------------------------------------

create or replace function public.billing_grant(
  p_user uuid,
  p_points integer,
  p_kind text,
  p_request_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.billing_accounts;
  amount integer := greatest(0, coalesce(p_points, 0));
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;

  row_out := private.billing_row(p_user);
  if private.ledger_append(p_user, amount, row_out.points + amount, coalesce(p_kind, 'grant'), p_request_id, p_metadata) then
    update public.billing_accounts
    set points = points + amount,
        lifetime_points = lifetime_points + amount
    where user_id = p_user
    returning * into row_out;
  end if;

  return jsonb_build_object('ok', true, 'balance', row_out.points);
end;
$$;

/**
 * Apply a subscription state from Stripe (or an admin).
 *
 * The API supplies `p_point_cap` and `p_grant_points` from the shared plan
 * table. `p_period_key` must identify the paid period (the Stripe period end):
 * the monthly grant is written to the ledger under `period:<key>`, so a
 * repeated webhook is a no-op even when the same period is reported twice.
 */
create or replace function public.billing_set_subscription(
  p_user uuid,
  p_plan text,
  p_status text,
  p_period_end timestamptz,
  p_point_cap integer,
  p_grant_points integer,
  p_period_key text,
  p_customer_id text default null,
  p_subscription_id text default null,
  p_cancel_at_period_end boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.billing_accounts;
  cap integer := greatest(0, coalesce(p_point_cap, 0));
  grant_amount integer := greatest(0, coalesce(p_grant_points, 0));
  kept integer;
  granted boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_plan not in ('free', 'light', 'standard', 'pro') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;

  row_out := private.billing_row(p_user);

  -- Subscription fields change on every Stripe update; the balance and the
  -- image counter only move when a new paid period is claimed. Capping the
  -- balance on every update would quietly shrink a wallet whenever Stripe
  -- reports an unrelated change (for example cancel_at_period_end).
  update public.billing_accounts
  set plan = p_plan,
      period_start = case when p_period_end is not null then now() else period_start end,
      period_end = coalesce(p_period_end, period_end),
      subscription_status = p_status,
      stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
      stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
      cancel_at_period_end = coalesce(p_cancel_at_period_end, false)
  where user_id = p_user
  returning * into row_out;

  if grant_amount > 0 and nullif(btrim(coalesce(p_period_key, '')), '') is not null then
    if not exists (
      select 1
      from public.point_ledger l
      where l.user_id = p_user and l.request_id = 'period:' || p_period_key
    ) then
      -- Unused plan points roll over, but only up to the new plan's cap.
      kept := least(row_out.points, cap);
      granted := private.ledger_append(
        p_user,
        grant_amount,
        kept + grant_amount,
        'monthly',
        'period:' || p_period_key,
        jsonb_build_object('plan', p_plan, 'periodEnd', p_period_end)
      );
      if granted then
        update public.billing_accounts
        set points = kept + grant_amount,
            lifetime_points = lifetime_points + grant_amount,
            images_used = 0
        where user_id = p_user
        returning * into row_out;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'plan', row_out.plan,
    'points', row_out.points,
    'granted', granted
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.handle_new_billing_user() from public, anon, authenticated;
revoke all on function public.billing_snapshot() from public, anon;
revoke all on function public.billing_spend(integer, text, text, jsonb) from public, anon;
revoke all on function public.billing_refund(integer, text, text, jsonb) from public, anon;
revoke all on function public.billing_daily_take(integer) from public, anon;
revoke all on function public.billing_image_take(integer, integer) from public, anon;
revoke all on function public.billing_grant(uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.billing_set_subscription(uuid, text, text, timestamptz, integer, integer, text, text, text, boolean)
  from public, anon, authenticated;

grant execute on function public.billing_snapshot() to authenticated, service_role;
grant execute on function public.billing_spend(integer, text, text, jsonb) to authenticated, service_role;
grant execute on function public.billing_refund(integer, text, text, jsonb) to authenticated, service_role;
grant execute on function public.billing_daily_take(integer) to authenticated, service_role;
grant execute on function public.billing_image_take(integer, integer) to authenticated, service_role;
grant execute on function public.billing_grant(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.billing_set_subscription(uuid, text, text, timestamptz, integer, integer, text, text, text, boolean)
  to service_role;

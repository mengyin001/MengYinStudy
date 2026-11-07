-- ---------------------------------------------------------------------------
-- 0.8.0 — free monthly question quota, membership validity and safe refunds
--
-- The free plan is no longer unlimited: it may generate 200 questions in a
-- calendar month on the free GLM model. Paid plans spend points instead.
--
-- The browser never touches these counters. Both the reservation and the
-- refund are service-role RPCs, because a user-callable refund would let a
-- learner mint quota (and, before this migration, points) at will.
-- ---------------------------------------------------------------------------

alter table public.billing_accounts
  add column if not exists questions_used integer not null default 0,
  add column if not exists questions_month date not null
    default (date_trunc('month', now() at time zone 'utc'))::date;

alter table public.billing_accounts
  drop constraint if exists billing_accounts_questions_used_check;
alter table public.billing_accounts
  add constraint billing_accounts_questions_used_check check (questions_used >= 0);

comment on column public.billing_accounts.questions_used is
  'Questions generated in questions_month. Only the free plan uses this counter.';
comment on column public.billing_accounts.questions_month is
  'First day (UTC) of the month questions_used belongs to.';

-- One row per reservation/refund. The unique request id makes a retried
-- generation idempotent without a second counter.
create table if not exists public.question_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  request_id text not null,
  created_at timestamptz not null default now(),
  unique (user_id, request_id)
);

comment on table public.question_usage is
  'Free-plan question reservations and refunds. Written by service-role RPCs only.';

create index if not exists question_usage_user_created
  on public.question_usage (user_id, created_at desc);

alter table public.question_usage enable row level security;
revoke all on table public.question_usage from anon, authenticated;
grant all on table public.question_usage to service_role;

-- ---------------------------------------------------------------------------
-- Snapshot: effective plan, membership validity and the free question counter
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
  month_start date := date_trunc('month', now() at time zone 'utc')::date;
  today date := (now() at time zone 'utc')::date;
  plan_out text;
  active boolean := true;
  used integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  row_out := private.billing_row(uid);

  -- A paid plan is only valid while Stripe says the subscription is active and
  -- the paid period has not ended. An expired or past-due subscription cannot
  -- keep paid models: it falls back to the free plan immediately, without
  -- waiting for a webhook.
  plan_out := row_out.plan;
  if row_out.plan <> 'free' then
    active := coalesce(row_out.subscription_status, '') in ('active', 'trialing')
      and (row_out.period_end is null or row_out.period_end > now());
    if not active then
      plan_out := 'free';
    end if;
  end if;

  used := case when row_out.questions_month = month_start then row_out.questions_used else 0 end;

  return jsonb_build_object(
    'plan', plan_out,
    'storedPlan', row_out.plan,
    'membershipActive', active,
    'points', row_out.points,
    'lifetimePoints', row_out.lifetime_points,
    'periodStart', row_out.period_start,
    'periodEnd', row_out.period_end,
    'imagesUsed', row_out.images_used,
    'questionsUsed', used,
    'questionsMonth', month_start,
    'questionsResetAt', month_start + interval '1 month',
    'status', row_out.subscription_status,
    'cancelAtPeriodEnd', row_out.cancel_at_period_end,
    'stripeCustomerId', row_out.stripe_customer_id,
    'stripeSubscriptionId', row_out.stripe_subscription_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Free question quota (service role only)
-- ---------------------------------------------------------------------------

/**
 * Reserve `p_count` free questions for one request.
 *
 * `p_limit` comes from the shared plan table (200 today). The row is locked, so
 * two parallel requests cannot both take the last slot. A new calendar month
 * resets the counter on the first reservation. A repeated request id returns
 * the existing reservation instead of charging twice.
 */
create or replace function public.billing_questions_take(
  p_user uuid,
  p_count integer,
  p_limit integer,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.billing_accounts;
  month_start date := date_trunc('month', now() at time zone 'utc')::date;
  wanted integer := greatest(0, coalesce(p_count, 0));
  lim integer := greatest(0, coalesce(p_limit, 0));
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'request id is required' using errcode = '22023';
  end if;

  row_out := private.billing_row(p_user);

  if row_out.questions_month <> month_start then
    update public.billing_accounts
    set questions_month = month_start,
        questions_used = 0
    where user_id = p_user
    returning * into row_out;
  end if;

  if lim = 0 then
    return jsonb_build_object(
      'ok', true, 'used', 0, 'limit', 0, 'remaining', null, 'duplicate', false
    );
  end if;

  if exists (
    select 1 from public.question_usage q
    where q.user_id = p_user and q.request_id = p_request_id
  ) then
    return jsonb_build_object(
      'ok', true,
      'used', row_out.questions_used,
      'limit', lim,
      'remaining', greatest(0, lim - row_out.questions_used),
      'duplicate', true
    );
  end if;

  if row_out.questions_used + wanted > lim then
    raise exception 'question_quota_exceeded' using errcode = 'P0001';
  end if;

  insert into public.question_usage (user_id, delta, request_id)
  values (p_user, wanted, p_request_id);

  update public.billing_accounts
  set questions_used = questions_used + wanted
  where user_id = p_user
  returning * into row_out;

  return jsonb_build_object(
    'ok', true,
    'used', row_out.questions_used,
    'limit', lim,
    'remaining', greatest(0, lim - row_out.questions_used),
    'duplicate', false
  );
end;
$$;

/** Return free questions that were reserved but not delivered. Idempotent. */
create or replace function public.billing_questions_refund(
  p_user uuid,
  p_count integer,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.billing_accounts;
  month_start date := date_trunc('month', now() at time zone 'utc')::date;
  amount integer := greatest(0, coalesce(p_count, 0));
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'request id is required' using errcode = '22023';
  end if;

  row_out := private.billing_row(p_user);

  if row_out.questions_month <> month_start then
    update public.billing_accounts
    set questions_month = month_start,
        questions_used = 0
    where user_id = p_user
    returning * into row_out;
  end if;

  if amount = 0 then
    return jsonb_build_object('ok', true, 'used', row_out.questions_used, 'refunded', 0);
  end if;

  insert into public.question_usage (user_id, delta, request_id)
  values (p_user, -amount, p_request_id)
  on conflict (user_id, request_id) do nothing;

  if found then
    update public.billing_accounts
    set questions_used = greatest(0, questions_used - amount)
    where user_id = p_user
    returning * into row_out;
  end if;

  return jsonb_build_object('ok', true, 'used', row_out.questions_used, 'refunded', amount);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds are a service-role operation
--
-- The old signature was callable by any signed-in user and credited points
-- without proving that a charge existed. Drop it; the API now passes the user
-- id explicitly and authenticates with the service key.
-- ---------------------------------------------------------------------------

drop function if exists public.billing_refund(integer, text, text, jsonb);

create or replace function public.billing_refund(
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
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'request id is required' using errcode = '22023';
  end if;

  row_out := private.billing_row(p_user);

  if amount = 0 then
    return jsonb_build_object('ok', true, 'balance', row_out.points);
  end if;

  if private.ledger_append(p_user, amount, row_out.points + amount, coalesce(p_kind, 'refund'), p_request_id, p_metadata) then
    update public.billing_accounts
    set points = points + amount
    where user_id = p_user
    returning * into row_out;
  end if;

  return jsonb_build_object('ok', true, 'balance', row_out.points);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.billing_questions_take(uuid, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.billing_questions_refund(uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.billing_refund(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.billing_questions_take(uuid, integer, integer, text) to service_role;
grant execute on function public.billing_questions_refund(uuid, integer, text) to service_role;
grant execute on function public.billing_refund(uuid, integer, text, text, jsonb) to service_role;

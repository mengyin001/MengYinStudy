-- ---------------------------------------------------------------------------
-- 0.8.0 — monthly point reset and a separate bonus bucket
--
-- Paid-plan points are a monthly allowance, not a wallet that grows forever.
-- The first read or charge in a new month replaces the plan balance with the
-- plan's monthly points; unused plan points do not accumulate. Bonus points
-- (purchased packs or an admin grant) live in their own bucket so a monthly
-- reset cannot wipe them.
--
-- The reset is lazy: `billing_snapshot`, `billing_spend` and `billing_image_take`
-- call `private.billing_apply_reset` before using the row. No cron or scheduled
-- Worker is needed, and annual subscriptions still reset every month. A free or
-- lapsed account is never granted points: its due reset clears the plan bucket
-- and retires the schedule, so a delayed renewal can still grant the new month.
-- ---------------------------------------------------------------------------

alter table public.billing_accounts
  add column if not exists monthly_points integer not null default 0 check (monthly_points >= 0),
  add column if not exists points_reset_at timestamptz,
  add column if not exists bonus_points integer not null default 0 check (bonus_points >= 0);

comment on column public.billing_accounts.monthly_points is
  'Plan points granted at each monthly reset; zero for the free plan.';
comment on column public.billing_accounts.points_reset_at is
  'Next lazy monthly reset. Null means no reset is scheduled.';
comment on column public.billing_accounts.bonus_points is
  'Purchased or admin-granted points; never cleared by the monthly reset.';

-- Backfill existing paid rows from the current plan table. Preserve any balance
-- above the monthly allowance as bonus points, so a live wallet is not wiped by
-- the first deployment of this migration.
update public.billing_accounts
set monthly_points = case plan
    when 'light' then 500
    when 'standard' then 1100
    when 'pro' then 2500
    else 0
  end
where plan <> 'free';

update public.billing_accounts
set points_reset_at = now() + interval '1 month'
where plan <> 'free' and points_reset_at is null;

update public.billing_accounts
set bonus_points = greatest(0, points - monthly_points),
    points = least(points, monthly_points)
where plan <> 'free' and points > monthly_points;

-- ---------------------------------------------------------------------------
-- Lazy reset
-- ---------------------------------------------------------------------------

create or replace function private.billing_apply_reset(p_user uuid)
returns public.billing_accounts
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.billing_accounts;
  old_points integer;
  monthly integer;
  next_reset timestamptz;
  active boolean;
begin
  row_out := private.billing_row(p_user);
  if row_out.points_reset_at is null or row_out.points_reset_at > now() then
    return row_out;
  end if;

  -- A free plan has no monthly allowance, and an expired or past-due paid
  -- subscription gets none either. Closing the period at exactly its end is
  -- not a new month: `period_end > now()` is false at equality.
  active := row_out.plan <> 'free'
    and row_out.monthly_points > 0
    and coalesce(row_out.subscription_status, '') in ('active', 'trialing')
    and (row_out.period_end is null or row_out.period_end > now());

  if not active then
    -- Zero the lapsed plan points and, crucially, retire the schedule. If the
    -- date were advanced instead, a delayed renewal webhook would see a future
    -- reset date and mistake the (zero) reset for this period's grant, leaving
    -- a paying member with no points until the next month.
    old_points := row_out.points;
    update public.billing_accounts
    set points = 0,
        images_used = 0,
        points_reset_at = null
    where user_id = p_user
    returning * into row_out;

    perform private.ledger_append(
      p_user,
      -old_points,
      row_out.bonus_points,
      'monthly-reset',
      'expired-reset:' || extract(epoch from now())::bigint,
      jsonb_build_object(
        'plan', row_out.plan,
        'monthlyPoints', 0,
        'previousPoints', old_points,
        'expired', true
      )
    );

    return row_out;
  end if;

  monthly := row_out.monthly_points;
  old_points := row_out.points;
  next_reset := row_out.points_reset_at;
  -- Skip any missed months. A learner who was away for three months gets the
  -- current month only; points are an allowance, not a backlog.
  while next_reset <= now() loop
    next_reset := next_reset + interval '1 month';
  end loop;

  update public.billing_accounts
  set points = monthly,
      images_used = 0,
      points_reset_at = next_reset,
      lifetime_points = lifetime_points + monthly
  where user_id = p_user
  returning * into row_out;

  perform private.ledger_append(
    p_user,
    monthly - old_points,
    monthly + row_out.bonus_points,
    'monthly-reset',
    'reset:' || extract(epoch from next_reset)::bigint,
    jsonb_build_object(
      'plan', row_out.plan,
      'monthlyPoints', monthly,
      'previousPoints', old_points
    )
  );

  return row_out;
end;
$$;

revoke all on function private.billing_apply_reset(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Snapshot: apply a due reset, then report both buckets
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

  row_out := private.billing_apply_reset(uid);

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
    'points', row_out.points + row_out.bonus_points,
    'planPoints', row_out.points,
    'bonusPoints', row_out.bonus_points,
    'monthlyPoints', case when plan_out = 'free' then 0 else row_out.monthly_points end,
    'pointsResetAt', row_out.points_reset_at,
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
-- Spending: plan points first, then the bonus bucket
-- ---------------------------------------------------------------------------

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
  from_plan integer;
  from_bonus integer;
  new_balance integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if charge = 0 then
    row_out := private.billing_apply_reset(uid);
    return jsonb_build_object(
      'ok', true, 'balance', row_out.points + row_out.bonus_points, 'duplicate', false
    );
  end if;
  if p_request_id is null or btrim(p_request_id) = '' then
    raise exception 'request id is required' using errcode = '22023';
  end if;

  row_out := private.billing_apply_reset(uid);

  select * into existing
  from public.point_ledger l
  where l.user_id = uid and l.request_id = p_request_id;
  if found then
    return jsonb_build_object(
      'ok', true,
      'balance', row_out.points + row_out.bonus_points,
      'duplicate', true
    );
  end if;

  if row_out.points + row_out.bonus_points < charge then
    raise exception 'insufficient_points' using errcode = 'P0001';
  end if;

  from_plan := least(row_out.points, charge);
  from_bonus := charge - from_plan;
  new_balance := row_out.points - from_plan + row_out.bonus_points - from_bonus;

  update public.billing_accounts
  set points = points - from_plan,
      bonus_points = bonus_points - from_bonus
  where user_id = uid
  returning * into row_out;

  perform private.ledger_append(
    uid, -charge, new_balance, coalesce(p_kind, 'spend'), p_request_id, p_metadata
  );

  return jsonb_build_object('ok', true, 'balance', new_balance, 'charged', charge, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds add plan points back; bonus points are untouched
-- ---------------------------------------------------------------------------

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

  row_out := private.billing_apply_reset(p_user);

  if amount = 0 then
    return jsonb_build_object('ok', true, 'balance', row_out.points + row_out.bonus_points);
  end if;

  if private.ledger_append(
    p_user,
    amount,
    row_out.points + row_out.bonus_points + amount,
    coalesce(p_kind, 'refund'),
    p_request_id,
    p_metadata
  ) then
    update public.billing_accounts
    set points = points + amount
    where user_id = p_user
    returning * into row_out;
  end if;

  return jsonb_build_object('ok', true, 'balance', row_out.points + row_out.bonus_points);
end;
$$;

-- ---------------------------------------------------------------------------
-- Image quota follows the same monthly reset
-- ---------------------------------------------------------------------------

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

  row_out := private.billing_apply_reset(uid);
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
-- Grants go to the bonus bucket
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

  row_out := private.billing_apply_reset(p_user);

  if private.ledger_append(
    p_user,
    amount,
    row_out.points + row_out.bonus_points + amount,
    coalesce(p_kind, 'grant'),
    p_request_id,
    p_metadata
  ) then
    update public.billing_accounts
    set bonus_points = bonus_points + amount,
        lifetime_points = lifetime_points + amount
    where user_id = p_user
    returning * into row_out;
  end if;

  return jsonb_build_object('ok', true, 'balance', row_out.points + row_out.bonus_points);
end;
$$;

-- ---------------------------------------------------------------------------
-- Subscription periods replace plan points instead of adding rollover
-- ---------------------------------------------------------------------------

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
  old_points integer;
  old_bonus integer;
  monthly integer := greatest(0, coalesce(p_grant_points, 0));
  new_period boolean := false;
  granted boolean := false;
  already_served boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_plan not in ('free', 'light', 'standard', 'pro') then
    raise exception 'unknown plan %', p_plan using errcode = '22023';
  end if;

  row_out := private.billing_row(p_user);
  -- A future reset date means this month's allowance has already been granted,
  -- but only for the same paid subscription: a free account with a stale reset
  -- date, or a brand-new subscription id, must receive its points.
  already_served := row_out.plan <> 'free'
    and (p_subscription_id is null
         or row_out.stripe_subscription_id is null
         or row_out.stripe_subscription_id = p_subscription_id)
    and coalesce(row_out.points_reset_at > now(), false);

  if p_period_key is not null and btrim(p_period_key) <> '' then
    new_period := not exists (
      select 1
      from public.point_ledger l
      where l.user_id = p_user and l.request_id = 'period:' || p_period_key
    );
  end if;

  -- Subscription status and metadata update on every webhook. The plan points
  -- and the monthly reset date only move when a new paid period is claimed.
  update public.billing_accounts
  set plan = p_plan,
      period_start = case when new_period then now() else period_start end,
      period_end = coalesce(p_period_end, period_end),
      subscription_status = p_status,
      stripe_customer_id = coalesce(p_customer_id, stripe_customer_id),
      stripe_subscription_id = coalesce(p_subscription_id, stripe_subscription_id),
      cancel_at_period_end = coalesce(p_cancel_at_period_end, false),
      monthly_points = monthly,
      points_reset_at = case
        -- A free or past-due subscription has no monthly schedule. Keeping a
        -- date here would make a lapsed account reset forever, and could make a
        -- later renewal look like an already-granted month.
        when monthly = 0 then null
        when new_period then now() + interval '1 month'
        else coalesce(points_reset_at, now() + interval '1 month')
      end
  where user_id = p_user
  returning * into row_out;

  -- A new paid period replaces the plan balance; it does not add to it. If the
  -- monthly reset already served this period, a late renewal webhook must not
  -- refill points the learner already spent: only the period key is recorded.
  -- Bonus points are outside this bucket and survive the reset.
  if new_period and monthly > 0 then
    if already_served then
      perform private.ledger_append(
        p_user,
        0,
        row_out.points + row_out.bonus_points,
        'period',
        'period:' || p_period_key,
        jsonb_build_object('plan', p_plan, 'periodEnd', p_period_end, 'servedByMonthlyReset', true)
      );
    else
      old_points := row_out.points;
      old_bonus := row_out.bonus_points;
      update public.billing_accounts
      set points = monthly,
          images_used = 0,
          lifetime_points = lifetime_points + monthly
      where user_id = p_user
      returning * into row_out;

      granted := private.ledger_append(
        p_user,
        monthly - old_points,
        monthly + old_bonus,
        'monthly',
        'period:' || p_period_key,
        jsonb_build_object('plan', p_plan, 'periodEnd', p_period_end)
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'plan', row_out.plan,
    'points', row_out.points + row_out.bonus_points,
    'granted', granted
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.billing_snapshot() from public, anon;
revoke all on function public.billing_spend(integer, text, text, jsonb) from public, anon;
revoke all on function public.billing_refund(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.billing_image_take(integer, integer) from public, anon;
revoke all on function public.billing_grant(uuid, integer, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.billing_set_subscription(
  uuid, text, text, timestamptz, integer, integer, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.billing_snapshot() to authenticated, service_role;
grant execute on function public.billing_spend(integer, text, text, jsonb) to authenticated, service_role;
grant execute on function public.billing_refund(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.billing_image_take(integer, integer) to authenticated, service_role;
grant execute on function public.billing_grant(uuid, integer, text, text, jsonb) to service_role;
grant execute on function public.billing_set_subscription(
  uuid, text, text, timestamptz, integer, integer, text, text, text, boolean
) to service_role;

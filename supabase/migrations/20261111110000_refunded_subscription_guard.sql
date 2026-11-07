-- ---------------------------------------------------------------------------
-- A refunded subscription stays refunded
--
-- The trigger in the previous migration already forces the stored row back to
-- the free plan. Without this early return, `billing_set_subscription` would
-- still write a `period`/`monthly` ledger entry and report `granted: true`
-- before the trigger corrected the row. A late Stripe webhook would therefore
-- look successful while granting nothing. This wrapper keeps the update and the
-- response consistent.
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
  old_monthly integer;
  extra integer;
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

  -- A late webhook for the refunded subscription must not restore the plan,
  -- grant points or report a grant. A new subscription id is a new Checkout and
  -- is allowed through (the trigger also clears the refund marker).
  if row_out.refunded_at is not null
     and (p_subscription_id is null
          or p_subscription_id = row_out.stripe_subscription_id) then
    update public.billing_accounts
    set plan = 'free',
        points = 0,
        monthly_points = 0,
        points_reset_at = null,
        images_used = 0,
        subscription_status = 'refunded',
        cancel_at_period_end = false
    where user_id = p_user
    returning * into row_out;

    return jsonb_build_object(
      'ok', true,
      'plan', row_out.plan,
      'points', row_out.points + row_out.bonus_points,
      'granted', false,
      'refunded', true
    );
  end if;

  old_monthly := row_out.monthly_points;
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

  -- A plan change inside a period has no new period key. Raise the allowance by
  -- the difference only; a downgrade keeps whatever is left until the reset.
  if not new_period
     and already_served
     and monthly > old_monthly
     and p_subscription_id is not null then
    extra := monthly - old_monthly;
    if private.ledger_append(
      p_user,
      extra,
      row_out.points + row_out.bonus_points + extra,
      'plan-change',
      'plan-change:' || p_subscription_id || ':' || coalesce(p_period_key, '') || ':' || p_plan,
      jsonb_build_object(
        'plan', p_plan,
        'monthlyPoints', monthly,
        'previousMonthlyPoints', old_monthly,
        'periodEnd', p_period_end
      )
    ) then
      update public.billing_accounts
      set points = points + extra,
          lifetime_points = lifetime_points + extra
      where user_id = p_user
      returning * into row_out;
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

revoke all on function public.billing_set_subscription(
  uuid, text, text, timestamptz, integer, integer, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.billing_set_subscription(
  uuid, text, text, timestamptz, integer, integer, text, text, text, boolean
) to service_role;

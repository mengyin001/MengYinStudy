-- ---------------------------------------------------------------------------
-- Refund status from `charge.refund.updated`
--
-- A card refund normally succeeds immediately, but some payment methods return
-- `pending` and can later fail asynchronously. The initial API call records the
-- status it saw; the Stripe webhook updates that row when Stripe reports a new
-- status. The account is not silently restored on failure: the refunded
-- subscription was already canceled, so support has to handle that case.
-- ---------------------------------------------------------------------------

alter table public.billing_refunds
  add column if not exists status text not null default 'pending',
  add column if not exists failure_reason text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.billing_refunds
  drop constraint if exists billing_refunds_status_check;
alter table public.billing_refunds
  add constraint billing_refunds_status_check
  check (status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled'));

comment on column public.billing_refunds.status is
  'Stripe refund status, refreshed by charge.refund.updated.';
comment on column public.billing_refunds.failure_reason is
  'Stripe failure_reason when a refund fails after it was recorded.';

-- Keep a record of the status reported by the webhook.
create or replace function public.billing_set_refund_status(
  p_refund_id text,
  p_status text,
  p_failure_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_refund_id is null or btrim(p_refund_id) = '' then
    raise exception 'refund id is required' using errcode = '22023';
  end if;
  if p_status not in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') then
    raise exception 'unknown refund status %', p_status using errcode = '22023';
  end if;

  update public.billing_refunds
  set status = p_status,
      failure_reason = p_failure_reason,
      updated_at = now()
  where stripe_refund_id = p_refund_id;

  return jsonb_build_object('updated', found, 'status', p_status);
end;
$$;

revoke all on function public.billing_set_refund_status(text, text, text)
  from public, anon, authenticated;
grant execute on function public.billing_set_refund_status(text, text, text)
  to service_role;

-- The function signature grows by one status argument. Drop the old overload
-- first so PostgREST cannot route to a version that never records status.
drop function if exists public.billing_finalize_refund(
  uuid, text, text, text, integer, text, integer, integer, numeric, text
);

create or replace function public.billing_finalize_refund(
  p_user uuid,
  p_refund_id text,
  p_invoice_id text,
  p_subscription_id text,
  p_amount integer,
  p_currency text,
  p_unused_points integer,
  p_monthly_points integer,
  p_refund_ratio numeric,
  p_reason text,
  p_status text default 'succeeded'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_out public.billing_accounts;
  old_points integer;
  inserted boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_refund_id is null or btrim(p_refund_id) = ''
     or p_invoice_id is null or btrim(p_invoice_id) = '' then
    raise exception 'refund id and invoice id are required' using errcode = '22023';
  end if;
  if p_status not in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled') then
    raise exception 'unknown refund status %', p_status using errcode = '22023';
  end if;

  row_out := private.billing_row(p_user);

  insert into public.billing_refunds (
    user_id,
    stripe_refund_id,
    stripe_invoice_id,
    stripe_subscription_id,
    amount_cents,
    currency,
    unused_points,
    monthly_points,
    refund_ratio,
    reason,
    status
  ) values (
    p_user,
    p_refund_id,
    p_invoice_id,
    p_subscription_id,
    greatest(0, coalesce(p_amount, 0)),
    lower(coalesce(nullif(btrim(p_currency), ''), 'usd')),
    greatest(0, coalesce(p_unused_points, 0)),
    greatest(0, coalesce(p_monthly_points, 0)),
    least(1, greatest(0, coalesce(p_refund_ratio, 0)))::numeric(8, 6),
    p_reason,
    p_status
  )
  on conflict (user_id, stripe_invoice_id) do nothing;
  inserted := found;

  if inserted then
    old_points := row_out.points;

    update public.billing_accounts
    set plan = 'free',
        points = 0,
        monthly_points = 0,
        points_reset_at = null,
        images_used = 0,
        subscription_status = 'refunded',
        cancel_at_period_end = false,
        refunded_at = now(),
        refunded_invoice_id = p_invoice_id
    where user_id = p_user
    returning * into row_out;

    if old_points > 0 then
      perform private.ledger_append(
        p_user,
        -old_points,
        row_out.bonus_points,
        'refund',
        'refund:' || p_invoice_id,
        jsonb_build_object(
          'refundId', p_refund_id,
          'amountCents', greatest(0, coalesce(p_amount, 0)),
          'currency', lower(coalesce(p_currency, 'usd')),
          'unusedPoints', greatest(0, coalesce(p_unused_points, 0)),
          'monthlyPoints', greatest(0, coalesce(p_monthly_points, 0)),
          'refundRatio', least(1, greatest(0, coalesce(p_refund_ratio, 0))),
          'status', p_status
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'already', not inserted,
    'status', p_status,
    'balance', row_out.points + row_out.bonus_points
  );
end;
$$;

revoke all on function public.billing_finalize_refund(
  uuid, text, text, text, integer, text, integer, integer, numeric, text, text
) from public, anon, authenticated;

grant execute on function public.billing_finalize_refund(
  uuid, text, text, text, integer, text, integer, integer, numeric, text, text
) to service_role;

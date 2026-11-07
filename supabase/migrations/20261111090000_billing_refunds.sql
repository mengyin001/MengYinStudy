-- ---------------------------------------------------------------------------
-- 0.8.0 — subscription refunds
--
-- A refund is both money and access. The API refunds the unused part of the
-- latest payment through Stripe, then calls `billing_finalize_refund` to:
--
--   1. record the refund against the invoice (unique, so a retry is a no-op);
--   2. clear the remaining plan points;
--   3. return the account to the free plan; and
--   4. mark the subscription as refunded.
--
-- The marker matters. Stripe can deliver a late `customer.subscription.updated`
-- after the refund, and the normal webhook path would otherwise restore the
-- paid plan and grant its monthly points again. The trigger below makes the
-- database the final authority: while the same subscription is marked refunded,
-- no update can put the account back on a paid plan. A genuinely new
-- subscription id clears the marker.
-- ---------------------------------------------------------------------------

alter table public.billing_accounts
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_invoice_id text;

comment on column public.billing_accounts.refunded_at is
  'When the latest subscription payment was refunded; blocks a late webhook from restoring the plan.';
comment on column public.billing_accounts.refunded_invoice_id is
  'Stripe invoice whose payment was refunded.';

create table if not exists public.billing_refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_refund_id text not null unique,
  stripe_invoice_id text not null,
  stripe_subscription_id text,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  unused_points integer not null default 0 check (unused_points >= 0),
  monthly_points integer not null default 0 check (monthly_points >= 0),
  refund_ratio numeric(8, 6) not null default 0 check (refund_ratio >= 0 and refund_ratio <= 1),
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, stripe_invoice_id)
);

comment on table public.billing_refunds is
  'One row per refunded Stripe invoice. The unique invoice key makes the HTTP retry idempotent.';

create index if not exists billing_refunds_user_created
  on public.billing_refunds (user_id, created_at desc);

alter table public.billing_refunds enable row level security;

drop policy if exists billing_refunds_select_own on public.billing_refunds;
create policy billing_refunds_select_own
on public.billing_refunds for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists billing_refunds_select_admin on public.billing_refunds;
create policy billing_refunds_select_admin
on public.billing_refunds for select
to authenticated
using ((select private.is_admin()));

revoke all on table public.billing_refunds from anon, authenticated;
grant select on table public.billing_refunds to authenticated;
grant all on table public.billing_refunds to service_role;

-- ---------------------------------------------------------------------------
-- A refunded subscription cannot come back to life.
-- ---------------------------------------------------------------------------

create or replace function private.billing_keep_refunded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A genuinely new subscription (a fresh Checkout) starts with a clean slate.
  if new.stripe_subscription_id is distinct from old.stripe_subscription_id
     and new.stripe_subscription_id is not null then
    new.refunded_at := null;
    new.refunded_invoice_id := null;
    return new;
  end if;

  if old.refunded_at is not null
     and new.stripe_subscription_id is not distinct from old.stripe_subscription_id then
    new.plan := 'free';
    new.points := 0;
    new.bonus_points := old.bonus_points;
    new.monthly_points := 0;
    new.points_reset_at := null;
    new.images_used := 0;
    new.lifetime_points := old.lifetime_points;
    new.subscription_status := 'refunded';
    new.cancel_at_period_end := false;
  end if;

  return new;
end;
$$;

revoke all on function private.billing_keep_refunded()
  from public, anon, authenticated, service_role;

drop trigger if exists billing_accounts_keep_refunded on public.billing_accounts;
create trigger billing_accounts_keep_refunded
before update on public.billing_accounts
for each row execute function private.billing_keep_refunded();

-- ---------------------------------------------------------------------------
-- Record the money and remove the paid plan in one transaction.
-- ---------------------------------------------------------------------------

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
  p_reason text
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
    reason
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
    p_reason
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
          'refundRatio', least(1, greatest(0, coalesce(p_refund_ratio, 0)))
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'already', not inserted,
    'balance', row_out.points + row_out.bonus_points
  );
end;
$$;

revoke all on function public.billing_finalize_refund(
  uuid, text, text, text, integer, text, integer, integer, numeric, text
) from public, anon, authenticated;

grant execute on function public.billing_finalize_refund(
  uuid, text, text, text, integer, text, integer, integer, numeric, text
) to service_role;

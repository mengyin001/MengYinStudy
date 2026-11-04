-- ---------------------------------------------------------------------------
-- 0.5.0 — live progress sync
--
-- `user_progress` is now written by every signed-in device, not only by the
-- manual backup button. Two changes are needed:
--
-- 1. Clients must be able to insert their explicit `user_id`. The default is
--    still `auth.uid()`, but naming it lets the client bind a write to the
--    account that started it; a stale write from another account is rejected by
--    the insert policy instead of landing in the wrong row.
-- 2. Realtime must publish this table so other devices can pull immediately.
--    RLS still applies to the subscription: a learner only receives their row.
--
-- `updated_at` remains the optimistic-concurrency token: a conditional update
-- filters on the value the client last saw and returns no row when someone else
-- wrote first.
-- ---------------------------------------------------------------------------

grant insert (user_id, progress) on table public.user_progress to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_progress'
  ) then
    alter publication supabase_realtime add table public.user_progress;
  end if;
end
$$;

comment on table public.user_progress is
  'Private learner progress snapshot; owner-only RLS, live-synced through Realtime.';

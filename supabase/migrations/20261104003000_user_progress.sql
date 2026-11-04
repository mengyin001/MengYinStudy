-- ---------------------------------------------------------------------------
-- 0.3.0 — private progress snapshots
--
-- One row per learner. The JSON is the same ProgressState the app stores in
-- IndexedDB (attempts, cards, flags, notes, sessions, settings). It is a
-- backup/restore path, not a live multi-writer merge: the last explicit upload
-- wins. Owner-only RLS; no admin or anonymous read.
-- ---------------------------------------------------------------------------

create table if not exists public.user_progress (
  user_id uuid primary key default auth.uid()
    references auth.users (id) on delete cascade,
  progress jsonb not null,
  updated_at timestamptz not null default now(),
  constraint user_progress_size
    check (octet_length(progress::text) <= 8388608)
);

comment on table public.user_progress is
  'Private learner progress snapshot; owner-only RLS.';

drop trigger if exists user_progress_set_updated_at on public.user_progress;
create trigger user_progress_set_updated_at
before update on public.user_progress
for each row execute function public.set_updated_at();

alter table public.user_progress enable row level security;

drop policy if exists user_progress_select_own on public.user_progress;
create policy user_progress_select_own
on public.user_progress for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists user_progress_insert_own on public.user_progress;
create policy user_progress_insert_own
on public.user_progress for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists user_progress_update_own on public.user_progress;
create policy user_progress_update_own
on public.user_progress for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists user_progress_delete_own on public.user_progress;
create policy user_progress_delete_own
on public.user_progress for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.user_progress from anon, authenticated;
grant select on table public.user_progress to authenticated;
grant insert (progress) on table public.user_progress to authenticated;
grant update (progress) on table public.user_progress to authenticated;
grant delete on table public.user_progress to authenticated;
grant all on table public.user_progress to service_role;

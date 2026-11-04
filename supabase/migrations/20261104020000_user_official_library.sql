-- ---------------------------------------------------------------------------
-- 0.4.0 — a learner's own library of official decks
--
-- Official packs/decks are a public catalogue: they are not copied into a
-- learner's library until the learner explicitly adds them from the Plaza.
-- This table stores that choice (a subscription), not a second copy of the
-- questions, so a catalogue update is reflected the next time the app syncs.
--
-- Every row is owner-only. The composite foreign key means an unpublished or
-- deleted official deck cannot stay in a learner's library by accident.
-- ---------------------------------------------------------------------------

create table if not exists public.user_official_decks (
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  pack_id text not null,
  deck_id text not null,
  added_at timestamptz not null default now(),

  primary key (user_id, pack_id, deck_id),
  foreign key (pack_id, deck_id)
    references public.official_decks (pack_id, id)
    on delete cascade
);

comment on table public.user_official_decks is
  'Official decks a learner has explicitly added to their own library; owner-only RLS.';

create index if not exists user_official_decks_user_added_idx
  on public.user_official_decks (user_id, added_at desc);

alter table public.user_official_decks enable row level security;

drop policy if exists user_official_decks_select_own on public.user_official_decks;
create policy user_official_decks_select_own
on public.user_official_decks for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists user_official_decks_insert_own on public.user_official_decks;
create policy user_official_decks_insert_own
on public.user_official_decks for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists user_official_decks_delete_own on public.user_official_decks;
create policy user_official_decks_delete_own
on public.user_official_decks for delete
to authenticated
using ((select auth.uid()) = user_id);

-- `user_id` is intentionally absent from the insert grant: the column defaults
-- to auth.uid(), and a client-supplied value would fail the RLS check anyway.
revoke all on table public.user_official_decks from anon, authenticated;
grant select on table public.user_official_decks to authenticated;
grant insert (pack_id, deck_id) on table public.user_official_decks to authenticated;
grant delete on table public.user_official_decks to authenticated;
grant all on table public.user_official_decks to service_role;

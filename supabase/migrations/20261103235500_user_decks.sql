-- ---------------------------------------------------------------------------
-- 0.3.0 — per-user cloud copies of AI-generated decks
--
-- A learner can upload a deck they generated locally and read it again on
-- another device after signing in. There is deliberately no public or admin
-- read path: every policy compares `user_id` with `auth.uid()`.
--
-- The row keeps the original plugin/deck ids so the deck key stays stable and
-- progress already recorded on the uploading device still matches.
-- ---------------------------------------------------------------------------

create table if not exists public.user_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  client_key text not null,
  plugin_id text not null,
  deck_id text not null,
  title text not null,
  description text,
  tags text[] not null default '{}',
  questions jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_decks_client_key_len
    check (char_length(client_key) between 1 and 200),
  constraint user_decks_client_key_matches
    check (client_key = plugin_id || '::' || deck_id),
  constraint user_decks_plugin_id_len
    check (char_length(plugin_id) between 1 and 128),
  constraint user_decks_deck_id_len
    check (char_length(deck_id) between 1 and 128),
  constraint user_decks_title_len
    check (char_length(title) between 1 and 200),
  constraint user_decks_description_len
    check (description is null or char_length(description) <= 2000),
  constraint user_decks_tags_len
    check (cardinality(tags) <= 20),
  constraint user_decks_questions_array
    check (jsonb_typeof(questions) = 'array'),
  constraint user_decks_questions_count
    check (
      case
        when jsonb_typeof(questions) = 'array'
          then jsonb_array_length(questions) between 1 and 500
        else false
      end
    ),
  constraint user_decks_questions_size
    check (octet_length(questions::text) <= 1048576),

  constraint user_decks_user_client_unique unique (user_id, client_key)
);

comment on table public.user_decks is
  'Private cloud copies of a learner''s generated decks; owner-only RLS.';

create index if not exists user_decks_user_updated_idx
  on public.user_decks (user_id, updated_at desc);

drop trigger if exists user_decks_set_updated_at on public.user_decks;
create trigger user_decks_set_updated_at
before update on public.user_decks
for each row execute function public.set_updated_at();

alter table public.user_decks enable row level security;

drop policy if exists user_decks_select_own on public.user_decks;
create policy user_decks_select_own
on public.user_decks for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists user_decks_insert_own on public.user_decks;
create policy user_decks_insert_own
on public.user_decks for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists user_decks_update_own on public.user_decks;
create policy user_decks_update_own
on public.user_decks for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists user_decks_delete_own on public.user_decks;
create policy user_decks_delete_own
on public.user_decks for delete
to authenticated
using ((select auth.uid()) = user_id);

-- `user_id` is intentionally absent from insert/update grants: the column
-- defaults to auth.uid(), and a client-supplied value would be checked by RLS
-- anyway. Metadata columns are also server-owned.
revoke all on table public.user_decks from anon, authenticated;
grant select on table public.user_decks to authenticated;
grant insert (client_key, plugin_id, deck_id, title, description, tags, questions)
  on table public.user_decks to authenticated;
grant update (title, description, tags, questions)
  on table public.user_decks to authenticated;
grant delete on table public.user_decks to authenticated;
grant all on table public.user_decks to service_role;

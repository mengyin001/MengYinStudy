-- ---------------------------------------------------------------------------
-- 0.8.x — learner-created collections of their own decks
--
-- A collection is an ordered list of deck keys (`pluginId::deckId`). It stores
-- references, not copies: a deck keeps its own cloud row and progress, and one
-- deck may belong to more than one collection. The keys are deliberately not a
-- foreign key because they can point at a cloud deck, an imported local deck,
-- an official deck the learner added, or a bundled starter deck.
--
-- Every row is owner-only. The client id is generated on the device so a
-- collection has a stable identity before the first cloud write; the server
-- keeps it as the primary key and scopes reads through `auth.uid()`.
-- ---------------------------------------------------------------------------

create table if not exists public.user_collections (
  client_id text primary key,
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null,
  description text,
  deck_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_collections_client_id_len
    check (char_length(client_id) between 1 and 128),
  constraint user_collections_name_len
    check (char_length(name) between 1 and 80),
  constraint user_collections_description_len
    check (description is null or char_length(description) <= 2000),
  constraint user_collections_deck_keys_count
    check (cardinality(deck_keys) <= 500),
  constraint user_collections_deck_keys_non_null
    check (array_position(deck_keys, null) is null),
  constraint user_collections_deck_keys_size
    check (octet_length(array_to_string(deck_keys, ' ')) <= 65536)
);

comment on table public.user_collections is
  'Learner-created collections of deck keys; owner-only RLS, references not copies.';

create index if not exists user_collections_user_updated_idx
  on public.user_collections (user_id, updated_at desc);

drop trigger if exists user_collections_set_updated_at on public.user_collections;
create trigger user_collections_set_updated_at
before update on public.user_collections
for each row execute function public.set_updated_at();

alter table public.user_collections enable row level security;

drop policy if exists user_collections_select_own on public.user_collections;
create policy user_collections_select_own
on public.user_collections for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists user_collections_insert_own on public.user_collections;
create policy user_collections_insert_own
on public.user_collections for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists user_collections_update_own on public.user_collections;
create policy user_collections_update_own
on public.user_collections for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists user_collections_delete_own on public.user_collections;
create policy user_collections_delete_own
on public.user_collections for delete
to authenticated
using ((select auth.uid()) = user_id);

-- `user_id` is intentionally absent from the insert/update grants: the column
-- defaults to auth.uid(), and a client-supplied value would fail the RLS check
-- anyway. `client_id` is insert-only so a rename cannot fork the identity.
revoke all on table public.user_collections from anon, authenticated;
grant select on table public.user_collections to authenticated;
grant insert (client_id, name, description, deck_keys)
  on table public.user_collections to authenticated;
grant update (name, description, deck_keys)
  on table public.user_collections to authenticated;
grant delete on table public.user_collections to authenticated;
grant all on table public.user_collections to service_role;

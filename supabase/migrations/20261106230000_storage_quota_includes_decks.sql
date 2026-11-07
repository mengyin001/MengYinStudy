-- ---------------------------------------------------------------------------
-- 0.7.0 - one 30 MB budget for deck JSON and images
--
--   * A text-only deck occupies database bytes and must count too.
--   * A user-decks write and an image upload both take the same per-account
--     advisory lock, so two saves cannot race past the limit.
-- ---------------------------------------------------------------------------

create or replace function private.user_deck_bytes(
  owner uuid,
  exclude_id uuid default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    sum(
      octet_length(d.questions::text)
      + coalesce(octet_length(d.entry_source), 0)
      + octet_length(d.title)
      + coalesce(octet_length(d.description), 0)
      + coalesce(octet_length(array_to_string(d.tags, ',')), 0)
      + octet_length(d.client_key)
      + octet_length(d.plugin_id)
      + octet_length(d.deck_id)
    ),
    0
  )
  from public.user_decks d
  where d.user_id = owner
    and (exclude_id is null or d.id <> exclude_id);
$$;

create or replace function private.user_media_bytes(owner uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    sum((o.metadata ->> 'size')::bigint),
    0
  )
  from storage.objects o
  where o.bucket_id = 'user-media'
    and split_part(o.name, '/', 1) = owner::text;
$$;

create or replace function public.user_media_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'bytes',
      private.user_deck_bytes((select auth.uid()))
      + private.user_media_bytes((select auth.uid())),
    'deckBytes', private.user_deck_bytes((select auth.uid())),
    'storageBytes', private.user_media_bytes((select auth.uid())),
    'limit', 31457280
  );
$$;

revoke all on function public.user_media_usage() from public, anon;
grant execute on function public.user_media_usage() to authenticated;

/**
 * Enforce the budget when an image is inserted or replaced. Text that is
 * already saved in user_decks counts before the image does.
 */
create or replace function private.enforce_user_storage_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  owner_text text;
  deck_bytes bigint;
  media_bytes bigint;
  new_bytes bigint;
begin
  if new.bucket_id <> 'user-media' then
    return new;
  end if;

  owner_text := split_part(new.name, '/', 1);
  owner_id := owner_text::uuid;

  -- Service-role migrations and admin tooling are not tied to an end user.
  if (select auth.uid()) is null then
    return new;
  end if;

  if owner_id <> (select auth.uid()) then
    raise exception 'user-media object owner does not match the signed-in account'
      using errcode = '42501';
  end if;

  new_bytes := coalesce((new.metadata ->> 'size')::bigint, 0);
  perform pg_advisory_xact_lock(hashtext('user-storage:' || owner_id::text));

  deck_bytes := private.user_deck_bytes(owner_id);
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
    into media_bytes
    from storage.objects o
    where o.bucket_id = 'user-media'
      and split_part(o.name, '/', 1) = owner_text
      -- On upsert the old version of this same path must not be counted twice.
      and o.name <> new.name;

  if deck_bytes + media_bytes + new_bytes > 31457280 then
    raise exception 'user_storage_quota_exceeded: this account has used % of 31457280 bytes',
      deck_bytes + media_bytes
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists storage_enforce_user_media_quota on storage.objects;
drop trigger if exists storage_enforce_user_storage_quota on storage.objects;
create trigger storage_enforce_user_storage_quota
before insert or update of name, bucket_id, metadata on storage.objects
for each row execute function private.enforce_user_storage_quota();

/**
 * Enforce the same budget for the text side. The current row is excluded so an
 * update is measured against the other decks plus all images.
 */
create or replace function private.enforce_user_deck_storage_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  other_decks bigint;
  media_bytes bigint;
  new_bytes bigint;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  owner_id := coalesce(new.user_id, (select auth.uid()));
  if owner_id <> (select auth.uid()) then
    raise exception 'user_deck owner does not match the signed-in account'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('user-storage:' || owner_id::text));

  other_decks := private.user_deck_bytes(owner_id, new.id);
  media_bytes := private.user_media_bytes(owner_id);
  new_bytes :=
    octet_length(new.questions::text)
    + coalesce(octet_length(new.entry_source), 0)
    + octet_length(new.title)
    + coalesce(octet_length(new.description), 0)
    + coalesce(octet_length(array_to_string(new.tags, ',')), 0)
    + octet_length(new.client_key)
    + octet_length(new.plugin_id)
    + octet_length(new.deck_id);

  if other_decks + media_bytes + new_bytes > 31457280 then
    raise exception 'user_storage_quota_exceeded: this account has used % of 31457280 bytes',
      other_decks + media_bytes
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists user_decks_enforce_storage_quota on public.user_decks;
create trigger user_decks_enforce_storage_quota
before insert or update on public.user_decks
for each row execute function private.enforce_user_deck_storage_quota();

drop function if exists private.enforce_user_media_quota();

notify pgrst, 'reload schema';

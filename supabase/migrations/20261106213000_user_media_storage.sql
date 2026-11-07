-- ---------------------------------------------------------------------------
-- 0.7.0 - private image storage for learner decks
--
-- Generated and imported illustrations are uploaded to a private bucket and the
-- deck JSON keeps only a `storage:<path>` reference. The database row therefore
-- stays small even when a deck has many images.
--
-- Every account gets 30 MB of image storage. The limit is enforced in a trigger
-- on storage.objects, not only in the browser, because a signed-in client could
-- otherwise call the Storage API directly and bypass the UI check.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-media',
  'user-media',
  false,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Path layout: <user-id>/<deck-id>/<question-id>-<hash>.<ext>. The first folder
-- segment is the owner, so one simple predicate protects every object.
drop policy if exists user_media_read on storage.objects;
create policy user_media_read
on storage.objects for select
to authenticated
using (
  bucket_id = 'user-media'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

drop policy if exists user_media_insert on storage.objects;
create policy user_media_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'user-media'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

drop policy if exists user_media_update on storage.objects;
create policy user_media_update
on storage.objects for update
to authenticated
using (
  bucket_id = 'user-media'
  and split_part(name, '/', 1) = (select auth.uid())::text
)
with check (
  bucket_id = 'user-media'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

drop policy if exists user_media_delete on storage.objects;
create policy user_media_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'user-media'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

-- No extra index on storage.objects: that table is owned by
-- supabase_storage_admin, and a migration running as postgres cannot create an
-- index on it. Existing Storage indexes are sufficient for the folder filter.

-- The browser reads this through PostgREST RPC; the table itself is not
-- exposed outside Storage.
create or replace function public.user_media_usage()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'bytes',
    coalesce(
      (
        select sum((o.metadata ->> 'size')::bigint)
        from storage.objects o
        where o.bucket_id = 'user-media'
          and split_part(o.name, '/', 1) = (select auth.uid())::text
      ),
      0
    ),
    -- Keep this number in sync with USER_MEDIA_LIMIT_BYTES in the web app.
    'limit', 31457280
  );
$$;

revoke all on function public.user_media_usage() from public, anon;
grant execute on function public.user_media_usage() to authenticated;

/**
 * Enforce the per-account image budget on the table Storage writes to. The
 * advisory lock serialises concurrent uploads for the same account, so two
 * requests cannot both observe 29 MB free and both succeed.
 */
create or replace function private.enforce_user_media_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id text;
  used_bytes bigint;
  new_bytes bigint;
begin
  if new.bucket_id <> 'user-media' then
    return new;
  end if;

  owner_id := split_part(new.name, '/', 1);
  if owner_id is null then
    raise exception 'user-media objects must live under a user folder'
      using errcode = '42501';
  end if;

  -- Service-role migrations and admin tooling are not tied to an end user.
  if (select auth.uid()) is null then
    return new;
  end if;

  if owner_id <> (select auth.uid())::text then
    raise exception 'user-media object owner does not match the signed-in account'
      using errcode = '42501';
  end if;

  new_bytes := coalesce((new.metadata ->> 'size')::bigint, 0);
  perform pg_advisory_xact_lock(hashtext('user-media:' || owner_id));

  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)
    into used_bytes
    from storage.objects o
    where o.bucket_id = 'user-media'
      and split_part(o.name, '/', 1) = owner_id
      -- On upsert the old version of this same path must not be counted twice.
      and o.name <> new.name;

  if used_bytes + new_bytes > 31457280 then
    raise exception 'user_media_quota_exceeded: this account has used % of 31457280 bytes',
      used_bytes
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists storage_enforce_user_media_quota on storage.objects;
create trigger storage_enforce_user_media_quota
before insert or update of name, bucket_id, metadata on storage.objects
for each row execute function private.enforce_user_media_quota();

comment on function public.user_media_usage() is
  'Bytes and limit for the signed-in account''s private image bucket.';

-- Make the new RPC visible to PostgREST immediately (the migration runner does
-- not use the Supabase CLI's schema-cache hook).
notify pgrst, 'reload schema';


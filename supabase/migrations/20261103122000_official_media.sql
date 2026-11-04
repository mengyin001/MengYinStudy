-- ---------------------------------------------------------------------------
-- 0.3.0 — public media bucket for official decks
--
-- The bucket is public because the deck JSON is public too. Only admins (or the
-- service role used by tools/seed-official.mjs) may upload or replace objects.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('official-media', 'official-media', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists official_media_read on storage.objects;
create policy official_media_read
on storage.objects for select
to anon, authenticated
using (bucket_id = 'official-media');

drop policy if exists official_media_insert on storage.objects;
create policy official_media_insert
on storage.objects for insert
to authenticated
with check (bucket_id = 'official-media' and (select private.is_admin()));

drop policy if exists official_media_update on storage.objects;
create policy official_media_update
on storage.objects for update
to authenticated
using (bucket_id = 'official-media' and (select private.is_admin()))
with check (bucket_id = 'official-media' and (select private.is_admin()));

drop policy if exists official_media_delete on storage.objects;
create policy official_media_delete
on storage.objects for delete
to authenticated
using (bucket_id = 'official-media' and (select private.is_admin()));

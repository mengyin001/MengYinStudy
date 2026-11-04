-- ---------------------------------------------------------------------------
-- 0.3.0 — cloud decks may carry inline images and a runtime module
--
-- Relative images in imported folders are converted to data: URLs before
-- upload, so the JSON is self-contained. `entry_source` is the plugin's
-- single-file ES module (for custom question types/importers); it is executed
-- only for the owner's own cloud decks. Nothing here is public.
-- ---------------------------------------------------------------------------

alter table public.user_decks
  add column if not exists entry_source text;

alter table public.user_decks
  drop constraint if exists user_decks_questions_size;
alter table public.user_decks
  add constraint user_decks_questions_size
  check (octet_length(questions::text) <= 8388608);

alter table public.user_decks
  drop constraint if exists user_decks_entry_source_size;
alter table public.user_decks
  add constraint user_decks_entry_source_size
  check (entry_source is null or octet_length(entry_source) <= 1048576);

grant insert (entry_source) on table public.user_decks to authenticated;
grant update (entry_source) on table public.user_decks to authenticated;

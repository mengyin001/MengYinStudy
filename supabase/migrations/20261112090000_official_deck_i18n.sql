-- ---------------------------------------------------------------------------
-- 0.8.0 — bilingual official decks
--
-- Deck rows keep English in `title` / `description` (the fallback) and store
-- the per-language overrides here. Question text already travels inside the
-- `questions` JSON, so only the deck-level strings need new columns.
-- ---------------------------------------------------------------------------

alter table public.official_decks
  add column if not exists title_i18n jsonb,
  add column if not exists description_i18n jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'official_deck_title_i18n_is_object'
  ) then
    alter table public.official_decks
      add constraint official_deck_title_i18n_is_object
      check (title_i18n is null or jsonb_typeof(title_i18n) = 'object');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'official_deck_description_i18n_is_object'
  ) then
    alter table public.official_decks
      add constraint official_deck_description_i18n_is_object
      check (description_i18n is null or jsonb_typeof(description_i18n) = 'object');
  end if;
end
$$;

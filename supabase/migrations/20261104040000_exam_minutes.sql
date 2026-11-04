-- ---------------------------------------------------------------------------
-- 0.5.1 — exam length belongs to the paper
--
-- A deck may declare its whole-paper exam length instead of inheriting one
-- fixed app-wide countdown. Official decks publish `exam_minutes` (authored
-- content or the seed script's question-based estimate); private decks store
-- the value the AI generator set. NULL means the client estimates from the
-- questions, so older rows keep working without a backfill.
-- ---------------------------------------------------------------------------

alter table public.official_decks
  add column if not exists exam_minutes integer;

alter table public.official_decks
  drop constraint if exists official_decks_exam_minutes_range;
alter table public.official_decks
  add constraint official_decks_exam_minutes_range
  check (exam_minutes is null or exam_minutes between 1 and 600);

alter table public.user_decks
  add column if not exists exam_minutes integer;

alter table public.user_decks
  drop constraint if exists user_decks_exam_minutes_range;
alter table public.user_decks
  add constraint user_decks_exam_minutes_range
  check (exam_minutes is null or exam_minutes between 1 and 600);

grant insert (exam_minutes) on table public.user_decks to authenticated;
grant update (exam_minutes) on table public.user_decks to authenticated;

comment on column public.official_decks.exam_minutes is
  'Whole-paper exam length in minutes; NULL means the client estimates it.';

comment on column public.user_decks.exam_minutes is
  'Whole-paper exam length in minutes set when the deck was generated; NULL means estimate.';

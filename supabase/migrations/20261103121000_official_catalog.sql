-- ---------------------------------------------------------------------------
-- 0.3.0 — official question catalogue
--
-- Published packs/decks are readable by everyone (including the anonymous
-- client) so the app can show the official bank before sign-in. Writes are
-- restricted to admins by RLS. A singleton metadata row carries a monotonic
-- version; a statement-level trigger bumps it after any content change, which
-- is what makes the client refresh only when something actually changed.
-- ---------------------------------------------------------------------------

create table if not exists public.official_packs (
  id text primary key
    check (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$'),
  name text not null check (char_length(name) between 1 and 80),
  version text not null default '1.0.0',
  description text,
  author text,
  homepage text,
  license text,
  tags text[] not null default '{}',
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.official_decks (
  id text not null,
  pack_id text not null references public.official_packs (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  tags text[] not null default '{}',
  questions jsonb not null,
  media_base_url text,
  version text not null default '1',
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pack_id, id),
  constraint official_deck_questions_is_array check (jsonb_typeof(questions) = 'array'),
  constraint official_deck_questions_not_empty check (
    case
      when jsonb_typeof(questions) = 'array' then jsonb_array_length(questions) > 0
      else false
    end
  )
);

create index if not exists official_decks_pack_order_idx
  on public.official_decks (pack_id, sort_order, title);

-- The public catalogue query is always `published = true`, ordered for display.
create index if not exists official_packs_published_order_idx
  on public.official_packs (sort_order, name) where published;

create index if not exists official_decks_published_order_idx
  on public.official_decks (sort_order, title) where published;

create or replace function public.touch_official_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists official_packs_touch on public.official_packs;
create trigger official_packs_touch
before update on public.official_packs
for each row execute function public.touch_official_updated_at();

drop trigger if exists official_decks_touch on public.official_decks;
create trigger official_decks_touch
before update on public.official_decks
for each row execute function public.touch_official_updated_at();

create table if not exists public.official_catalog_meta (
  id boolean primary key default true check (id),
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.official_catalog_meta (id)
values (true)
on conflict (id) do nothing;

create or replace function public.bump_official_catalog_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.official_catalog_meta
     set version = version + 1,
         updated_at = now()
   where id = true;

  if not found then
    insert into public.official_catalog_meta (id, version, updated_at)
    values (true, 2, now())
    on conflict (id) do update
      set version = official_catalog_meta.version + 1,
          updated_at = now();
  end if;

  return null;
end;
$$;

drop trigger if exists official_packs_catalog_version on public.official_packs;
create trigger official_packs_catalog_version
after insert or update or delete on public.official_packs
for each statement execute function public.bump_official_catalog_version();

drop trigger if exists official_decks_catalog_version on public.official_decks;
create trigger official_decks_catalog_version
after insert or update or delete on public.official_decks
for each statement execute function public.bump_official_catalog_version();

alter table public.official_packs enable row level security;
alter table public.official_decks enable row level security;
alter table public.official_catalog_meta enable row level security;

drop policy if exists official_packs_read_published on public.official_packs;
create policy official_packs_read_published
on public.official_packs for select
to anon, authenticated
using (published);

drop policy if exists official_packs_admin_all on public.official_packs;
create policy official_packs_admin_all
on public.official_packs for all
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists official_decks_read_published on public.official_decks;
create policy official_decks_read_published
on public.official_decks for select
to anon, authenticated
using (
  published
  and exists (
    select 1
    from public.official_packs p
    where p.id = official_decks.pack_id
      and p.published
  )
);

drop policy if exists official_decks_admin_all on public.official_decks;
create policy official_decks_admin_all
on public.official_decks for all
to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

drop policy if exists official_catalog_meta_read on public.official_catalog_meta;
create policy official_catalog_meta_read
on public.official_catalog_meta for select
to anon, authenticated
using (true);

-- The metadata row is maintained by the security-definer trigger only.

revoke all on table public.official_packs from anon, authenticated;
revoke all on table public.official_decks from anon, authenticated;
revoke all on table public.official_catalog_meta from anon, authenticated;

grant select on table public.official_packs to anon, authenticated;
grant select on table public.official_decks to anon, authenticated;
grant select on table public.official_catalog_meta to anon, authenticated;

-- Admins can write through PostgREST; RLS checks public.is_admin().
grant insert, update, delete on table public.official_packs to authenticated;
grant insert, update, delete on table public.official_decks to authenticated;

revoke all on function public.bump_official_catalog_version() from public, anon, authenticated;
revoke all on function public.touch_official_updated_at() from public, anon, authenticated;

grant all on table public.official_packs to service_role;
grant all on table public.official_decks to service_role;
grant all on table public.official_catalog_meta to service_role;

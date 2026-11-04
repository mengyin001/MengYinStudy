-- ---------------------------------------------------------------------------
-- 0.3.0 — profiles, roles and the privilege boundary
--
-- A learner can read and edit only their own profile. The `role` column is not
-- updatable by an ordinary account: column-level grants remove the privilege,
-- and a trigger rejects a role change unless the caller is an admin or the
-- service role. Official content writes are handled in the next migration.
-- ---------------------------------------------------------------------------

do $$
begin
  create type public.app_role as enum ('user', 'admin');
exception
  when duplicate_object then null;
end
$$;

-- A non-exposed schema for security-definer helpers. PostgREST does not expose
-- it, so these functions cannot be called as RPC endpoints from the browser.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  avatar_url text,
  role public.app_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. `role` is deliberately not writable by ordinary clients.';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Create the profile as part of the auth sign-up transaction. Handles email
-- sign-ups (display_name metadata) and OAuth (full_name / avatar_url/picture).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fallback_name text;
  profile_name text;
begin
  fallback_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Learner'
  );
  profile_name := left(fallback_name, 80);

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    profile_name,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'picture'), '')
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill users created before this migration. Existing profiles win.
insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  left(
    coalesce(
      nullif(btrim(u.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
      'Learner'
    ),
    80
  ),
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'picture'), '')
  )
from auth.users u
on conflict (id) do nothing;

-- Security-definer helper used by RLS policies and storage policies. The
-- function owner (postgres) bypasses RLS, so this cannot recurse. It lives in
-- the non-exposed `private` schema; callers need EXECUTE, but cannot reach it
-- through PostgREST.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

-- Defence in depth: even if a future migration accidentally grants UPDATE on
-- the whole table, a normal account still cannot change its own role.
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role then
    if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
       or session_user in ('postgres', 'supabase_admin') then
      return new;
    end if;
    if not private.is_admin() then
      raise exception 'profiles.role is read-only for ordinary accounts'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
before update on public.profiles
for each row execute function public.guard_profile_role();

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists profiles_select_admin on public.profiles;
create policy profiles_select_admin
on public.profiles for select
to authenticated
using ((select private.is_admin()));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- No INSERT policy: rows are created by the auth trigger.
-- No DELETE policy: account deletion is a service-role operation.

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;

-- Trigger/helper functions are not RPC endpoints.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.guard_profile_role() from public, anon, authenticated;
revoke all on function private.is_admin() from public, anon, authenticated, service_role;
grant execute on function private.is_admin() to authenticated;

grant all on table public.profiles to service_role;

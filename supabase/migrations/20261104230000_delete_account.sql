-- ---------------------------------------------------------------------------
-- 0.6.1 — a learner can delete their own account from inside the app
--
-- Apple 5.1.1(v) and Google Play's account-deletion policy want an in-app
-- path, not only a mailbox. `authenticated` cannot write `auth.users`, so this
-- SECURITY DEFINER function deletes the caller and nothing else: the id comes
-- from `auth.uid()`, never from an argument a client could forge.
--
-- Every row that belongs to the account disappears through the existing
-- `on delete cascade` constraints: profiles, user_decks, user_official_library
-- and user_progress. Cloud decks embed their images as data: URLs, so there
-- are no storage objects to sweep.
-- ---------------------------------------------------------------------------

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    raise exception 'delete_account requires a signed-in user' using errcode = '42501';
  end if;

  delete from auth.users where id = caller_id;
end;
$$;

comment on function public.delete_account() is
  'Deletes the calling learner''s account; owned rows cascade. Exposed as an RPC.';

revoke all on function public.delete_account() from public;
revoke all on function public.delete_account() from anon;
grant execute on function public.delete_account() to authenticated;

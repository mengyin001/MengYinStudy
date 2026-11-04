# Supabase project

Project ref: `yukmxeieklwgnwdcqwpb`.

## Apply the schema

### With the CLI

```bash
supabase link --project-ref yukmxeieklwgnwdcqwpb
supabase db push
supabase db advisors
```

### With the SQL editor

Paste these files, in order, into **Supabase → SQL Editor**:

1. `migrations/20261103120000_profiles_and_roles.sql`
2. `migrations/20261103121000_official_catalog.sql`
3. `migrations/20261103122000_official_media.sql`
4. `migrations/20261103235500_user_decks.sql`
5. `migrations/20261104003000_user_progress.sql`
6. `migrations/20261104004000_user_deck_runtime_and_media.sql`
7. `migrations/20261104020000_user_official_library.sql`
8. `migrations/20261104030000_user_progress_realtime.sql`
9. `migrations/20261104040000_exam_minutes.sql`

All nine are safe to re-run: they use `if not exists`, `drop policy if exists`,
`create or replace` and guarded `add column`/constraint changes.

### With the database runner (no CLI)

If the CLI/Docker is unavailable, put the database password in `.env.local` and run the runner:

```dotenv
SUPABASE_DB_HOST=aws-0-<region>.pooler.supabase.com
SUPABASE_DB_PORT=5432
SUPABASE_DB_USER=postgres.<project-ref>
SUPABASE_DB_PASSWORD=<database password>
```

```bash
npm run db:migrate
```

Use the **Session pooler** host from Dashboard → Connect. Direct hosts
(`db.<ref>.supabase.co`) are IPv6-only on current projects; on an IPv4-only network
`pg` fails with `getaddrinfo ENOTFOUND`. The runner percent-encodes
`SUPABASE_DB_PASSWORD`; if you use a complete
`SUPABASE_DB_URL=postgresql://postgres.<ref>:...@aws-0-<region>.pooler.supabase.com:5432/postgres`,
encode special characters yourself.

## Configure auth

**Authentication → URL Configuration**

```
Site URL: http://localhost:5173
Redirect URLs:
  http://localhost:5173/**
  http://127.0.0.1:5173/**
  http://localhost:4173/**
  http://127.0.0.1:4173/**
  https://<production-host>/**
```

**Authentication → Providers** — enable Google and GitHub. Each provider's callback is
`https://yukmxeieklwgnwdcqwpb.supabase.co/auth/v1/callback`.

- Google: Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application);
  add that callback as an Authorized redirect URI.
- GitHub: Settings → Developer settings → OAuth Apps → New OAuth App; set the Authorization
  callback URL to that callback.

Paste each client ID/secret into its Supabase provider page and save. Email sign-up is on by default
with confirmation required. The built-in mailer is rate-limited and meant for testing; configure
custom SMTP under **Authentication → Emails** before a real launch.

## Seed official content

Put the new secret key in `.env.local` (never commit it, never use a `VITE_` variable):

```dotenv
SUPABASE_URL=https://yukmxeieklwgnwdcqwpb.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

The legacy `SUPABASE_SERVICE_ROLE_KEY` name is still accepted by the seed script.

Then, from the repository root:

```bash
npm run seed:official
npm run backend:check
```

## First admin

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

The app has no admin UI in 0.4.0; publish content with Supabase Studio, SQL, or the seed script.

## Verify permissions

The policies are documented in [`docs/BACKEND.md`](../docs/BACKEND.md#2-permission-model). The
important invariants:

- `profiles.role` is not in the `authenticated` update grant and is guarded by a trigger.
- `official_*` writes require `private.is_admin()` (a non-exposed schema); anonymous clients have no write grant.
- `official_catalog_meta` is written only by the security-definer version trigger.
- `official_decks.exam_minutes` and `user_decks.exam_minutes` hold the whole-paper exam length;
  `NULL` means the client estimates it from question type and difficulty.
- `user_decks` and `user_progress` are owner-only for select/insert/update/delete; there is no admin
  or anonymous read. `user_progress` is also in the `supabase_realtime` publication, and its
  subscription is filtered to the user's id; RLS still decides what is delivered.
  `user_official_decks` is owner-only for select/insert/delete; it references the public catalogue and
  never copies official questions.
- Runtime modules (`entry_source`) execute on every signed-in device of the owner; only upload code
  you trust.
- The `official-media` bucket is public-read, admin-write.

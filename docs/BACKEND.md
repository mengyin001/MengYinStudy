# Backend, accounts and the official question bank

0.5.0 adds **live progress sync**. Official decks are still a public Plaza catalogue, and a learner
explicitly adds the ones they want to their own library. Supabase provides six things:

1. **Accounts** — email/password, Google and GitHub, email confirmation, password recovery.
2. **The official question catalogue** — read-only packs maintained in Postgres, with a
   monotonic version so clients fetch only when something changed.
3. **A learner's official-deck library** — one row per added catalogue deck, owner-only, so the
   same deck follows the account to another device without copying the questions.
4. **Private cloud decks** — generated and imported decks upload automatically for a signed-in
   learner. Every row is scoped to `auth.uid()`.
5. **Live progress** — attempts, schedule, flags, notes and sessions sync to one owner-only row per
   account. Other devices receive the change through Realtime and merge it.
6. **The permission boundary** — Postgres row-level security (RLS) is the source of truth;
   the React app is never trusted to enforce access.

Official decks are visible in the Plaza without signing in, but adding one requires an account.
Progress is scoped to the current identity: a guest record and one record per account, so signing
out zeros the dashboard and signing back in restores that account's statistics. The cloud row is
live, not a manual backup path; `updated_at` is the optimistic-concurrency token. AI keys and
material files are never sent to Supabase.

```
React pages / contexts
        │  only the interfaces in apps/web/src/services/types.ts
        ▼
apps/web/src/services  ── Supabase implementation ──▶  Supabase
  config.ts               auth.ts                      ├─ GoTrue (auth)
  errors.ts               profiles.ts                  ├─ PostgREST (RLS)
  types.ts                official.ts                  └─ Storage (media)
  officialCache.ts        userDecks.ts
  officialSync.ts         userLibrary.ts
                          userProgress.ts
```

No page or component imports `@supabase/supabase-js`. Replacing the backend means implementing
`Backend` in `services/types.ts` and changing the composition root in `services/index.ts`.

### `@supabase/server` is not used by the SPA

`@supabase/server` is for Node/Edge request handlers: it verifies inbound JWTs, resolves the new
publishable/secret keys and injects a client (`withSupabase`, `createSupabaseContext`). This app is a
static browser build whose reads go straight to PostgREST under RLS, so adding the package to
`apps/web` would be the wrong layer and would risk pulling server secrets into the bundle.

If a real server endpoint is added later (for example an admin publishing API or a webhook), put it
in `supabase/functions/` or an `apps/api` workspace, install `@supabase/server` there, and select an
`auth` mode deliberately: `'user'` for a learner endpoint, `'secret'` for a service-to-service job,
`'publishable'` for a public endpoint, and `'none'` only for truly public health checks. Edge
Functions inject `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and
`SUPABASE_JWKS_URL` automatically; other runtimes need them in the environment.

---

## 1. Data model

### `profiles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | references `auth.users(id)` on delete cascade |
| `display_name` | `text` | 1–80 chars, created from sign-up metadata or OAuth `full_name` |
| `avatar_url` | `text` | OAuth picture, editable later |
| `role` | `app_role` (`user` / `admin`) | default `user`; ordinary clients cannot write it |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` maintained by trigger |

A trigger on `auth.users` (`handle_new_user`) creates the profile in the same transaction as the
sign-up. The client never inserts into `profiles`. The migration also backfills any auth users that
already existed when it was applied, so nobody is left without a profile.

### `official_packs` / `official_decks`

```text
official_packs          1 ─── n  official_decks
  id (text, manifest id)          (pack_id, id) composite PK
  name, version                   title, description, tags
  description, author             questions jsonb (validated again by the client)
  tags, published                 media_base_url, exam_minutes, version
  sort_order                      published, sort_order
  created_at, updated_at          created_at, updated_at
```

`questions` is the exact deck JSON array accepted by `packages/plugin-sdk/src/schema.ts`. The client
re-validates every deck with zod; a malformed official deck is dropped and reported, never shown.

`exam_minutes` is the whole-paper exam length, 1–600, set by the deck author or computed by
`tools/seed-official.mjs` from the questions. It is deliberately part of the catalogue, not a
per-learner setting: every learner's exam on that paper runs for the same time. Older rows may be
`NULL`, in which case the client estimates the length from question type and difficulty.

### `official_catalog_meta`

A singleton row (`id = true`) with `version bigint`. Statement-level triggers on
`official_packs` and `official_decks` increment it after any insert/update/delete. This is the
cheap "has anything changed?" signal the app checks at boot, on focus and every 15 minutes.

### `user_official_decks`

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` | default `auth.uid()`; FK to `auth.users` on delete cascade |
| `pack_id`, `deck_id` | `text` | composite FK to `official_decks(pack_id, id)` on delete cascade |
| `added_at` | `timestamptz` | display order in the learner's library |

This is a **subscription**, not a copy. The Plaza shows the whole published catalogue; adding a deck
inserts one owner-only row. Library reads join those references back to the current official
catalogue, so a published update (new questions, fixed explanation) is visible the next time the
catalogue version changes — without duplicating the question JSON per learner. Deleting the deck
from the learner's library deletes only this reference and does not touch the official row.

### `user_decks`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | default `gen_random_uuid()` |
| `user_id` | `uuid` | default `auth.uid()`; FK to `auth.users` on delete cascade |
| `client_key` | `text` | stable `pluginId::deckId`; unique per user |
| `plugin_id`, `deck_id` | `text` | original ids, so progress keys keep working |
| `title`, `description`, `tags` | text / text / `text[]` | deck metadata |
| `questions` | `jsonb` | array, 1–500 questions, ≤8 MB; re-validated by the client |
| `exam_minutes` | `integer` | 1–600 whole-paper exam length; `NULL` means the client estimates |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` maintained by `set_updated_at()` |

The row is a **private copy**, not a share. `user_id` is omitted from the insert/update column
grants: inserts get the default `auth.uid()`, and the RLS `WITH CHECK` rejects a forged owner. On
conflict, the client updates only `title`/`description`/`tags`/`questions`/`exam_minutes`/`entry_source`;
identity columns cannot be changed. Generated and imported local decks upload automatically once a learner
signs in — there is no upload button.

`entry_source` is an optional single-file ES module for custom question types/importers. It is
executed only for the owner's own cloud decks; the UI warns that runtime modules run on every
signed-in device. Relative images in imported folders are converted to `data:` URLs before upload,
so a cloud deck is self-contained JSON. The `questions` size limit is 8 MB and the module limit is
1 MB.

### `user_progress`

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` PK | default `auth.uid()`; FK to `auth.users` on delete cascade |
| `progress` | `jsonb` | the same `ProgressState` stored in IndexedDB, including `epoch`/`meta` (≤8 MB) |
| `updated_at` | `timestamptz` | maintained by `set_updated_at()`; also the concurrency token |

Every change is a conditional write: the client sends the `updated_at` it last read and the update
matches only that value. A 0-row result means another device wrote first; the client re-reads, merges
and retries. Inserts name `user_id`, so a stale write from a different signed-in account is rejected
by the insert policy instead of landing in that account's row.

Merging is field-aware: attempts and sessions union by id, cards keep the newest `lastAt`, and flags
and notes carry per-question timestamps so deletions are not resurrected. A higher `epoch` replaces
the learning record instead of merging, which is how **Reset progress** clears every device. Settings
(theme, language) stay local. The table is in the `supabase_realtime` publication; the subscription is
filtered to the user's id and RLS still applies. Owner-only RLS, same as `user_decks`.

### Storage

`official-media` is a **public** bucket. Admin write policies; public read. `media_base_url` on a
deck points at `…/storage/v1/object/public/official-media/<pack>/<deck>/`, so relative image paths
in question JSON resolve without hard-coding a CDN. User-uploaded decks use inline `data:` images
instead of a separate bucket: imported relative images are embedded at import time, so another
device never gets a broken image. The 8 MB question limit applies to the embedded JSON.

---

## 2. Permission model

RLS is enabled on every table, and every table has explicit `GRANT`s because Supabase no longer
auto-exposes new `public` tables to the Data API (enforced from October 2026). The matrix:

| Object | anon | authenticated (learner) | authenticated (admin) | service_role |
| --- | --- | --- | --- | --- |
| `profiles` | none | select own, update own `display_name`/`avatar_url` | select all | all |
| `official_packs` | select `published` | select `published` | all | all |
| `official_decks` | select `published` in a published pack | same | all | all |
| `official_catalog_meta` | select | select | select | all |
| `user_official_decks` | none | select/insert/delete own references | same as learner (no admin read) | all |
| `user_decks` | none | select/insert/update/delete own rows | same as learner (no admin read) | all |
| `user_progress` | none | select/insert/update/delete own live row; Realtime delivers only that row | same as learner (no admin read) | all |
| `storage.objects` (`official-media`) | select | select | insert/update/delete | all |

### Why a learner cannot promote themselves

Three independent layers, so one mistake is not enough:

1. **Column privileges** — `revoke all on profiles from authenticated`, then
   `grant update (display_name, avatar_url)`. `role` is not in the grant list.
2. **RLS** — update policy is `auth.uid() = id`; there is no insert/delete policy.
3. **Trigger** — `guard_profile_role()` raises `42501` if `role` changes unless the caller is an
   admin or `service_role`.

The helper `private.is_admin()` is `security definer`, lives in the non-exposed `private` schema,
is pinned to `search_path = ''`, and reads `public.profiles`; ordinary clients cannot make it return
true for someone else. `EXECUTE` is granted only to `authenticated`; PostgREST cannot reach the
`private` schema as an RPC endpoint. Policies call it as `(select private.is_admin())` so Postgres
can cache the result instead of evaluating it once per row; `auth.uid()` is wrapped the same way.

Client-side session state is only for the UI. The server never trusts the browser's role claim:
RLS and the `profiles` table decide what a request may read or write.

### Why a cloud deck is private

All four `user_decks` policies compare `user_id` with `(select auth.uid())`. There is no admin policy
and no public read grant. A second account cannot list, update or delete the row; a delete targeting
someone else's id simply affects zero rows. `anon` has no table privilege at all. The migration test
covered deck insert as A, empty list/delete as B, a 401 for an anonymous request, a runtime
`entry_source` insert, and a progress insert that stayed visible to A but not B.

### Why a learner cannot edit official content

`official_*` writes require the `official_*_admin_all` RLS policy, which calls `private.is_admin()`.
Anonymous clients receive no write grants at all. The seed script uses the secret key, which is
never shipped to the browser.

### Secret keys

Only `VITE_SUPABASE_PUBLISHABLE_KEY` belongs in `.env`. `services/config.ts` refuses to create a
client if the key looks like a secret (`sb_secret_…`), and the seed script refuses a publishable key.
A publishable key is public by design; RLS is what protects the data.

### SQL fixtures

`supabase/migrations/` contains nine migrations:

| File | Contents |
| --- | --- |
| `20261103120000_profiles_and_roles.sql` | role enum, profiles, auth trigger, `is_admin`, role guard, grants |
| `20261103121000_official_catalog.sql` | packs, decks, version trigger, public read/admin write policies |
| `20261103122000_official_media.sql` | public `official-media` bucket and its policies |
| `20261103235500_user_decks.sql` | private `user_decks`, owner-only RLS, narrow column grants |
| `20261104003000_user_progress.sql` | private `user_progress` row, owner-only RLS |
| `20261104004000_user_deck_runtime_and_media.sql` | `entry_source`, 8 MB inline-media budget |
| `20261104020000_user_official_library.sql` | Plaza references in `user_official_decks` |
| `20261104030000_user_progress_realtime.sql` | explicit `user_id` insert grant, Realtime publication |
| `20261104040000_exam_minutes.sql` | deck-owned exam length on `official_decks` and `user_decks` |

Apply them with the Supabase CLI, paste them, in order, into the SQL editor, or use the database
runner:

```bash
# .env.local
SUPABASE_DB_HOST=aws-0-<region>.pooler.supabase.com
SUPABASE_DB_PORT=5432
SUPABASE_DB_USER=postgres.<project-ref>
SUPABASE_DB_PASSWORD=<database password>

npm run db:migrate        # applies supabase/migrations/*.sql in order
```

Use the **Session pooler** string from Dashboard → Connect. Current Supabase projects expose the
direct host (`db.<ref>.supabase.co`) over IPv6 only; a network without an IPv6 route fails with
`getaddrinfo ENOTFOUND`. The pooler host is IPv4 and works everywhere. The runner
percent-encodes `SUPABASE_DB_PASSWORD`; if you paste a complete `SUPABASE_DB_URL`, encode special
characters yourself. The migrations are re-runnable; they do not write to the Supabase CLI
migration-history table, so `supabase db push` remains the preferred path when the CLI is available.

### Environment variables

| Variable | Used by | Secret? |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | browser bundle | no |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Node tooling | no |
| `SUPABASE_SECRET_KEY` | `npm run seed:official` | **yes** — `.env.local` only |
| `SUPABASE_JWKS_URL` | server-side JWT verification (`@supabase/server`) | no |
| `SUPABASE_DB_HOST` / `_PORT` / `_USER` / `_NAME` | `npm run db:migrate` | no |
| `SUPABASE_DB_PASSWORD` / `SUPABASE_DB_URL` | `npm run db:migrate` | **yes** |

Legacy `SUPABASE_SERVICE_ROLE_KEY` is still accepted by the seed script for compatibility, but new
projects should use `SUPABASE_SECRET_KEY` (`sb_secret_…`). No secret value belongs in a `VITE_`
variable.

---

## 3. Accounts

### Flows implemented

- **Email sign-up** with display name. If the project requires email confirmation (the default),
  the UI shows "check your email" and a resend button; otherwise the learner is signed in at once.
- **Email sign-in** with error mapping (`invalid_credentials`, `email_not_confirmed`,
  `rate_limited`, …) and a show/hide password control.
- **Google and GitHub OAuth** through `signInWithOAuth` with PKCE and a `redirectTo` at the app's
  bare document URL. The hash router owns `#/…`, so auth callbacks never land inside a route.
- **Password recovery** — `resetPasswordForEmail`, a `PASSWORD_RECOVERY` event (or the stored
  recovery hint after a same-browser reload), and `updateUser({ password })`.
- **Sign out** — server revoke first, with a local-scope fallback when offline.
- **Profile editing** — display name (own row only, 80-char cap).

### Automatic cloud upload

1. Saving an AI-generated deck requires sign-in and uploads immediately. Imported folder/JSON decks
   are uploaded automatically by the same background pass after sign-in; there is no **Upload to
   cloud** button.
2. The client validates the deck with `deckFileSchema`, embeds relative images as `data:` URLs
   (imported folders are inlined at import time), optionally carries the plugin's single-file
   `entry_source`, and calls `UserDeckService.upsert`.
3. The row is written with `user_id = auth.uid()` and `client_key = pluginId::deckId`. Re-uploading
   the same deck updates its metadata/questions/module instead of creating a duplicate.
4. `UserDecksProvider` caches the account's rows in IndexedDB, keyed by user id, and refreshes from
   the server after sign-in and on window focus. If the server fingerprint is unchanged the cache is
   reused; otherwise it is replaced. On another device the deck appears with a **Cloud** badge. A
   cloud copy replaces the local deck with the same key, so progress still matches.
5. Removing a deck from **Decks** or **Plugins** deletes the cloud row and the local copy, so it
   cannot be uploaded again. AI keys and material files are never uploaded.

### Live progress sync

`AppContext` starts a sync controller for the signed-in account. It pulls `user_progress`, merges the
result into the local record (`mergeProgress`), commits it, and pushes when the cloud is behind. Local
changes are debounced by 800 ms. The controller also pulls on window focus, on `online`, on a
20-second interval, and on a Realtime `postgres_changes` event filtered to `user_id=eq.<uid>`.

`Settings → Data` shows **Up to date / Syncing… / retrying**, plus a **Sync now** button. There is no
manual upload or restore button. **Reset progress** and **Import backup** bump `epoch` before the
push, so the replacement wins over copies on other devices; ordinary editing keeps the epoch and
merges. The JSON export/import remains as a manual backup independent of the live row.

### Redirect URLs

Set these in **Supabase → Authentication → URL Configuration**:

```
Site URL:        http://localhost:5173
Redirect URLs:
  http://localhost:5173/**
  http://127.0.0.1:5173/**
  http://localhost:4173/**
  http://127.0.0.1:4173/**
  https://your-production-host.example/**
```

For hosted projects also add the production origin. The app computes `redirectTo` from
`window.location.origin + pathname`; it does not hard-code a port.

### Providers

Configure **Google** and **GitHub** under **Authentication → Providers**. Each provider needs its
own OAuth client, with the callback URL:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

- **Google:** Google Cloud Console → APIs & Services → Credentials → OAuth client ID → Web
  application. Add the callback above as an **Authorized redirect URI**, then paste the client ID
  and secret into Supabase.
- **GitHub:** GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Set the
  **Authorization callback URL** to the callback above, then paste the client ID and secret into
  Supabase.

If the provider is still disabled, Supabase's `/auth/v1/authorize` returns
`{"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}` as a raw
JSON page. Email confirmation should stay on; configure custom SMTP before a real launch.

### Desktop shell

OAuth needs a stable http(s) redirect URL. The Electron shell serves the app on a random loopback
port, so Google/GitHub sign-in is a web-build feature unless the desktop shell is given a fixed port
and that URL is added to Supabase. Email/password sign-in works in the shell.

---

## 4. Official catalogue lifecycle

```
boot ─▶ bundled snapshot (plugins/) ─▶ cached catalogue (official-content:v1) ─▶ version check
                                                                                   │
                                          same version ────────────────────────────┘
                                          new version ─▶ GET published packs/decks
                                                          │
                                                          ├─ zod validate every deck
                                                          ├─ write cache + version
                                                          └─ replace decks in AppContext
```

- The bundled plugins remain a first-run/offline fallback. Once a synced pack has the same manifest
  id, it replaces the bundled snapshot, so the learner never sees duplicates.
- The **Plaza** lists every published official deck. A deck appears in **Decks** only after the
  learner adds it, which writes a `user_official_decks` reference. Removing it from Decks deletes
  that reference, not the catalogue row.
- A failed version check keeps the last cache and shows "offline / stale". With no cache it falls
  back to the bundled bank.
- The cache is re-validated on read with the same schema; a corrupt cache is ignored. It also records
  the Supabase project URL, so changing projects cannot resurrect another catalogue.
- The client checks at boot, when the window regains focus (at most once a minute) and every
  `VITE_OFFICIAL_SYNC_MINUTES` (default 15). The button on Decks/Plaza/Plugins/Account checks
  immediately.
- Progress keys are `pluginId::deckId#questionId`; replacing content keeps history as long as ids
  are stable.

### Publishing content

```bash
# .env.local (never committed)
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

```bash
npm run seed:official                 # publish every pack in plugins/
npm run seed:official -- --draft      # write unpublished drafts
npm run seed:official -- --pack=mengyin.demo.psychology
npm run seed:official -- --prune      # delete packs no longer in plugins/
npm run seed:official -- --dry-run
```

The script upserts packs and decks, uploads relative media into `official-media`, removes decks that
disappeared from a pack, and lets the trigger bump the catalogue version. It only does structural
checks; the app does the full zod validation.

Make an admin once, in the SQL editor (service role / postgres):

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

There is no admin UI in 0.5.0. Content management is Supabase Studio (or the seed script); the app
only consumes the published catalogue.

---

## 5. Data-service API

`apps/web/src/services/types.ts` defines:

| Interface | Methods |
| --- | --- |
| `AuthService` | `getSession`, `onAuthStateChange`, `signInWithPassword`, `signUp`, `signInWithOAuth`, `signOut`, `requestPasswordReset`, `updatePassword`, `resendConfirmation` |
| `ProfileService` | `getProfile`, `updateProfile` |
| `OfficialContentService` | `getManifest`, `getCatalog(version?)` |
| `UserDeckService` | `list`, `upsert`, `remove` — owner-only cloud decks |
| `UserLibraryService` | `list`, `add`, `remove` — owner-only official-deck references |
| `UserProgressService` | `get`, `push` (conditional write), `subscribe` (Realtime) — owner-only live progress |
| `Backend` | `configured`, `status`, `reason`, `url`, and the six services |

Every fallible call returns `ServiceResult<T>` with a language-neutral `BackendError` code:
`unconfigured`, `not-ready`, `network`, `invalid-credentials`, `email-taken`, `link-expired`, …
`i18n/backend.ts` maps codes to English/繁中 sentences; raw server messages are only a fallback.

The React contexts (`AuthContext`, `OfficialContentContext`, `UserDecksContext`,
`UserLibraryContext`) own session, catalogue, cloud-deck and library state. `AppContext` merges the
guest starter decks, the official decks the learner added, imported local decks and private cloud
decks into the same `Deck[]` the rest of the app already uses. A cloud copy with the same
`pluginId::deckId` replaces the local copy, so uploading does not create a duplicate and existing
progress keys still match. Generated local decks are tagged with their owner; signing out hides them
immediately, while the guest starter decks stay available. The per-account cloud and library caches
are only read for the matching signed-in user id.

---

## 6. Verification

```bash
npm run backend:check   # publishable-key path: health, catalogue version, pack/deck counts
npm test                # 225 unit tests, including merging and the data layer
npm run check           # typecheck + tests + build
npm run verify:browser  # legacy 55-step suite; needs the archived demo fixtures
```

`backend:check` distinguishes:

- **auth ok / catalogue not ready** — migrations have not been applied.
- **catalogue vN / 0 packs** — migrations applied but the seed has not run.
- **packs and decks** — the public RLS path is working.

If you intentionally run the browser smoke test against an unprovisioned project, set
`ALLOW_BACKEND_OFFLINE=1`; otherwise the expected Supabase 404 is reported as a page error.

---

## 7. Known limits

- **Progress merge is field-aware, not a CRDT.** Two devices answering the same question at the same
  moment produce two attempts and the newer scheduling card; a flag toggled off and on in the same
  millisecond may resolve to on. Only one write wins a conditional update; the loser re-merges.
- **No deck sharing.** A `user_decks` row is readable only by its owner; there is no public link or
  admin read path.
- **No admin UI.** Use Studio, SQL or `npm run seed:official`.
- **Public official catalogue.** Published content is readable before sign-in. To require an
  account, change the two read policies from `to anon, authenticated` to `to authenticated` and
  clear the local cache on sign-out.
- **PKCE recovery links** are same-browser by design. Opening a reset link in a different browser
  cannot use the code verifier; request a fresh link there.
- **Storage objects are not garbage-collected.** Deleting a deck/pack removes the database rows but
  leaves its media in `official-media`; remove those objects in Studio if that matters.
- **OAuth in the desktop shell** is not configured (random loopback port).
- **Official custom question types are not run.** Official packs use the built-in types only;
  third-party plugin code still comes from local plugin folders.

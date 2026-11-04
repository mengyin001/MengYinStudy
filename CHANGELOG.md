# Changelog

## Unreleased

### Added

- **Account deletion, in the app.** Account → Delete account opens a confirmation sheet that
  spells out what disappears, requires the learner to type `DELETE` (「刪除」) and then calls the
  new `delete_account()` RPC. That function is `security definer` but deliberately narrow: it
  deletes `auth.uid()` only, and the profile, cloud decks, library and progress rows go with it
  through the existing `on delete cascade` constraints. A failed call leaves the learner signed in
  so they can retry; a missing migration reports "backend not ready" instead of pretending the
  account is gone. Satisfies Apple 5.1.1(v) and Google Play's account-deletion policy.
- **Consent is a checkbox, and the legal links moved to the auth screens.** Creating an account
  now requires ticking "I agree to the Terms of Service and the Privacy Policy"; the submit and
  the OAuth buttons stay disabled until it is ticked. The sign-in, recovery and reset screens carry
  a quiet Privacy Policy · Terms of Service row, and the always-visible sidebar links are gone.
- **Privacy Policy and Terms of Service, written for this app and hosted here.** `/privacy/` and
  `/terms/` are emitted at build time as self-contained HTML — no bundle, no login, readable with
  JavaScript disabled — for the two URL fields an app store asks for. In the app, `#/privacy` and
  `#/terms` render the same content in the reader's language, linked from Settings → About, the
  auth screens and the sign-up consent. Wording lives in `apps/web/src/legal/content.ts`; the
  operator name, mailbox and origin come from `VITE_LEGAL_*` and `VITE_PUBLIC_ORIGIN`.
- **`npm run auth:check`.** Read-only OAuth readiness check: reads the project's provider flags
  from `/auth/v1/settings`, probes `/auth/v1/authorize`, then prints the callback URL and the exact
  Site URL / Redirect URLs the project needs. It states what it cannot see: the redirect allow-list,
  because GoTrue accepts any `redirect_to` and only falls back to Site URL at the end of the round
  trip. `docs/BACKEND.md` gains a three-console walkthrough and a symptom-to-cause table.

### Fixed

- **Google/GitHub sign-in no longer dumps GoTrue's JSON error page.** `signInWithOAuth` now checks
  `/auth/v1/settings` first (cached ten minutes, 5 s timeout, fails open) and reports
  `provider-disabled` inside the sign-in form. It also passes `skipBrowserRedirect: true` and
  navigates only once the authorisation URL exists, so every other failure stays in the form too.

## 0.6.0 — 2026-11-04

### Added

- **Code questions in six languages.** `meta.code.language` now accepts `javascript` (still the
  default), `typescript`, `python`, `sql`, `java` and `cpp`. JavaScript/TypeScript use the browser
  engine; Python runs on Pyodide, SQL on sql.js (SQLite) and Java on javac + TeaVM, all WebAssembly;
  C++ runs on the JSCPP interpreter. The lesson stays the same: one template, one or more blanks,
  tests compared against stdout.
- **Static, self-hosted runtimes.** `npm run runtimes:fetch` copies pinned Pyodide, sql.js and
  javac/TeaVM files and builds a JSCPP bundle into `apps/web/public/runtimes/<name>/<version>/`
  before `dev` and `build`. The deployed site needs no execution server and no third-party CDN; the
  initial bundle stays small because the runtimes are loaded lazily by the sandbox.
- **Language-aware editor.** The code panel shows the language badge, a language-specific blank
  placeholder and comment, a Python `input = …` / Java/C++ `stdin` preview, and the installed
  runtime version (`Pyodide 0.29.5`, `SQLite (sql.js) 1.15.2`, `javac + TeaVM 0.1.0`, `JSCPP 2.0.9`)
  when available.
- **Cloudflare Pages deployment.** `apps/web/public/_headers` grants CORS and immutable caching for
  `/runtimes/*`, which the opaque-origin sandbox iframe needs. [Deploying to Cloudflare
  Pages](docs/DEPLOY_CLOUDFLARE.md) documents the build command, output directory and verification.
- **Code-language choice in Generate.** The authoring skill and prompt now emit code in the selected
  language, and the generated deck is validated with the same schema as a hand-written one.

### Changed

- **SQL tests put their fixture in `input` as SQL.** `CREATE TABLE` / `INSERT` statements run before
  the template, and a `SELECT` prints a deterministic `a | b` table. SQL cannot use a JSON `input`
  variable; the schema rejects one with a clear message.
- **Java and C++ tests use `tests[].stdin`.** Neither language has a universal JSON value type, so
  the test feeds a text fixture to `System.in` / `cin`; `input` is rejected for these languages.
  Templates are complete `public class Main` / `int main()` programs.
- **Stale runs cannot grade another language.** `CodeRun` records its language; a recorded JavaScript
  run is not reused for a Python question with identical blanks.
- **Timeout recovery for WASM runtimes.** A Python/SQL/Java/C++ worker that exceeds the per-test
  limit is terminated and recreated for the remaining tests, so one infinite loop does not fail the
  batch. Java gets a larger startup budget because javac + TeaVM compile on first use.

### Fixed

- The sandbox blocks `postMessage`, `console`, storage and network globals after the runtime loads,
  so Python code using the `js` module cannot forge a case result.

## 0.5.1 — 2026-11-04

### Added

- **Exam length belongs to the paper.** `Deck.examMinutes` is a whole-paper countdown, and the
  library's mode sheet shows that deck's real length instead of the same app-wide number. Official
  decks publish `exam_minutes`; a deck with no declared length is estimated from question type and
  difficulty (for example a five-question recall quiz is about seven minutes, not twenty-five).
- **AI sets the exam length.** The authoring skill (1.7.0) asks for an `estimatedSeconds` budget on
  every question. Generation stores it in the question's `meta`, sums the budgets into the deck's
  `examMinutes`, and shows the selected length in the preview; unticking questions recalculates it
  before saving.
- **Official catalogue metadata.** `official_decks.exam_minutes` is selected by the client, validated
  with the plugin schema and cached with the deck. `tools/seed-official.mjs` writes the authored
  value, or computes the same estimate when the deck JSON has none.
- **Private deck persistence.** `user_decks.exam_minutes` carries a generated or imported deck's
  length across devices; a `NULL` value means the receiving client estimates it.

### Fixed

- **Removing a deck no longer leaves it on screen.** The cloud-deck list used to fail on a project
  that had not applied `20261104040000_exam_minutes.sql` (the new `exam_minutes` column), so the
  delete succeeded but the refresh failed and the cached row stayed visible. Reads and uploads now
  retry without `exam_minutes` on the older schema, and cloud/official-library removals update the
  list and cache optimistically before the refresh. This also covers a refresh that fails for a
  network reason.
- Official catalogue loading gets the same pre-0.5.1 fallback, so a missing column cannot hide every
  official deck.
- **Text size now scales the whole interface.** Settings → Text size only changed the default body
  font before: every component sized its text with fixed pixel tokens, so Compact/Standard/Large
  looked identical. All type tokens (and the few hard-coded reading sizes, such as the question
  prompt and results score) are now derived from `--fs`, and the three steps are more distinct
  (0.9 / 1 / 1.12) while persisting across reloads.

### Changed

- **The global “Default test length” setting is gone.** `Settings.examMinutes` was removed and
  Settings → Goals now explains that each deck owns its length. A legacy value in an old progress
  record is ignored rather than overriding the deck.
- Exam mode uses the deck length for the whole session, and Dashboard's “Test 20 questions” scales a
  long paper's countdown to the 20-question subset instead of using the full paper's time.
- The bundled starter decks carry explicit lengths (7 and 6 minutes), so a guest's first exam is not
  a fixed default either.
- The new migration `20261104040000_exam_minutes.sql` adds the two columns, their 1–600 check
  constraints and the narrow `user_decks` column grants.

### Verification

- Typecheck, **209** unit tests (new estimator, schema, official-sync, cloud-row, generate and
  old-schema compatibility tests) and the production build pass. A headless run verified the starter
  deck's mode sheet and exam countdown use its own length and that Settings no longer offers the
  removed fixed default. A second run imported a deck named “JavaScript coding”, removed it through
  the library sheet, and confirmed it was gone both immediately and after a reload. A third run
  switched Text size to Large, Compact and Standard and measured the label, heading and navigation
  font sizes changing (14 → 15.68 → 12.6 px) and staying changed after a reload; the smoke test now
  guards that behaviour.

## 0.5.0 — 2026-11-04

### Added

- **Live progress sync.** A signed-in account's attempts, scheduling cards, flags, notes and sessions
  now live in `user_progress` and follow the account. Local changes upload after 800 ms; other open
  devices receive the row through Supabase Realtime and merge it without a reload. Window focus,
  `online` and a 20-second poll are fallbacks when the socket drops.
- **Field-aware merging.** `mergeProgress` unions attempts and sessions by id, keeps the scheduling
  card with the newest review, and uses per-question `meta` timestamps for flags and notes so a
  deletion on one device is not resurrected by another. Theme and language stay device-local.
- **Optimistic concurrency.** `UserProgressService.push` sends the `updated_at` it last read; a
  0-row update means another device wrote first. The client re-reads, merges the current local state
  (including answers made while the request was in flight), and retries. Inserts name `user_id`, so a
  stale write from a different account is rejected by RLS.
- **Epoch-based reset/import.** `Reset progress` and **Import backup** bump `ProgressState.epoch`; a
  higher epoch replaces the learning record on every device instead of being merged back to life.
- **Sync status in Settings → Data**, with **Sync now**, an up-to-date/syncing/retry badge, and the
  automatic-sync explanation.

### Changed

- **The manual Back up / Restore progress buttons are gone.** Automatic sync replaces them; JSON
  export/import remains as an independent backup. The Settings cloud-restore sheet and its busy state
  were removed, and `AppActions` now exposes `syncNow()` instead of `uploadProgress`/
  `restoreProgress`.
- **`ProgressState` gained `epoch` and `meta`.** `normalizeProgress` supplies defaults for older
  records, `toggleQuestionFlag`/`setNote` stamp their changes, and the new `learningFingerprint`
  excludes settings and `updatedAt` so appearance changes do not generate sync traffic.
- The `user_progress` table is now in the `supabase_realtime` publication and the authenticated
  insert grant includes `user_id` (`20261104030000_user_progress_realtime.sql`).

### Fixed

- Realtime authorisation is explicit: the client sets the current access token on the socket before
  subscribing, otherwise RLS-filtered `postgres_changes` events are silently dropped.

### Verification

- Typecheck, **190** unit tests (10 new merge tests) and the production build pass. A two-browser
  headless run signed into the same account verified: the second device receives the first device's
  attempt on sign-in, an answer on either device appears on the other in real time, **Reset progress**
  clears both through the epoch, signing out shows zero, and signing back in restores the cloud row.
  A direct Realtime probe confirmed insert/update events and 0-row stale conditional updates.

## 0.4.1 — 2026-11-04

### Fixed

- **Signing out no longer shows the previous account's statistics.** Progress is now stored per
  identity (`progress:v2:guest` and `progress:v2:user:<id>`) instead of one shared `progress:v1`
  record. The Dashboard, Recent practice, Statistics, Mistakes and due counts all read the active
  identity's record, so signing out starts from zero and signing back in restores that account's
  attempts, sessions, mistakes and notes. Switching identity flushes the record being left before it
  loads the next one.
- **The pre-0.4.1 record is migrated, not lost.** The first account that signs in after upgrading
  claims the old shared `progress:v1` blob and it is removed; a later account on the same browser
  starts empty.
- **Guest practice still carries into a new account.** A new account with no history adopts the guest
  record once, and the guest record is cleared so the next sign-out is zero. Guest practice is not
  merged into an account that already has statistics, and an account's history is never shown to a
  guest or to another account.
- The sign-out screen keeps the language/theme the learner was using; only the learning record is
  reset.
- Sign-in copy now describes the per-identity behaviour instead of promising that guest attempts
  always merge into an existing account.

### Verification

- Typecheck, **180** unit tests and the production build pass. Headless browser runs covered:
  signed-out zero with a legacy record present, first sign-in claiming it, reload persistence,
  sign-out back to zero, second sign-in restoring the same statistics, guest adoption by a second
  account, and the first account's history staying invisible to the second.

## 0.4.0 — 2026-11-04

### Added

- **The Plaza.** Official decks are now a catalogue that is browsed at `#/plaza`, not content that is
  silently mixed into every learner's library. Adding a deck writes one owner-only
  `user_official_decks` reference; the questions themselves stay in `official_decks`, so published
  updates follow the catalogue. Deleting the deck removes only the reference.
- **Guest starter decks.** Two bundled, no-account decks (everyday basics and a study-method check)
  are always available. Guests can browse the Plaza but cannot add a deck; the sidebar and deck pages
  explain the sign-in gate instead of failing silently.
- **Sign-in inheritance.** Guest attempts, mistakes and statistics are stored in the same local
  `ProgressState` and survive sign-in; the browser test verifies an attempt recorded before sign-up is
  still present in Statistics afterwards.
- **Automatic cloud upload for all local decks.** Generated and imported decks upload in the
  background after sign-in. The manual **Upload to cloud** control and its per-record busy state are
  gone.
- **Deck deletion in Decks and Plugins.** A row can be removed from either page; the action chooses
  the right backend (cloud row, official-library reference, or local record) and never deletes the
  official catalogue. The bundled guest decks are permanent.
- **Materials are deleted after generation.** On a successful generation the app clears the material
  list and the persisted `ai-materials:v1` entry, and tells the learner that it did.
- **Code questions show their supplied data.** The practice preview now prints the first test's
  `setup`/`input` before the template, so a generated body-layout question that uses `input` shows
  the actual array/object instead of hiding it in the runner. Generation drops a code question whose
  solution uses `input` when neither the template nor any test provides it; an older deck with such
  a question shows a warning. The authoring skill (1.6.0) requires the prompt to name the variable
  and its shape.

### Changed

- **Plugins are functionality, not content.** The Plugins page now lists feature plugins (runtime
  modules and registered question types) and an official **JavaScript code questions** card, with a
  compact **Your decks** management list. Deck-only packs no longer masquerade as plugins.
- **AI generation and API-key settings require an account.** Generate and Settings show a sign-in
  gate instead of an editable form while signed out; `updateAiConfig` and the generate action also
  refuse guest access defensively.
- Typecheck, **174** unit tests and the production build pass. Headless browser runs verified the
  guest starter decks, guest progress inheritance, Plaza add/remove, automatic upload of an imported
  deck, cloud deletion and both sign-in gates.

### Cloud and progress features

- **Private cloud decks are account content.** Saving an AI-generated deck requires sign-in and
  uploads it immediately to `public.user_decks` with owner-only RLS. `UserDecksProvider` refreshes
  the account's list from the server and keeps a per-account IndexedDB cache; generated decks are
  hidden while signed out. Cloud rows keep the original `pluginId::deckId`, so progress keys still
  match and a cloud copy replaces the local cache instead of duplicating it.
- **`UserDeckService`** in the data-service abstraction, with a Supabase implementation and the
  same validation boundary as official decks. Relative images and plugin-specific question types
  are rejected before upload.
- **Progress backup/restore.** Settings can upload the private `ProgressState` snapshot to
  `user_progress` and restore it on another device. Owner-only RLS; manual last-write-wins.
- **Cloud decks can carry images and runtime code.** Imported relative images are inlined as
  `data:` URLs; an optional single-file `entry_source` module travels with the deck and is activated
  on the other device for custom question types/importers.
- **Generation without materials.** The Generate form accepts a written description. With no file,
  the request uses **topic-brief mode**: the model may use well-established general knowledge instead
  of refusing because a two-word brief has no facts. Requests are now capped at six questions per
  call even when the material is a single chunk, so a 10-question request is sent as 5 + 5.
- `npm run backend:check` now prints the email/Google/GitHub provider state.

### Fixed

- **AI generation when a reply is cut off at the output limit.** Incomplete JSON is now classified as
  `truncated` instead of a generic format error. Generation halves the batch and retries, so a
  provider whose completion cap is below six code-heavy questions still produces a deck. If even one
  question cannot fit, the error names **Max reply tokens** and the current limit instead of saying
  only "The JSON in the reply is incomplete".
- **"10 requested, only 1 generated."** A short description was being treated as a source document,
  so the model correctly refused to invent ten facts. Topic-brief mode and the six-question batch cap
  fix that path; the authoring skill is now 1.5.0 with an explicit topic-brief section.
- **Generated decks no longer remain visible after sign-out.** Local generated records are tagged
  with their owner and hidden when signed out or when another account is active. Saving requires
  sign-in and uploads immediately; imported local decks are unaffected. Removing a cloud deck also
  removes its generated local copy so it cannot be uploaded again.

### Compatibility and packaging

- Replaced the five bundled demo packs with one starter pack (`starter.study`, 5 questions) seeded
  to Supabase. The demos remain archived under `.tmp/removed-plugins-20261103/` for the legacy
  browser smoke suite.
- A one-time storage migration clears `local-plugins:v1` (including old AI decks) and the official
  cache, then sets `storage-migrations:v1`; later local imports still work.
- OAuth `validation_failed` responses with "provider is not enabled" now map to
  `provider-disabled` instead of generic invalid data.

## 0.3.0 — 2026-11-03

### Added

- **Accounts.** Email/password sign-up with display name, email confirmation and resend, sign-in,
  Google and GitHub OAuth (PKCE), password recovery with a dedicated reset screen, profile editing
  and sign-out. A protected `#/account` route, sidebar account chip and full-screen auth pages.
- **Supabase backend with a data-service abstraction.** `AuthService`, `ProfileService` and
  `OfficialContentService` are the only contracts the UI knows; `services/supabase/*` is the single
  place the SDK is imported. `AuthProvider` and `OfficialContentProvider` own session and catalogue
  state.
- **Official question bank.** Published packs/decks live in Postgres, media in a public Storage
  bucket. A statement-level trigger bumps `official_catalog_meta.version`; the client checks that
  version at boot, on focus and every 15 minutes, and downloads/validates/caches the catalogue only
  when it changes. Every deck is re-validated with the plugin zod schema.
- **Offline catalogue cache.** `official-content:v1` in IndexedDB; a corrupt cache fails closed to
  the bundled snapshot. Synced packs replace bundled packs with the same manifest id, so no deck is
  shown twice. In 0.3.0 the learner's generated/imported decks and progress never went to the
  server; 0.4.0 adds automatic owner-only uploads for generated and imported decks.
- **RLS and privilege hardening.** Migrations for `profiles`, `official_packs`, `official_decks`,
  `official_catalog_meta` and the `official-media` bucket. `profiles.role` is excluded from the
  authenticated update grant and guarded by a trigger; official writes require `is_admin()`;
  anonymous clients have no write grants. A public-read path is deliberate.
- **Backend tooling.** `npm run seed:official` (upsert packs/decks, upload relative media, prune,
  draft mode), `npm run backend:check` (publishable-key health/version/count check), and
  `supabase/` migrations + setup guide.
- **Docs.** `docs/BACKEND.md` covers the schema, RLS matrix, auth flows, catalogue lifecycle,
  operations, limits and the threat model; `supabase/README.md` has the apply/seed/admin steps.

### Changed

- `AppProvider` merges official packs over the bundled snapshot; Decks shows an Official badge and a
  catalogue status strip; Plugins lists Official / Bundled / Local sources; Settings counts the
  effective plugin list.
- Build is larger because of the Supabase client: 808 KB JS / 237 KB gzip and 48 KB CSS / 8.6 KB gzip.
- Service worker cache version bumped to `mengyin-study-v3`.
- Versions are 0.3.0 across the root, web, desktop, core and plugin-sdk packages.
- **Renamed from CityU Review to MengYin Study.** The app is no longer tied to one institution. The
  display name, PWA manifest, desktop window, package names (`@mengyin/*`), bundled plugin ids
  (`mengyin.demo.*`), IndexedDB name (`mengyin-study`) and the code-sandbox channel all follow the
  new name.
- **Question authoring skill 1.4.0.** The prompt now describes a general-purpose revision app for
  any institution, level or subject, and rule 9 forbids assuming a curriculum, syllabus, exam board,
  grading scale or course code that the request and material do not establish.

### Security

- Only `VITE_SUPABASE_PUBLISHABLE_KEY` is accepted in the browser bundle; `services/config.ts`
  refuses `sb_secret_…` keys. The seed script refuses a publishable key.
- Service-role work is confined to `tools/seed-official.mjs`; no service key is imported by the app.
- RLS tests are documented as a policy matrix rather than executed against the hosted project; the
  hosted project in this repository has not had the migrations applied automatically.

### Fixed

- Existing learners keep their progress across the rename. On first boot the old `cityu-review`
  database is copied into `mengyin-study` once (never overwriting keys that already exist), and
  progress imported from older backups has its `cityu.demo.*` keys remapped to `mengyin.demo.*`.

### Verification

- 137 unit tests (24 new data-layer tests), typecheck clean, build OK.
- Browser smoke test: **55/55 steps, 0 page errors** with `ALLOW_BACKEND_OFFLINE=1`; the only
  expected error without the flag is the Supabase `official_catalog_meta` 404 until migrations run.

## 0.2.0 — 2026-11-03

### Added

- **AI-generated decks.** A new Generate page turns the learner's own material into a practice deck
  using their own OpenAI-compatible API (base URL, key, model). Material can be PDF, DOCX, PPTX, TXT,
  MD, CSV or JSON, up to **1 GB** in total; only text is extracted and images are ignored. Extracted
  text is capped at 8 M characters per file and 32 M in total.
- **Versioned question authoring skill.** A single system prompt defines the JSON shape, per-type
  rules, quality bar, prompt-injection defence and the code-question contract. The exact text is
  documented in `docs/QUESTION_AUTHORING_SKILL.md` and checked against the code by a test.
- **Batched generation pipeline.** Topic-ranked chunk selection, at most six questions per request,
  schema validation with zod, one repair attempt for a malformed reply, duplicate removal and
  shortfall warnings. Generated decks are saved as removable local plugins and included in backups.
- **Code questions.** `type: "code"` with one or more JavaScript blanks: a single `{{blank}}`, 2–6
  named `{{blank:name}}` parts, or a whole function body with `layout: "body"`. Per-test expected
  stdout and a model answer for every blank. The learner can write one expression, a loop header, or
  an entire `main()` body.
- **Coding demo deck.** `demo.coding` ships ten worked examples, including six named loop blanks and a
  whole `main()` body, so the sandbox can be exercised without writing a deck first.
- **Code sandbox.** Worker-per-test inside a sandboxed iframe with a strict CSP, no network, no DOM,
  no storage, output caps and a timeout. Runaway loops are terminated without freezing the app.
- **Practice/exam split.** Run is available in practice-type sessions only. Exams never execute code:
  `finishExam()` strips any run and marks the question as skipped.
- **Question-type picker.** The Generate page now takes a multi-select list of question types. Pick one
  type to force every question to that type, or several to mix them; code is just another type in the
  list. The model prompt and the post-generation filter both enforce the selection.
- **AI settings.** Provider URL, key, model, temperature, token cap, JSON mode and a connection test.
  The key and materials live in separate IndexedDB keys and are excluded from backups.

### Changed

- The question schema now accepts `type: "code"` (`answer.kind = "custom"`, configuration in
  `meta.code`) and validates template markers, blank metadata and a solution for every blank.
- `isAnswered()` takes the question so a partly filled code answer is not counted as an answer.
- Practice submission is asynchronous when a code question has to run before marking.
- Build is a little larger (524 KB / 160 KB gzip) because of the generator and code UI; pdf.js is a
  lazy chunk (415 KB / 123 KB gzip) plus a 1.2 MB worker loaded only for PDFs.

### Fixed

- Exam answers for code questions keep only the snippet, so no recorded run can leak into marking.

## 0.1.0

- Initial release: plugin decks, five study modes, SM-2 scheduling, bilingual UI, local-first storage,
  images in prompts and options, custom question types and importers, Electron shell, PWA.

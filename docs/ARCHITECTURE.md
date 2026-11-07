# Architecture

## Layers

```
┌────────────────────────────────────────────────────────────┐
│ apps/web            React UI                                │
│  ├─ pages/          Today, Decks, Plaza, Generate, Practice, …│
│  ├─ components/     question card, inputs, verdict, results  │
│  ├─ i18n/           message catalogue (en + zh-Hant)         │
│  ├─ state/          App, Auth, OfficialContent, UserDecks,   │
│  │                  UserLibrary                              │
│  ├─ services/       data-service contracts + Supabase impl   │
│  ├─ domain/         registries, guest decks, deck views      │
│  ├─ ai/             API client, materials, chunking, packing │
│  └─ sandbox/        code runner (worker inside sandboxed iframe)│
├────────────────────────────────────────────────────────────┤
│ apps/api            Cloudflare Worker                        │
│  ├─ providers/      GLM + DeepSeek official API transport    │
│  ├─ generation/     server-only prompt, batching, validation │
│  ├─ images/         Cloudflare Workers AI + illustrate step  │
│  └─ http/           auth, quotas, validation, CORS, routes   │
├────────────────────────────────────────────────────────────┤
│ packages/ai-contract  Shared wire types (no prompt, no key)  │
├────────────────────────────────────────────────────────────┤
│ Supabase            auth (GoTrue), Postgres/RLS, Storage     │
│  ├─ profiles        own row; role guarded server-side        │
│  ├─ official_*      published read; admin write              │
│  ├─ user_official_decks  owner-only Plaza references         │
│  ├─ user_collections  owner-only deck-key groups             │
│  ├─ user_decks      owner-only generated/imported deck copies│
│  ├─ user_progress   owner-only live progress (Realtime)      │
│  └─ catalog_meta    monotonic version for cache invalidation │
├────────────────────────────────────────────────────────────┤
│ packages/plugin-sdk Plugin contract                         │
│  ├─ schema.ts       zod: manifest / deck / question          │
│  ├─ loader.ts       fetch index.json, decks and entry module │
│  ├─ registry.ts     question-type and importer registries    │
│  └─ types.ts        PluginContext, QuestionTypeRuntime…      │
├────────────────────────────────────────────────────────────┤
│ packages/core       Framework-free domain (no React, no DOM)│
│  ├─ grading.ts      built-in grading + answer normalisation  │
│  ├─ code.ts         code template composition + run grading  │
│  ├─ srs.ts          SM-2 variant scheduling                  │
│  ├─ session.ts      create / answer / skip / finish          │
│  ├─ stats.ts        14-day buckets, streaks, due counts      │
│  ├─ selectors.ts    mastery, mistakes, due, strength         │
│  └─ progress.ts     persisted state, settings, caps           │
├────────────────────────────────────────────────────────────┤
│ apps/desktop        Electron: loopback static server + window│
└────────────────────────────────────────────────────────────┘
```

Dependencies only point one way: `web → ai-contract`, `api → ai-contract`, and both → `plugin-sdk → core`.
Neither `core` nor `plugin-sdk` knows about React or Cloudflare, so both can be tested in Node and reused
by a CLI or a different shell. The UI depends on the interfaces in `apps/web/src/services/types.ts`;
only `services/supabase/` imports the Supabase SDK. Provider keys exist only in the Worker environment.

## Startup

1. `main.tsx` mounts `AuthProvider` → `UserDecksProvider` → `UserLibraryProvider` →
   `OfficialContentProvider` → `AppProvider`; built-in question types are registered first
   (`builtin` owner).
2. Auth restores the Supabase session (PKCE, local storage) and revalidates it against GoTrue in the
   background, so a session deleted on another device is dropped without blocking the first paint.
   The official provider reads the last catalogue snapshot from IndexedDB and then checks
   `official_catalog_meta.version`.
3. Once auth has restored its session, `AppProvider` reads the identity's own progress record
   (`progress:v2:guest` or `progress:v2:user:<id>`) and `local-plugins:v1` from IndexedDB and
   normalises them. `UserDecksProvider` and `UserLibraryProvider` list the signed-in user's cloud
   decks and official-library references.
4. Bundled plugins load from `<document.baseURI>plugins/index.json` — the base is resolved against
   the document rather than the JS bundle, otherwise dynamic `import()` would look in `/assets/`.
5. Each deck file is validated with zod, adapted to core types, and `entry` modules are imported and
   activated, registering question types and importers.
6. If the catalogue version changed, published packs/decks are fetched, validated with the same
   zod schema, cached, and made available to the Plaza. A learner's added official decks are
   selected from that catalogue by reference, not copied.
7. Guest starter decks, added official decks, imported local decks and cloud decks are merged into
   the same `Deck[]`; a cloud copy with the same `pluginId::deckId` replaces the local copy, so the
   deck and its progress keys stay unique.
8. Decks are flattened into `entries` (question + deck + global key); every page reads that.
9. Progress writes are debounced 450 ms into the active identity's record. Signing in or out flushes
   the record being left and loads the next one, so a guest never sees an account's attempts or
   sessions. Only an account created on this browser adopts guest practice once, and the guest record
   is cleared; signing into an existing account never touches it. The old shared `progress:v1` blob is
   claimed by the first account that signs in after 0.4.1.
   `AuthProvider` also re-checks the stored session with GoTrue on boot, on focus and once a minute;
   a `user_not_found`/expired session is dropped so an account deleted on another device cannot stay
   visible. Network failures keep the session and offline study working.
10. For a signed-in account, `AppContext` starts a sync controller. It GETs `user_progress`, merges
    the cloud copy into the local record with `mergeProgress`, commits any difference, and pushes a
    conditional update when the cloud is behind. A local learning change is pushed after 800 ms.
    Realtime (`postgres_changes` filtered to the user) refreshes it immediately; focus, `online` and a
    20-second poll are fallbacks. `learningFingerprint` ignores settings/`updatedAt`, so appearance
    changes never bounce between devices. Reset/import bumps `epoch`; a higher epoch replaces instead
    of merging.

## One answer

```
user submits → actions.submit(answer, msSpent)
  ├─ gradeQuestion(question, answer)     // core built-ins + plugin check()
  ├─ engineSubmit(session, …)            // locks the item, records the result
  ├─ reviewCard(card, quality, now)      // SM-2: next due date
  ├─ recordAttempt(progress, {attempt, card})
  └─ practice mode shows the verdict; Enter → advance() → summarize() on the last item
```

Answered items are locked inside the engine, so an exam session can move back and forth without
double-counting. Each attempt stores a `given` snapshot, so the review and results pages never have
to reconstruct what the user typed.

## Code questions

A code question is a template with one or more blanks plus one or more tests. Markers are either
`{{blank}}` (one inline blank), 2–6 unique `{{blank:name}}` parts, or a single blank with
`layout: "body"`, which hands the learner a large editor for a whole function body. The learner edits
each blank; `packages/core/src/code.ts` composes the program and grades from a recorded run:

```
values {iInit, iCond, …} ──composeTestProgram──▶ program ──sandbox──▶ {stdout, error, ms} ──compare──▶ CodeRun
                                                                                                         │
answer {values, run} ──gradeCode──▶ correct / partial / incorrect ──────────────────────────────────────┘
```

`gradeCode()` is pure: it trusts a run only when every recorded value matches the answer and every
test is present. Core never executes anything and never imports the DOM. Legacy decks with one
`{{blank}}` and a `solution` still load; answers written in the old `{ snippet }` shape are read as
`{ values: { blank } }`.

**The sandbox** (`apps/web/src/sandbox/runner.ts`) nests two boundaries:

```
app ──postMessage──▶ iframe sandbox="allow-scripts", opaque origin
                        CSP: default-src 'none'; worker-src blob:
                        └─ one Worker per test (own thread, network globals stubbed)
```

- A Worker has its own thread, so `while (true)` is terminated by the timeout instead of freezing the
  app. One Worker per test also stops globals leaking between cases.
- The iframe gives an opaque origin (no app DOM, storage or cookies) and a CSP inherited by blob
  workers, blocking `fetch`/XHR/WebSocket. Network constructors are also shadowed inside the worker.
- The parent verifies `event.source` and a random token on every message. Each worker run also carries
  its own token inside the bootstrap closure, so learner code cannot forge stdout or a passing result
  by calling `self.postMessage`.
- Output is capped at 100k characters; a run is capped at 10 s per test.

This is a study aid, not a hostile-code security boundary: it stops runaway loops and network access,
but it cannot cap memory. Documented as such in the UI and docs.

Mode gating lives in one place, `canRunCode(mode) → mode !== 'exam'`. Practice submission awaits
`prepareCodeAnswer()` (reusing a run the learner already made); `finishExam()` strips any run before
grading, so an exam paper is always answer-only. The mark for an unrun code answer is `pending`,
which the session counts as skipped.

## AI question generation

```
materials (IndexedDB) ──bounded, topic-ranked excerpts──▶ POST /api/ai/questions  (Worker)
                                                                │
                                          provider registry ────┤ GLM / DeepSeek (official APIs)
                                          batched prompt ───────┤
                                          zod validation        │
                                          dedupe + visuals ──────┤ Cloudflare Workers AI (photos only)
                                                                │
preview ◀── SSE progress + final deck ◀── runGeneration ◀───────┘
   │
   ├─ clear materials (successful generation)
   └─ save ▶ per-account cache ▶ user_decks (owner-only) ▶ Decks
```

- `packages/ai-contract` defines the wire types. `apps/web/src/ai/api.ts` is the browser transport:
  it attaches the Supabase bearer token, packs a bounded material excerpt, and parses SSE progress.
- `apps/api/src/providers/registry.ts` is the provider catalogue. GLM and DeepSeek use their official
  OpenAI-compatible endpoints; keys are Worker secrets. Adding a provider is a local spec plus a key
  variable, not a web-app change.
- `apps/api/src/generation/skill.ts` is the versioned system prompt. It is bundled only into the
  Worker; the web bundle contains no prompt text, no provider base URL and no key. The prompt covers
  the JSON shape, per-type rules, prompt-injection defence, the code-question contract and the
  visual object (diagram spec or photo brief).
- `apps/api/src/generation/generate.ts` asks for at most six questions per call, validates every
  reply with the plugin zod schema, asks once for a repair when the reply cannot be parsed, and
  removes duplicates. A reply cut off at the provider's token limit keeps its complete question
  objects; only the missing count is requested again, and a batch with nothing complete is split in
  half. Malformed JSON with literal control characters is repaired before parsing.
- `apps/web/src/ai/materials.ts` enforces the 1 GB upload budget and a 32 M character storage cap, then
  packs at most 300k characters (eight excerpts, 180k parts) for one API request. `extract.ts` handles
  text and Office XML; `pdf.ts` lazy-loads pdf.js. Images are ignored, never decoded.
- A topic with no material is a **topic brief**: the API treats the topic as the source and uses
  general knowledge instead of refusing. A short heading file does the same.
- Visuals are routed by kind. A `diagram` is a declarative figure spec validated by
  `packages/core/src/figure.ts` and drawn by `packages/web/src/components/FigureView.tsx` as inline
  SVG. A `photo` goes through `visual-plan.ts`, which rewrites the author's hint from the finished
  question, and `images/illustrate.ts`, which renders it with Workers AI and attaches it as an
  attested data URL. Only a clue question may use Wikimedia search, and a hit must overlap the query
  in its title or description; an ordinary scene goes straight to the image model. A failed planning
  call or photo is a warning, never a failed deck.
- `images/verify.ts` optionally sends each finished photo to the provider's vision model; an explicit
  mismatch drops the picture. `images/attest.ts` signs the SHA-256 of the bytes with ECDSA P-256, and
  the browser verifies them before upload and before display.
- Deduplication uses word/character bigrams rather than bag-of-words, so Chinese questions that share
  a formulaic stem are not deleted. If a reply still yields fewer valid questions than requested, the
  generator asks for only the missing ones (up to three top-up calls) before reporting a shortfall.
- `POST /api/ai/questions` defaults to JSON; `Accept: text/event-stream` returns progress and the final
  result as SSE. Auth, quota and request validation happen before the stream starts.
- The Generate page owns the engine controls: provider, text model, image model and visual mode.
  There is no per-deck visual count; one per question is the natural ceiling. The Settings page has
  no AI section. The chosen values are read from `/api/ai/config` and saved immediately.
- Material text lives in `ai-materials:v1` only while a generation is being prepared; it is cleared
  after a successful generation.
- Generated decks are saved to the owner-only cloud table and cached locally per account; they are
  hidden while signed out. The Generate draft keeps the full illustrated result in module memory and
  IndexedDB (tab keyed by sessionStorage), with the 5 MB tab copy as a first-paint fallback. AI
  settings (`ai-config:v1`) hold only a provider/model/image-model/visual preference — never a key.

## Accounts, RLS and the official catalogue

Supabase is the only server dependency. It hosts accounts (GoTrue), Postgres with row-level
security, and a public media bucket. The browser receives only the publishable key; the seed tool
uses the secret key outside the bundle.

```
AuthProvider ──▶ AuthService ──▶ Supabase Auth
     │
     └─ ProfileService ──▶ profiles (own row; role read-only)

OfficialContentProvider ──▶ OfficialContentService ──▶ official_packs/decks/meta
     │
     ├─ version unchanged ──▶ IndexedDB cache ──▶ AppContext
     └─ version changed ──▶ zod validation ──▶ IndexedDB + AppContext

UserDecksProvider ──▶ UserDeckService ──▶ user_decks (auth.uid() = user_id)
     │
     ├─ per-account IndexedDB cache ──▶ AppContext
     └─ automatic upload / remove ──▶ AppContext (cloud copy replaces same deck key)

UserLibraryProvider ──▶ UserLibraryService ──▶ user_official_decks (auth.uid() = user_id)
     │
     ├─ per-account IndexedDB cache ──▶ AppContext
     └─ add / remove ──▶ Plaza and Decks (references only; questions stay in official_decks)

CollectionsProvider ──▶ UserCollectionsService ──▶ user_collections (auth.uid() = user_id)
     │
     ├─ per-account IndexedDB cache ──▶ Library and CollectionPage
     └─ create / rename / add or remove decks / delete ──▶ automatic cloud sync
```

- **The Plaza is a catalogue, not a second copy.** `selectOfficialDecks()` filters the current
  catalogue by the learner's references, so an official update is visible without a per-user copy.
- **Guest decks are bundled, not cloud content.** Two simple decks are built in
  `domain/guest.ts`; they are always visible and cannot be deleted.

- **RLS is the security boundary.** `profiles.role` is removed from the authenticated update grant
  and guarded by a trigger. `official_*` writes require `private.is_admin()`, a security-definer
  helper in a non-exposed schema and pinned to an empty `search_path`. `official_catalog_meta` is
  written only by a trigger.
- **The official catalogue is versioned.** A statement-level trigger increments a singleton
  `version`; the client calls `getManifest()` (one tiny request) and fetches the catalogue only when
  the number changes.
- **Every official deck is untrusted input.** `buildOfficialPacks()` runs the plugin zod schema and
  drops invalid decks with a reported issue. A corrupt cache fails closed to the bundled snapshot.
- **Generated and imported decks are account content.** Sign-in is required and each deck writes one
  `user_decks` row, scoped to `auth.uid()`; there is no admin or public read. The signed-in user's
  list is cached per account in IndexedDB, refreshed on focus, and hidden on sign-out. Upload is
  automatic; imported decks are not left only on this device. Relative images and plugin-specific
  question types are rejected before upload, because another device may not have the plugin. Progress
  stays local unless the learner explicitly backs it up; AI requests go through the Worker, and
  provider keys never reach the browser.
- **Auth is PKCE + hash routing.** `redirectTo` is the bare document URL, so supabase-js consumes
  `?code=` before the router reads `#/…`. Recovery links navigate to `#/reset-password` on the
  `PASSWORD_RECOVERY` event (with a same-browser marker for reloads).

See [BACKEND.md](BACKEND.md) for the schema, policy matrix and setup steps.

## Internationalisation

`apps/web/src/i18n/messages.ts` is a flat catalogue of `{ en, zh }` pairs behind a typed key union.
`createTranslator(locale)` returns `t(key, vars)`; the provider exposes `t` and `locale` on the app
context, so any component can call `t('dash.startReview', { count: 12 })`.

- `locale` lives in `Settings` and defaults to `en`.
- `applyAppearance()` sets `<html lang>` and `data-locale`; CSS relaxes letter-spacing for CJK.
- Core is language-neutral: `strengthOf()` returns a tone, sessions carry a mode id, and the UI maps
  those to words. Nothing in `packages/` contains user-facing Chinese or English.
- Deck content is never translated by the app; a deck is in whatever language the author wrote.

## Design system

Tokens live in `styles/base.css`; layout and components in `styles/app.css`.

- Warm paper background, ink text, one pine accent. No gradients, no glass, no glow.
- Serif display face for headings and question prompts, system sans for UI, monospace for numbers
  and micro-labels.
- 1 px rules and spacing do the work that shadows and cards used to; radii top out at 8 px.
- Density first: decks are a table with columns, not a grid of cards; the dashboard is a metric
  strip plus two lists.
- Two themes (light/dark) plus three text sizes driven by `data-theme` / `data-font`.

## Data model

```ts
ProgressState {
  attempts: Attempt[]                     // capped at 8000, oldest dropped
  cards: Record<questionKey, CardState>   // SM-2: reps, lapses, ease, intervalDays, dueAt
  flags: Record<questionKey, true>
  notes: Record<questionKey, string>
  sessions: SessionSummary[]              // capped at 200
  settings: Settings
}
```

`questionKey = pluginId::deckId#questionId`. Renaming a plugin or a deck title keeps history;
changing a question id creates a new question.

## Storage

| Data | Where | Notes |
| --- | --- | --- |
| Progress, cards, notes, flags | IndexedDB `mengyin-study` / store `kv` | Falls back to memory if unavailable; the Settings page shows which is in use. The pre-rename `cityu-review` database is copied in once on first boot (`lib/storage.ts`) and its `cityu.demo.*` keys are remapped (`lib/legacy.ts`). |
| Imported plugins | Same store, key `local-plugins:v1` | Decks are stored already adapted; visible signed out; upload automatically after sign-in |
| AI-generated decks | Same store, key `local-plugins:v1` | Owner-tagged cache of `user_decks`; hidden signed out; images stay inline locally and are uploaded to `user-media` on save |
| Guest starter decks | Built into `domain/guest.ts` | Always available; not stored in `local-plugins` and cannot be deleted |
| Cloud deck list cache | Same store, key `user-decks-cache:v1:<userId>` | Per account; used while offline, replaced when a row's `updated_at`/identity changes |
| Official library cache | Same store, key `user-library-cache:v1:<userId>` | Per account; `packId::deckId` references used by the Plaza and Decks |
| Collection list cache | Same store, key `user-collections-cache:v1:<userId>` | Per account; `user_collections` rows for offline shelves and collection pages |
| Cloud collections | Supabase `public.user_collections` | Owner-only RLS; ordered `pluginId::deckId` references, not deck copies |
| AI settings | Same store, key `ai-config:v1` | Provider/model/image-model/illustration preference only; no key; excluded from backups; edited on Generate, sign-in required |
| AI material text | Same store, key `ai-materials:v1` | 1 GB file budget, 32 M character storage cap; cleared after successful generation |
| Plugin private data | Same store, key `plugin-kv:<id>:<key>` | Via `PluginContext.kv` |
| Official catalogue snapshot | Same store, key `official-content:v1` | Versioned, zod-revalidated on read; excluded from backups |
| Cloud deck copies | Supabase `public.user_decks` | `user_id = auth.uid()`, owner-only RLS; questions revalidated on read; images are `storage:` references, optional module |
| Learner images | Supabase Storage `user-media` (private) | One folder per user, owner-only RLS; signed URL at render time |
| Cloud budget | `user_decks` + `user-media` | Shared 30 MB per account; both write paths check it under one advisory lock |
| Official library references | Supabase `public.user_official_decks` | `user_id = auth.uid()`, owner-only RLS; composite FK to `official_decks` |
| Live progress | Supabase `public.user_progress` + local `progress:v2:*` cache | Owner-only RLS, conditional writes and Realtime; merged by attempts/sessions/cards/stamps, epoch replaces |
| Auth session | `localStorage` key `mengyin-study.auth` | Managed by supabase-js; refresh token, never exported |
| Build output | `apps/web/public/plugins/` → `apps/web/dist/plugins/` | Generated by the sync script, gitignored |

## Routing

A hand-written hash router (`#/library`, `#/plaza`, `#/collections/:id`, `#/practice`, …). No server
rewrite rules are needed for `file://`-style hosting, the desktop shell or static hosts; `navigate()`
uses `history.pushState` plus a custom event so the back button behaves.

## Performance

- `useMemo` caches `decks → entries → deckViews` and the statistics derived from attempts.
- Answering only recomputes the current session and the progress snapshot.
- Build: about 950 KB JS (280 KB gzip), 65 KB CSS (11 KB gzip). pdf.js is a separate lazy chunk
  (415 KB / 123 KB gzip) plus a 1.2 MB worker that only loads when a PDF is added. Supabase adds
  roughly 281 KB raw to the main chunk; it is loaded once and shared by auth and the catalogue.
- The Worker bundle is about 890 KiB raw (155 KiB gzip) and includes the server-side prompt; the web
  bundle contains neither the prompt nor any provider key or base URL.
- Generation runs at most six questions per model call and at most six batches; the material window per
  batch is capped at 14,000 characters, and the browser sends at most 300,000 characters per request.

## Trade-offs

| Choice | Why |
| --- | --- |
| Vite + React + TS | Fast dev loop, static output, type safety. |
| No UI framework | The visual language is bespoke; a component library would have reimposed the generic look. |
| zod at the boundary | Plugin JSON is user data and needs runtime validation, not just types. |
| IndexedDB | Thousands of attempts exceed localStorage. |
| Electron over Tauri | Pure npm, no Rust toolchain; the shell only serves files and opens a window. |
| PWA | Offline install without a packaged binary. |
| Browser-only code sandbox | No backend to run code on; a worker inside a CSP-locked iframe gives timeouts and network isolation without a server. |
| Lazy WASM runtimes | Python (Pyodide), SQL (sql.js) and Java (javac + TeaVM) are versioned static assets copied by `runtimes:fetch`, not part of the main bundle; the initial payload stays small and only a code question in that language downloads its runtime. |
| Six code languages | JavaScript and TypeScript are free; Python and SQL cover scripting/data; Java uses a real compiler; C++ uses JSCPP rather than a 95 MB Clang toolchain that would exceed Cloudflare Pages' per-file limit. The C++ subset is documented instead of pretending to be full C++23. |
| Direct provider calls | No proxy means the key never leaves the device, at the cost of requiring CORS on the provider. |
| Supabase | Managed auth, Postgres/RLS and storage without operating a server; the publishable key is safe in the bundle. |
| Versioned catalogue | One tiny version request per check; content is fetched only on change and works offline afterwards. |
| Lazy pdf.js | Most sessions never touch a PDF; code-splitting keeps the PDF runtime out of the main bundle. |

## Not implemented

- Installer packaging (electron-builder / Tauri).
- A manual question editor (generated questions can be reviewed and ticked, not rewritten).
- CRDT-grade conflict resolution. Progress merges by identity and per-question timestamps; two
  truly simultaneous edits to the same note/flag resolve deterministically rather than preserving
  both versions.
- Sharing a cloud deck with another account or a public link.
- An admin content UI (content is published with Studio, SQL or the seed script).
- Plugin sandboxing: plugins share the app's privileges (trust model).
- OCR for scanned PDFs; streaming generation; a full Clang C++ toolchain (JSCPP covers the teaching
  subset, while full Clang is ~95 MB and does not fit Cloudflare Pages' 25 MiB per-file limit);
  Kotlin/Scala/Rust runtimes.

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
│  ├─ ai/             skill, provider, materials, generation   │
│  └─ sandbox/        code runner (worker inside sandboxed iframe)│
├────────────────────────────────────────────────────────────┤
│ Supabase            auth (GoTrue), Postgres/RLS, Storage     │
│  ├─ profiles        own row; role guarded server-side        │
│  ├─ official_*      published read; admin write              │
│  ├─ user_official_decks  owner-only Plaza references         │
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

Dependencies only point one way: `web → plugin-sdk → core`. Neither `core` nor `plugin-sdk` knows
about React, so both can be tested in Node and reused by a CLI or a different shell. The UI depends
on the interfaces in `apps/web/src/services/types.ts`; only `services/supabase/` imports the
Supabase SDK.

## Startup

1. `main.tsx` mounts `AuthProvider` → `UserDecksProvider` → `UserLibraryProvider` →
   `OfficialContentProvider` → `AppProvider`; built-in question types are registered first
   (`builtin` owner).
2. Auth restores the Supabase session (PKCE, local storage). The official provider reads the last
   catalogue snapshot from IndexedDB and then checks `official_catalog_meta.version`.
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
   sessions. A new account adopts guest practice once and the guest record is cleared; the old shared
   `progress:v1` blob is claimed by the first account that signs in after 0.4.1.
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
materials (IndexedDB) or a written description ──chunk + rank──▶ batches ──system skill + excerpts──▶ provider
                                                                               │
preview ◀── dedupe/validate ◀── normalize ◀── JSON parse ◀── reply ◀──────────┘
   │
   ├─ clear materials (successful generation)
   └─ save ▶ per-account cache ▶ user_decks (owner-only) ▶ Decks
```

- `ai/skill.ts` is the versioned system prompt; it is the contract, not a suggestion. The exact text
  is also in `docs/QUESTION_AUTHORING_SKILL.md`, and a test keeps the two in sync.
- `ai/materials.ts` enforces the 1 GB upload budget and a 32 M character storage cap. A one-line text
  file is accepted; only whitespace is rejected. `ai/extract.ts` handles text and Office XML;
  `ai/pdf.ts` lazy-loads pdf.js (the worker is a separate 1.2 MB asset) so PDF support costs nothing
  until a PDF is added. Images are ignored, never decoded.
- Generation does not require a file: the description field, or a file that is only a short heading,
  becomes a **topic brief**; its first line can serve as the topic. The model uses well-established
  general knowledge for a short brief such as "C++ coding" instead of refusing because no substantive
  source document exists.
- `ai/chunks.ts` splits on paragraph boundaries and scores chunks against the topic; each batch gets a
  different window so a large document is covered rather than truncated. Requests are capped at six
  questions even when the material is a single chunk.
- `ai/client.ts` is a small OpenAI-compatible chat client with timeout, one transient retry, a
  `response_format` fallback, and defensive JSON extraction. A reply cut off at the provider's token
  limit is marked `truncated`; `ai/generate.ts` halves the batch and retries it.
- `ai/generate.ts` asks for at most six questions per call, validates each with the plugin zod schema,
  asks once for a repair when the reply cannot be parsed, removes duplicates, and reports shortfalls.
- The API key lives in `ai-config:v1` and is deliberately excluded from the backup export. Material
  text lives in `ai-materials:v1` only while a generation is being prepared; it is cleared after a
  successful generation. Generated decks are saved to the owner-only cloud table and cached locally
  per account; they are hidden while signed out.

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
  stays local unless the learner explicitly backs it up; AI keys never reach the network.
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
| AI-generated decks | Same store, key `local-plugins:v1` | Owner-tagged cache of `user_decks`; hidden signed out; uploads on save |
| Guest starter decks | Built into `domain/guest.ts` | Always available; not stored in `local-plugins` and cannot be deleted |
| Cloud deck list cache | Same store, key `user-decks-cache:v1:<userId>` | Per account; used while offline, replaced when a row's `updated_at`/identity changes |
| Official library cache | Same store, key `user-library-cache:v1:<userId>` | Per account; `packId::deckId` references used by the Plaza and Decks |
| AI provider config | Same store, key `ai-config:v1` | API key stays on the device; excluded from backups; sign-in required to edit |
| AI material text | Same store, key `ai-materials:v1` | 1 GB file budget, 32 M character storage cap; cleared after successful generation |
| Plugin private data | Same store, key `plugin-kv:<id>:<key>` | Via `PluginContext.kv` |
| Official catalogue snapshot | Same store, key `official-content:v1` | Versioned, zod-revalidated on read; excluded from backups |
| Cloud deck copies | Supabase `public.user_decks` | `user_id = auth.uid()`, owner-only RLS; questions revalidated on read; inline images/optional module |
| Official library references | Supabase `public.user_official_decks` | `user_id = auth.uid()`, owner-only RLS; composite FK to `official_decks` |
| Live progress | Supabase `public.user_progress` + local `progress:v2:*` cache | Owner-only RLS, conditional writes and Realtime; merged by attempts/sessions/cards/stamps, epoch replaces |
| Auth session | `localStorage` key `mengyin-study.auth` | Managed by supabase-js; refresh token, never exported |
| Build output | `apps/web/public/plugins/` → `apps/web/dist/plugins/` | Generated by the sync script, gitignored |

## Routing

A hand-written hash router (`#/library`, `#/plaza`, `#/practice`, …). No server rewrite rules are needed for
`file://`-style hosting, the desktop shell or static hosts; `navigate()` uses `history.pushState`
plus a custom event so the back button behaves.

## Performance

- `useMemo` caches `decks → entries → deckViews` and the statistics derived from attempts.
- Answering only recomputes the current session and the progress snapshot.
- Build: 868.84 KB JS (253.85 KB gzip), 48.46 KB CSS (8.64 KB gzip). pdf.js is a separate lazy chunk
  (415 KB / 123 KB gzip) plus a 1.2 MB worker that only loads when a PDF is added. Supabase adds
  roughly 281 KB raw to the main chunk; it is loaded once and shared by auth and the catalogue.
- Generation runs at most six questions per request and at most six requests; the material window per
  request is capped at 14,000 characters.

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

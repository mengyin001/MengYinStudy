# Changelog

## Unreleased

### Added

- **Checkout and the billing portal open in a new tab.** The original page stays put and shows a
  small outcome sheet: “Payment succeeded” refreshes the billing state and reloads, while “Payment
  failed / back” restores the plan buttons so another attempt can be made. Closing the sheet counts
  as “not completed”; a payment that actually succeeded still syncs when the tab regains focus or the
  page is refreshed. A blocked/closed Stripe tab is reported inline instead of navigating away.
- **AI-generated content is labelled and explained.** The Generate result panel now carries an
  “AI-generated” badge and a warning to verify facts, calculations, code and citations; the deck
  description stays as before (`Generated from …`). The Terms gain a fuller
  “AI-generated content and labelling” section covering non-review, accuracy, high-stakes use,
  label retention, disclosure when publishing, third-party rights, model variability, prohibited
  deepfakes/impersonation and reporting. The Privacy Policy explains the label and saved-deck
  description, and the homepage AI section repeats the label-and-verify warning.
- **Account ID on the Account page.** The profile panel now shows the Supabase user UUID next
  to the role and join date, selectable and copyable, so support can identify an account without
  asking for the email.
- **Stripe sandbox seeding for local billing tests.** `npm run stripe:seed-test -- --write`
  creates the three products, six USD prices and a default Customer Portal configuration in
  test mode, then writes a managed test block into `.dev.vars` while keeping the existing live
  values commented. Re-running is idempotent (products match by metadata, prices by lookup
  key), and the script refuses to run with a live key. `npm run stripe:replay-test --
  --email ...` applies a real test-mode subscription to the local database when no webhook
  tunnel is running.
- **Learner-created collections, synced to the cloud.** Decks can now be grouped into named
  collections from Decks; a collection opens its own `#/collections/:id` page with a back button,
  progress metrics, per-deck study/remove actions, an empty state and a deck picker. AI-generated
  decks can be saved straight into a collection from Generate, and the deck preview can add any
  library deck to one or more collections. `user_collections` stores ordered
  `pluginId::deckId` references (not copies), is owner-only under RLS, and is cached per account in
  IndexedDB for offline use. Adding the migration does not change the app version.
- **A figure registry, not a binary diagram/photo switch.** `apps/api/src/generation/figure-registry.ts`
  now enumerates 94 figure kinds across ten families — data charts, mathematics, physics/engineering,
  chemistry, biology, geography/history, humanities, computer science, tables and real scenes — and maps each to
  an IR, a renderer, a support level (`native`, `approx`, `external` for scenes), deterministic
  assertions and an ordered fallback. Exact figures never fall through to text-to-image; scenes never
  fall back to a maths diagram.
- **Dedicated compound renderers now cover every registered kind.** `packages/core/src/renderers/`
  adds `chart`, `graph`, `map`, `circuit`, `molecule`, `music`, `timeline`, `apparatus`,
  `surface3d`, `code` and `formula`; together with the primitive, table and scene paths that is
  **94/94 kinds: 71 native, 14 approx and 9 external scenes**, with no `none` fallback left. The
  renderer table is declared once in `RENDERER_KINDS` and drives both the registry and the coverage
  test. One chart renderer covers 31 plot-like kinds, one graph renderer covers 15 node/edge kinds,
  and one map renderer covers 8 schematic-map kinds; circuits, molecules, staves, timelines,
  apparatus and 3-D surfaces get their own symbol-aware renderers instead of loose primitives.
  Schematic maps and stylised apparatus are marked `approx` rather than pretending to be
  survey-accurate.
- **Real scene photos from web image search.** A photo plan may carry an internal `search` query.
  The API tries Wikimedia Commons first (`IMAGE_SEARCH=wikimedia`, the default), stores the image as a
  data URL with its author, licence and file page, and shows a small attribution line. A miss falls
  back to the image model. `IMAGE_SEARCH=off`, `IMAGE_SEARCH_LIMIT` and `IMAGE_SEARCH_TIMEOUT_MS`
  control it.
- **Scene clues are allowed to depict the answer.** "Guess the country", "which organelle is shown"
  and "what curve is this" are unanswerable without the picture, so the picture is the clue. Only text
  that names the answer is forbidden; the planner and the multimodal check both know the difference.
- **`table` and `pie` figure elements.** A table is a plain-canvas grid with up to 8 columns and 12
  rows and a header; it covers truth tables, comparison tables and matrices without hand-placed
  lines. A pie has 2–12 positive slices and the app computes the angles, so the wedges always sum to
  a full circle.
- **Flowcharts are described as a graph and laid out by the app.** A diagram can carry a Mermaid
  document (`flowchart TD|LR`, node shapes, labelled/arrow-less/dashed edges) or the same graph as
  JSON; `packages/core/src/flow.ts` parses it and computes layers, ordering, node sizes, and
  back/skip edges routed around the nearest outside edge so a loop never cuts through a sibling node.
  The stored figure is still a `v: 1` spec of `shape`, `line` and `label` elements, so the renderer,
  themes and saved decks keep working. Hand-placed `shape` nodes remain for layouts Mermaid cannot
  express.
- **A deterministic visual-worthiness gate.** Questions whose answer is a flowchart shape, or that
  ask what a shape or symbol represents, are no longer illustrated. Single-node "flowcharts" and
  unconnected symbol charts are dropped, and a diagram that draws the shape named by the answer is
  removed even when the author attached it. The gate runs before the planner, in both `auto` and
  `on` modes; questions that refer to a figure ("圖中", "shown", "the diagram below") are exempt.

- **Subscriptions, a point wallet and Stripe checkout.** `packages/core/src/billing.ts` holds the four
  plans (Free, Light $4.99, Standard $9.99, Pro $19.99 per month; yearly at ten months) and the point
  price list (0/1/4 points per question for GLM-4.7, DeepSeek Flash and DeepSeek V4 Pro, 10 per image,
  material surcharge by tier; no minimum). One point is one DeepSeek Flash question; Pro is four points
  because its provider price is about 3.5 times Flash's, rounded up. The free plan is capped at 200 questions per
  calendar month.
  `supabase/migrations/20261107090000_subscription_points.sql` adds `billing_accounts`, an append-only
  `point_ledger` keyed by request id, `stripe_events` and security-definer RPCs for snapshot, spend,
  refund and image quota. `20261108090000_question_quota.sql` adds the free monthly counter,
  membership-validity evaluation and service-role-only refunds. The API (`apps/api/src/billing/`)
  exposes `/api/billing/config|me|checkout|portal|webhook`, verifies Stripe signatures over the raw
  body, and reserves points before a generation, settling by delivered question count and refunding on
  failure. Plan enforcement now defaults to **on**: every generation reads the account's plan, status
  and paid period from Supabase, so editing browser state cannot unlock a model.
- **A plans page and point balance.** `/pricing` shows the four plans, monthly/yearly pricing, each
  plan's points or free questions and image quota, and the current balance. The point price list lives
  in `docs/SUBSCRIPTION_POINTS.md` §3.2 rather than on the payment page, so there is one place to edit.
  The plan entry sits at the top right of Today (and the balance chip stays in the sidebar), not in
  the left navigation. Generate shows the points estimate, the questions left on the selected model
  and disables models or images the plan does not include; Account gains a billing panel.
- **A billing guide page.** `/docs/billing` explains plans, the point rates (0 / 1 / 4 per
  question), image points, material surcharge tiers and how reserve/settle/refund works. It reads the
  same `packages/core/src/billing.ts` data as the API, links from the Plans page header and the
  Account billing panel, and keeps the point table off the plan cards.
- **The sidebar footer no longer changes height with the language.** English "Storage" and the
  streak line stay on one line, so switching between English and Chinese no longer wraps the footer
  or moves the sidebar contents.
- **A streak flame.** The sidebar streak now carries a flame icon that stays dark until three
  consecutive practice days, takes a new colour every three days (ten bands) and stops at thirty days.
  One missed day puts it out and restarts the count. `packages/core/src/streak.ts` owns the tiers;
  `StreakFlame` renders it in the sidebar, the statistics badge and the label text.

### Fixed

- **The Account page refreshes its billing snapshot on arrival.** After generating images, the
  profile page could keep showing the previous `0 / 40` AI-image count until a manual reload even
  though the server had already recorded the usage. Opening Account now calls `refresh()` and shows
  the current image, point and question counters.
- **Generated illustrations survive leaving the Generate page.** The illustrated result is kept in
  module memory and in IndexedDB, so a route change no longer forces the large base64 images through
  the 5 MB sessionStorage cap; that tab copy remains only a first-paint fallback. A reload restores
  the full illustrated draft from IndexedDB.
- **Web image search is limited to clue questions and checked for relevance.** Ordinary scene
  illustrations now use the image model instead of searching for a generic phrase. A clue's search
  result is only accepted when its title or description overlaps the query, and a clue with no
  reliable reference photo is left without a picture instead of being given an unrelated or
  generated guess.
- **Deck AI photos now consume the monthly image allowance.** A photo generated during question
  generation uses the plan's monthly image quota and costs 10 points beyond it, the same as a
  standalone AI image. Web-search reference photos and app-rendered figures remain outside the
  quota. The Account count and pricing copy now describe this.
- **Incomplete generation keeps the questions it already has.** When a provider stopped at its
  output limit or returned malformed JSON, the batch was discarded and split into fresh requests, so
  a half-finished reply could cost several extra model calls and still lose its complete questions.
  The server now repairs literal control characters inside JSON strings, parses the complete question
  objects out of a cut-off or malformed reply, asks only for the missing count and tells the model
  not to repeat them. A reply that already contains every requested question is accepted without
  another call. If nothing usable arrived, the batch is split and retried. DeepSeek's automatic
  completion budget rises from 8K to 32K (ceiling 64K), which avoids most cuts before they happen.
- **The point balance refreshes before the Generate form unlocks.** The server already deducted
  the settled charge, but `refreshBilling()` was fire-and-forget, so the sidebar and Account page
  could keep showing the pre-run balance until a later reload. The form now awaits the refreshed
  snapshot; a failed/cancelled run refreshes the refunded balance too.
- **Preview billing webhook endpoint path.** The Stripe test webhook for the preview Worker pointed
  at the site origin instead of `/api/billing/webhook`, so Checkout completed but the plan stayed
  free. The endpoint now uses the full path and its signing secret is stored on the preview Worker;
  a signed `customer.subscription.updated` replay moved the test account to Light and granted its
  500 points. Duplicate test subscriptions created during the failed attempts were cancelled.
- **Terms and Privacy now describe the paid service.** The Terms no longer say the service is free
  or that learners pay provider API costs, and they now cover plans, USD list prices and local-currency
  checkout, automatic renewal, cancellation, the monthly points allowance (including annual plans),
  upgrades and downgrades, refunds, taxes and failed payments. The Privacy Policy lists Stripe and the
  billing data it processes, records the tax/accounting retention exception, and explains that card
  details stay with Stripe. Both documents are version 1.4, updated 2026-11-07.
- **Deleting an account now stops subscription renewal.** The delete sheet calls
  `POST /api/billing/cancel` before the Supabase account row is removed, so Stripe is told
  `cancel_at_period_end=true` while the customer and subscription identifiers still exist. The sheet
  warns that the current paid period is not refunded. Previously the cascade removed the billing row
  and left Stripe free to renew an account that no longer existed.
- **Customer Portal plan changes now reach the account.** The webhook reads the subscription item's
  price before the stale `metadata.plan` value Checkout wrote, so upgrading Light → Standard no
  longer keeps the Light plan and allowance. A mid-period upgrade adds only the difference in
  monthly points (500 → 1,100 adds 600) and repeated webhooks are de-duplicated by a ledger key;
  downgrades keep the current balance until the period ends. The seeded portal configuration now
  prorates upgrades and schedules downgrades for the period end.

### Changed

- **The homepage now names the paid plans.** The hero note says the free plan is the starting point
  and paid plans add points, stronger models and images; the AI card no longer implies unlimited
  included generation. Pricing appears in the header, footer and pre-JavaScript shell, so a visitor
  can see the plans before creating an account. The landing `lastmod` moves to 2026-11-07.
- **The Plaza now reads like a course catalogue, not a flat plugin list.** Each official pack gets a
  deterministic two-character crest, a level and time estimate derived from its questions, and
  per-pack progress. The page opens with a continue/start lesson and a compact progress and
  daily-goal panel; a pack detail sheet shows a Duolingo-style vertical learning path with sample
  questions and per-deck add/remove/study actions. Packs can be added in one batch through
  `UserLibraryActions.addMany`, with partial-failure reporting. Guests, offline, empty and
  no-results states are preserved. No backend, schema or version change.
- **Checkout presents prices in the customer's local currency.** `createCheckoutSession`
  sets `adaptive_pricing[enabled]=true`, so a USD price is converted by Stripe at Checkout
  (150+ markets; the customer pays the 2–4% conversion fee). The app's pricing page stays in
  USD; no per-currency prices or hard-coded HKD amounts are used.
- **Plan points are now a monthly allowance, not a rollover wallet.** `20261109090000_monthly_point_reset.sql`
  adds `monthly_points`, `points_reset_at` and a separate `bonus_points` bucket, and `billing_snapshot`,
  `billing_spend` and `billing_image_take` apply a lazy reset when the reset date has passed. The reset
  runs inside the same row-locked Postgres transaction as the read or charge, so it needs no cron,
  scheduled Worker or client timer, and an annual subscription still receives its monthly points every
  month even though Stripe invoices once a year. Unused plan points no longer accumulate, purchased
  points survive every reset, and months the learner missed are skipped instead of paid retroactively.
  A late renewal webhook records the Stripe period but cannot refill points already spent that month.
  An account whose paid period has ended never receives a fresh allowance at the reset instant
  (`period_end > now()` is false at equality): the due reset clears the plan bucket and unschedules,
  which also lets a delayed renewal webhook grant the new month instead of mistaking the zero reset
  for an already-served period.
  `/api/billing/me` exposes `monthlyPoints`, `pointsResetAt`, `planPoints` and `bonusPoints`, and
  Account shows the allowance and the next reset date. A live subscriber who chooses another plan is
  sent to the Customer Portal instead of opening a second Checkout subscription, so the old one is no
  longer charged in parallel.
- **The model catalogue is now exactly three models: GLM-4.7, DeepSeek Flash and DeepSeek V4 Pro.**
  The GLM-5.3 family is gone from the plan lists, the point table, the provider fallbacks and the
  documentation. Points are 0 / 1 / 4 per question; the free plan uses GLM-4.7, Light adds DeepSeek
  Flash, and Standard/Pro add DeepSeek V4 Pro. Plan point balances are unchanged, so one point now
  buys a Flash question instead of a sixth of one.
- **Generation names its own model.** `/api/ai/questions` returns `400` when `model` is missing or
  `auto`; there is no server default or provider default to fall back to. The Generate page shows one
  flat model list — provider icon on the left, model name in the middle, points multiplier on the
  right (`Free`, `×1`, `×4`) — instead of a provider dropdown followed by a model dropdown. The icons
  are the official DeepSeek whale and GLM/Zhipu `Z` app marks, stored as transparent-corner PNG assets
  rather than drawn monograms.
- **The free plan is capped at 200 questions a calendar month.** The free GLM-4.7 model still costs
  no points and no provider money, but the counter is reserved through Supabase before each run,
  settled by delivered questions and refunded on failure. Generate shows the questions left, and
  Pricing/Account/sidebar show the free remaining count instead of a zero point balance.
- **Membership status is checked on every generation.** `billing_snapshot` returns the effective plan,
  downgrading an expired, cancelled or past-due paid subscription to free immediately. A paid model
  cannot be used by editing local storage.
- **Points refunds and the free-question counter are service-role RPCs.** The old user-callable
  `billing_refund` could credit points without a charge; it is dropped and replaced by a function that
  requires the service key and an explicit user id.
- **The provider timeout is now an inactivity timeout.** Generation requests are streamed; every
  received chunk resets `AI_TIMEOUT_MS` (300 s by default), so a model that keeps producing tokens can
  run past five minutes, while a connection that goes silent for the whole window still fails as
  `provider_timeout`. Providers that reject streaming fall back once to a non-streaming request.
- **No per-run question cap.** The plan `maxQuestions` ceiling is gone from the core plan table,
  the API policy and the Generate count field. A free run is bounded only by the questions left in
  the 200/month quota; a paid run is bounded by the point balance, which is reserved in full before
  the provider is called. The old 10/30/60/100-per-run limits are removed from Pricing and the docs.
- **No daily generation limit.** Free and paid plans can generate as often as they like within the
  monthly question cap or point balance; usage is bounded by the model a plan unlocks and the
  balance. The `billing_daily_take` RPC and its columns remain in the database but are no longer
  called, so this can be reversed without a migration.
- **Stripe period compatibility.** The webhook now reads `current_period_end` (and
  `cancel_at_period_end`) from the subscription item shape introduced by Stripe API
  2025-03-31, with the old top-level fields as a fallback. Without this, a new Stripe
  account would receive no period key and therefore no monthly point grant.
- **The monthly image allowance is explicitly for AI images only.** Figures the app
  renders from structured data — functions, geometry, charts, maps, circuits, molecules,
  timelines, tables, flowcharts and 3-D surfaces — are free, unlimited and never touch the
  monthly quota. They are now available on every plan, including free; only AI photos
  (text-to-image or web search) need a paid plan. AI photos generated with a deck now consume
  the same monthly image allowance as standalone images; web-search reference photos and
  app-rendered figures do not. Pricing, Account, the billing guide and the Generate hint now
  say “AI images” instead of “images”.
- The author and planner prompts now route by figure family: the named compound element for charts,
  graphs, maps, circuits, molecules, staves, timelines, apparatus and 3-D surfaces; Mermaid for a
  plain process; tables for tabular data; web search or the image model for real scenes. They also
  skip symbol-definition questions. Prompt and package versions are intentionally unchanged.
- The Generate copy explains the registry, the compound renderers and web image search.
- **"All where useful" now really requests an illustration for vocabulary/definition
  questions.** Previously the planner's explicit `skip` suppressed the generic fallback even in `on`
  mode, so a deck of word questions could end with no image at all. In `on`, a question with no
  exact/structural figure now reaches the generic illustration path; `auto` still respects the
  planner's skip. The generic brief no longer includes the explanation, which could name the answer.
- The Illustrations hint now says that `auto` skips vocabulary/definition questions when a picture
  would only decorate them.

### Verified

- **592 tests / 71 files**, typecheck clean, production build OK.

## 0.8.0 — 2026-11-06

### Added

- **A visual router: exact diagrams vs photo-like scenes.** The author returns one optional `visual`
  object — `{"kind":"diagram","spec":{…}}`, `{"kind":"photo","prompt":"…"}` or `{"kind":"none"}`.
  Diagrams attach immediately; photos go through the planner. In `on` mode every non-code question
  gets a visual; in `auto` the planner decides per finished question, aiming for roughly one in three
  on visual subjects. When auto finds none, the deck says so.
- **A declarative figure format and renderer.** A `v: 1` spec supports `plot`, `line`, `arrow`,
  `point`, `circle`, `polygon`, `arc`, `label`, `bar` and flowchart `shape` nodes (rect, rounded,
  diamond, ellipse, parallelogram) on cartesian or plain coordinates. `packages/core/src/figure.ts`
  validates it and lays out SVG; `FigureView` renders it inline. The title is an HTML caption, so it
  cannot overlap a node.
- **Plain-coordinate normalisation.** Models often wrote pixels in a `plain` spec; the parser detects
  values above 100 and converts them to percentages, and `FigureView` re-validates on display, so
  older decks repair themselves.
- **A multimodal check and ECDSA attestation for photos.** A configured vision model checks each
  finished photo; `IMAGE_SIGNING_KEY` / `IMAGE_VERIFY_KEY` sign its bytes, and the browser verifies
  them before upload and display.
- **A deterministic answer-leak check for diagrams.** A label that repeats the correct option or a
  fill/short answer is removed before the figure is attached.
- **Longer provider timeout and a liveness display.** `AI_TIMEOUT_MS` defaults to 300 s; it is now an
  inactivity window that resets on every streamed chunk (10–600 s). SSE writes `: keep-alive` every
  15 s and the Generate page rotates a "still working" line with an elapsed counter.

### Changed

- `QuestionMedia` is a union of image and figure media; the plugin schema validates figure specs on
  load, and Storage code skips figures.
- Generate's copy explains that diagrams are drawn locally and only photos consume the 30 MB budget;
  the image statistics report diagrams and photos separately.

### Verified

- Provider `429`/`5xx`/network failures are retried up to five times with exponential backoff,
  including split sub-batches; a request returns `429` only after that budget is exhausted.
- **424 tests / 57 files**, typecheck clean, production build OK.

## 0.7.0 — 2026-11-06

### Added

- **Private image Storage for learner decks.** Saving a deck now uploads its illustrations to the
  private `user-media` bucket and writes only `src: "storage:<path>"` into `user_decks.questions`.
  Rendering resolves the marker to a short-lived signed URL, so the deck row no longer grows with
  base64 and another device never receives a broken image. The migration
  `20261106213000_user_media_storage.sql` creates the bucket, owner-only RLS policies and
  `public.user_media_usage()`.
- **A 30 MB per-account budget that counts deck text as well as images.** Triggers on both
  `storage.objects` and `user_decks` reject a write that would exceed the shared limit, using the
  same per-account advisory lock so two saves cannot race past it. `public.user_media_usage()` now
  returns the total, the deck-text part and the image part.
- **A live storage meter in the left sidebar.** It shows used/total, the text/image split and a
  warning colour as the account approaches 30 MB; clicking it opens Settings.
- **No 30-question request cap.** The Generate count field has no maximum, `AI_LIMITS.maxQuestions`
  is `0` (no application ceiling), and the generator plans batches from the requested count instead
  of stopping at six batches. A huge request streams progress and can be cancelled; the 30 MB
  account budget and provider time are the practical limits.
- **No separate per-deck image cap.** There is no illustration-count control: one picture per
  question is the natural ceiling, and Generate more can keep adding questions and pictures. The
  account's 30 MB budget is the only limit; images are re-encoded as WebP with a 1280 px long edge
  when the browser supports it.
- **Short-reply top-up and safer duplicate detection.** If the model returns fewer valid questions
  than requested, the API asks only for the missing ones (up to three calls) before reporting a
  shortfall. Duplicate detection now compares word/character bigrams instead of bag-of-words, so
  Chinese questions that share a formulaic stem are no longer deleted. A shortfall is shown in the
  same prominent banner as a partial generation.

### Fixed

- **“Requested 15, saved 10.”** The old unigram duplicate check could treat valid Chinese questions
  as near-duplicates, and a short model reply was accepted without a top-up. Both paths now preserve
  the requested count, and any remaining shortfall is explicit rather than silently saved.
- **Cloud deck rows with many images could exceed the 8 MB row limit.** Images leave the JSON before
  the size check, so only the remaining question text is measured.
- **Deleting a cloud deck left its images behind.** Deck and account deletion now remove the
  corresponding `user-media` objects.
- **“Unsupported XML/SVG” on cloud upload.** Demo illustrations and some imported images are
  `image/svg+xml`; the `user-media` bucket no longer rejects them, and the browser rasterises SVG
  to WebP before upload when it can. Raw `<svg>`/`<?xml…` payloads are accepted too.
- **Illustrations that had nothing to do with the question.** The picture prompt used to be written
  in the same reply as six other questions, so it described the deck topic rather than the situation
  the question shows, and a literal text-to-image model rendered something unrelated. Illustrations
  are now planned in a second pass: the finished, deduplicated questions go back to the same text
  model with their prompt, options, answer and explanation, and it returns a concrete visual brief
  (objects, counts, arrangement, arrow directions, what must not appear). Only that brief reaches the
  image model. The pass is batched eight questions per call, can say `skip` when no picture helps,
  and falls back to the author's hint if it fails. The SSE stream gains a `planning` stage.
- **“Saved locally, but the cloud upload failed: duplicate key value violates unique constraint”.**
  Pressing Save raced the automatic uploader: the record was claimed only after the local write was
  awaited, so both writers selected “no row”, both inserted, and the loser failed with SQLSTATE
  23505. Save now claims the record before it is persisted, concurrent uploads of one record share a
  single request, and an insert that still loses the race is retried as an update.
- **A saved deck could lose its illustrations while keeping the row.** Two paths could delete a live
  Storage object: a refused `DELETE` on `user_decks` still removed the deck's images (the row stayed,
  the pictures did not), and the upsert error handler removed objects that a row which had already
  committed points at. Both are closed — storage objects are only removed for a row that was really
  deleted, and only when the write never committed. A deck whose objects are missing is repaired on
  the next load from its local copy (re-uploaded at the same path, so the stored markers keep
  working), and an unresolvable image is no longer rendered as an empty dashed frame.
- **A deleted cloud deck came back a second later.** Two problems stacked. (1) `DELETE` returns
  success even when it matches no row, so the library could report a removal it never made; the
  cloud service now asks PostgREST which rows it deleted, retries once by the stable `client_key`
  when the row id is stale, and returns `forbidden` when the row is still readable afterwards.
  (2) A list request started *before* the delete resolved *after* it, repainting the deck that had
  just been deleted; a delete or upload now invalidates every list that started earlier
  (`state/refreshGuard.ts`), so a stale reply can no longer put a deck back on screen. The automatic
  uploader also refuses to re-create a key deleted in this tab.
- **The Generate form could be edited while a request was running.** Every input that describes the
  request — topic, description, count, difficulty, language, types, code language, focus, materials,
  provider, models and the illustration mode — is now disabled while generation runs, so the form
  cannot drift away from what was actually sent. Cancel stays available, and the panel says why the
  fields are locked. File drops and the save/remove actions are guarded too.

### Changed

- **Version 0.7.0.** `APP_VERSION` and `AI_SERVICE_VERSION` follow the package version.
- **Migrations required.** Apply
  `supabase/migrations/20261106213000_user_media_storage.sql` for the bucket and
  `supabase/migrations/20261106230000_storage_quota_includes_decks.sql` for the shared text+image
  quota. Without them, uploads fail and the quota is not enforced.

## 0.6.1 — 2026-11-06

### Added

- **A hosted AI question API, with no key in the browser.** `apps/api` is a Cloudflare Worker that
  serves the built app and `/api/ai/*` from one origin. It validates the caller's Supabase session,
  holds the official GLM (Zhipu) and DeepSeek keys as Worker secrets, and returns validated decks.
  The shared wire contract lives in `packages/ai-contract`; the web client is
  `apps/web/src/ai/api.ts`. See `docs/AI_API.md`.
- **Multiple providers, text models and image models.** `GET /api/ai/config` advertises provider ids,
  model lists, the default provider, and the image capability with its selectable models. The
  Generate page's **Generation engine** panel lets a learner choose Automatic, a provider, a text
  model and an image model; `GLM_MODEL(S)` / `DEEPSEEK_MODEL(S)` and `IMAGE_MODEL(S)` configure the
  server's lists. Adding another OpenAI-compatible provider is one spec in
  `apps/api/src/providers/registry.ts`.
- **Generated illustrations.** The authoring prompt can attach an optional, text-free educational
  diagram to questions where a picture helps. Cloudflare Workers AI (the free allocation,
  `@cf/black-forest-labs/flux-1-schnell` by default) creates at most six per deck as data URLs, and
  the preview and practice card render them. The image model is chosen per generation from the
  server's allowlist. A failed image is a warning, not a failed deck.
- **Streaming progress.** `POST /api/ai/questions` returns SSE when the client asks for it:
  `progress` events for batches, repair/split, validation and illustrations, then one `result`.
  Plain JSON remains available for scripts and other API clients.
- **Bounded request packing.** The browser sends at most 300k characters (eight excerpts, 180k parts)
  ranked against the topic, so a 1 GB material set still contributes its most relevant pages without
  a huge request. The API repeats the limits server-side.
- **Local API development.** `npm run dev` starts the Worker API (`127.0.0.1:8787`) and Vite
  (`127.0.0.1:5173`) together, and stops both on Ctrl+C. `npm run dev:api` and `npm run dev:web` still
  run them separately. With no provider key it starts a clearly labelled demo provider (`AI_MOCK=1`)
  and a deterministic SVG image generator, so the whole flow can be exercised before keys exist.
- **Optional per-account daily quotas.** Bind a KV namespace as `AI_QUOTA` to enforce
  `AI_DAILY_QUESTIONS` / `AI_DAILY_IMAGES`; without it the service runs uncapped.
- **A draft that grows across runs.** Generating again appends to the current preview instead of
  replacing it, so a learner can build a deck larger than one request's 30-question cap. The merge
  renumbers question ids and skips exact duplicate prompts. The preview gains a per-question trash
  button and a one-click **Delete all questions** action.
- **A tab-scoped draft that survives navigation.** The generated draft is stored in
  `sessionStorage`, so switching pages or reloading keeps the questions; closing the tab or browser
  clears them. If illustrations exceed the storage quota they are dropped with a warning while the
  questions are kept. A generation that stops early now shows the provider's reason in a prominent
  `partial` warning instead of only a generic notice.
- **A public homepage for signed-out visitors.** `/` now leads with what MengYin Study is
  for — building decks, practising, reviewing mistakes and remembering — before asking
  anyone to sign in; the study dashboard moved to `/today` for guests (signed-in learners
  still get it at `/`). Google sign-in is disclosed lower down in a "Sign-in and data"
  section rather than in the hero. A pre-JavaScript shell in `index.html` carries the same
  name, purpose and legal links for crawlers and for people whose bundle has not loaded yet.
  See `apps/web/src/landing/copy.ts`.
- **Google OAuth verification disclosures.** The privacy policy and terms now have a
  Google-specific section: the exact `openid email profile` data, its use, storage, sharing,
  retention and deletion, the Limited Use statement and links to the Google API Services
  User Data Policy and Google APIs Terms of Service. Both documents state that Google APIs
  are used only for sign-in, never for AI generation, and prohibit AI NCII.
- **A new brand mark and OAuth logo.** The cream M is built from book spines with a
  terracotta bookmark; `tools/make-icons.py` regenerates the favicon, PWA icons, the
  120×120 OAuth logo (`apps/web/public/icons/oauth-logo-120.png`) and the social card.
- **`docs/OAUTH_VERIFICATION.md`.** The Console fields, the exact public URLs, the Supabase
  redirect URI and the resubmission checks for the next Google review.
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

### Changed

- **AI generation is a service, not a browser integration.** The Generate page now owns every AI
  choice: provider, text model, image model and illustration mode, saved immediately and applied to
  the next run. Settings no longer asks for a base URL, key, temperature, max tokens or JSON mode, and
  has no AI section at all. Sign-in is still required; the API rejects anonymous generation.
- **The authoring prompt is server-only.** It moved to `apps/api/src/generation/skill.ts`, the
  browser bundle no longer contains its text, and the Generate page no longer has a "View the skill"
  button. The public `docs/QUESTION_AUTHORING_SKILL.md` was removed.
- **The deployment is one Worker with static assets.** `wrangler.jsonc` now declares `main`, the
  `ASSETS` binding and the Workers AI binding. `npm run deploy` builds and deploys; a static-only
  Pages upload still works for practice but has no `/api/ai/*`.
- **AI privacy wording tells the truth about the service.** The policy now names Cloudflare, Zhipu
  GLM and DeepSeek as processors, explains that only a bounded excerpt leaves the device, and states
  that prompts/materials/generated decks are not stored on the server.

### Removed

- The browser-side OpenAI-compatible client and its tests (`apps/web/src/ai/client.ts`,
  `generate.ts`, `skill.ts`). Generation now happens in `apps/api/src/generation`.
- The public question-authoring skill document and the in-app skill viewer.

### Fixed

- **Rate limits retry instead of throwing away a split batch.** Every provider call now gets up to
  five attempts with exponential backoff on `429`, `5xx` and network failures, including the second
  half of a split batch. When a split still fails on one side, the successful side is kept; when a
  later batch fails, the API returns the validated questions already generated with a `partial`
  warning and HTTP `200` instead of discarding the whole deck.
- **Generation no longer runs on a 256-token budget.** When a numeric server setting was absent,
  `numberIn` parsed the empty string as `0` and clamped it to the minimum, so the documented
  `AI_MAX_TOKENS=8192` default was actually 256, `AI_TEMPERATURE` was 0 and `AI_TIMEOUT_MS` was
  10 seconds. Every multi-question reply hit the output limit and was split repeatedly. Blank now
  means the documented default, and the completion budget follows the provider: 32K for GLM (up to
  128K) and 8K for DeepSeek (up to 64K).
- **A pasted `/chat/completions` URL no longer breaks GLM.** `GLM_BASE_URL` (and the DeepSeek
  equivalent) may be either the base URL or the full endpoint copied from the provider docs; the
  transport strips a trailing `/chat/completions` before appending its own path, so the request no
  longer becomes `/chat/completions/chat/completions`.
- **Guest practice no longer leaks into an existing account.** Signing in used to adopt the browser's
  guest record whenever the account had no *local* history, so an account whose statistics lived only
  in the cloud received the guest attempts on its next sync. Adoption is now opt-in and only an
  account created on this browser can claim it once (a sign-up, an email confirmation, or a first
  OAuth sign-in); signing into an existing account leaves the guest record untouched.
- **A deleted account disappears from other devices.** `getSession()` only reads local storage, so a
  desktop kept showing an account whose auth user had been deleted from a phone until the token
  expired. Every device now revalidates the stored session with GoTrue on boot, on focus and once a
  minute, and drops it when the server reports the user is gone. Offline and server failures keep the
  session so study still works without a network.
- **Privacy and terms no longer switch a dark homepage to a light page.** The standalone
  `/privacy/` and `/terms/` pages now follow the app theme. `applyAppearance` mirrors the theme
  mode (`light`, `dark` or `system`) to `localStorage`, and a four-line inline bootstrap applies
  an explicit choice before first paint; `system` and no-JavaScript readers follow
  `prefers-color-scheme`. The in-app `#/privacy` and `#/terms` routes already used the app theme.
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
  documented in the repository at the time and checked against the code by a test.
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

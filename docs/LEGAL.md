# Privacy policy and terms of service

The app publishes two documents it is legally responsible for:

| Document | App-store URL | In-app route |
| --- | --- | --- |
| Privacy Policy | `https://<your-origin>/privacy/` | `#/privacy` |
| Terms of Service | `https://<your-origin>/terms/` | `#/terms` |

The trailing slash matters when you paste the URL into Google Play, the App Store or a
Microsoft Partner Center form: `/privacy/` is a real directory with an `index.html`, while
`/privacy` relies on the host redirecting to it.

In the app, `#/docs` is the standalone Help & policies site. It opens in its own tab with a guide
rail and a sticky “On this page” table of contents, explains the practice loop and AI labelling,
covers plans and refunds, and links the billing guide, refund policy, privacy policy and terms.
`#/docs/refunds` and `#/docs/billing` open the same site at the relevant section. The legal
documents remain standalone pages so an app-store reviewer can read them without the app shell.

## Why two forms of the same document

An app-store reviewer opens the URL without signing in, often with JavaScript blocked. A
hash route (`/#/privacy`) would show nothing useful in that case, so the build emits
`privacy/index.html` and `terms/index.html` as **self-contained static files** — inline CSS,
no bundle, no fonts, no network requests — from the same content the in-app pages render.
Both are emitted by the `mengyin:legal-documents` plugin in
[`apps/web/vite.config.ts`](../apps/web/vite.config.ts), so they cannot drift apart.

The static pages follow the app's colour theme. `applyAppearance` mirrors the selected theme
mode (`light`, `dark` or `system`) to `localStorage` under `mengyin:theme`; a four-line inline
bootstrap on the legal page applies an explicit light/dark choice before paint, while
`system` and first-time visitors follow the OS `prefers-color-scheme`.

Inside the app, `#/privacy` and `#/terms` follow the reader's language and are linked from
the sidebar footer, Settings → About → Legal, the Help & policies site (`#/docs`), the Pricing
footer and the sign-up consent line.

## Where the wording lives

- [`apps/web/src/legal/content.ts`](../apps/web/src/legal/content.ts) — every sentence, in
  Traditional Chinese and English, as structured blocks (`p`, `ul`, `ol`, `table`, `links`,
  `note`, `contact`). Edit here; never edit the generated HTML.
- [`apps/web/src/legal/config.ts`](../apps/web/src/legal/config.ts) — document version, the
  effective date, the support mailbox used as the fallback contact, and the environment hooks.
- [`apps/web/src/legal/render.ts`](../apps/web/src/legal/render.ts) — placeholder filling and
  the resolved shape both front ends consume.
- [`apps/web/src/pages/Legal.tsx`](../apps/web/src/pages/Legal.tsx) — the in-app page.

After a material change, bump `LEGAL_VERSION` and set `LEGAL_UPDATED` to the date the new
wording takes effect, then rebuild.

## Configuration

| Variable | Effect |
| --- | --- |
| `VITE_LEGAL_OPERATOR` | Name shown as the data controller. Defaults to `MengYin Study`. |
| `VITE_LEGAL_CONTACT_EMAIL` | Overrides the published mailbox. The default lives in `apps/web/src/legal/config.ts` (`mengyinqwq@gmail.com`). |
| `VITE_PUBLIC_ORIGIN` | Public origin, used for the canonical `<link>` and the "back to the app" link in the static files. |

The mailbox is part of the documents, not a build secret: a reader and a store reviewer both
need an address they can write to, and it is the fallback when the in-app deletion flow cannot
be used. The source repository is private, so no repository URL is published.

## What the documents claim

The wording describes what the code actually does. If any of this changes, the documents
have to change with it:

- Accounts are Supabase Auth (email/password, Google, GitHub); passwords are hashed there.
- Synced data (decks, attempts, mistakes, notes, scheduling) lives in Supabase PostgreSQL in
  Seoul, isolated per account by row level security; static files are served by Cloudflare.
- AI generation goes through the hosted Cloudflare Worker, which forwards a bounded excerpt to the
  official GLM or DeepSeek API and uses Cloudflare Workers AI for illustrations. Provider keys stay
  on the server; prompts, materials and generated decks are not stored there.
- AI-generated questions, answers, explanations and images are labelled in the generation view. A
  saved deck may not carry that label in its description, so the Terms require learners to verify
  the output, keep any label when sharing or exporting, disclose AI-generated content when
  publishing, and not pass it off as human-written, human-reviewed or official answers.
- There is no advertising, no behavioural analytics and no sale of personal data.
- Paid plans are sold through Stripe Checkout. Supabase stores the plan, status and Stripe
  customer/subscription identifiers; Stripe holds the payment method and invoices. The Terms
  cover automatic renewal, cancellation, the monthly plan-point allowance (including annual
  plans), upgrades/downgrades, refunds, taxes and failed payments; the Privacy Policy adds the
  billing row, Stripe as a processor, and the tax/accounting retention exception.
- Refunds use the same source of truth as spending. Within seven days of the first successful
  payment, `POST /api/billing/refund` returns the unused part of that invoice: monthly
  `paid × unused plan points ÷ monthly plan points`; yearly
  `paid × (11 + unused ÷ monthly) ÷ 12`, so untouched future months are returned in full. No
  points used means a full refund of that invoice. Bonus points are excluded. A refund cancels
  the subscription immediately, clears the remaining plan points and records the Stripe refund
  in `billing_refunds`; the Account page shows the quote before the learner confirms. The legal
  wording, the Help & policies site and the billing guide all state this formula.
- Google Sign-In is optional and receives only the basic profile (`openid`, `email`, `profile`).
  The policy states the Google API Services User Data Policy and Limited Use requirements
  explicitly, and says Google APIs are used only for sign-in, never for AI generation.
- AI generation is for study questions only; the policy and terms prohibit NCII, child sexual
  abuse material and sexualised content, and the server-side authoring prompt refuses those requests.
- Account deletion happens in the app (Account → Delete account). For a paid or past-due
  account it first calls `POST /api/billing/cancel`, which sets Stripe's
  `cancel_at_period_end=true` while the customer and subscription IDs still exist. It then calls
  the `delete_account()` RPC in `supabase/migrations/20261104230000_delete_account.sql`, which
  removes `auth.uid()` and lets the existing `on delete cascade` constraints clear the profile,
  decks, library, progress and billing rows. Email is the fallback for a learner who cannot sign
  in. Deleting an account does not itself issue a refund; the refund flow has to run first, while
  the billing row and Stripe identifiers still exist.

The Google Cloud Console fields and the resubmission steps are in
[docs/OAUTH_VERIFICATION.md](OAUTH_VERIFICATION.md). Submit the standalone URLs
(`https://study.mengyin.online/privacy/`), never the `#/privacy` hash route.

`apps/web/src/legal/legal.test.ts` fails if a section loses its Chinese or English version, if
a `{{placeholder}}` is left unresolved, if the static page stops being self-contained, or if
the disclosures above disappear.

## Checking the pages

```bash
npm run build
npm run serve:dist          # then open http://127.0.0.1:4173/privacy/
```

Or in development, with the app running: open `#/privacy` and `#/terms`, then confirm the
language switch, the contents list and the phone layout.

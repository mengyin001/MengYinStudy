# Privacy policy and terms of service

The app publishes two documents it is legally responsible for:

| Document | App-store URL | In-app route |
| --- | --- | --- |
| Privacy Policy | `https://<your-origin>/privacy/` | `#/privacy` |
| Terms of Service | `https://<your-origin>/terms/` | `#/terms` |

The trailing slash matters when you paste the URL into Google Play, the App Store or a
Microsoft Partner Center form: `/privacy/` is a real directory with an `index.html`, while
`/privacy` relies on the host redirecting to it.

## Why two forms of the same document

An app-store reviewer opens the URL without signing in, often with JavaScript blocked. A
hash route (`/#/privacy`) would show nothing useful in that case, so the build emits
`privacy/index.html` and `terms/index.html` as **self-contained static files** — inline CSS,
no bundle, no fonts, no network requests — from the same content the in-app pages render.
Both are emitted by the `mengyin:legal-documents` plugin in
[`apps/web/vite.config.ts`](../apps/web/vite.config.ts), so they cannot drift apart.

Inside the app, `#/privacy` and `#/terms` follow the reader's language and are linked from
the sidebar footer, Settings → About → Legal, and the sign-up consent line.

## Where the wording lives

- [`apps/web/src/legal/content.ts`](../apps/web/src/legal/content.ts) — every sentence, in
  Traditional Chinese and English, as structured blocks (`p`, `ul`, `ol`, `table`, `note`,
  `contact`). Edit here; never edit the generated HTML.
- [`apps/web/src/legal/config.ts`](../apps/web/src/legal/config.ts) — document version, the
  effective date, the repository URL used as the fallback contact, and the environment hooks.
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
- AI keys, prompts and material files stay on the device; generation calls the reader's own
  endpoint from the browser and never passes through our servers.
- There is no advertising, no behavioural analytics and no sale of personal data.
- Account deletion happens in the app (Account → Delete account). It calls the
  `delete_account()` RPC in `supabase/migrations/20261104230000_delete_account.sql`, which
  removes `auth.uid()` and lets the existing `on delete cascade` constraints clear the profile,
  decks, library and progress. Email is the fallback for a learner who cannot sign in.

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

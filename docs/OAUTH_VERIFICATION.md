# Google OAuth verification checklist

This is the checklist for the Google Cloud Console side of verification. The repository can
provide every public page and the logo; only the Console fields have to be entered by the
project owner.

The last review returned six findings:

| Finding | What this repository now does |
| --- | --- |
| Privacy policy content insufficient | `/privacy/` is a standalone, bilingual policy with Google-specific limited-use, retention, sharing, deletion and NCII sections. |
| Homepage requires login | `/` is a public landing page for signed-out visitors. The dashboard is still `/` after sign-in and `/today` for guests. |
| Homepage does not explain purpose | The landing page states the purpose in the hero, the Google section and the AI section. A pre-JavaScript shell in `index.html` says the same thing before React loads. |
| OAuth app name differs from homepage | The name is `MengYin Study` in the page title, H1, manifest and brand mark. Set the Console name to exactly that string. |
| Google APIs Terms / AI NCII | The homepage and both legal documents say that Google APIs are used only for sign-in and that AI-generated non-consensual intimate imagery (AI NCII) is prohibited. The question-authoring prompt also refuses NCII. |
| Logo does not identify the brand | A new book-spine M with a terracotta bookmark is used everywhere. Upload `apps/web/public/icons/oauth-logo-120.png` to the Console. |

## Console values

Open **Google Cloud Console → APIs & Services → OAuth consent screen** (the "Branding" page in
the newer Console) and set:

| Field | Value |
| --- | --- |
| App name | `MengYin Study` |
| User support email | `mengyinqwq@gmail.com` |
| App logo | `apps/web/public/icons/oauth-logo-120.png` (120×120 PNG, 4.5 KB) |
| Application home page | `https://study.mengyin.online/` |
| Application privacy policy link | `https://study.mengyin.online/privacy/` |
| Application terms of service link | `https://study.mengyin.online/terms/` |
| Authorized domain | `mengyin.online` |
| Developer contact email | `mengyinqwq@gmail.com` |

Do **not** submit `https://study.mengyin.online/#/privacy` for the privacy field. The `#` part
is never sent to the server, so Google's reviewer may see the homepage instead of the policy.
`/privacy/` is a real static file emitted by the build.

## Scopes

The app requests only the basic OpenID scopes through Supabase Auth:

- `openid`
- `email`
- `profile`

No sensitive or restricted Google scopes are requested. The app does not ask for Gmail,
Drive, Calendar, Contacts, Photos or any other Google API. Do not add scopes to the consent
screen "just in case"; every added scope needs its own justification and demo.

## Authorized redirect URI

Supabase handles the OAuth exchange, so Google needs the Supabase callback, not the app URL:

```text
https://yukmxeieklwgnwdcqwpb.supabase.co/auth/v1/callback
```

Add it under **Credentials → OAuth 2.0 Client IDs → Authorized redirect URIs** if it is not
already there. The Supabase project's **Authentication → URL Configuration → Redirect URLs**
must also allow `https://study.mengyin.online/**`; that is a separate list and does not replace
the Google redirect URI.

A preview deployment needs its own entry in the same Supabase Redirect URLs list, for example
`https://mengyinstudy-preview.libingzham1.workers.dev/**`. Leave the Site URL on production: an
unlisted preview return URL otherwise falls back to the Site URL, which makes Google/GitHub
sign-in land on the production site. The Google/GitHub callback URI itself does not change.

## Known Google branding loop (Supabase callback domain)

If the Google consent screen says **“Sign in to continue to
`<project-ref>.supabase.co`”** instead of `MengYin Study`, the automated brand checker is
comparing that displayed redirect host with the name on the homepage. This is a Google-side
branding loop, not a defect in the homepage: Google's own documentation says that **without
verification, only the application domain is visible** on the consent screen. The app uses
Supabase Auth, so the visible domain is the Supabase callback host.

The consent screen's privacy link is the *published* brand value. In the live screen it is
`https://study.mengyin.online/privacy` (no trailing slash), while the homepage links
`/privacy/`. Make the Console value exactly `https://study.mengyin.online/privacy/` and the
homepage link the same string; a strict checker may compare them before following the 301.

Checks before asking for manual review:

1. **Audience → Publishing status.** If the app is still in Testing, click **Publish app** and
   set it to In production.
2. **Branding → Authorized domains.** Keep only `mengyin.online`. Do not add `supabase.co`;
   the Supabase callback belongs in **Authorized redirect URIs**, not authorized domains.
3. **Branding → Publish branding.** A saved draft is not live. After saving the name and URLs,
   trigger verification and publish the approved brand. The live Google screen must show the
   new privacy URL; if it still shows `/privacy` without the slash, the published brand has
   not updated.
4. **Branding → Last reviewed.** If the date does not change after a resubmission, Google is
   reusing the old snapshot; another retry will not help.

If the consent screen still shows the Supabase host, use the Verification Center's appeal
path (or the Google Developer forums / `api-oauth-dev@google.com`) and ask for a manual
review. Include the exact consent-screen text, the configured app name, the homepage and the
privacy URL. Resubmitting the same automated check repeatedly does not break this loop.

The permanent alternatives are a Supabase custom domain (`auth.mengyin.online`) so the
redirect host is under the app's own domain, or a Google Identity Services ID-token flow that
does not use the Supabase callback at all. Both are larger changes than the Console fields.

## Before resubmitting

1. Deploy the build that contains the landing page and the new legal pages.
2. Open `https://study.mengyin.online/` in a private window, signed out. Confirm:
   - the H1 is `MengYin Study`;
   - the page explains the app without a login wall;
   - `/privacy/` and `/terms/` load as real pages (no `#`);
   - the "Sign-in and data" section and the AI policy mention Google API scope and the NCII prohibition.
3. Open `https://study.mengyin.online/privacy/` and search for `Limited Use`, `Google API
   Services User Data Policy`, `NCII` and `mengyinqwq@gmail.com`.
4. Check the favicon and the OAuth logo render the book-spine M, not a plain letter.
5. In the Console, confirm the app name is exactly `MengYin Study` and not a Chinese subtitle
   or a variant such as `MengYin Study 溫習平台`.
6. Record a short demo video only if the Console asks for one. Basic scopes normally do not.

## If a finding comes back

The wording lives in one place: `apps/web/src/legal/content.ts`. The public landing copy lives
in `apps/web/src/landing/copy.ts`. The app name is in `apps/web/src/i18n/messages.ts`
(`app.name`) and `apps/web/src/lib/version.ts` (`APP_NAME`).

After editing, bump `LEGAL_VERSION` and `LEGAL_UPDATED` in
`apps/web/src/legal/config.ts` when the legal wording changes materially, run `npm run check`,
and redeploy.

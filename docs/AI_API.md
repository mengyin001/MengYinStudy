# AI question API

The AI service is a Cloudflare Worker in `apps/api`. It serves the built web app and the API from the
same origin, keeps provider keys on the server, and streams generation progress to the browser.

```
Browser (React)                         Cloudflare Worker                      Providers
─────────────────                       ─────────────────                      ─────────
POST /api/ai/questions  ──────────────▶  auth (Supabase JWT)                    GLM  (official API)
  topic, settings,                        provider registry                      DeepSeek (official API)
  300k-char excerpt                       batching + validation
        ◀──────── SSE progress ─────────  illustration pipeline  ─────────────▶ Cloudflare Workers AI
        ◀──────── SSE result ───────────  deck + images (data URLs)
```

The shared wire types are in `packages/ai-contract`. The browser client is `apps/web/src/ai/api.ts`;
the prompt is `apps/api/src/generation/skill.ts` and is never imported by the web app.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/ai/health` | no | Liveness, configured-provider count and image availability |
| `GET` | `/api/ai/config` | yes | Providers, text models, image models and limits |
| `POST` | `/api/ai/test` | yes | One tiny completion with the chosen provider/model |
| `POST` | `/api/ai/questions` | yes | Generate a deck (JSON, or SSE with `Accept: text/event-stream`) |
| `POST` | `/api/ai/images` | yes | Generate one image from a prompt |

Authentication is `Authorization: Bearer <Supabase access token>`. The Worker validates the token with
GoTrue's `/auth/v1/user` endpoint using the publishable key; it never needs the JWT signing secret.
Set `AUTH_REQUIRED=false` only for local development.

## `GET /api/ai/config`

```json
{
  "providers": [
    {
      "id": "glm",
      "label": "GLM (Zhipu)",
      "models": ["glm-4.7-flash"],
      "configured": true,
      "demo": false
    },
    {
      "id": "deepseek",
      "label": "DeepSeek",
      "models": ["deepseek-flash", "deepseek-v4-pro"],
      "configured": false,
      "demo": false,
      "vision": false
    }
  ],
  "images": {
    "available": true,
    "model": "@cf/black-forest-labs/flux-1-schnell",
    "models": [
      { "id": "@cf/black-forest-labs/flux-1-schnell", "label": "FLUX.1 Schnell" }
    ],
    "maxPerRequest": 0,
    "search": { "available": true, "provider": "wikimedia" }
  },
  "limits": {
    "maxQuestions": 0,
    "maxImagesPerDeck": 0,
    "maxMaterials": 8,
    "maxMaterialChars": 400000,
    "maxMaterialCharsEach": 200000,
    "maxRequestBytes": 1500000,
    "maxImagePromptChars": 600
  },
  "authRequired": true,
  "imageVerifyKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…"
}
```

The response never contains a secret, a base URL or the prompt. `imageVerifyKey` is the public SPKI
key used to attest generated photos (null when attestation is not configured); it is safe to cache.
The catalogue deliberately has no default provider or default model: generation must name a model.
A `0` in `maxQuestions`, `maxImagesPerDeck` or `maxPerRequest` means there is no application-level
ceiling; the 30 MB per-account storage budget and the provider's own limits still apply.

## `POST /api/ai/questions`

```json
{
  "topic": "Stacks and queues",
  "count": 10,
  "difficulty": "mixed",
  "language": "auto",
  "types": ["single", "multi", "boolean", "fill", "short", "code"],
  "codeLanguage": "javascript",
  "focus": "chapter 4 only",
  "description": "An introductory data structures course.",
  "materials": [{ "name": "week3.pdf", "text": "…extracted text…" }],
  "model": "glm-4.7-flash",
  "imageMode": "auto",
  "imageModel": "@cf/black-forest-labs/flux-1-schnell"
}
```

- `model` is **required** and must be one of the catalogue ids (`glm-4.7-flash`,
  `deepseek-flash`, `deepseek-v4-pro`). There is no server default and no provider
  default: omission or `"auto"` is a `400`. The server derives the provider from the model.
- `provider` is accepted for an older client but ignored; send `model` only.
- `imageModel` is optional; `"auto"` or omission uses `/config`'s image default.
- `types` may be omitted (all six) but not empty.
- `imageMode`: `off`, `auto` (the planner decides per finished question; roughly one visual per three
  on visual subjects) or `on` (every non-code question). Diagrams are free and available on every
  plan, including free; only photos call the image model and need a paid plan.
- `imageModel` must be one of `images.models` from `/config` when the plan includes AI photos; an
  unknown id is a `400`. A free-plan request may still use `auto`/`on`, but it only receives
  rendered figures.
- `imageMax`: optional; bounds generated **photos** only. Omitted means every photo brief is used;
  `0` requests none, and a positive value is a per-request preference. Diagrams are free and are not
  counted, and there is no per-deck photo cap.
- `count`: any positive whole number; `0` in `/config` means no application-level ceiling. The
  per-account 30 MB budget (deck text plus images) and provider time are the real limits. A request
  with a huge count streams progress and can be cancelled.
- `materials`: at most 8 excerpts and 400k characters in total (200k each).
- A topic with no materials and no description is valid; the topic becomes the brief.

### JSON response

```json
{
  "deck": {
    "key": "ai.stacks-…::generated-…",
    "id": "generated-…",
    "pluginId": "ai.stacks-…",
    "title": "Stacks and queues",
    "description": "Generated from the topic brief · GLM (Zhipu) · glm-4.7-flash",
    "tags": ["Stacks and queues"],
    "questions": [
      {
        "id": "q1",
        "type": "single",
        "prompt": "…",
        "options": [{ "id": "a", "text": "…" }],
        "answer": { "kind": "single", "optionId": "b" },
        "explanation": "…",
        "tags": ["Stacks"],
        "difficulty": 2,
        "media": [
          {
            "type": "figure",
            "figure": { "v": 1, "coords": "cartesian", "elements": [{ "kind": "plot", "expr": "x^2" }] },
            "alt": "…"
          },
          {
            "type": "image",
            "src": "data:image/jpeg;base64,…",
            "alt": "…",
            "digest": "9f2c…",
            "signature": "MEUCIQ…"
          }
        ]
      }
    ],
    "examMinutes": 12
  },
  "warnings": [{ "code": "brief", "message": "…" }],
  "usage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0 },
  "engine": { "provider": "glm", "providerLabel": "GLM (Zhipu)", "model": "glm-4.7-flash" },
  "images": { "requested": 2, "generated": 2, "searched": 1, "failed": 0, "diagrams": 1 }
}
```

`usage` is provider-reported; some providers omit it. `warnings` uses stable codes: `brief`,
`shortfall`, `duplicates`, `invalid`, `types`, `model`, `image`, `images`, `materials`, `quota`,
`partial`.

`figure` media is drawn by the client from the spec and never uploaded. `searched` counts the photos
that came from web image search rather than the image model; those carry `credit`, `sourceUrl` and
`license` and should show the attribution. `digest`/`signature` are present on generated photos when
attestation is configured: the client must upload those bytes unchanged and may verify them with
`imageVerifyKey` from `/config`.

Each generation call is retried up to five times with exponential backoff on `429`, `5xx` and network
failures, including the calls made after a batch is split. A reply cut off at the provider's output
limit, or one with malformed JSON, is not thrown away: literal control characters inside strings are
repaired first, then complete question objects are parsed out of the partial JSON and only the
missing count is requested again, with the complete prompts sent as a do-not-repeat list. A reply
that already contains every requested question is accepted without another model call. If no
question was complete, the batch is split and retried. The provider request is streamed: the
`AI_TIMEOUT_MS` limit (default **300 s**, configurable 10–600 s) is an **inactivity timeout**, and
every received chunk resets it. A model that keeps producing tokens may run past 300 s, while a
connection that sends nothing for the configured window is reported as `provider_timeout`. If a
provider rejects streaming, the API falls back once to a non-streaming request for that attempt.
The SSE stream writes a `: keep-alive` comment every 15 seconds while it waits, so an idle-looking
connection is still alive (and the browser UI rotates a "still working" line with an elapsed
counter). Prefer SSE for long runs; a plain JSON request has no keep-alive and may hit an
intermediary's idle limit.
If a later batch still fails, the API returns the questions that were already validated with a
`partial` warning and HTTP `200`; it only returns `429`/`502` when no question could be produced.

### SSE response

Send `Accept: text/event-stream`. The status is `200` once generation starts; errors discovered after
that are an `error` event. Each block is `event: <name>` plus one `data:` JSON line, separated by a
blank line.

```
event: progress
data: {"stage":"requesting","batch":1,"batches":3,"message":"batch 1/3"}

event: progress
data: {"stage":"planning","batch":0,"batches":2,"message":"planning 2 visuals"}

event: progress
data: {"stage":"illustrating","batch":1,"batches":2,"message":"illustration 1/2"}

event: result
data: { …the same payload as the JSON response… }
```

Stages: `preparing`, `requesting`, `repairing`, `splitting`, `validating`, `planning`,
`illustrating`, `done`. `planning` rewrites photo hints and fills gaps; `illustrating` renders the
selected photos. Diagrams are attached before `planning` and need neither stage.
On failure:

```
event: error
data: {"error":{"code":"provider_rate","message":"…","requestId":"…"}}
```

Validation, authentication, quota and provider-resolution failures happen before the stream starts
and return a normal JSON error with the real status code.

## `POST /api/ai/images`

Generate uses the same image provider internally; this endpoint exposes it directly.

```json
{
  "prompt": "a labelled diagram of a leaf cross-section",
  "alt": "leaf cross-section",
  "model": "@cf/black-forest-labs/flux-1-schnell"
}
```

Returns `{ "image": "data:image/…;base64,…", "model": "@cf/…", "alt": "…", "digest": "…", "signature": "…" }`.
`digest`/`signature` appear when attestation is configured. The prompt is capped at
600 characters and gets an educational style suffix (no text, labels, numbers or people) when it does
not already ask for that. `model` is optional and must come from `/config`; `"auto"` uses the server
default. The image provider itself (Cloudflare Workers AI) is still a server setting.

> Diagrams are not available through this endpoint: they are not images. The question endpoint
> returns them as `figure` media for the client to draw.

## `POST /api/ai/test`

Body `{ "model": "glm-4.7-flash" }` (required; `provider` is ignored). Sends an eight-token
completion and returns `{ ok, provider, providerLabel, model, latencyMs }`. It does not consume the
question quota.

## Configuration

Worker secrets (`npx wrangler secret put NAME`) and local `.dev.vars` / `.env` values:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GLM_API_KEY` | — | Zhipu API key. Enables the GLM provider |
| `GLM_MODEL` | `glm-4.7-flash` | Preferred GLM model; the browser still sends an explicit id |
| `GLM_MODELS` | built-in list | Comma-separated model list shown to the browser |
| `GLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | Official OpenAI-compatible endpoint; a full `/chat/completions` URL is also accepted |
| `GLM_THINKING` | provider default | `enabled` / `disabled` / `auto` |
| `DEEPSEEK_API_KEY` | — | DeepSeek API key. Enables the DeepSeek provider |
| `DEEPSEEK_MODEL` | `deepseek-flash` | Preferred DeepSeek model; the browser still sends an explicit id |
| `DEEPSEEK_MODELS` | built-in list | Comma-separated model list |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` | Official OpenAI-compatible endpoint; a full `/chat/completions` URL is also accepted |
| `DEEPSEEK_THINKING` | `disabled` | DeepSeek thinking mode; `auto` sends nothing |
| `DEEPSEEK_REASONING_EFFORT` | `high` | `low` / `high` / `max` when thinking is enabled |
| `AI_TEMPERATURE` | `0.4` | 0–2 |
| `AI_MAX_TOKENS` | `0` (auto) | `0` picks 32K for both GLM (ceiling 128K) and DeepSeek (ceiling 64K); an explicit 256–ceiling value overrides it |
| `AI_TIMEOUT_MS` | `300000` | Inactivity gap while streaming; each chunk resets it. 10–600 s |
| `AI_JSON_MODE` | `true` | `false` disables `response_format` |
| `AI_ALLOW_CUSTOM_MODELS` | `false` | Allow a model id outside the list |
| `AI_MOCK` | off | `1` adds a demo provider and images; **never in production** |
| `IMAGE_PROVIDER` | `cloudflare` | `cloudflare`, `demo` or `none` |
| `IMAGE_MODEL` | `@cf/black-forest-labs/flux-1-schnell` | Default Workers AI image model |
| `IMAGE_MODELS` | the default model | Comma-separated allowlist of selectable image models |
| `IMAGE_STEPS` | provider default | Flux steps, 1–8 (ignored by non-Flux models) |
| `IMAGE_SIGNING_KEY` | — | PKCS8 base64 ECDSA P-256 key; signs generated photos (`npm run image:keys`) |
| `IMAGE_VERIFY_KEY` | — | SPKI base64 public key, published in `/config` |
| `IMAGE_SEARCH` | `wikimedia` | `wikimedia` or `off`; real reference photos for scene questions |
| `IMAGE_SEARCH_LIMIT` | `8` | Results requested per search, 1–12 |
| `IMAGE_SEARCH_TIMEOUT_MS` | `12000` | Search and download timeout, 3–30 s |
| `GLM_VISION_MODEL` | — | Optional vision model (e.g. `glm-4v-flash`) for the photo check |
| `DEEPSEEK_VISION_MODEL` | — | Optional vision model for the photo check |
| `AI_VERIFY_IMAGES` | on when a vision model is set | `off` disables the multimodal check |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_AI_TOKEN` | — | REST fallback when the `AI` binding is unavailable |
| `AUTH_REQUIRED` | `true` | Keep true in production |
| `SUPABASE_URL` | — | Project URL for token verification |
| `SUPABASE_PUBLISHABLE_KEY` | — | Publishable/anon key, not the secret key |
| `ALLOWED_ORIGINS` | same-origin | Comma list or `*`; set for the desktop shell |
| `AI_DAILY_QUESTIONS` | `120` | Per-account daily questions, only with a KV binding |
| `AI_DAILY_IMAGES` | `30` | Per-account daily images, only with a KV binding |

### Model names

The defaults reflect the official documentation at release time, but provider catalogues change.
Set `GLM_MODEL` / `GLM_MODELS` and `DEEPSEEK_MODEL` / `DEEPSEEK_MODELS` to the exact ids your account
can call; the browser reads the resulting list from `/config`. `AI_ALLOW_CUSTOM_MODELS=1` lets a
request name an id that is not listed, which is useful while testing a new model.

### Adding another provider

Add a spec in `apps/api/src/providers/registry.ts` (id, label, key variable, base URL and fallback
models). Most providers expose an OpenAI-compatible `/chat/completions`, which the existing transport
already handles. Add its model list to the docs and `wrangler.jsonc` if it should be the default.

## Local development

```bash
# Both the API (127.0.0.1:8787) and Vite (127.0.0.1:5173), one command:
npm run dev
```

To run them in separate terminals instead:

```bash
# terminal 1 — API on 127.0.0.1:8787
npm run dev:api

# terminal 2 — web app on 127.0.0.1:5173, proxying /api to the API
npm run dev:web
```

With no provider key, `dev:api` starts the demo provider (`AI_MOCK=1`) and `AUTH_REQUIRED=false`.
The demo returns placeholder questions and a deterministic SVG illustration, so the full stream,
validation and image path can be exercised without spending a token. Set `GLM_API_KEY` or
`DEEPSEEK_API_KEY` in `.env` for real output; `AUTH_REQUIRED` stays false locally but the web app
still asks the learner to sign in.

The Node adapter bundles the Worker with esbuild. It is a development convenience only; the deployed
runtime is Cloudflare.

## Deploying

The root `wrangler.jsonc` declares `main` (the Worker), the static `assets` binding and the Workers
AI binding. One deployment serves both the app and the API, so `/api/ai` is same-origin.

```bash
# once per secret
npx wrangler secret put GLM_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY

# build the web app, then upload the Worker and assets
npm run deploy
```

`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `AUTH_REQUIRED`, `ALLOWED_ORIGINS` and the image settings
are non-secret and live in `wrangler.jsonc`'s `vars`. Do not put a provider key there.

### Optional daily quotas

Create a KV namespace and bind it as `AI_QUOTA`:

```bash
npx wrangler kv namespace create AI_QUOTA
```

Add the returned id to `wrangler.jsonc`:

```jsonc
"kv_namespaces": [{ "binding": "AI_QUOTA", "id": "<id>" }]
```

Then set `AI_DAILY_QUESTIONS` / `AI_DAILY_IMAGES`. The quota key is per account per UTC day. Without
the binding the service has no per-account cap (Cloudflare's own rate limits still apply), so bind it
before opening a public deployment.

### Verify

```bash
curl https://<worker>/api/ai/health
curl https://<worker>/api/ai/config -H "Authorization: Bearer <token>"
```

Or sign in to the app and open **Generate**; the "Generation engine" panel lists every selectable
model in one place (provider icon, model name and points multiplier) plus the image models returned
by `/config`. Changing them there applies to the next generation.

## Errors

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | Missing topic, invalid count/type, too much material |
| 401 | `unauthorized` | Missing or expired session |
| 404 | `not_found` | Unknown API path |
| 413 | `payload_too_large` | Request over 1.5 MB |
| 429 | `rate_limited` / `quota_exceeded` | Provider rate limit or daily cap |
| 502 | `provider_auth` / `provider_error` | Provider rejected the key or request |
| 502 | `image_failed` | Image provider failed |
| 503 | `ai_unconfigured` / `images_unavailable` | No key or image provider on the server |
| 504 | `provider_timeout` | Provider did not answer in time |

Every error body is `{ "error": { "code", "message", "requestId" } }`. The `requestId` also appears in
the `X-Request-Id` response header and in Worker logs.

## Security notes

- Keys are Worker secrets; `/config` exposes only provider ids, labels and model names.
- The prompt is server-only. It is not in the web bundle, `docs/` or an API response.
- Requests are bounded before they reach a provider; the Worker rejects oversized bodies and trims
  every field.
- CORS is same-origin by default. `ALLOWED_ORIGINS=*` is used for the desktop shell; authentication is
  a bearer token, not a cookie, so a wildcard does not grant access to someone else's account.
- The API does not store prompts, materials or decks. Cloudflare and the model providers may keep
  short-lived request logs under their own policies; the privacy policy discloses this.

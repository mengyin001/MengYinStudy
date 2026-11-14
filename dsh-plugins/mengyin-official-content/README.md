# MengYin official content authoring (DSH bundle)

A DSH Host + Web client bundle that exposes the official catalogue to the agent and to a
dedicated management page:

| Tool | Purpose |
| --- | --- |
| `official_catalog` | List collections (合集) and question banks (題庫) with ids, counts and Plaza visibility. |
| `official_collection_create` | Create an official collection (`official_packs`). |
| `official_question_bank_create` | Generate and publish a question bank (`official_decks`) from a written description, optionally into an existing collection. |
| `official_delete` | Delete one bank or a whole collection, including stored images. |

A collection is the Plaza pack shown in the app. It appears only once it has at least one
published question bank. Deleting a collection cascades to every bank in it.

## Web interface

The bundle also ships a DSH Web client page. A sidebar icon labelled **Official banks**
(官方題庫) opens a full manager:

- collections on the left, question banks on the right;
- create a collection, or create a bank from a written description and choose its
  collection, question count, types, difficulty, language, image mode and publication
  state;
- see drafts, published state, question/figure/image counts and Plaza visibility;
- delete a bank or a whole collection after a confirmation dialog that names what is
  removed;
- refresh the catalogue without leaving the page.

The page calls the Host half's loopback-only `/api/mengyin-official` route, so the browser
never receives the Supabase secret or provider keys. After installing or changing the
client half, refresh the DSH page if the sidebar icon is not yet visible.

## How it works

The tools call [`tools/official-content.mjs`](../../tools/official-content.mjs) in this
workspace. That script:

1. Runs the app's own Worker generation pipeline (`apps/api`) in-process with the bundled
   Node 24 runtime. This keeps the authoring prompt, schema validation, duplicate removal,
   figure registry and photo checks identical to the Generate page.
2. Moves generated photos and user-supplied attachments from data URLs / local files into
   the public `official-media` Supabase Storage bucket, then rewrites them to relative paths
   and records `media_base_url`. Diagram specs stay in the deck JSON and need no upload.
3. Writes `official_packs` / `official_decks` with the service-role key. The catalogue version
   trigger makes existing clients refresh on their next check.
4. Deletes rows and removes the matching Storage objects. A failed image cleanup is reported
   as a warning instead of pretending the deletion failed.

## Requirements

- The repository's `.env` / `.dev.vars` must provide `SUPABASE_URL`,
  `SUPABASE_SECRET_KEY` (never the publishable key), and `GLM_API_KEY` or
  `DEEPSEEK_API_KEY`.
- The official migrations must be applied (`supabase/migrations`), including the
  `official-media` bucket.
- The DSH Host must be able to start the bundled Node 24 executable
  (`$DSH_HOME/dsh-runtimes/*/dependencies/node/bin/node.exe`). Override it with
  `MENGYIN_NODE` if needed.

## CLI examples

```powershell
# List
'{}' | node tools/official-content.mjs list --spec -

# Create a draft bank and let it create a collection
'{"description":"...","title":"...","count":10,"images":"auto","published":false}' |
  node tools/official-content.mjs create-bank --spec -

# Add a bank to an existing collection, with a local SVG attached to question 2
'{"description":"...","packId":"pack-...","attachments":[{"question":2,"path":".tmp/diagram.svg"}]}' |
  node tools/official-content.mjs create-bank --spec -

# Delete
'{"packId":"pack-...","deckId":"deck-...","confirm":true}' |
  node tools/official-content.mjs delete-deck --spec -
'{"packId":"pack-...","confirm":true}' |
  node tools/official-content.mjs delete-pack --spec -
```

Every command prints one JSON object on stdout. Progress and diagnostics go to stderr.

## Images

- `images: "off"` writes text only.
- `images: "auto"` lets the app's figure planner attach exact diagrams where they help.
- `images: "on"` also asks for a visual on every eligible question.
- `image_max` bounds generated photos (not diagrams).
- `attachments` adds local SVG/PNG/JPEG/WebP/GIF/AVIF files to specific 1-based questions
  after generation.

## Verification

The tool was exercised against the live Supabase project: draft and published banks were
created, read back with the **publishable** key, validated with the plugin zod schema and
`buildOfficialPacks`, and then deleted together with their Storage objects. The management
route was exercised with `GET /catalog`, `POST create-pack`, `POST create-bank` and
`POST delete`; the Client bundle registered its `sidebar.panellist` and `main` entries in the
live page. Visual layout was not screenshot-verified in this session.

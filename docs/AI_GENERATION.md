# AI question generation

Since 0.6.1, AI generation runs behind a hosted API. The learner does not enter a provider key,
and the authoring prompt is never shipped in the browser bundle. The Worker holds the official keys
and calls GLM or DeepSeek; precise diagrams are drawn in the browser, and real scenes come from web
image search or the Cloudflare Workers AI free allocation.

For the HTTP contract and deployment steps, see [AI_API.md](./AI_API.md).

## Using Generate

Sign in first: AI generation is available to signed-in learners. A guest sees a sign-in gate.

1. Open **Generate**. At the top, the **Generation engine** panel lists the providers, text models and
   image models that `/api/ai/config` reports. Choose **Automatic**, or pick a provider, model and
   image model. The choice is saved immediately and applies to the next generation; there is no
   separate AI section in **Settings**.
2. Press **Refresh** if the server configuration changed. **Test connection** sends a tiny completion
   through the same API.
3. Add material or write a description, then pick the topic, count, difficulty, language, question
   types and (optionally) code language.
4. Press **Generate questions**. Progress is streamed from the API: batches, schema validation,
   duplicate removal, then visual planning and photos.
5. Press **Generate more** to add another run to the same draft. New questions are appended (exact
   duplicate prompts are skipped) instead of replacing the questions already on screen, so a deck can
   grow without a per-deck question cap. Use the trash button on a question, or **Delete all
   questions**, to trim the draft; **Save as deck** saves the selected questions. A short reply is
   topped up automatically, and a remaining shortfall is shown as a warning instead of silently
   saving fewer questions.
6. The draft lives in this tab's `sessionStorage`: it survives switching pages and reloading, and is
   cleared when the tab or browser closes or after the deck is saved. If inline images are too large
   for the storage quota, the questions are kept, the pictures are dropped, and a warning explains
   why. A run that stops early keeps the validated questions and shows the provider reason in a
   warning above the preview.

The provider and model are choices, not secrets. Provider keys, model base URLs and the prompt live
only in `apps/api` and in the Worker environment.

## Materials

| Property | Limit |
| --- | --- |
| Total uploaded files | **1 GB** |
| Text kept locally for generation | 32,000,000 characters |
| Text per file | 8,000,000 characters (truncated beyond that) |
| Text sent in one API request | **300,000 characters**, up to eight excerpts |
| File types | `.pdf`, `.docx`, `.pptx`, `.txt`, `.md`, `.markdown`, `.csv`, `.json` |

- Only text is read. Images inside PDFs and slides are never decoded, which is why a picture-heavy
  1 GB PDF is workable — and why a scanned PDF with no text layer is rejected (there is no OCR).
- The 1 GB budget is about uploaded file bytes. A single very large file still has to be read into
  memory, so split a 1 GB pack across a few files on a low-memory device.
- DOCX and PPTX are unzipped in the browser; no upload leaves the device except the bounded excerpt
  sent with the generation request.
- When the extracted text is larger than the API budget, `packMaterialsForApi` splits it into 180k
  parts, ranks them against the topic and keeps the most relevant parts (at most eight). The preview
  warns when excerpts were left out.
- Materials are removed automatically when a generation finishes successfully, including the persisted
  `ai-materials:v1` entry. Remove one earlier with the bin icon; a failed generation keeps the files
  so you can retry.
- Files are optional. A written **Description**, or a file whose whole content is only a short
  heading (under 200 characters), switches the request to **topic-brief mode**: the model writes
  general questions from widely accepted knowledge instead of pretending the brief is a source
  document. A short brief (for example `C++ coding`) is enough. A topic with no description is also
  accepted by the API.
- Topic-brief questions cannot cite a course page or invent institution-specific rules. For
  exam-specific material, attach the actual notes or slides so the questions stay grounded.
- `docs/samples/sample-lecture.pdf` is a tiny text-layer PDF you can use to try the flow.

## Generation

1. The API splits the material into ~7,000-character chunks on paragraph boundaries, scores chunks
   against the topic, and gives each batch a different window. A large deck covers several parts of
   the source instead of repeating the introduction.
2. Requests are capped at six questions per model call. Each call gets a completion budget sized to
   the provider — 32K tokens for GLM (up to its 128K ceiling) and 8K for DeepSeek — instead of a
   single small fixed cap. A reply that still hits the provider's output limit is split into two
   smaller calls automatically. `429`, `5xx` and network failures are retried with backoff; if a
   later batch still fails, the questions already generated are returned with a `partial` warning.
   The provider request is streamed, and **300 s** is an inactivity window (`AI_TIMEOUT_MS`, up to
   600 s): every received chunk resets it, so a reasoning model that keeps producing tokens may run
   longer than five minutes, while a silent connection still fails. While it runs, the SSE stream
   sends a keep-alive comment every 15 s and the Generate page rotates a "still working" line with an
   elapsed counter, so a slow batch does not look like a frozen tab.
3. Every question is normalised and re-validated with the plugin zod schema before it reaches a deck.
   Exact duplicates are always removed. Near-duplicate detection uses word/character bigrams, so
   Chinese questions that share a formulaic stem survive; invalid questions are dropped and reported
   in `warnings`.
4. If a batch reply is cut off or malformed, complete question objects are kept and only the missing
   count is requested again; a batch with no complete question is split. If the model returns fewer
   valid questions than requested, the API asks only for the missing ones (up to three top-up calls).
   A remaining shortfall is returned as a prominent warning.
5. `estimatedSeconds` on each question becomes the generated deck's whole-paper timer.
6. If visuals are enabled, the model may attach an optional `visual` object to a question:

   - `{"kind":"diagram","spec":{…},"alt":"…"}` — an exact figure the app draws itself.
   - `{"kind":"photo","prompt":"…","search":"…","alt":"…"}` — a real scene. A clue may use web image
     search; an ordinary illustration is rendered by the image model.
   - `{"kind":"none"}` — no picture.

   The figure registry classifies each finished question before planning (chart, function, flow,
   table, scene, unsupported). Diagrams that pass the worthiness gate and the registered assertions
   are attached immediately. Photo hints, scene clues, and (in `on` mode) eligible questions with no
   visual go through a planning pass that sees the finished question. In `auto` the planner may still
   skip a non-clue question. A failed planning call or photo is a warning, never a failed deck.

## Visuals

A question can carry one visual. The figure registry
(`apps/api/src/generation/figure-registry.ts`) is the router: it maps a figure family to an IR, the
renderers that can draw it, deterministic assertions and an ordered fallback. There are three tiers:

- **exact** — a chart, function, geometry, circuit, chemical structure, map, table or music figure.
  It must be drawn from structured data. It is never sent to a text-to-image model, because a
  plausible-looking wrong chart is worse than no chart.
- **structural** — a flowchart, tree, graph, pedigree, UML or architecture sketch. It is described
  as a graph or a table and laid out by the app.
- **scene** — a real place, person, organism, object or historical scene. A clue question
  (“guess the country”) uses web image search first, then only accepts a title/description match; if
  no reliable reference is found it gets no picture rather than an unrelated or generated guess. An
  ordinary illustrative scene skips web search and uses the image model, which is more controllable
  than a generic phrase search.

The registry now has **94 kinds, all with a renderer**: 71 `native`, 14 `approx` (schematic maps,
stylised apparatus, isometric 3D) and 9 `external` scenes; there is no `none` fallback left. A kind
is `approx` only when the drawing is deliberately schematic, and the badge is visible in the registry
and docs. `packages/core/src/renderers/` holds one renderer per family, and each renderer covers many
kinds:

| Renderer | Covers | Kinds |
| --- | --- | --- |
| `chart` | plots and data marks | 31 |
| `graph` | nodes, edges, trees, UML, ER, pedigrees | 15 |
| `map` | schematic maps, contours, cross-sections, routes | 8 |
| `molecule` | structures, reactions, crystals, orbitals | 5 |
| `apparatus` | lab glassware, optics, simple machines | 4 |
| `timeline` | timelines, Gantt, story arcs | 3 |
| `primitive` | functions, geometry, free-body, fields | 12 |
| `scene` | real photos (web search then generation) | 9 |
| `circuit`, `music`, `surface3d`, `table`, `code`, `formula` | one family each | 1/1/1/2/1/1 |

A new figure family should extend an existing renderer before adding a new one. The mapping is
declared once in `RENDERER_KINDS` in `figure-registry.ts`; the same table feeds the settings screen
and the coverage test, so it cannot drift from the routes.

### Diagrams (drawn by the app)

A diagram is a JSON document (`v: 1`) with 1–60 elements: primitives (`plot` for a formula in `x`,
`line`/`arrow`, `point`, `circle`, `polygon`, `arc`, `label`, `bar`, `pie`, `table`, `shape`) and
compound elements (`chart`, `graph`, `map`, `circuit`, `molecule`, `music`, `timeline`, `apparatus`,
`surface3d`, `code`, `formula`) on a cartesian plane or a 0–100 plain canvas.
`packages/core/src/figure.ts` validates the spec, evaluates plotted formulas and lays it out as SVG;
`apps/web/src/components/FigureView.tsx` renders it inline, themed with CSS variables.

A compound element is **data for one renderer**, not hand-placed pixels. The model writes categories,
values, nodes, edges, atoms or notes; the renderer owns the axes, layout, scales, symbols and text
placement. For example a bar chart is
`{"kind":"chart","variant":"bar","x":8,"y":10,"w":84,"h":72,"categories":["A","B"],"series":[{"name":"2024","values":[3,5]}]}`,
a class diagram is a `graph` with `"shape":"class"`, and a circuit is a list of `parts` plus
`wires`. Every compound element is rejected on a `cartesian` canvas, because it draws its own axes.

A `table` is a plain-canvas grid with up to 8 columns and 12 rows; it is the deterministic renderer
for truth tables, comparison tables and matrices. A `pie` is a plain-canvas chart with 2–12 positive
slices; the app computes the angles, so a model cannot make the wedges fail to sum to 100%.

A `map` is explicitly **schematic**: regions, routes, contours and cross-section layers are supplied
as 0–100 polygons, not survey coordinates. It is for a labelled sketch, not for a "which country is
this" question; that remains a photo clue. `apparatus`, `surface3d` and the schematic map are marked
`approx` in the registry.

Plain coordinates are percentages, but models sometimes write pixels; the parser detects any value
above 100 and converts the spec from pixels to percentages, and the renderer re-validates on display.
A triangle should be one closed `polygon`, not separate lines.

**Flowcharts are authored as a graph, not as placed boxes.** A diagram may carry a Mermaid document
instead of `elements`:

```json
{
  "kind": "diagram",
  "mermaid": "flowchart TD\n  A([開始]) --> B[讀取資料]\n  B --> C{資料有效？}\n  C -- 是 --> D[處理]\n  C -- 否 --> E([結束])\n  D --> E",
  "alt": "開始、讀取資料、判斷、處理、結束"
}
```

`packages/core/src/flow.ts` parses the supported subset (`flowchart TD|LR`, `[]`, `()`, `([])`,
`{}`, `[//]`, `(())`, `-->`, `---`, `-.->`, `==>` and `|label|` / `-- label -->`) and computes a
layered layout: longest-path layers, barycentre ordering, node widths from their text, and back,
same-layer and skip-layer edges routed around the nearest outside edge (left/right for TD, top/bottom
for LR). Choosing the source node's near side is what stops a loop from running horizontally through
a sibling node on its own row. The same graph can be sent as JSON
(`{"flow":{"direction":"TD","nodes":[…],"edges":[…]}}`), and a bare Mermaid string is accepted too.
The result is still a `v: 1` spec of ordinary `shape`, `line` and `label` elements, so stored decks,
the renderer and themes are unchanged. `subgraph`, styling, icons, HTML labels and a graph with no
edges are rejected rather than half-drawn. A hand-placed `shape` element remains available for an
annotated layout that Mermaid cannot express, but a process or decision flow should use Mermaid.

The title is an HTML caption above the SVG, so it cannot overlap a node.

### Photos and web image search

For a real place, object, organism or historical scene the planner may add a `search` query. The API
tries Wikimedia Commons first (`IMAGE_SEARCH=wikimedia`, the default; `off` disables it). A hit is
downloaded to a data URL, stored with its author, licence and file page, and shown with a small
attribution line. A miss falls back to the image model (`@cf/black-forest-labs/flux-1-schnell` by
default); `IMAGE_SEARCH_TIMEOUT_MS` and `IMAGE_SEARCH_LIMIT` tune the search. A file without a known
licence is rejected.

Some questions are **scene clues**: "guess the country", "which organelle is shown", "what curve is
this". The picture is the thing to identify, so it may depict the answer; only text that names the
answer is forbidden. The planner is told this, and the vision check uses a clue-aware prompt.

### Accuracy and attestation

- **Registry assertions.** A chart must contain data marks, a flow must contain arrows, a table must
  contain cells, and a scene photo must have a usable brief; a web photo must have a licence and
  attribution. A figure that fails is dropped with a warning.
- **Answer-leak check.** Before a diagram is attached, any label that repeats the correct option, a
  fill/short answer or a boolean value is removed; a figure or table whose only content was the
  answer is dropped. A compound element is all-or-nothing: if one chart category, graph node, map
  label or molecule atom repeats the answer, the whole element is dropped so the learner never sees
  a half-erased picture. The same check keeps an answer out of a photo's `alt` text.
- **A visual-worthiness gate.** Before the planner is called, a deterministic check drops questions
  whose answer is a flowchart shape (rectangle, diamond, ellipse, parallelogram, rounded) and
  questions that ask what a shape or symbol represents. A diagram that is a single unconnected node,
  or a plain canvas of unconnected symbols, is dropped as decoration; a figure whose node is the
  shape named by the answer is dropped even if the author attached it. Questions that explicitly
  refer to a figure ("圖中", "shown", "the diagram below") are exempt, because the figure is then
  part of the question. The gate applies in `auto` and `on` modes.
- **Multimodal check.** If `GLM_VISION_MODEL` / `DEEPSEEK_VISION_MODEL` is configured, each finished
  photo is sent back with the question and answer; an explicit `{"matches": false}` drops it. For a
  scene clue the check allows the picture to depict the subject and only rejects an unrelated image
  or one with text naming the answer. `AI_VERIFY_IMAGES=off` disables the check.
- **Attestation.** With `IMAGE_SIGNING_KEY` / `IMAGE_VERIFY_KEY`, the API signs the SHA-256 of every
  photo with ECDSA P-256; the browser verifies it before upload and before display. Diagrams are data
  and never uploaded, so they need no attestation.

A deck has no separate visual cap beyond one per question, and **Generate more** can keep adding.
Photos count toward the 30 MB budget; diagrams add no Storage object. Saving can fail with a quota
message after a photo-heavy generation. Photos are stored byte-for-byte when attested; unattested
images are re-encoded as WebP (long edge 1280 px) when the browser supports it.

Visuals are illustrative, not a source of truth. Check a generated picture before relying on it.

## Privacy

- Provider keys are Worker secrets and never reach the browser.
- Material is parsed on the device. Only a bounded excerpt, the topic, description and settings are
  sent to the API for that request.
- The API does not store prompts, materials or generated decks. A generated deck is persisted only
  when the learner chooses **Save**, and then only in their own cloud account. Diagram specs are part
  of the deck JSON; photos go to a private Storage bucket.
- A scene photo search sends only the internal search query to Wikimedia Commons. For a clue question
  that query may name the answer, but it carries no learner identity, material or deck. Set
  `IMAGE_SEARCH=off` to disable this request; scenes then use the image model or are omitted.
- In the `AI_MOCK=1` demo mode, questions and images are placeholders and no provider is contacted.

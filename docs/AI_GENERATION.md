# AI question generation

Version 0.5.1 lets a learner turn course material or a written description into a MengYin Study deck using their own
OpenAI-compatible API. The app ships no key and has no proxy: requests go from the browser (or the
desktop shell) straight to the endpoint configured in **Settings → AI question generation**.

## Setup

Sign in first: API keys and AI generation are account settings. A guest sees a sign-in gate on both
**Generate** and the AI panel in **Settings**.

1. Open **Settings → AI question generation**.
2. Fill in:
   - **API base URL** — include the version path, e.g. `https://api.openai.com/v1` or
     `https://api.deepseek.com/v1`.
   - **API key** — stored only in this browser's IndexedDB. Leave empty for a local server that does
     not need a key.
   - **Model** — e.g. `gpt-4o-mini`, `deepseek-chat`, or a local model name.
   - **Max reply tokens** — the completion budget for one batch, 4096 by default. Code-heavy decks
     may need 8192 or more; the app splits a batch automatically when this limit is reached.
3. Press **Save AI settings**, then **Test connection** (it sends a tiny eight-token chat).
4. Open **Generate** in the sidebar.

The key is deliberately **not** part of the JSON backup export, and it is never written to logs or
sent anywhere except the configured endpoint. Removing site data removes it.

### Providers and CORS

Any endpoint that implements `POST {baseUrl}/chat/completions` works. The provider must allow
requests from a browser origin; OpenAI, DeepSeek, OpenRouter, Groq, LM Studio (with CORS enabled) and
Ollama's OpenAI-compatible endpoint generally do. If the browser reports a CORS error, use a provider
that allows browser requests, or run the desktop app against a local server that sets CORS headers.
The app cannot bypass CORS because it has no backend.

### JSON mode

**Ask for JSON mode** sends `response_format: { "type": "json_object" }`. If a provider rejects that
field, the app retries once without it automatically; you can also turn it off up front. The reply is
parsed defensively (code fences, a sentence before the object, and trailing commas are tolerated).

## Materials

| Property | Limit |
| --- | --- |
| Total uploaded files | **1 GB** |
| Text kept for generation | 32,000,000 characters |
| Text per file | 8,000,000 characters (truncated beyond that) |
| File types | `.pdf`, `.docx`, `.pptx`, `.txt`, `.md`, `.markdown`, `.csv`, `.json` |

- Only text is read. Images inside PDFs and slides are never decoded, which is why a picture-heavy
  1 GB PDF is workable — and why a scanned PDF with no text layer is rejected (there is no OCR).
- The 1 GB budget is about uploaded file bytes. A single very large file still has to be read into
  memory, so split a 1 GB pack across a few files on a low-memory device.
- Text retained for generation is capped at 8 M characters per file and 32 M in total; the Materials
  list marks a file as truncated when it hits the cap.
- DOCX and PPTX are unzipped in the browser; no upload leaves the device except the excerpts sent to
  the model.
- Materials are removed automatically when a generation finishes successfully, including the persisted
  `ai-materials:v1` entry. Remove one earlier with the bin icon to free budget; a failed generation
  keeps the files so you can retry.
- Files are optional. A written **Description**, or a file whose whole content is only a short
  heading (under 200 characters), switches the request to **topic-brief mode**: the model writes
  general questions from widely accepted knowledge of the topic instead of pretending the brief is a
  source document. A short brief (for example `C++ coding`) is enough. The old 40-character minimum
  was removed; only a whitespace-only file is rejected.
- Topic-brief questions cannot cite a course page or invent institution-specific rules. For
  exam-specific material, attach the actual notes or slides so the questions stay grounded.
- `docs/samples/sample-lecture.pdf` is a tiny text-layer PDF you can use to try the flow.
- The app splits long material into ~7,000-character chunks on paragraph boundaries, scores chunks
  against the topic, and gives each generation batch a different window. A large deck is therefore
  covered in several calls rather than truncated to the first page.

## Generation

1. Choose a topic (or let the first line of the description become the topic), question count (1–30),
   difficulty, language, and one or more question types. Requests are sent in batches of at most six
   questions, even when the material is a single short chunk.
2. Optionally add a description and a focus note ("chapter 4 only", "emphasise recursion"). With no
   attached file, or only a short heading, the description is a **topic brief**: the model uses general
   knowledge of the topic.
3. Press **Generate questions**. The page shows batch progress and a cancel button.
4. The system prompt is the versioned [question authoring skill](QUESTION_AUTHORING_SKILL.md).
5. Every returned question is validated with the plugin schema. Invalid questions are dropped,
   duplicates are removed, and a malformed reply is asked for once more. If the provider stopped at
   its output-token limit, the app splits that batch in half and retries the smaller request instead
   of asking for the same oversized reply again.
6. Review the preview, untick anything you do not want, and **Save as deck**. Saving requires an
   account: the deck is written to the private `user_decks` table and cached in IndexedDB for that
   account, so it is visible on other signed-in devices and hidden while signed out. Imported folder
   or JSON decks upload automatically in the same background pass. Generated and imported decks can
   be removed from **Decks** or **Plugins**; that deletes the cloud row and local copy.

Warnings in the preview are advisory: a shortfall means the model could not support the requested
number of questions, not that anything was lost. In topic-brief mode the model is explicitly told
that a short brief is enough and that general knowledge is the intended source.

## Exam length

The model gives every question an `estimatedSeconds` budget (about 20–90 for recall, 90–180 for a
multi-step problem, 180–600 for a short answer or code). The app sums those budgets into the deck's
`examMinutes`, so an AI-generated exam is timed by the model's view of its own questions. A missing
or malformed estimate falls back to a type-and-difficulty estimate. Official decks publish their own
`examMinutes`; decks with neither are estimated the same way. There is no app-wide fixed test length.

## Topic-brief mode

When the Materials list is empty, or every file is only a short heading (under 200 characters), the
brief is sent inside a `<brief>` block and the request starts with `Source mode: topic brief`. The
authoring skill then allows well-established general knowledge of the topic. It still forbids
pretending to quote a document, naming a page or institution, or inventing course-specific rules. For
exam-specific revision, attach the real notes, slides or code samples; then the normal
material-grounded mode is used instead.

## Code questions

When **code** is one of the selected question types, the model may add at most one per batch, and
only for material that involves code or algorithms. The Generate page also has a **Code language**
choice (JavaScript, TypeScript, Python, SQL, Java or C++) that is passed to the model. A code
question is a program in that language with one or more blanks:

- one `{{blank}}` for a single expression or statement;
- 2–6 named `{{blank:name}}` blanks, with a label and model answer for each — useful for loop headers,
  conditions and steps;
- `layout: "body"` with one blank, where the question supplies the function signature and braces and
  the learner writes the entire body of `main()`.

The authoring skill instructs the model to produce all three shapes and to provide a solution for
every blank. A code question must be self-documenting: if a solution uses the runner-provided
`input`, at least one test must provide `input` (or the template must declare it), and the practice
UI shows that declaration above the blank. Generation drops a code question whose solution uses
`input` without showing its value; older decks that already contain one display a warning instead of
silently running incomplete code. Execution rules are unchanged:

- **Practice-type sessions** (Practice, Muscle memory, Spaced review, Mistakes, Random) show a Run
  button, execute each test in an isolated sandbox, and grade from the observed stdout.
- **Exam mode never executes code.** The Run button is hidden, the question shows an exam notice, and
  the answer is recorded as-is. Submitting the paper marks code questions as skipped (like short
  answer questions) and shows the model solution in the results review.
- The sandbox is a worker inside a sandboxed iframe with `default-src 'none'`, no network, no DOM, no
  storage, and a per-test timeout (default 3 s, configurable up to 10 s by the question author).
  A runaway loop is terminated without freezing the app. This is a study aid, not a guarantee
  against hostile code; only run decks you trust.

JavaScript, TypeScript, Python, SQL, Java and C++ are supported. Python, SQL and Java run on
WebAssembly runtimes shipped with the static build; C++ uses the JSCPP interpreter. Generated code
questions therefore execute locally with no server. SQL is SQLite: schema and rows belong in a SQL
`input` string, and a `SELECT` prints `a | b` rows. Java and C++ take a `stdin` string instead of a
JSON `input`; their templates are complete `Main` / `main` programs that read standard input.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Authentication failed (401)` | Wrong key, or a key from a different provider. |
| `No API at this URL (404)` | The base URL is missing `/v1` (or the provider's version path). |
| `Could not reach the API` | Network, wrong host, or CORS: the provider must allow browser requests. |
| `Rate limited or out of quota (429)` | Wait, lower the question count, or check the account balance. |
| `The reply is not valid JSON` | The model ignored JSON mode; try a stronger model, or turn JSON mode on. |
| `The JSON in the reply is incomplete` / `cut off at its output limit` | The provider hit its completion cap. The app retries with a smaller batch automatically; if even one question is cut off, raise **Max reply tokens** in Settings or use a model with a larger output limit. |
| `none passed validation` | The model returned the wrong shape; the first validation issue is shown. |
| `Only 1 of 10 ... generated` | The model refused to go beyond a thin brief. Use a description or a short heading file to trigger topic-brief mode, or attach notes for material-grounded questions. |
| `This PDF has no readable text layer` | Scanned images. Use a text-based PDF, DOCX, PPTX or pasted text file. |
| Generation is slow | Each batch is a separate request; 30 questions means up to five calls. |

## Privacy summary

| Data | Where it lives | In backups? |
| --- | --- | --- |
| API base URL, key, model | IndexedDB `ai-config:v1` | No |
| Material text | IndexedDB `ai-materials:v1` | No |
| Generated decks | Supabase `user_decks` (owner-only) + IndexedDB cache | Cached local copy yes; cloud row no |
| Progress, attempts, notes | Supabase `user_progress` (owner-only) + local `progress:v2:*` cache (the old `progress:v1` is claimed once) | Yes |

Requests contain the selected excerpts, the topic and the requested settings. Do not add material
you are not allowed to send to your chosen provider.

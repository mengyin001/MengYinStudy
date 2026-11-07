# Plugin guide

Plugins add **functionality** to MengYin Study: question types, importers and runtime hooks.
**Decks are content, not plugins.** Official decks are published to the Plaza; a learner's own decks
live in their library. The loader still accepts deck files in a local plugin folder for backwards
compatibility, but a new feature plugin should normally ship an `entry` module and no `content`.

A plugin is a folder with a `manifest.json` and an optional `index.js`:

```
plugins/my-plugin/
├─ manifest.json          # required: plugin metadata
├─ index.js               # optional: register question types / importers
└─ assets/…               # optional: assets used by the module
```

Deck JSON lives in the Plaza/import path, not in a feature plugin:

```
plugins/legacy-pack/      # still supported for local/import compatibility
├─ manifest.json
└─ decks/week1.json
```

Interfaces (buttons, labels, statistics) are translated by the app; **deck content stays in whatever
language you write it in**. The starter decks are Traditional Chinese; the UI defaults to English.

## manifest.json

```json
{
  "schemaVersion": 1,
  "id": "example.calculus",
  "name": "Calculus review",
  "version": "1.0.0",
  "description": "Limits, continuity and derivatives.",
  "author": "Your name",
  "homepage": "https://example.com",
  "license": "MIT",
  "tags": ["Calculus"],
  "content": ["./decks/*.json"],
  "entry": "./index.js",
  "questionTypes": [
    { "id": "numeric", "label": "Numeric answer", "rendererKind": "number" }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `schemaVersion` | – | Currently `1` (default). |
| `id` | ✔ | Globally unique: letters, digits, `.`, `_`, `-`; must start with a letter or digit; ≤ 64 chars. |
| `name` | ✔ | Display name. |
| `version` | ✔ | Semantic version, display only. |
| `description` / `author` / `homepage` / `license` | – | Shown on the Plugins page. |
| `tags` | – | Plugin-level tags. |
| `content` | – | Legacy/import support: deck files relative to the plugin folder. Leave empty for a functionality-only plugin. |
| `entry` | – | Optional ES module; `activate(ctx)` is called after loading. |
| `questionTypes` | – | Display metadata only; real registration happens in `index.js`. |
| `minAppVersion` | – | Reserved. |

## Deck format

```json
{
  "id": "week1",
  "title": "Week 1: limits",
  "description": "Lecture examples and past-paper questions.",
  "tags": ["Limits"],
  "questions": [
    {
      "id": "limit-1",
      "type": "single",
      "prompt": "What is lim(x→2) (x² − 4)/(x − 2)?",
      "options": [
        { "id": "a", "text": "0" },
        { "id": "b", "text": "4" },
        { "id": "c", "text": "Does not exist" }
      ],
      "answer": { "kind": "single", "optionId": "b" },
      "explanation": "Factor the numerator: (x−2)(x+2), cancel, substitute x = 2 to get 4.",
      "hint": "Factor first.",
      "tags": ["Limits", "Factorising"],
      "difficulty": 2,
      "source": "2023 final, Q3"
    }
  ]
}
```

`deck.id` only has to be unique inside the plugin; internally the app uses `pluginId::deckId` and
`pluginId::deckId#questionId`.

Add an optional `"examMinutes": 40` (1–600) to declare the whole-paper exam countdown. Without it the
app estimates the length from question type and difficulty; a manually authored `meta.estimatedSeconds`
on a question overrides that question's share of the estimate.

### Question fields

| Field | Required | Notes |
| --- | --- | --- |
| `id` | ✔ | Unique in the deck. Progress and scheduling are keyed by it — **changing it resets that question's history**. |
| `type` | – | Defaults to `single`. Built-in ids or a plugin type id. |
| `prompt` | ✔ | Question text; line breaks are preserved. |
| `options` | for choice types | `[{ "id": "a", "text": "…" }]`, at least two, ids unique. |
| `answer` | ✔ | See below. |
| `explanation` | – | Shown after submitting. |
| `hint` | – | Expandable before answering. |
| `tags` | – | Used by statistics and mastery. |
| `difficulty` | – | 1–5, default 2. |
| `points` | – | Reserved. |
| `source` | – | Shown for reference. |
| `media` | – | `[{ "type": "image", "src": "…", "alt": "…" }]` or `[{ "type": "figure", "figure": {...}, "alt": "…" }]`; see [Images](#images). |
| `meta` | – | Free-form JSON for plugin question types (e.g. `tolerance`); `estimatedSeconds` sets this question's exam-time budget. |

### Answer shapes

| Type | `answer` |
| --- | --- |
| `single` | `{ "kind": "single", "optionId": "b" }` |
| `multi` | `{ "kind": "multi", "optionIds": ["a", "c"] }` — exact match is correct, a correct subset is partial credit |
| `boolean` | `{ "kind": "boolean", "value": true }` |
| `fill` | `{ "kind": "fill", "accept": ["1024", "1 KiB"] }` — case, full-width characters and extra spaces are ignored; add `"ignoreCase": false` to keep case |
| `short` | `{ "kind": "short", "model": "Model answer…", "keywords": ["…"] }` — self-graded |
| `code` | `{ "kind": "custom", "value": {} }` — the model solution and tests live in `meta.code`; see [Code questions](#code-questions) |
| custom type | `{ "kind": "custom", "value": <any JSON> }` |

> `type` and `answer.kind` must agree (`single` ↔ `single`, `code` ↔ `custom`, and so on).
> Mismatches are rejected by zod and reported on the Plugins page instead of breaking the session.

## Images

A question can carry a figure, and so can each option:

```json
{
  "id": "vis-hypotenuse",
  "type": "single",
  "prompt": "What is the length of the hypotenuse, in centimetres?",
  "media": [{ "type": "image", "src": "./assets/triangle.svg", "alt": "Right triangle with legs 3 cm and 4 cm" }],
  "options": [
    { "id": "a", "text": "5 cm" },
    { "id": "b", "text": "7 cm" }
  ],
  "answer": { "kind": "single", "optionId": "a" }
}
```

Options take the same `media` array:

```json
{
  "id": "c",
  "text": "Figure C",
  "media": [{ "type": "image", "src": "./assets/tri-obtuse.svg", "alt": "Obtuse triangle" }]
}
```

How `src` is resolved:

| `src` | Behaviour |
| --- | --- |
| `./assets/x.svg`, `assets/x.svg`, `img/x.png` | Resolved against the plugin folder — `plugins/<dir>/assets/x.svg` — so a deck can ship its own pictures. |
| `https://…` | Used as-is. |
| `data:image/…` | Used as-is (handy for a single-file deck). |
| `/…` | Used as-is, relative to the host. |

Notes:

- Preferred formats are SVG and PNG. SVG keeps diagrams crisp at any size and stays tiny.
- Give every image an `alt`; it is used as the accessible name.
- Prompt images render at most 320 px tall, option images at most 104 px, both scaled proportionally.
- Images imported through **Import folder** live in memory rather than on a URL, so relative paths
  cannot resolve there — use `data:` URIs for locally imported packs.
- Put the images in the plugin's own `assets/` folder and keep the `src` relative (`./assets/x.svg`);
  the app resolves it against the plugin directory.

### Figures

A visual can also be a **figure**: a declarative spec the app draws itself, with no image file. AI
generation uses this for exact diagrams, and a plugin may use it too:

```json
"media": [
  {
    "type": "figure",
    "alt": "y = x²",
    "figure": {
      "v": 1,
      "coords": "cartesian",
      "x": { "min": -2, "max": 2 },
      "y": { "min": 0, "max": 4 },
      "grid": true,
      "elements": [{ "kind": "plot", "expr": "x^2" }]
    }
  }
]
```

A flowchart can be described as a graph instead of hand-placed boxes. The app parses a small Mermaid
subset, lays out the nodes and routes the arrows:

```json
"media": [
  {
    "type": "figure",
    "alt": "開始、處理、結束",
    "figure": {
      "v": 1,
      "mermaid": "flowchart TD\n  A([開始]) --> B[處理]\n  B --> C([結束])"
    }
  }
]
```

`flowchart TD` and `flowchart LR` are supported; node shapes use `A[process]`, `A(start)`,
`A([start/end])`, `A{decision}`, `A[/input/output/]` and `A((connector))`; edges use `-->`, `---`,
`-.->`, `==>`, `|label|` or `-- label -->`. Up to 12 nodes and 16 edges. The same graph may be sent
as `{"flow":{"direction":"TD","nodes":[…],"edges":[…]}}`, and a bare Mermaid string is accepted in
place of `figure`. JSON nodes accept `shape` names `rect`, `rounded`, `diamond`, `ellipse` and
`parallelogram`, plus semantic aliases such as `process`, `decision`, `terminator`, `input`, `output`
and `connector`. The compiled result is still a `v: 1` spec of ordinary elements.

A **table** is a plain-canvas element, so row and column alignment is owned by the renderer rather
than by hand-placed lines. Use it for truth tables, comparisons and matrices:

```json
"elements": [
  {
    "kind": "table",
    "x": 10,
    "y": 20,
    "w": 80,
    "h": 40,
    "columns": ["P", "Q", "P ∧ Q"],
    "rows": [["T", "T", "T"], ["T", "F", "F"], ["F", "T", "F"]],
    "header": true
  }
]
```

### Compound figure elements

A chart, graph, map, circuit, molecule, staff, timeline, apparatus, 3-D surface, code block or
formula is one semantic element. The data is small and the renderer owns the geometry, so a plugin
does not need to compute coordinates:

```json
"elements": [
  {
    "kind": "chart",
    "variant": "bar",
    "x": 8, "y": 10, "w": 84, "h": 72,
    "categories": ["A", "B"],
    "series": [{ "name": "2024", "values": [3, 5] }],
    "xLabel": "group", "yLabel": "count"
  }
]
```

The same pattern covers `graph` (nodes/edges, layouts `layered`, `tree`, `radial`, `network`; shapes
`class`, `entity`, `person`), `map` (schematic regions, routes, contours, cross-sections), `circuit`
(parts and wires), `molecule` (atoms/bonds, reaction, crystal, orbital), `music` (pitches and
durations), `timeline` (events or Gantt tasks), `apparatus` (lab/optics/simple-machine parts),
`surface3d` (z-grid or point cloud), `code` and `formula`. Each element has a plain-canvas frame
`x`/`y`/`w`/`h` in 0–100 percentages.

The full grammar is in `docs/AI_GENERATION.md` and `apps/api/src/generation/figure-skill.ts`:
`plot`, `line`, `point`, `circle`, `polygon`, `arc`, `label`, `bar`, `pie`, `table`, `shape` (a
manually placed node), the compound elements above, and `mermaid`/`flow` (a graph laid out by the
app), 1–60 elements. The spec is validated on load; labels are rendered as text, so they are sharp
and accessible. Formulas are interpreted, never executed as JavaScript.

## Code questions

A code question is a complete program with one or more blanks, written in JavaScript, TypeScript,
Python, SQL, Java or C++. The app composes the template with the learner's snippets and runs it
inside the browser sandbox; grading compares the printed output with each test's `expect`. No
execution server is involved, so the same plugin works on a static host such as Cloudflare Pages.

Three shapes are supported:

- **Single inline blank** — one `{{blank}}` for an expression or statement. Use `solution`.
- **Multiple inline blanks** — 2–6 unique `{{blank:name}}` markers; give each a label in `blanks` and
  a model snippet for every id in `solutions`. Do not mix `{{blank}}` with named markers.
- **Whole body** — `"layout": "body"` with exactly one blank. The template supplies the signature and
  braces; `solution` is the entire body the learner should write.

### Languages

| `language` | Runtime | Prints with | Test `input` |
| --- | --- | --- | --- |
| `javascript` (default) | Browser engine | `console.log` | JSON value exposed as `input` |
| `typescript` | Sucrase strips types, then the browser engine | `console.log` | JSON value exposed as `input` |
| `python` | Pyodide (CPython in WebAssembly) | `print()` | JSON value exposed as `input` |
| `sql` | sql.js (SQLite in WebAssembly) | a `SELECT` result | SQL string: `CREATE TABLE` / `INSERT` statements |
| `java` | javac + TeaVM (WebAssembly) | `System.out.println` | `stdin` string (Scanner / System.in) |
| `cpp` | JSCPP interpreter | `cout` | `stdin` string (`cin`) |

Everything runs locally in the learner's browser. JavaScript/TypeScript use the browser's own
engine; Python and SQL download their runtime once (about 12 MB and 0.7 MB respectively) and then
reuse the cached copy. The pack ships no execution server and needs no network at question time.

TypeScript is syntax-only: type annotations are removed and never checked, so questions should be
about runtime behaviour. Python uses the standard library only — no `pip`, `numpy`, file I/O or
network. SQL is SQLite: `input` is a string of SQL statements rather than a variable, and a `SELECT`
prints its rows in a fixed `a | b` format.

A short Python question:

```json
{
  "type": "code",
  "prompt": "Fill in the expression that sums every number in input.",
  "answer": { "kind": "custom", "value": {} },
  "meta": {
    "code": {
      "language": "python",
      "template": "print(sum({{blank}}))",
      "blankLabel": "sequence that sums input",
      "solution": "input",
      "tests": [{ "name": "sample", "input": [4, 7, 2], "expect": "13" }]
    }
  }
}
```

A short SQL question (the test's `input` creates the fixture):

```json
{
  "type": "code",
  "prompt": "Fill in the columns that list each student's name and score.",
  "answer": { "kind": "custom", "value": {} },
  "meta": {
    "code": {
      "language": "sql",
      "template": "SELECT {{blank}} FROM students ORDER BY id;",
      "blankLabel": "column list",
      "solution": "name, score",
      "tests": [
        {
          "name": "sample",
          "input": "CREATE TABLE students (id INTEGER, name TEXT, score REAL); INSERT INTO students VALUES (1, 'Ada', 91), (2, 'Bob', 78);",
          "expect": "name | score\nAda | 91\nBob | 78"
        }
      ]
    }
  }
}
```

SQL output is one block per statement that returns rows: the column names joined by ` | `, then a
line per row with cells joined by ` | ` and nulls printed as `NULL`. Multiple result sets are
separated by a blank line. Use `ORDER BY` whenever row order matters.

Java and C++ questions use `tests[].stdin` instead of a JSON `input`, because neither language has a
universal JSON value type. The test text is fed to `System.in` / `cin`, and the program prints its
answer to stdout. Java must define `public class Main` with `public static void main(String[] args)`;
C++ must define `int main()`.

A short Java question:

```json
{
  "type": "code",
  "prompt": "Fill in the loop that reads n numbers and adds them to sum.",
  "answer": { "kind": "custom", "value": {} },
  "meta": {
    "code": {
      "language": "java",
      "template": "import java.util.Scanner;\npublic class Main {\n  public static void main(String[] args) {\n    Scanner sc = new Scanner(System.in);\n    int n = sc.nextInt();\n    int sum = 0;\n    {{blank}}\n    System.out.println(sum);\n  }\n}",
      "blankLabel": "loop that reads and sums n numbers",
      "solution": "for (int i = 0; i < n; i++) sum += sc.nextInt();",
      "tests": [{ "name": "sample", "stdin": "3\n1 2 3", "expect": "6" }]
    }
  }
}
```

A short C++ question (JSCPP subset):

```json
{
  "type": "code",
  "prompt": "Fill in the loop that reads n numbers from cin and adds them to sum.",
  "answer": { "kind": "custom", "value": {} },
  "meta": {
    "code": {
      "language": "cpp",
      "template": "#include <iostream>\nusing namespace std;\nint main() {\n  int n; cin >> n;\n  int sum = 0;\n  {{blank}}\n  cout << sum << endl;\n  return 0;\n}",
      "blankLabel": "loop that reads and sums n numbers",
      "solution": "for (int i = 0; i < n; i++) { int x; cin >> x; sum += x; }",
      "tests": [{ "name": "sample", "stdin": "3\n1 2 3", "expect": "6" }]
    }
  }
}
```

C++ runs on JSCPP, a teaching interpreter: `iostream` (`cin`, `cout`, `endl`), `cmath`, `cctype`,
`cstring`, `cstdio`, `cstdlib`, arrays, loops, functions, pointers, structs and basic classes work.
Full STL containers, templates, exceptions, threads and C++20/23 library features do not. Java runs
on javac + TeaVM with a substantial standard library, but avoid threads, reflection, files, network
and UI toolkits.

Single blank:

```json
{
  "id": "sum-array",
  "type": "code",
  "prompt": "Fill in the one expression that returns the sum of every number in the array input.",
  "answer": { "kind": "custom", "value": {} },
  "explanation": "reduce walks the array once, carrying a running total that starts at 0.",
  "tags": ["Arrays", "reduce"],
  "difficulty": 2,
  "meta": {
    "code": {
      "language": "javascript",
      "template": "const total = {{blank}};\nconsole.log(total);",
      "blankLabel": "expression that sums input",
      "solution": "input.reduce((sum, n) => sum + n, 0)",
      "timeoutMs": 3000,
      "tests": [
        { "name": "sample", "input": [4, 7, 2], "expect": "13" },
        { "name": "empty", "input": [], "expect": "0" }
      ]
    }
  }
}
```

Six named blanks (two nested `for` headers):

```json
{
  "id": "nested-for",
  "type": "code",
  "prompt": "Fill in the six blanks so the nested loops visit every cell of a rows × cols grid.",
  "answer": { "kind": "custom", "value": {} },
  "explanation": "The outer loop walks rows; the inner loop walks columns.",
  "tags": ["Loops"],
  "difficulty": 3,
  "meta": {
    "code": {
      "language": "javascript",
      "template": "let count = 0;\nfor ({{blank:iInit}}; {{blank:iCond}}; {{blank:iStep}}) {\n  for ({{blank:jInit}}; {{blank:jCond}}; {{blank:jStep}}) {\n    count += 1;\n  }\n}\nconsole.log(count);",
      "blanks": [
        { "id": "iInit", "label": "outer init" },
        { "id": "iCond", "label": "outer condition" },
        { "id": "iStep", "label": "outer step" },
        { "id": "jInit", "label": "inner init" },
        { "id": "jCond", "label": "inner condition" },
        { "id": "jStep", "label": "inner step" }
      ],
      "solutions": {
        "iInit": "let i = 0",
        "iCond": "i < input.rows",
        "iStep": "i++",
        "jInit": "let j = 0",
        "jCond": "j < input.cols",
        "jStep": "j++"
      },
      "tests": [
        { "name": "2x3", "input": { "rows": 2, "cols": 3 }, "expect": "6" },
        { "name": "0x5", "input": { "rows": 0, "cols": 5 }, "expect": "0" }
      ]
    }
  }
}
```

Whole function body:

```json
{
  "id": "main-body",
  "type": "code",
  "prompt": "Write the entire body of main so it prints the sum of the numbers in input.",
  "answer": { "kind": "custom", "value": {} },
  "explanation": "The body runs inside main; reduce folds the array from 0.",
  "tags": ["Functions"],
  "difficulty": 2,
  "meta": {
    "code": {
      "language": "javascript",
      "layout": "body",
      "template": "function main() {\n  {{blank}}\n}\nmain();",
      "blankLabel": "body of main()",
      "solution": "const total = input.reduce((sum, n) => sum + n, 0);\nconsole.log(total);",
      "tests": [
        { "name": "sample", "input": [1, 2, 3], "expect": "6" },
        { "name": "empty", "input": [], "expect": "0" }
      ]
    }
  }
}
```

| `meta.code` field | Required | Notes |
| --- | --- | --- |
| `language` | – | `javascript` (default), `typescript`, `python`, `sql`, `java` or `cpp`. |
| `template` | ✔ | Complete program with one `{{blank}}`, 2–6 unique `{{blank:name}}`, or one body blank. |
| `layout` | – | `inline` (default) or `body` (one blank, large editor). |
| `blankLabel` | – | Short label for a single blank. |
| `blanks` | – | `[{ "id": "iInit", "label": "outer init" }]`; every id must exist in the template. |
| `solution` | for one blank | Model snippet for a single blank. |
| `solutions` | for several blanks | Object keyed by blank id; required for every blank. |
| `tests` | ✔ | 1–20 cases. Each has `expect` (exact stdout) and optionally `name`, `setup`, `input`. |
| `timeoutMs` | – | 500–10,000; defaults to 3,000 per case. |

Blank names use 1–32 letters, digits, underscores or hyphens. Marker rules are validated when the
plugin loads: no duplicate names, no mixing named and unnamed markers, at most six blanks, and a
model solution for every id.

How a test runs: `setup` statements, then the `input` prelude, then the template with every blank
filled. The prelude is `const input = <json>` for JavaScript/TypeScript, `input = <literal>` for
Python, and the raw SQL string for SQL. Java and C++ receive `stdin` instead. Output is compared
after normalising line endings and trailing spaces.

Execution rules:

- Practice-type sessions (everything except **Exam**) show **Run**, execute each test in an isolated
  worker with no network, and grade from the recorded stdout.
- **Exam mode never runs code.** The Run control is hidden and the question is marked as skipped on
  submission; the model solution still appears in the review.
- A timeout or a thrown error fails that test; other tests still run. A runtime worker that times out
  is terminated and a fresh one is used for the remaining tests, so one infinite loop cannot hang the
  rest of the batch. Java questions get at least a 20-second effective budget because javac + TeaVM
  compile on the first run; `timeoutMs` still tunes shorter-running languages.
- Keep templates deterministic. No imports, DOM, network, timers, randomness or dates. Python uses
  standard-library CPython; SQL is SQLite; Java is compiled by javac and TeaVM; C++ is interpreted
  by JSCPP. TypeScript is transpiled without type checking.

### Runtime assets for a static host

JavaScript and TypeScript need no extra assets. Python, SQL and Java load WebAssembly runtimes from
`apps/web/public/runtimes/`, and C++ loads a small compiled JSCPP bundle. `npm run runtimes:fetch`
copies or builds them from the installed Pyodide, sql.js, `@live-codes/java-wasm` and `JSCPP`
packages before `dev` and `build`. The folder is generated and gitignored. Java is the largest at
about 8 MB; C++ is about 0.4 MB.

On a static host the runtime files must be served with `Access-Control-Allow-Origin: *` because the
sandbox iframe has an opaque origin. The Cloudflare Pages `_headers` file in
`apps/web/public/_headers` does this, and `tools/serve-dist.mjs` does the same for local previews.
Without the assets, JavaScript/TypeScript still work and Python/SQL show a clear "runtime is not
installed" message. See [Deploying to Cloudflare Pages](DEPLOY_CLOUDFLARE.md).

The single-blank example above is the shortest starting point. For multiple named blanks, add
`blanks` and a `solutions` map; for a whole-body exercise, set `layout: "body"` and provide
`solution` as the entire function body.

## Custom question types

Registered from `index.js`, which must be a **single-file** ES module (loaded dynamically, so do not
`import` sibling files).

```js
export default {
  activate(ctx) {
    ctx.registerQuestionType({
      id: 'numeric',
      label: 'Numeric answer',
      rendererKind: 'number',
      description: 'A number graded with a tolerance.',
      defaultAnswer: () => '',
      describeAnswer: (question) =>
        `${question.answer.value} (±${question.meta?.tolerance ?? 0})`,
      check(question, value) {
        const target = Number(question.answer.value);
        const tolerance = Number(question.meta?.tolerance ?? 0);
        const given = Number(value);
        if (!Number.isFinite(given)) return { status: 'pending', ratio: 0 };
        const ok = Math.abs(given - target) <= tolerance;
        return { status: ok ? 'correct' : 'incorrect', ratio: ok ? 1 : 0 };
      },
    });
  },
};
```

`rendererKind` decides how the answer is collected:

| `rendererKind` | Input | `value` passed to `check` |
| --- | --- | --- |
| `text` | single-line text field | `string` |
| `number` | numeric field | `number` or `''` |
| `choice` | single select over `question.options` | option id `string` |
| `multichoice` | multi select over `question.options` | option ids `string[]` |

`check(question, value)` must return `{ status, ratio }` where `status` is `correct`, `partial`,
`incorrect` or `pending`, and `ratio` is 0–1 (used for partial credit and mastery). Returning `null`
or `pending` blocks submission.

Optional `defaultAnswer()` provides the initial value for the input.

## Custom importers

An importer turns an external file into deck objects; users pick it with **Plugins → Import file**.

```js
export default {
  activate(ctx) {
    ctx.registerImporter({
      id: 'csv-flashcards',
      label: 'CSV flashcards',
      description: 'Two columns: question, answer.',
      accept: ['.csv', '.tsv'],
      parse(text, fileName) {
        return {
          id: 'csv-deck',
          title: fileName,
          tags: ['CSV'],
          questions: text
            .split(/\r?\n/)
            .filter(Boolean)
            .map((line, index) => {
              const [prompt, answer] = line.split(',');
              return {
                id: `csv-${index + 1}`,
                type: 'fill',
                prompt,
                answer: { kind: 'fill', accept: [answer] },
              };
            }),
        };
      },
    });
  },
};
```

Return one deck object or an array of them; the host validates everything with zod. Throwing shows a
toast to the user.

## Loading and trust

| Source | Location | Behaviour |
| --- | --- | --- |
| Bundled | `plugins/` → `apps/web/public/plugins/` | `npm run plugins:sync` writes `index.json`; the app fetches it on load and `import()`s `entry`. |
| Local | A folder or file on the user's machine | Stored in IndexedDB; `entry` is loaded through a blob URL and survives restarts. |

Plugin code runs with the same privileges as the app. Only install plugins you trust.

```ts
interface PluginContext {
  manifest: PluginManifest;
  registerQuestionType(definition): void;
  registerImporter(definition): void;
  log(...args: unknown[]): void;
  kv: { get(key): Promise<unknown>; set(key, value): Promise<void> }; // namespaced per plugin
}
```

## AI-generated decks

Decks produced by **Generate** are validated with the same schemas as a hand-written deck, then
uploaded to the owner-only `user_decks` table when you save. A per-account copy is cached in
IndexedDB under `local-plugins:v1`; it is hidden while signed out and listed on the Plugins page as
`ai.<topic>-<stamp>` while signed in. Imported folder/JSON plugins remain purely local. See
[AI question generation](AI_GENERATION.md) for the hosted service, the 1 GB material budget and the
server-side prompt; the HTTP contract is in [AI_API.md](AI_API.md).

## Debugging

- The Plugins page lists every load problem (schema errors, missing deck files, `entry` failures).
- Validation errors carry a path, e.g.
  `decks/week1.json → questions.0.answer: answer option "d" does not exist in options`.
- Runtime logs use the `[plugin:<id>]` prefix in the console.
- After editing `plugins/`: `npm run plugins:sync` (or keep `npm run plugins:watch` running), then
  press **Rescan plugins**.

### Common errors

| Message | Cause |
| --- | --- |
| `type "single" needs answer.kind = "single"` | `type` and `answer.kind` disagree. |
| `choice questions need at least two options` | Missing `options`. |
| `answer option "x" does not exist in options` | Wrong `optionId`. |
| `content pattern "./decks/*.json" matched no files` | Wrong folder or file name. |
| `Failed to fetch dynamically imported module` | Wrong `entry` path, or the module uses relative imports. |
| `manifest.json not found` | The imported folder is one level off. |

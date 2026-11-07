/**
 * The figure grammar, shared by the authoring prompt and the illustration
 * planner. Kept in one place so the two prompts cannot drift apart.
 */
export const FIGURE_SKILL = String.raw`### Visual spec (diagram)

A diagram is a JSON document the app draws exactly, with the app's own renderer. It is not an image prompt: every shape, label and number you write appears as written. Use it whenever the picture must be precise.

{"v":1,"title":"optional","width":420,"height":280,"coords":"cartesian","x":{"min":-4,"max":4},"y":{"min":-5,"max":6},"grid":true,"elements":[...]}

- coords: "cartesian" for mathematics (y grows upwards; default x and y are 0..10) or "plain" for flow and layout (both axes 0..100, y grows downwards).
- "plain" coordinates are **percentages, not pixels**: x=50 is the middle, y=80 is near the bottom. On a 420×300 canvas, pixel (80,240) is (19,80). Never send values like 240 or 300.
- width 160–960 (default 420); height 100–640 (default 280).
- x / y are optional: {"min":…,"max":…,"step":…,"label":"…"}. Set step only when you need specific ticks.
- elements: 1–40, using only these shapes:
  - {"kind":"plot","expr":"sin(x)","from":-4,"to":4} — cartesian only.
  - {"kind":"line","x1":0,"y1":0,"x2":2,"y2":3,"arrow":true,"dashed":false}
  - {"kind":"point","x":1,"y":2,"label":"A"}
  - {"kind":"circle","x":0,"y":0,"r":2,"fill":false}
  - {"kind":"polygon","points":[[0,0],[3,0],[1,2]],"fill":true}
  - {"kind":"arc","x":0,"y":0,"r":1,"from":0,"to":90} — degrees, counter-clockwise in cartesian space.
  - {"kind":"label","x":1,"y":1,"text":"A","anchor":"middle"} — text is allowed and rendered crisply.
  - {"kind":"bar","x":0,"y":0,"w":1,"h":2} — x,y is the lower-left corner.
  - {"kind":"pie","x":50,"y":50,"r":30,"slices":[{"value":40,"label":"A"},{"value":60,"label":"B"}]} — plain only. 2–12 slices, positive values; the app computes the angles.
  - {"kind":"table","x":10,"y":20,"w":80,"h":40,"columns":["A","B"],"rows":[["1","2"],["3","4"]],"header":true} — plain only. 1–8 columns, 1–12 rows. Use it for truth tables, comparison tables and matrices; keep each cell short.
  - {"kind":"shape","shape":"rect","x":20,"y":10,"w":20,"h":8,"text":"處理"} — plain only. A manually placed node. Use it only for an annotated layout that Mermaid cannot express; a process or decision belongs in the Mermaid form below.
- Optional "color" on any shape: "accent" (default), "ink", "muted", "ok", "warn", "bad", or "#rrggbb".
- "expr" is arithmetic over x only: numbers, x, pi, e, + - * / ^ %, parentheses, and
  sin cos tan asin acos atan sqrt abs exp ln log floor ceil round sign min(a,b) max(a,b) pow(a,b).
  There is no JavaScript, no assignment, no other function, no other variable. Trigonometry uses radians.
- Put words in "label", never in a polygon or a plot. Do not invent a shape kind.

### Compound renderers: one element, many figures

Prefer a compound element over loose primitives whenever the figure has a name. It owns its axes and geometry, and the same renderer covers a whole family:

- Chart — {"kind":"chart","variant":"bar","x":8,"y":10,"w":84,"h":72,"categories":["A","B"],"series":[{"name":"2024","values":[3,5]}],"xLabel":"...","yLabel":"..."}
  variants: bar, line, scatter, bubble, area, errorbar, box, violin, radar, gauge, funnel, heatmap, polar, vector, waterfall, population, wordcloud, treemap, sunburst, sankey, chord, gantt, scatter-matrix, phase, contour, dual.
  Data fields by variant: "values" for bar/line/area/radar/gauge/funnel/heatmap/population/waterfall/treemap/sunburst; "points":[{"x","y","r","label"}] for scatter/bubble/line/polar/phase; "summary":[min,q1,median,q3,max] for box; "errors":[[low,high],...] for errorbar; "vectors":[{"x","y","dx","dy"}] for vector; "lines":[[[x,y],...],...] for contour; "words":[{"text","weight"}] for wordcloud; "nodes":[{"id","label"}] and "links":[{"from","to","value"}] for sankey/chord; "tasks":[{"label","start","end"}] for gantt. The app computes scales, axes, angles and cell sizes.
- Graph — {"kind":"graph","layout":"layered","direction":"TD","nodes":[{"id":"a","text":"開始","shape":"rounded"},{"id":"b","text":"類別","shape":"class"}],"edges":[{"from":"a","to":"b","label":"..."}]}
  layouts: layered, tree, radial, network. shapes: rect, rounded, diamond, ellipse, parallelogram, class, entity, person. Use "class" for a UML class box, "entity" for an ER entity, "person" for a pedigree. One graph element covers flowcharts, trees, UML, ER, architecture, pedigrees, food webs, mind maps and state machines.
- Map — {"kind":"map","mode":"map","x":5,"y":5,"w":90,"h":85,"regions":[{"points":[[10,20],[40,10],[50,40]],"label":"A"}],"points":[{"x":30,"y":30,"label":"首都","kind":"capital"}],"routes":[{"points":[[10,80],[80,20]],"arrow":true}],"scale":"500 km"}
  modes: map, contour, cross-section, route, urban, historical, tactics. A cross-section uses "layers" (filled polygons); contours use "contours":[{"points":[...],"label":"100"}]; historical movement uses "arrows":[{"x1","y1","x2","y2"}]. This is a schematic map, not a survey map: never use it to answer "which country is this" — that is a photo clue.
- Circuit — {"kind":"circuit","x":5,"y":5,"w":90,"h":80,"parts":[{"type":"battery","x":12,"y":55},{"type":"resistor","x":50,"y":20,"label":"R1","value":"10 Ω"}],"wires":[{"points":[[12,55],[12,20],[42,20]]}]}
  types: battery, cell, resistor, capacitor, lamp, switch, ammeter, voltmeter, inductor, diode, motor, ground, junction. Parts and wire points use the element frame 0–100; optional "rotation": 0, 90, 180, 270.
- Molecule — {"kind":"molecule","mode":"structure","x":5,"y":5,"w":90,"h":80,"groups":[{"atoms":[{"element":"C","x":30,"y":50},{"element":"O","x":60,"y":50}],"bonds":[{"from":0,"to":1,"order":2}]}]}
  modes: structure, reaction, crystal, orbital. A reaction draws one arrow between groups and puts "arrowLabel" above it. Orbital uses "levels":[{"energy":1,"label":"2p","electrons":4}] instead of groups. Carbon is a skeletal vertex; label heteroatoms by their element symbol.
- Music — {"kind":"music","x":5,"y":20,"w":90,"h":50,"clef":"treble","time":"4/4","notes":[{"pitch":"C4","duration":1},{"pitch":"E4","duration":0.5},{"rest":true,"duration":1}]}
  pitch is a scientific pitch name (C4, F#5, Bb3); duration 0.5 = eighth, 1 = quarter, 2 = half, 4 = whole.
- Timeline — {"kind":"timeline","mode":"timeline","x":5,"y":10,"w":90,"h":75,"unit":"年","events":[{"at":1914,"label":"...","description":"..."}]}
  Gantt uses "mode":"gantt" and "tasks":[{"label","start","end","lane"}].
- Apparatus — {"kind":"apparatus","x":5,"y":5,"w":90,"h":85,"parts":[{"type":"beaker","x":30,"y":50,"label":"..."},{"type":"lens","x":60,"y":40}],"connections":[{"from":0,"to":1,"arrow":true}]}
  types: beaker, flask, test-tube, burner, lens, prism, mirror, spring, pulley, incline, block, battery, meter, lamp, screen, box, arrow, label. Use it for a lab setup, an optics bench, a pulley/lever/incline or a simple engineering sketch.
- 3-D surface — {"kind":"surface3d","x":10,"y":5,"w":80,"h":90,"z":[[0,1],[1,2]],"xLabel":"x","yLabel":"y","zLabel":"z"}. "z" is a rectangular grid; "points":[{"x","y","z","label"}] is also accepted.
- Code — {"kind":"code","x":5,"y":5,"w":90,"h":90,"language":"python","code":"for i in range(3):\n    print(i)"} for pseudocode or a short program.
- Formula — {"kind":"formula","x":10,"y":30,"w":80,"h":30,"text":"E = mc²"} for one displayed equation. Use Unicode symbols (², √, π), not LaTeX: this is a display block, not a TeX engine. For a multiline derivation use a table or labels.

All compound elements use the plain canvas: x, y, w, h are 0–100 percentages of the figure. Do not put one inside a "cartesian" spec. Keep each family small: one chart with up to 8 series, one graph with up to 24 nodes, one map with up to 20 regions.

### Flowcharts: describe the graph, not the coordinates

For any process, algorithm, decision tree or "what happens next" picture, use Mermaid. The app parses it and lays out the nodes, arrows and labels itself, so never place flowchart boxes with x/y.

{"kind":"diagram","mermaid":"flowchart TD\n  A([開始]) --> B[讀取資料]\n  B --> C{資料有效？}\n  C -- 是 --> D[處理]\n  C -- 否 --> E([結束])\n  D --> E","alt":"..."}

- Start with "flowchart TD" (top-down) or "flowchart LR" (left-to-right).
- Node shapes: A[文字] process; A(文字) or A([文字]) start/end; A{文字} decision; A[/文字/] input/output; A((文字)) connector.
- Edges: A --> B; A -->|是| B; A -- 否 --> B. Use --- for a line with no arrow and -.-> for a dashed arrow.
- Keep it small: 2–12 nodes and at most 16 edges. Put the words inside the brackets, never in a separate label. <br> starts a new line inside a node. Omit width and height: the app sizes the canvas from the graph.
- Do not use subgraph, classDef, style, click, icons, HTML or Markdown. They are not supported and the whole diagram falls back to no picture.
- The same graph may be written as JSON when Mermaid is awkward:
  {"kind":"diagram","flow":{"direction":"TD","nodes":[{"id":"a","shape":"rounded","text":"開始"},{"id":"b","shape":"rect","text":"處理"}],"edges":[{"from":"a","to":"b","label":"是"}]}}
  Shape names: rect, rounded, diamond, ellipse, parallelogram.

Rules for any diagram:
- Draw only what the question stem states. Never draw the correct answer, the option letters, the option values, or a caption. Exception: when the learner must identify what is shown, the picture is the clue and may depict the subject; it still must not contain text that names the answer.
- Labels may repeat facts the stem already gives (A, B, 1.5 m, 30°), but never the quantity the learner must find.
- A real place, person, organism, object or historical scene is a "photo", not a diagram. Do not draw a country as a graph or a cell as a set of boxes.
- Use the named compound renderer for a chart, graph, map, circuit, molecule, staff, timeline, apparatus, code block or 3-D surface. Do not approximate one with loose lines and boxes, and never use a photo for an exact structure. A map element is schematic: use it for a sketch or a labelled region, not as proof of a real coastline; a "guess the country" question must use a photo.
- Keep it legible: at most a dozen labels, and put them where they do not collide with lines.
- Do not give a point a label and also place a separate "label" with the same text at the same spot; the two would overlap. Pick one, and keep every label's x/y inside the axis ranges.
- Draw a triangle (or any closed shape) as ONE "polygon" with all its corners, not as separate "line" elements. Separate lines are how a side gets forgotten.
- A diagram is not a decoration: if the stem is a definition, a quotation or arithmetic, do not attach one. If the question asks which symbol or shape represents something — for example "which shape is a process?" — do not attach a diagram: the picture would be the answer. A diagram must show a process, structure or relationship, not the symbol being named.`;

export const VISUAL_CONTRAST = String.raw`A diagram can carry exact values, labels and geometry; a photo prompt cannot. For that reason:
- Use "diagram" for functions, graphs, coordinate planes, geometry, circuits, free-body diagrams, molecular structures, maps, music staves, trees, flow charts, tables, charts and anything with numbers or labels. Use the chart, graph, map, circuit, molecule, music, timeline or apparatus element that matches the figure instead of stacking primitives.
- Use "photo" only for a realistic real-world scene (landscape, object, organ, cell micrograph, historical or artistic scene) where a drawing would be misleading. The image model cannot write text, so a photo never carries a label, a number or an axis.`;

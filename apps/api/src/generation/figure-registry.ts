/**
 * The figure registry.
 *
 * A question can need very different pictures: a bar chart is data, a free-body
 * diagram is geometry, a class diagram is a graph, and "guess the country" is a
 * photograph. One "diagram vs photo" switch cannot route them, so every figure
 * family is described here as data:
 *
 *   kind -> family / tier -> IR -> supported sources -> assertions -> fallbacks
 *
 * The router in `routeFigure` is deterministic. It picks the first source the
 * deployment can actually serve, and it never substitutes a text-to-image model
 * for an exact figure (a generated circuit or chemical structure is a wrong
 * answer, not an illustration). Scene questions do the opposite: they must not
 * be answered with a maths diagram.
 *
 * "support" is deliberately explicit. `native` means the app already has a
 * faithful renderer, `approx` means the existing primitives can approximate the
 * figure, and `none` means no renderer exists yet. A `none` exact figure is
 * dropped with a warning instead of being faked.
 */
import type { Question } from '@mengyin/core';
import { questionIsVisualClue } from './visual';

export type FigureFamily =
  | 'chart'
  | 'math'
  | 'physics'
  | 'chemistry'
  | 'biology'
  | 'geography'
  | 'humanities'
  | 'cs'
  | 'table'
  | 'scene';

export type FigureTier = 'exact' | 'structural' | 'scene';
export type FigureSupport = 'native' | 'approx' | 'external' | 'none';
export type FigureSource = 'figure' | 'mermaid' | 'table' | 'web-image' | 'text-to-image' | 'none';
export type FigureRenderer =
  | 'primitive'
  | 'chart'
  | 'graph'
  | 'map'
  | 'circuit'
  | 'molecule'
  | 'music'
  | 'timeline'
  | 'apparatus'
  | 'surface3d'
  | 'code'
  | 'formula'
  | 'table'
  | 'scene'
  | 'none';

export type FigureAssertion =
  | 'figure-nonempty'
  | 'figure-has-structure'
  | 'figure-has-data'
  | 'flow-connected'
  | 'no-answer-text'
  | 'not-answer-shape'
  | 'scene-has-prompt';

export interface FigureKind {
  id: string;
  family: FigureFamily;
  tier: FigureTier;
  support: FigureSupport;
  /** The dedicated renderer that draws this kind. */
  renderer: FigureRenderer;
  /** Ordered sources; the router takes the first one the server can serve. */
  sources: readonly FigureSource[];
  label: string;
  assertions: readonly FigureAssertion[];
  patterns: readonly RegExp[];
  priority: number;
}

export interface FigureIntent {
  kind: FigureKind;
  score: number;
}

export interface FigureAvailability {
  textToImage: boolean;
  webImage: boolean;
}

export type FigureRouteReason = 'unknown' | 'unsupported' | 'no-provider';

export interface FigureRoute {
  intent: FigureIntent | null;
  kind: FigureKind | null;
  source: FigureSource;
  /** True when the question is unanswerable without the picture. */
  required: boolean;
  reason?: FigureRouteReason;
}

const DIAGRAM: readonly FigureAssertion[] = ['figure-nonempty', 'figure-has-structure'];
const DATA: readonly FigureAssertion[] = ['figure-nonempty', 'figure-has-data'];
const FLOW: readonly FigureAssertion[] = ['figure-nonempty', 'flow-connected'];
const SCENE: readonly FigureAssertion[] = ['scene-has-prompt'];

/**
 * Renderer -> kinds. This is the single table the registry is built from, and
 * the reason a small number of renderers can cover most of the taxonomy:
 *
 *   chart      one variant switch covers 31 plot-like kinds
 *   graph      one node/edge layout covers 15 diagram kinds
 *   map        one region/route layer covers 8 schematic-map kinds
 *   molecule   one atom/bond model covers 5 chemistry/physics kinds
 *   apparatus  one symbol set covers 4 experiment/engineering kinds
 *   timeline   one axis covers 3 timeline/Gantt kinds
 *   primitive  the long tail of geometry, functions and fields
 *
 * A kind must appear exactly once. `figureRendering()` exposes the same data for
 * documentation and tests, so the table cannot drift from the routes.
 */
const RENDERER_KINDS: Record<Exclude<FigureRenderer, 'none'>, readonly string[]> = {
  chart: [
    'chart.bar',
    'chart.line',
    'chart.scatter',
    'chart.pie',
    'chart.heatmap',
    'chart.box',
    'chart.violin',
    'chart.errorbar',
    'chart.radar',
    'chart.gauge',
    'chart.funnel',
    'chart.sankey',
    'chart.treemap',
    'chart.sunburst',
    'chart.chord',
    'chart.bubble',
    'chart.contour',
    'chart.vector',
    'chart.phase',
    'chart.polar',
    'chart.dual',
    'chart.scatter-matrix',
    'chart.wordcloud',
    'physics.motion',
    'physics.wave',
    'physics.thermo',
    'chemistry.titration',
    'chemistry.phase',
    'geo.population',
    'biology.pyramid',
    'cs.burndown',
  ],
  graph: [
    'math.tree',
    'math.graph',
    'physics.control',
    'biology.pedigree',
    'biology.tree',
    'biology.food-web',
    'biology.dogma',
    'biology.protocol',
    'human.relations',
    'human.mindmap',
    'cs.uml',
    'cs.er',
    'cs.architecture',
    'cs.flow',
    'cs.tree',
  ],
  map: [
    'geo.map',
    'geo.contour',
    'geo.cross-section',
    'geo.urban',
    'geo.historical',
    'geo.route',
    'human.tactics',
    'chart.map',
  ],
  timeline: ['geo.timeline', 'human.plot', 'chart.gantt'],
  molecule: [
    'chemistry.structure',
    'chemistry.reaction',
    'chemistry.crystal',
    'chemistry.orbital',
    'physics.energy',
  ],
  apparatus: [
    'physics.apparatus',
    'physics.mechanical',
    'physics.machine',
    'physics.optics',
  ],
  circuit: ['physics.circuit'],
  music: ['human.music'],
  surface3d: ['chart.surface3d'],
  table: ['math.matrix', 'table.grid'],
  code: ['table.code'],
  formula: ['table.formula'],
  scene: [
    'biology.cell',
    'biology.micrograph',
    'human.storyboard',
    'human.scene',
    'scene.landmark',
    'scene.historical',
    'scene.object',
    'scene.people',
    'scene.illustration',
  ],
  primitive: [
    'math.function',
    'math.geometry',
    'math.number-line',
    'math.feasible-region',
    'math.venn',
    'math.complex',
    'math.vector',
    'math.curve',
    'math.transform',
    'math.lattice',
    'physics.free-body',
    'physics.field',
  ],
};

const RENDERER_BY_KIND = new Map<string, FigureRenderer>(
  Object.entries(RENDERER_KINDS).flatMap(([renderer, ids]) =>
    ids.map((id) => [id, renderer as FigureRenderer] as const),
  ),
);

/**
 * Kinds whose renderer is deliberately a schematic approximation rather than a
 * survey-accurate drawing. They are supported, but the registry says so.
 */
const APPROX_KINDS = new Set<string>([
  'geo.map',
  'geo.contour',
  'geo.cross-section',
  'geo.urban',
  'geo.historical',
  'geo.route',
  'human.tactics',
  'chart.map',
  'chart.surface3d',
  'physics.apparatus',
  'physics.mechanical',
  'physics.machine',
  'physics.optics',
  'math.graph',
]);

export function figureRenderer(id: string): FigureRenderer {
  return RENDERER_BY_KIND.get(id) ?? 'none';
}

/** Renderer table for docs, tests and the settings screen. */
export function figureRendering(): Array<{ renderer: FigureRenderer; kinds: readonly string[] }> {
  return (Object.keys(RENDERER_KINDS) as Array<Exclude<FigureRenderer, 'none'>>).map((renderer) => ({
    renderer,
    kinds: RENDERER_KINDS[renderer],
  }));
}

function kind(
  id: string,
  family: FigureFamily,
  tier: FigureTier,
  support: FigureSupport,
  sources: readonly FigureSource[],
  label: string,
  priority: number,
  patterns: readonly RegExp[],
  assertions: readonly FigureAssertion[] = DIAGRAM,
): FigureKind {
  const renderer = figureRenderer(id);
  // The renderer table, not a hand-written flag, decides whether a kind is
  // actually drawable. A kind with no renderer keeps its declared "none".
  const effectiveSupport: FigureSupport =
    renderer === 'scene' || renderer === 'none'
      ? support
      : APPROX_KINDS.has(id)
        ? 'approx'
        : 'native';
  // A new renderer replaces the old "no source" placeholder with the app's own
  // figure path. Scene kinds keep their web/generated image order.
  const effectiveSources: readonly FigureSource[] =
    sources.includes('none') && renderer !== 'scene' && renderer !== 'none'
      ? renderer === 'table'
        ? ['table']
        : ['figure']
      : sources;
  return {
    id,
    family,
    tier,
    support: effectiveSupport,
    renderer,
    sources: effectiveSources,
    label,
    assertions,
    patterns,
    priority,
  };
}

const none = (_label: string): readonly FigureSource[] => ['none'];

export const FIGURE_REGISTRY: readonly FigureKind[] = [
  // -- Data visualisation ----------------------------------------------------
  kind('chart.bar', 'chart', 'exact', 'native', ['figure'], 'bar or column chart', 100, [
    /柱狀圖|柱形圖|長條圖|條形圖|bar (?:chart|graph)|column chart/i,
  ], DATA),
  kind('chart.line', 'chart', 'exact', 'native', ['figure'], 'line chart', 100, [
    /折線圖|線形圖|折線|line (?:chart|graph)/i,
  ], DATA),
  kind('chart.scatter', 'chart', 'exact', 'native', ['figure'], 'scatter plot', 100, [
    /散點圖|散佈圖|散点图|scatter ?plot|scatter ?graph/i,
  ], DATA),
  kind('chart.pie', 'chart', 'exact', 'native', ['figure'], 'pie chart', 100, [
    /餅圖|餅狀圖|圓餅圖|饼图|pie (?:chart|graph)/i,
  ], DATA),
  kind('chart.heatmap', 'chart', 'exact', 'none', none('heatmap'), 'heat map', 100, [
    /熱力圖|熱圖|热力图|heat ?map|correlation matrix/i,
  ]),
  kind('chart.box', 'chart', 'exact', 'none', none('box'), 'box plot', 100, [
    /箱線圖|盒鬚圖|箱线图|box ?(?:plot|and[- ]whisker)/i,
  ]),
  kind('chart.violin', 'chart', 'exact', 'none', none('violin'), 'violin plot', 100, [
    /小提琴圖|小提琴图|violin plot/i,
  ]),
  kind('chart.errorbar', 'chart', 'exact', 'none', none('errorbar'), 'error-bar plot', 100, [
    /誤差棒|誤差線|误差棒|error bar/i,
  ]),
  kind('chart.radar', 'chart', 'exact', 'none', none('radar'), 'radar chart', 100, [
    /雷達圖|雷达图|radar chart|spider chart/i,
  ]),
  kind('chart.gauge', 'chart', 'exact', 'none', none('gauge'), 'gauge chart', 100, [
    /儀表盤|儀錶盤|仪表盘|gauge chart|speedometer/i,
  ]),
  kind('chart.funnel', 'chart', 'exact', 'none', none('funnel'), 'funnel chart', 100, [
    /漏斗圖|漏斗图|funnel chart/i,
  ]),
  kind('chart.sankey', 'chart', 'exact', 'none', none('sankey'), 'Sankey diagram', 100, [
    /桑基圖|桑基图|sankey/i,
  ]),
  kind('chart.gantt', 'chart', 'structural', 'approx', ['figure'], 'Gantt chart', 98, [
    /甘特圖|甘特图|gantt/i,
  ], DATA),
  kind('chart.treemap', 'chart', 'exact', 'none', none('treemap'), 'treemap', 100, [
    /矩形樹圖|矩形树图|treemap/i,
  ]),
  kind('chart.sunburst', 'chart', 'exact', 'none', none('sunburst'), 'sunburst chart', 100, [
    /旭日圖|旭日图|sunburst/i,
  ]),
  kind('chart.chord', 'chart', 'exact', 'none', none('chord'), 'chord diagram', 100, [
    /和弦圖|和弦图|chord diagram/i,
  ]),
  kind('chart.bubble', 'chart', 'exact', 'approx', ['figure'], 'bubble chart', 96, [
    /氣泡圖|气泡图|bubble chart/i,
  ], DATA),
  kind('chart.contour', 'chart', 'exact', 'approx', ['figure'], 'contour plot', 96, [
    /等高線圖|等高线图|contour (?:plot|map)/i,
  ], DATA),
  kind('chart.surface3d', 'chart', 'exact', 'none', none('surface'), '3-D surface', 100, [
    /3D 曲面|三維曲面|三维曲面|surface plot/i,
  ]),
  kind('chart.vector', 'chart', 'exact', 'approx', ['figure'], 'vector field', 96, [
    /向量場|向量场|vector field/i,
  ], DATA),
  kind('chart.phase', 'chart', 'exact', 'approx', ['figure'], 'phase diagram', 95, [
    /相圖|相图|phase (?:diagram|portrait)/i,
  ], DATA),
  kind('chart.polar', 'chart', 'exact', 'none', none('polar'), 'polar plot', 100, [
    /極坐標圖|极坐标图|polar (?:plot|chart)/i,
  ]),
  kind('chart.dual', 'chart', 'exact', 'none', none('dual'), 'dual-axis chart', 100, [
    /雙軸圖|双轴图|dual[- ]axis/i,
  ]),
  kind('chart.scatter-matrix', 'chart', 'exact', 'none', none('matrix'), 'scatter matrix', 100, [
    /散點矩陣|散点矩阵|scatter matrix|pair plot/i,
  ]),
  kind('chart.wordcloud', 'chart', 'exact', 'none', none('wordcloud'), 'word cloud', 100, [
    /詞雲|文字雲|词云|word cloud/i,
  ]),
  kind('chart.map', 'chart', 'exact', 'none', none('map'), 'thematic map', 100, [
    /熱力地圖|热力地图|choropleth|流向圖|流向图|點密度圖|点密度图|專題地圖|专题地图/i,
  ]),

  // -- Mathematics and logic -------------------------------------------------
  kind('math.function', 'math', 'exact', 'native', ['figure'], 'function graph', 95, [
    /函數(?:圖|圖像|曲線)|函数(?:图|图像|曲线)|拋物線|抛物线|正弦曲線|余弦曲线|餘弦曲線|y\s*=|f\(x\)|function (?:graph|plot)|parabola|sine curve|cosine curve|\bcurve\b|曲線|曲线/i,
  ]),
  kind('math.geometry', 'math', 'exact', 'native', ['figure'], 'geometry diagram', 94, [
    /三角形|直角三角形|幾何|几何|角度|相似|全等|畢氏定理|勾股定理|triangle|geometry|angle|congruent|similar/i,
  ]),
  kind('math.number-line', 'math', 'exact', 'native', ['figure'], 'number line', 96, [
    /數軸|數線|数轴|區間|区间|不等式|number line|interval|inequality/i,
  ]),
  kind('math.feasible-region', 'math', 'exact', 'approx', ['figure'], 'linear-programming feasible region', 97, [
    /線性規劃|线性规划|可行域|feasible region|linear programming/i,
  ]),
  kind('math.venn', 'math', 'exact', 'native', ['figure'], 'Venn diagram', 97, [
    /韋恩圖|范氏圖|文氏圖|韦恩图|venn|集合/i,
  ]),
  kind('math.tree', 'math', 'structural', 'native', ['mermaid'], 'probability or decision tree', 96, [
    /概率樹|機率樹|概率树|决策树|決策樹|博弈樹|博弈树|probability tree|decision tree|game tree/i,
  ], FLOW),
  kind('math.graph', 'math', 'structural', 'approx', ['figure'], 'graph of nodes and edges', 94, [
    /圖論|图论|節點|节点|頂點|顶点|加權圖|加权图|二分圖|二分图|graph theory|weighted graph|bipartite/i,
  ], FLOW),
  kind('math.matrix', 'math', 'exact', 'native', ['table'], 'matrix or determinant', 97, [
    /矩陣|矩阵|行列式|matrix|determinant/i,
  ], DATA),
  kind('math.complex', 'math', 'exact', 'native', ['figure'], 'complex plane', 96, [
    /複數平面|複平面|复数平面|complex plane|argand/i,
  ]),
  kind('math.vector', 'math', 'exact', 'native', ['figure'], 'vector diagram', 94, [
    /向量|vector/i,
  ]),
  kind('math.curve', 'math', 'exact', 'approx', ['figure'], 'parametric or implicit curve', 93, [
    /參數曲線|参数曲线|極坐標曲線|极坐标曲线|隱函數|隐函数|分形|parametric curve|polar curve|implicit (?:curve|function)|fractal/i,
  ]),
  kind('math.transform', 'math', 'exact', 'approx', ['figure'], 'coordinate transformation', 92, [
    /座標變換|坐标变换|拓撲|拓扑|coordinate transform|topology/i,
  ]),
  kind('math.lattice', 'math', 'exact', 'approx', ['figure'], 'lattice points', 92, [
    /格點|格点|晶格|lattice/i,
  ]),

  // -- Physics and engineering ----------------------------------------------
  kind('physics.free-body', 'physics', 'exact', 'native', ['figure'], 'free-body diagram', 100, [
    /受力(?:分析|圖)|自由體|自由体|力圖|力图|free[- ]body|force diagram/i,
  ]),
  kind('physics.motion', 'physics', 'exact', 'native', ['figure'], 'motion or v-t graph', 98, [
    /運動軌跡|运动轨迹|速度[- ]時間|速度[- ]时间|位移[- ]時間|位移[- ]时间|v-t|s-t|trajectory|velocity[- ]time|position[- ]time/i,
  ]),
  kind('physics.wave', 'physics', 'exact', 'native', ['figure'], 'waveform', 98, [
    /波形|干涉|繞射|衍射|駐波|驻波|waveform|interference|diffraction|standing wave/i,
  ]),
  kind('physics.energy', 'physics', 'exact', 'approx', ['figure'], 'energy-level diagram', 97, [
    /能級|能级|能階|能阶|energy level/i,
  ]),
  kind('physics.thermo', 'physics', 'exact', 'approx', ['figure'], 'P-V or phase diagram', 97, [
    /P-V 圖|PV 圖|P-V 图|熱力學|热力学|p-v diagram|thermodynamic/i,
  ]),
  kind('physics.field', 'physics', 'exact', 'native', ['figure'], 'field-line diagram', 97, [
    /場線|场线|電場|电场|磁場|磁场|field line|electric field|magnetic field/i,
  ]),
  kind('physics.machine', 'physics', 'exact', 'approx', ['figure'], 'pulley, lever or incline', 96, [
    /滑輪|滑轮|槓桿|杠杆|斜面|連接體|连接体|pulley|lever|incline|connected bodies/i,
  ]),
  kind('physics.circuit', 'physics', 'exact', 'none', none('circuit'), 'circuit diagram', 100, [
    /電路|电路|電阻|电阻|電容|电容|並聯|并联|串聯|串联|circuit|resistor|capacitor/i,
  ]),
  kind('physics.optics', 'physics', 'exact', 'approx', ['figure'], 'ray diagram', 97, [
    /光路|透鏡|透镜|反射|折射|焦距|ray diagram|lens|refraction|reflection/i,
  ]),
  kind('physics.apparatus', 'physics', 'exact', 'none', none('apparatus'), 'experimental apparatus', 95, [
    /實驗裝置|实验装置|儀器|仪器|裝置圖|装置图|apparatus|experimental setup/i,
  ]),
  kind('physics.mechanical', 'physics', 'exact', 'none', none('mechanical'), 'engineering drawing', 95, [
    /機械製圖|机械制图|裝配圖|装配图|零件圖|零件图|公差|engineering drawing|tolerance/i,
  ]),
  kind('physics.control', 'physics', 'structural', 'native', ['mermaid'], 'control block diagram', 96, [
    /控制系統|控制系统|控制框圖|控制框图|信號流|信号流|狀態機|状态机|control system|block diagram|signal flow|state machine/i,
  ], FLOW),

  // -- Chemistry -------------------------------------------------------------
  kind('chemistry.structure', 'chemistry', 'exact', 'none', none('structure'), 'chemical structure', 100, [
    /結構式|结构式|分子式|化學式|化学式|官能團|官能团|structural formula|molecular formula|functional group/i,
  ]),
  kind('chemistry.reaction', 'chemistry', 'exact', 'none', none('reaction'), 'reaction or mechanism', 100, [
    /反應式|反应式|化學反應|化学反应|機理|机理|reaction mechanism|chemical equation/i,
  ]),
  kind('chemistry.crystal', 'chemistry', 'exact', 'none', none('crystal'), 'crystal structure', 100, [
    /晶體結構|晶体结构|晶格|crystal structure/i,
  ]),
  kind('chemistry.titration', 'chemistry', 'exact', 'approx', ['figure'], 'titration curve', 97, [
    /滴定曲線|滴定曲线|titration curve/i,
  ]),
  kind('chemistry.phase', 'chemistry', 'exact', 'approx', ['figure'], 'phase diagram', 96, [
    /相圖|相图|phase diagram/i,
  ]),
  kind('chemistry.orbital', 'chemistry', 'exact', 'none', none('orbital'), 'molecular orbital', 100, [
    /分子軌道|分子轨道|軌道能級|轨道能级|molecular orbital/i,
  ]),

  // -- Biology ---------------------------------------------------------------
  kind('biology.cell', 'biology', 'scene', 'external', ['web-image', 'text-to-image'], 'cell, organ or anatomy scene', 95, [
    /細胞|细胞|胞器|細胞器|细胞器|器官|解剖|組織|组织|organelle|cell|organ|anatomy|tissue/i,
  ], SCENE),
  kind('biology.micrograph', 'biology', 'scene', 'external', ['web-image', 'text-to-image'], 'micrograph scene', 94, [
    /顯微|显微|micrograph|microscope image/i,
  ], SCENE),
  kind('biology.pedigree', 'biology', 'structural', 'approx', ['figure'], 'pedigree', 96, [
    /系譜|系谱|遺傳系譜|遗传系谱|pedigree/i,
  ]),
  kind('biology.tree', 'biology', 'structural', 'approx', ['mermaid'], 'phylogenetic tree', 95, [
    /進化樹|进化树|演化樹|演化树|系統樹|系统树|phylogenetic|evolutionary tree/i,
  ], FLOW),
  kind('biology.food-web', 'biology', 'structural', 'approx', ['mermaid'], 'food web', 94, [
    /食物網|食物网|食物鏈|食物链|food web|food chain/i,
  ], FLOW),
  kind('biology.pyramid', 'biology', 'structural', 'approx', ['figure'], 'ecological pyramid', 94, [
    /生態金字塔|生态金字塔|能量金字塔|energy pyramid|ecological pyramid/i,
  ]),
  kind('biology.dogma', 'biology', 'structural', 'approx', ['mermaid'], 'central dogma', 94, [
    /中心法則|中心法则|central dogma/i,
  ], FLOW),
  kind('biology.protocol', 'biology', 'structural', 'approx', ['mermaid'], 'experimental protocol', 92, [
    /實驗流程|实验流程|實驗步驟|实验步骤|protocol/i,
  ], FLOW),

  // -- Geography and history -------------------------------------------------
  kind('geo.map', 'geography', 'exact', 'none', none('map'), 'map', 100, [
    /地圖|地图|政區|政区|地形圖|地形图|氣候圖|气候图|洋流|板塊|板块|經緯|经纬|political map|climate map|ocean current|tectonic|(?<!concept |mind |思維 |思维 )\bmap\b/i,
  ]),
  kind('geo.contour', 'geography', 'exact', 'none', none('contour'), 'contour map', 99, [
    /等高線|等高线|contour/i,
  ]),
  kind('geo.cross-section', 'geography', 'exact', 'approx', ['figure'], 'geological cross-section', 96, [
    /地質剖面|地质剖面|剖面圖|剖面图|cross[- ]section/i,
  ]),
  kind('geo.population', 'geography', 'exact', 'approx', ['figure'], 'population pyramid', 96, [
    /人口金字塔|population pyramid/i,
  ], DATA),
  kind('geo.urban', 'geography', 'exact', 'none', none('urban'), 'urban land-use map', 95, [
    /城市功能分區|城市功能分区|土地利用|urban zoning|land use/i,
  ]),
  kind('geo.historical', 'geography', 'exact', 'none', none('historical-map'), 'historical map', 95, [
    /歷史地圖|历史地图|疆域變遷|疆域变迁|historical map|territory change/i,
  ]),
  kind('geo.route', 'geography', 'structural', 'approx', ['figure'], 'route map', 94, [
    /路線圖|路线图|航線|航线|route map/i,
  ]),
  kind('geo.timeline', 'geography', 'structural', 'approx', ['figure'], 'timeline', 93, [
    /時間軸|时间轴|timeline/i,
  ]),

  // -- Humanities ------------------------------------------------------------
  kind('human.relations', 'humanities', 'structural', 'approx', ['mermaid'], 'character relationship chart', 94, [
    /人物關係|人物关系|關係圖|关系图|character relationship|relationship chart/i,
  ], FLOW),
  kind('human.plot', 'humanities', 'structural', 'approx', ['figure'], 'plot curve', 93, [
    /情節曲線|情节曲线|plot curve|story arc/i,
  ]),
  kind('human.mindmap', 'humanities', 'structural', 'approx', ['mermaid'], 'mind or concept map', 93, [
    /思維導圖|思维导图|心智圖|心智图|概念圖|概念图|mind ?map|concept map/i,
  ], FLOW),
  kind('human.storyboard', 'humanities', 'scene', 'external', ['web-image', 'text-to-image'], 'storyboard or scene', 92, [
    /漫畫分鏡|漫画分镜|分鏡|分镜|storyboard/i,
  ], SCENE),
  kind('human.scene', 'humanities', 'scene', 'external', ['web-image', 'text-to-image'], 'scene illustration', 60, [
    /場景插畫|场景插画|情境圖|情境图|scene illustration/i,
  ], SCENE),
  kind('human.music', 'humanities', 'exact', 'none', none('music'), 'music staff', 95, [
    /五線譜|五线谱|和弦圖|和弦图|指法圖|指法图|staff|chord diagram|fingering/i,
  ]),
  kind('human.tactics', 'humanities', 'structural', 'approx', ['figure'], 'tactics board', 92, [
    /戰術板|战术板|陣型圖|阵型图|tactics board|formation/i,
  ]),

  // -- Computer science ------------------------------------------------------
  kind('cs.uml', 'cs', 'structural', 'approx', ['figure'], 'UML diagram', 96, [
    /UML|類圖|类图|用例圖|用例图|活動圖|活动图|時序圖|时序图|順序圖|顺序图|狀態圖|状态图|class diagram|use case|sequence diagram|state diagram/i,
  ], FLOW),
  kind('cs.er', 'cs', 'structural', 'approx', ['figure'], 'ER diagram', 95, [
    /ER 圖|ER 图|實體關係|实体关系|entity[- ]relationship/i,
  ], FLOW),
  kind('cs.architecture', 'cs', 'structural', 'approx', ['figure'], 'architecture or topology', 94, [
    /架構圖|架构图|部署圖|部署图|網絡拓撲|网络拓扑|architecture diagram|deployment diagram|network topology/i,
  ], FLOW),
  kind('cs.flow', 'cs', 'structural', 'native', ['mermaid'], 'flowchart', 98, [
    /流程圖|流程图|資料流圖|数据流图|BPMN|看板|flowchart|data flow|kanban/i,
  ], FLOW),
  kind('cs.tree', 'cs', 'structural', 'native', ['mermaid'], 'tree or file structure', 93, [
    /樹形圖|树形图|文件結構|文件结构|目錄結構|目录结构|tree diagram|file structure/i,
  ], FLOW),
  kind('cs.burndown', 'cs', 'structural', 'approx', ['figure'], 'burndown chart', 94, [
    /燃盡圖|燃尽图|burndown/i,
  ], DATA),

  // -- Tables and typesetting -----------------------------------------------
  kind('table.grid', 'table', 'exact', 'native', ['table'], 'table', 100, [
    /表格|表格式|合併單元格|合并单元格|對比表|对比表|分類表|分类表|真值表|矩陣表|矩阵表|truth table|comparison table|table of values|\btable\b/i,
  ], DATA),
  kind('table.formula', 'table', 'exact', 'none', none('formula'), 'displayed formula (Unicode)', 90, [
    /公式排版|formula typesetting/i,
  ]),
  kind('table.code', 'table', 'exact', 'none', none('code'), 'pseudocode', 90, [
    /偽代碼|伪代码|演算法框|算法框|pseudocode|algorithm block/i,
  ]),

  // -- Real scenes -----------------------------------------------------------
  kind('scene.landmark', 'scene', 'scene', 'external', ['web-image', 'text-to-image'], 'place, landmark or country clue', 88, [
    /猜(?:一?下)?(?:國家|国家|城市|地點|地点)|這是哪(?:個|个|裡|里)|這是什麼地方|这是什么地方|辨認(?:地點|地点|地標|地标)|guess the (?:country|city|place)|which (?:country|city|place) is (?:this|shown)|where (?:is|was) this|identify the (?:country|city|landmark|location|place)/i,
  ], SCENE),
  kind('scene.historical', 'scene', 'scene', 'external', ['web-image', 'text-to-image'], 'historical scene', 86, [
    /歷史場景|历史场景|古代場景|古代场景|戰爭場面|战争场面|historical scene|battle scene/i,
  ], SCENE),
  kind('scene.object', 'scene', 'scene', 'external', ['web-image', 'text-to-image'], 'real object scene', 55, [
    /實物|实物|物件|object scene/i,
  ], SCENE),
  kind('scene.people', 'scene', 'scene', 'external', ['web-image', 'text-to-image'], 'people or situation scene', 54, [
    /人物情境|人物场景|people scene|scene with people/i,
  ], SCENE),
  kind('scene.illustration', 'scene', 'scene', 'external', ['web-image', 'text-to-image'], 'illustration', 50, [
    /插畫|插画|illustration/i,
  ], SCENE),
];

const BY_ID = new Map(FIGURE_REGISTRY.map((entry) => [entry.id, entry]));

export function figureKind(id: string): FigureKind | undefined {
  return BY_ID.get(id);
}

/**
 * Pick the most specific matching kind. Ties go to the later entry only when it
 * has a strictly higher priority, so the order above is also the tie-breaker.
 */
export function classifyFigure(question: Question): FigureIntent | null {
  // The prompt only: option text is the answer space, and a distractor such as
  // "bar chart" must not decide the figure family.
  const text = question.prompt;
  let best: FigureIntent | null = null;
  for (const entry of FIGURE_REGISTRY) {
    for (const pattern of entry.patterns) {
      if (!pattern.test(text)) continue;
      if (!best || entry.priority > best.score) best = { kind: entry, score: entry.priority };
      break;
    }
  }
  return best;
}

/** True when the question asks the learner to identify what the picture shows. */
export function isSceneClue(question: Question): boolean {
  return questionIsVisualClue(question);
}

/**
 * Resolve one question to the source the server should use. This is the single
 * place that decides "diagram vs photo": exact and structural kinds never fall
 * through to text-to-image, and scene kinds never fall back to a diagram.
 */
export function routeFigure(question: Question, availability: FigureAvailability): FigureRoute {
  const intent = classifyFigure(question);
  const required = questionIsVisualClue(question);
  if (!intent) {
    return { intent: null, kind: null, source: 'none', required, reason: 'unknown' };
  }
  const selected = intent.kind;

  if (selected.tier === 'scene') {
    // A clue needs a real reference photo. An ordinary illustrative scene is
    // better drawn by the image model: a web search for a generic phrase often
    // returns a loosely related stock photo.
    if (required && availability.webImage) {
      return { intent, kind: selected, source: 'web-image', required };
    }
    if (availability.textToImage) {
      return { intent, kind: selected, source: 'text-to-image', required };
    }
    if (availability.webImage) {
      return { intent, kind: selected, source: 'web-image', required };
    }
    return { intent, kind: selected, source: 'none', required, reason: 'no-provider' };
  }

  if (selected.support === 'none') {
    return { intent, kind: selected, source: 'none', required, reason: 'unsupported' };
  }

  const source = selected.sources.find(
    (candidate) => candidate === 'figure' || candidate === 'mermaid' || candidate === 'table',
  );
  if (!source) {
    return { intent, kind: selected, source: 'none', required, reason: 'unsupported' };
  }
  return { intent, kind: selected, source, required };
}

/** A compact description for the planner prompt. */
export function intentBrief(route: FigureRoute): Record<string, string> | undefined {
  if (!route.kind) return undefined;
  return {
    id: route.kind.id,
    family: route.kind.family,
    tier: route.kind.tier,
    renderer: route.kind.renderer,
    preferred: route.source,
    label: route.kind.label,
  };
}

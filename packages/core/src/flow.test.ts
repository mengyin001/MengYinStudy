import { describe, expect, it } from 'vitest';
import {
  compileFigureFlow,
  layoutFlow,
  parseFlowGraph,
  parseMermaidFlow,
} from './flow';
import { isFigure, layoutFigure, parseFigureSpec } from './figure';

const mermaid = `flowchart TD
  A([開始]) --> B[讀取資料]
  B --> C{資料有效？}
  C -- 是 --> D[處理資料]
  C -- 否 --> E([結束])
  D --> E`;

describe('parseMermaidFlow', () => {
  it('reads nodes, shapes, edges and labels', () => {
    const graph = parseMermaidFlow(mermaid);
    expect(graph).not.toBeNull();
    expect(graph?.direction).toBe('TD');
    expect(graph?.nodes).toHaveLength(5);
    expect(graph?.nodes.find((node) => node.id === 'A')).toMatchObject({ shape: 'rounded', text: '開始' });
    expect(graph?.nodes.find((node) => node.id === 'C')).toMatchObject({ shape: 'diamond', text: '資料有效？' });
    expect(graph?.edges).toHaveLength(5);
    expect(graph?.edges.find((edge) => edge.label === '是')).toMatchObject({ from: 'C', to: 'D' });
    expect(graph?.edges.find((edge) => edge.label === '否')).toMatchObject({ from: 'C', to: 'E' });
  });

  it('accepts edges without spaces and Unicode node ids', () => {
    const graph = parseMermaidFlow(
      'flowchart TD\nA-->B\nB-.->C\n開始[開始]-->處理[處理]\n處理-->結束[結束]',
    );
    expect(graph?.edges).toHaveLength(4);
    expect(graph?.nodes.find((node) => node.id === '開始')?.text).toBe('開始');
    expect(graph?.edges.find((edge) => edge.dashed)?.from).toBe('B');
  });

  it('supports LR, pipe labels, chains and quoted text', () => {
    const graph = parseMermaidFlow(
      'graph LR\r\n  A[One] -->|yes| B["Two words"]\r\n  B --> C((End))\r\n',
    );
    expect(graph?.direction).toBe('LR');
    expect(graph?.edges).toHaveLength(2);
    expect(graph?.edges[0]).toMatchObject({ from: 'A', to: 'B', label: 'yes' });
    expect(graph?.nodes.find((node) => node.id === 'B')?.text).toBe('Two words');
    expect(graph?.nodes.find((node) => node.id === 'C')?.shape).toBe('ellipse');
  });

  it('folds a real newline and a literal \\n inside a node label', () => {
    const real = parseMermaidFlow('flowchart TD\n  A[total = 0\ni = 1] --> B[End]');
    expect(real?.nodes.find((node) => node.id === 'A')?.text).toBe('total = 0\ni = 1');

    const literal = parseMermaidFlow('flowchart TD\n  A[one\\ntwo] --> B[End]');
    expect(literal?.nodes.find((node) => node.id === 'A')?.text).toBe('one\ntwo');
  });

  it('treats an id-only reference as a node with the id as its text', () => {
    const graph = parseMermaidFlow('flowchart TD\nA --> B[Next]');
    expect(graph?.nodes).toHaveLength(2);
    expect(graph?.nodes.find((node) => node.id === 'A')?.text).toBe('A');
  });

  it('rejects diagrams that are not flows or are outside the subset', () => {
    expect(parseMermaidFlow('')).toBeNull();
    expect(parseMermaidFlow('flowchart TD\n  A[Only one node]')).toBeNull();
    expect(parseMermaidFlow('subgraph one\n A --> B\nend')).toBeNull();
    expect(parseMermaidFlow('flowchart TD\n A --> B & C')).toBeNull();
    expect(parseMermaidFlow('flowchart RL\n A --> B')).toBeNull();
    expect(parseMermaidFlow('flowchart BT\n A --> B')).toBeNull();
    expect(parseMermaidFlow('flowchart TB\n A --> B')).not.toBeNull();
    expect(parseMermaidFlow('flowchart TD\n A --> B\n classDef bad fill:#000')).not.toBeNull();
    expect(parseMermaidFlow('%% comment\nflowchart TD\n A --> B')).not.toBeNull();
    expect(parseMermaidFlow('x'.repeat(7000))).toBeNull();
  });

  it('caps the graph size', () => {
    const lines = ['flowchart TD'];
    for (let index = 0; index < 14; index += 1) {
      lines.push(`N${index}[Step ${index}] --> N${index + 1}[Step ${index + 1}]`);
    }
    expect(parseMermaidFlow(lines.join('\n'))).toBeNull();
  });
});

describe('parseFlowGraph', () => {
  it('reads the JSON form and semantic shape names', () => {
    const graph = parseFlowGraph({
      direction: 'LR',
      nodes: [
        { id: 'start', shape: 'terminator', text: '開始' },
        { id: 'decision', shape: 'decision', text: '要繼續嗎？' },
        { id: 'io', shape: 'input', text: '讀取' },
      ],
      edges: [
        { from: 'start', to: 'decision' },
        { source: 'decision', target: 'io', label: '是' },
      ],
    });
    expect(graph?.direction).toBe('LR');
    expect(graph?.nodes.map((node) => node.shape)).toEqual(['rounded', 'diamond', 'parallelogram']);
    expect(graph?.edges[1]).toMatchObject({ from: 'decision', to: 'io', label: '是' });
  });

  it('drops edges that point at unknown nodes and rejects an empty graph', () => {
    expect(parseFlowGraph({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'missing' }] })).toBeNull();
    expect(parseFlowGraph({})).toBeNull();
    expect(
      parseFlowGraph({
        direction: 'RL',
        nodes: [{ id: 'a' }, { id: 'b' }],
        edges: [{ from: 'a', to: 'b' }],
      }),
    ).toBeNull();
  });
});

describe('layoutFlow', () => {
  it('lays the graph out as a v1 figure with nodes, arrows and labels', () => {
    const graph = parseMermaidFlow(mermaid)!;
    const spec = layoutFlow(graph, { width: 480, height: 320 });
    expect(spec).not.toBeNull();
    expect(spec?.v).toBe(1);
    expect(spec?.coords).toBe('plain');
    expect(spec?.width).toBeLessThanOrEqual(960);
    expect(spec?.height).toBeLessThanOrEqual(640);

    const shapes = spec?.elements.filter((element) => element.kind === 'shape') ?? [];
    const lines = spec?.elements.filter((element) => element.kind === 'line') ?? [];
    expect(shapes).toHaveLength(5);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.some((line) => line.kind === 'line' && line.arrow)).toBe(true);

    const texts = spec?.elements.filter((element) => element.kind === 'label') ?? [];
    expect(texts.some((element) => element.kind === 'label' && element.text === '是')).toBe(true);

    for (const element of spec?.elements ?? []) {
      if (element.kind === 'shape') {
        expect(element.x).toBeGreaterThanOrEqual(0);
        expect(element.y).toBeGreaterThanOrEqual(0);
        expect(element.x + element.w).toBeLessThanOrEqual(100.01);
        expect(element.y + element.h).toBeLessThanOrEqual(100.01);
      }
      if (element.kind === 'line') {
        expect(element.x1).toBeGreaterThanOrEqual(0);
        expect(element.y1).toBeGreaterThanOrEqual(0);
        expect(element.x2).toBeGreaterThanOrEqual(0);
        expect(element.y2).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('puts a top-down graph in rows and a left-to-right graph in columns', () => {
    const source = 'flowchart TD\nA[One] --> B[Two]\nB --> C[Three]';
    const td = layoutFlow(parseMermaidFlow(source)!)!;
    const tdShapes = td.elements.filter((element) => element.kind === 'shape');
    const tdTop = tdShapes.map((shape) => (shape.kind === 'shape' ? shape.y : 0));
    expect(new Set(tdTop).size).toBe(3);

    const lr = layoutFlow(parseMermaidFlow(source.replace('TD', 'LR'))!)!;
    const lrShapes = lr.elements.filter((element) => element.kind === 'shape');
    const lrLeft = lrShapes.map((shape) => (shape.kind === 'shape' ? shape.x : 0));
    expect(new Set(lrLeft).size).toBe(3);
  });

  it('routes a loop around the near side instead of through a sibling node', () => {
    const source = `flowchart TD
      A([開始]) --> B[/輸入 n/]
      B --> C[total = 0<br/>i = 1]
      C --> D{i <= n?}
      D -- 是 --> E[total = total + i]
      E --> F[i = i + 1]
      F --> D
      D -- 否 --> G[/輸出 total/]
      G --> H([結束])`;
    const spec = layoutFlow(parseMermaidFlow(source)!)!;
    const shapes = spec.elements.filter((element) => element.kind === 'shape');
    const lines = spec.elements.filter((element) => element.kind === 'line');
    const minShapeX = Math.min(...shapes.map((shape) => (shape.kind === 'shape' ? shape.x : 100)));
    const leftLane = lines.find(
      (line) =>
        line.kind === 'line' &&
        Math.abs(line.y1 - line.y2) < 0.01 &&
        line.x2 < line.x1 &&
        line.x2 < minShapeX,
    );
    expect(leftLane).toBeDefined();
    // The 結束 node is the sibling on the loop's row; no segment may run
    // horizontally through its box.
    const finish = shapes.find(
      (shape) => shape.kind === 'shape' && shape.text === '結束',
    );
    if (finish?.kind === 'shape') {
      const crossesFinish = lines.some(
        (line) =>
          line.kind === 'line' &&
          Math.abs(line.y1 - line.y2) < 0.01 &&
          Math.min(line.x1, line.x2) < finish.x + finish.w &&
          Math.max(line.x1, line.x2) > finish.x &&
          line.y1 > finish.y &&
          line.y1 < finish.y + finish.h,
      );
      expect(crossesFinish).toBe(false);
    }
  });

  it('routes a cycle outside the node column instead of looping through it', () => {
    const spec = layoutFlow(parseMermaidFlow('flowchart TD\nA[One] --> B[Two]\nB --> C[Three]\nC --> A')!)!;
    const lines = spec.elements.filter((element) => element.kind === 'line');
    expect(lines.length).toBeGreaterThan(3);
    expect(lines.some((element) => element.kind === 'line' && element.arrow)).toBe(true);
    expect(spec.width).toBeGreaterThan(320);
  });

  it('wraps a long node label into several lines', () => {
    const spec = layoutFlow(
      parseMermaidFlow(
        'flowchart TD\nA[這是一個非常長的節點文字，長到必須換行才不會超出方塊]\nA --> B[結束]',
      )!,
    )!;
    const labels = spec.elements.filter((element) => element.kind === 'label');
    expect(labels.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const first = layoutFlow(parseMermaidFlow(mermaid)!)!;
    const second = layoutFlow(parseMermaidFlow(mermaid)!)!;
    expect(second).toEqual(first);
  });
});

describe('figure integration', () => {
  it('accepts a mermaid spec, a bare mermaid string and a JSON flow', () => {
    const fromObject = parseFigureSpec({ v: 1, mermaid });
    expect(fromObject).not.toBeNull();
    expect(fromObject?.coords).toBe('plain');

    const fromString = parseFigureSpec(mermaid);
    expect(fromString?.elements.length).toBe(fromObject?.elements.length);

    const fromFlow = parseFigureSpec({
      v: 1,
      flow: {
        direction: 'TD',
        nodes: [
          { id: 'a', shape: 'rounded', text: '開始' },
          { id: 'b', shape: 'rect', text: '處理' },
        ],
        edges: [{ from: 'a', to: 'b' }],
      },
    });
    expect(fromFlow).not.toBeNull();
    expect(fromFlow?.elements.filter((element) => element.kind === 'shape')).toHaveLength(2);
  });

  it('renders the compiled spec through the ordinary figure layout', () => {
    const spec = parseFigureSpec({ v: 1, mermaid })!;
    const drawing = layoutFigure(spec);
    expect(drawing.shapes.length).toBeGreaterThan(5);
    expect(drawing.shapes.some((shape) => shape.kind === 'rect')).toBe(true);
    expect(drawing.shapes.some((shape) => shape.kind === 'text')).toBe(true);
  });

  it('recognises a mermaid figure media item', () => {
    expect(isFigure({ type: 'figure', figure: { v: 1, mermaid } })).toBe(true);
    expect(compileFigureFlow({ nodes: [], edges: [] })).toBeNull();
  });
});

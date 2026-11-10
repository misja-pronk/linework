import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { deflateSync, strToU8 } from 'fflate';
import { render, type RenderResult } from '@cartography/engine';
import type { GraphNode, LayoutSidecar } from '@cartography/core';
import { importMermaid } from '@cartography/import';
import { findAll, parseXml, type XmlNode } from '../src/xml.ts';
import { base64Bytes } from '../src/text.ts';
import { importDrawio, importExcalidraw, isDrawio, isExcalidraw, toDrawio, toExcalidraw, toMermaid, toSafeSvg, toScene, unsafeConstructs } from '../src/index.ts';

// Whole examples are drawn, written out and drawn again: slower than a unit test, and slower still beside the others.
vi.setConfig({ testTimeout: 30_000 });

const root = path.resolve(import.meta.dirname, '../../..');
const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

async function example(file: string, view?: string): Promise<RenderResult> {
  const f = path.join(root, 'examples', file);
  const r = await render(fs.readFileSync(f, 'utf8'), { fonts: 'none', view, load: (rel: string) => fs.readFileSync(path.join(path.dirname(f), rel), 'utf8') });
  expect(r.graph, file).toBeTruthy();
  return r;
}

async function clean(yaml: string, sidecar?: LayoutSidecar) {
  const r = await render(yaml, { fonts: 'none', sidecar });
  expect(r.diagnostics.filter((d) => d.severity === 'error'), yaml).toEqual([]);
  expect(r.svg).toBeTruthy();
  return r;
}

/** What a diagram is made of, without where it stands: the yardstick for a round trip. */
function content(r: RenderResult) {
  const g = r.graph!;
  return {
    nodes: g.nodes.map((n) => `${n.id}<${n.parent ?? ''}`).sort(),
    groups: g.groups.map((n) => `${n.id}<${n.parent ?? ''}`).sort(),
    edges: g.edges.map((e) => `${e.from.node}>${e.to.node}|${e.label ?? ''}|${e.line}`).sort(),
  };
}

/** The words a node is known by: a card's label, a table's title. */
const labelOf = (n: GraphNode) => ('label' in n.shape ? n.shape.label : 'title' in n.shape ? n.shape.title : undefined) as string | undefined;

/** The cells of a draw.io page, each with the attributes of its mxCell and the wrapping object's data. */
type Cell = { id: string; data: Record<string, string>; geometry?: XmlNode; parent?: string; style?: string; vertex?: string; edge?: string; source?: string; target?: string };
function cells(model: XmlNode): Cell[] {
  const top = findAll(model, 'root')[0]!;
  return top.children.map((el) => {
    const mx = el.name === 'object' ? el.children.find((c) => c.name === 'mxCell')! : el;
    return { id: el.attrs.id ?? mx.attrs.id!, data: el.name === 'object' ? el.attrs : {}, ...mx.attrs, geometry: mx.children.find((c) => c.name === 'mxGeometry') };
  });
}

describe('draw.io export', () => {
  it('writes shapes, containers and attached connectors that draw.io can edit', async () => {
    const r = await example('azure/web-shop.yaml');
    const xml = toDrawio([toScene(r)]);
    const doc = parseXml(xml);
    expect(findAll(doc, 'mxfile')).toHaveLength(1);
    const pages = findAll(doc, 'diagram');
    expect(pages).toHaveLength(1);
    const list = cells(findAll(pages[0]!, 'mxGraphModel')[0]!);
    const byId = new Map(list.map((c) => [c.id, c]));
    // Ids are unique, every parent exists, the two root cells are there.
    expect(byId.size).toBe(list.length);
    expect(byId.get('0')).toBeTruthy();
    expect(byId.get('1')?.parent).toBe('0');
    for (const c of list) if (c.id !== '0') expect(byId.has(c.parent!), `parent of ${c.id}`).toBe(true);
    // Every vertex and edge has its geometry, as draw.io needs it.
    for (const c of list.filter((c) => c.vertex === '1' || c.edge === '1')) expect(c.geometry?.attrs.as, c.id).toBe('geometry');
    // A node of the diagram is one shape inside the cell of its group.
    const nodes = list.filter((c) => c.data.carto === 'node');
    expect(nodes.length).toBe(r.graph!.nodes.length);
    const groups = new Map(list.filter((c) => c.data.carto === 'group').map((c) => [c.data.cartoId, c]));
    expect(groups.size).toBe(r.graph!.groups.length);
    const inGroups = r.graph!.nodes.filter((n) => n.parent);
    expect(inGroups.length).toBeGreaterThan(3);
    for (const n of inGroups) {
      const cell = nodes.find((c) => c.data.cartoId === n.id)!;
      expect(cell.parent, n.id).toBe(groups.get(n.parent!)!.id);
    }
    for (const g of groups.values()) expect(g.style, g.id).toMatch(/container=1/);
    // Every line is attached at both ends, with the route as waypoints; a line folded into a badge is the badge.
    const edges = list.filter((c) => c.edge === '1' && c.data.carto === 'edge');
    const badges = list.filter((c) => c.data.carto === 'badge');
    expect(badges.length).toBe(1);
    expect(edges.length + badges.length).toBe(r.graph!.edges.length);
    for (const e of edges) {
      expect(byId.get(e.source!)?.vertex, `source of ${e.id}`).toBe('1');
      expect(byId.get(e.target!)?.vertex, `target of ${e.id}`).toBe('1');
      // Fixed points where the route leaves and enters, so draw.io keeps our route until the user moves a shape.
      expect(e.style).toMatch(/exitX=.*entryX=/);
    }
    // A bent route keeps its bends as waypoints.
    const routed = await example('systems/saas-platform.yaml');
    const scene = toScene(routed);
    const out = cells(findAll(parseXml(toDrawio([scene])), 'mxGraphModel')[0]!);
    const bent = scene.connectors.filter((c) => c.points.length > 2);
    expect(bent.length).toBeGreaterThan(0);
    for (const c of bent) expect(findAll(out.find((x) => x.id === c.id)!.geometry!, 'mxPoint').filter((p) => !p.attrs.as).length, c.id).toBe(c.points.length - 2);
  });

  it('writes the tables of an ERD as draw.io tables, a row per column', async () => {
    const r = await example('erd/orders.yaml');
    const list = cells(findAll(parseXml(toDrawio([toScene(r)])), 'mxGraphModel')[0]!);
    const tables = list.filter((c) => c.data.carto === 'node');
    expect(tables.length).toBe(r.graph!.nodes.length);
    for (const t of tables) {
      expect(t.style).toMatch(/^swimlane;/);
      expect(t.style).toMatch(/childLayout=stackLayout/);
      expect(list.some((c) => c.parent === t.id)).toBe(true);
    }
    // A relation runs from row to row, with crow's feet.
    const edges = list.filter((c) => c.data.carto === 'edge');
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(list.find((c) => c.id === e.source)?.parent, e.id).toBeTruthy();
    expect(edges.some((e) => /Arrow=ER/.test(e.style!))).toBe(true);
  });

  it('brings an ERD back with its schema colours, table captions and nullable columns as written', async () => {
    const a = await example('erd/shop-schemas.yaml');
    const [back] = importDrawio(toDrawio([toScene(a)]));
    expect(back!.yaml).toMatch(/sales: \{ tone: blue \}/);
    expect(back!.yaml).toContain('caption: People who buy');
    expect(back!.yaml).toContain('category_id: uuid null fk categories.id');
    expect(back!.yaml).not.toContain('uuid?');
  });

  it('draws a process: lanes as containers, every task, event and gateway a shape the lines attach to', async () => {
    const r = await example('process/order-to-cash.yaml');
    const list = cells(findAll(parseXml(toDrawio([toScene(r)])), 'mxGraphModel')[0]!);
    const lanes = list.filter((c) => c.data.carto === 'group');
    expect(lanes.map((c) => c.data.cartoLane)).toEqual(['true', 'true', 'true']);
    const nodes = list.filter((c) => c.data.carto === 'node');
    expect(nodes.length).toBe(r.graph!.nodes.length);
    expect(nodes.some((c) => /ellipse/.test(c.style!))).toBe(true);
    expect(nodes.some((c) => /rhombus/.test(c.style!))).toBe(true);
    const ids = new Set(nodes.map((c) => c.id));
    const edges = list.filter((c) => c.data.carto === 'edge');
    expect(edges.length).toBe(r.graph!.edges.length);
    for (const e of edges) expect(ids.has(e.source!) && ids.has(e.target!), e.id).toBe(true);
  });

  it('makes every view a page', async () => {
    const first = await example('c4/kestrel-bank.yaml');
    expect(first.views?.length).toBeGreaterThan(1);
    const drawn = await Promise.all(first.views!.map((v) => example('c4/kestrel-bank.yaml', v.name)));
    const pages = findAll(parseXml(toDrawio(drawn.map((d) => toScene(d)))), 'diagram');
    expect(pages.map((p) => p.attrs.name)).toHaveLength(first.views!.length);
    expect(new Set(pages.map((p) => p.attrs.id)).size).toBe(pages.length);
  });

  it('escapes what XML cannot hold as it is', async () => {
    const r = await clean(`type: systems\ntitle: "Q&A <draft>"\nnodes:\n  a: { kind: service, label: "Tom & \\"Jerry\\" <b>" }\n  b: { kind: database }\nedges:\n  - a -> b: "reads & writes"\n`);
    const xml = toDrawio([toScene(r)]);
    expect(() => parseXml(xml)).not.toThrow();
    const [back] = importDrawio(xml);
    expect(back!.yaml).toContain('Tom & \\"Jerry\\" <b>');
    expect(back!.yaml).toContain('reads & writes');
  });
});

describe('draw.io import', () => {
  it('reads every page of a file and guesses each type from its stencils', () => {
    const pages = importDrawio(fixture('clouds.drawio'));
    expect(pages.map((p) => [p.name, p.type])).toEqual([
      ['Azure shop', 'azure'],
      ['AWS three tier', 'cloud'],
      ['Cluster', 'kubernetes'],
    ]);
    expect(pages[1]!.yaml).toContain('provider: aws');
    expect(pages[0]!.yaml).toMatch(/web-shop: \{ kind: app-service, label: Web shop, in: virtual-network \}/);
    expect(pages[0]!.report.join('\n')).toMatch(/Loose text.*Draft, not reviewed/);
  });

  it('reads a page compressed the way draw.io does', async () => {
    const plain = fixture('boxes-plain.xml');
    const model = plain.slice(plain.indexOf('<mxGraphModel'), plain.lastIndexOf('</mxGraphModel>') + '</mxGraphModel>'.length);
    const packed = base64Bytes(deflateSync(strToU8(encodeURIComponent(model))));
    const file = `<mxfile host="app.diagrams.net"><diagram id="x" name="Packed">${packed}</diagram></mxfile>`;
    expect(isDrawio(file)).toBe(true);
    const [page] = importDrawio(file);
    const [same] = importDrawio(plain);
    expect(page!.name).toBe('Packed');
    expect(page!.yaml.replace(/^title: .*\n/m, '')).toBe(same!.yaml.replace(/^title: .*\n/m, ''));
    await clean(page!.yaml);
    expect(() => importDrawio(`<mxfile><diagram name="Broken">not-deflate</diagram></mxfile>`)).toThrow(/could not be unpacked/);
  });

  it('turns plain boxes into a systems diagram, guessing kinds from the shapes', async () => {
    const [page] = importDrawio(fixture('boxes-plain.xml'), { title: 'boxes' });
    expect(page!.type).toBe('systems');
    expect(page!.yaml).toContain('orders: { kind: database');
    expect(page!.yaml).toContain('order-events: { kind: queue');
    expect(page!.yaml).toContain('customer: { kind: user');
    expect(page!.yaml).toContain('order-service <-> stripe: pays');
    await clean(page!.yaml);
  });

  it('reads draw.io tables as an ERD', async () => {
    const [page] = importDrawio(fixture('tables.drawio'));
    expect(page!.type).toBe('erd');
    expect(page!.yaml).toContain('customer_id: text fk customers.id');
    await clean(page!.yaml);
  });

  it('keeps the positions as pins only when asked', async () => {
    const [free] = importDrawio(fixture('boxes-plain.xml'));
    expect(free!.sidecar).toBeUndefined();
    const [kept] = importDrawio(fixture('boxes-plain.xml'), { keepPositions: true });
    const pins = kept!.sidecar!;
    expect(Object.keys(pins.nodes ?? {}).sort()).toEqual(['customer', 'order-events', 'order-service', 'orders', 'stripe', 'web-shop']);
    // Relative to the drawing: the left-most and top-most shapes start near 0.
    const xs = Object.values(pins.nodes!).map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(80);
    await clean(kept!.yaml, pins);
  });

  it('reads its own export back to the same diagram', async () => {
    for (const file of ['systems/saas-platform.yaml', 'azure/hub-spoke.yaml', 'kubernetes/platform.yaml', 'network/campus.yaml', 'erd/shop-schemas.yaml', 'sequence/checkout.yaml']) {
      const a = await example(file);
      const [back] = importDrawio(toDrawio([toScene(a)]), { keepPositions: true });
      expect(back!.type, file).toBe(a.type!.id);
      const b = await clean(back!.yaml, back!.sidecar);
      expect(content(b), file).toEqual(content(a));
    }
  });

  it('says plainly what is not a draw.io file', () => {
    expect(isDrawio('type: systems')).toBe(false);
    expect(() => importDrawio('<svg/>')).toThrow(/Not a draw.io file/);
  });
});

describe('Excalidraw', () => {
  it('writes bound arrows, bound text and frames that point at each other', async () => {
    const r = await example('systems/saas-platform.yaml');
    const file = JSON.parse(toExcalidraw(toScene(r)));
    expect(file.type).toBe('excalidraw');
    const all = file.elements as { id: string; type: string; containerId?: string | null; frameId?: string | null; boundElements: { id: string }[] | null; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null }[];
    const byId = new Map(all.map((e) => [e.id, e]));
    expect(byId.size).toBe(all.length);
    const arrows = all.filter((e) => e.type === 'arrow' && (e.startBinding || e.endBinding));
    expect(arrows.length).toBe(r.graph!.edges.length);
    for (const a of arrows) {
      for (const end of [a.startBinding, a.endBinding]) {
        const shape = byId.get(end!.elementId)!;
        expect(shape, a.id).toBeTruthy();
        expect(shape.boundElements?.some((b) => b.id === a.id), `${shape.id} knows ${a.id}`).toBe(true);
      }
    }
    for (const t of all.filter((e) => e.type === 'text' && e.containerId)) expect(byId.get(t.containerId!)?.boundElements?.some((b) => b.id === t.id), t.id).toBe(true);
    for (const e of all.filter((e) => e.frameId)) expect(byId.get(e.frameId!)?.type, e.id).toBe('frame');
    expect(all.some((e) => e.type === 'frame')).toBe(true);
  });

  it('reads a hand-made sketch: containers, bound text, arrows, and says what it left out', async () => {
    const text = fixture('sketch.excalidraw');
    expect(isExcalidraw(text)).toBe(true);
    expect(isExcalidraw('{"type":"other"}')).toBe(false);
    const d = importExcalidraw(text, { keepPositions: true });
    expect(d.type).toBe('systems');
    expect(d.yaml).toContain('order-api: { kind: api, label: Order API, caption: Node.js, in: backend }');
    expect(d.yaml).toContain('data-stores: { kind: group, label: Data stores, in: backend }');
    expect(d.yaml).toContain('orders-database: { kind: database, label: Orders database, in: data-stores }');
    expect(d.yaml).toContain('customer -> order-api: places order');
    expect(d.yaml).toContain('order-api <-> orders-database: { line: dashed }');
    // The deleted shape is gone, the freehand line and the empty box are named in the report.
    expect(d.yaml).not.toContain('gone');
    const report = d.report.join('\n');
    expect(report).toMatch(/without text were left out/);
    expect(report).toMatch(/drawing\(s\).*left out/);
    expect(Object.keys(d.sidecar!.nodes ?? {})).toContain('customer');
    await clean(d.yaml, d.sidecar);
  });

  it('reads its own export back to the same diagram', async () => {
    for (const file of ['systems/web-shop.yaml', 'cloud/aws-three-tier.yaml', 'erd/orders.yaml', 'sequence/oauth-login.yaml']) {
      const a = await example(file);
      const back = importExcalidraw(toExcalidraw(toScene(a)), { keepPositions: true });
      expect(back.type, file).toBe(a.type!.id);
      const b = await clean(back.yaml, back.sidecar);
      expect(content(b), file).toEqual(content(a));
    }
  });
});

describe('Mermaid export', () => {
  /** Out to Mermaid and back in through the Mermaid importer: the same things, joined the same way. */
  async function roundTrip(file: string, kind: string) {
    const a = await example(file);
    const m = toMermaid(a);
    expect(m.kind, file).toBe(kind);
    const back = importMermaid(m.text);
    const b = await clean(back.yaml);
    return { a, b, m };
  }

  it('a systems diagram is a flowchart with its subgraphs', async () => {
    const { a, b, m } = await roundTrip('systems/saas-platform.yaml', 'flowchart');
    expect(m.text).toMatch(/subgraph /);
    expect(b.graph!.nodes.map((n) => n.id).sort()).toEqual(a.graph!.nodes.map((n) => n.id).sort());
    expect(b.graph!.edges.map((e) => `${e.from.node}>${e.to.node}`).sort()).toEqual(a.graph!.edges.map((e) => `${e.from.node}>${e.to.node}`).sort());
    expect(b.graph!.groups.map((g) => g.id).sort()).toEqual(a.graph!.groups.map((g) => g.id).sort());
  });

  it('a cloud diagram is a flowchart, the icons said to be lost', async () => {
    const { a, b, m } = await roundTrip('azure/web-shop.yaml', 'flowchart');
    expect(b.graph!.nodes.length).toBe(a.graph!.nodes.length);
    expect(b.graph!.edges.length).toBe(a.graph!.edges.length);
    expect(m.warnings.join('\n')).toMatch(/icon/i);
  });

  it('an ERD is an erDiagram with its columns and relations', async () => {
    const { a, b } = await roundTrip('erd/orders.yaml', 'erDiagram');
    expect(b.graph!.nodes.map((n) => n.id).sort()).toEqual(a.graph!.nodes.map((n) => n.id).sort());
    const rows = (r: RenderResult) => r.graph!.nodes.map((n) => `${n.id}:${n.shape.kind === 'table' ? n.shape.rows.map((row) => (row.kind === 'row' ? row.id : '')).join(',') : ''}`).sort();
    expect(rows(b)).toEqual(rows(a));
    expect(b.graph!.edges.length).toBe(a.graph!.edges.length);
  });

  it('a sequence is a sequenceDiagram, message for message', async () => {
    const { a, b } = await roundTrip('sequence/checkout.yaml', 'sequenceDiagram');
    expect(b.graph!.nodes.map((n) => n.id)).toEqual(a.graph!.nodes.map((n) => n.id));
    expect(b.graph!.edges.map((e) => e.label)).toEqual(a.graph!.edges.map((e) => e.label));
  });

  it('a state machine is a stateDiagram, composite states and all', async () => {
    const { a, b, m } = await roundTrip('states/pull-request.yaml', 'stateDiagram-v2');
    expect(m.text).toMatch(/state "In review" as In_review \{/);
    expect(m.text).toMatch(/note right of Draft/);
    expect(b.type!.id).toBe('states');
    const hops = (r: RenderResult) => r.graph!.edges.filter((e) => e.label).map((e) => e.label).sort();
    expect(hops(b)).toEqual(hops(a));
  });

  it('a process is a flowchart with its lanes, events and gateways', async () => {
    const { a, b, m } = await roundTrip('process/order-to-cash.yaml', 'flowchart');
    expect(m.text).toMatch(/subgraph finance\["Finance"\]/);
    expect(m.text).toMatch(/Credit-ok\{"Credit ok\?"\}/);
    expect(m.text).toMatch(/Order-closed\(\(\("Order closed"\)\)\)/);
    expect(b.graph!.edges.length).toBe(a.graph!.edges.length);
  });

  it('git, journey and roadmap have a Mermaid diagram of their own', async () => {
    expect(toMermaid(await example('gitflow/git-flow.yaml')).kind).toBe('gitGraph');
    expect(toMermaid(await example('journey/first-deploy.yaml')).kind).toBe('journey');
    expect(toMermaid(await example('roadmap/now-next-later.yaml')).kind).toMatch(/gantt|timeline/);
  });
});

describe('Office-safe SVG', () => {
  it('leaves nothing Office drops: no CSS, variables, filters, markers or foreignObject', async () => {
    for (const file of ['systems/saas-platform.yaml', 'azure/web-shop.yaml', 'erd/orders.yaml', 'sequence/checkout.yaml']) {
      const r = await example(file);
      expect(unsafeConstructs(r.svg!).length, `${file} as drawn`).toBeGreaterThan(0);
      const safe = toSafeSvg(r.svg!);
      expect(unsafeConstructs(safe), file).toEqual([]);
      expect(safe).not.toMatch(/var\(--|<style|filter=|<foreignObject|marker-end=/);
      expect(() => parseXml(safe)).not.toThrow();
      // The words are all still there, in a font every machine has.
      for (const n of r.graph!.nodes) {
        const label = labelOf(n);
        if (label) expect(safe, `${file} ${n.id}`).toContain(label.replace(/&/g, '&amp;').split('\n')[0]!);
      }
      expect(safe).toMatch(/font-family="Arial/);
    }
  });

  it('draws text as outlines when given an outliner', async () => {
    const r = await example('systems/web-shop.yaml');
    const box = 'M0 0h5v-8h-5z';
    const safe = toSafeSvg(r.svg!, { outline: (s) => ({ d: box, width: s.length * 5 }) });
    expect(safe).not.toMatch(/<text\b/);
    expect(safe).toContain(box);
    expect(unsafeConstructs(safe)).toEqual([]);
  });
});

// The layout benchmark: the same diagrams drawn by Cartography, Mermaid and D2 (dagre, ELK and TALA,
// when the d2 binary is installed), each tool's SVG reduced to boxes and sampled lines in headless
// Chromium, and measured the same way (src/geometry.ts). Then one shape and one line are added and each
// is drawn again, to see how far the rest moves. Writes docs/benchmark/results.json, the tables in
// docs/benchmark.md and a picture of every drawing in docs/benchmark/png.
//   pnpm bench                 every case and every tool found
//   pnpm bench login-flow      only cases whose name contains the word
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chromium, type Page } from '@playwright/test';
import { render } from '@cartography/engine';
import { displacement, measure, type Displacement, type Drawing, type Metrics, type Rect } from './geometry.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const docs = path.join(root, 'docs');
const outDir = path.join(docs, 'benchmark');
const pngDir = path.join(outDir, 'png');
const require = createRequire(import.meta.url);

interface Case {
  id: string;
  title: string;
  /** What kind of drawing: the benchmark only takes diagrams that are boxes and lines in every tool. */
  kind: string;
  mmd: string;
  d2?: string;
  /** One shape and one line, appended to each source. */
  edit: { mmd: string; d2?: string };
}

const cmp = (f: string) => `comparison/src/${f}`;
const own = (f: string) => `benchmark/src/${f}`;
export const CASES: Case[] = [
  { id: 'microservices', title: 'Order platform', kind: 'flowchart, 2 groups', mmd: cmp('microservices.mmd'), d2: cmp('microservices.d2'), edit: { mmd: 'orders --> audit[Audit log]', d2: 'audit: Audit log\nplatform.orders -> audit' } },
  { id: 'data-platform', title: 'Analytics platform', kind: 'flowchart, 4 groups', mmd: cmp('data-platform.mmd'), d2: cmp('data-platform.d2'), edit: { mmd: 'wh --> reverse[Reverse ETL]', d2: 'reverse: Reverse ETL\nlake.wh -> reverse' } },
  { id: 'leave-request', title: 'Leave request', kind: 'flowchart in lanes', mmd: cmp('leave-request.mmd'), d2: cmp('leave-request.d2'), edit: { mmd: 'done --> payroll[Tell payroll]', d2: 'payroll: Tell payroll\nHR.done -> payroll' } },
  { id: 'login-flow', title: 'Sign-in flow', kind: 'flowchart with decisions', mmd: cmp('login-flow.mmd'), d2: cmp('login-flow.d2'), edit: { mmd: 'home --> logout[Sign out]', d2: 'logout: Sign out\nhome -> logout' } },
  { id: 'serverless', title: 'Photo uploads', kind: 'architecture, nested groups', mmd: cmp('serverless.mmd'), d2: cmp('serverless.d2'), edit: { mmd: 'service audit(database)[Audit log] in storage\nmeta:R --> L:audit', d2: 'aws.storage.audit: Audit log {shape: cylinder}\naws.storage.meta -> aws.storage.audit' } },
  { id: 'shop-schema', title: 'Shop schema', kind: 'entity relationship', mmd: cmp('shop-schema.mmd'), d2: cmp('shop-schema.d2'), edit: { mmd: 'PRODUCT ||--o{ REVIEW : has\nREVIEW {\n  uuid id PK\n  uuid product_id FK\n  int stars\n}', d2: 'review: {\n  shape: sql_table\n  id: uuid {constraint: primary_key}\n  product_id: uuid {constraint: foreign_key}\n  stars: int\n}\nreview.product_id -> product.id: has' } },
  { id: 'order-states', title: 'Order lifecycle', kind: 'state machine', mmd: cmp('order-states.mmd'), d2: own('order-states.d2'), edit: { mmd: 'Delivered --> Returned: customer returns', d2: 'Returned\nDelivered -> Returned: customer returns' } },
  { id: 'event-mesh', title: 'Event mesh', kind: 'dense flowchart', mmd: own('event-mesh.mmd'), d2: own('event-mesh.d2'), edit: { mmd: 'stockTopic --> forecast[Demand forecast]', d2: 'forecast: Demand forecast\nstockTopic -> forecast' } },
  { id: 'cloud-platform', title: 'Cloud platform', kind: 'flowchart, 3 levels of groups', mmd: own('cloud-platform.mmd'), d2: own('cloud-platform.d2'), edit: { mmd: 'api --> search[(Search index)]', d2: 'cloud.vpc.datasubnet.search: Search index {shape: cylinder}\ncloud.vpc.private.api -> cloud.vpc.datasubnet.search' } },
  { id: 'ci-pipeline', title: 'Delivery pipeline', kind: 'flowchart with loops', mmd: own('ci-pipeline.mmd'), d2: own('ci-pipeline.d2'), edit: { mmd: 'smoke --> notify[Notify the team]', d2: 'notify: Notify the team\nsmoke -> notify' } },
];

export type ToolId = 'cartography' | 'mermaid' | 'd2-dagre' | 'd2-elk' | 'd2-tala';
export const TOOLS: { id: ToolId; name: string; note: string }[] = [
  { id: 'cartography', name: 'Cartography', note: 'The Mermaid source converted to YAML once, untouched (`docs/benchmark/cartography`), default theme, no hand-tuning' },
  { id: 'mermaid', name: 'Mermaid', note: 'The `mermaid` npm package, default config, in headless Chromium' },
  { id: 'd2-dagre', name: 'D2 · dagre', note: 'D2 default layout' },
  { id: 'd2-elk', name: 'D2 · ELK', note: 'D2 with `--layout elk`' },
  { id: 'd2-tala', name: 'D2 · TALA', note: 'D2 with `--layout tala` (TALA is proprietary and needs a licence for use beyond evaluation)' },
];

export interface ToolResult {
  metrics?: Metrics;
  /** After adding one shape and one line, drawn from scratch. */
  edit?: Displacement;
  /** Cartography only: the same edit drawn knowing the drawing before (what the editor and `--stable` do). */
  editKept?: Displacement;
  skipped?: string;
}
export interface Results {
  generated: string;
  versions: Record<string, string>;
  tools: typeof TOOLS;
  skippedTools: Record<string, string>;
  cases: { id: string; title: string; kind: string; sources: string[]; results: Partial<Record<ToolId, ToolResult>> }[];
}

// ---------------------------------------------------------------- tools

const which = (bin: string) => {
  try {
    return execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
};
const d2Version = which('d2');
const plantuml = which('plantuml');
const mermaidVersion = (JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('mermaid/package.json')), 'package.json'), 'utf8')) as { version: string }).version;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-bench-'));

function d2Svg(source: string, layout: string): string {
  const input = path.join(tmp, 'in.d2');
  const output = path.join(tmp, 'out.svg');
  fs.writeFileSync(input, source);
  execFileSync('d2', ['--layout', layout, '--pad', '0', input, output], { stdio: 'ignore', timeout: 120_000 });
  return fs.readFileSync(output, 'utf8');
}

async function mermaidSvg(page: Page, text: string): Promise<string> {
  return page.evaluate(async (src) => {
    const m = (window as unknown as { mermaid: { initialize(o: object): void; render(id: string, t: string): Promise<{ svg: string }> } }).mermaid;
    m.initialize({ startOnLoad: false, theme: 'default' });
    return (await m.render(`m${Math.random().toString(36).slice(2, 8)}`, src)).svg;
  }, text);
}

/** Puts an SVG on the page at its natural size and reduces it to boxes and sampled lines. */
/** Mermaid and D2 size their SVG to the page (width 100%, max-width): pinned to its natural size, as drawn. */
function natural(svg: string): string {
  return svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/^<svg\b[^>]*>/, (tag) => {
    const vb = /viewBox="([^"]+)"/.exec(tag)?.[1]?.trim().split(/[\s,]+/).map(Number);
    if (!vb) return tag;
    return tag.replace(/\s(width|height|style)="[^"]*"/g, '').replace(/^<svg/, `<svg width="${vb[2]}" height="${vb[3]}"`);
  });
}

async function extract(page: Page, svg: string, tool: ToolId): Promise<Drawing> {
  const clean = natural(svg);
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff"><div id="d" style="display:inline-block">${clean}</div></body>`);
  // tsx names functions with a helper the page does not have.
  await page.evaluate('window.__name = (f) => f');
  return page.evaluate((tool) => {
    const svg = document.querySelector('#d svg') as SVGSVGElement;
    const origin = svg.getBoundingClientRect();
    const rect = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height };
    };
    const sample = (p: SVGGeometryElement): [number, number][] => {
      const len = p.getTotalLength();
      const m = p.getScreenCTM()!;
      const n = Math.max(2, Math.ceil(len / 3));
      const out: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const q = p.getPointAtLength((len * i) / n);
        const s = new DOMPoint(q.x, q.y).matrixTransform(m);
        out.push([s.x - origin.x, s.y - origin.y]);
      }
      return out;
    };
    const nodes: { id: string; x: number; y: number; w: number; h: number }[] = [];
    const lines: { id: string; pts: [number, number][] }[] = [];
    const labels: { x: number; y: number; w: number; h: number }[] = [];
    const visible = (r: { w: number; h: number }) => r.w > 0.5 && r.h > 0.5;

    if (tool === 'cartography') {
      for (const g of svg.querySelectorAll('[data-node]')) nodes.push({ id: g.getAttribute('data-node')!, ...rect(g) });
      for (const g of svg.querySelectorAll('[data-edge]')) {
        const line = [...g.querySelectorAll(':scope > path')].find((p) => p.getAttribute('fill') === 'none') as SVGPathElement | undefined;
        if (line) lines.push({ id: g.getAttribute('data-edge')!, pts: sample(line) });
      }
      // A line's label is a text set on a halo (a rect of the ground's colour) outside any shape.
      for (const t of svg.querySelectorAll('text')) {
        if (t.closest('[data-node],[data-group],[data-edge]')) continue;
        const halo = t.previousElementSibling;
        if (halo?.tagName !== 'rect') continue;
        const a = rect(halo);
        const b = rect(t);
        if (Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) < 2 && Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) < 4) labels.push(b);
      }
    } else if (tool === 'mermaid') {
      for (const g of svg.querySelectorAll('g.node, g.architecture-service')) {
        const raw = g.id.replace(/^[a-z0-9]+-/, '');
        const id = /^(?:flowchart|entity|state|service)-(.+?)(?:-\d+)?$/.exec(raw)?.[1] ?? raw;
        nodes.push({ id, ...rect(g) });
      }
      [...svg.querySelectorAll('g.edgePaths path, g.architecture-edges path')].forEach((p, i) => lines.push({ id: p.id || `e${i}`, pts: sample(p as SVGPathElement) }));
      for (const g of svg.querySelectorAll('g.edgeLabel')) {
        if (!g.textContent?.trim()) continue;
        const inner = g.querySelector('.label, foreignObject, text') ?? g;
        const r = rect(inner);
        if (visible(r)) labels.push(r);
      }
    } else {
      // D2: each object and connection is a <g> whose class is its id in base64.
      const decode = (g: Element) => {
        try {
          return atob(g.getAttribute('class') ?? '');
        } catch {
          return '';
        }
      };
      const shapes = [...svg.querySelectorAll('g.shape')].map((s) => ({ g: s.parentElement!, s, id: decode(s.parentElement!) })).filter((x) => x.id && x.id !== 'title');
      const ids = shapes.map((x) => x.id);
      for (const x of shapes) {
        // A container (an id other ids start with) is a group, not a shape.
        if (ids.some((o) => o.startsWith(`${x.id}.`))) continue;
        nodes.push({ id: x.id, ...rect(x.s) });
      }
      for (const p of svg.querySelectorAll('path.connection')) {
        const g = p.parentElement!;
        lines.push({ id: decode(g) || `e${lines.length}`, pts: sample(p as SVGPathElement) });
        for (const t of g.querySelectorAll(':scope > text')) {
          const r = rect(t);
          if (t.textContent?.trim() && visible(r)) labels.push(r);
        }
      }
    }
    return { nodes: nodes.filter(visible), lines: lines.filter((l) => l.pts.length > 1), labels };
  }, tool);
}

// ---------------------------------------------------------------- run

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const cases = CASES.filter((c) => !only.length || only.some((w) => c.id.includes(w)));
const skippedTools: Record<string, string> = {};
if (!d2Version) for (const t of ['d2-dagre', 'd2-elk', 'd2-tala']) skippedTools[t] = 'the d2 binary is not installed (https://d2lang.com); install it and run pnpm bench again';
skippedTools.plantuml = plantuml
  ? 'PlantUML is installed, but the benchmark has no PlantUML sources or SVG reader yet'
  : 'PlantUML is not installed here (it needs Java and the plantuml jar); not measured';
const tools = TOOLS.filter((t) => !skippedTools[t.id]);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
const mermaidPage = await browser.newPage();
await mermaidPage.setContent('<!doctype html><body></body>');
await mermaidPage.addScriptTag({ path: require.resolve('mermaid/dist/mermaid.min.js') });
fs.mkdirSync(pngDir, { recursive: true });

/** A picture of the drawing as it was measured, for the benchmark page. */
async function picture(svg: string, file: string) {
  const clean = natural(svg);
  await page.setContent(`<!doctype html><body style="margin:0;background:#fff"><div id="d" style="display:inline-block;padding:12px;background:#fff">${clean}</div></body>`);
  const box = await page.locator('#d').boundingBox();
  // Big drawings are pictured smaller: the page shows them at most 900 px wide.
  const scale = box ? Math.min(1, 900 / box.width) : 1;
  await page.evaluate((s) => {
    const d = document.querySelector('#d') as HTMLElement;
    d.style.zoom = String(s);
  }, scale);
  await page.locator('#d').screenshot({ path: file });
}

const previous: Results | undefined = fs.existsSync(path.join(outDir, 'results.json')) ? JSON.parse(fs.readFileSync(path.join(outDir, 'results.json'), 'utf8')) : undefined;
const results: Results = {
  generated: new Date().toISOString().slice(0, 10),
  versions: { cartography: 'this commit', mermaid: mermaidVersion, ...(d2Version ? { d2: d2Version } : {}) },
  tools: TOOLS,
  skippedTools,
  cases: [],
};

for (const c of CASES) {
  if (!cases.includes(c)) {
    const kept = previous?.cases.find((x) => x.id === c.id);
    if (kept) results.cases.push(kept);
    continue;
  }
  const mmd = fs.readFileSync(path.join(docs, c.mmd), 'utf8');
  const mmdEdited = `${mmd.trimEnd()}\n${c.edit.mmd.split('\n').map((l) => `    ${l}`).join('\n')}\n`;
  const d2 = c.d2 ? fs.readFileSync(path.join(docs, c.d2), 'utf8') : undefined;
  const d2Edited = d2 && c.edit.d2 ? `${d2.trimEnd()}\n${c.edit.d2}\n` : undefined;
  const row: Results['cases'][number] = { id: c.id, title: c.title, kind: c.kind, sources: [c.mmd, ...(c.d2 ? [c.d2] : [])], results: {} };
  for (const t of tools) {
    try {
      let before: string;
      let after: string;
      let kept: string | undefined;
      if (t.id === 'cartography') {
        const yaml = fs.readFileSync(path.join(outDir, 'cartography', `${c.id}.yaml`), 'utf8');
        const r = await render(yaml, { interactive: true });
        if (!r.svg) throw new Error(r.diagnostics.map((d) => d.message).join('; '));
        before = r.svg;
        const edited = fs.readFileSync(path.join(outDir, 'cartography', `${c.id}-edited.yaml`), 'utf8');
        after = (await render(edited, { interactive: true, previous: null })).svg!;
        kept = (await render(edited, { interactive: true, previous: r.placed?.memory })).svg!;
      } else if (t.id === 'mermaid') {
        before = await mermaidSvg(mermaidPage, mmd);
        after = await mermaidSvg(mermaidPage, mmdEdited);
      } else {
        if (!d2 || !d2Edited) {
          row.results[t.id] = { skipped: 'no D2 source for this case' };
          continue;
        }
        const layout = t.id.slice(3);
        before = d2Svg(d2, layout);
        after = d2Svg(d2Edited, layout);
      }
      const a = await extract(page, before, t.id);
      const b = await extract(page, after, t.id);
      if (!a.nodes.length) throw new Error('no shapes found in the SVG');
      const res: ToolResult = { metrics: measure(a), edit: displacement(a, b) };
      if (kept) res.editKept = displacement(a, await extract(page, kept, t.id));
      row.results[t.id] = res;
      await picture(before, path.join(pngDir, `${c.id}-${t.id}.png`));
      const m = res.metrics!;
      console.log(`${c.id.padEnd(16)} ${t.id.padEnd(12)} nodes ${m.nodes} lines ${m.lines}  crossings ${m.crossings}  touches ${m.touches}  bends ${m.bends}  turning ${m.turning.toFixed(0)}  length ${m.length.toFixed(2)}  area ${m.area.toFixed(1)}  labels ${m.labelOverlaps}  through ${m.throughShapes}  moved ${(res.edit!.mean * 100).toFixed(1)}%${res.editKept ? ` (kept ${(res.editKept.mean * 100).toFixed(1)}%)` : ''}`);
    } catch (e) {
      row.results[t.id] = { skipped: `failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}` };
      console.error(`${c.id} ${t.id}: ${row.results[t.id]!.skipped}`);
    }
  }
  results.cases.push(row);
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });

fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
writeTables(results);
console.log(`→ docs/benchmark/results.json, docs/benchmark.md, docs/benchmark/png`);

// ---------------------------------------------------------------- the tables in docs/benchmark.md

function writeTables(r: Results) {
  const file = path.join(docs, 'benchmark.md');
  const text = fs.readFileSync(file, 'utf8');
  const start = '<!-- results:start -->';
  const end = '<!-- results:end -->';
  if (!text.includes(start) || !text.includes(end)) throw new Error('docs/benchmark.md has no results markers');
  const shown = r.tools.filter((t) => !r.skippedTools[t.id]);
  const fmt = (v: number | undefined, digits = 0) => (v == null ? '–' : v.toFixed(digits));
  const table = (title: string, pick: (x: ToolResult) => number | undefined, digits = 0, total = digits === 0) => {
    const lowerIsBetter = true;
    const lines = [`### ${title}`, '', `| Case | ${shown.map((t) => t.name).join(' | ')} |`, `| --- | ${shown.map(() => '---:').join(' | ')} |`];
    for (const c of r.cases) {
      const vals = shown.map((t) => (c.results[t.id]?.metrics || c.results[t.id]?.edit ? pick(c.results[t.id]!) : undefined));
      const present = vals.filter((v): v is number => v != null).map((v) => Number(v.toFixed(digits)));
      const best = present.length ? (lowerIsBetter ? Math.min(...present) : Math.max(...present)) : undefined;
      lines.push(`| ${c.title} | ${vals.map((v) => (v == null ? '–' : Number(v.toFixed(digits)) === best && present.length > 1 ? `**${fmt(v, digits)}**` : fmt(v, digits))).join(' | ')} |`);
    }
    const totals = shown.map((t) => r.cases.reduce((n, c) => n + (pick(c.results[t.id] ?? {}) ?? 0), 0));
    if (total) lines.push(`| **Total** | ${totals.map((v) => fmt(v)).join(' | ')} |`);
    return lines.join('\n');
  };
  const pct = (v: number | undefined) => (v == null ? undefined : v * 100);
  // Where another tool does better, in words, so the losses are read first and not dug out of tables.
  const others = shown.filter((t) => t.id !== 'cartography');
  const losses: string[] = [];
  const lose = (what: string, pick: (x: ToolResult) => number | undefined, show: (v: number) => string, margin = 0) => {
    for (const c of r.cases) {
      const mine = pick(c.results.cartography ?? {});
      if (mine == null) continue;
      const better = others.map((t) => ({ t, v: pick(c.results[t.id] ?? {}) })).filter((x): x is { t: (typeof others)[number]; v: number } => x.v != null && x.v < mine - margin);
      if (better.length) losses.push(`- **${c.title}**, ${what}: Cartography ${show(mine)}; ${better.map((b) => `${b.t.name} ${show(b.v)}`).join(', ')}`);
    }
  };
  lose('crossings', (x) => x.metrics?.crossings, String);
  lose('label overlaps', (x) => x.metrics?.labelOverlaps, String);
  lose('unrelated lines touching', (x) => x.metrics?.touches, String);
  lose('white space (area per shape area, more than 1.5 more)', (x) => x.metrics?.area, (v) => v.toFixed(1), 1.5);
  lose('movement after the edit, from scratch (more than 5 points more)', (x) => (x.edit ? x.edit.mean * 100 : undefined), (v) => `${v.toFixed(1)} %`, 5);
  const wide = r.cases.filter((c) => (c.results.cartography?.metrics?.aspect ?? 0) > 4).map((c) => `${c.title} (${c.results.cartography!.metrics!.aspect.toFixed(1)} : 1)`);
  if (wide.length) losses.push(`- **Very wide drawings** that will not fit a slide or a page without shrinking: ${wide.join(', ')}`);
  const body = [
    '### Where Cartography loses',
    '',
    ...(losses.length ? losses : ['- Nowhere on these measures.']),
    '',
    `Generated ${r.generated} with Mermaid ${r.versions.mermaid}${r.versions.d2 ? ` and D2 ${r.versions.d2}` : ''}. Best value per row in bold (lower is better everywhere).`,
    '',
    table('Edge crossings', (x) => x.metrics?.crossings),
    '',
    table('Unrelated lines touching (they meet and part on one track)', (x) => x.metrics?.touches),
    '',
    table('Bends', (x) => x.metrics?.bends),
    '',
    table('Turning per line, degrees (a right angle is 90, a curve counts its sweep)', (x) => x.metrics?.turning, 0, false),
    '',
    table('Line labels overlapping a label or a shape', (x) => x.metrics?.labelOverlaps),
    '',
    table('Lines passing through a shape that is not one of their ends', (x) => x.metrics?.throughShapes),
    '',
    table('Mean line length, in shape sizes', (x) => x.metrics?.length, 2),
    '',
    table('Area per shape area (white space; lower is tighter)', (x) => x.metrics?.area, 1),
    '',
    table('Displacement after adding one shape and one line, % of the diagonal (drawn from scratch)', (x) => pct(x.edit?.mean), 1),
    '',
    `Cartography also keeps the drawing before the edit in mind when it can (the editor does, and \`carto render --stable\`). Drawn that way, the same edits move the shapes that were there by:`,
    '',
    `| Case | From scratch | Knowing the drawing before |`,
    `| --- | ---: | ---: |`,
    ...r.cases.map((c) => {
      const x = c.results.cartography;
      return `| ${c.title} | ${fmt(pct(x?.edit?.mean), 1)} % | ${fmt(pct(x?.editKept?.mean), 1)} % |`;
    }),
    '',
    '### Aspect ratio (width / height; a 16:9 slide is 1.78)',
    '',
    `| Case | ${shown.map((t) => t.name).join(' | ')} |`,
    `| --- | ${shown.map(() => '---:').join(' | ')} |`,
    ...r.cases.map((c) => `| ${c.title} | ${shown.map((t) => fmt(c.results[t.id]?.metrics?.aspect, 2)).join(' | ')} |`),
    '',
    ...(Object.keys(r.skippedTools).length ? ['Not measured:', '', ...Object.entries(r.skippedTools).map(([t, why]) => `- ${t}: ${why}`)] : []),
  ].join('\n');
  fs.writeFileSync(file, text.slice(0, text.indexOf(start) + start.length) + '\n\n' + body + '\n\n' + text.slice(text.indexOf(end)));
}

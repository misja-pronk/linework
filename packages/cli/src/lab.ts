// Layout lab: runs layout variants over all examples and compares quality metrics.
// Variants are layout overrides; add one to compare an idea against the current layout.
//   pnpm lab [outDir] [variant…]
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@linework/engine';
import { measure, score, type LayoutMetrics, type Tuning } from '@linework/layout';
import { toPng } from './png.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const [outDir = path.join(root, 'gallery/lab'), ...only] = process.argv.slice(2);

export const variants: Record<string, Tuning> = {
  best: {},
  'no-align': { align: false },
  plain: { compact: false },
  compact: { compact: true },
  down: { direction: 'down' },
  untidy: { tidy: false },
  same: { dot: { sameRank: true } },
  reverse: { dot: { reverse: true } },
  'ord-out': { dot: { attrs: 'ordering=out' } },
  'ord-in': { dot: { attrs: 'ordering=in' } },
  mclimit: { dot: { attrs: 'mclimit=4, remincross=true' } },
  search: { dot: { attrs: 'searchsize=200, nslimit=50' } },
};

// The examples, plus the Mermaid imports drawn for the comparison with other tools.
const files = [
  ...fs
    .readdirSync(path.join(root, 'examples'))
    .flatMap((d) => fs.readdirSync(path.join(root, 'examples', d)).filter((f) => f.endsWith('.yaml')).map((f) => path.join('examples', d, f))),
  ...fs.readdirSync(path.join(root, 'docs/comparison/linework')).filter((f) => f.endsWith('.yaml')).map((f) => path.join('docs/comparison/linework', f)),
].sort();

fs.mkdirSync(outDir, { recursive: true });
const names = only.length ? only : Object.keys(variants);
const totals: Record<string, { score: number; m: LayoutMetrics[] }> = {};
const rows: string[] = [];

for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const cells: string[] = [];
  for (const name of names) {
    const tuning = variants[name]!;
    const load = (rel: string) => fs.readFileSync(path.resolve(root, path.dirname(file), rel), 'utf8');
    const t0 = performance.now();
    const r = await render(text, { fonts: 'none', tuning, load }).catch(() => undefined);
    const ms = performance.now() - t0;
    if (!r) {
      cells.push(`<td><b>${name}</b> crashed</td>`);
      (totals[name] ??= { score: 0, m: [] }).score += 9999;
      continue;
    }
    if (!r.graph || !r.placed || !r.svg) continue;
    const dir = tuning.direction ?? r.graph.direction;
    const m = measure({ ...r.graph, direction: dir }, r.placed);
    const sc = score(m);
    (totals[name] ??= { score: 0, m: [] }).score += sc;
    totals[name]!.m.push(m);
    const png = `${file.startsWith('docs') ? 'cmp-' : ''}${path.basename(file, '.yaml')}--${name}.png`;
    fs.writeFileSync(path.join(outDir, png), toPng(r.svg, 1));
    cells.push(
      `<td><b>${name}</b> ${sc.toFixed(0)}<br><small>cross ${m.crossings} · through ${m.edgeThroughNode} · labels ${m.labelOverlaps} · back ${m.backward} · bends ${m.bends} · len ${m.edgeLength} · detour ${m.detour} · empty ${m.groupEmpty} · voids ${m.voids} · aligned ${m.aligned} · tight ${m.tightPairs} · gap ${m.minGap} · uneven ${m.uneven} · borders ${m.borderHits} · ports ${m.portCrowding} · ${m.width}×${m.height} · ${ms.toFixed(0)}ms</small><br><img src="${png}"></td>`,
    );
  }
  rows.push(`<tr><th>${file}</th>${cells.join('')}</tr>`);
}

const sum = (list: LayoutMetrics[], k: keyof LayoutMetrics) => list.reduce((s, m) => s + (m[k] as number), 0);
const mean = (list: LayoutMetrics[], k: keyof LayoutMetrics) => sum(list, k) / Math.max(1, list.length);
const cols: [string, (m: LayoutMetrics[]) => string][] = [
  ['cross', (l) => String(sum(l, 'crossings'))],
  ['through', (l) => String(sum(l, 'edgeThroughNode'))],
  ['labels', (l) => String(sum(l, 'labelOverlaps'))],
  ['back', (l) => String(sum(l, 'backward'))],
  ['bends', (l) => String(sum(l, 'bends'))],
  ['length', (l) => sum(l, 'edgeLength').toFixed(0)],
  ['detour', (l) => mean(l, 'detour').toFixed(2)],
  ['empty', (l) => mean(l, 'groupEmpty').toFixed(2)],
  ['voids', (l) => mean(l, 'voids').toFixed(2)],
  ['aligned', (l) => mean(l, 'aligned').toFixed(2)],
  ['tight', (l) => String(sum(l, 'tightPairs'))],
  ['mingap', (l) => mean(l, 'minGap').toFixed(1)],
  ['uneven', (l) => sum(l, 'uneven').toFixed(1)],
  ['borders', (l) => String(sum(l, 'borderHits'))],
  ['ports', (l) => String(sum(l, 'portCrowding'))],
];
console.log(['variant     ', 'score', ...cols.map(([c]) => c)].map((c) => c.padStart(7)).join(' '));
for (const [name, t] of Object.entries(totals).sort((a, b) => a[1].score - b[1].score))
  console.log([name.padEnd(12), t.score.toFixed(0), ...cols.map(([, f]) => f(t.m))].map((c) => c.padStart(7)).join(' '));
// Per example, for the first variant: where the score comes from.
if (process.env.LAB_DETAIL)
  for (const [i, file] of files.entries()) {
    const m = totals[names[0]!]?.m[i];
    if (m) console.log(file.padEnd(44), score(m).toFixed(0).padStart(5), cols.map(([c, f]) => `${c} ${f([m])}`).join(' '));
  }
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><style>body{font:12px system-ui}td{vertical-align:top;padding:8px}img{max-width:700px;border:1px solid #ddd}</style><table>${rows.join('')}</table>`,
);

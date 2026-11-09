// Layout lab: runs layout variants over all examples and compares quality metrics.
// Variants are layout overrides; add one to compare an idea against the current layout.
//   pnpm lab [outDir] [variant…]
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@cartography/engine';
import { measure, score, type LayoutMetrics, type Tuning } from '@cartography/layout';
import { toPng } from './png.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const [outDir = path.join(root, 'gallery/lab'), ...only] = process.argv.slice(2);

export const variants: Record<string, Tuning> = {
  right: {},
  down: { direction: 'down' },
};

const files = fs
  .readdirSync(path.join(root, 'examples'))
  .flatMap((d) => fs.readdirSync(path.join(root, 'examples', d)).filter((f) => f.endsWith('.yaml')).map((f) => path.join('examples', d, f)))
  .sort();

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
    const r = await render(text, { fonts: 'none', tuning, load }).catch(() => undefined);
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
    const png = `${path.basename(file, '.yaml')}--${name}.png`;
    fs.writeFileSync(path.join(outDir, png), toPng(r.svg, 1));
    cells.push(
      `<td><b>${name}</b> ${sc.toFixed(0)}<br><small>cross ${m.crossings} · through ${m.edgeThroughNode} · labels ${m.labelOverlaps} · back ${m.backward} · bends ${m.bends} · len ${m.edgeLength} · ${m.width}×${m.height}</small><br><img src="${png}"></td>`,
    );
  }
  rows.push(`<tr><th>${file}</th>${cells.join('')}</tr>`);
}

const sum = (list: LayoutMetrics[], k: keyof LayoutMetrics) => list.reduce((s, m) => s + (m[k] as number), 0);
console.log('variant      score  cross  through labels back  bends  length');
for (const [name, t] of Object.entries(totals).sort((a, b) => a[1].score - b[1].score))
  console.log(
    `${name.padEnd(12)} ${t.score.toFixed(0).padStart(5)}  ${String(sum(t.m, 'crossings')).padStart(5)}  ${String(sum(t.m, 'edgeThroughNode')).padStart(7)} ${String(sum(t.m, 'labelOverlaps')).padStart(6)} ${String(sum(t.m, 'backward')).padStart(4)}  ${String(sum(t.m, 'bends')).padStart(5)}  ${sum(t.m, 'edgeLength').toFixed(0).padStart(6)}`,
  );
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><style>body{font:12px system-ui}td{vertical-align:top;padding:8px}img{max-width:700px;border:1px solid #ddd}</style><table>${rows.join('')}</table>`,
);

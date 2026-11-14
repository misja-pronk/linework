// Layout snapshot: every example (and each of its views) as a PNG plus the positions of its nodes and
// groups, and a comparison of two such snapshots. For checking that a layout change moved only what
// it meant to.
//   pnpm snapshot <outDir>              render examples/ into outDir (PNG + positions.json)
//   pnpm snapshot --compare <a> <b>     what moved between two snapshots, and each canvas's area
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@linework/engine';
import { measure, score } from '@linework/layout';
import { toPng } from './png.ts';

const root = path.resolve(import.meta.dirname, '../../..');

interface Shot {
  width: number;
  height: number;
  score: number;
  crossings: number;
  direction: string;
  nodes: Record<string, [number, number]>;
  groups: Record<string, [number, number, number, number]>;
}

function exampleFiles(): string[] {
  return fs
    .readdirSync(path.join(root, 'examples'))
    .flatMap((d) => fs.readdirSync(path.join(root, 'examples', d)).filter((f) => f.endsWith('.yaml')).map((f) => path.join('examples', d, f)))
    .sort();
}

async function take(outDir: string) {
  fs.mkdirSync(outDir, { recursive: true });
  const shots: Record<string, Shot> = {};
  for (const file of exampleFiles()) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const load = (rel: string) => fs.readFileSync(path.resolve(root, path.dirname(file), rel), 'utf8');
    const first = await render(text, { fonts: 'none', load, file: path.basename(file) });
    const runs: [string | undefined, typeof first][] = [[undefined, first]];
    for (const v of first.views ?? []) runs.push([v.name, await render(text, { fonts: 'none', load, file: path.basename(file), view: v.name })]);
    for (const [view, r] of runs) {
      if (!r.svg || !r.graph || !r.placed) continue;
      const key = file.replace(/^examples\//, '') + (view ? `#${view}` : '');
      const m = measure(r.graph, r.placed);
      shots[key] = {
        width: r.width!,
        height: r.height!,
        score: Math.round(score(m) * 10) / 10,
        crossings: m.crossings,
        direction: r.graph.direction,
        nodes: Object.fromEntries([...r.placed.nodes].map(([id, b]) => [id, [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]])),
        groups: Object.fromEntries([...r.placed.groups].map(([id, b]) => [id, [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]])),
      };
      fs.writeFileSync(path.join(outDir, key.replace(/[/#]/g, '--').replace(/\.yaml/, '') + '.png'), toPng(r.svg, 1));
    }
  }
  fs.writeFileSync(path.join(outDir, 'positions.json'), JSON.stringify(shots, null, 1));
  console.log(`${Object.keys(shots).length} drawings → ${outDir}`);
}

function compare(a: string, b: string) {
  const before = JSON.parse(fs.readFileSync(path.join(a, 'positions.json'), 'utf8')) as Record<string, Shot>;
  const after = JSON.parse(fs.readFileSync(path.join(b, 'positions.json'), 'utf8')) as Record<string, Shot>;
  let changed = 0;
  for (const key of Object.keys({ ...before, ...after }).sort()) {
    const p = before[key];
    const q = after[key];
    if (!p || !q) {
      console.log(`${key.padEnd(44)} ${p ? 'gone' : 'new'}`);
      continue;
    }
    const ids = Object.keys(p.nodes).filter((id) => q.nodes[id]);
    // Relative to the drawing's first node, so a shift of the whole canvas is not movement.
    const rel = (s: Shot, id: string) => [s.nodes[id]![0] - s.nodes[ids[0]!]![0], s.nodes[id]![1] - s.nodes[ids[0]!]![1]] as const;
    const moved = ids.filter((id) => Math.hypot(rel(p, id)[0] - rel(q, id)[0], rel(p, id)[1] - rel(q, id)[1]) > 4).length;
    const area = (s: Shot) => s.width * s.height;
    const same = !moved && p.width === q.width && p.height === q.height && p.score === q.score;
    if (same) continue;
    changed++;
    const pct = (((area(q) - area(p)) / area(p)) * 100).toFixed(0);
    console.log(
      `${key.padEnd(44)} moved ${String(moved).padStart(3)}/${String(ids.length).padEnd(3)} ${p.width}×${p.height} → ${q.width}×${q.height} (area ${Number(pct) >= 0 ? '+' : ''}${pct}%) score ${p.score} → ${q.score} cross ${p.crossings} → ${q.crossings}${p.direction !== q.direction ? ` ${p.direction} → ${q.direction}` : ''}`,
    );
  }
  console.log(`${changed} of ${Object.keys(after).length} drawings changed`);
}

const args = process.argv.slice(2);
if (args[0] === '--compare' && args[1] && args[2]) compare(args[1], args[2]);
else if (args[0]) await take(args[0]);
else console.error('pnpm snapshot <outDir> | pnpm snapshot --compare <before> <after>');

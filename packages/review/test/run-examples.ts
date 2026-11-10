// Not a test: prints what the packs find in every example (tsx packages/review/test/run-examples.ts).
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@cartography/engine';
import { review } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../../examples');
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.ya?ml$/.test(e.name) ? [path.join(d, e.name)] : []));
let total = 0;
for (const f of walk(root)) {
  const text = fs.readFileSync(f, 'utf8');
  if (!/^type:\s*\S/m.test(text) || /\.(block|odcs)\.ya?ml$/.test(f)) continue;
  const load = (x: string) => fs.readFileSync(path.resolve(path.dirname(f), x), 'utf8');
  const r = await render(text, { fonts: 'none', load, file: path.basename(f) });
  const out = review(text, r, { load });
  const live = out.findings.filter((x) => !x.ignored);
  total += live.length;
  if (live.length) console.log(`${path.relative(root, f)} (${r.type?.id}): ${live.length}`);
  for (const x of live) console.log(`  ${x.id} ${x.severity} ${x.rule.id} — ${x.message}${x.line ? ` :${x.line}` : ''}`);
  for (const p of out.problems) console.log(`  problem: ${p.message}`);
}
console.log(`total ${total}`);

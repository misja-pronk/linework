// The built-in examples are what people copy: they pass the review, or show a few deliberate,
// sensible findings (a design without monitoring, a namespace without a NetworkPolicy). A rule that
// starts to fire a lot on them is noisy; the snapshot says which rule fires where.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { combinations, run, wizards } from '@cartography/wizards';
import { review } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../../examples');
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.ya?ml$/.test(e.name) ? [path.join(d, e.name)] : []));
const diagrams = walk(root).filter((f) => !/\.(block|odcs)\.ya?ml$/.test(f) && /^type:\s*\S/m.test(fs.readFileSync(f, 'utf8')));

describe('the examples under review', () => {
  it('stay quiet: at most three findings a file, no errors', async () => {
    const seen: Record<string, string[]> = {};
    for (const f of diagrams) {
      const text = fs.readFileSync(f, 'utf8');
      const load = (x: string) => fs.readFileSync(path.resolve(path.dirname(f), x), 'utf8');
      const r = await render(text, { fonts: 'none', load, file: path.basename(f) });
      const live = review(text, r, { load }).findings.filter((x) => !x.ignored);
      expect(live.length, path.relative(root, f)).toBeLessThanOrEqual(3);
      expect(live.filter((x) => x.severity === 'error'), path.relative(root, f)).toEqual([]);
      if (live.length) seen[path.relative(root, f)] = live.map((x) => x.rule.id);
    }
    expect(seen).toMatchSnapshot();
  }, 120_000);

  it('wizard outputs, in every combination of answers, stay as quiet', async () => {
    const seen: Record<string, number> = {};
    for (const w of wizards)
      for (const answers of combinations(w, 24)) {
        const text = run(w, answers);
        const r = await render(text, { fonts: 'none' });
        const live = review(text, r).findings.filter((x) => !x.ignored);
        expect(live.length, `${w.id} ${JSON.stringify(answers)}: ${live.map((x) => x.message).join('; ')}`).toBeLessThanOrEqual(3);
        expect(live.filter((x) => x.severity === 'error')).toEqual([]);
        for (const x of live) seen[`${w.id} ${x.rule.id}`] = (seen[`${w.id} ${x.rule.id}`] ?? 0) + 1;
      }
    expect(seen).toMatchSnapshot();
  }, 300_000);
});

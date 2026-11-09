// Layout quality guard: every example must stay clean, and crossings may not creep up.
// When a change improves an example, lower its budget.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { measure } from '@cartography/layout';
import { render } from '../src/index.ts';
import { big } from './perf.ts';

const examples = path.resolve(import.meta.dirname, '../../../examples');
const crossingBudget: Record<string, number> = {
  'access/engineering.yaml': 4,
  'access/engineering-access.yaml': 0,
  'access/engineering-packages.yaml': 0,
  'access/engineering-roles.yaml': 0,
  'azure/data-platform.yaml': 0,
  'azure/hub-spoke.yaml': 1,
  'azure/microservices.yaml': 9,
  'azure/web-shop.yaml': 0,
  'erd/orders.yaml': 0,
  'erd/saas.yaml': 8,
  'erd/shop-schemas.yaml': 0,
  'github/setup.yaml': 0,
};

describe('layout quality', () => {
  const files = fs.readdirSync(examples).flatMap((d) => fs.readdirSync(path.join(examples, d)).map((f) => `${d}/${f}`));
  it('has a budget for every example', () => expect(files.sort()).toEqual(Object.keys(crossingBudget).sort()));

  for (const file of files)
    it(file, async () => {
      const r = await render(fs.readFileSync(path.join(examples, file), 'utf8'), { fonts: 'none' });
      const m = measure(r.graph!, r.placed!);
      expect({ through: m.edgeThroughNode, labels: m.labelOverlaps, backward: m.backward }).toEqual({ through: 0, labels: 0, backward: 0 });
      expect(m.crossings).toBeLessThanOrEqual(crossingBudget[file]!);
    });

  it('lays out 200 nodes in under a second', async () => {
    await render(big(2, 5), { fonts: 'none' }); // load Graphviz first
    const t = performance.now();
    const r = await render(big(10, 20), { fonts: 'none' });
    expect(r.graph!.nodes).toHaveLength(200);
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

// The SVG for PowerPoint, Word and Keynote: nothing Office drops, every word still there.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@cartography/engine';
import type { GraphNode } from '@cartography/core';
import { parseXml } from '../src/template/xml.ts';
import { toSafeSvg, unsafeConstructs } from '../src/svg-safe.ts';

vi.setConfig({ testTimeout: 30_000 });

const root = path.resolve(import.meta.dirname, '../../..');

async function example(file: string): Promise<RenderResult> {
  const f = path.join(root, 'examples', file);
  const r = await render(fs.readFileSync(f, 'utf8'), { fonts: 'none', load: (rel: string) => fs.readFileSync(path.join(path.dirname(f), rel), 'utf8') });
  expect(r.graph, file).toBeTruthy();
  return r;
}

/** The words a node is known by: a card's label, a table's title. */
const labelOf = (n: GraphNode) => ('label' in n.shape ? n.shape.label : 'title' in n.shape ? n.shape.title : undefined) as string | undefined;

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

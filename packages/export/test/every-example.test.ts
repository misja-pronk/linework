import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { toPptx } from '../src/index.ts';

// Every example as a deck: no slide may come out empty, whatever the type (docs/capabilities.md).
const examples = fileURLToPath(new URL('../../../examples', import.meta.url));
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

describe('pptx of every example', () => {
  const files = fs.readdirSync(examples).flatMap((d) => (fs.statSync(path.join(examples, d)).isDirectory() ? fs.readdirSync(path.join(examples, d)).filter((f) => f.endsWith('.yaml') && !f.endsWith('.block.yaml')).map((f) => `${d}/${f}`) : []));
  it('finds the examples', () => expect(files.length).toBeGreaterThan(50));
  for (const file of files)
    it(file, async () => {
      const load = (rel: string) => fs.readFileSync(path.resolve(examples, path.dirname(file), rel), 'utf8');
      const r = await render(fs.readFileSync(path.join(examples, file), 'utf8'), { fonts: 'none', load });
      if (!r.graph || !r.placed) return;
      const warnings: string[] = [];
      const zip = unzipSync(await toPptx(r, { steps: false, rasterize: () => PNG, onWarning: (w) => warnings.push(w) }));
      const slides = Object.keys(zip).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
      expect(slides.length).toBeGreaterThan(0);
      for (const s of slides) {
        // Inside the diagram's group, before its legend: shapes, pictures, connectors or tables.
        const xml = strFromU8(zip[s]!);
        const from = xml.indexOf('name="Diagram: ');
        const legend = xml.indexOf('name="Legend', from);
        const drawing = xml.slice(from, legend < 0 ? undefined : legend);
        expect((drawing.match(/<p:(sp|pic|cxnSp|graphicFrame)>/g) ?? []).length, s).toBeGreaterThan(0);
      }
      // What has no native drawing is a picture, and the export says so.
      const pictured = r.graph.nodes.some((n) => ['sequence', 'gitflow', 'roadmap'].includes(n.shape.kind));
      expect(warnings.some((w) => w.includes('drawn as a picture, not native shapes'))).toBe(pictured);
    });
});

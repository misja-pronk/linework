// Every example in words, as `carto describe` writes it: a file per drawing (and per view) under
// __snapshots__/describe, so a change in wording shows up in review as a change in text.
import fs from 'node:fs';
import path from 'node:path';
import { describe as group, expect, it, vi } from 'vitest';

// A file with views is drawn once per view.
vi.setConfig({ testTimeout: 30_000 });
import { describe, toText } from '@cartography/describe';
import { isDiagramFile } from '@cartography/core';
import { render } from '../src/index.ts';

const root = new URL('../../../examples/', import.meta.url).pathname;
function diagrams(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'contracts' || e.name === 'products' ? [] : diagrams(p);
    return /\.ya?ml$/.test(e.name) && isDiagramFile(e.name, fs.readFileSync(p, 'utf8')) ? [p] : [];
  });
}

const words = async (file: string, view?: string) => {
  const r = await render(fs.readFileSync(file, 'utf8'), { fonts: 'none', load: (rel) => fs.readFileSync(path.resolve(path.dirname(file), rel), 'utf8'), view });
  return toText(describe({ ...r, name: path.basename(file) }));
};

group('every example in words', () => {
  for (const file of diagrams(root).sort()) {
    const name = path.relative(root, file).replace(/\.ya?ml$/, '').replace(/[\\/]/g, '--');
    it(name, async () => {
      const first = await render(fs.readFileSync(file, 'utf8'), { fonts: 'none', load: (rel) => fs.readFileSync(path.resolve(path.dirname(file), rel), 'utf8') });
      await expect(await words(file)).toMatchFileSnapshot(`__snapshots__/describe/${name}.txt`);
      for (const v of first.views ?? []) if (v.name !== first.view) await expect(await words(file, v.name)).toMatchFileSnapshot(`__snapshots__/describe/${name}#${v.name}.txt`);
    });
  }
});

group('the text alternative in the SVG', () => {
  it('names the drawing and points at its description; a step says which', async () => {
    const r = await render(fs.readFileSync(path.join(root, 'systems/invoice-walkthrough.yaml'), 'utf8'), { fonts: 'none' });
    const head = /<svg[^>]*>/.exec(r.svg!)![0];
    expect(head).toContain('role="img"');
    const label = /aria-labelledby="([^"]+)"/.exec(head)![1]!;
    const desc = /aria-describedby="([^"]+)"/.exec(head)![1]!;
    expect(r.svg).toContain(`<title id="${label}">Checkout without waiting</title>`);
    expect(r.svg).toMatch(new RegExp(`<desc id="${desc}">Architecture diagram: Proposal for the steering group`));
    const step = await render(fs.readFileSync(path.join(root, 'systems/invoice-walkthrough.yaml'), 'utf8'), { fonts: 'none', step: 3 });
    expect(step.svg).toContain('Checkout without waiting, step 3 of 7: Then checkout waits for Finance</title>');
  });

  it('is left to the editor and viewers in an interactive drawing', async () => {
    const r = await render('type: systems\nnodes: { a: service }\n', { fonts: 'none', interactive: true });
    expect(r.svg).not.toContain('role="img"');
    expect(r.svg).not.toContain('<desc');
  });
});

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

group('in the order it is drawn', () => {
  it('tells lanes top to bottom (or left to right), as they are drawn, not by where their first step is met', async () => {
    const text = `type: process
lanes: { dev: Developer, github: GitHub, actions: Actions }
nodes:
  Push: { in: dev }
  Checks: { in: actions }
  Merge: { in: github }
flow:
  - Push -> Checks -> Merge
`;
    const r = await render(text, { fonts: 'none' });
    const lanes = r.graph!.groups.filter((g) => g.lane);
    const drawn = [...lanes].sort((a, b) => r.placed!.groups.get(a.id)!.y - r.placed!.groups.get(b.id)!.y || r.placed!.groups.get(a.id)!.x - r.placed!.groups.get(b.id)!.x).map((g) => g.label);
    expect(drawn).toEqual(['Developer', 'GitHub', 'Actions']);
    const told = describe({ ...r }).sections[0]!.items.map((i) => i.text.replace(/ \(lane\)$/, ''));
    expect(told).toEqual(drawn);
  });

  it('says a kind drawn as its icon in the key is an icon, not a pill', async () => {
    const r = await render(fs.readFileSync(path.join(root, 'data-products/northwind-mesh.yaml'), 'utf8'), { fonts: 'none' });
    const key = toText(describe({ ...r }));
    expect(key).not.toContain('filled pill');
    expect(key).toMatch(/Teal icon: Source-aligned/);
  });
});

group('how big, in the words of its kind', () => {
  it('counts what a sequence has, participants and messages, not the one picture it is drawn as', async () => {
    const r = await render('type: sequence\nparticipants:\n  a: person\n  b: service\n  c: service\nmessages:\n  - a -> b: Asks\n  - b -> c: Reads\n  - c --> b: Rows\n  - b --> a: Answers\n', { fonts: 'none' });
    expect(describe({ ...r }).size).toBe('3 participants and 4 messages');
  });
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

  it('is the same for the drawing as written and the type view it is written for', async () => {
    const text = fs.readFileSync(path.join(root, 'journey/first-deploy.yaml'), 'utf8');
    const load = (rel: string) => fs.readFileSync(path.resolve(root, 'journey', rel), 'utf8');
    expect((await render(text, { fonts: 'none', load, view: 'map' })).svg).toBe((await render(text, { fonts: 'none', load })).svg);
  });

  it('is left to the editor and viewers in an interactive drawing', async () => {
    const r = await render('type: systems\nnodes: { a: service }\n', { fonts: 'none', interactive: true });
    expect(r.svg).not.toContain('role="img"');
    expect(r.svg).not.toContain('<desc');
  });
});

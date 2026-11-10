// Snapshots: kept per document in the browser, written next to the diagram in a folder, the two merged.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dropSnapshot, folderSnapshots, freeLabel, isSnapshotPath, memoryBackend, mergeSnapshots, slug, snapshotPath, takeSnapshot } from '../src/compare/snapshots.ts';
import { joinPath, prefetched } from '../src/compare/versions.ts';

describe('snapshots', () => {
  it('name files git can keep, next to the diagram', () => {
    expect(slug('Q3 review')).toBe('Q3-review');
    expect(slug('2026-11-10 14.05')).toBe('2026-11-10-14.05');
    expect(slug('Café / “before”')).toBe('Cafe-before');
    expect(slug('../../etc')).toBe('etc');
    expect(slug('   ')).toBe('snapshot');
    expect(snapshotPath('docs/shop.yaml', 'Q3 review')).toBe('docs/shop.snapshots/Q3-review.yaml');
    expect(isSnapshotPath('docs/shop.snapshots/Q3-review.yaml')).toBe(true);
    expect(isSnapshotPath('docs/shop.yaml')).toBe(false);
  });

  it('are kept per document, newest first; the same label replaces', async () => {
    const b = memoryBackend();
    await takeSnapshot(b, 'shop', { label: 'one', text: 'a', at: 1 });
    await takeSnapshot(b, 'shop', { label: 'two', text: 'b', at: 2 });
    await takeSnapshot(b, 'other', { label: 'one', text: 'x', at: 3 });
    expect((await takeSnapshot(b, 'shop', { label: 'One', text: 'c', at: 4 })).map((s) => s.text)).toEqual(['c', 'b']);
    expect((await b.get('other')).map((s) => s.text)).toEqual(['x']);
    expect((await dropSnapshot(b, 'shop', 'two')).map((s) => s.label)).toEqual(['One']);
  });

  it('in the folder win over the browser copy of the same label, and bring their pins', () => {
    const files = new Map([
      ['shop.yaml', { text: 'now' }],
      ['shop.snapshots/Q3-review.yaml', { text: 'folder' }],
      ['shop.snapshots/Q3-review.layout.json', { text: '{"version":1,"nodes":{"web":{"x":1,"y":2}}}' }],
      ['shop.snapshots/old.yaml', { text: 'old' }],
      ['shop.snapshots/deeper/x.yaml', { text: 'no' }],
      ['other.snapshots/x.yaml', { text: 'no' }],
    ]);
    const folder = folderSnapshots('shop.yaml', files);
    expect(folder.map((s) => s.label).sort()).toEqual(['Q3-review', 'old']);
    expect(folder.find((s) => s.label === 'Q3-review')!.pins?.nodes?.web).toEqual({ x: 1, y: 2 });
    const merged = mergeSnapshots([{ label: 'Q3 review', text: 'browser', at: 5 }, { label: 'local', text: 'l', at: 4 }], folder);
    expect(merged.map((s) => [s.label, s.text, !!s.path])).toEqual([
      ['Q3 review', 'folder', true],
      ['local', 'l', false],
      ['old', 'old', true],
    ]);
  });

  it('get a free label', () => {
    const list = [{ label: 'Snapshot 1', text: '', at: 0 }, { label: 'review', text: '', at: 0 }];
    expect(freeLabel(list)).toBe('Snapshot 3');
    expect(freeLabel(list, 'review')).toBe('review (2)');
    expect(freeLabel(list, 'fresh')).toBe('fresh');
  });
});

describe('versions', () => {
  it('join paths inside the repository only', () => {
    expect(joinPath('docs/shop.yaml', '../model/systems.yaml')).toBe('model/systems.yaml');
    expect(joinPath('shop.yaml', './a/b.yaml')).toBe('a/b.yaml');
    expect(joinPath('shop.yaml', '../outside.yaml')).toBeUndefined();
    expect(joinPath('shop.yaml', '/etc/passwd')).toBeUndefined();
  });

  it('read what a diagram includes before it is drawn, from that version', async () => {
    const model = fs.readFileSync(new URL('../../../examples/model/model.yaml', import.meta.url), 'utf8');
    const text = fs.readFileSync(new URL('../../../examples/model/deployment.yaml', import.meta.url), 'utf8').replace('include: [model.yaml]', 'include: [../model.yaml]');
    const asked: string[] = [];
    const load = await prefetched(text, 'docs/shop.yaml', async (p) => (asked.push(p), p === 'model.yaml' ? model : undefined));
    expect(asked).toContain('model.yaml');
    expect(load('../model.yaml')).toBe(model);
    expect(() => load('../../x.yaml')).toThrow(/outside/);
  });
});

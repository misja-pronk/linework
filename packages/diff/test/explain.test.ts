// The diff in plain sentences, and as Markdown for a change advisory board.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, explain, explainMarkdown, explainText, toldCounts, toldSummary } from '../src/index.ts';

// The two versions the structural diff tests use.
const src = fs.readFileSync(new URL('./diff.test.ts', import.meta.url), 'utf8');
const pick = (name: string) => src.split(`const ${name} = \``)[1]!.split('`;')[0]!;

describe('explain', () => {
  it('tells what is new, what changed and what is gone, by the names the drawing shows', async () => {
    const c = await compare(pick('before'), pick('after'));
    expect(explain(c.diff, c.before?.graph, c.after?.graph).map((x) => x.text)).toEqual([
      'Added subnet snet-edge in rg-shop',
      'Added Sessions (cache for Redis) in snet-data',
      'Web shop now connects to Sessions',
      'Moved Web shop from rg-shop to snet-edge',
      'Renamed “Orders” to “Orders service”',
      'Orders service → Orders: now “T-SQL” (was “SQL”)',
      // The line from Reports went with it: counted, not told on its own.
      'Removed Reports from rg-shop (and its connection)',
    ]);
  });

  it('points every sentence at its element, to focus it', async () => {
    const c = await compare(pick('before'), pick('after'));
    const items = explain(c.diff, c.before?.graph, c.after?.graph).map((x) => x.item && `${x.item.kind} ${x.item.id}`);
    expect(items).toEqual(['group edge', 'node cache', 'edge web -> cache', 'node web', 'node api', 'edge api -> db', 'node reports']);
  });

  it('as one line, and as Markdown with the table under it', async () => {
    const c = await compare(pick('before'), pick('after'));
    expect(explainText(c.diff, c.before?.graph, c.after?.graph)).toMatch(/^Added subnet snet-edge in rg-shop; added Sessions .*; removed Reports from rg-shop \(and its connection\)\.$/);
    const md = explainMarkdown(c.diff, c.before?.graph, c.after?.graph, { against: 'snapshot before-review' });
    // Counted as the list tells it: Reports and its line are one removal (the table below has both).
    expect(md).toMatch(/^## Changes to Web shop since snapshot before-review\n\n3 added, 1 removed, 3 changed\.\n\n- Added subnet snet-edge in rg-shop\n/);
    expect(toldCounts(c.diff, c.before?.graph, c.after?.graph)).toEqual({ added: 3, removed: 1, changed: 3 });
    expect(toldSummary(c.diff, c.before?.graph, c.after?.graph)).toBe('3 added, 1 removed, 3 changed');
    // The picture's key says the same.
    const svg = c.picture()!.svg;
    const key = svg.slice(svg.indexOf('data-diff-key'));
    expect([...key.matchAll(/>(\d+)<\/text>/g)].map((m) => m[1]).slice(0, 3)).toEqual(['3', '3', '1']);
    expect(md).toContain('### Element by element');
    expect(md).toContain('| + added | node | `cache` | Sessions |');
  });

  it('says so when nothing changed', async () => {
    const c = await compare(pick('after'), pick('after'));
    expect(explain(c.diff, c.before?.graph, c.after?.graph)).toEqual([]);
    expect(explainMarkdown(c.diff, c.before?.graph, c.after?.graph, { name: 'shop.yaml' })).toBe('## Changes to shop.yaml\n\nNo changes in what is drawn.\n');
  });

  it('marks one side alone for side-by-side panes', async () => {
    const c = await compare(pick('before'), pick('after'));
    const [was, is] = [c.side('before')!.svg, c.side('after')!.svg];
    expect(was).toContain('data-diff="removed" data-node="reports"');
    expect(was).not.toContain('data-node="cache"><rect');
    expect(is).toContain('data-diff="added" data-node="cache"');
    expect(is).not.toContain('data-diff="removed"');
  });
});

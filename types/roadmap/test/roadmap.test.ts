import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { icon } from '@cartography/icons';
import { render } from '@cartography/engine';
import { measureText, themes } from '@cartography/theme';
import { roadmapGeometry, type RoadmapGeometry } from '@cartography/render';
import type { Box, RoadmapShape } from '@cartography/core';
import { addDuration, parseDate, roadmap, roadmapReferences } from '../src/index.ts';
import { day } from '../src/dates.ts';

async function geometry(yaml: string) {
  const r = await render(yaml, { fonts: 'none' });
  const shape = r.graph?.nodes[0]?.shape as RoadmapShape;
  return { r, shape, g: roadmapGeometry(shape, themes.light) };
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

/** A bar with its label where it is drawn: inside, or beside it. */
function extent(b: RoadmapGeometry['bars'][number]): Box {
  if (b.inside) return b.box;
  const end = b.labelX + measureText(b.label, 12, 600);
  return { x: b.box.x, y: b.box.y, width: end - b.box.x, height: b.box.height };
}

describe('roadmap', () => {
  it('has icons for the type and the palette', () => {
    expect(icon(roadmap.icon!)).toBeDefined();
    for (const p of roadmap.palette) expect(icon(p.icon), p.kind).toBeDefined();
  });

  it('reads dates as ranges and durations in calendar units', () => {
    expect(parseDate('2026-03')).toEqual({ start: day(2026, 2, 1), end: day(2026, 3, 1) });
    expect(parseDate('2026-Q2')).toEqual({ start: day(2026, 3, 1), end: day(2026, 6, 1) });
    expect(parseDate(2026)).toEqual({ start: day(2026, 0, 1), end: day(2027, 0, 1) });
    expect(parseDate('2026-W01')!.start).toBe(day(2025, 11, 29));
    expect(parseDate('2026-02-30')).toBeUndefined();
    expect(addDuration(day(2026, 0, 31), '1m')).toBe(day(2026, 1, 31));
    expect(addDuration(day(2026, 0, 1), '2w')).toBe(day(2026, 0, 15));
    expect(addDuration(0, 'soon')).toBeUndefined();
  });

  it('schedules after: dependencies and draws them', async () => {
    const { r, shape, g } = await geometry(`type: roadmap
items:
  a: { from: 2026-01, to: 2026-02 }
  b: { from: 2026-01-10, duration: 10d }
  c: { after: [a, b], duration: 6w }
`);
    expect(r.diagnostics).toEqual([]);
    const c = shape.items.find((i) => i.id === 'c')!;
    expect(c.start).toBe(day(2026, 2, 1));
    expect(c.end).toBe(day(2026, 3, 12));
    expect(g.arrows).toHaveLength(2);
    expect(shape.ticks.map((t) => t.label)).toEqual(['Jan', 'Feb', 'Mar', 'Apr']);
  });

  it('keeps bars and their labels apart: overlapping items take tracks', async () => {
    const { g } = await geometry(fs.readFileSync(path.resolve(import.meta.dirname, '../../../examples/roadmap/migration-waves.yaml'), 'utf8'));
    const boxes = g.bars.map(extent);
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(overlap(a, b), `${JSON.stringify(a)} ${JSON.stringify(b)}`).toBe(false);
    // Every bar stays inside its lane.
    for (const b of g.bars) expect(g.lanes.some((l) => b.box.y >= l.top && b.box.y + b.box.height <= l.bottom)).toBe(true);
    expect(g.today).toBeDefined();
    expect(g.marks.map((m) => m.label)).toEqual(['Customer apps live', 'Data centre exit']);
    expect(g.legend.items).toEqual(['planned', 'active', 'done', 'at-risk', 'late']);
  });

  it('picks the unit from the span and works with named periods', async () => {
    const weeks = await geometry('type: roadmap\nitems:\n  a: { from: 2026-03-02, duration: 3w }\n');
    expect(weeks.shape.ticks[0]!.label).toBe('W10');
    const quarters = await geometry('type: roadmap\nitems:\n  a: { from: 2026-01, to: 2028-06 }\n');
    expect(quarters.shape.ticks.slice(0, 2).map((t) => t.label)).toEqual(['Q1', 'Q2']);
    const named = await geometry('type: roadmap\nperiods: [Now, Next, Later]\nitems:\n  a: { in: Next }\n  b: { after: a, duration: 1 }\n');
    expect(named.r.diagnostics).toEqual([]);
    expect(named.shape.items.map((i) => [i.start, i.end])).toEqual([[1, 2], [2, 3]]);
  });

  it('says what is wrong', async () => {
    const r = await render(`type: roadmap
items:
  a: { from: March, to: 2026-04 }
  b: { after: ghost, duration: 2w }
  c: { from: 2026-05, to: 2026-04 }
`, { fonts: 'none' });
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'There is no item "ghost"',
      '"March" is not a date: write 2026-03, 2026-03-15, 2026-Q2 or 2026-W14',
      'Give it from: (or at:, in:, after:) to place it on the axis',
      'It ends before it starts',
    ]);
  });

  it('follows lane and item renames; connecting makes the second wait for the first', () => {
    const src = { type: 'roadmap' as const, lanes: { ops: 'Ops' }, items: { a: { lane: 'ops' }, b: { lane: 'ops', after: ['a'] } } };
    expect(roadmapReferences(src).map((r) => [r.path.join('.'), r.id])).toEqual([
      ['items.a.lane', 'ops'],
      ['items.b.lane', 'ops'],
      ['items.b.after.0', 'a'],
    ]);
    expect(roadmap.connect!(src, 'a', 'b')).toEqual({ path: ['items', 'b', 'after'], value: 'a' });
  });

  it('renders its template', async () => {
    const r = await render(roadmap.template, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
  });
});

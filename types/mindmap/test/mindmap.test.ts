import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { BlockShape } from '@cartography/core';
import { render } from '../../../packages/engine/src/index.ts';
import { moved } from '../../../packages/engine/test/stability.ts';
import { CENTER, mindmap, readTopics, type MindmapSource } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/mindmap/${f}`, import.meta.url), 'utf8');
const errors = (r: Awaited<ReturnType<typeof render>>) => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
const shape = (r: Awaited<ReturnType<typeof render>>, id: string) => r.graph!.nodes.find((n) => n.id === id)!.shape as BlockShape;

describe('mind map', () => {
  it('reads topics nested and flat, with notes, levels and branch colours', async () => {
    const r = await render('type: mindmap\ncenter: Trip\ntopics:\n  Where: [Coast, Hills]\n  When: { tone: rose, topics: [Spring] }\n  Budget: Not more than last year\n  Hotels: { parent: Where }\n', { fonts: 'none' });
    expect(errors(r)).toEqual([]);
    expect(shape(r, CENTER)).toMatchObject({ form: 'topic', level: 0, label: 'Trip' });
    expect(shape(r, 'Where')).toMatchObject({ level: 1, tone: 'blue' });
    expect(shape(r, 'Coast')).toMatchObject({ level: 2, tone: 'blue' });
    expect(shape(r, 'Spring')).toMatchObject({ level: 2, tone: 'rose' });
    expect(shape(r, 'Budget')).toMatchObject({ caption: 'Not more than last year' });
    expect(r.graph!.edges.find((e) => e.to.node === 'Hotels')!.from.node).toBe('Where');
  });

  it('balances branches on both sides, clockwise from the top right', async () => {
    const r = await render(mindmap.template, { fonts: 'none' });
    expect(errors(r)).toEqual([]);
    const c = r.placed!.nodes.get(CENTER)!;
    const side = (id: string) => (r.placed!.nodes.get(id)!.x > c.x ? 'right' : 'left');
    expect(['Options', 'Must have', 'Operations', 'Risks', 'Next steps'].map(side)).toEqual(['right', 'right', 'left', 'left', 'left']);
    // Clockwise: the left side reads from the bottom up.
    expect(r.placed!.nodes.get('Operations')!.y).toBeGreaterThan(r.placed!.nodes.get('Next steps')!.y);
    // Fits a slide.
    expect(r.width! / r.height!).toBeGreaterThan(1.3);
  });

  it('keeps every topic clear of the others, and every line ends on its topic', async () => {
    for (const f of [...fs.readdirSync(new URL('../../../examples/mindmap/', import.meta.url)).map(example), mindmap.template]) {
      const r = await render(f, { fonts: 'none' });
      expect(errors(r)).toEqual([]);
      const boxes = [...r.placed!.nodes.values()];
      for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      for (const e of r.graph!.edges) {
        const pts = r.placed!.edges.get(e.id)!.points;
        const to = r.placed!.nodes.get(e.to.node)!;
        const end = pts.at(-1)!;
        expect(Math.min(Math.abs(end.x - to.x), Math.abs(end.x - to.x - to.width))).toBeLessThan(0.5);
      }
    }
  });

  it('folds deeper levels into a count with depth, and draws one side when asked', async () => {
    const r = await render(example('capability-brainstorm.yaml'), { fonts: 'none' });
    expect(shape(r, 'Data contracts').badge).toBe('+3');
    expect(r.graph!.nodes.some((n) => n.id === 'Schema checks')).toBe(false);
    const a = await render(example('workshop-agenda.yaml'), { fonts: 'none' });
    const c = a.placed!.nodes.get(CENTER)!;
    for (const [id, b] of a.placed!.nodes) if (id !== CENTER) expect(b.x).toBeGreaterThan(c.x + c.width);
  });

  it('keeps the drawing when a topic is added, and a branch on its side', async () => {
    const text = mindmap.template;
    const before = await render(text, { fonts: 'none' });
    const after = await render(text.replace('    - Lock-in to one vendor\n', '    - Lock-in to one vendor\n    - Licence costs grow with events\n'), { fonts: 'none', previous: before.placed!.memory });
    // The other side stays as it was; on this side the neighbours make room, no more than a topic's height.
    const was = before.placed!.memory!.nodes!;
    const now = after.placed!.memory!.nodes!;
    const c = was.get(CENTER)!;
    for (const [id, p] of was) {
      const q = now.get(id)!;
      if (p.x > c.x) expect([id, q.x - p.x, q.y - p.y]).toEqual([id, 0, 0]);
      else expect(Math.hypot(q.x - p.x, q.y - p.y), id).toBeLessThan(40);
    }
    expect(moved(was, now)).toBeLessThan(0.5);
    const side = (r: typeof before, id: string) => Math.sign(r.placed!.nodes.get(id)!.x - r.placed!.nodes.get(CENTER)!.x);
    for (const b of ['Options', 'Must have', 'Operations', 'Risks', 'Next steps']) expect(side(after, b)).toBe(side(before, b));
    // A new branch goes on a side without moving the others across.
    const more = await render(`${text}  Budget: [Licences, People]\n`, { fonts: 'none', previous: before.placed!.memory });
    for (const b of ['Options', 'Must have', 'Operations', 'Risks', 'Next steps']) expect(side(more, b)).toBe(side(before, b));
  });

  it('says what is wrong, and follows parent references', async () => {
    const r = await render('type: mindmap\ntopics:\n  A: { parent: Nowhere }\n  B: [C, D]\n  C: { parent: B }\n', { fonts: 'none' });
    expect(errors(r)).toEqual(['There is no topic "Nowhere"']);
    expect(r.graph!.nodes.map((n) => n.id)).toContain('C (4)');
    expect((await render('type: mindmap\ntopics:\n  B: { colour: red }\n', { fonts: 'none' })).diagnostics.map((d) => d.message)).toEqual(['Unknown field "colour"']);
    const src: MindmapSource = { type: 'mindmap', topics: { A: ['x'], B: { parent: 'A' } } };
    expect(mindmap.references!(src).map((x) => [x.path.join('.'), x.id])).toEqual([['topics.B.parent', 'A']]);
    expect(readTopics(src)[0]!.children.map((c) => c.id)).toEqual(['x', 'B']);
    expect(mindmap.connect!(src, 'A', 'B')).toEqual({ path: ['topics', 'B'], key: 'parent', value: 'A' });
  });
});

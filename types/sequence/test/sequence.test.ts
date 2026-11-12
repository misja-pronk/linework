import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { icon } from '@cartography/icons';
import { render } from '@cartography/engine';
import { themes } from '@cartography/theme';
import { sequenceGeometry, type SequenceGeometry } from '@cartography/render';
import type { Box, SequenceShape } from '@cartography/core';
import { kinds, sequence } from '../src/index.ts';

async function geometry(yaml: string, theme: 'light' | 'dark' = 'light') {
  const r = await render(yaml, { fonts: 'none', theme });
  expect(r.diagnostics, yaml).toEqual([]);
  const shape = r.graph!.nodes[0]!.shape as SequenceShape;
  return { r, shape, g: sequenceGeometry(shape, themes[theme]) };
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Boxes of every message label as drawn: centred on `mid` above the line, or right of a self-call loop. */
function labelBoxes(g: SequenceGeometry): Box[] {
  return g.messages
    .filter((m) => m.lines.length)
    .map((m) => {
      const h = m.lines.length * 16;
      // Widths are not stored; the row's own height keeps labels apart along the axis, which is what we check.
      return m.self ? { x: m.x2 + 10, y: m.y + m.self.h / 2 - h / 2, width: 1, height: h } : { x: m.mid, y: m.y - 6 - h, width: 1, height: h };
    });
}

const checkout = `type: sequence
autonumber: true
participants:
  a: person
  b: { kind: service, label: Orders }
  c: database
messages:
  - a -> b: Order with a label long enough to wrap onto a second line in the drawing for sure
  - b -> b: Check
  - b -> c: INSERT
  - c --> b: ok
  - b --> a: done
`;

describe('sequence', () => {
  it('has an icon for every kind and the palette', () => {
    for (const [kind, k] of Object.entries(kinds)) expect(icon(k.icon), kind).toBeDefined();
    for (const p of sequence.palette) expect(icon(p.icon), p.kind).toBeDefined();
  });

  it('resolves activations from calls and replies, numbers messages', async () => {
    const { shape } = await geometry(checkout);
    const m = shape.events.filter((e) => e.kind === 'message');
    expect(m.map((e) => e.number)).toEqual([1, 2, 3, 4, 5]);
    expect(m.map((e) => [!!e.opens, !!e.closes])).toEqual([[true, false], [true, false], [true, false], [false, true], [false, true]]);
    expect(shape.participants.map((p) => [p.label, p.caption])).toEqual([['Person', undefined], ['Orders', 'Service'], ['Database', undefined]]);
  });

  it('places messages in their own rows: lines and labels never overlap', async () => {
    const { g } = await geometry(checkout);
    const ys = g.messages.map((m) => m.y);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys);
    const labels = labelBoxes(g);
    for (const [i, a] of labels.entries()) for (const b of labels.slice(i + 1)) expect(a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    // A label sits above its own line and below the line before it.
    for (const [i, m] of g.messages.entries()) if (i && !m.self && m.lines.length) expect(m.y - 6 - m.lines.length * 16).toBeGreaterThanOrEqual(g.messages[i - 1]!.y + (g.messages[i - 1]!.self?.h ?? 0));
    // The long label wrapped; the gap is as wide as the widest line needs, headers never touch.
    expect(g.messages[0]!.lines.length).toBeGreaterThan(1);
    for (const [i, h] of g.headers.entries()) if (i) expect(h.x - h.width / 2).toBeGreaterThan(g.headers[i - 1]!.x + g.headers[i - 1]!.width / 2);
  });

  it('nests activation bars: a self-call steps out, the reply leaves from the bar', async () => {
    const { g } = await geometry(checkout);
    const bx = g.headers[1]!.x;
    const onB = g.bars.filter((b) => Math.abs(b.box.x + b.box.width / 2 - bx) < 10);
    expect(onB.length).toBe(2);
    expect(onB[1]!.box.x).toBeGreaterThan(onB[0]!.box.x);
    // The call to c ends at c's bar, not at its lifeline; the reply to a leaves b's bar edge.
    const call = g.messages[2]!;
    expect(call.x2).toBe(g.headers[2]!.x - 5);
    expect(g.messages[4]!.x1).toBe(bx - 5);
  });

  it('nests frames with growing insets, branches inside, and fits their tabs', async () => {
    const { g } = await geometry(`type: sequence
participants: { a: service, b: service }
messages:
  - loop: Every minute
    messages:
      - alt: ok
        messages:
          - a -> b: x
        else:
          Not ok: [ { b -> a: y } ]
          Timeout: []
`);
    const [outer, inner] = [g.frames.find((f) => f.ev.frame === 'loop')!, g.frames.find((f) => f.ev.frame === 'alt')!];
    expect(inner.box.x).toBeGreaterThan(outer.box.x);
    expect(inner.box.x + inner.box.width).toBeLessThan(outer.box.x + outer.box.width);
    expect(inner.box.y).toBeGreaterThan(outer.box.y);
    expect(inner.box.y + inner.box.height).toBeLessThan(outer.box.y + outer.box.height);
    expect(inner.branches.map((b) => b.label)).toEqual(['Not ok', 'Timeout']);
    for (const b of inner.branches) expect(b.y).toBeGreaterThan(inner.box.y);
    for (const m of g.messages) expect(m.y).toBeGreaterThan(inner.box.y + 20);
  });

  it('keeps notes, refs and dividers in rows of their own', async () => {
    const { g } = await geometry(`type: sequence
participants: { a: service, b: service, c: service }
messages:
  - a -> b: x
  - note: Over two lifelines, wrapped to their width when it is long enough to need it
    over: [a, b]
  - note: Beside
    right: c
  - divider: Phase two
  - ref: Login
    over: [b, c]
    link: login.yaml
  - b --> a: y
`);
    const things = [...g.notes.map((n) => n.box), ...g.refs.map((r) => r.box)];
    for (const [i, a] of things.entries()) for (const b of things.slice(i + 1)) expect(overlap(a, b)).toBe(false);
    for (const t of things) for (const m of g.messages) expect(m.y < t.y || m.y > t.y + t.height).toBe(true);
    expect(g.dividers).toHaveLength(1);
    expect(g.notes[1]!.box.x).toBeGreaterThan(g.headers[2]!.x);
  });

  it('boxes participants that belong together and keeps them side by side', async () => {
    const { shape, g } = await geometry(`type: sequence
boxes: { shop: Shop }
participants:
  a: { kind: service, box: shop }
  x: external
  b: { kind: database, box: shop }
messages: [ a -> x, x -> b ]
`);
    expect(shape.participants.map((p) => p.id)).toEqual(['a', 'b', 'x']);
    const box = g.boxes[0]!.box;
    expect(box.x + box.width).toBeLessThan(g.headers[2]!.x - g.headers[2]!.width / 2);
  });

  it('reports unknown participants and boxes on the step', async () => {
    const r = await render(`type: sequence
participants: { a: { kind: service, box: nope } }
messages:
  - a -> zz: hi
  - note: x
`, { fonts: 'none' });
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      'There is no box "nope"; add it under boxes',
      'There is no participant "zz"; add it under participants',
      'A note needs over:, left: or right: with a participant',
    ]);
  });

  it('reads the old steps: as messages:, with a warning to rename it', async () => {
    const old = await render('type: sequence\nparticipants: { a: person, b: service }\nsteps:\n  - a -> b: hi\n  - loop: again\n    steps: [ b --> a ]\n', { fonts: 'none' });
    expect(old.svg).toContain('hi');
    expect(old.diagnostics.map((d) => [d.severity, d.line])).toEqual([
      ['warning', 3],
      ['warning', 6],
    ]);
    expect(old.diagnostics[0]!.message).toMatch(/now called messages:/);
    const both = await render('type: sequence\nparticipants: { a: person, b: service }\nmessages: [ a -> b ]\nsteps: [ b -> a ]\n', { fonts: 'none' });
    expect(both.diagnostics.some((d) => d.severity === 'error' && /keep one/.test(d.message))).toBe(true);
    expect(sequence.connect!(parse('type: sequence\nparticipants: { a: person, b: service }\nsteps: [ a -> b ]\n'), 'b', 'a')).toEqual({ path: ['steps'], value: 'b -> a' });
  });

  it('validates the schema, nested frames included', async () => {
    const bad = await render('type: sequence\nparticipants: { a: robot }\nmessages:\n  - alt: x\n    messages:\n      - opt: y\n        messages: [ { a => a: z } ]\n', { fonts: 'none' });
    expect(bad.diagnostics.length).toBeGreaterThan(0);
    expect(bad.diagnostics.some((d) => d.line === 2)).toBe(true);
  });

  it('follows references through frames and connects with a message', () => {
    const src = parse(`type: sequence
participants: { a: service, b: service }
messages:
  - a -> b: x
  - alt: ok
    messages: [ b --> a ]
    else: { no: [ { note: n, over: [a, b] } ] }
  - activate: a
`);
    const refs = sequence.references!(src);
    expect(refs.map((r) => [r.path.join('.'), r.id, r.start])).toEqual([
      ['messages.0', 'a', 0],
      ['messages.0', 'b', 5],
      ['messages.1.messages.0', 'b', 0],
      ['messages.1.messages.0', 'a', 6],
      ['messages.1.else.no.0.over.0', 'a', 0],
      ['messages.1.else.no.0.over.1', 'b', 0],
      ['messages.2.activate', 'a', 0],
    ]);
    expect(sequence.connect!(src, 'a', 'b')).toEqual({ path: ['messages'], value: 'a -> b' });
    expect(typeof sequence.connect!(src, 'a', 'nope')).toBe('string');
  });

  it('offers a view per phase: its messages and participants, numbers and open activations carried on', async () => {
    const yaml = `type: sequence
title: Checkout
autonumber: true
participants:
  a: person
  b: service
  c: database
  d: queue
messages:
  - a -> b: Order
  - b -> c: Insert
  - c --> b: id
  - divider: Payment
  - alt: Paid
    messages:
      - b ->> d: Paid
      - divider: not a phase
    else: [b ->> d: Failed]
  - divider: Payment
  - ref: Shipping
  - b --> a: Done
`;
    expect(sequence.views!(parse(yaml))).toEqual([
      { name: 'whole', title: 'Whole sequence', scroll: true },
      { name: 'phase-start', title: 'Start' },
      { name: 'phase-payment', title: 'Payment' },
      { name: 'phase-payment-2', title: 'Payment' },
    ]);
    const whole = await render(yaml, { fonts: 'none' });
    expect(whole.scroll).toBe(true);
    expect(whole.views?.map((v) => v.name)).toEqual(['whole', 'phase-start', 'phase-payment', 'phase-payment-2']);
    const phase = async (view: string) => {
      const r = await render(yaml, { fonts: 'none', view });
      expect(r.diagnostics).toEqual([]);
      expect(r.scroll).toBeUndefined();
      expect(r.svg).not.toMatch(/NaN|undefined|Infinity/);
      return { r, shape: r.graph!.nodes[0]!.shape as SequenceShape };
    };
    const pay = await phase('phase-payment');
    expect(pay.r.graph!.subtitle).toBe('Payment');
    // Only who takes part; the divider inside the alt stays, the phase's own divider is the subtitle.
    expect(pay.shape.participants.map((p) => p.id)).toEqual(['b', 'd']);
    expect(pay.shape.events.map((e) => e.kind)).toEqual(['activate', 'frame', 'message', 'divider', 'branch', 'message', 'end']);
    expect(pay.shape.events.flatMap((e) => (e.kind === 'message' ? [e.number] : []))).toEqual([4, 5]);
    // b was called by a in the first phase and answers in the last: its bar runs from the top there.
    const last = await phase('phase-payment-2');
    expect(last.shape.participants.map((p) => p.id)).toEqual(['a', 'b']);
    expect(last.shape.events[0]).toMatchObject({ kind: 'activate', lane: 'b' });
    expect(last.shape.events.find((e) => e.kind === 'ref')).toMatchObject({ over: ['a', 'b'] });
    const g = sequenceGeometry(last.shape, themes.light);
    expect(g.bars).toHaveLength(1);
    expect(g.bars[0]!.box.y).toBeLessThan(g.messages[0]!.y);
    // Steps are the phase's own messages.
    expect(last.r.steps).toHaveLength(1);
    // One divider (or none) is one phase: no views, the whole is the drawing.
    expect(sequence.views!(parse('type: sequence\nmessages:\n  - divider: All\n  - a -> b: x\n'))).toEqual([]);
  });

  it('renders the examples cleanly in both themes', async () => {
    const dir = path.resolve(import.meta.dirname, '../../../examples/sequence');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.yaml')))
      for (const theme of ['light', 'dark'] as const) {
        const r = await render(fs.readFileSync(path.join(dir, f), 'utf8'), { fonts: 'none', theme });
        expect(r.diagnostics, f).toEqual([]);
        expect(r.svg).not.toMatch(/NaN|undefined|Infinity/);
      }
  });

  it('renders the template the same as before', async () => {
    const r = await render(sequence.template, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(r.svg).toMatchSnapshot();
  });
});

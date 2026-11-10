import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import type { FlowShape } from '@cartography/core';
import { nodeShorthand, parseChain, process as processType, processReferences } from '../src/index.ts';

const examples = path.resolve(import.meta.dirname, '../../../examples/process');
const names = fs.readdirSync(examples).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, '')).sort();
const example = (name: string) => fs.readFileSync(path.join(examples, `${name}.yaml`), 'utf8');

const draw = async (yaml: string) => {
  const r = await render(yaml, { fonts: 'none' });
  const shape = (id: string) => r.graph?.nodes.find((n) => n.id === id)?.shape as FlowShape | undefined;
  const edge = (from: string, to: string) => r.graph?.edges.find((e) => e.from.node === from && e.to.node === to);
  return { r, shape, edge, said: r.diagnostics.map((d) => `${d.line}:${d.column} ${d.severity} ${d.message}`) };
};

const leave = `type: process
title: Leave
lanes:
  employee: Employee
  manager: Manager
nodes:
  Ask for leave: employee
  Enough days?: manager
  Approve: { in: manager, kind: user, caption: in the HR portal }
  Explain: manager
flow:
  - start -> Ask for leave -> Enough days? -yes-> Approve -> end
  - Enough days? -no-> Explain -> end
  - Approve --> Ask for leave: by mail
`;

describe('the flow as written', () => {
  it('reads a chain: names with spaces, labels in the arrow, messages', () => {
    const c = parseChain('start -> Check stock -yes-> Ship it --by mail--> Customer')!;
    expect(c.names.map((n) => n.id)).toEqual(['start', 'Check stock', 'Ship it', 'Customer']);
    expect(c.arrows.map((a) => [a.label, a.message])).toEqual([[undefined, false], ['yes', false], ['by mail', true]]);
    // Where each name starts, so a rename changes that name and nothing else.
    expect(c.names.map((n) => n.start)).toEqual([0, 9, 28, 49]);
    expect(parseChain('A --> B')!.arrows[0]).toMatchObject({ message: true });
  });

  it('refuses what is not a chain', () => {
    expect(parseChain('just one step')).toBeUndefined();
    expect(parseChain('a -> ')).toBeUndefined();
    expect(parseChain('-> b')).toBeUndefined();
    expect(parseChain('a -> -> b')).toBeUndefined();
  });

  it('reads a step written short as a kind, else as its lane', () => {
    expect(nodeShorthand('user')).toEqual({ kind: 'user' });
    expect(nodeShorthand('xor')).toEqual({ kind: 'xor' });
    expect(nodeShorthand('manager')).toEqual({ in: 'manager' });
    expect(nodeShorthand(null)).toEqual({});
  });
});

describe('what is drawn', () => {
  it('draws lanes, tasks, a decision and the start and end it was not told about', async () => {
    const { r, shape, said } = await draw(leave);
    expect(said).toEqual([]);
    expect(r.graph!.groups.map((g) => [g.id, g.label])).toEqual([
      ['employee', 'Employee'],
      ['manager', 'Manager'],
    ]);
    expect(shape('start')).toMatchObject({ form: 'event', mark: 'start' });
    expect(shape('end')).toMatchObject({ form: 'event', mark: 'end' });
    expect(shape('Ask for leave')).toMatchObject({ form: 'task', label: 'Ask for leave' });
    expect(shape('Enough days?')).toMatchObject({ form: 'gateway', mark: 'xor', label: 'Enough days?' });
    expect(shape('Approve')).toMatchObject({ form: 'task', caption: 'in the HR portal', icon: 'user' });
    // A step stands in the lane it names; start and end in the lane of the step beside them.
    const lane = (id: string) => r.graph!.nodes.find((n) => n.id === id)?.parent;
    expect([lane('Ask for leave'), lane('Enough days?'), lane('start'), lane('end')]).toEqual(['employee', 'manager', 'employee', 'manager']);
  });

  it('labels the ways out of a decision and draws a message dashed', async () => {
    const { edge } = await draw(leave);
    expect(edge('Enough days?', 'Approve')).toMatchObject({ label: 'yes', line: 'solid' });
    expect(edge('Enough days?', 'Explain')).toMatchObject({ label: 'no' });
    expect(edge('Approve', 'Ask for leave')).toMatchObject({ label: 'by mail', line: 'dashed' });
  });

  it('takes the first flow item as the happy path, and walks it', async () => {
    const { r } = await draw(leave);
    expect(r.graph!.walk!.map((b) => b.nodes[0])).toEqual(['start', 'Ask for leave', 'Enough days?', 'Approve', 'end']);
    expect(r.graph!.walk!.map((b) => b.edges)).toEqual([[], ['flow0'], ['flow0.1'], ['flow0.2'], ['flow0.3']]);
    // It is drawn heavier and named in the key, unless the source says every way weighs the same.
    expect(r.graph!.edges.filter((e) => e.width).map((e) => e.id)).toEqual(['flow0', 'flow0.1', 'flow0.2', 'flow0.3']);
    expect(r.graph!.legend!.map((l) => l.label)).toEqual(['Happy path', 'Message']);
    const even = await draw(leave.replace('title: Leave', 'title: Leave\nhappy: false'));
    expect(even.r.graph!.edges.filter((e) => e.width)).toEqual([]);
    expect(even.r.graph!.legend!.map((l) => l.label)).toEqual(['Message']);
  });

  it('knows every kind', async () => {
    const { shape, said } = await draw(`type: process
nodes:
  A: user
  B: service
  C: manual
  D: script
  E: subprocess
  Split: parallel
  Join: and
  Any: inclusive
  Wait: event-based
  T: timer
  M: message
  X: error
  S: signal
  Doc: document
  Why: { kind: note, label: Because }
flow:
  - start -> A -> Split -> B -> Join -> E -> Any -yes-> Wait -> T -> end
  - Split -> C -> Join
  - Any -no-> D -> X
  - Wait -> M -> S -> end
  - E -> Doc
  - Why -> A
`);
    expect(said).toEqual([]);
    expect(['A', 'B', 'C', 'D'].map((id) => shape(id)!.icon)).toEqual(['user', 'cog', 'hand', 'scroll-text']);
    expect(shape('E')!.form).toBe('subprocess');
    expect(['Split', 'Join', 'Any', 'Wait'].map((id) => shape(id)!.mark)).toEqual(['and', 'and', 'or', 'event']);
    expect(['T', 'M', 'S'].map((id) => [shape(id)!.form, shape(id)!.mark])).toEqual([['event', 'mid'], ['event', 'mid'], ['event', 'mid']]);
    expect(shape('X')).toMatchObject({ form: 'event', mark: 'end' });
    expect(shape('Doc')!.form).toBe('document');
    expect(shape('Why')).toMatchObject({ form: 'note', label: 'Because' });
  });

  it('marks the default way out with a slash', async () => {
    const { edge, said } = await draw(`type: process
flow:
  - start -> Stock? -yes-> Ship -> end
  - Stock? -> Order parts -> Ship: { label: none left, default: true }
`);
    expect(said).toEqual([]);
    expect(edge('Stock?', 'Order parts')).toMatchObject({ label: 'none left', start: 'slash' });
    expect(edge('Order parts', 'Ship')?.start).toBe('none');
  });

  it('gives every drawn line an id and the place of its item, so the editor finds it', async () => {
    const { r } = await draw(leave);
    expect(r.graph!.edges.map((e) => [e.id, e.path])).toEqual([
      ['flow0', ['flow', 0]],
      ['flow0.1', ['flow', 0]],
      ['flow0.2', ['flow', 0]],
      ['flow0.3', ['flow', 0]],
      ['flow1', ['flow', 1]],
      ['flow1.1', ['flow', 1]],
      ['flow2', ['flow', 2]],
    ]);
    expect(r.graph!.nodes.find((n) => n.id === 'Explain')!.path).toEqual(['nodes', 'Explain']);
  });
});

describe('what it says about mistakes, and where', () => {
  it('points at the flow item that is no chain', async () => {
    const { said } = await draw('type: process\nflow:\n  - start -> A -> end\n  - A and then B\n');
    expect(said).toEqual(['4:5 error "A and then B" should look like "a -> b -> c"; "a -yes-> b" with a label; "a --> b" for a message']);
  });

  it('points at a lane that is not there', async () => {
    const { said } = await draw(leave.replace('Explain: manager', 'Explain: { in: boss }').replace('Ask for leave: employee', 'Ask for leave: staff'));
    expect(said).toEqual([
      '7:3 error "staff" is neither a kind nor a lane (lanes: employee, manager)',
      '10:14 error There is no lane "boss" (lanes: employee, manager)',
    ]);
  });

  it('warns about a step outside the flow, a decision with one way out and ways out without a label', async () => {
    const { said } = await draw(`type: process
nodes:
  Forgotten: user
flow:
  - start -> Sure? -yes-> A -> Which? -> B -> end
  - Which? -> C -> end
`);
    expect(said).toEqual([
      '5:5 warning "Sure?" has one way out: a decision needs at least two, like "Sure? -no-> …"',
      '5:5 warning "Which?" has ways out without a label: write "Which? -yes-> …" so a reader knows which is which',
      '3:3 warning "Forgotten" is not in the flow: nothing leads to it or from it',
    ]);
  });

  it('warns about a flow that goes on after its end, never ends, or stops half way', async () => {
    expect((await draw('type: process\nflow:\n  - start -> A -> end -> B\n')).said).toContain('3:5 warning "end" is an end, yet the flow goes on from it');
    expect((await draw('type: process\nflow:\n  - A -> B -> A\n')).said).toEqual(['2:1 warning This process has no end: every step leads on to another']);
    expect((await draw('type: process\nflow:\n  - start -> A -> end\n  - A -> B\n')).said).toEqual(['4:5 warning "B" leads nowhere, while other paths reach an end: add "B -> end"']);
  });

  it('warns about two spellings of one step', async () => {
    const { said } = await draw('type: process\nflow:\n  - start -> Check stock -> end\n  - check stock -> Order -> end\n');
    expect(said.some((s) => s.includes('"check stock" and "Check stock" are two steps'))).toBe(true);
  });

  it('refuses a name used for a lane and a step', async () => {
    const { said } = await draw('type: process\nlanes:\n  sales: Sales\nflow:\n  - start -> sales -> end\n');
    expect(said).toEqual(['5:5 error "sales" is a lane and a step: give one of them another name']);
  });
});

describe('references', () => {
  it('finds every name in the flow and every lane a step names', () => {
    const refs = processReferences(parse(leave));
    expect(refs.filter((r) => r.id === 'Approve').map((r) => [r.path, r.start, r.onDelete])).toEqual([
      [['flow', 0], 46, 'cut'],
      [['flow', 2], 0, undefined],
    ]);
    expect(refs.filter((r) => r.collection === 'lanes').map((r) => [r.path, r.id])).toEqual([
      [['nodes', 'Ask for leave'], 'employee'],
      [['nodes', 'Enough days?'], 'manager'],
      [['nodes', 'Approve', 'in'], 'manager'],
      [['nodes', 'Explain'], 'manager'],
    ]);
    // A line with a label is a map with one key: the names sit in the key.
    expect(refs.find((r) => r.path[1] === 2)).toMatchObject({ key: true });
  });

  it('cuts a name out of a chain with one of its arrows', () => {
    const text = 'start -> Ask for leave -> Enough days? -yes-> Approve -> end';
    const cut = (id: string) => {
      const r = processReferences(parse(leave)).find((x) => x.id === id && x.path[1] === 0)!;
      return (text.slice(0, r.cut![0]) + text.slice(r.cut![1])).trim();
    };
    expect(cut('start')).toBe('Ask for leave -> Enough days? -yes-> Approve -> end');
    expect(cut('Approve')).toBe('start -> Ask for leave -> Enough days? -yes-> end');
    expect(cut('end')).toBe('start -> Ask for leave -> Enough days? -yes-> Approve');
  });
});

describe('one line of a chain', () => {
  const src = parse(leave);
  it('relabels it in place when the label fits in the arrow', () => {
    expect(processType.lines!.label(src, 'flow0.2', 'ok')).toEqual({ path: ['flow', 0], items: ['start -> Ask for leave -> Enough days? -ok-> Approve -> end'] });
    expect(processType.lines!.label(src, 'flow2', '')).toEqual({ path: ['flow', 2], items: ['Approve --> Ask for leave'] });
    expect(processType.lines!.label(src, 'flow2', 'mail')).toEqual({ path: ['flow', 2], items: ['Approve --mail--> Ask for leave'] });
  });

  it('removes it by cutting the chain', () => {
    expect(processType.lines!.remove(src, 'flow1')).toEqual({ path: ['flow', 1], items: ['Explain -> end'] });
    expect(processType.lines!.remove(src, 'flow2')).toEqual({ path: ['flow', 2], items: [] });
    expect(processType.lines!.remove(src, 'flow7')).toBeUndefined();
  });
});

describe('the examples', () => {
  it.each(names)('%s draws without a remark', async (name) => {
    const { r } = await draw(example(name));
    expect(r.diagnostics).toEqual([]);
    expect(r.svg).toContain('<svg');
  });

  it('the template is one of them in spirit: it draws clean and has lanes and a decision', async () => {
    const { r } = await draw(processType.template);
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.groups.length).toBeGreaterThan(1);
    expect(r.graph!.nodes.some((n) => (n.shape as FlowShape).form === 'gateway')).toBe(true);
  });
});

describe('the layout', () => {
  const boxes = async (yaml: string) => {
    const r = await render(yaml, { fonts: 'none' });
    return { r, at: (id: string) => r.placed!.nodes.get(id)!, lane: (id: string) => r.placed!.groups.get(id)! };
  };
  const mid = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

  it('runs left to right, each lane a band over the full width, in the order written', async () => {
    const { r, lane } = await boxes(leave);
    const [a, b] = [lane('employee'), lane('manager')];
    expect(a.x).toBe(b.x);
    expect(a.width).toBe(b.width);
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
    for (const n of r.graph!.nodes) {
      const box = r.placed!.nodes.get(n.id)!;
      const band = lane(n.parent!);
      expect(box.y, n.id).toBeGreaterThanOrEqual(band.y);
      expect(box.y + box.height, n.id).toBeLessThanOrEqual(band.y + band.height);
    }
  });

  it('keeps the happy path in order, and straight where it stays in one lane', async () => {
    const { r, at } = await boxes(leave);
    const walk = r.graph!.walk!.map((b) => b.nodes[0]!);
    for (let i = 1; i < walk.length; i++) expect(mid(at(walk[i]!)).x, walk[i]).toBeGreaterThan(mid(at(walk[i - 1]!)).x);
    expect(mid(at('Enough days?')).y).toBe(mid(at('Approve')).y);
    expect(mid(at('Approve')).y).toBe(mid(at('end')).y);
  });

  it('runs top to bottom when asked', async () => {
    const { r, at } = await boxes(leave.replace('title: Leave', 'title: Leave\ndirection: down'));
    const walk = r.graph!.walk!.map((b) => b.nodes[0]!);
    for (let i = 1; i < walk.length; i++) expect(mid(at(walk[i]!)).y, walk[i]).toBeGreaterThan(mid(at(walk[i - 1]!)).y);
  });

  it.each(names)('%s: no step on another, every line square and clear of the steps it does not touch', async (name) => {
    const r = await render(example(name), { fonts: 'none' });
    const nodes = [...r.placed!.nodes];
    for (const [a, p] of nodes)
      for (const [b, q] of nodes) if (a < b) expect(p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y, `${a} on ${b}`).toBe(true);
    for (const e of r.graph!.edges) {
      const pts = r.placed!.edges.get(e.id)!.points;
      for (let i = 1; i < pts.length; i++) {
        const [p, q] = [pts[i - 1]!, pts[i]!];
        expect(Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5, `${e.id} is slanted`).toBe(true);
        for (const [id, b] of nodes) {
          if (id === e.from.node || id === e.to.node) continue;
          const [x0, x1, y0, y1] = [Math.min(p.x, q.x), Math.max(p.x, q.x), Math.min(p.y, q.y), Math.max(p.y, q.y)];
          expect(x1 <= b.x + 1 || x0 >= b.x + b.width - 1 || y1 <= b.y + 1 || y0 >= b.y + b.height - 1, `${e.id} runs through ${id}`).toBe(true);
        }
      }
    }
  });

  it('draws the same picture twice, and moves little when a step is added at the end of a branch', async () => {
    const one = await boxes(leave);
    const two = await boxes(leave);
    expect([...two.r.placed!.nodes]).toEqual([...one.r.placed!.nodes]);
    const more = await boxes(leave.replace('Explain -> end', 'Explain -> Offer unpaid leave -> end'));
    for (const id of ['start', 'Ask for leave', 'Enough days?']) expect(more.at(id), id).toEqual(one.at(id));
    // What follows the decision makes a little room for the longer branch, and stays on its line.
    expect(Math.abs(more.at('Approve').x - one.at('Approve').x)).toBeLessThanOrEqual(8);
    expect(more.at('Approve').y).toBe(one.at('Approve').y);
  });
});

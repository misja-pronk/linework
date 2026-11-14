import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@linework/engine';
import type { FlowShape } from '@linework/core';
import { parseTransition, states as statesType, stateShorthand, statesReferences } from '../src/index.ts';

const examples = path.resolve(import.meta.dirname, '../../../examples/states');
const names = fs.readdirSync(examples).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, '')).sort();
const example = (name: string) => fs.readFileSync(path.join(examples, `${name}.yaml`), 'utf8');

const draw = async (yaml: string) => {
  const r = await render(yaml, { fonts: 'none' });
  const node = (id: string) => r.graph?.nodes.find((n) => n.id === id);
  const shape = (id: string) => node(id)?.shape as FlowShape | undefined;
  const edge = (from: string, to: string) => r.graph?.edges.find((e) => e.from.node === from && e.to.node === to);
  return { r, node, shape, edge, said: r.diagnostics.map((d) => `${d.line}:${d.column} ${d.severity} ${d.message}`) };
};

const door = `type: states
title: Door
states:
  Closed: { entry: lock, do: [hold, wait], exit: unlock }
  Locked?: choice
  Open:
    states:
      Ajar:
      Wide open: { note: Draught }
  Broken: final
transitions:
  - start -> Closed -> Locked?: push
  - Locked? -> Open: [not locked]
  - Locked? -> Closed: "[locked] / rattle"
  - start -> Ajar -> Wide open: push / creak
  - Open -> Closed: pull
  - Closed -> Closed: knock
  - Closed -> Broken: kick [hard]
  - Open -> end
`;

describe('transitions as written', () => {
  it('reads the states of a transition and where each name starts', () => {
    expect(parseTransition('start -> Wide open -> end')).toEqual([
      { id: 'start', start: 0 },
      { id: 'Wide open', start: 9 },
      { id: 'end', start: 22 },
    ]);
    expect(parseTransition('just a state')).toBeUndefined();
    expect(parseTransition('a ->')).toBeUndefined();
  });

  it('reads a state written short as a kind, else as its label', () => {
    expect(stateShorthand('choice')).toEqual({ kind: 'choice' });
    expect(stateShorthand('Waiting for payment')).toEqual({ label: 'Waiting for payment' });
    expect(stateShorthand(null)).toEqual({});
  });
});

describe('what is drawn', () => {
  it('draws states, a choice, a final state and the start and end of the transitions', async () => {
    const { r, shape, node, said } = await draw(door);
    expect(said).toEqual([]);
    expect(shape('Closed')).toMatchObject({ form: 'state', label: 'Closed', lines: ['entry / lock', 'do / hold', 'do / wait', 'exit / unlock'] });
    expect(shape('Locked?')).toMatchObject({ form: 'pseudo', mark: 'choice', label: 'Locked?' });
    expect(shape('Broken')).toMatchObject({ form: 'pseudo', mark: 'final', label: 'Broken' });
    expect(shape('start')).toMatchObject({ form: 'pseudo', mark: 'initial' });
    expect(shape('end')).toMatchObject({ form: 'pseudo', mark: 'final' });
    // A state that holds states is a frame around them, not a box of its own.
    expect(r.graph!.groups.map((g) => [g.id, g.label])).toEqual([['Open', 'Open']]);
    expect(node('Open')).toBeUndefined();
    expect([node('Ajar')!.parent, node('Wide open')!.parent]).toEqual(['Open', 'Open']);
  });

  it('puts a start in the composite state whose substate it leads to', async () => {
    const { node, edge } = await draw(door);
    expect(node('Open.start')).toMatchObject({ parent: 'Open', path: ['transitions', 3] });
    expect(node('start')!.parent).toBeUndefined();
    expect(edge('Open.start', 'Ajar')).toMatchObject({ label: 'push / creak' });
  });

  it('labels a transition with event, guard and action, on the first arrow of a chain', async () => {
    const { edge } = await draw(door);
    expect(edge('start', 'Closed')!.label).toBe('push');
    expect(edge('Closed', 'Locked?')!.label).toBeUndefined();
    // A guard alone is YAML's one-item list; it reads as the guard it is.
    expect(edge('Locked?', 'Open')!.label).toBe('[not locked]');
    expect(edge('Locked?', 'Closed')!.label).toBe('[locked] / rattle');
    expect(edge('Closed', 'Broken')!.label).toBe('kick [hard]');
    expect(edge('Closed', 'Closed')).toMatchObject({ id: 't5', label: 'knock' });
  });

  it('hangs a note on its state with a dotted line', async () => {
    const { shape, node, edge } = await draw(door);
    expect(shape('Wide open.note')).toMatchObject({ form: 'note', label: 'Draught' });
    expect(node('Wide open.note')!.path).toEqual(['states', 'Open', 'states', 'Wide open', 'note']);
    expect(edge('Wide open.note', 'Wide open')).toMatchObject({ line: 'dotted', end: 'none' });
  });

  it('draws a history state inside its composite state', async () => {
    const { shape, node, said } = await draw(door.replace('      Ajar:', '      Last: history\n      Ajar:').replace('  - Open -> end', '  - Closed -> Last: reopen\n  - Open -> end'));
    expect(said).toEqual([]);
    expect(shape('Last')).toMatchObject({ form: 'pseudo', mark: 'history' });
    expect(node('Last')!.parent).toBe('Open');
  });

  it('makes a state of every name the transitions hold, and a choice of one that ends in a question mark', async () => {
    const { shape, said } = await draw('type: states\ntransitions:\n  - start -> Draft -> Good enough? -> Published: [yes]\n  - Good enough? -> Draft: [no]\n  - Published -> end\n');
    expect(said).toEqual([]);
    expect(shape('Draft')).toMatchObject({ form: 'state', label: 'Draft' });
    expect(shape('Good enough?')!.mark).toBe('choice');
  });

  it('walks from the start along the first transitions', async () => {
    const { r } = await draw(door);
    expect(r.graph!.walk!.map((b) => b.nodes[0]).slice(0, 3)).toEqual(['start', 'Closed', 'Locked?']);
  });

  it('gives every drawn line an id and the place of its item', async () => {
    const { r } = await draw(door);
    expect(r.graph!.edges.filter((e) => e.id.startsWith('t')).map((e) => [e.id, e.path[1]])).toEqual([
      ['t0', 0],
      ['t0.1', 0],
      ['t1', 1],
      ['t2', 2],
      ['t3', 3],
      ['t3.1', 3],
      ['t4', 4],
      ['t5', 5],
      ['t6', 6],
      ['t7', 7],
    ]);
  });
});

describe('what it says about mistakes, and where', () => {
  it('says in plain words that a guard with an action needs quotes', async () => {
    const { said } = await draw(door.replace('"[locked] / rattle"', '[locked] / rattle'));
    expect(said).toEqual(['14:33 error Text that starts with [ ] and goes on after it needs quotes, like "[paid] / ship"']);
  });

  it('says so when the quotes went around the whole transition', async () => {
    const { said } = await draw('type: states\ntransitions:\n  - start -> A\n  - "A -> B: [paid] / ship"\n  - B -> end\n');
    expect(said).toContain('4:5 warning "B: [paid] / ship" is read as the name of a state: quote only what stands after the colon, like B: "[paid] / ship"');
  });

  it('points at what is no transition and at a kind that is none', async () => {
    const { said } = await draw('type: states\nstates:\n  A:\n  B: { kind: blob }\ntransitions:\n  - start -> A -> B\n  - A to B\n');
    expect(said).toEqual(['4:8 error "kind" must be one of: state, choice, final, history', '7:5 error "A to B" should look like "a -> b", or a chain "a -> b -> c"']);
  });

  it('refuses a name written twice, a state called end, and a start that leads straight to the end', async () => {
    const { said } = await draw(`type: states
states:
  A:
  Alone:
  end: final
  Group:
    states:
      A:
transitions:
  - start -> A -> B
  - start -> end
  - end -> A
  - B -> start
`);
    expect(said).toEqual([
      '8:7 error "A" is written twice: a state has one name in the whole diagram',
      '5:3 error "end" is the end pseudo-state: it is written in transitions only, as "… -> end"',
      '11:5 error A transition from start to end says nothing: name a state between them',
      '12:5 warning Nothing leaves an end: it is where the machine stops',
      '13:5 warning Nothing leads to a start: it is where the machine begins',
      '4:3 warning "Alone" is in no transition: nothing leads to it or from it',
    ]);
  });

  it('warns about what a reader cannot follow: no start, a choice with one way out, a composite state without a beginning', async () => {
    expect((await draw('type: states\ntransitions:\n  - A -> B\n  - B -> A\n')).said).toEqual(['2:1 warning There is no start: write "start -> <state>" so a reader knows where it begins']);
    const { said } = await draw(`type: states
states:
  Pick?: choice
  Deep: history
  Whole:
    states:
      Inner:
  Done: final
transitions:
  - start -> Pick? -> Whole
  - Whole -> Whole: again
  - Whole -> Inner
  - Done -> Pick?
`);
    expect(said).toEqual([
      '4:3 warning "Deep" is a history state: it belongs inside a composite state, where it remembers the substate',
      '11:5 warning "Whole" holds states: a transition from the whole of it back to itself cannot be drawn; name the substate it returns to',
      '12:5 warning "Inner" is inside "Whole": write "start -> Inner" for where "Whole" begins, or go from one of its substates',
      '3:3 warning "Pick?" has one way out: a choice needs at least two, each with its guard, like "Pick? -> …: [condition]"',
      '5:3 warning "Whole" is entered as a whole, but nothing says where it begins: add "start -> Inner"',
      '7:7 warning Nothing leads to "Inner": the machine cannot get there from its start',
      '8:3 warning Nothing leads to "Done": the machine cannot get there from its start',
      '13:5 warning "Done" is a final state, yet a transition leaves it',
      '4:3 warning "Deep" is in no transition: nothing leads to it or from it',
    ]);
  });

  it('warns about two spellings of one state', async () => {
    const { said } = await draw('type: states\ntransitions:\n  - start -> Open -> end\n  - open -> Closed -> end\n');
    expect(said.some((s) => s.includes('"open" and "Open" are two states'))).toBe(true);
  });
});

describe('references', () => {
  it('finds every state a transition names, at any depth', () => {
    const refs = statesReferences(parse(door));
    expect(refs.filter((r) => r.id === 'Wide open').map((r) => [r.path, r.key, r.start, r.onDelete, r.among])).toEqual([[['transitions', 3], true, 17, 'cut', 3]]);
    expect(refs.filter((r) => r.id === 'Broken').map((r) => [r.path, r.onDelete])).toEqual([[['transitions', 6], undefined]]);
    expect(refs.every((r) => r.collection === 'states')).toBe(true);
    // start and end are not states: nothing to rename or delete.
    expect(refs.some((r) => r.id === 'start' || r.id === 'end')).toBe(false);
  });
});

describe('one transition of a chain', () => {
  const src = parse(door);
  it('relabels it, on its own item when it is not the first arrow', () => {
    expect(statesType.lines!.label(src, 't4', 'slam')).toEqual({ path: ['transitions', 4], items: [{ 'Open -> Closed': 'slam' }] });
    expect(statesType.lines!.label(src, 't4', '')).toEqual({ path: ['transitions', 4], items: ['Open -> Closed'] });
    expect(statesType.lines!.label(src, 't0.1', 'check')).toEqual({ path: ['transitions', 0], items: [{ 'start -> Closed': 'push' }, { 'Closed -> Locked?': 'check' }] });
  });

  it('removes it by cutting the chain, and leaves the line of a note alone', () => {
    expect(statesType.lines!.remove(src, 't3.1')).toEqual({ path: ['transitions', 3], items: [{ 'start -> Ajar': 'push / creak' }] });
    expect(statesType.lines!.remove(src, 't7')).toEqual({ path: ['transitions', 7], items: [] });
    expect(statesType.lines!.remove(src, 'Wide open.note')).toBeUndefined();
  });
});

describe('the examples', () => {
  it.each(names)('%s draws without a remark', async (name) => {
    const { r } = await draw(example(name));
    expect(r.diagnostics).toEqual([]);
    expect(r.svg).toContain('<svg');
  });

  it('the template draws clean', async () => {
    const { r } = await draw(statesType.template);
    expect(r.diagnostics).toEqual([]);
    expect(r.graph!.nodes.some((n) => (n.shape as FlowShape).mark === 'initial')).toBe(true);
  });
});

describe('the layout', () => {
  it.each(names)('%s: no state on another, substates inside their composite state', async (name) => {
    const r = await render(example(name), { fonts: 'none' });
    const nodes = [...r.placed!.nodes];
    for (const [a, p] of nodes)
      for (const [b, q] of nodes) if (a < b) expect(p.x + p.width <= q.x || q.x + q.width <= p.x || p.y + p.height <= q.y || q.y + q.height <= p.y, `${a} on ${b}`).toBe(true);
    for (const n of r.graph!.nodes) {
      if (!n.parent) continue;
      const [box, frame] = [r.placed!.nodes.get(n.id)!, r.placed!.groups.get(n.parent)!];
      expect(box.x >= frame.x && box.y >= frame.y && box.x + box.width <= frame.x + frame.width && box.y + box.height <= frame.y + frame.height, `${n.id} in ${n.parent}`).toBe(true);
    }
  });

  it('draws a transition to itself as a loop that leaves and returns on the same state', async () => {
    const r = await render(door, { fonts: 'none' });
    const [box, pts] = [r.placed!.nodes.get('Closed')!, r.placed!.edges.get('t5')!.points];
    const on = (p: { x: number; y: number }) => p.x >= box.x - 1 && p.x <= box.x + box.width + 1 && p.y >= box.y - 1 && p.y <= box.y + box.height + 1;
    expect(pts.length).toBeGreaterThan(2);
    expect(on(pts[0]!) && on(pts.at(-1)!)).toBe(true);
    // The loop itself stays outside the state.
    expect(pts.slice(1, -1).some((p) => p.x > box.x && p.x < box.x + box.width && p.y > box.y && p.y < box.y + box.height)).toBe(false);
  });

  it.each(['right', 'down'])('keeps what a loop is called off the state it loops on, flowing %s', async (direction) => {
    const r = await render(door.replace('title: Door', `title: Door\ndirection: ${direction}`), { fonts: 'none' });
    const [box, l] = [r.placed!.nodes.get('Closed')!, r.placed!.edges.get('t5')!.label!];
    expect(l.x + l.width <= box.x || l.x >= box.x + box.width || l.y + l.height <= box.y || l.y >= box.y + box.height).toBe(true);
  });

  it('runs left to right from the start, and draws the same picture twice', async () => {
    const one = await render(door, { fonts: 'none' });
    const two = await render(door, { fonts: 'none' });
    expect([...two.placed!.nodes]).toEqual([...one.placed!.nodes]);
    expect(one.placed!.nodes.get('start')!.x).toBeLessThan(one.placed!.nodes.get('Closed')!.x);
  });
});

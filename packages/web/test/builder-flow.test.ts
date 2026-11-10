// The builder on the two types written as chains: a process ("a -> b -yes-> c") and a state
// machine. One drawn line is one arrow of a list item, and a step is named as it is said.
import { describe, expect, it } from 'vitest';
import { findType, render } from '@cartography/engine';
import { addEntry, connectEntries, deleteEntry, duplicateEntry, editChainLine, fieldsFor, isChainLine, isEntryPath, renameEntry, setField } from '../src/builder.ts';

const proc = findType('process')!;
const states = findType('states')!;
const item = (type: typeof proc, kind: string) => type.palette.find((p) => p.kind === kind)!;
const clean = async (text: string | undefined) => (await render(text!, { fonts: 'none' })).diagnostics.filter((d) => d.severity === 'error');
const flow = (text: string | undefined) => text!.slice(text!.indexOf('flow:')).trim().split('\n').slice(1).map((l) => l.replace(/^\s*- /, ''));
const moves = (text: string | undefined) => text!.slice(text!.indexOf('transitions:')).trim().split('\n').slice(1).map((l) => l.replace(/^\s*- /, ''));

const leave = `type: process
title: Leave   # keep this comment
lanes:
  employee: Employee
  manager: Manager
nodes:
  Ask for leave: employee
  Enough days?: manager
flow:
  - start -> Ask for leave -> Enough days? -yes-> Approve -> end
  - Enough days? -no-> Explain -> end
  - Approve --> Ask for leave: by mail
`;

describe('builder on a process', () => {
  it('adds a step under the name it shows, written short', async () => {
    const once = addEntry(leave, proc, item(proc, 'user'))!;
    expect(once.id).toBe('User task');
    expect(once.text).toContain('  User task: user\n');
    expect(once.text).toContain('# keep this comment');
    const twice = addEntry(once.text, proc, item(proc, 'user'))!;
    expect(twice.id).toBe('User task 2');
    expect(await clean(twice.text)).toEqual([]);
    // In a lane it needs the long form.
    expect(addEntry(leave, proc, item(proc, 'task'), { collection: 'lanes', id: 'manager' })!.text).toContain('  Task: { kind: task, in: manager }\n');
  });

  it('does not reuse a name that only the flow holds', () => {
    const text = leave.replace('Approve', 'Task').replace('Approve', 'Task');
    expect(addEntry(text, proc, item(proc, 'task'))!.id).toBe('Task 2');
  });

  it('connects two steps with a new line, and says so when they are connected already', async () => {
    const r = connectEntries(leave, proc, 'Explain', 'Approve');
    expect('text' in r && flow(r.text).at(-1)).toBe('Explain -> Approve');
    expect('text' in r && (await clean(r.text))).toEqual([]);
    expect(connectEntries(leave, proc, 'Enough days?', 'Explain')).toEqual({ error: 'They are already connected' });
  });

  it('gives the ways out of a decision a yes and a no', () => {
    const open = leave.replace('  - Enough days? -no-> Explain -> end\n', '').replace(' -yes->', ' ->');
    const first = connectEntries(open, proc, 'Enough days?', 'Explain');
    expect('text' in first && flow(first.text).at(-1)).toBe('Enough days? -yes-> Explain');
    const second = connectEntries('text' in first ? first.text : '', proc, 'Enough days?', 'Ask for leave');
    expect('text' in second && flow(second.text).at(-1)).toBe('Enough days? -no-> Ask for leave');
  });

  it('knows one arrow of a chain from a whole entry', () => {
    expect(isChainLine(leave, proc, 'flow0.2')).toBe(true);
    expect(isChainLine(leave, proc, 'flow2')).toBe(true);
    expect(isChainLine(leave, proc, 'flow9')).toBe(false);
    expect(isChainLine('type: systems\nnodes: { a: api, b: api }\nedges: [a -> b]\n', findType('systems')!, 'a->b')).toBe(false);
  });

  it('labels one arrow where it stands, and takes the label away again', async () => {
    const named = editChainLine(leave, proc, 'flow0.2', 'enough');
    expect(flow(named)[0]).toBe('start -> Ask for leave -> Enough days? -enough-> Approve -> end');
    expect(flow(editChainLine(named!, proc, 'flow0.2', ''))[0]).toBe('start -> Ask for leave -> Enough days? -> Approve -> end');
    expect(await clean(named)).toEqual([]);
  });

  it('writes a long label after the line, splitting the chain when the arrow is not its first', async () => {
    const first = editChainLine(leave, proc, 'flow0', 'right away, the same day');
    expect(flow(first)[0]).toBe('start -> Ask for leave -> Enough days? -yes-> Approve -> end: right away, the same day');
    const mid = editChainLine(leave, proc, 'flow0.1', 'the manager looks at the balance');
    expect(flow(mid).slice(0, 2)).toEqual(['start -> Ask for leave', 'Ask for leave -> Enough days? -yes-> Approve -> end: the manager looks at the balance']);
    expect(await clean(mid)).toEqual([]);
    // The drawing says the same as before, plus the label.
    const g = (await render(mid!, { fonts: 'none' })).graph!;
    expect(g.edges.find((e) => e.from.node === 'Ask for leave' && e.to.node === 'Enough days?')?.label).toBe('the manager looks at the balance');
    expect(g.edges.find((e) => e.from.node === 'Enough days?' && e.to.node === 'Approve')?.label).toBe('yes');
  });

  it('removes one arrow: the chain is cut there, the rest stays', () => {
    expect(flow(editChainLine(leave, proc, 'flow0.1')).slice(0, 2)).toEqual(['start -> Ask for leave', 'Enough days? -yes-> Approve -> end']);
    expect(flow(editChainLine(leave, proc, 'flow0'))[0]).toBe('Ask for leave -> Enough days? -yes-> Approve -> end');
    expect(flow(editChainLine(leave, proc, 'flow0.3'))[0]).toBe('start -> Ask for leave -> Enough days? -yes-> Approve');
    expect(flow(editChainLine(leave, proc, 'flow2'))).toHaveLength(2);
  });

  it('renames a step everywhere it is written, also one only the flow names', async () => {
    const entry = renameEntry(leave, proc, ['nodes', 'Ask for leave'], 'Request leave');
    expect(entry).toContain('  Request leave: employee\n');
    expect(flow(entry)).toEqual(['start -> Request leave -> Enough days? -yes-> Approve -> end', 'Enough days? -no-> Explain -> end', 'Approve --> Request leave: by mail']);
    const loose = renameEntry(leave, proc, ['nodes', 'Approve'], 'Approve the leave');
    expect(flow(loose)[0]).toBe('start -> Ask for leave -> Enough days? -yes-> Approve the leave -> end');
    expect(flow(loose)[2]).toBe('Approve the leave --> Ask for leave: by mail');
    expect(await clean(loose)).toEqual([]);
  });

  it('refuses a name that is taken or that YAML or an arrow would trip over', () => {
    expect(renameEntry(leave, proc, ['nodes', 'Approve'], 'Explain')).toBeUndefined();
    expect(renameEntry(leave, proc, ['nodes', 'Approve'], 'Enough days?')).toBeUndefined();
    expect(renameEntry(leave, proc, ['nodes', 'Approve'], 'a -> b')).toBeUndefined();
    expect(renameEntry(leave, proc, ['nodes', 'Approve'], 'Approve: now')).toBeUndefined();
    expect(renameEntry(leave, proc, ['nodes', 'Approve'], ' ')).toBeUndefined();
  });

  it('deletes a step out of the chains it stands in', async () => {
    const loose = deleteEntry(leave, proc, ['nodes', 'Approve']);
    expect(flow(loose)).toEqual(['start -> Ask for leave -> Enough days? -yes-> end', 'Enough days? -no-> Explain -> end']);
    expect(await clean(loose)).toEqual([]);
    const entry = deleteEntry(leave, proc, ['nodes', 'Enough days?']);
    expect(entry).not.toContain('Enough days?');
    expect(flow(entry)).toEqual(['start -> Ask for leave -> Approve -> end', 'Explain -> end', 'Approve --> Ask for leave: by mail']);
  });

  it('sets a field on a step written short, and on one only the flow names', async () => {
    expect(setField(leave, proc, ['nodes', 'Ask for leave'], 'caption', 'in the HR portal')).toContain('  Ask for leave: { in: employee, caption: in the HR portal }\n');
    const loose = setField(leave, proc, ['nodes', 'Approve'], 'kind', 'user');
    expect(loose).toContain('  Approve: { kind: user }\n');
    expect(await clean(loose)).toEqual([]);
    expect(fieldsFor(leave, proc, ['nodes', 'Ask for leave']).find((f) => f.key === 'in')).toMatchObject({ kind: 'select', value: 'employee', options: ['employee', 'manager'] });
  });

  it('duplicates a step under a name like its own', () => {
    expect(duplicateEntry(leave, ['nodes', 'Ask for leave'], proc)!.id).toBe('Ask for leave 2');
  });
});

const door = `type: states
title: Door
states:
  Closed: { entry: lock }
  Open:
    states:
      Ajar:
      Wide open: { note: Draught }
transitions:
  - start -> Closed -> Open: push [not locked] / creak
  - start -> Ajar -> Wide open: push
  - Open -> Closed: pull
  - Closed -> end
`;

describe('builder on a state machine', () => {
  it('adds a state and a choice by name', async () => {
    const s = addEntry(door, states, item(states, 'state'))!;
    expect(s.text).toContain('  State: state\n');
    expect(addEntry(door, states, item(states, 'choice'))!.text).toContain('  Choice: choice\n');
    expect(await clean(s.text)).toEqual([]);
  });

  it('connects states, also one to itself', async () => {
    const r = connectEntries(door, states, 'Wide open', 'Ajar');
    expect('text' in r && moves(r.text).at(-1)).toBe('Wide open -> Ajar');
    const self = connectEntries(door, states, 'Closed', 'Closed');
    expect('text' in self && moves(self.text).at(-1)).toBe('Closed -> Closed');
    expect('text' in self && (await clean(self.text))).toEqual([]);
    expect(connectEntries(door, states, 'Open', 'Closed')).toEqual({ error: 'They are already connected' });
  });

  it('gives the ways out of a choice a guard', () => {
    const text = door.replace('  Closed:', '  Locked?: choice\n  Closed:');
    const first = connectEntries(text, states, 'Locked?', 'Closed');
    expect('text' in first && moves(first.text).at(-1)).toBe('Locked? -> Closed: [yes]');
    const second = connectEntries('text' in first ? first.text : '', states, 'Locked?', 'Open');
    expect('text' in second && moves(second.text).at(-1)).toBe('Locked? -> Open: [no]');
  });

  it('labels one transition, splitting the chain when it is not its first', async () => {
    const mid = editChainLine(door, states, 't0.1', 'kick [angry]');
    expect(moves(mid).slice(0, 2)).toEqual(['start -> Closed: push [not locked] / creak', 'Closed -> Open: kick [angry]']);
    expect(await clean(mid)).toEqual([]);
    expect(moves(editChainLine(door, states, 't1', 'born'))[1]).toBe('start -> Ajar -> Wide open: born');
    expect(moves(editChainLine(door, states, 't2', ''))[2]).toBe('Open -> Closed');
  });

  it('removes one transition', () => {
    expect(moves(editChainLine(door, states, 't1.1'))[1]).toBe('start -> Ajar: push');
    expect(moves(editChainLine(door, states, 't2'))).toEqual(['start -> Closed -> Open: push [not locked] / creak', 'start -> Ajar -> Wide open: push', 'Closed -> end']);
    // The line to a note is not a transition: the note is changed on its state.
    expect(isChainLine(door, states, 'Wide open.note')).toBe(false);
  });

  it('reaches a state inside a composite state', async () => {
    const inner = ['states', 'Open', 'states', 'Wide open'];
    expect(isEntryPath(inner)).toBe(true);
    expect(isEntryPath(['states', 'Open', 'states', 'Wide open', 'note'])).toBe(false);
    expect(fieldsFor(door, states, inner).map((f) => f.key)).toEqual(['label', 'kind', 'entry', 'do', 'exit', 'note', 'tone', 'description', 'tags', 'links']);
    expect(setField(door, states, ['states', 'Open', 'states', 'Ajar'], 'entry', 'squeak')).toContain('      Ajar: { entry: squeak }\n');
    const renamed = renameEntry(door, states, inner, 'Fully open');
    expect(renamed).toContain('      Fully open: { note: Draught }\n');
    expect(moves(renamed)[1]).toBe('start -> Ajar -> Fully open: push');
    expect(await clean(renamed)).toEqual([]);
  });

  it('offers what a state does as a line to edit: one thing stays one, a list stays a list', () => {
    const entry = (text: string, id: string) => fieldsFor(text, states, ['states', id]).find((f) => f.key === 'entry');
    expect(entry(door, 'Closed')).toMatchObject({ kind: 'list', value: ['lock'], one: true });
    expect(fieldsFor(door, states, ['states', 'Closed']).find((f) => f.key === 'exit')).toMatchObject({ kind: 'list', value: [], one: true });
    const two = entry(door.replace('entry: lock', 'entry: [lock, log]'), 'Closed');
    expect(two).toMatchObject({ kind: 'list', value: ['lock', 'log'] });
    expect(two).not.toHaveProperty('one');
  });

  it('deletes a composite state with the states inside it and their transitions', async () => {
    const text = deleteEntry(door, states, ['states', 'Open']);
    expect(text).not.toContain('Ajar');
    expect(moves(text)).toEqual(['start -> Closed: push [not locked] / creak', 'Closed -> end']);
    expect(await clean(text)).toEqual([]);
    expect(moves(deleteEntry(door, states, ['states', 'Open', 'states', 'Ajar']))[1]).toBe('start -> Wide open: push');
  });
});

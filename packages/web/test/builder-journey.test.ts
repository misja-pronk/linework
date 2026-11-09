// The builder on a journey: short steps open as their long form, steps and phases move, phases are picked by name.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { findType, render } from '@cartography/engine';
import { addEntry, canMove, deleteEntry, fieldsFor, moveEntry, parentKey, renameEntry, setField } from '../src/builder.ts';

const journey = findType('journey')!;

const day = `type: journey
persona: Dana, new developer   # who
phases:
  start: First day
  commit: First commit
steps:
  Collect laptop: { in: start, feel: 4 }
  Find the repository: 2 lost
  Run it locally: { in: commit, feel: 3 }
  Open a pull request: 4
`;

const phasesOf = async (text: string) => {
  const r = await render(text, { fonts: 'none' });
  expect(r.diagnostics, text).toEqual([]);
  const shape = r.graph!.nodes[0]!.shape as { steps: { label: string; phase: string }[] };
  return shape.steps.map((s) => `${s.phase}: ${s.label}`);
};

describe('builder on a journey', () => {
  it('shows a short step as its fields and the phase as a pick list', () => {
    const fields = fieldsFor(day, journey, ['steps', 'Find the repository']);
    expect(fields.find((f) => f.key === 'feel')).toMatchObject({ kind: 'text', value: '2 lost', numeric: true });
    expect(fields.find((f) => f.key === 'in')).toMatchObject({ kind: 'select', options: ['start', 'commit'], labels: { start: 'First day', commit: 'First commit' } });
    expect(fields.find((f) => f.key === 'pains')).toMatchObject({ kind: 'list', value: [] });
    expect(fields.slice(0, 2).map((f) => f.key)).toEqual(['label', 'in']);
  });

  it('turns a short step into a map when a field is set, keeping the score and comments', async () => {
    const text = setField(day, journey, ['steps', 'Find the repository'], 'thought', 'Which one is ours?')!;
    expect(text).toContain('Find the repository: { feel: 2 lost, thought: Which one is ours? }');
    expect(text).toContain('# who');
    expect(await phasesOf(text)).toEqual(await phasesOf(day));
  });

  it('adds a step from the palette, in a phase when dropped on one', async () => {
    const step = journey.palette.find((p) => p.kind === 'step')!;
    expect(parentKey(journey, 'steps', 'phases')).toBe('in');
    const r = addEntry(day, journey, step, { collection: 'phases', id: 'start' })!;
    expect(r.text).toContain('step: { label: Step, in: start }');
    expect(await phasesOf(r.text)).toEqual(['start: Collect laptop', 'start: Find the repository', 'start: Step', 'commit: Run it locally', 'commit: Open a pull request']);
  });

  it('moves a step within its phase without moving the others to another phase', async () => {
    const text = moveEntry(day, journey, ['steps', 'Collect laptop'], 1)!;
    expect(Object.keys(parse(text).steps).slice(0, 2)).toEqual(['Find the repository', 'Collect laptop']);
    expect(await phasesOf(text)).toEqual(['start: Find the repository', 'start: Collect laptop', 'commit: Run it locally', 'commit: Open a pull request']);
    // The step that leaned on the one above now names its phase itself.
    expect(parse(text).steps['Find the repository']).toEqual({ feel: '2 lost', in: 'start' });
  });

  it('moves a step at the edge of its phase into the next phase', async () => {
    const text = moveEntry(day, journey, ['steps', 'Find the repository'], 1)!;
    expect(await phasesOf(text)).toEqual(['start: Collect laptop', 'commit: Find the repository', 'commit: Run it locally', 'commit: Open a pull request']);
    const back = moveEntry(text, journey, ['steps', 'Find the repository'], -1)!;
    expect(await phasesOf(back)).toEqual(await phasesOf(day));
  });

  it('moves phases, and says when there is nowhere to go', async () => {
    expect(canMove(day, journey, ['steps', 'Collect laptop'], -1)).toBe(false);
    expect(canMove(day, journey, ['steps', 'Open a pull request'], 1)).toBe(false);
    expect(canMove(day, journey, ['phases', 'start'], 1)).toBe(true);
    const text = moveEntry(day, journey, ['phases', 'start'], 1)!;
    expect(Object.keys(parse(text).phases)).toEqual(['commit', 'start']);
    expect((await phasesOf(text))[0]).toBe('commit: Run it locally');
    expect(moveEntry(day, journey, ['phases', 'start'], -1)).toBeUndefined();
  });

  it('renames and deletes a phase with the steps that name it', async () => {
    const renamed = renameEntry(day, journey, ['phases', 'commit'], 'first-commit')!;
    expect(parse(renamed).steps['Run it locally'].in).toBe('first-commit');
    expect((await render(renamed, { fonts: 'none' })).diagnostics).toEqual([]);
    const gone = deleteEntry(day, journey, ['phases', 'commit'])!;
    expect(parse(gone).steps['Run it locally']).toEqual({ feel: 3 });
    expect((await render(gone, { fonts: 'none' })).diagnostics).toEqual([]);
  });
});

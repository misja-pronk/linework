import { describe, expect, it } from 'vitest';
import { render } from '@linework/engine';
import { addStep, deleteStep, moveStep, renameStep, stepsPath } from '../src/steps-edit.ts';

const shop = `# The shop, for the board
type: systems
nodes:
  web: { kind: client, label: Shop } # the storefront
  api: { kind: service, label: Orders }
  db: { kind: database, label: Orders DB }
edges:
  - web -> api
  - api -> db
`;
const told = `${shop}steps:
  - The shop as it is.
  # the request
  - web -> api: The shop calls the API.
  - title: Stored
    focus: db
`;
const top = stepsPath();
const titles = async (text: string, view?: string) => {
  const r = await render(text, { fonts: 'none', view });
  expect(r.diagnostics).toEqual([]);
  return (r.steps ?? []).map((s) => s.title ?? s.caption);
};

describe('steps written from the editor', () => {
  it('the first step makes the list, and leaves the rest of the file as it was', async () => {
    const one = addStep(shop, top, { title: 'The order is stored', focus: ['api', 'db'] })!;
    // A new section at the top of the file gets a blank line above it, like the others.
    expect(one).toBe(`${shop}\nsteps:\n  - title: The order is stored\n    focus: [api, db]\n`);
    const two = addStep(one, top, { title: 'The shop', focus: ['web'] })!;
    expect(two).toBe(`${one}  - title: The shop\n    focus: web\n`);
    // Nothing selected: a step that only has words.
    expect(addStep(two, top, { title: 'Questions', focus: [] })).toBe(`${two}  - title: Questions\n`);
    expect(await titles(two)).toEqual(['The order is stored', 'The shop']);
  });

  it('a new step comes after the one that is shown', async () => {
    const next = addStep(told, top, { title: 'New', focus: ['api'] }, 1)!;
    expect(await titles(next)).toEqual(['The shop as it is.', 'New', 'The shop calls the API.', 'Stored']);
    expect(next).toContain('# the request');
    expect(next).toContain('# the storefront');
  });

  it('names a step; one written short becomes the long form with the same meaning', async () => {
    const named = renameStep(told, top, 3, 'In the database')!;
    expect(named).toBe(told.replace('title: Stored', 'title: In the database'));
    const caption = renameStep(told, top, 1, 'Today')!;
    expect(caption).toContain('  - title: Today\n    caption: The shop as it is.\n');
    const route = renameStep(told, top, 2, 'The request')!;
    expect(route).toContain('  - title: The request\n    caption: The shop calls the API.\n    path: web -> api\n');
    const before = (await render(told, { fonts: 'none' })).steps![1]!;
    const after = (await render(route, { fonts: 'none' })).steps![1]!;
    expect({ ...after, title: undefined }).toEqual({ ...before, title: undefined });
    expect(renameStep(told, top, 9, 'Nothing there')).toBeUndefined();
  });

  it('moves and removes a step; the last one takes the list with it', async () => {
    const moved = moveStep(told, top, 3, 1)!;
    expect(await titles(moved)).toEqual(['Stored', 'The shop as it is.', 'The shop calls the API.']);
    expect(moveStep(moved, top, 1, 3)).toBe(told);
    // A comment above a step goes where the step goes, and with it when it is removed.
    const up = moveStep(told, top, 2, 3)!;
    expect(up).toContain('    focus: db\n  # the request\n  - web -> api: The shop calls the API.\n');
    expect(up.match(/# the request/g)).toHaveLength(1);
    expect(deleteStep(told, top, 2)).not.toContain('# the request');
    expect(renameStep(told, top, 2, 'Named')).toContain('  # the request\n  - title: Named\n');
    expect(moveStep(told, top, 1, 0)).toBeUndefined();
    expect(moveStep(told, top, 3, 4)).toBeUndefined();
    const less = deleteStep(told, top, 2)!;
    expect(await titles(less)).toEqual(['The shop as it is.', 'Stored']);
    expect(deleteStep(deleteStep(less, top, 1)!, top, 1)).toBe(shop);
    expect(deleteStep(told, top, 4)).toBeUndefined();
  });

  it('writes the steps of a view inside that view', async () => {
    const views = `${shop}views:\n  data:\n    title: Where orders live\n    exclude: [web]\n`;
    const at = stepsPath('data');
    expect(at).toEqual(['views', 'data', 'steps']);
    const one = addStep(views, at, { title: 'Stored', focus: ['db'] })!;
    expect(one).toBe(`${views}    steps:\n      - title: Stored\n        focus: db\n`);
    expect(await titles(one, 'data')).toEqual(['Stored']);
    expect(await titles(one)).toEqual([]);
    expect(deleteStep(one, at, 1)).toBe(views);
    // A view that is not written in this file cannot take steps here.
    expect(addStep(shop, stepsPath('elsewhere'), { title: 'No', focus: [] })).toBeUndefined();
  });

  it('leaves text it cannot read alone', () => {
    expect(addStep('type: systems\nnodes: [', top, { title: 'x', focus: [] })).toBeUndefined();
    expect(addStep(`${shop}steps: later\n`, top, { title: 'x', focus: [] })).toBeUndefined();
  });
});

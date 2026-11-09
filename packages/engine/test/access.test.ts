import { describe, expect, it } from 'vitest';
import type { MatrixShape } from '@cartography/core';
import { render } from '../src/index.ts';

const source = (view: string) => `type: access
view: ${view}
principals:
  alice: user
  carol: { kind: user, member-of: sg-ops }
  sg-dev: group
  sg-ops: group
packages:
  dev: { label: Developer access, grants: [sg-dev, gh: User], holders: [alice] }
resources:
  prod: subscription
  rg: { kind: resource-group, in: prod }
  gh: app
roles:
  reader: { label: Reader, permissions: [read] }
  owner: { label: Owner, inherits: reader, permissions: [manage] }
assignments:
  - sg-dev is reader on prod
  - sg-ops is owner on rg
  - alice is owner on rg
`;

async function matrix(view: string) {
  const r = await render(source(view), { fonts: 'none' });
  expect(r.diagnostics).toEqual([]);
  const m = r.graph!.nodes[0]!.shape as MatrixShape;
  const cell = (row: string, col: string) => m.cells[m.rows.findIndex((x) => x.label === row)]![m.columns.findIndex((x) => x.label === col)];
  return { m, cell };
}

describe('access view', () => {
  it('resolves packages, groups and parent scopes', async () => {
    const { cell } = await matrix('access');
    expect(cell('alice', 'prod')).toMatchObject({ text: 'Reader', inherited: true, note: 'via Developer access' });
    // A direct, stronger assignment wins over what is inherited.
    expect(cell('alice', 'rg')).toMatchObject({ text: 'Owner', inherited: false });
    expect(cell('alice', 'gh')).toMatchObject({ text: 'User', note: 'via Developer access' });
    expect(cell('carol', 'rg')).toMatchObject({ text: 'Owner', inherited: true, note: 'via sg-ops' });
    expect(cell('carol', 'prod')).toBeUndefined();
    expect(cell('sg-dev', 'rg')).toMatchObject({ text: 'Reader', note: 'from prod' });
  });

  it('lists permissions with inherited ones marked', async () => {
    const { cell } = await matrix('roles');
    expect(cell('Owner', 'read')).toMatchObject({ check: true, inherited: true });
    expect(cell('Owner', 'manage')).toMatchObject({ check: true, inherited: false });
    expect(cell('Reader', 'manage')).toBeUndefined();
  });

  it('explains a malformed assignment', async () => {
    const r = await render(source('graph').replace('- alice is owner on rg', '- alice owns rg'), { fonts: 'none' });
    expect(r.diagnostics.map((d) => [d.line, d.message])).toEqual([
      [20, '"alice owns rg" should look like "who is role on scope", e.g. "sg-devs is contributor on rg-dev"'],
    ]);
  });

  it('reports what does not exist', async () => {
    const r = await render(source('graph').replace('- alice is owner on rg', '- alice is owner on nowhere'), { fonts: 'none' });
    expect(r.diagnostics.map((d) => d.message)).toEqual(['There is no resource "nowhere"']);
  });
});

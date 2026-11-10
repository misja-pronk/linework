// carto decisions (log, table, new, supersede), validate's warnings about decisions, render --decisions.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseDecision } from '@cartography/core';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'carto-decisions-cli-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function carto(...args: string[]) {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: tmp, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const write = (name: string, text: string) => (fs.mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true }), fs.writeFileSync(path.join(tmp, name), text));
const read = (name: string) => fs.readFileSync(path.join(tmp, name), 'utf8');

fs.mkdirSync(path.join(tmp, '.git'));
write(
  'shop.yaml',
  `type: systems
title: Shop
nodes:
  web: { kind: client, label: Storefront }
  api: { kind: service, label: Orders }
  db: { kind: database, label: Orders DB }
edges:
  - web -> api: { label: REST }
  - api -> db
`,
);
write('decisions/0001-use-postgres.md', '---\nstatus: accepted\ndate: 2026-01-02\nconcerns: [db, "api -> db"]\n---\n\n# Use Postgres\n\n## Decision\n\nWe use Postgres.\n');

describe('carto decisions', () => {
  it('writes the next decision from the template, and supersedes', () => {
    const r = carto('decisions', 'new', 'Use a managed database', '--concerns', 'db', '--supersedes', '1');
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(path.join(tmp, 'decisions/0002-use-a-managed-database.md'));
    expect(parseDecision('decisions/0002-use-a-managed-database.md', read('decisions/0002-use-a-managed-database.md'))).toMatchObject({ number: 2, status: 'proposed', concerns: ['db'], supersedes: [1] });
    expect(parseDecision('decisions/0001-use-postgres.md', read('decisions/0001-use-postgres.md'))).toMatchObject({ status: 'superseded', supersededBy: 2 });
    expect(carto('decisions', 'new', 'X', '--supersedes', '9').code).toBe(1);
  });

  it('prints the log, and draws the table', () => {
    const r = carto('decisions', '.');
    expect(r.code).toBe(0);
    expect(r.out).toContain('| 1 | [Use Postgres](decisions/0001-use-postgres.md) | Superseded by 2 | 2026-01-02 | db, api → db |');
    expect(carto('decisions', '.', '-o', 'log.md').code).toBe(0);
    expect(read('log.md')).toContain('# Decision log');
    expect(carto('decisions', 'decisions', '-o', 'table.svg').code).toBe(0);
    expect(read('table.svg')).toContain('Use a managed database');
  });

  it('draws markers with render --decisions, and only then', () => {
    expect(carto('render', 'shop.yaml', '-o', 'plain.svg').code).toBe(0);
    expect(read('plain.svg')).not.toContain('data-decision');
    expect(carto('render', 'shop.yaml', '--decisions', '-o', 'marked.svg').code).toBe(0);
    const svg = read('marked.svg');
    expect(svg).toContain('data-decision="1" data-status="superseded"');
    expect(svg).toContain('data-decision="2" data-status="proposed"');
    expect(svg).toContain('>Decisions</text>');
  });

  it('validate warns about a decision about something that is not there', () => {
    write('decisions/0003-cache.md', '---\nconcerns: [cach]\n---\n# Cache\n');
    const r = carto('validate', '.');
    expect(r.err).toMatch(/0003-cache\.md:2 {2}warning {2}Decision 3 concerns "cach", which is not in the workspace/);
    expect(r.code).toBe(0);
  });
});

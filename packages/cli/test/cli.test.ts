// The real command line, as CI runs it: exit codes, messages and what lands on disk.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-cli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function carto(...args: string[]) {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: tmp, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const write = (name: string, text: string) => fs.writeFileSync(path.join(tmp, name), text);
const read = (name: string) => fs.readFileSync(path.join(tmp, name), 'utf8');
const exists = (name: string) => fs.existsSync(path.join(tmp, name));

const shop = `type: azure
groups:
  rg: resource-group
nodes:
  web: { kind: app-service, in: rg }
  db: { kind: sql-database, in: rg }
  kv: key-vault
edges:
  - web -> db
  - web -> kv
views:
  data: { include: [web, db], title: Data }
`;

describe('carto render --stable', () => {
  it('notes the layout in the sidecar, once, and plain render never writes it', () => {
    write('shop.yaml', shop);
    expect(carto('render', 'shop.yaml').code).toBe(0);
    expect(exists('shop.layout.json')).toBe(false);

    const first = carto('render', 'shop.yaml', '--stable', '--all-views');
    expect(first.code).toBe(0);
    expect(first.out).toContain('layout noted');
    const sidecar = JSON.parse(read('shop.layout.json'));
    expect(sidecar.layout.variant).toMatch(/^(right|down)\//);
    expect(sidecar.layout.at).toMatch(/db@[\d.-]+,[\d.-]+;kv@[\d.-]+,[\d.-]+;web@[\d.-]+,[\d.-]+;#rg@/);
    expect(sidecar.views.data.layout.at).toMatch(/^db@[^;]+;web@[^;]+;#rg@/);

    // Nothing changed: nothing written, and the picture is the same with or without the note.
    const noted = read('shop.layout.json');
    const svg = read('shop.svg');
    const again = carto('render', 'shop.yaml', '--stable', '--all-views');
    expect(again.out).not.toContain('layout noted');
    expect(read('shop.layout.json')).toBe(noted);
    expect(read('shop.svg')).toBe(svg);

    // An edit: plain render reads the note and leaves it alone.
    write('shop.yaml', shop.replace('  kv: key-vault\n', '  kv: key-vault\n  cache: redis\n').replace('  - web -> kv\n', '  - web -> kv\n  - web -> cache\n'));
    expect(carto('render', 'shop.yaml').code).toBe(0);
    expect(read('shop.layout.json')).toBe(noted);
    // --stable brings it up to date, and keeps pins that were there.
    fs.writeFileSync(path.join(tmp, 'shop.layout.json'), JSON.stringify({ ...sidecar, nodes: { kv: { x: 700, y: 40 } } }));
    expect(carto('render', 'shop.yaml', '--stable').out).toContain('layout noted');
    const updated = JSON.parse(read('shop.layout.json'));
    expect(updated.layout.at).toContain('cache@');
    expect(updated.nodes).toEqual({ kv: { x: 700, y: 40 } });
    expect(updated.views.data.layout).toEqual(sidecar.views.data.layout);
  }, 60_000);
});

describe('carto validate --drift', () => {
  it('fails on stale entries, naming the file and the ids; --fix drops them', () => {
    write('drift.yaml', shop);
    const sidecar = {
      version: 1,
      nodes: { web: { x: 10, y: 10 }, cache: { x: 1, y: 1 } },
      edges: { e7: { via: [{ x: 1, y: 1 }] } },
      locked: ['cache'],
      views: { old: { nodes: { web: { x: 1, y: 1 } } } },
    };
    write('drift.layout.json', JSON.stringify(sidecar));

    // Without the flag the sidecar is not looked at.
    expect(carto('validate', 'drift.yaml').code).toBe(0);

    const bad = carto('validate', 'drift.yaml', '--drift');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('drift.layout.json  stale  nodes.cache: pinned node "cache" is not drawn');
    expect(bad.err).toContain('edges.e7: bent line "e7" is not drawn');
    expect(bad.err).toContain('locked.cache');
    expect(bad.err).toContain('views.old: view "old" does not exist (views: data)');
    expect(bad.err).toContain('4 stale entries');
    expect(bad.out).not.toContain('ok');
    expect(JSON.parse(read('drift.layout.json'))).toEqual(sidecar);

    const fixed = carto('validate', 'drift.yaml', '--drift', '--fix');
    expect(fixed.code).toBe(0);
    expect(fixed.out).toContain('4 stale entries dropped');
    expect(JSON.parse(read('drift.layout.json'))).toEqual({ version: 1, nodes: { web: { x: 10, y: 10 } } });

    const clean = carto('validate', 'drift.yaml', '--drift');
    expect(clean.code).toBe(0);
    expect(clean.err).toBe('');
  }, 60_000);

  it('removes a sidecar with nothing left, and passes files without one', () => {
    write('gone.yaml', shop);
    write('gone.layout.json', JSON.stringify({ version: 1, nodes: { nope: { x: 1, y: 1 } } }));
    write('plain.yaml', shop);
    expect(carto('validate', 'gone.yaml', 'plain.yaml', '--drift').code).toBe(1);
    const fixed = carto('validate', 'gone.yaml', 'plain.yaml', '--drift', '--fix');
    expect(fixed.code).toBe(0);
    expect(fixed.out).toContain('file removed');
    expect(exists('gone.layout.json')).toBe(false);
  }, 60_000);
});

// carto review, as CI runs it: findings printed with file and line, exit codes by --fail-on, a
// folder's rules.yaml, and the reports.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-review-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function carto(...args: string[]) {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: tmp, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const write = (name: string, text: string) => (fs.mkdirSync(path.dirname(path.join(tmp, name)), { recursive: true }), fs.writeFileSync(path.join(tmp, name), text));

const shop = `type: azure
title: Shop
nodes:
  users: users
  web: { kind: app-service, label: Web }
  db: { kind: sql-database, label: Orders }
  kv: key-vault
  logs: log-analytics
edges:
  - users -> web: { style: public }
  - web -> db: SQL
  - web -> kv: { style: identity }
  - web -> logs: { style: management }
`;

describe('carto review', { timeout: 60_000 }, () => {
  it('prints findings with their line and passes by default (warnings only)', () => {
    write('one/shop.yaml', shop);
    const r = carto('review', 'one/shop.yaml');
    expect(r.out).toContain('one/shop.yaml:10:5  warn  R1 Web is reached from Users without a WAF in front  azure.public-without-waf');
    expect(r.err).toContain('1 finding in the diagram: 1 warning.');
    expect(r.code).toBe(0);
  });
  it('fails on warnings with --fail-on warn, and never with never', () => {
    expect(carto('review', 'one/shop.yaml', '--fail-on', 'warn').code).toBe(1);
    expect(carto('review', 'one/shop.yaml', '--fail-on', 'never').code).toBe(0);
    expect(carto('review', 'one/shop.yaml', '--fail-on', 'loud').code).toBe(2);
  });
  it('runs only the packs asked for', () => {
    const r = carto('review', 'one/shop.yaml', '--pack', 'systems');
    expect(r.out).toContain('no findings');
    expect(carto('review', 'one/shop.yaml', '--pack', 'gcp').code).toBe(2);
  });
  it('reads the folder\'s rules.yaml, and a broken diagram cannot be reviewed', () => {
    write('two/.cartography/rules.yaml', 'rules:\n  azure.public-without-waf: error\ncustom:\n  - id: acme.backup\n    title: Databases are backed up\n    every: { kind: sql-database }\n    must: { tag: backup }\n');
    write('two/shop.yaml', shop);
    const r = carto('review', 'two', '--json');
    const json = JSON.parse(r.out);
    expect(json.files[0].findings.map((f: { rule: string; severity: string }) => `${f.rule} ${f.severity}`)).toEqual(['azure.public-without-waf error', 'acme.backup warn']);
    expect(r.code).toBe(1);
    write('three/broken.yaml', 'type: azure\nnodes:\n  a: { kind: nope }\n');
    expect(carto('review', 'three').code).toBe(2);
  });
  it('writes a report as Markdown with pictures, HTML and PDF', () => {
    for (const ext of ['md', 'html', 'pdf']) expect(carto('review', 'one/shop.yaml', '-o', `out/report.${ext}`).code).toBe(0);
    const md = fs.readFileSync(path.join(tmp, 'out/report.md'), 'utf8');
    expect(md).toContain('![Shop, with the findings marked](report-files/01-shop.png)');
    expect(fs.existsSync(path.join(tmp, 'out/report-files/01-shop.png'))).toBe(true);
    const html = fs.readFileSync(path.join(tmp, 'out/report.html'), 'utf8');
    expect(html).toContain('data-review="R1"');
    expect(html).toContain('<use href="#f0d0-drawing"/>');
    expect(fs.readFileSync(path.join(tmp, 'out/report.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

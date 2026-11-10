// carto blocks: list, show, new and insert, as a person runs them in a project folder.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-blocks-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function carto(...args: string[]) {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: tmp, encoding: 'utf8', env: { ...process.env, CARTO_CONFIG_DIR: path.join(tmp, 'config') } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const read = (name: string) => fs.readFileSync(path.join(tmp, name), 'utf8');

const shop = `type: azure
title: Shop

groups:
  sub: { kind: subscription, label: Shop }
  shop-snet: { kind: subnet, label: snet-shop, in: sub }

nodes:
  users: { kind: users, label: Customers }
  shop-app: { kind: app-service, label: Shop, in: shop-snet }
  shop-db: { kind: sql-database, label: Shop DB, in: shop-snet }

edges:
  - users -> shop-app
  - shop-app -> shop-db: SQL
`;

describe('carto blocks', () => {
  it('lists the starters, and shows one with its parameters', () => {
    const l = carto('blocks', 'list');
    expect(l.code).toBe(0);
    for (const name of ['azure-hub', 'azure-app-stack', 'aws-three-tier', 'k8s-namespace', 'c4-web-api-db']) expect(l.out).toContain(name);
    const s = carto('blocks', 'show', 'azure-hub', '--param', 'name=core');
    expect(s.code).toBe(0);
    expect(s.out).toContain('${cidr}  default "10.0.0.0/16"');
    expect(s.out).toContain('core-fw: { kind: firewall, label: afw-core, in: core-fw-snet }');
  });

  it('saves a selection as a block in ./blocks, with ${name} for the shared start of the ids', () => {
    fs.writeFileSync(path.join(tmp, 'shop.yaml'), shop);
    const r = carto('blocks', 'new', 'shop-stack', '--from', 'shop.yaml', '--select', 'shop-app,shop-db', '--title', 'Shop stack');
    expect(r.code).toBe(0);
    const text = read('blocks/shop-stack.block.yaml');
    expect(text).toContain('title: Shop stack');
    expect(text).toContain('${name}-app: { kind: app-service, label: Shop, in: "${name}-snet" }');
    expect(text).toContain('sub: { kind: subscription, label: Shop }');
    expect(text).not.toContain('users');
    expect(carto('blocks', 'list').out).toMatch(/shop-stack\s+azure\s+Shop stack {2}\(name\) {2}\[\.\/blocks\]/);
  });

  it('inserts it into a file and a group, ids made unique, and refuses a bad parameter', () => {
    const bad = carto('blocks', 'insert', 'azure-hub', 'into', 'shop.yaml', '--param', 'name=my shop');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('--param name: Part of an id');
    const r = carto('blocks', 'insert', 'azure-app-stack', 'into', 'shop.yaml', '--into', 'sub', '--param', 'name=shop');
    expect(r.code).toBe(0);
    expect(r.err).toContain('azure-app-stack #1');
    const text = read('shop.yaml');
    expect(text.startsWith(shop.split('\nedges:')[0]!.split('\nnodes:')[0]!)).toBe(true);
    expect(text).toMatch(/shop-app-2: \{ kind: app-service, label: Shop, in: shop-app-snet-2 \} # from block: azure-app-stack@[0-9a-f]{8} #1 name=shop label=Shop/);
    expect(text).toContain('  shop-app-snet-2: { kind: subnet, label: snet-shop-app, in: sub }');
    expect(carto('validate', 'shop.yaml').code).toBe(0);
    expect(carto('blocks', 'insert', 'nope', 'into', 'shop.yaml').err).toContain('No block "nope"');
  });
});

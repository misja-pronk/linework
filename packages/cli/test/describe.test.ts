// carto describe as a user runs it: the words, as text, Markdown or HTML, and in the PNG.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { carto as inProcess } from './support/carto.ts';

// Each case runs the CLI, some of them drawing every view.
vi.setConfig({ testTimeout: 60_000 });

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-describe-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const carto = (...args: string[]) => inProcess(root, args);
const out = (name: string) => path.join(tmp, name);

describe('carto describe', () => {
  it('prints the diagram in words, and writes Markdown or HTML by the extension', async () => {
    const r = await carto('describe', 'examples/sequence/checkout.yaml');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Checkout\n\nSequence diagram: Card payment/);
    expect(r.out).toContain('1. Shopper calls Storefront: Place order.');
    expect((await carto('describe', 'examples/erd/orders.yaml', '-o', out('orders.md'))).code).toBe(0);
    const md = fs.readFileSync(out('orders.md'), 'utf8');
    expect(md).toMatch(/^# Orders\n/);
    expect(md).toContain('## Relations');
    expect(md).toContain('customer_id (uuid, foreign key to customers.id)');
    expect((await carto('describe', 'examples/matrix/raci-migration.yaml', '-o', out('raci.html'))).code).toBe(0);
    expect(fs.readFileSync(out('raci.html'), 'utf8')).toContain('<li>Business case: Sponsor: A (Accountable)');
  });

  it('describes a view, or every view', async () => {
    expect((await carto('describe', 'examples/teams/product-org.yaml', '--view', 'topology')).out).toContain('Team topology');
    const all = (await carto('describe', 'examples/teams/product-org.yaml', '--all-views', '--format', 'md')).out;
    expect(all).toContain('## Who reports to whom');
    expect(all).toContain('### Interactions');
  });

  it('says what is wrong with a broken diagram and writes nothing', async () => {
    fs.writeFileSync(out('broken.yaml'), 'type: nonsense\n');
    const r = await carto('describe', out('broken.yaml'));
    expect(r.code).toBe(1);
    expect(r.err).toContain('Unknown type');
  });
});

describe('carto render to PNG', () => {
  it('puts the title and the description in the PNG', async () => {
    expect((await carto('render', 'examples/systems/web-shop.yaml', '-o', out('shop.png'))).code).toBe(0);
    const png = fs.readFileSync(out('shop.png'));
    expect(png.toString('latin1', 37, 46)).toBe('iTXtTitle');
    expect(png.toString('utf8')).toContain('Description\0\0\0\0\0Architecture diagram: How an order flows through the system.');
  });
});

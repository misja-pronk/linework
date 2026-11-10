// carto describe, export-md and export-confluence, as a user runs them: the words, and pages whose
// links and pictures resolve when a Markdown renderer (as GitHub's, GitLab's or Obsidian's) reads them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import MarkdownIt from 'markdown-it';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-wiki-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function carto(...args: string[]) {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const out = (name: string) => path.join(tmp, name);

/** Every link and image of a rendered Markdown file, and whether each file it names is there. */
function targets(file: string) {
  const html = new MarkdownIt({ html: true }).render(fs.readFileSync(file, 'utf8'));
  const refs = [...html.matchAll(/<(?:a href|img src)="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  return refs.filter((r) => !/^[a-z]+:/.test(r)).map((r) => ({ ref: r, ok: fs.existsSync(path.join(path.dirname(file), decodeURIComponent(r.split('#')[0]!))) }));
}

/** Every element closed in order: enough to catch broken XHTML without a parser (CDATA left out). */
function wellFormed(xml: string): boolean {
  const stack: string[] = [];
  for (const m of xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<!doctype[^>]*>/i, '').matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)) {
    if (m[3] || ['meta', 'img', 'br'].includes(m[2]!)) continue;
    if (!m[1]) stack.push(m[2]!);
    else if (stack.pop() !== m[2]) return false;
  }
  return stack.length === 0;
}

describe('carto describe', () => {
  it('prints the diagram in words, and writes Markdown or HTML by the extension', () => {
    const r = carto('describe', 'examples/sequence/checkout.yaml');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Checkout\n\nSequence diagram: Card payment/);
    expect(r.out).toContain('1. Shopper calls Storefront: Place order.');
    expect(carto('describe', 'examples/erd/orders.yaml', '-o', out('orders.md')).code).toBe(0);
    const md = fs.readFileSync(out('orders.md'), 'utf8');
    expect(md).toMatch(/^# Orders\n/);
    expect(md).toContain('## Relations');
    expect(md).toContain('customer_id (uuid, foreign key to customers.id)');
    expect(carto('describe', 'examples/matrix/raci-migration.yaml', '-o', out('raci.html')).code).toBe(0);
    expect(fs.readFileSync(out('raci.html'), 'utf8')).toContain('<li>Business case: Sponsor: A (Accountable)');
  });

  it('describes a view, or every view', () => {
    expect(carto('describe', 'examples/teams/product-org.yaml', '--view', 'topology').out).toContain('Team topology');
    const all = carto('describe', 'examples/teams/product-org.yaml', '--all-views', '--format', 'md').out;
    expect(all).toContain('## Who reports to whom');
    expect(all).toContain('### Interactions');
  });

  it('says what is wrong with a broken diagram and writes nothing', () => {
    fs.writeFileSync(out('broken.yaml'), 'type: nonsense\n');
    const r = carto('describe', out('broken.yaml'));
    expect(r.code).toBe(1);
    expect(r.err).toContain('Unknown type');
  });
});

describe('carto render to PNG', () => {
  it('puts the title and the description in the PNG', () => {
    expect(carto('render', 'examples/systems/web-shop.yaml', '-o', out('shop.png')).code).toBe(0);
    const png = fs.readFileSync(out('shop.png'));
    expect(png.toString('latin1', 37, 46)).toBe('iTXtTitle');
    expect(png.toString('utf8')).toContain('Description\0\0\0\0\0Architecture diagram: How an order flows through the system.');
  });
});

describe('carto export-md', () => {
  it('a folder: an index, a page per diagram, pictures that resolve, steps as sections', () => {
    const dir = out('md');
    const r = carto('export-md', 'examples/systems', '-o', `${dir}/`);
    expect(r.code, r.err).toBe(0);
    const index = path.join(dir, 'README.md');
    const links = targets(index);
    expect(links.map((l) => l.ref)).toEqual(['data-pipeline.md', 'invoice-walkthrough.md', 'saas-platform.md', 'threat-model.md', 'web-shop.md']);
    for (const page of [index, ...links.map((l) => path.join(dir, l.ref))]) for (const t of targets(page)) expect(t.ok, `${path.basename(page)} → ${t.ref}`).toBe(true);
    const walk = fs.readFileSync(path.join(dir, 'invoice-walkthrough.md'), 'utf8');
    expect(walk).toContain('## Step by step');
    expect(walk).toContain('### 3. Then checkout waits for Finance');
    expect(walk).toContain('![Checkout without waiting, step 3 of 7: Then checkout waits for Finance.');
    // A view of its own under its heading.
    expect(fs.readFileSync(path.join(dir, 'threat-model.md'), 'utf8')).toMatch(/\n## .*\n\n!\[.*\]\(images\/threat-model-threats\.svg\)/);
    // The SVG carries its words too.
    expect(fs.readFileSync(path.join(dir, 'images/web-shop.svg'), 'utf8')).toContain('<desc id=');
  });

  it('one file: README.md beside its pictures', () => {
    const dir = out('one');
    expect(carto('export-md', 'examples/erd/orders.yaml', '-o', dir).code).toBe(0);
    const t = targets(path.join(dir, 'README.md'));
    expect(t.map((x) => x.ref)).toEqual(['images/orders.svg', 'images/orders.png', 'images/orders.svg']);
    expect(t.every((x) => x.ok)).toBe(true);
  });

  it('needs -o', () => {
    expect(carto('export-md', 'examples/erd/orders.yaml').code).toBe(1);
  });
});

describe('carto export-confluence', () => {
  it('storage-format pages with their attachments, a parent page, a manifest and how to import', () => {
    const dir = out('cf');
    const r = carto('export-confluence', 'examples/sequence', '-o', dir, '--title', 'Flows');
    expect(r.code, r.err).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    expect(manifest.title).toBe('Flows');
    expect(manifest.pages.map((p: { title: string }) => p.title)).toEqual(['Checkout', 'Sign in with OAuth 2.0', 'Nightly export handshake']);
    for (const p of manifest.pages) {
      const body = fs.readFileSync(path.join(dir, p.body), 'utf8');
      expect(wellFormed(body), p.body).toBe(true);
      for (const f of [...body.matchAll(/ri:filename="([^"]+)"/g)].map((m) => m[1]!)) {
        expect(p.attachments).toContain(f);
        expect(fs.existsSync(path.join(dir, p.dir, f))).toBe(true);
      }
      expect(wellFormed(fs.readFileSync(path.join(dir, p.html), 'utf8'))).toBe(true);
    }
    const checkout = fs.readFileSync(path.join(dir, 'checkout/page.xhtml'), 'utf8');
    expect(checkout).toContain('<ac:image ac:alt="Checkout. Sequence diagram: Card payment');
    expect(checkout).toContain('<h2>Message flow</h2>');
    expect(fs.readFileSync(path.join(dir, 'index.xhtml'), 'utf8')).toContain('<ac:structured-macro ac:name="children"');
    expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toContain('child/attachment');
  });
});

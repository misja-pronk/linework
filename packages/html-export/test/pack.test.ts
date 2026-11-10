import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { gunzipSync, strFromU8 } from 'fflate';
import { base64, drawnShapes, exportHtml, shareIcons, type Payload } from '../src/index.ts';
import { viewerScript } from '../src/generated/viewer.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const reader = (dir: string) => (p: string) => {
  try {
    return fs.readFileSync(path.join(root, dir, p), 'utf8');
  } catch {
    return undefined;
  }
};

/** The data block of a page, unpacked as the viewer does. */
function payloadOf(html: string): Payload {
  const data = /<script type="application\/gzip\+json;base64" id="carto-data">([^<]*)<\/script>/.exec(html)![1]!;
  return JSON.parse(strFromU8(gunzipSync(Uint8Array.from(atob(data), (c) => c.charCodeAt(0))))) as Payload;
}

async function sha(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `'sha256-${Buffer.from(d).toString('base64')}'`;
}

describe('packing', () => {
  it('writes base64 the browser reads back, also for large arrays', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 7) % 256);
    expect(Buffer.from(base64(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });

  it('keeps one copy of a picture that repeats, and leaves small ones in place', () => {
    const big = `data:image/png;base64,${'A'.repeat(400)}`;
    const small = 'data:image/png;base64,AAAA';
    const pics = [
      { w: 1, h: 1, light: `<svg><image href="${big}"/><image href="${small}"/></svg>`, dark: `<svg><image xlink:href="${big}"/></svg>` },
      { w: 1, h: 1, light: `<svg><image href="${big}"/></svg>` },
    ];
    const table = shareIcons(pics);
    expect(table).toEqual([big]);
    expect(pics[0]!.light).toBe(`<svg><image data-carto-icon="0"/><image href="${small}"/></svg>`);
    expect(pics[0]!.dark).toBe('<svg><image data-carto-icon="0"/></svg>');
    expect(pics[1]!.light).toBe('<svg><image data-carto-icon="0"/></svg>');
  });

  it('reads the shapes of a drawing, ids unescaped', () => {
    expect(drawnShapes('<g data-node="a&amp;b"><g data-group="g1"></g><g data-node="a&amp;b">')).toEqual(['n:a&b', 'g:g1']);
  });

  it('carries the viewer as built from its source', async () => {
    // @ts-expect-error: a plain .mjs build script
    const { viewerModule, generated } = await import('../build.mjs');
    expect(fs.readFileSync(generated, 'utf8'), 'run: node packages/html-export/build.mjs').toBe(await viewerModule());
  });
});

describe('the page', () => {
  const hostile = `type: systems
title: "</script><script>alert(1)</script> & <b>bold</b>"
nodes:
  web: { label: "<img src=x onerror=alert(1)>", kind: client, description: "\\"quoted\\" <i>and</i> 'single'", links: ["javascript:alert(1)", "https://example.com/runbook"] }
  db: { label: Orders DB, kind: database, owner: team-data, technology: PostgreSQL, tags: [pii] }
edges:
  - web -> db
`;

  it('escapes what comes from the YAML and allows only its own two inline blocks', async () => {
    const r = await exportHtml({ entries: ['shop.yaml'], read: (p) => (p === 'shop.yaml' ? hostile : undefined), date: new Date('2026-11-10') });
    expect(r.problems).toEqual([]);
    const { html } = r;
    // The title is the only text from the YAML outside the data block, escaped.
    expect(html).toContain('<title>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;</title>');
    expect(html.match(/<script\b/g)).toHaveLength(2);
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/onerror/);
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)![1]!;
    const script = /<script>([\s\S]*)<\/script>\n<\/body>/.exec(html)![1]!;
    const style = /<style>([\s\S]*)<\/style>/.exec(html)![1]!;
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src ${await sha(script)}`);
    expect(csp).toContain(`style-src ${await sha(style)}`);
    expect(csp).not.toMatch(/unsafe-(inline|eval)|https?:/);
    expect(script).not.toMatch(/\beval\(|new Function|innerHTML|insertAdjacentHTML|document\.write/);
    expect(viewerScript).not.toMatch(/<\/script/i);
  });

  it('carries the drawing in both looks, with what each shape is', async () => {
    const { html } = await exportHtml({ entries: ['shop.yaml'], read: (p) => (p === 'shop.yaml' ? hostile : undefined) });
    const p = payloadOf(html);
    expect(p.site).toBe(false);
    expect(p.drawings).toHaveLength(1);
    const d = p.drawings[0]!;
    expect(d.light).toMatch(/^<svg/);
    expect(d.dark).toMatch(/^<svg/);
    expect(d.dark).not.toBe(d.light);
    // Text in the SVG is escaped by the renderer.
    expect(d.light).toContain('&lt;img src=x onerror=alert(1)&gt;');
    const web = p.elements[d.shapes['n:web']!]!;
    expect(web.label).toBe('<img src=x onerror=alert(1)>');
    // Only http(s) leaves the page; a javascript: link is not a link.
    expect(web.links).toEqual([{ label: 'example.com/runbook', href: 'https://example.com/runbook' }]);
    const db = p.elements[d.shapes['n:db']!]!;
    expect(db).toMatchObject({ owner: 'team-data', technology: 'PostgreSQL', tags: ['pii'] });
    expect(db.where).toEqual([[0, 'n:db']]);
  });

  it('draws written steps, each in both looks, without their caption in the drawing', async () => {
    const { html, stats } = await exportHtml({ entries: ['invoice-walkthrough.yaml'], read: reader('examples/systems') });
    const p = payloadOf(html);
    const d = p.drawings[0]!;
    expect(d.steps?.length).toBe(7);
    expect(stats.steps).toBe(7);
    expect(d.steps![1]!.title).toBe('The order itself is quick');
    expect(d.steps![1]!.dark).toBeTruthy();
    expect(d.steps![1]!.light).not.toContain('The order itself is quick');
  }, 30_000);

  it('makes a folder a site: elements from the model, drill-down, breadcrumbs, the C4 levels in order', async () => {
    const dir = path.join(root, 'examples/workspace');
    const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'));
    const { html, problems } = await exportHtml({ entries, read: reader('examples/workspace'), site: true });
    expect(problems).toEqual([]);
    const p = payloadOf(html);
    expect(p.site).toBe(true);
    expect(p.title).toBe('Harbour Bank');
    const at = (key: string) => p.drawings.findIndex((d) => d.key === key);
    const context = p.drawings[at('context.yaml#context')]!;
    // The system in the context view opens its containers.
    expect(p.drawings[context.drill['n:online']!]!.key).toBe('containers.yaml#online');
    const containers = p.drawings[at('containers.yaml#online')]!;
    expect(p.drawings[containers.drill['n:online.api']!]!.key).toBe('containers.yaml#api');
    const api = p.elements[containers.shapes['n:online.api']!]!;
    expect(api).toMatchObject({ id: 'online.api', label: 'Banking API', kind: 'container', technology: 'Spring Boot' });
    expect(p.elements[api.parent!]!.label).toBe('Harbour Online');
    // The deployment draws the same element; its card links to the model.
    const deploy = p.drawings[at('deployment.yaml')]!;
    expect(p.elements[deploy.shapes['n:api']!]).toBe(api);
    expect(api.where.map(([d]) => p.drawings[d]!.key)).toEqual(expect.arrayContaining(['containers.yaml#online', 'deployment.yaml']));
    expect(p.drawings[deploy.drill['n:api']!]!.key).toBe('model.yaml#landscape');
    expect(p.drawings[at('containers.yaml#api')]!.trail?.map((c) => c.label)).toEqual(['Harbour Online — system context', 'Harbour Online', 'Banking API']);
    // The landscape and the context come first.
    expect(p.files.slice(0, 3).map((f) => f.path)).toEqual(['model.yaml', 'context.yaml', 'containers.yaml']);
  }, 30_000);

  it('brings along what a single diagram drills into, and only that', async () => {
    const nearby = fs.readdirSync(path.join(root, 'examples/workspace')).filter((f) => f.endsWith('.yaml'));
    const { html } = await exportHtml({ entries: ['context.yaml'], nearby, read: reader('examples/workspace') });
    const p = payloadOf(html);
    expect(p.files.map((f) => f.path)).toEqual(['context.yaml', 'containers.yaml']);
    expect(p.site).toBe(true);
  }, 30_000);

  it('lists open review notes and never resolved ones', async () => {
    const notes = {
      version: 1 as const,
      threads: [
        { id: 'a', author: 'Ann', created: '2026-11-01T10:00:00Z', text: 'Is this **cached**?', anchor: { kind: 'node' as const, id: 'db' }, status: 'open' as const },
        { id: 'b', author: 'Bob', created: '2026-11-02T10:00:00Z', text: 'secret resolved remark', anchor: { kind: 'node' as const, id: 'web' }, status: 'resolved' as const },
      ],
    };
    const opts = { entries: ['shop.yaml'], read: (p: string) => (p === 'shop.yaml' ? hostile : undefined), notesFor: () => notes };
    const off = payloadOf((await exportHtml(opts)).html);
    expect(off.drawings[0]!.notes).toBeUndefined();
    const on = await exportHtml({ ...opts, notes: true });
    const p = payloadOf(on.html);
    expect(p.drawings[0]!.notes).toEqual([{ n: 1, about: 'Orders DB', shape: 'n:db', author: 'Ann', date: '2026-11-01', text: 'Is this cached?', replies: [] }]);
    expect(on.html).not.toContain('secret');
    expect(JSON.stringify(p)).not.toContain('secret resolved remark');
  });
});

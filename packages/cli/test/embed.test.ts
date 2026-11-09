import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { embed, embedCss } from '../src/embed.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../docs-plugins/test/fixtures');
const count = (text: string, part: string) => text.split(part).length - 1;

describe('carto embed', () => {
  it('writes the drawing alone with --static: a page without any script', async () => {
    const r = await embed(path.join(fixtures, 'shop.yaml'), { static: true });
    expect(r.ok).toBe(true);
    expect(r.html.startsWith('<!doctype html>')).toBe(true);
    expect(r.html).toContain('<svg');
    expect(r.html).toContain('class="carto-light"');
    expect(r.html).toContain('class="carto-dark"');
    expect(r.html).not.toContain('<script');
    expect(r.html).not.toContain('<carto-diagram');
  });

  it('writes only the figure with --fragment, with the files the live diagram needs', async () => {
    const r = await embed(path.join(fixtures, 'shop.yaml'), { fragment: true });
    expect(r.ok).toBe(true);
    expect(r.html.startsWith('<carto-diagram data-bundle="')).toBe(true);
    expect(r.html).toContain('<figure class="carto');
    expect(r.html).not.toContain('<html');
    expect(embedCss()).toContain('.carto-dark{display:none}');
  });

  it('writes one page with the component inside', async () => {
    const r = await embed(path.join(fixtures, 'shop.yaml'), {});
    expect(r.html).toContain('<carto-diagram data-bundle="');
    // The component is the only script, and nothing in it ends the element early.
    expect(count(r.html, '<script type="module">')).toBe(1);
    expect(count(r.html.toLowerCase(), '</script')).toBe(1);
    expect(r.html).not.toContain('<!--');
    expect(r.html).not.toMatch(/<script[^>]*\ssrc=/);
  }, 60_000);

  it('keeps hostile labels as text and drops links that could run script', async () => {
    const r = await embed(path.join(fixtures, 'hostile.yaml'), { static: true });
    expect(r.html).not.toMatch(/<script|<img|<iframe|<foreignObject/i);
    // The attributes of the tags that are really tags: a label that says onerror= is only text.
    const attrs = [...r.html.matchAll(/<[a-zA-Z][\w-]*((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)].flatMap((m) =>
      [...m[1]!.matchAll(/([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((a) => ({ name: a[1]!.toLowerCase(), value: a[2] ?? a[3] ?? a[4] ?? '' })),
    );
    expect(attrs.length).toBeGreaterThan(50);
    expect(attrs.filter((a) => a.name.startsWith('on'))).toEqual([]);
    const hrefs = attrs.filter((a) => a.name === 'href' || a.name === 'xlink:href').map((a) => a.value);
    expect(hrefs.filter((h) => !/^(https?:|mailto:|#)/i.test(h) && !/^data:image\//i.test(h))).toEqual([]);
  });

  it('gives a message a reader can use when the diagram has errors', async () => {
    const r = await embed(path.join(fixtures, 'broken.yaml'), { fragment: true });
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.severity === 'error' && p.line)).toBe(true);
    expect(r.html).toContain('role="alert"');
  });
});

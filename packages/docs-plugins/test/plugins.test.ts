import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '@mdx-js/mdx';
import MarkdownIt from 'markdown-it';
import rehypeStringify from 'rehype-stringify';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { afterAll, describe, expect, it } from 'vitest';
import { diagramReference, fenceInfo, pageCss } from '../src/core.ts';
import { markdownItCartography, remarkCartography, type CartographyOptions, type MarkdownItCartographyOptions } from '../src/index.ts';
import { parseSvg, toHtml } from '../src/tree.ts';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const page = path.join(fixtures, 'page.md');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-docs-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const SHOP = [
  'type: systems',
  'title: Sign-up',
  'nodes:',
  '  visitor: { kind: user, label: Visitor }',
  '  site: { kind: client, label: Website }',
  'edges:',
  '  - visitor -> site: Fills in the form',
].join('\n');
const fence = (yaml: string, info = 'cartography') => '```' + info + '\n' + yaml + '\n```\n';
const count = (text: string, part: string) => text.split(part).length - 1;
const unescape = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

async function remark(markdown: string, options: CartographyOptions = {}) {
  const file = await unified().use(remarkParse).use(remarkCartography, options).use(remarkRehype).use(rehypeStringify).process({ path: page, value: markdown });
  return { html: String(file), messages: file.messages };
}

function markdownIt(markdown: string, options: MarkdownItCartographyOptions = {}) {
  const warnings: string[] = [];
  const md = new MarkdownIt().use(markdownItCartography, { warn: (m: string) => warnings.push(m), ...options });
  return { html: md.render(markdown, { path: page }), warnings };
}

/** Everything in the output that could run or lead somewhere: the tags that are really tags, their handlers and link targets. */
function surface(html: string) {
  const withoutStyle = html.replace(/<style[^>]*>[^]*?<\/style>/g, '');
  const TAG = /<([a-zA-Z][\w-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
  const tags = [...withoutStyle.matchAll(TAG)];
  const attrs = tags.flatMap((m) =>
    [...m[2]!.matchAll(/([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((a) => ({ name: a[1]!.toLowerCase(), value: a[2] ?? a[3] ?? a[4] ?? '' })),
  );
  // Every "<" that opens something must be one of those tags: nothing half-read slips by.
  const unread = count(withoutStyle.replace(TAG, '').replace(/<\/[\w-]+>/g, ''), '<');
  return {
    tags: new Set(tags.map((m) => m[1]!.toLowerCase())),
    unread,
    handlers: attrs.filter((a) => a.name.startsWith('on')).map((a) => a.name),
    hrefs: attrs.filter((a) => a.name === 'href' || a.name === 'xlink:href' || a.name === 'src' || a.name === 'srcset').map((a) => a.value),
  };
}
const ALLOWED = [
  'figure',
  'div',
  'svg',
  'defs',
  'filter',
  'fedropshadow',
  'g',
  'rect',
  'text',
  'tspan',
  'path',
  'title',
  'circle',
  'line',
  'a',
  'details',
  'summary',
  'p',
  'ul',
  'li',
  'strong',
  'carto-diagram',
  'ellipse',
  'polygon',
  'polyline',
];

describe('reading the fence line and image addresses', () => {
  it('takes cartography and carto, with view, theme, title and interactive', () => {
    expect(fenceInfo('cartography')).toEqual({ match: true });
    expect(fenceInfo('carto view=ordering theme=dark interactive title="Placing an order"')).toEqual({
      match: true,
      view: 'ordering',
      theme: 'dark',
      interactive: true,
      title: 'Placing an order',
    });
    expect(fenceInfo('yaml').match).toBe(false);
    expect(fenceInfo('cartographer').match).toBe(false);
  });
  it('sees a diagram in a relative .yaml address only', () => {
    expect(diagramReference('./model/context.yaml#containers')).toEqual({ file: './model/context.yaml', view: 'containers' });
    expect(diagramReference('shop.yml')).toEqual({ file: 'shop.yml' });
    expect(diagramReference('https://example.com/shop.yaml')).toBeUndefined();
    expect(diagramReference('//example.com/shop.yaml')).toBeUndefined();
    expect(diagramReference('./photo.png')).toBeUndefined();
  });
});

describe('remark', () => {
  it('draws a fenced block as inline SVG, light and dark, with the stylesheet once', async () => {
    const { html, messages } = await remark(`# Page\n\n${fence(SHOP)}\nText between.\n\n${fence(SHOP, 'carto')}\n\`\`\`yaml\ntype: systems\n\`\`\`\n`);
    expect(messages).toEqual([]);
    expect(count(html, '<figure class="carto">')).toBe(2);
    expect(count(html, '<svg')).toBe(4);
    expect(count(html, '<div class="carto-light">')).toBe(2);
    expect(count(html, '<div class="carto-dark">')).toBe(2);
    expect(count(html, '<style data-carto')).toBe(1);
    expect(html).toContain('aria-label="Sign-up"');
    expect(html).toContain('Fills in the form');
    // Another language is left alone.
    expect(html).toContain('<code class="language-yaml">');
    expect(html).not.toContain('language-cartography');
    // The two drawings differ: one is dark.
    const [light, dark] = [...html.matchAll(/<div class="carto-(?:light|dark)">(<svg[^]*?<\/svg>)/g)].map((m) => m[1]!);
    expect(light).not.toBe(dark);
    // The text is set in the page's copy of the theme's typefaces, which the stylesheet brings once.
    expect(unescape(light!)).toContain(`font-family="CartoInstrumentSans, 'Instrument Sans'`);
    expect(count(html, '@font-face{font-family:CartoInstrumentSans;font-style:normal;font-weight:400')).toBe(1);
  });

  it('gives the drawings in a page ids of their own, and a drawing in another theme its own typefaces', async () => {
    // Classic has shadows, so its drawings carry ids (filters).
    const { html, messages } = await remark(`${fence(SHOP, 'cartography theme=classic')}\n${fence(SHOP.replace('Sign-up', 'Sign-in'), 'cartography theme=classic')}\n`);
    expect(messages).toEqual([]);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
    // Inter is not in the stylesheet of a site in the default look: each classic drawing brings it.
    expect(html).toContain('font-family="CartoInter, Inter');
    expect(count(html, '@font-face{font-family:CartoInter;font-style:normal;font-weight:400')).toBe(2);
  });

  it('draws an image that points at a diagram file, with its view and the alt text as name', async () => {
    const { html } = await remark('Before.\n\n![Checkout in words](../../../../examples/model/containers.yaml#ordering)\n\nAfter ![photo](./photo.png).\n');
    expect(html).toContain('aria-label="Checkout in words"');
    expect(html).toContain('Placing an order');
    expect(html).not.toContain('containers.yaml');
    expect(html).toContain('<img src="./photo.png" alt="photo">');
    const other = await remark('![All](../../../../examples/model/containers.yaml#containers)\n');
    expect(other.html).toContain('Web shop — containers');
    expect(other.html).not.toContain('Placing an order');
  });

  it('keeps the text around a diagram in the same paragraph', async () => {
    const { html } = await remark('See here: ![Shop](./shop.yaml) and then on.\n');
    expect(html).toMatch(/<p>See here: <\/p>\s*<style[^]*<\/style>\s*<figure class="carto">[^]*<\/figure>\s*<p> and then on\.<\/p>/);
  });

  it('uses the view and theme options, and the ones on the fence line', async () => {
    const dark = await remark(fence(SHOP), { theme: 'dark' });
    expect(count(dark.html, '<svg')).toBe(1);
    expect(dark.html).toContain('<div class="carto-only">');
    const both = await remark(fence(SHOP));
    const darkOfBoth = /<div class="carto-dark">(<svg[^]*?<\/svg>)/.exec(both.html)![1]!;
    const only = /<div class="carto-only">(<svg[^]*?<\/svg>)/.exec(dark.html)![1]!;
    const fills = (svg: string) => [...svg.matchAll(/fill="(#[0-9a-fA-F]+)"/g)].map((m) => m[1]).join();
    expect(fills(only)).toBe(fills(darkOfBoth));

    const onFence = await remark(fence(SHOP, 'cartography theme=dark'));
    expect(count(onFence.html, '<svg')).toBe(1);
    const view = await remark('![](../../../../examples/model/containers.yaml)\n', { view: 'ordering' });
    expect(view.html).toContain('Placing an order');
    const unknown = await remark(fence(SHOP), { theme: 'neon' });
    expect(unknown.messages.map((m) => m.reason).join()).toContain('Unknown theme "neon"');
    expect(count(unknown.html, '<svg')).toBe(2);
  });

  it('writes the page CSS for the way the site says it is dark', () => {
    expect(pageCss()).toContain('@media (prefers-color-scheme:dark)');
    expect(pageCss()).toContain('[data-theme=dark]');
    expect(pageCss()).toContain('@font-face{font-family:CartoInstrumentSans');
    expect(pageCss()).toContain('@font-face{font-family:CartoGeistMono');
    expect(pageCss({ theme: 'classic' })).toContain('@font-face{font-family:CartoInter');
    expect(pageCss({ dark: 'media' })).not.toContain('[data-theme=dark]');
    const own = pageCss({ dark: '.dark', fonts: 'none' });
    expect(own).toContain(':is(.dark) .carto-dark{display:block}');
    expect(own).not.toContain('@media');
    expect(own).not.toContain('@font-face');
    // The CSS goes through templating of every kind: nothing in it needs escaping.
    expect(pageCss()).not.toMatch(/[<>&"']/);
  });

  it('writes files and points images at them', async () => {
    const outDir = path.join(tmp, 'img');
    const { html } = await remark('![Shop](./shop.yaml)\n', { output: 'file', outDir, publicPath: '/img' });
    const files = fs.readdirSync(outDir).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^shop-[0-9a-f]{8}\.dark\.svg$/);
    expect(files[1]).toMatch(/^shop-[0-9a-f]{8}\.svg$/);
    expect(html).toContain(`<div class="carto-light"><img src="/img/${files[1]}" alt="Shop"`);
    expect(html).toContain(`<div class="carto-dark"><img src="/img/${files[0]}" alt="Shop"`);
    expect(html).not.toContain('<svg');
    // A file stands on its own: the font is inside it.
    expect(fs.readFileSync(path.join(outDir, files[1]!), 'utf8')).toContain('@font-face');

    const picture = await remark('![Shop](./shop.yaml)\n', { output: 'file', outDir, publicPath: '/img/', dark: 'media' });
    expect(picture.html).toMatch(/<picture><source srcset="\/img\/shop-[0-9a-f]{8}\.dark\.svg" media="\(prefers-color-scheme: dark\)"><img src="\/img\/shop-[0-9a-f]{8}\.svg"/);
  });

  it('wraps the drawing in the component with everything it needs, when asked', async () => {
    const { html } = await remark('![Context](../../../../examples/model/context.yaml)\n', { interactive: true });
    expect(html).toMatch(/<carto-diagram data-bundle="[^"]+"><figure class="carto">/);
    const bundle = JSON.parse(unescape(/data-bundle="([^"]+)"/.exec(html)![1]!)) as { main: string; files: Record<string, string> };
    expect(bundle.main).toBe('context.yaml');
    // The diagram, what it includes, and the diagrams its links lead to (and theirs).
    expect(Object.keys(bundle.files).sort()).toEqual(['containers.yaml', 'context.yaml', 'deployment.yaml', 'model.yaml']);
    expect(bundle.files['context.yaml']).toBe(fs.readFileSync(path.join(fixtures, '../../../../examples/model/context.yaml'), 'utf8'));

    const fenced = await remark(fence(SHOP, 'cartography interactive'));
    expect(fenced.html).toContain('<carto-diagram data-bundle=');
    const off = await remark(fence(SHOP, 'cartography static'), { interactive: true });
    expect(off.html).not.toContain('<carto-diagram');
    // An image says it in its title.
    const image = await remark('![Shop](./shop.yaml "interactive theme=dark")\n');
    expect(image.html).toMatch(/<carto-diagram data-bundle="[^"]+" theme="dark"><figure class="carto"><div class="carto-only">/);
  });

  it('adds the drawing in words when asked', async () => {
    const { html } = await remark('![Shop](./shop.yaml)\n', { description: true });
    expect(html).toContain('<details class="carto-text"><summary>Text description</summary>');
    expect(html).toContain('<strong>Storefront</strong>');
    expect(html).toContain('<li>Customer → Storefront: Browses</li>');
    expect(html).toContain('<a href="https://example.com/storefront" rel="noopener noreferrer">');
  });

  it('keeps web links on elements and drops links a static page cannot follow', async () => {
    const { html } = await remark('![Shop](./shop.yaml)\n');
    expect(surface(html).hrefs.filter((h) => !h.startsWith('#'))).toEqual(['https://example.com/storefront', 'https://example.com/storefront']);
    expect(html).toContain('<a href="https://example.com/storefront" target="_blank" rel="noopener noreferrer">');
    expect(html).toContain('role="group"');
  });

  it('stops the build on an error, with the file and the line', async () => {
    const markdown = `# Page\n\nText.\n\n${fence('type: systems\nnodes:\n  web: { kind: client }\nedges:\n  - web -> nowhere: Calls')}`;
    const failed = await remark(markdown).catch((e: unknown) => e as { reason: string; line: number; file: string; fatal: boolean });
    expect(failed).toMatchObject({ fatal: true, line: 10, file: page });
    expect((failed as { reason: string }).reason).toContain('nowhere');

    const inFile = await remark('Text.\n\n![Broken](./broken.yaml)\n').catch((e: unknown) => e as { reason: string; line: number });
    expect(inFile).toMatchObject({ line: 3 });
    expect((inFile as { reason: string }).reason).toMatch(/packages\/docs-plugins\/test\/fixtures\/broken\.yaml:5:\d+: .*nowhere/);

    const missing = await remark('![Gone](./gone.yaml)\n').catch((e: unknown) => e as { reason: string });
    expect((missing as { reason: string }).reason).toContain('Cannot read packages/docs-plugins/test/fixtures/gone.yaml');
    const syntax = await remark(fence('type: systems\nnodes: [unclosed')).catch((e: unknown) => e as { reason: string; line: number });
    expect(syntax).toMatchObject({ fatal: true });
    expect((syntax as { line: number }).line).toBeGreaterThanOrEqual(2);
  });

  it('shows the problem in the page and warns when not strict', async () => {
    const { html, messages } = await remark(`${fence('type: systems\nnodes:\n  web: { kind: client }\nedges:\n  - web -> nowhere: Calls')}\n${fence(SHOP)}`, { strict: false });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ line: 6, fatal: false });
    expect(html).toContain('<figure class="carto carto-problem" role="alert"');
    expect(html).toContain('This diagram has a problem');
    expect(html).toContain('nowhere');
    // The good diagram after it is still drawn.
    expect(count(html, '<figure class="carto">')).toBe(1);
  });

  it('refuses to read outside the root', async () => {
    const failed = await remark('![Shop](./shop.yaml)\n', { root: path.join(fixtures, 'nowhere') }).catch((e: unknown) => e as { reason: string });
    expect((failed as { reason: string }).reason).toContain('is outside');
  });

  it('lets nothing from a hostile diagram become markup or a script link', async () => {
    for (const options of [{}, { interactive: true, description: true }, { theme: 'dark' }] as CartographyOptions[]) {
      const { html } = await remark('![x](./hostile.yaml)\n', options);
      const s = surface(html);
      expect([...s.tags].filter((t) => !ALLOWED.includes(t))).toEqual([]);
      expect(s.handlers).toEqual([]);
      expect(s.unread).toBe(0);
      expect(s.hrefs.filter((h) => !h.startsWith('#') && !/^(https:\/\/example\.com\/ok|mailto:someone@example\.com)$/.test(h))).toEqual([]);
      // What was written as markup is there as text.
      expect(html).toContain('&#x3C;script>window.pwned=1&#x3C;/script>');
    }
  });

  it('works in MDX, as elements', async () => {
    // React comes without types here; these two calls are all the test needs from it.
    const runtime = (await import('react/jsx-runtime' as string)) as { jsx: (type: unknown, props: object) => unknown } & Parameters<typeof evaluate>[1];
    const { renderToStaticMarkup } = (await import('react-dom/server' as string)) as { renderToStaticMarkup: (node: unknown) => string };
    const { default: Content } = await evaluate(
      { path: page, value: `# Page\n\n${fence(SHOP)}\n![x](./hostile.yaml)\n` },
      { ...runtime, remarkPlugins: [[remarkCartography, { interactive: true }]] },
    );
    const html = renderToStaticMarkup(runtime.jsx(Content, {}));
    expect(count(html, '<figure class="carto">')).toBe(2);
    expect(count(html, '<svg')).toBe(4);
    expect(count(html, '<carto-diagram data-bundle=')).toBe(2);
    expect(count(html, '<style data-carto')).toBe(1);
    // React writes the CSS as it is: the dark rules and the font survive.
    expect(html).toContain('.carto-dark{display:none}');
    expect(html).toContain('src:url(data:font/woff2;base64,');
    expect(html).toContain('viewBox=');
    expect(html).not.toMatch(/<script|<img/i);
    const s = surface(html);
    expect([...s.tags].filter((t) => !ALLOWED.includes(t) && !['h1', 'style'].includes(t))).toEqual([]);
    expect(s.unread).toBe(0);
    expect(s.handlers).toEqual([]);
    expect(s.hrefs.filter((h) => !h.startsWith('#') && !/^(https:\/\/example\.com\/ok|mailto:someone@example\.com)$/.test(h))).toEqual([]);
  });
});

describe('markdown-it', () => {
  it('draws a fenced block as inline SVG, light and dark, with the stylesheet once', () => {
    const { html, warnings } = markdownIt(`# Page\n\n${fence(SHOP)}\nText between.\n\n${fence(SHOP, 'carto')}\n\`\`\`yaml\ntype: systems\n\`\`\`\n`);
    expect(warnings).toEqual([]);
    expect(count(html, '<figure class="carto">')).toBe(2);
    expect(count(html, '<svg')).toBe(4);
    expect(count(html, '<div class="carto-dark">')).toBe(2);
    expect(count(html, '<style data-carto>')).toBe(1);
    expect(html).toContain('aria-label="Sign-up"');
    expect(html).toContain('<code class="language-yaml">');
    // What markdown-it writes is the same drawing remark writes.
    expect(() => parseSvg(/<svg[^]*?<\/svg>/.exec(html)![0])).not.toThrow();
  });

  it('draws an image that points at a diagram file, and keeps the text around it', () => {
    const { html } = markdownIt(
      'See here: ![Checkout in words](../../../../examples/model/containers.yaml#ordering) and then on.\n\n- ![Shop](./shop.yaml)\n\n![photo](./photo.png)\n',
    );
    expect(html).toMatch(/<p>See here: <\/p>\s*<style[^]*<\/style>\s*<figure class="carto">[^]*?<\/figure>\s*<p> and then on\.<\/p>/);
    expect(html).toContain('aria-label="Checkout in words"');
    expect(html).toContain('Placing an order');
    expect(html).toContain('aria-label="Shop"');
    expect(html).toContain('<img src="./photo.png" alt="photo">');
    expect(count(html, '<figure class="carto">')).toBe(2);
  });

  it('uses the options: theme, dark selector, interactive, files, vue', () => {
    const dark = markdownIt(fence(SHOP), { theme: 'dark' });
    expect(count(dark.html, '<svg')).toBe(1);
    const own = markdownIt(fence(SHOP), { dark: '.dark' });
    expect(own.html).toContain(':is(.dark) .carto-dark{display:block}');
    const live = markdownIt('![Context](../../../../examples/model/context.yaml)\n', { interactive: true, vue: true });
    expect(live.html).toMatch(/<carto-diagram data-bundle="[^"]+" v-pre><figure class="carto">/);
    expect(live.html).toContain('containers.yaml');
    const image = markdownIt('![Shop](./shop.yaml "interactive")\n');
    expect(image.html).toContain('<carto-diagram data-bundle=');
    const vue = markdownIt(fence(SHOP), { vue: true });
    expect(vue.html).toContain('<figure class="carto" v-pre>');
    const outDir = path.join(tmp, 'mdit');
    const files = markdownIt('![Shop](./shop.yaml)\n', { output: 'file', outDir, publicPath: '/assets/' });
    expect(fs.readdirSync(outDir)).toHaveLength(2);
    expect(files.html).toMatch(/<img src="\/assets\/shop-[0-9a-f]{8}\.svg" alt="Shop" width="\d+" height="\d+" loading="lazy" decoding="async">/);
    const none = markdownIt(fence(SHOP), { pageStyle: false });
    expect(none.html).not.toContain('<style');
  });

  it('stops the build on an error, with the file and the line', () => {
    const markdown = `# Page\n\nText.\n\n${fence('type: systems\nnodes:\n  web: { kind: client }\nedges:\n  - web -> nowhere: Calls')}`;
    expect(() => markdownIt(markdown)).toThrow(/^packages\/docs-plugins\/test\/fixtures\/page\.md:10:\d+: .*nowhere/);
    expect(() => markdownIt('Text.\n\n![Broken](./broken.yaml)\n')).toThrow(
      /^packages\/docs-plugins\/test\/fixtures\/page\.md:3: packages\/docs-plugins\/test\/fixtures\/broken\.yaml:5:\d+: .*nowhere/,
    );
    expect(() => markdownIt('![Gone](./gone.yaml)\n')).toThrow(/page\.md:1: .*Cannot read .*gone\.yaml/);
    expect(() => markdownIt(`Text.\n\n${fence(SHOP, 'carto view=x')}`)).toThrow(/page\.md:4:1: There is no view "x"/);
  });

  it('shows the problem in the page and warns when not strict', () => {
    const { html, warnings } = markdownIt(`${fence('type: systems\nnodes:\n  web: { kind: client }\nedges:\n  - web -> nowhere: Calls')}\n${fence(SHOP)}`, { strict: false });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/page\.md:6:\d+: .*nowhere/);
    expect(html).toContain('<figure class="carto carto-problem" role="alert"');
    expect(count(html, '<figure class="carto">')).toBe(1);
  });

  it('lets nothing from a hostile diagram become markup or a script link', () => {
    for (const options of [{}, { interactive: true, description: true, vue: true }] as MarkdownItCartographyOptions[]) {
      const { html } = markdownIt('![x](./hostile.yaml)\n', options);
      const s = surface(html);
      expect([...s.tags].filter((t) => !ALLOWED.includes(t))).toEqual([]);
      expect(s.handlers).toEqual([]);
      expect(s.unread).toBe(0);
      expect(s.hrefs.filter((h) => !h.startsWith('#') && !/^(https:\/\/example\.com\/ok|mailto:someone@example\.com)$/.test(h))).toEqual([]);
      expect(html).toContain('&lt;script&gt;window.pwned=1&lt;/script&gt;');
      expect(html).not.toMatch(/<script|<img/i);
    }
  });
});

describe('cleaning an SVG', () => {
  it('drops what the renderer never draws and keeps the rest', () => {
    const svg = parseSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="x()"><style>@import url(x)</style><script>alert(1)</script><foreignObject><div>x</div></foreignObject>' +
        '<a href="javascript:alert(1)"><text x="1" onclick="x()">a &lt;b&gt; &amp; c</text></a><use href="https://example.com/x.svg#a"/><use href="#a"/><image href="data:text/html,x"/><rect style="fill:url(javascript:x)"/></svg>',
    );
    const html = toHtml(svg);
    expect(html).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><a><text x="1">a &lt;b&gt; &amp; c</text></a><use></use><use href="#a"></use><image></image><rect></rect></svg>',
    );
  });
  it('refuses markup it cannot read rather than passing it on', () => {
    expect(() => parseSvg('<svg><g></svg>')).toThrow();
    expect(() => parseSvg('<svg><text>a</text></svg><script>x</script>')).toThrow();
    expect(() => parseSvg('<svg><rect width=10/></svg>')).toThrow();
    expect(() => parseSvg('<div></div>')).toThrow();
  });
});

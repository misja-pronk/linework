// A small element tree that both plugins write from: HTML text for markdown-it, hast for remark.
// The SVG the engine draws is read into it and cleaned on the way: only the elements and attributes
// the renderer draws with stay, so nothing from a diagram's YAML can become markup in the page.
import { escapeHtml, safeAttribute, SVG_ELEMENTS } from '@cartography/embed/shared';

export interface El {
  tag: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

export const el = (tag: string, attrs: Record<string, string | undefined> = {}, ...children: (El | string | undefined | false)[]): El => ({
  tag,
  attrs: Object.fromEntries(Object.entries(attrs).filter((e): e is [string, string] => e[1] != null)),
  children: children.filter((c): c is El | string => c !== undefined && c !== false),
});

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

const TOKEN = /<!--[^]*?-->|<\?[^]*?\?>|<!\[CDATA\[([^]*?)\]\]>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Reads an SVG as the engine writes it (plain XML: elements, quoted attributes, text) and keeps what
 * is safe. Throws on anything it cannot read, so a drawing is never half put into a page.
 */
export function parseSvg(markup: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [] };
  // `kept` is false below an element that is dropped: its whole subtree goes with it.
  const stack: { node: El; kept: boolean }[] = [{ node: root, kept: true }];
  let at = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(markup); m; m = TOKEN.exec(markup)) {
    if (m.index !== at) break;
    at = TOKEN.lastIndex;
    const top = stack.at(-1)!;
    const [, cdata, close, open, attrText, selfClosing, text] = m;
    if (close !== undefined) {
      if (stack.length < 2 || top.node.tag !== close) throw new Error('The drawing could not be read');
      stack.pop();
    } else if (open !== undefined) {
      if (stack.length === 1 && root.children.length) throw new Error('The drawing could not be read');
      const kept = top.kept && SVG_ELEMENTS.has(open) && open !== 'style';
      const node: El = { tag: open, attrs: {}, children: [] };
      for (const a of (attrText ?? '').matchAll(ATTR)) {
        const value = decode(a[2] ?? a[3] ?? '');
        if (safeAttribute(open, a[1]!, value)) node.attrs[a[1]!] = value;
      }
      if (kept) top.node.children.push(node);
      if (!selfClosing) stack.push({ node, kept });
    } else if (top.kept && stack.length > 1) {
      const value = cdata ?? (text !== undefined ? decode(text) : undefined);
      if (value) top.node.children.push(value);
    }
  }
  const svg = root.children.find((c): c is El => typeof c !== 'string');
  if (at !== markup.length || stack.length !== 1 || svg?.tag !== 'svg') throw new Error('The drawing could not be read');
  return svg;
}

export function walk(node: El, visit: (child: El, parent: El, index: number) => void) {
  node.children.forEach((c, i) => {
    if (typeof c === 'string') return;
    visit(c, node, i);
    // The visit may have put a link around the element; its own children are still to be seen.
    walk(c, visit);
  });
}

const VOID = new Set(['img', 'source', 'br', 'hr']);
// What sits inside these is not HTML text: it is written as it is (our own CSS only).
const RAW = new Set(['style']);

export function toHtml(node: El | string): string {
  if (typeof node === 'string') return escapeHtml(node);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => (v === '' ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
    .join('');
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
  const inner = RAW.has(node.tag)
    ? node.children
        .filter((c) => typeof c === 'string')
        .join('')
        .replace(/<\/?style/gi, '')
    : node.children.map(toHtml).join('');
  return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
}

export interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, string>;
  children: (HastElement | { type: 'text'; value: string })[];
}

/** The same tree as hast, for remark-rehype and MDX. Attributes keep their names; both look them up either way. */
export function toHast(node: El): HastElement {
  return {
    type: 'element',
    tagName: node.tag,
    properties: { ...node.attrs },
    children: node.children.map((c) => (typeof c === 'string' ? { type: 'text' as const, value: c } : toHast(c))),
  };
}

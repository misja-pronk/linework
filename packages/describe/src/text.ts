// A description as data, and the ways it is written out: plain text (a screen reader, a handout,
// alt text), Markdown (a wiki, a README) and HTML (a page, the clipboard). The words are made once
// in describe.ts; these only decide how lists and headings look.

export interface Description {
  /** What the diagram is called: its title, else its file or type. */
  title: string;
  /** One or two sentences: what kind of drawing, what it is about, how big. What alt text holds. */
  summary: string;
  sections: Section[];
}

export interface Section {
  heading: string;
  /** A sentence or two before the list. */
  text?: string;
  items?: Item[];
  /** A numbered list: steps, a walkthrough. */
  ordered?: boolean;
}

export interface Item {
  text: string;
  /** What it holds: the elements of a group, a frame's messages, someone's reports. */
  items?: Item[];
}

export interface WriteOptions {
  /** Leave the title out (the page around it has its own heading). */
  title?: boolean;
  /** Markdown and HTML: the level of the title; sections are one below. Default 1. */
  level?: number;
}

/** Plain text: the title, the summary, then each section as a heading with an indented list. */
export function toText(d: Description, o: WriteOptions = {}): string {
  const out: string[] = [];
  if (o.title !== false) out.push(d.title, '');
  out.push(d.summary);
  for (const s of d.sections) {
    out.push('', s.heading);
    if (s.text) out.push(s.text);
    const list = (items: Item[], depth: number, ordered: boolean) =>
      items.forEach((it, i) => {
        out.push(`${'  '.repeat(depth)}${ordered ? `${i + 1}.` : '-'} ${it.text}`);
        if (it.items) list(it.items, depth + 1, false);
      });
    if (s.items) list(s.items, 0, !!s.ordered);
  }
  return out.join('\n') + '\n';
}

/** What Markdown would read as markup at the start of a line or anywhere: escaped, so a label stays a label. */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/([\\`*_[\]<>|])/g, '\\$1')
    .replace(/^(\s*)([#+-])(?=\s)/, '$1\\$2')
    .replace(/^(\s*\d+)([.)])(?=\s)/, '$1\\$2');
}

export function toMarkdown(d: Description, o: WriteOptions = {}): string {
  const level = Math.max(1, Math.min(5, o.level ?? 1));
  const h = (n: number) => '#'.repeat(Math.min(6, n));
  const out: string[] = [];
  if (o.title !== false) out.push(`${h(level)} ${escapeMarkdown(d.title)}`, '');
  out.push(escapeMarkdown(d.summary));
  for (const s of d.sections) {
    out.push('', `${h(level + 1)} ${escapeMarkdown(s.heading)}`, '');
    if (s.text) out.push(escapeMarkdown(s.text), '');
    // A list under an item is indented by the width of its marker: "- " or "1. ".
    const list = (items: Item[], indent: string, ordered: boolean) =>
      items.forEach((it, i) => {
        const mark = ordered ? `${i + 1}.` : '-';
        out.push(`${indent}${mark} ${escapeMarkdown(it.text)}`);
        if (it.items) list(it.items, indent + ' '.repeat(mark.length + 1), false);
      });
    if (s.items) list(s.items, '', !!s.ordered);
    if (!s.items?.length && s.text) out.pop();
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Semantic HTML: headings and lists, nothing else, so it pastes into any editor as structure. */
export function toHtml(d: Description, o: WriteOptions = {}): string {
  const level = Math.max(1, Math.min(5, o.level ?? 1));
  const out: string[] = [];
  if (o.title !== false) out.push(`<h${level}>${escapeHtml(d.title)}</h${level}>`);
  out.push(`<p>${escapeHtml(d.summary)}</p>`);
  const list = (items: Item[], ordered: boolean): string =>
    `<${ordered ? 'ol' : 'ul'}>${items.map((it) => `<li>${escapeHtml(it.text)}${it.items?.length ? list(it.items, false) : ''}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`;
  const hs = Math.min(6, level + 1);
  for (const s of d.sections) {
    out.push(`<h${hs}>${escapeHtml(s.heading)}</h${hs}>`);
    if (s.text) out.push(`<p>${escapeHtml(s.text)}</p>`);
    if (s.items?.length) out.push(list(s.items, !!s.ordered));
  }
  return out.join('\n');
}

/**
 * Alt text: the summary, and as much of the rest as fits in `max` characters, whole sentences only.
 * An alt attribute is read in one breath; the full description belongs next to the picture.
 */
export function altText(d: Description, max = 300): string {
  let out = d.summary.startsWith(d.title) ? d.summary : `${d.title}. ${d.summary}`;
  for (const s of d.sections) {
    const flat = (items: Item[]): string[] => items.flatMap((it) => [it.text, ...(it.items ? flat(it.items) : [])]);
    for (const line of [s.text, ...flat(s.items ?? [])]) {
      if (!line) continue;
      const next = `${out} ${/[.!?]$/.test(line) ? line : `${line}.`}`;
      if (next.length > max) return out;
      out = next;
    }
  }
  return out;
}

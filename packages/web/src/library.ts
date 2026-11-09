// Starting points: each type's template plus every example from the repo, bundled at build time.
import { types } from '@cartography/engine';

const raw = import.meta.glob('../../../examples/**/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface Starter {
  id: string;
  /** Diagram type id. */
  type: string;
  title: string;
  kind: 'template' | 'example';
  file: string;
  text: string;
}

const titleOf = (text: string) => /^title:\s*(.+)$/m.exec(text)?.[1]?.trim();
const typeOf = (text: string) => /^type:\s*([\w-]+)/m.exec(text)?.[1] ?? '';

const templates = types.map((t): Starter => ({ id: `template:${t.id}`, type: t.id, title: t.name, kind: 'template', file: `${t.id}.yaml`, text: t.template }));
/** Examples that are their type's template word for word would show the same card twice. */
const same = new Set(templates.map((t) => t.text.trim()));

export const starters: Starter[] = [
  ...templates,
  ...Object.entries(raw)
    .filter(([p, text]) => !p.includes('/contracts/') && !same.has(text.trim()))
    .map(([p, text]): Starter => {
      const rel = p.replace(/^.*\/examples\//, '');
      return { id: `example:${rel}`, type: typeOf(text), title: titleOf(text) ?? rel, kind: 'example', file: rel.split('/').pop()!, text };
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title)),
];

/** Files next to the bundled examples (data contracts), keyed by path under examples/. */
const files = new Map(Object.entries(raw).map(([p, text]) => [p.replace(/^.*\/examples\//, ''), text]));

/** A loader for an example: reads files relative to it from the bundle. */
export function exampleLoader(starterId: string): ((file: string) => string) | undefined {
  if (!starterId.startsWith('example:')) return undefined;
  const dir = starterId.slice('example:'.length).split('/').slice(0, -1);
  return (file) => {
    const parts = [...dir];
    for (const seg of file.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    const text = files.get(parts.join('/'));
    if (text == null) throw new Error(`No file ${file}`);
    return text;
  };
}

/** A clean start of a type, to build from the palette. */
export const blankText = (type: string) => `type: ${type}\ntitle: Untitled\n`;

export const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id;

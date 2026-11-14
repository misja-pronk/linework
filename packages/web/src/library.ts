// Starting points: each type's template plus every example from the repo, bundled at build time.
import { types } from '@linework/engine';
import { sourcedLoader, type Loader } from './render-client.ts';

const raw = import.meta.glob('../../../examples/**/*.yaml', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface Starter {
  id: string;
  /** Diagram type id. */
  type: string;
  title: string;
  /** What the diagram's subtitle says: tells two of the same title apart. */
  subtitle?: string;
  kind: 'template' | 'example';
  file: string;
  text: string;
}

const titleOf = (text: string) => /^title:\s*(.+)$/m.exec(text)?.[1]?.trim();
const subtitleOf = (text: string) => /^subtitle:\s*(.+)$/m.exec(text)?.[1]?.trim();
const typeOf = (text: string) => /^type:\s*([\w-]+)/m.exec(text)?.[1] ?? '';

const templates = types.map((t): Starter => ({ id: `template:${t.id}`, type: t.id, title: t.name, kind: 'template', file: `${t.id}.yaml`, text: t.template }));
/** The drawing a text makes, roughly: without comments, blank lines and presenting steps. */
const drawingOf = (text: string) =>
  text
    .replace(/^steps:[\s\S]*?(?=^\S|(?![\s\S]))/m, '')
    .split('\n')
    .filter((l) => l.trim() && !/^\s*#/.test(l))
    .join('\n')
    .trim();
/** Examples that draw what their type's template draws (perhaps told in steps) would show the same card twice. */
const same = new Set(templates.map((t) => drawingOf(t.text)));

export const starters: Starter[] = [
  ...templates,
  ...Object.entries(raw)
    // Data contracts and data products (ODCS, ODPS) lie next to the examples that draw them: read, not opened.
    .filter(([p, text]) => !p.includes('/contracts/') && typeOf(text) && !same.has(drawingOf(text)))
    .map(([p, text]): Starter => {
      const rel = p.replace(/^.*\/examples\//, '');
      return { id: `example:${rel}`, type: typeOf(text), title: titleOf(text) ?? rel, subtitle: subtitleOf(text), kind: 'example', file: rel.split('/').pop()!, text };
    })
    .sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title)),
];

/** Files next to the bundled examples (data contracts), keyed by path under examples/. */
const files = new Map(Object.entries(raw).map(([p, text]) => [p.replace(/^.*\/examples\//, ''), text]));

/** A loader for an example: reads files relative to it from the bundle. */
export function exampleLoader(starterId: string): Loader | undefined {
  if (!starterId.startsWith('example:')) return undefined;
  return sourcedLoader(starterId.slice('example:'.length).split('/').slice(0, -1), (path) => files.get(path), () => files, 'No file {file}');
}

/** A clean start of a type, to build from the palette. */
export const blankText = (type: string) => `type: ${type}\ntitle: Untitled\n`;

// A shared model (type: model) is drawn as architecture but named for what it is.
export const typeName = (id: string) => (id === 'model' ? 'Model' : (types.find((t) => t.id === id)?.name ?? id));

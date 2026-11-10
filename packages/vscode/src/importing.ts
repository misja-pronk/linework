// A file from another tool as Cartography YAML, the way `carto import` reads it: Mermaid (or the
// ```mermaid blocks of a Markdown file), a Structurizr workspace, draw.io pages, an Excalidraw scene.
import type { LayoutSidecar } from '@cartography/core';
import { importMarkdown, importMermaid, importStructurizr } from '@cartography/import';
import { importDrawio, importExcalidraw, isDrawio, isExcalidraw } from '@cartography/interop';

export interface ImportResult {
  /** File name for the result, next to the source: base.yaml, or base-2.yaml / base-<page>.yaml for several. */
  name: string;
  yaml: string;
  sidecar?: LayoutSidecar;
  /** What was dropped or guessed, one line each. */
  notes: string[];
}

/** The file dialog's filters: what can be imported. */
export const IMPORT_FILTERS: Record<string, string[]> = {
  'Diagrams from other tools': ['mmd', 'mermaid', 'md', 'markdown', 'dsl', 'drawio', 'dio', 'xml', 'excalidraw', 'json'],
  Mermaid: ['mmd', 'mermaid'],
  'Markdown with ```mermaid blocks': ['md', 'markdown'],
  'Structurizr DSL': ['dsl'],
  'draw.io': ['drawio', 'dio', 'xml'],
  Excalidraw: ['excalidraw', 'json'],
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Everything in the file that can become a diagram; an empty list when nothing could. */
export function importText(fileName: string, text: string, opts: { keepPositions?: boolean } = {}): ImportResult[] {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.(drawio\.xml|excalidraw\.json|mmd|mermaid|md|markdown|dsl|drawio|dio|xml|excalidraw|json)$/i, '');
  if (/\.(drawio|dio|excalidraw)$/i.test(fileName) || (/\.xml$/i.test(fileName) && isDrawio(text)) || (/\.json$/i.test(fileName) && isExcalidraw(text))) {
    const pages = isExcalidraw(text) ? [importExcalidraw(text, { keepPositions: opts.keepPositions, title: base })] : importDrawio(text, { keepPositions: opts.keepPositions, title: base });
    const taken = new Set<string>();
    return pages.map((p, i) => {
      let name = base;
      if (pages.length > 1) {
        const page = slug(p.name ?? '') || String(i + 1);
        name = `${base}-${page}`;
        for (let k = 2; taken.has(name); k++) name = `${base}-${page}-${k}`;
        taken.add(name);
      }
      return { name: `${name}.yaml`, yaml: p.yaml, ...(p.sidecar ? { sidecar: p.sidecar } : {}), notes: p.report };
    });
  }
  if (/\.json$/i.test(fileName) || /\.xml$/i.test(fileName)) return [{ name: `${base}.yaml`, yaml: '', notes: ['This is neither a draw.io nor an Excalidraw file'] }];
  if (/\.dsl$/i.test(fileName)) {
    const r = importStructurizr(text, base);
    return [{ name: `${base}.yaml`, yaml: r.yaml, notes: r.yaml ? r.warnings : ['No workspace model found', ...r.warnings] }];
  }
  if (/\.(md|markdown)$/i.test(fileName)) {
    const blocks = importMarkdown(text);
    if (!blocks.length) return [{ name: `${base}.yaml`, yaml: '', notes: ['No ```mermaid blocks found'] }];
    return blocks.map((b, i) => ({ name: blocks.length > 1 ? `${base}-${i + 1}.yaml` : `${base}.yaml`, yaml: b.yaml, notes: b.warnings.map((w) => `line ${b.line}: ${w}`) }));
  }
  const r = importMermaid(text, base);
  return [{ name: `${base}.yaml`, yaml: r.yaml, notes: r.warnings }];
}

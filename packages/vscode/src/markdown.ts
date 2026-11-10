// ```cartography blocks in VS Code's own Markdown preview: the docs plugin for markdown-it, told where
// the page is (so includes resolve next to it) and how VS Code says the preview is dark.
import os from 'node:os';
import markdownItCartography from '@cartography/docs-plugins/markdown-it';

// Loose on purpose, as in the plugin: the preview's markdown-it is whatever version VS Code ships.
interface MarkdownIt {
  core: { ruler: { push(name: string, rule: (state: any) => void): void } };
}

export interface MarkdownOptions {
  enabled: () => boolean;
  /** Diagrams in a page may read files below this folder (the workspace). */
  root?: string;
}

export function extendMarkdownIt(md: MarkdownIt, opts: MarkdownOptions): MarkdownIt {
  // VS Code puts the page in env.currentDocument (a Uri); the plugin reads env.path. This rule runs first.
  md.core.ruler.push('cartography-page', (state: { env?: Record<string, unknown> }) => {
    const env = (state.env ??= {});
    const doc = env.currentDocument as { fsPath?: string; scheme?: string } | undefined;
    if (!env.path && doc?.scheme === 'file' && doc.fsPath) env.path = doc.fsPath;
  });
  const plugin = markdownItCartography as unknown as (md: MarkdownIt, options?: unknown) => void;
  // The plugin's rule only runs while the setting is on; turning it off needs no reload.
  const ruler = md.core.ruler;
  const gated: MarkdownIt = {
    ...md,
    core: { ruler: { push: (name, rule) => ruler.push(name, (state) => (opts.enabled() ? rule(state) : undefined)) } },
  };
  // A diagram with errors shows its message in the page instead of breaking the preview.
  plugin(gated, { strict: false, dark: '.vscode-dark, .vscode-high-contrast:not(.vscode-high-contrast-light)', root: opts.root ?? os.homedir(), warn: () => {} });
  return md;
}

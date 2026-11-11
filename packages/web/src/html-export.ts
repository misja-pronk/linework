// Export → Interactive HTML: the diagram (and what it drills into in the open folder), or the whole
// folder, as one page to send. Drawn here in the browser, the same as `carto export-html` writes.
import type { LayoutSidecar } from '@cartography/core';
import { brand } from './brand.ts';
import { iconOptions } from './icon-packs.ts';
import { diagrams, type Workspace } from './files.ts';
import { t } from './i18n/index.ts';

export interface PageInput {
  /** The diagram open in the editor: its path in the folder, or its name. */
  file: string;
  text: string;
  ws?: Workspace;
  /** Reads what the diagram includes when it is not in a folder (a starter, an import). */
  load?: (rel: string) => string;
  pins?: LayoutSidecar;
  /** The whole folder, with a contents page. */
  folder?: boolean;
}

export async function exportPage(input: PageInput): Promise<string> {
  const { exportHtml } = await import('@cartography/html-export');
  const { ws, file } = input;
  const inFolder = (p: string) => ws?.files.get(p)?.text;
  const json = <T>(p: string): T | undefined => {
    const t = inFolder(p);
    try {
      return t ? (JSON.parse(t) as T) : undefined;
    } catch {
      return undefined;
    }
  };
  const r = await exportHtml({
    entries: input.folder && ws ? diagrams(ws) : [file],
    nearby: ws ? diagrams(ws) : [],
    site: input.folder || undefined,
    read: (p) => {
      if (p === file) return input.text;
      if (ws) return inFolder(p);
      try {
        return input.load?.(p);
      } catch {
        return undefined;
      }
    },
    sidecarFor: (p) => (p === file ? input.pins : json<LayoutSidecar>(p.replace(/\.ya?ml$/i, '') + '.layout.json')),
    render: { themeOverride: brand().theme, ...iconOptions() },
  });
  if (!r.stats.drawings) throw new Error(r.problems[0]?.message ?? t('nothing to draw'));
  return r.html;
}

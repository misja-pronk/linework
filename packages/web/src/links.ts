// Where an element's link leads in the editor: a URL (new tab), another diagram next to this one (and
// maybe one of its views), or another view of this diagram. Drill-down from a context to its containers.
import { joinPath, type Link } from '@cartography/core';
import { t } from './i18n/index.ts';

export type LinkTarget = { kind: 'url'; url: string } | { kind: 'view'; view: string } | { kind: 'doc'; path: string; view?: string } | { kind: 'none'; why: string };

/** `here` is the open diagram's path in its folder (or under examples/); without it only URLs and "#view" work. */
export function linkTarget(link: Link, here?: string): LinkTarget {
  if (link.kind === 'url') return /^(https?|mailto):/i.test(link.target) ? { kind: 'url', url: link.target } : { kind: 'none', why: t('Cannot open {target} from here', { target: link.target }) };
  const dir = here ? here.split('/').slice(0, -1).join('/') : '';
  const path = link.file ? joinPath(dir, link.file) : here;
  if (!link.file || path === here) return link.view ? { kind: 'view', view: link.view } : { kind: 'none', why: t('That link points at this diagram') };
  if (!here) return { kind: 'none', why: t('Open the folder to follow links to {file}', { file: link.file }) };
  if (!/\.ya?ml$/i.test(path!)) return { kind: 'none', why: t('{path} is not a diagram: open it from your editor', { path: path! }) };
  return { kind: 'doc', path: path!, ...(link.view ? { view: link.view } : {}) };
}

export const linkText = (l: Link) => l.label ?? (l.kind === 'url' ? l.target.replace(/^https?:\/\//, '') : l.target);
export const linkIcon = (l: Link) => (l.kind === 'url' ? 'globe' : l.kind === 'view' ? 'layers' : 'file-code');

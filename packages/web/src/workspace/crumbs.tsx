// Where the drawing sits in the model: workspace › system › container. Each step up opens the view
// about that level (⌘↑ does the same); back and forward are the arrows in front (⌘[ and ⌘]).
import { trail, viewAbout, type WorkspaceIndex } from '@cartography/core';
import { Icon } from '../icon.tsx';
import type { Place } from './use-workspace.ts';
import { t } from '../i18n/index.ts';

export interface Crumb {
  label: string;
  title?: string;
  to?: Place;
}

/** The crumbs for a drawing: the folder, then each element above the one the view is about. */
export function crumbsOf(index: WorkspaceIndex, scope: string, here: Place, viewTitle?: string): Crumb[] {
  const top = viewAbout(index, undefined, here.file);
  const out: Crumb[] = [{ label: scope, title: top ? t('The landscape ({place})', { place: `${top.file.replace(/\.ya?ml$/i, '')} › ${top.view}` }) : scope, to: top && !(top.file === here.file && top.view === here.view) ? top : undefined }];
  const ids = trail(index, here.file, here.view);
  if (!ids.length) return [...out, { label: here.view ? `${here.file.replace(/\.ya?ml$/i, '')} › ${viewTitle ?? here.view}` : here.file }];
  for (const [i, id] of ids.entries()) {
    const label = index.elements.get(id)?.[0]?.label ?? id;
    const last = i === ids.length - 1;
    const to = last ? undefined : viewAbout(index, id, here.file);
    out.push({ label, title: id, to: to && { ...to, node: ids[i + 1] } });
  }
  return out;
}

/** The view one level up from here, for ⌘↑. */
export function upFrom(index: WorkspaceIndex, scope: string, here: Place): Place | undefined {
  const crumbs = crumbsOf(index, scope, here);
  return [...crumbs].reverse().find((c) => c.to)?.to;
}

export function Crumbs({ crumbs, back, forward, onGo }: { crumbs: Crumb[]; back?: () => void; forward?: () => void; onGo(p: Place): void }) {
  return (
    // A row of its own, so the tools and the focus chip keep theirs below it.
    <div className="crumbs-row">
    <nav className="crumbs" aria-label={t('Where this drawing is')} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <button className="tool" onClick={back} disabled={!back} title={t('Back (⌘[)')} aria-label={t('Back')}>
        <Icon name="arrow-left" />
      </button>
      <button className="tool" onClick={forward} disabled={!forward} title={t('Forward (⌘])')} aria-label={t('Forward')}>
        <Icon name="arrow-right" />
      </button>
      <ol>
        {crumbs.map((c, i) => (
          <li key={i}>
            {c.to ? (
              <button className="crumb" onClick={() => onGo(c.to!)} title={c.title}>
                {i === 0 && <Icon name="folder-open" size={13} />}
                {c.label}
              </button>
            ) : (
              <span className="crumb here" title={c.title} aria-current={i === crumbs.length - 1 ? 'location' : undefined}>
                {i === 0 && <Icon name="folder-open" size={13} />}
                {c.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
    </div>
  );
}

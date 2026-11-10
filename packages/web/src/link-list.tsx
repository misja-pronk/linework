// An element's links in the inspector: follow one (⌘-click on the drawing follows the first).
import type { Link } from '@cartography/core';
import { Icon } from './icon.tsx';
import { t } from './i18n/index.ts';
import { linkIcon, linkText } from './links.ts';

export function LinkList({ links, onFollow }: { links?: Link[]; onFollow(link: Link): void }) {
  if (!links?.length) return null;
  return (
    <div className="field">
      <span>{t('Links')}</span>
      <ul className="connections links">
        {links.map((l, i) => (
          <li key={i}>
            <button type="button" className="connection" onClick={() => onFollow(l)} title={l.kind === 'url' ? t('Open {target} in a new tab', { target: l.target }) : t('Open {target}', { target: l.target })}>
              <Icon name={linkIcon(l)} size={14} />
              <span>{linkText(l)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

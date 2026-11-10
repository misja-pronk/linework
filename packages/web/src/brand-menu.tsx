// Theme picker and icon folder, in one small top-bar menu. Choices apply to the canvas and every export.
import { Fragment, useState } from 'react';
import { themeCatalog } from '@cartography/theme';
import { Icon } from './icon.tsx';
import { Menu } from './menu.tsx';
import { canUseFolders, type Workspace } from './files.ts';
import { chooseBuiltin, chooseFile, forgetIcons, pickIconFolder, reconnectIcons, themeFiles, useBrand } from './brand.ts';

/** The built-in looks by name, as a person reads them: "survey-dark" is "Survey dark". */
const BUILTIN = themeCatalog.map((t) => [t.name, t.name[0]!.toUpperCase() + t.name.slice(1).replace(/-/g, ' '), t.description] as const);
/** A rule before each new family (Survey, Transit, Drafting, Sketch, Classic, then the colourways). */
const family = (name: string) => name.split('-')[0]!;

export function BrandMenu({ ws, onError }: { ws?: Workspace; onError?(message: string): void }) {
  const [open, setOpen] = useState(false);
  const b = useBrand();
  const files = themeFiles(ws);
  const run = (f: () => unknown) => () => {
    setOpen(false);
    Promise.resolve(f()).catch((e: unknown) => onError?.(e instanceof Error ? e.message : String(e)));
  };
  const label = BUILTIN.find(([k]) => k === b.choice)?.[1] ?? (b.choice ? (b.choice.split('/').pop()!.replace(/\.theme\.(ya?ml|json)$/i, '') || b.choice) : 'Theme');
  const mark = (on: boolean) => <span aria-hidden="true" style={{ display: 'inline-block', width: 14 }}>{on ? '✓' : ''}</span>;
  return (
    <div className="menu-anchor">
      <button
        className="button ghost"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={b.warnings.length ? b.warnings.map((w) => w.message).join('\n') : 'Diagram theme and icons'}
        data-brand={b.choice || 'diagram'}
      >
        <Icon name="layout-template" /> {label}
        {b.warnings.length ? <Icon name="circle-exclamation-point" size={14} /> : null}
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <Menu onClose={() => setOpen(false)}>
          <button role="menuitem" onClick={run(() => chooseBuiltin(''))}>
            {mark(!b.choice)} The diagram's own
          </button>
          <hr />
          {BUILTIN.map(([k, name, description], i) => (
            <Fragment key={k}>
              {i > 0 && family(k) !== family(BUILTIN[i - 1]![0]) && ['transit', 'drafting', 'sketch', 'classic', 'slate'].includes(k) && <hr />}
              <button role="menuitem" onClick={run(() => chooseBuiltin(k))} title={description} data-theme-name={k}>
                {mark(b.choice === k)} {name}
                {k === 'survey' ? <span className="menu-note"> default</span> : null}
              </button>
            </Fragment>
          ))}
          {files.length > 0 && <hr />}
          {files.map((f) => (
            <button key={f} role="menuitem" onClick={run(() => chooseFile(ws!, f))} title={f}>
              {mark(b.choice === f)} {f}
            </button>
          ))}
          {canUseFolders && (
            <>
              <hr />
              {b.iconsToReconnect ? (
                <button role="menuitem" onClick={run(reconnectIcons)}>
                  <Icon name="folder-open" /> Reconnect icons: {b.iconFolder}
                </button>
              ) : (
                <button role="menuitem" onClick={run(pickIconFolder)}>
                  <Icon name="folder-open" /> {b.iconFolder ? `Icons: ${b.iconFolder} (${Object.keys(b.icons ?? {}).length})` : 'Icon folder…'}
                </button>
              )}
              {b.iconFolder && (
                <button role="menuitem" onClick={run(forgetIcons)}>
                  <Icon name="x" /> Stop using icon folder
                </button>
              )}
            </>
          )}
        </Menu>
      )}
    </div>
  );
}

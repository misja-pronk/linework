// Theme picker, icons and the editor's language, in one menu opened from the top bar's ⋯. Choices apply to the canvas and every export.
import { Fragment, useState } from 'react';
import { themeCatalog } from '@linework/theme';
import { Icon } from './icon.tsx';
import { Menu } from './menu.tsx';
import { type Workspace } from './files.ts';
import { chooseBuiltin, chooseFile, themeFiles, useBrand } from './brand.ts';
import { setIconMode, useIconPacks, type IconPacks } from './icon-packs.ts';
import { IconPacksDialog } from './icon-packs-dialog.tsx';
import { LANG_NAMES, LANGS } from '@linework/i18n';
import { say, setUiLang, t, uiLangChoice, useUiLang } from './i18n/index.ts';
import { setSessionLight, useSessionLight } from './app/session.ts';

/** The built-in looks by name, as a person reads them: "survey-dark" is "Survey dark". */
const BUILTIN = themeCatalog.map((t) => [t.name, t.name[0]!.toUpperCase() + t.name.slice(1).replace(/-/g, ' '), t.description] as const);
/** A rule before each new family (Survey, Transit, Drafting, Sketch, Classic, then the colourways). */
const family = (name: string) => name.split('-')[0]!;

const ICON_MODES: [IconPacks['mode'], string, string][] = [
  ['', 'Icons as the diagram says', 'icons: official or lucide in the diagram; line icons when it says nothing'],
  ['official', 'Official icons', "The vendors' own icons (Azure, AWS, Google Cloud, Kubernetes) where a set is imported"],
  ['lucide', 'Line icons', 'Our line icons everywhere, whatever the diagram says'],
];

interface Props {
  ws?: Workspace;
  onError?(message: string): void;
  onNotice?(message: string): void;
  /** Opened from the top bar's ⋯ (BrandMenuItem): no button of its own, the menu in that one's anchor. */
  open: boolean;
  setOpen(open: boolean): void;
}

/** The look chosen, as the menu names it: "Ocean", a theme file's name, or "Theme" for the diagram's own. */
function brandLabel(choice: string | undefined): string {
  return BUILTIN.find(([k]) => k === choice)?.[1] ?? (choice ? (choice.split('/').pop()!.replace(/\.theme\.(ya?ml|json)$/i, '') || choice) : t('Theme'));
}

/** The item that opens this menu from another (the top bar's ⋯), with the look chosen beside it. */
export function BrandMenuItem({ onOpen }: { onOpen(): void }) {
  useUiLang();
  const b = useBrand();
  return (
    <button role="menuitem" onClick={onOpen} data-brand={b.choice || 'diagram'} title={b.warnings.length ? b.warnings.map((w) => w.message).join('\n') : t('Diagram theme and icons')}>
      <Icon name="layout-template" /> {t('Diagram theme, icons, language…')}
      {b.warnings.length ? <Icon name="circle-exclamation-point" size={14} /> : null}
      {b.choice ? <span className="menu-note brand-now">{brandLabel(b.choice)}</span> : null}
    </button>
  );
}

export function BrandMenu({ ws, onError, onNotice, open, setOpen }: Props) {
  useUiLang();
  const [packs, setPacks] = useState(false);
  const b = useBrand();
  const ip = useIconPacks();
  const sessionLight = useSessionLight();
  const imported = Object.keys(ip.packs).length;
  const files = themeFiles(ws);
  const run = (f: () => unknown) => () => {
    setOpen(false);
    Promise.resolve(f()).catch((e: unknown) => onError?.(e instanceof Error ? e.message : String(e)));
  };
  const mark = (on: boolean) => <span aria-hidden="true" style={{ display: 'inline-block', width: 14 }}>{on ? '✓' : ''}</span>;
  return (
    <>
      {open && (
        <Menu onClose={() => setOpen(false)}>
          <button role="menuitem" onClick={run(() => chooseBuiltin(''))}>
            {mark(!b.choice)} {t("The diagram's own")}
          </button>
          <hr />
          {BUILTIN.map(([k, name, description], i) => (
            <Fragment key={k}>
              {i > 0 && family(k) !== family(BUILTIN[i - 1]![0]) && ['transit', 'drafting', 'sketch', 'classic', 'slate'].includes(k) && <hr />}
              <button role="menuitem" onClick={run(() => chooseBuiltin(k))} title={description} data-theme-name={k}>
                {mark(b.choice === k)} {name}
                {k === 'survey' ? <span className="menu-note"> {t('default')}</span> : null}
              </button>
            </Fragment>
          ))}
          {files.length > 0 && <hr />}
          {files.map((f) => (
            <button key={f} role="menuitem" onClick={run(() => chooseFile(ws!, f))} title={f}>
              {mark(b.choice === f)} {f}
            </button>
          ))}
          <hr />
          {ICON_MODES.map(([mode, name, title]) => (
            <button key={mode || 'diagram'} role="menuitem" onClick={run(() => setIconMode(mode))} title={say(title)} data-icon-mode={mode || 'diagram'}>
              {mark(ip.mode === mode)} {say(name)}
            </button>
          ))}
          <button role="menuitem" onClick={run(() => setPacks(true))} data-icon-packs>
            <Icon name="boxes" /> {t('Official icons…')}{imported ? <span className="menu-note"> {t('{count} imported', { count: imported })}</span> : null}
          </button>
          <hr />
          <button role="menuitem" onClick={run(() => setSessionLight(!sessionLight))} title={t('Light reads best through screen sharing and video compression')} data-session-light={sessionLight}>
            {mark(sessionLight)} {t('Sessions on the light theme')}
          </button>
          <hr />
          <div className="menu-heading" title={t('Language of the editor; a drawing follows its own lang:')}>Language / Taal</div>
          <button role="menuitem" onClick={run(() => setUiLang(undefined))} data-ui-lang="browser">
            {mark(!uiLangChoice())} {t('Same as the browser')}
          </button>
          {LANGS.map((l) => (
            <button key={l} role="menuitem" onClick={run(() => setUiLang(l))} data-ui-lang={l} lang={l}>
              {mark(uiLangChoice() === l)} {LANG_NAMES[l]}
            </button>
          ))}
        </Menu>
      )}
      {packs && <IconPacksDialog onClose={() => setPacks(false)} onDone={(m) => onNotice?.(m)} />}
    </>
  );
}

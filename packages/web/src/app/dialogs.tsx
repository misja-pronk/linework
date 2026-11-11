// What opens over the editor: presenting, the palette and its uses (connect to, problems), the keys,
// the start dialog, the description in words, and the drop target for files.
import type { Diagnostic } from '@cartography/core';
import type { RenderResult } from '@cartography/engine';
import { t } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { Palette, type Command } from '../palette.tsx';
import { Shortcuts } from '../shortcuts.tsx';
import { Start, type Opened } from '../start.tsx';
import { DescribeDialog } from '../describe-dialog.tsx';
import { Present, type PresentProps } from '../present.tsx';
import type { EditorHandle } from '../editor.tsx';
import type { Selection } from '../preview.tsx';
import type { Exports } from './exports.ts';
import type { Modals } from './modals.ts';
import type { Notify } from './toasts.tsx';
import { iconOf, label } from './names.ts';

interface Props {
  modals: Modals;
  /** Built only when the palette opens. */
  commands(): Command[];
  present: PresentProps | undefined;
  compareDialogs: React.ReactNode;
  confirmDialog: React.ReactNode;
  selected: Selection | undefined;
  graph: RenderResult['graph'] | undefined;
  nodeName(id: string): string;
  connect(from: string, to: string): void;
  focusDrawing(): void;
  exports: Exports;
  notify: Notify;
  theme: 'light' | 'dark';
  typeId: string | undefined;
  onStart(o: Opened): void;
  diagnostics: Diagnostic[];
  /** The drawing is of the text in the editor now: a problem's place in it is right. */
  current: boolean;
  editor: React.RefObject<EditorHandle | null>;
  dropping: boolean;
}

export function Dialogs(p: Props) {
  const { modals, selected, exports: x } = p;
  const { modal, closeModal } = modals;
  return (
    <>
      {p.present && <Present {...p.present} />}
      {modal === 'palette' && <Palette commands={p.commands()} onClose={closeModal} />}
      {p.compareDialogs}
      {p.confirmDialog}
      {modal === 'connect' && selected?.kind === 'node' && (
        <Palette
          placeholder={t('Connect {name} to…', { name: p.nodeName(selected.id) })}
          onClose={() => {
            closeModal();
            p.focusDrawing();
          }}
          commands={(p.graph?.nodes ?? [])
            .filter((n) => n.id !== selected.id)
            .map((n) => ({ id: `to:${n.id}`, group: t('Connect {name} to', { name: p.nodeName(selected.id) }), label: label(n), hint: n.id, icon: iconOf(n) ?? 'box', run: () => p.connect(selected.id, n.id) }))}
        />
      )}
      {modal === 'shortcuts' && <Shortcuts onClose={closeModal} />}
      {modals.describing && x.description() && <DescribeDialog description={x.description()!} input={x.exportInput} onClose={() => modals.setDescribing(false)} onDone={(message, tone) => p.notify(message, tone ? { tone } : {})} />}
      {modal === 'templates' && <Start theme={p.theme} current={modals.guiding ? p.typeId : undefined} onOpen={p.onStart} onClose={closeModal} />}
      {modal === 'problems' && (
        <Palette
          placeholder={p.diagnostics.length ? t('Filter problems…') : t('No problems: everything draws')}
          onClose={closeModal}
          commands={[...p.diagnostics.map((d, i) => ({
            id: `p${i}`,
            group: d.severity === 'error' ? t('Errors') : t('Warnings'),
            label: d.message,
            hint: d.line ? t('line {line}', { line: d.line }) : undefined,
            icon: 'circle-exclamation-point',
            run: () => {
              if (d.from != null && p.current) p.editor.current?.reveal(d.from, d.to ?? d.from);
              requestAnimationFrame(() => p.editor.current?.focus());
            },
          }))]}
        />
      )}
      {p.dropping && (
        <div className="drop-here" aria-hidden="true">
          <div>
            <Icon name="folder-open" size={22} />
            <strong>{t('Drop to open')}</strong>
            <span>{t('A diagram; data products and contracts (ODPS, ODCS); or a folder of az, Graph, AzureHound or gh api JSON: it becomes one diagram')}</span>
          </div>
        </div>
      )}
    </>
  );
}

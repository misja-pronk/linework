// The one panel on the right, with tabs: the selection's properties (one element, or several to
// arrange), or Your AI (proposals from the user's own agent, files changed on disk).
import './side-panel.css';
import { useMemo, useState } from 'react';
import { renamePins, type Link, type Path } from '@cartography/core';
import { t, say, type Message } from '../i18n/index.ts';
import { Icon } from '../icon.tsx';
import { keyHint } from '../keys.ts';
import { Inspector, TextInput } from '../inspector.tsx';
import { AskPanel } from '../ai/ask-panel.tsx';
import { ArrangeBar } from '../craft-actions.tsx';
import { canMove, editChainLine, edgeFields, fieldsFor, isChainLine, isEntryPath, moveEntry, setEdgeField, setField } from '../builder.ts';
import type { Live } from '../live/use-live.ts';
import type { EditorHandle } from '../editor.tsx';
import type { Selection } from '../preview.tsx';
import type { DiskChange } from './disk-sync.ts';
import type { Drawing } from './drawing.ts';
import type { Edits } from './edits.ts';
import type { Pins } from './pins.ts';
import { count, iconOf, kindLabel, label, withDrawnName } from './names.ts';

/** Which tab shows, and whether the panel is there at all. */
export function useSidePanel() {
  const [inspector, setInspector] = useState(true);
  /** The Your AI panel (⌘J): proposals from the user's own agent, and files changed on disk. */
  const [asking, setAsking] = useState(false);
  /** The panel stays mounted (what was decided kept) behind another tab until it is closed. */
  const [askKept, setAskKept] = useState(false);
  const askWith = () => {
    setAsking(true);
    setAskKept(true);
  };
  const toggleAsk = () => (asking ? setAsking(false) : askWith());
  const showSide = (tab: 'properties' | 'ask') => {
    setAsking(tab === 'ask');
    if (tab === 'ask') setAskKept(true);
    if (tab === 'properties') setInspector(true);
  };
  const closeAsk = () => {
    setAsking(false);
    setAskKept(false);
  };
  return { inspector, setInspector, asking, askKept, askWith, toggleAsk, showSide, closeAsk };
}
export type SidePanelState = ReturnType<typeof useSidePanel>;

/** What the single selection is in the drawing and in the YAML. */
export function inspected(drawing: Drawing, selected: Selection | undefined, pathOf: (s: Selection | undefined) => Path | undefined) {
  const { result, drawn } = drawing;
  const selectedPath = pathOf(selected);
  const selNode = selected?.kind === 'node' ? (result ?? drawn)?.graph?.nodes.find((n) => n.id === selected.id) : undefined;
  const selGroup = selected?.kind === 'group' ? (result ?? drawn)?.graph?.groups.find((g) => g.id === selected.id) : undefined;
  const selEdge = selected?.kind === 'edge' ? (result ?? drawn)?.graph?.edges.find((e) => e.id === selected.id) : undefined;
  const isEntry = !!selectedPath && isEntryPath(selectedPath) && selected?.kind !== 'edge';
  const isEdgeItem = !!selectedPath && selectedPath[0] === 'edges' && typeof selectedPath[1] === 'number';
  return { selectedPath, selNode, selGroup, selEdge, isEntry, isEdgeItem };
}

interface Props {
  state: SidePanelState;
  drawing: Drawing;
  text: string;
  textNow(): string;
  theme: 'light' | 'dark';
  load: ((f: string) => string) | undefined;
  selection: Selection[];
  selected: Selection | undefined;
  setSelection(s: Selection[]): void;
  select(s: Selection): void;
  pathOf(s: Selection | undefined): Path | undefined;
  hasProperties: boolean;
  edits: Edits;
  pinning: Pins;
  editor: React.RefObject<EditorHandle | null>;
  live: Live;
  diskChange: DiskChange | undefined;
  docKey: number;
  clearDiskChange(): void;
  copyForAi(): void;
  focusDrawing(): void;
  follow(link: Link): void;
  tags: React.ComponentProps<typeof Inspector>['tags'];
}

export function SidePanel(p: Props) {
  const { state, drawing, selection, selected, edits, pinning, editor } = p;
  const { type, vpins, locked, bent, result, entries } = drawing;
  const sideTab: 'properties' | 'ask' = state.asking ? 'ask' : 'properties';
  const showInspector = sideTab === 'properties' && state.inspector && p.hasProperties;
  /** Nothing selected: the panel stays and shows the drawing, so the drawing never shifts when a click selects something. */
  const showDrawing = sideTab === 'properties' && !p.hasProperties && !!type;
  const { selectedPath, selNode, selGroup, selEdge, isEntry, isEdgeItem } = inspected(drawing, selected, p.pathOf);
  /** One arrow of a chain ("a -> b -> c" in a process): its label is the one thing to set. */
  const isChain = !!type && selected?.kind === 'edge' && isChainLine(p.text, type, selected.id);
  const fields = useMemo(
    () =>
      type && selectedPath
        ? isChain
          ? [{ key: 'label', kind: 'text' as const, label: 'Label', value: selEdge?.label ?? '', hint: type.lines?.hint }]
          : isEntry
            ? withDrawnName(fieldsFor(p.text, type, selectedPath), selNode ? label(selNode) : selGroup?.label)
            : isEdgeItem
              ? edgeFields(p.text, type, selectedPath)
              : []
        : [],
    [type, isEntry, isEdgeItem, isChain, selEdge?.label, selectedPath, p.text, selNode, selGroup],
  );
  const { textNow } = p;
  const graphText = ((result ?? drawing.drawn)?.graph ?? {}) as { title?: string; subtitle?: string };
  const { nodeName } = edits;
  return (
    <div className="side" role="region" aria-label={t('Side panel')}>
      <div className="side-tabs" role="tablist" aria-label={t('Side panel')}>
        <button role="tab" aria-selected={sideTab === 'properties'} onClick={() => state.showSide('properties')} title={p.hasProperties ? t('What is selected') : t('The drawing, until something is selected')}>
          <Icon name="file-sliders" size={14} /> <span className="tab-label">{t('Properties')}</span>
        </button>
        {/* Your AI is opened from the drawing's ⋯ (or ⌘J, ⌘K); once open, its tab switches back and forth until it is closed. */}
        {state.askKept && (
          <button role="tab" aria-selected={sideTab === 'ask'} onClick={() => state.showSide('ask')} disabled={!type} title={t('Your AI ({key})', { key: keyHint('ask') })}>
            <Icon name="sparkles" size={14} /> <span className="tab-label">{t('Your AI')}</span>
          </button>
        )}
      </div>
      {state.askKept && (
        <AskPanel
          hidden={sideTab !== 'ask'}
          text={p.text}
          type={type}
          sidecar={drawing.sidecar}
          load={p.load}
          theme={p.theme}
          live={p.live}
          change={p.diskChange?.doc === p.docKey ? p.diskChange : undefined}
          onAccept={(yaml, renames) => pinning.apply(yaml, renames.size ? (renamePins(vpins, renames) ?? null) : undefined)}
          onUndoChange={() => {
            editor.current?.undo();
            p.clearDiskChange();
          }}
          onDismissChange={p.clearDiskChange}
          onCopyForAi={p.copyForAi}
          onClose={() => {
            state.closeAsk();
            p.focusDrawing();
          }}
        />
      )}
      {showInspector && selected && type && (selNode || selGroup || selEdge) && (
        <Inspector
          key={`${selected.kind}:${selected.id}`}
          selection={`${selected.kind}:${selected.id}`}
          id={isEntry ? String(selectedPath!.at(-1)) : selected.id}
          title={selNode ? label(selNode) : selGroup ? selGroup.label : selEdge ? `${nodeName(selEdge.from.node)} → ${nodeName(selEdge.to.node)}` : selected.id}
          icon={selNode ? iconOf(selNode) : selGroup ? selGroup.icon : 'arrow-right-from-line'}
          kindLabel={selEdge ? (selEdge.label ? t('Line · {label}', { label: selEdge.label }) : t('Line')) : (selNode?.kind ?? selGroup?.kind ?? say(kindLabel(selectedPath)))}
          fields={fields}
          renamable={isEntry}
          freeName={!!type.freeNames}
          pinned={selected.kind === 'node' ? !!vpins?.nodes?.[selected.id] : selected.kind === 'group' && !!vpins?.groups?.[selected.id]}
          locked={selected.kind === 'edge' ? undefined : locked.has(selected.id)}
          onLock={pinning.toggleLock}
          onResetLine={selected.kind === 'edge' && bent.has(selected.id) ? () => pinning.pinTo(pinning.withEdge(selected.id, undefined)) : undefined}
          links={(selNode ?? selGroup)?.links}
          onFollowLink={p.follow}
          tags={p.tags}
          onField={(key, value) =>
            type &&
            selectedPath &&
            pinning.apply(
              isChain
                ? editChainLine(textNow(), type, selected.id, String(value ?? ''))
                : isEdgeItem
                  ? setEdgeField(textNow(), selectedPath, key, value)
                  : setField(textNow(), type, selectedPath, key, value),
            )
          }
          onRename={edits.rename}
          onReveal={() => {
            const e = entries.find((x) => x.kind === selected.kind && x.id === selected.id);
            if (e) editor.current?.reveal(e.from, e.to);
            editor.current?.focus();
          }}
          onDuplicate={isEntry ? edits.duplicate : undefined}
          onMove={
            isEntry && type?.ordered?.[String(selectedPath![0])]
              ? {
                  earlier: canMove(p.text, type, selectedPath!, -1) ? () => pinning.apply(moveEntry(textNow(), type, selectedPath!, -1)) : undefined,
                  later: canMove(p.text, type, selectedPath!, 1) ? () => pinning.apply(moveEntry(textNow(), type, selectedPath!, 1)) : undefined,
                }
              : undefined
          }
          onDelete={() => edits.remove()}
          connections={
            selNode
              ? (result?.graph?.edges ?? [])
                  .filter((e) => e.from.node === selNode.id || e.to.node === selNode.id)
                  .map((e) => ({ id: e.id, out: e.from.node === selNode.id, other: nodeName(e.from.node === selNode.id ? e.to.node : e.from.node), label: e.label }))
              : undefined
          }
          onSelectEdge={(id) => p.select({ kind: 'edge', id })}
          onDeleteEdge={(id) => edits.remove({ kind: 'edge', id })}
          onUnpin={() => pinning.unpinOne(selected)}
          onClose={() => {
            p.setSelection([]);
            p.focusDrawing();
          }}
        />
      )}
      {showDrawing && type && (
        <aside className="inspector" aria-label={t('Drawing')}>
          <header>
            <span className="inspector-icon">
              <Icon name={type.icon ?? 'file'} />
            </span>
            <div className="inspector-title">
              <strong>{graphText.title || t('Drawing')}</strong>
              <span>{say(type.name as Message)}</span>
            </div>
          </header>
          <div className="inspector-body">
            {(['title', 'subtitle'] as const).map((key) => (
              <label key={key} className="field" data-key={key}>
                <span>{key === 'title' ? t('Title') : t('Subtitle')}</span>
                <TextInput value={graphText[key] ?? ''} onCommit={(v) => pinning.apply(setField(textNow(), type, [], key, v.trim() || undefined))} />
              </label>
            ))}
            <p className="fine">{t('Click a shape, group or line to see its properties here.')}</p>
          </div>
        </aside>
      )}
      {showInspector && selection.length > 1 && (
        <aside className="inspector" aria-label={t('Selection')}>
          <header>
            <span className="inspector-icon">
              <Icon name="mouse-pointer-2" />
            </span>
            <div className="inspector-title">
              <strong>{t('{count} selected', { count: selection.length })}</strong>
              <span>{(['node', 'group', 'edge'] as const)
                  .map((k) => [selection.filter((s) => s.kind === k).length, { node: '{count} shape|{count} shapes', group: '{count} group|{count} groups', edge: '{count} line|{count} lines' }[k]] as const)
                  .filter(([n]) => n)
                  .map(([n, what]) => count(n, what as Message))
                  .join(', ')}</span>
            </div>
            <button className="icon-button" onClick={() => p.setSelection([])} aria-label={t('Clear the selection')} title={t('Clear (Esc)')}>
              <Icon name="x" />
            </button>
          </header>
          <div className="inspector-body">
            <ArrangeBar shapes={selection.filter((s) => s.kind === 'node').length} onArrange={pinning.arrangeSelection} />
            <p className="fine">
              {t('Drag one to move them all, arrows nudge them,')} <kbd>⌘C</kbd> <kbd>⌘V</kbd> {t('copies and pastes. Shift-click adds or removes one.')}
            </p>
          </div>
          <footer>
            <button className="button ghost" onClick={edits.duplicate} title={t('Duplicate (⌘D)')}>
              <Icon name="copy" /> {t('Duplicate')}
            </button>
            <button className="button ghost" onClick={pinning.toggleLock} title={t('Lock or unlock (⇧⌘L)')}>
              <Icon name={selection.every((s) => locked.has(s.id)) ? 'lock-open' : 'lock'} /> {selection.every((s) => locked.has(s.id)) ? t('Unlock') : t('Lock')}
            </button>
            <button className="button ghost danger" onClick={edits.removeAll} title={t('Delete (⌫)')}>
              <Icon name="trash" /> {t('Delete')}
            </button>
          </footer>
        </aside>
      )}
    </div>
  );
}

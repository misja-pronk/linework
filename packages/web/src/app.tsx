// The editor app: YAML on the left, the drawing on the right, both selecting the same element.
// Builder actions (inspector, palette, drag) are edits of the YAML text plus pins, all in the
// editor's one undo history. The state lives in the hooks of app/, the panes are app/'s components;
// this file puts them together.
import { useRef, useState } from 'react';
import type { PreviewControl, Selection } from './preview.tsx';
import { useCraftPrefs } from './craft-actions.tsx';
import { AddMenu } from './add-menu.tsx';
import { forYourAi } from './ai/copy.ts';
import { useConfirm } from './confirm.tsx';
import { useLayers } from './layers-control.tsx';
import { useCompare } from './compare/index.tsx';
import { useLive } from './live/use-live.ts';
import { paneColumns, paneLayout } from './pane-layout.ts';
import { t, useUiLang } from './i18n/index.ts';
import { Icon } from './icon.tsx';
import { usePrefs } from './app/prefs.ts';
import { Toast, useToasts } from './app/toasts.tsx';
import { useModals } from './app/modals.ts';
import { useDocPlace, useDocument } from './app/document.ts';
import { useFileIO, useWorkspace } from './app/file-io.ts';
import { useDiskSync } from './app/disk-sync.ts';
import { useDrawing } from './app/drawing.ts';
import { useNavigation, useNavigationState } from './app/navigation.ts';
import { useSelect, useSelection } from './app/selection.ts';
import { pinActions } from './app/pins.ts';
import { useEdits } from './app/edits.ts';
import { useExports } from './app/exports.ts';
import { buildCommands } from './app/commands.ts';
import { canvasKeys, useGlobalKeys } from './app/key-handlers.ts';
import { kindLabel } from './app/names.ts';
import { Topbar } from './app/topbar.tsx';
import { FilesPane } from './app/files-pane.tsx';
import { EditorPane } from './app/editor-pane.tsx';
import { CanvasTools } from './app/canvas-tools.tsx';
import { DrawingPane } from './app/drawing-pane.tsx';
import { inspected, SidePanel, useSidePanel } from './app/side-panel.tsx';
import { StatusBar } from './app/status-bar.tsx';
import { Dialogs } from './app/dialogs.tsx';

export function App() {
  useUiLang();
  const prefs = usePrefs();
  const { theme, view } = prefs;
  const toasts = useToasts();
  const { notify } = toasts;
  /** Questions before something is lost, in the app's own dialog (confirm.tsx). */
  const confirmer = useConfirm();
  const modals = useModals(toasts.clear);
  const { modal, setModal } = modals;
  const document_ = useDocument(toasts.endUndoOffer);
  const { text, doc, pins, docKey, editor, textNow } = document_;
  const workspace = useWorkspace();
  const { ws } = workspace;
  const { load, docId, docFile, here } = useDocPlace(ws, doc);
  const navState = useNavigationState(docId);
  const { viewName, stepNo, focusAsked } = navState;
  const side = useSidePanel();
  const [adding, setAdding] = useState(false);
  /** On narrow screens one pane shows at a time. */
  const [pane, setPane] = useState<'yaml' | 'drawing'>('drawing');
  /** Layers switched on here (layers-control.tsx), on top of what the YAML says. */
  const layering = useLayers(docId, viewName);
  const drawing = useDrawing({ text, theme, pins, load, docKey, viewName, docFile, stepNo, focusAsked, lenses: layering.options });
  const { rendered, result, drawn, type, diagnostics, entries, current, vpins, locked, bent } = drawing;
  const craft = useCraftPrefs();
  const previewControl = useRef<PreviewControl>(null);
  const selState = useSelection();
  const { selection, selected, setSelection } = selState;
  const showInspector = () => side.setInspector(true);
  const sel = useSelect({ state: selState, drawing, editor, showInspector });
  const undo = () => void editor.current?.undo();
  const redo = () => void editor.current?.redo();
  const dropModal = () => setModal(undefined);
  const focusDrawing = () => requestAnimationFrame(() => (document.querySelector('.preview') as HTMLElement | null)?.focus({ preventScroll: true }));

  const live = useLive(
    () => ({
      path: ws && doc.path ? doc.path : undefined,
      text,
      type,
      selection: selection.map((s) => ({ kind: s.kind, id: s.id })),
      view: drawn?.view,
      layers: drawn?.layers?.active,
      step: stepNo,
      problems: diagnostics.map((d) => ({ severity: d.severity, message: d.message, ...(d.line ? { line: d.line } : {}) })),
      dirty: document_.dirty,
    }),
    docKey,
    // A proposal for another file of the folder opens it (file-io.ts).
    { changed: (p) => disk.changed(p), propose: side.askWith, open: (p) => files.openForProposal(p) },
  );
  const copyForAi = async () => {
    if (!type) return;
    await navigator.clipboard.writeText(forYourAi({ yaml: textNow(), type, file: docFile, selection: selection.map((s) => s.id) }));
    notify(t('Copied: paste it into your AI, then paste its YAML back here'));
  };
  const disk = useDiskSync({ ws, setWs: workspace.setWs, document: document_, notify, show: side.askWith, served: live.served });
  const pinning = pinActions({ drawing, pins, editor, previewControl, selection, notify, acted: prefs.acted });
  const files = useFileIO({ document: document_, workspace, notify, ask: confirmer.ask, setSelected: selState.setSelected, closeModal: modals.closeModal, dropModal, setView: prefs.setView, focusDrawing, pinsToSave: pinning.pinsToSave });
  const exports = useExports({ textNow, theme, load, pins, doc, docFile, ws, viewName, stepNo, focusAsked, lenses: layering.options, drawing, safeSvg: prefs.safeSvg, notify });
  const edits = useEdits({ drawing, selection: selState, select: sel, pins: pinning, editor, previewControl, textNow, notify, showInspector, closeAdding: () => setAdding(false) });
  const nav = useNavigation({ state: navState, drawing, text, textNow, ws, doc, here, selection, notify, apply: pinning.apply, ready: edits.ready, undo, nodeName: edits.nodeName, openInFolder: files.openInFolder, pick: files.pick, dropModal });

  const { selNode, selGroup, selEdge } = inspected(drawing, selected, sel.pathOf);
  /** The selection has properties to show (one element, or several to arrange). */
  const hasProperties = !!(selected && type && (selNode || selGroup || selEdge)) || selection.length > 1;
  /** One panel on the right, with tabs: the selection's properties, or Your AI. */
  const sideOpen = side.asking || (side.inspector && hasProperties);
  const paneWants = { width: prefs.windowWidth, folder: !!ws, view, editor: { width: prefs.split * prefs.windowWidth, folded: prefs.yamlFolded }, forceEditor: prefs.forceYaml, side: side.inspector || sideOpen };
  const panes = paneLayout({ ...paneWants, files: prefs.filesPref });
  /** The focused element as a screen reader says it: name, kind, and whether it is pinned or locked. */
  const describe = (s: Selection) => {
    const g = result?.graph;
    const e = s.kind === 'edge' ? g?.edges.find((x) => x.id === s.id) : undefined;
    const name = s.kind === 'node' ? edits.nodeName(s.id) : s.kind === 'group' ? (g?.groups.find((x) => x.id === s.id)?.label ?? s.id) : e ? `${t('Line from {from} to {to}', { from: edits.nodeName(e.from.node), to: edits.nodeName(e.to.node) })}${e.label ? `, ${e.label}` : ''}` : s.id;
    const kind = s.kind === 'edge' ? '' : `, ${kindLabel(sel.pathOf(s)) || s.kind}`;
    const state = locked.has(s.id) ? t(', locked') : (s.kind === 'node' ? vpins?.nodes?.[s.id] : s.kind === 'group' ? vpins?.groups?.[s.id] : bent.has(s.id)) ? (s.kind === 'edge' ? t(', bent by hand') : t(', pinned')) : '';
    return `${name}${kind}${state}`;
  };

  // Compare with an earlier version (compare/): its commands, its view over the drawing and its dialogs.
  const comparing = useCompare({
    docKey: ws && doc.path ? `${ws.name}/${doc.path}` : docId,
    docName: doc.name,
    path: ws ? doc.path : undefined,
    ws,
    text,
    textNow,
    pins,
    savedText: document_.savedText,
    savedPins: document_.savedPins,
    load,
    file: docFile,
    view: drawn?.view ?? viewName,
    theme,
    blocked: !!modal || navState.presenting,
    notify,
    onSelect: (s) => sel.select(s),
  });
  const layers = layering.ui(drawn, comparing.active);

  /** A: the popup over the drawing, or in the builder view the shapes panel that is already open. */
  const addShape = () => {
    const search = view === 'visual' ? (document.querySelector('.shapes input') as HTMLInputElement | null) : null;
    if (search) search.focus();
    else setAdding((a) => !a);
  };
  useGlobalKeys({ modal, setModal, presenting: navState.presenting, present: nav.present, toggleAsk: side.toggleAsk, saveYaml: files.saveYaml, openFile: files.openFile, saveSvg: exports.saveSvg, savePng: exports.savePng, view, setView: prefs.setView });
  const onCanvasKey = canvasKeys({ drawing, selection, selected, setSelection, select: sel.select, selectMany: sel.selectMany, edits, pinning, nav, craft, layers, undo, redo, addShape, connect: () => setModal('connect') });
  const commands = () =>
    buildCommands({ drawing, selection, selected, select: sel.select, ws, doc, pins, view, setView: prefs.setView, setPref: prefs.setPref, safeSvg: prefs.safeSvg, toggleSafeSvg: prefs.toggleSafeSvg, asking: side.asking, toggleAsk: side.toggleAsk, copyForAi, viewName, files, exports, edits, pinning, nav, modals, craft, previewControl, undo, redo, more: { compare: comparing.commands, layers: layers.commands } });
  const toggleTheme = () => prefs.setPref(theme === 'dark' ? 'light' : 'dark');

  return (
    <div className="app" onDragOverCapture={files.onDragFiles} onDragLeaveCapture={files.onDragLeave} onDropCapture={files.onDropFiles}>
      <Topbar
        ws={ws}
        remembered={workspace.remembered}
        doc={doc}
        dirty={document_.dirty}
        type={type}
        view={view}
        setView={prefs.setView}
        theme={theme}
        toggleTheme={toggleTheme}
        openFolder={(dir) => void files.openFolder(dir)}
        onTypeGuide={() => (modals.setGuiding(true), setModal('templates'))}
        onNew={() => setModal('templates')}
        onCommands={() => setModal('palette')}
        notify={notify}
        exportMenu={{ exports, safeSvg: prefs.safeSvg, toggleSafeSvg: prefs.toggleSafeSvg, written: nav.written, hasPins: !!pins, onDescribe: () => modals.setDescribing(true), saveYaml: files.saveYaml, downloadYaml: files.downloadYaml }}
      />

      <nav className="pane-tabs" role="tablist" aria-label={t('Show')}>
        <button role="tab" aria-selected={pane === 'yaml'} onClick={() => setPane('yaml')}>
          <Icon name="file-code" /> YAML
        </button>
        <button role="tab" aria-selected={pane === 'drawing'} onClick={() => setPane('drawing')}>
          <Icon name="image" /> {t('Drawing')}
        </button>
      </nav>
      <main
        className={`workspace view-${view}${sideOpen ? ' with-side' : ''}${ws ? ' with-files' : ''} files-is-${panes.filesMode} yaml-is-${panes.editorMode} show-${pane}`}
        style={{ ['--cols' as string]: paneColumns(panes, sideOpen) }}
      >
        <FilesPane
          ws={ws}
          mode={panes.filesMode}
          listFits={() => paneLayout({ ...paneWants, folder: true, files: 'list' }).filesMode === 'list'}
          setFilesPref={prefs.setFilesPref}
          openPath={doc.path}
          dirty={document_.dirty}
          open={(p) => void files.openInFolder(ws!, p)}
        />
        {view === 'visual' && type && (
          <aside className="shapes" aria-label={t('Shapes')}>
            <AddMenu inline items={type.palette} onAdd={(item) => edits.add(item)} onClose={focusDrawing} />
          </aside>
        )}
        <EditorPane
          editor={editor}
          panes={panes}
          view={view}
          initial={text}
          initialPins={pins}
          diagnostics={diagnostics}
          source={rendered?.text}
          mark={selected ? entries.find((e) => e.kind === selected.kind && e.id === selected.id) : undefined}
          onChange={document_.onChange}
          onCursor={sel.onCursor}
          onPins={document_.onPins}
          split={prefs.split}
          setSplit={prefs.setSplit}
          setYamlFolded={prefs.setYamlFolded}
          setForceYaml={prefs.setForceYaml}
        />
        <DrawingPane
          drawing={drawing}
          selection={selection}
          select={sel}
          edits={edits}
          pinning={pinning}
          nav={nav}
          craft={craft}
          control={previewControl}
          onKeyDown={onCanvasKey}
          describe={describe}
          tools={
            <CanvasTools
              drawn={drawn}
              hasType={!!type}
              adding={adding}
              addShape={addShape}
              undo={undo}
              redo={redo}
              tidyLayout={pinning.tidyLayout}
              canTidyAll={!!(vpins || drawing.drawnLayout?.held)}
              tidyAll={pinning.tidyAll}
              pickView={(name) => navState.setPicked({ doc: docId, name })}
              layersButton={layers.button}
              hasSelection={!!selection.length}
              focusOn={nav.focusOn}
              focusOnSelection={nav.focusOnSelection}
              hasSteps={!!nav.stepList.length}
              addStep={nav.addStepFromSelection}
              present={nav.present}
              asking={side.asking}
              toggleAsk={side.toggleAsk}
              proposal={!!live.proposal}
              comparing={comparing.active}
              toggleCompare={comparing.toggle}
              zoomToSelection={() => previewControl.current?.zoomToSelection()}
              craft={craft}
            />
          }
          layersChip={layers.chip}
          focusOff={focusAsked === null && !!drawn?.focusWritten}
          view={view}
          hint={prefs.hint}
          dismissHint={prefs.dismissHint}
          modalOpen={!!modal}
          adding={adding}
          closeAdding={() => setAdding(false)}
          compareView={comparing.view}
          textNow={textNow}
          naming={navState.naming}
          onNamed={() => navState.setNaming(undefined)}
          notify={notify}
        />
        {sideOpen && (
          <SidePanel
            state={side}
            drawing={drawing}
            text={text}
            textNow={textNow}
            theme={theme}
            load={load}
            selection={selection}
            selected={selected}
            setSelection={setSelection}
            select={(s) => sel.select(s)}
            pathOf={sel.pathOf}
            hasProperties={hasProperties}
            edits={edits}
            pinning={pinning}
            editor={editor}
            live={live}
            diskChange={disk.diskChange}
            docKey={docKey}
            clearDiskChange={() => disk.setDiskChange(undefined)}
            copyForAi={() => void copyForAi()}
            focusDrawing={focusDrawing}
            follow={nav.follow}
            tags={layers.tags}
          />
        )}
      </main>

      <StatusBar
        errors={drawing.errors}
        warnings={drawing.warnings}
        ms={rendered?.ms}
        graph={result?.graph}
        pinCount={drawing.pinCount}
        selection={selection}
        selected={selected}
        theme={theme}
        onProblems={() => setModal('problems')}
        onShortcuts={() => setModal('shortcuts')}
      />

      <Dialogs
        modals={modals}
        commands={commands}
        present={navState.presenting ? { doc: { text: textNow(), path: here, file: docFile, sidecar: pins, load }, theme, view: drawn?.view ?? nav.viewNow(), step: drawn?.step, focus: focusAsked, layers: layering.options, open: nav.presentOther, onClose: () => navState.setPresenting(false) } : undefined}
        compareDialogs={comparing.dialogs}
        confirmDialog={confirmer.dialog}
        selected={selected}
        graph={result?.graph}
        nodeName={edits.nodeName}
        connect={edits.connect}
        focusDrawing={focusDrawing}
        exports={exports}
        notify={notify}
        theme={theme}
        typeId={type?.id}
        onStart={(o) => void files.start(o)}
        diagnostics={diagnostics}
        current={current}
        editor={editor}
        dropping={files.dropping}
      />
      {toasts.toast && <Toast key={toasts.toast.message} toast={toasts.toast} onDone={toasts.clear} />}
    </div>
  );
}

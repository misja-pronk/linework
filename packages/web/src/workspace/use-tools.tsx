// The model-first workspace in the editor: search across the folder, drill down and up, back and
// forward, breadcrumbs, where-used, rename everywhere and the checks across files. The editor (app.tsx)
// hands over what it can do (open a file, show a view, select, focus, replace the text); everything
// about the workspace itself is here.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { drawingsOf, drillTarget, elementAt, notesPath, renamedId, renameNotesFile, renameSidecar, type LayoutSidecar, type RenamePlan, type WorkspaceIndex } from '@cartography/core';
import { findType } from '@cartography/engine';
import type { RenderResult } from '@cartography/engine';
import type { Command } from '../palette.tsx';
import { diskText, sidecarPath, writeInFolder, type Workspace } from '../files.ts';
import { lineOffset, useWorkspaceIndex, type Place } from './use-workspace.ts';
import { useHistory } from './history.ts';
import { WorkspaceSearch, placeName } from './search.tsx';
import { WhereUsed } from './where-used.tsx';
import { keyHint, shortcutFor } from '../keys.ts';
import { Crumbs, crumbsOf, upFrom } from './crumbs.tsx';
import { RenameEverywhere } from './rename.tsx';
import './workspace.css';

type Sel = { kind: 'node' | 'group' | 'edge'; id: string };

export interface Host {
  ws?: Workspace;
  /** The open document: its path in the folder, or its name. */
  file: string;
  inFolder: boolean;
  /** The text as last drawn, and as in the editor right now. */
  text: string;
  textNow(): string;
  pins?: LayoutSidecar;
  drawn?: RenderResult;
  /** The view asked for (undefined: as written). */
  view?: string;
  selected?: Sel;
  /** The drawing is of the text in the editor. */
  current: boolean;
  open(file: string, view?: string): Promise<void>;
  showView(view?: string): void;
  select(s: Sel): void;
  focus(node: string, view?: string): void;
  zoomToSelection(): void;
  fit(): void;
  reveal(from: number, to: number): void;
  /** One undo step in the editor: the text and (when given) all the pins. */
  replace(text: string, pins?: LayoutSidecar | null): void;
  /** The open diagram's review notes follow renamed ids. */
  renameNotes(node: (id: string) => string): void;
  /** Ids that review notes of the open diagram hang on. */
  noteIds(): string[];
  refresh(ws: Workspace): void;
  notify(message: string, o?: { tone?: 'error'; action?: { label: string; run(): void } }): void;
  /** More for "where is this used" about an element (the decisions about it). */
  whereExtra?(element: string): ReactNode;
  /** Opens a decision file (a search hit) where decisions are read; false when it is not one. */
  openDecision?(file: string): boolean;
}

const references = (type: string, data: unknown) => findType(type)?.references?.(data as never);
const C4 = new Set(['landscape', 'context', 'container', 'component', 'dynamic', 'deployment']);

export function useWorkspaceTools(h: Host) {
  const index: WorkspaceIndex = useWorkspaceIndex(h.ws, { path: h.inFolder ? h.file : undefined, name: h.file, text: h.text });
  const scope = h.ws?.name ?? h.file;
  const [dialog, setDialog] = useState<'search' | { rename: string }>();
  // Right after a file opens, the drawing is still the last file's: its view is not this file's.
  const here: Place = { file: h.file, view: h.current ? (h.drawn?.view ?? h.view) : h.view, node: h.selected && h.selected.kind !== 'edge' ? h.selected.id : undefined };
  const hostRef = useRef(h);
  hostRef.current = h;

  // ------------------------------------------------------------ going places

  /** Where to land once the drawing is there: select (and focus on) a node, or show a line. */
  const pending = useRef<Place & { focus?: boolean }>(undefined);
  const [arrivals, setArrivals] = useState(0);
  const go = useCallback(async (p: Place, focus = false) => {
    const host = hostRef.current;
    if (/\.md$/i.test(p.file) && host.openDecision?.(p.file)) return;
    pending.current = { ...p, focus };
    if (p.file !== host.file) {
      if (!host.ws) return host.notify(`${p.file} is not open here: open its folder`, { tone: 'error' });
      await host.open(p.file, p.view);
    } else if (p.view !== undefined ? p.view !== (host.drawn?.view ?? host.view) : p.node !== undefined && host.view !== undefined) host.showView(p.view);
    setArrivals((n) => n + 1);
  }, []);

  useEffect(() => {
    const p = pending.current;
    if (!p || p.file !== h.file || !h.drawn?.graph || !h.current) return;
    if (p.view !== undefined && h.drawn.view !== p.view) return;
    pending.current = undefined;
    if (p.line) {
      const t = lineOffset(h.textNow(), p.line);
      requestAnimationFrame(() => hostRef.current.reveal(t.from, t.to));
    }
    if (!p.node) return;
    const g = h.drawn.graph;
    const kind = g.nodes.some((n) => n.id === p.node) ? 'node' : g.groups.some((x) => x.id === p.node) ? 'group' : undefined;
    if (!kind) return;
    h.select({ kind, id: p.node });
    if (p.focus) h.focus(p.node, p.view);
    // A focus is the neighbourhood already: it is shown whole. Only selected, the drawing goes to it.
    const focus = p.focus;
    requestAnimationFrame(() => requestAnimationFrame(() => (focus ? hostRef.current.fit() : hostRef.current.zoomToSelection())));
  }, [h.drawn, h.file, h.current, arrivals]);

  const history = useHistory(here, (p) => void go(p), h.current && !!h.drawn);

  /** The element a node of this drawing stands for. */
  const elementOf = (node: string | undefined) => (node ? elementAt(index, h.file, h.drawn?.view, node) : undefined);
  const selectedElement = here.node ? elementOf(here.node) : undefined;

  /** The drill-downs that led here, so ⌘↑ goes back up the path people came down (review 3: it went to the model). */
  const drilled = useRef<{ from: Place; to: Place }[]>([]);
  const sameDrawing = (a: Place, b: Place) => a.file === b.file && (a.view ?? '') === (b.view ?? '');
  /** Down a level: the view about the element (its containers, its components), or for an instance the model's drawing of it. */
  const drill = (node: string | undefined): boolean => {
    const el = elementOf(node);
    if (!el) return false;
    const from: Place = { file: h.file, view: h.drawn?.view, node };
    const target = drillTarget(index, el, { file: h.file, view: h.drawn?.view });
    const to = target ? { ...target, node: el } : drawingsOf(index, el).find((d) => !(d.file === h.file && d.view === h.drawn?.view));
    if (!to) return false;
    drilled.current = [...drilled.current, { from, to }].slice(-50);
    void go(to);
    return true;
  };
  /** Double-click: down a level in a C4 view or on an instance; elsewhere the label is edited, as before. */
  const onDrill = (s: Sel): boolean => {
    if (s.kind === 'edge') return false;
    const v = index.views.find((x) => x.file === h.file && x.name === h.drawn?.view);
    const entry = index.files.get(h.file)?.entries.find((e) => e.id === s.id);
    const instance = !!entry?.of || !!entry?.ref;
    if (!(v?.kind && C4.has(v.kind)) && !instance) return false;
    return drill(s.id);
  };
  const up = () => {
    // Came down here by a drill: back up the same way, with what was drilled into selected.
    while (drilled.current.length && !sameDrawing(drilled.current.at(-1)!.to, { file: h.file, view: h.drawn?.view })) drilled.current = drilled.current.slice(0, -1);
    const back = drilled.current.at(-1);
    if (back) {
      drilled.current = drilled.current.slice(0, -1);
      return void go(back.from);
    }
    const to = upFrom(index, scope, here);
    if (!to) return h.notify('This is the top: there is no view above it');
    void go(to);
  };

  // ------------------------------------------------------------ rename

  const undoRename = useRef<() => Promise<void>>(undefined);
  /** Pins (and notes) files that change with a plan. */
  const pinsFollow = (plan: RenamePlan) =>
    [...plan.files, ...plan.drawnIn].flatMap((f) => {
      const side = sidecarPath(f.file);
      const open = f.file === h.file && h.inFolder;
      const text = open ? (h.pins ? JSON.stringify(h.pins) : undefined) : h.ws?.files.get(side)?.text;
      const notes = open ? undefined : h.ws?.files.get(notesPath(f.file))?.text;
      return [
        ...(text && renameSidecar(text, f.node) ? [side] : []),
        ...((open ? h.noteIds().some((id) => f.node(id) !== id) : notes && renameNotesFile(notes, f.node)) ? [notesPath(f.file)] : []),
      ];
    });

  const applyRename = async (plan: RenamePlan) => {
    setDialog(undefined);
    const host = hostRef.current;
    const ws = host.ws;
    const mine = plan.files.find((f) => f.file === host.file);
    const drawnHere = plan.drawnIn.find((f) => f.file === host.file);
    const others = plan.files.filter((f) => f !== mine);
    if ((others.length || plan.drawnIn.some((f) => f.file !== host.file)) && !ws) return host.notify('Renaming in other files needs their folder open', { tone: 'error' });
    if (mine && host.textNow() !== mine.before) return host.notify(`${host.file} changed while the preview was open: rename again`, { tone: 'error' });
    // Nothing is written when any file changed on disk since it was read.
    for (const f of others) {
      const disk = await diskText(ws!, f.file);
      if (disk != null && disk !== f.before) return host.notify(`${f.file} changed outside Cartography: nothing was renamed. Look at it, then rename again`, { tone: 'error' });
    }
    const writes: { path: string; before: string; after: string }[] = [];
    for (const f of [...others, ...plan.drawnIn.filter((x) => x.file !== host.file)]) {
      if (f.after !== f.before) writes.push({ path: f.file, before: f.before, after: f.after });
      const side = sidecarPath(f.file);
      const was = ws!.files.get(side)?.text;
      const next = was && renameSidecar(was, f.node);
      if (was && next) writes.push({ path: side, before: was, after: next });
      const notes = ws!.files.get(notesPath(f.file))?.text;
      const moved = notes && renameNotesFile(notes, f.node);
      if (notes && moved) writes.push({ path: notesPath(f.file), before: notes, after: moved });
    }
    try {
      for (const w of writes) await writeInFolder(ws!, w.path, w.after);
    } catch (e) {
      // Put back what was written, so the folder is never half renamed.
      for (const w of writes) await writeInFolder(ws!, w.path, w.before).catch(() => undefined);
      return host.notify(`Renaming failed: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
    }
    const pinsBefore = host.pins;
    const open = mine ?? drawnHere;
    const pinsHere = open && host.pins ? renameSidecar(JSON.stringify(host.pins), open.node) : undefined;
    if (open) host.renameNotes(open.node);
    if (mine || pinsHere) host.replace(mine?.after ?? host.textNow(), pinsHere ? (JSON.parse(pinsHere) as LayoutSidecar) : undefined);
    if (ws) host.refresh(ws);
    if (here.node) pending.current = { ...here, node: open?.node(here.node) ?? here.node };
    setArrivals((n) => n + 1);

    undoRename.current = async () => {
      const now = hostRef.current;
      for (const w of writes) {
        const disk = await diskText(now.ws!, w.path);
        if (disk != null && disk !== w.after && !window.confirm(`${w.path} changed after the rename. Put it back as it was before the rename anyway?`)) continue;
        await writeInFolder(now.ws!, w.path, w.before);
      }
      if (open && now.file === open.file) now.renameNotes((id) => (renamedId(id, plan.to, plan.from) !== id && open.node(renamedId(id, plan.to, plan.from)) === id ? renamedId(id, plan.to, plan.from) : id));
      if (pinsHere && !mine && now.file === open!.file) now.replace(now.textNow(), pinsBefore ?? null);
      if (mine) {
        if (now.file === mine.file && now.textNow() === mine.after) now.replace(mine.before, pinsBefore ?? null);
        else if (now.file === mine.file) now.notify(`${mine.file} changed since the rename: ⌘Z there undoes it step by step`, { tone: 'error' });
      }
      if (now.ws) now.refresh(now.ws);
      undoRename.current = undefined;
      now.notify(`Rename undone: ${plan.to} is ${plan.from} again`);
    };
    const n = plan.files.length;
    host.notify(`Renamed ${plan.from} → ${plan.to}${plan.label ? `, "${plan.label.to}"` : ''} in ${n} file${n === 1 ? '' : 's'}${mine ? ' (⌘Z undoes it in this one)' : ''}`, { action: { label: 'Undo rename', run: () => void undoRename.current?.() } });
  };

  const rename = (el = selectedElement) => {
    if (!el) return h.notify('Select an element of the model first, then rename it everywhere');
    setDialog({ rename: el });
  };

  // ------------------------------------------------------------ keys, commands, panels

  /** The folder's keys (keys.ts): search and rename also while typing, the rest only outside text. ⌘P is the browser's without a folder. */
  const onKey = (e: KeyboardEvent, typing: boolean): boolean => {
    const id = shortcutFor(e, typing ? ['folder-anywhere'] : ['folder', 'folder-anywhere']);
    // One file: its own elements and views are searched with ⇧⌘F; ⌘P prints.
    if (!h.ws) return id === 'search' && e.shiftKey ? (setDialog('search'), true) : false;
    if (id === 'search') return setDialog('search'), true;
    if (id === 'rename-everywhere') return rename(), true;
    if (id === 'back') return history.back() || h.notify('Nothing to go back to'), true;
    if (id === 'forward') return history.forward() || h.notify('Nothing to go forward to'), true;
    if (id === 'drill' && here.node) return drill(here.node) || h.notify('Nothing below this one'), true;
    if (id === 'up') return up(), true;
    return false;
  };

  const folderProblems = index.problems;
  const problemCommands: Command[] = folderProblems.map((p, i) => ({
    id: `ws-problem-${i}`,
    group: `Across ${scope}`,
    label: p.message,
    hint: `${p.file}${p.line ? `:${p.line}` : ''}`,
    icon: p.severity === 'error' ? 'circle-exclamation-point' : 'triangle-exclamation-point',
    run: () => void go({ file: p.file, line: p.line }),
  }));

  const commands: Command[] = [
    { id: 'ws-search', group: 'Workspace', label: `Search ${scope}…`, hint: 'elements, views, files, technology, owners', icon: 'search', shortcut: h.ws ? keyHint('search') : '⇧⌘F', run: () => setDialog('search') },
    ...(selectedElement ? [{ id: 'ws-rename', group: 'Workspace', label: `Rename ${selectedElement} everywhere…`, hint: 'every file that names it, previewed first', icon: 'tag', shortcut: keyHint('rename-everywhere'), run: () => rename() }] : []),
    ...(selectedElement ? [{ id: 'ws-drill', group: 'Workspace', label: 'Go down into the selection', hint: 'its containers, its components, or where it is modelled', icon: 'layers', shortcut: keyHint('drill'), run: () => void (drill(here.node) || h.notify('Nothing below this one')) }] : []),
    { id: 'ws-up', group: 'Workspace', label: 'Go up a level', icon: 'layers', shortcut: keyHint('up'), run: up },
    ...(history.canBack ? [{ id: 'ws-back', group: 'Workspace', label: 'Back', hint: history.previous && placeName(history.previous), icon: 'arrow-left', shortcut: keyHint('back'), run: () => void history.back() }] : []),
    ...(history.canForward ? [{ id: 'ws-forward', group: 'Workspace', label: 'Forward', hint: history.next && placeName(history.next), icon: 'arrow-right', shortcut: keyHint('forward'), run: () => void history.forward() }] : []),
    ...(undoRename.current ? [{ id: 'ws-undo-rename', group: 'Workspace', label: 'Undo rename', hint: 'every file it changed', icon: 'undo-2', run: () => void undoRename.current?.() }] : []),
  ];

  const crumbs = useMemo(() => crumbsOf(index, scope, here, h.drawn?.views?.find((v) => v.name === here.view)?.title), [index, scope, here.file, here.view, h.drawn?.views]);
  const crumbBar: ReactNode = (h.ws || index.views.length > 1) && (
    <Crumbs crumbs={crumbs} back={history.canBack ? () => void history.back() : undefined} forward={history.canForward ? () => void history.forward() : undefined} onGo={(p) => void go(p)} />
  );

  const wherePanel: ReactNode = selectedElement ? <WhereUsed index={index} element={selectedElement} here={here} onGo={(p) => void go(p)} onRename={() => rename()} extra={h.whereExtra?.(selectedElement)} /> : null;

  const dialogs: ReactNode = (
    <>
      {dialog === 'search' && <WorkspaceSearch index={index} scope={scope} onOpen={(p, focus) => void go(p, focus)} onClose={() => setDialog(undefined)} />}
      {typeof dialog === 'object' && <RenameEverywhere index={index} element={dialog.rename} references={references} pinsFollow={pinsFollow} onApply={(p) => void applyRename(p)} onClose={() => setDialog(undefined)} />}
    </>
  );

  /** Where the selected element is defined, when that is another file than this one (an included model). */
  const definedUse = selectedElement ? (index.uses.get(selectedElement) ?? []).find((u) => u.how === 'defined') : undefined;
  const definedElsewhere = definedUse && definedUse.file !== h.file ? { file: definedUse.file, line: definedUse.line, kind: index.elements.get(selectedElement!)?.[0]?.kind, open: () => void go({ file: definedUse.file, line: definedUse.line }) } : undefined;

  return { index, onKey, onDrill, commands, problemCommands, folderProblems, crumbBar, wherePanel, definedElsewhere, dialogs, go, open: dialog !== undefined };
}

// The editor app: YAML on the left, the drawing on the right, both selecting the same element.
// Builder actions (inspector, palette, drag) are edits of the YAML text plus pins, all in the
// editor's one undo history.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { packLayout, viewPins, withViewPins, type Diagnostic, type EdgeOverride, type GraphNode, type LayoutSidecar, type Link, type PaletteItem, type Path, type Point } from '@cartography/core';
import { Editor, type EditorHandle } from './editor.tsx';
import { Preview, type LabelTarget, type PreviewControl, type Selection } from './preview.tsx';
import { arrange, nearestToward, type ArrangeOp, type Direction } from './craft.ts';
import { ArrangeBar, arrangeCommands, arrangeKey, craftKey, useCraftPrefs } from './craft-actions.tsx';
import { Palette, type Command } from './palette.tsx';
import { Start, type Incoming, type Opened, type View } from './start.tsx';
import { isDrawio, isExcalidraw } from '@cartography/interop';
import { Inspector } from './inspector.tsx';
import { AddMenu } from './add-menu.tsx';
import { Menu } from './menu.tsx';
import { Shortcuts } from './shortcuts.tsx';
import { Icon } from './icon.tsx';
import { useRender } from './use-render.ts';
import { FocusChip, hopsBy, nextDirection, type Focus } from './focus-chip.tsx';
import { dropped, folderOf, hasMesh, memoryLoader, meshFrom } from './mesh.ts';
import { exportFrom, exportKind, exportNotes, exportRemark } from './exports.ts';

/** The command palette's entry for the exports in the open folder, by what they are. */
const EXPORT_ENTRY = {
  access: { label: (name: string) => `Who reaches what in ${name}`, hint: 'its az, Graph or AzureHound exports in access.yaml', icon: 'shield-user' },
  github: { label: (name: string) => `GitHub organisation of ${name}`, hint: 'its gh api responses in github.yaml', icon: 'folder-git-2' },
  azure: { label: (name: string) => `Azure resources in ${name}`, hint: 'its az graph query, az bicep build or terraform show -json output in azure.yaml', icon: 'cloud' },
};
import { ViewPicker } from './view-picker.tsx';
import { Present, type PresentDoc } from './present.tsx';
import { StepsStrip } from './steps-strip.tsx';
import { addStep, deleteStep, moveStep, renameStep, stepsPath } from './steps-edit.ts';
import { linkTarget } from './links.ts';
import { entryAt, entryRanges } from './ranges.ts';
import { blankText, exampleLoader, starters, typeName, type Starter } from './library.ts';
import { baseName, download, exportDrawio, exportExcalidraw, exportMermaid, exportPageSvg, exportPdf, exportPng, exportPptx, exportSafeSvg, exportSlide, exportSvg, yamlName, type Handed } from './export.ts';
import { addEntry, canMove, drawnAs, connectEntries, copyEntries, deleteEntries, deleteEntry, duplicateEntry, editChainLine, isChainLine, isEntryPath, moveEntry, pasteEntries, type Clip, edgeFields, fieldsFor, isScalarAt, parentKey, renameEntry, setEdgeField, setField } from './builder.ts';
import { store } from './store.ts';
import { decodeShare, SHARE_LIMIT, shareLink } from '@cartography/core';
import { themes } from '@cartography/theme';
import { brand } from './brand.ts';
import { OPEN_KEY } from './viewer.tsx';
import { BrandMenu } from './brand-menu.tsx';
import { canSaveFiles, canUseFolders, diagrams, diskText, folderLoader, lastFolder, pickFolder, readSidecar, reopen, saveAs, saveFile, saveInFolder, scan, type Workspace } from './files.ts';

type ThemePref = 'system' | 'light' | 'dark';

interface Doc {
  name: string;
  /** Where it came from, so bundled examples can read their contract files. */
  starter?: string;
  /** Path inside the open folder. */
  path?: string;
  /** The data product and contract files it was imported from, by path: its contracts are read from there. */
  files?: Record<string, string>;
}

interface Saved {
  text: string;
  doc: Doc;
  pins?: LayoutSidecar;
  /** What was last saved or opened, for the unsaved-changes dot after a reload. */
  savedText?: string | null;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** ⌘ on Mac, Ctrl elsewhere; on Mac, Ctrl stays the editor's (Emacs-style line keys). */
const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
const NONE: Diagnostic[] = [];
const NUDGE = 8;
/** Copied entries, kept in memory: the page's own clipboard (the system one stays free for text). */
let clipboard: Clip | undefined;

function useSystemDark() {
  const q = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(q.matches);
  useEffect(() => {
    const on = () => setDark(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, [q]);
  return dark;
}

/** Debounced value that passes straight through when `key` changes (another document). */
function useDebounced<T>(value: T, ms: number, key: unknown): T {
  const [state, setState] = useState({ value, key });
  if (state.key !== key) setState({ value, key });
  useEffect(() => {
    if (Object.is(state.value, value)) return;
    const t = setTimeout(() => setState({ value, key }), ms);
    return () => clearTimeout(t);
  }, [value, key, ms, state.value]);
  return state.key === key ? state.value : value;
}

/** Behind the first start dialog: a small, friendly diagram, not the most complex example. */
const firstStarter = starters.find((s) => s.id === 'template:systems') ?? starters[0]!;
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
/** What the status bar counts: what the type draws. One shape drawn whole (a sequence, a roadmap) is
 * counted by its parts; everything else by its elements and connections. */
function drawnCount(graph: { nodes: GraphNode[]; edges: unknown[] }): string {
  const s = graph.nodes.length === 1 ? graph.nodes[0]!.shape : undefined;
  if (s?.kind === 'sequence') return `${count(s.participants.length, 'participant')} · ${count(s.events.filter((e) => e.kind === 'message').length, 'message')}`;
  if (s?.kind === 'gitflow') return `${count(s.branches.length, 'branch')} · ${count(s.commits.length, 'commit')}`.replace('branchs', 'branches');
  if (s?.kind === 'roadmap') return `${count(s.lanes.length, 'lane')} · ${count(s.items.length, 'item')}`;
  if (s?.kind === 'journey') return `${count(s.phases.length, 'phase')} · ${count(s.steps.length, 'step')}`;
  if (s?.kind === 'matrix') return `${count(s.rows.length, 'row')} · ${count(s.columns.length, 'column')}`;
  return `${count(graph.nodes.length, 'element')} · ${count(graph.edges.length, 'connection')}`;
}
const label = (n: GraphNode) => (n.shape.kind === 'card' || n.shape.kind === 'journey-part' || n.shape.kind === 'block' ? n.shape.label || n.id : n.shape.kind === 'flow' ? n.shape.label || n.id : n.shape.kind === 'table' ? n.shape.title : n.id);
const iconOf = (n: GraphNode) => (n.shape.kind === 'card' || n.shape.kind === 'table' || n.shape.kind === 'journey-part' ? n.shape.icon : n.shape.kind === 'flow' ? 'workflow' : n.shape.kind === 'block' ? (n.shape.form === 'person' ? 'user' : n.shape.form === 'area' || n.shape.form === 'capability' || n.shape.form === 'chip' ? 'layout-grid' : 'users') : 'table');

export function App() {
  const saved = useMemo(() => store.get<Saved>('doc'), []);
  const [text, setText] = useState(saved?.text ?? firstStarter.text);
  const [doc, setDoc] = useState<Doc>(saved?.doc ?? { name: firstStarter.file, starter: firstStarter.id });
  const [pins, setPins] = useState<LayoutSidecar | undefined>(saved?.pins);
  const [safeSvg, setSafeSvg] = useState(() => store.get<boolean>('svg-safe') ?? false);
  const toggleSafeSvg = () =>
    setSafeSvg((on) => {
      store.set('svg-safe', !on);
      return !on;
    });
  /** A node being dragged: its pin before it is committed to the history. */
  const [draft, setDraft] = useState<{ nodes?: Record<string, Point>; groups?: Record<string, Point>; edges?: Record<string, EdgeOverride> }>();
  const [docKey, setDocKey] = useState(0);
  const [pref, setPref] = useState<ThemePref>(store.get('theme') ?? 'system');
  const systemDark = useSystemDark();
  const theme: 'light' | 'dark' = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  /** Everything selected. One element is "the" selection (inspector, Tab, connect); more is a group action. */
  const [selection, setSelection] = useState<Selection[]>([]);
  const selected = selection.length === 1 ? selection[0] : undefined;
  const setSelected = useCallback(
    (s: Selection | undefined | ((s: Selection | undefined) => Selection | undefined)) =>
      setSelection((prev) => {
        const one = prev.length === 1 ? prev[0] : undefined;
        const next = typeof s === 'function' ? s(one) : s;
        return next === one && prev.length <= 1 ? prev : next ? [next] : [];
      }),
    [],
  );
  // A first visit starts with choosing what to make and how.
  // The start dialog only until it has been left once (by any way: a template, a file, Esc).
  const [modal, setModal] = useState<'palette' | 'templates' | 'problems' | 'connect' | 'shortcuts' | undefined>(() => (store.get('started') ? undefined : 'templates'));
  // A dialog takes the stage: a message about the page under it goes (what the dialog itself says shows on top).
  // Once the start dialog is left, by whatever way, it is not shown at the next launch.
  useEffect(() => {
    if (modal) setToast(undefined);
    else store.set('started', true);
  }, [modal]);
  /** Building visually (drawing and shapes) or writing YAML (editor and drawing side by side). */
  // A first visit shows the builder: the friendliest way in.
  const [view, setViewState] = useState<View>(() => store.get<View>('view') ?? (store.get('started') ? 'code' : 'visual'));
  const setView = (v: View) => {
    setViewState(v);
    store.set('view', v);
  };
  const [adding, setAdding] = useState(false);
  /** On narrow screens one pane shows at a time. */
  const [pane, setPane] = useState<'yaml' | 'drawing'>('drawing');
  /** The first-visit hint, until it is dismissed once. */
  const [hint, setHint] = useState(() => !store.get('hinted'));
  /** The hint's height: a toast stands clear above it (see .with-hint .toast). */
  const [hintHeight, setHintHeight] = useState(72);
  const dismissHint = () => {
    setHint(false);
    store.set('hinted', true);
  };
  /** The hint has done its job once something is built. */
  const acted = () => hint && dismissHint();
  const [inspector, setInspector] = useState(true);
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  /** The type pill's card: what this type is for, and the way to the type guide. */
  const [typeCard, setTypeCard] = useState(false);
  /** Opened from the type pill: the dialog marks the open diagram's type. */
  const [guiding, setGuiding] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'error'; action?: { label: string; run(): void }; more?: { label: string; run(): void } }>();
  /** All an import or export had to say (the toast says the first), for the document it was about: listed with the problems. */
  const [notes, setNotes] = useState<{ doc: string; title: string; items: string[] }>();
  const [split, setSplit] = useState(() => Math.min(0.7, Math.max(0.2, Number(store.get('split')) || 0.4)));
  const editor = useRef<EditorHandle>(null);
  const openedText = useRef<string | null>(null);
  const [ws, setWs] = useState<Workspace>();
  const [remembered, setRemembered] = useState<FileSystemDirectoryHandle>();
  /** A single file opened or saved outside a folder. */
  const fileHandle = useRef<FileSystemFileHandle>(undefined);
  /** What is on disk (or what was opened), for the unsaved-changes dot. */
  const [savedText, setSavedText] = useState<string | null>(saved ? (saved.savedText ?? null) : firstStarter.text);
  /** Pins as saved, compared as JSON: a move is an unsaved change too. */
  const [savedPins, setSavedPins] = useState<string>(() => JSON.stringify(saved?.pins ?? null));
  const dirty = savedText !== text || savedPins !== JSON.stringify(pins ?? null);

  useEffect(() => {
    if (canUseFolders) void lastFolder().then(setRemembered);
  }, []);

  const load = useMemo(
    () => (ws && doc.path ? folderLoader(ws, doc.path) : doc.starter ? exampleLoader(doc.starter) : doc.files ? memoryLoader(doc.files) : undefined),
    [ws, doc.path, doc.starter, doc.files],
  );
  /** The open folder holds data products or data contracts (ODPS, ODCS): it can be drawn as one map. */
  const meshInWs = useMemo(() => !!ws && hasMesh([...ws.files].map(([path, f]) => ({ path, text: f.text }))), [ws]);
  /** The open folder holds access exports or gh api responses: they can be drawn as one access or GitHub diagram. */
  const exportInWs = useMemo(() => (ws && !meshInWs ? exportKind([...ws.files].map(([path, f]) => ({ path, text: f.text }))) : undefined), [ws, meshInWs]);
  // Views: the one asked for (per document) and the one drawn (a diagram of only views draws its first).
  // Pins live per view in the sidecar; everything below works on the drawn view's pins.
  const docId = doc.path ?? doc.starter ?? doc.name;
  const [picked, setPicked] = useState<{ doc: string; name?: string }>();
  const viewName = picked?.doc === docId ? picked.name : undefined;
  // Steps: the one looked at while editing (per document and view), and presenting full screen.
  const [stepAt, setStepAt] = useState<{ doc: string; view?: string; n: number }>();
  const stepNo = stepAt && stepAt.doc === docId && stepAt.view === viewName ? stepAt.n : undefined;
  const [presenting, setPresenting] = useState(false);
  // A focus set here (F) on top of what the YAML says, per document and view: null shows everything although the YAML has one.
  const [lens, setLens] = useState<{ doc: string; view?: string; focus: { on: string[]; hops: number | 'all'; direction: Focus['direction'] } | null }>();
  const focusAsked = lens && lens.doc === docId && lens.view === viewName ? lens.focus : undefined;
  /** A step just made from the selection: the strip asks for its name. */
  const [naming, setNaming] = useState<number>();
  const drawnView = useRef<string>(undefined);
  const sidecar = useMemo<LayoutSidecar | undefined>(() => {
    if (!draft) return pins;
    const v = viewPins(pins, drawnView.current);
    return withViewPins(pins, drawnView.current, { ...v, version: 1, nodes: { ...(v?.nodes ?? {}), ...draft.nodes }, groups: { ...(v?.groups ?? {}), ...draft.groups }, edges: { ...(v?.edges ?? {}), ...draft.edges } });
  }, [pins, draft]);
  // Slow (big) diagrams wait a little longer between keystrokes, so typing stays smooth.
  const [renderMs, setRenderMs] = useState(0);
  const docFile = (doc.path ?? doc.starter ?? doc.name).split('/').pop();
  /** Counts layout resets: the drawing remembers where things were until one (use-render.ts). */
  const [fresh, setFresh] = useState(0);
  const rendered = useRender(useDebounced(text, Math.min(400, Math.max(40, renderMs * 1.5)), docKey), theme, sidecar, load, docKey, viewName, docFile, stepNo, fresh, focusAsked);
  useEffect(() => {
    if (rendered) setRenderMs(rendered.ms);
  }, [rendered]);
  const result = rendered?.result;
  const drawn = rendered?.drawn;
  drawnView.current = drawn?.view;
  const vpins = viewPins(pins, drawn?.view);
  /** How the drawing on screen was made and where things are before pins (stay.ts in the layout package). */
  const drawnLayout = drawn?.placed?.memory;
  // Positions go into the sidecar once asked for (carto render --stable wrote them), and when the
  // drawing was kept from an earlier one: the variant alone would not draw it again.
  const tracked = vpins?.layout?.at !== undefined;
  const layoutNote = () => (drawnLayout ? packLayout(drawnLayout, tracked || !!drawnLayout.held) : vpins?.layout);
  /**
   * Pins with the note of the drawing they were set on, so the same placement is drawn under them
   * next time: without it the first pin could redraw everything else. Null when nothing is left to keep.
   */
  const noted = (out: LayoutSidecar): LayoutSidecar | null => {
    const note = layoutNote();
    const { layout: _, ...rest } = out;
    if (rest.nodes || rest.groups || rest.edges) return note ? { ...rest, layout: note } : rest;
    return tracked && note ? { version: 1, layout: note } : null;
  };
  const locked = useMemo(() => new Set(vpins?.locked ?? []), [vpins?.locked]);
  const bent = useMemo(() => new Set(Object.keys(vpins?.edges ?? {})), [vpins?.edges]);
  const craft = useCraftPrefs();
  const previewControl = useRef<PreviewControl>(null);
  const type = result?.type ?? drawn?.type;
  const diagnostics = result?.diagnostics ?? NONE;
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const entries = useMemo(() => entryRanges(rendered?.text ?? '', result?.graph), [rendered?.text, result?.graph]);
  const current = rendered?.text === text;
  const mark = selected ? entries.find((e) => e.kind === selected.kind && e.id === selected.id) : undefined;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => store.set('theme', pref), [pref]);
  useEffect(() => store.set('split', split), [split]);

  // Keep the last document; also right away when the tab goes away.
  const latest = useRef<Saved>({ text, doc, pins, savedText });
  latest.current = { text, doc, pins, savedText };
  useEffect(() => {
    const t = setTimeout(() => store.set('doc', latest.current), 300);
    return () => clearTimeout(t);
  }, [text, doc, pins, savedText]);
  useEffect(() => {
    const flush = () => store.set('doc', latest.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const notify = useCallback((message: string, opts: { tone?: 'error'; action?: { label: string; run(): void }; more?: { label: string; run(): void } } = {}) => setToast({ message, ...opts }), []);
  /** Keeps what an import or export said about a document; with more than one thing, the toast offers them all. */
  const remember = (name: string, title: string, items: string[]) => {
    setNotes(items.length ? { doc: name, title, items } : undefined);
    return items.length > 1 ? { more: { label: `Show all ${items.length}`, run: () => setModal('problems') } } : {};
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), toast.action || toast.tone ? 7000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Back in the window: read the folder again, so files edited elsewhere show up. The open file
  // reloads when it has no unsaved changes; with changes, a warning (saving then asks first).
  const onDisk = useRef({ ws, doc, dirty, savedText });
  onDisk.current = { ws, doc, dirty, savedText };
  useEffect(() => {
    if (!ws) return;
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 1500) return;
      last = Date.now();
      void scan(ws.dir)
        .then((next) => {
          setWs(next);
          const { doc: d, dirty: changed, savedText: base } = onDisk.current;
          const disk = d.path ? next.files.get(d.path)?.text : undefined;
          if (disk == null || base == null || disk === base) return;
          if (!changed) {
            editor.current?.load(disk, readSidecar(next, d.path!));
            setSavedText(disk);
            setDocKey((k) => k + 1);
            notify(`${d.path} changed on disk: reloaded`);
          } else notify(`${d.path} changed on disk. Saving will ask before it overwrites that.`, { tone: 'error' });
        })
        .catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ws, notify]);

  const onChange = (next: string) => {
    setText(next);
    // The "undo open" offer ends with the first edit: it would throw that edit away.
    if (openedText.current != null && next !== openedText.current) {
      openedText.current = null;
      setToast((t) => (t?.action?.label === 'Undo' ? undefined : t));
    }
  };

  const open = useCallback(
    (next: string, nextDoc: Doc, nextPins?: LayoutSidecar, quiet = false, said?: string, told?: { title: string; items: string[] }) => {
      const before = { text: editor.current?.text() ?? text, doc, pins, handle: fileHandle.current, savedText, savedPins };
      editor.current?.load(next, nextPins);
      setDoc(nextDoc);
      setSelected(undefined);
      setDocKey((k) => k + 1);
      setSavedText(next);
      setSavedPins(JSON.stringify(nextPins ?? null));
      openedText.current = next;
      const more = remember(nextDoc.name, told?.title ?? '', told?.items ?? []);
      // Within a folder, files are saved before switching: nothing to undo. A blank start says nothing either.
      if (nextDoc.path || quiet) return;
      notify(said ?? `Opened ${nextDoc.name}`, {
        ...more,
        action: {
          label: 'Undo',
          run: () => {
            editor.current?.load(before.text, before.pins);
            setDoc(before.doc);
            // The file it belonged to comes back too, so the next save goes to the right place.
            fileHandle.current = before.handle;
            setSavedText(before.savedText);
            setSavedPins(before.savedPins);
            setSelected(undefined);
            setDocKey((k) => k + 1);
          },
        },
      });
    },
    [text, doc, pins, notify, savedText, savedPins],
  );

  // "Open in editor" from a share link's viewer: the diagram becomes a document of this browser's own,
  // with an undo back to what was open; the link data leaves the address bar.
  const openShared = useRef(false);
  useEffect(() => {
    const m = new RegExp(`^#${OPEN_KEY}=([A-Za-z0-9_-]+)$`).exec(location.hash);
    if (!m || openShared.current) return;
    openShared.current = true;
    history.replaceState(null, '', location.pathname + location.search);
    void decodeShare(m[1]!).then((d) => {
      if (!d) notify('That link does not hold a diagram: it may have been cut short', { tone: 'error' });
      else {
        setModal(undefined);
        open(d.yaml, { name: d.name ?? 'shared.yaml' }, d.layout, false, `Opened the shared diagram as ${d.name ?? 'shared.yaml'}`);
      }
    });
  }, [open, notify]);

  /** Before replacing the document: save it where it lives, or ask. False keeps it open. */
  const leave = async (): Promise<boolean> => {
    if (!dirty) return true;
    if ((ws && doc.path) || fileHandle.current) return save();
    return window.confirm(`${doc.name} has changes that are not saved in a file. Discard them?`);
  };

  const focusDrawing = () => requestAnimationFrame(() => (document.querySelector('.preview') as HTMLElement | null)?.focus({ preventScroll: true }));

  /** Opening something else over unsaved changes (a template, a drop, a file): asked first, as for a folder. */
  const pick = async (s: Starter) => {
    setModal(undefined);
    if (!(await leave())) return;
    fileHandle.current = undefined;
    open(s.text, { name: s.file, starter: s.id });
    focusDrawing();
  };

  /** From the start dialog: the chosen template or generated YAML, in the chosen way of working. */
  const start = async (o: Opened) => {
    closeModal();
    if (!(await leave())) return;
    fileHandle.current = undefined;
    setView(o.view);
    open(o.text, { name: o.name, starter: o.starter }, o.pins, o.blank);
    if (o.view === 'code') requestAnimationFrame(() => editor.current?.focus());
    else focusDrawing();
  };

  /** Saves where the document lives: its folder, its file, or a new file. Returns false when cancelled. */
  const save = async (): Promise<boolean> => {
    const now = textNow();
    // All pins are kept: other views of the same file (access matrices, data-products overview) draw other things.
    // The view on screen gets the note of the drawing as it is now, when it has a sidecar entry anyway.
    const pinsToSave = vpins && drawnLayout ? withViewPins(pins, drawn?.view, noted(vpins) ?? undefined) : pins;
    try {
      if (ws && doc.path) {
        // Never overwrite edits made elsewhere without asking.
        const disk = await diskText(ws, doc.path);
        if (disk != null && savedText != null && disk !== savedText && disk !== now && !window.confirm(`${doc.path} was changed outside Cartography. Overwrite it?`)) return false;
        await saveInFolder(ws, doc.path, now, pinsToSave);
      }
      else if (fileHandle.current) await saveFile(fileHandle.current, now);
      else if (canSaveFiles) {
        const r = await saveAs(yamlName(doc.name), now, ws?.dir);
        if (!r) return false;
        // Saved inside the open folder: it becomes one of its files, with its pins next to it.
        const inside = ws ? await ws.dir.resolve(r.handle) : null;
        if (ws && inside) {
          const path = inside.join('/');
          await saveInFolder(ws, path, now, pinsToSave);
          fileHandle.current = undefined;
          setDoc({ name: r.name, path });
          setWs(await scan(ws.dir));
        } else {
          fileHandle.current = r.handle;
          setDoc({ name: r.name, ...(doc.files ? { files: doc.files } : {}) });
        }
      } else download(yamlName(doc.name), now, 'text/yaml');
      setSavedText(now);
      setSavedPins(JSON.stringify(pins ?? null));
      notify(`Saved ${doc.path ?? doc.name}`);
      return true;
    } catch (e) {
      notify(`Saving failed: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
      return false;
    }
  };

  const openFolder = async (dir?: FileSystemDirectoryHandle) => {
    try {
      const next = dir ? await reopen(dir) : await pickFolder();
      if (!next) return;
      // After a reload the document of that folder is back with its edits: carry on with it.
      if (!ws && doc.path && next.files.has(doc.path)) {
        setWs(next);
        setRemembered(next.dir);
        setSavedText(next.files.get(doc.path)!.text);
        return;
      }
      if (!(await leave())) return;
      setWs(next);
      setRemembered(next.dir);
      const first = diagrams(next)[0];
      if (first) openInFolder(next, first);
      else if (meshInFolder(next) || exportInFolder(next)) return;
      else notify(`No diagrams in ${next.name} yet: start from a template and save it there`);
    } catch (e) {
      notify(`Opening the folder failed: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' });
    }
  };

  const openInFolder = async (w: Workspace, path: string) => {
    // Switching files keeps work: saved first where it lives, otherwise asked.
    if (doc.path === path && ws === w) return;
    if (!(await leave())) return;
    const f = w.files.get(path);
    if (!f) return;
    fileHandle.current = undefined;
    open(f.text, { name: path.split('/').pop()!, path }, readSidecar(w, path));
  };

  /** A file from another tool goes through the Import panel: pages, positions and what was left out are shown first. */
  const [incoming, setIncoming] = useState<Incoming>();
  const foreign = (name: string, text: string) => /\.(drawio|dio|excalidraw|mmd|mermaid|d2|puml|plantuml)$/i.test(name) || (!/\.ya?ml$/i.test(name) && (isDrawio(text) || isExcalidraw(text)));
  const OTHER = { 'application/xml': ['.drawio', '.dio', '.xml'], 'application/json': ['.excalidraw'], 'text/plain': ['.mmd', '.mermaid', '.d2', '.puml', '.plantuml'] };

  /** data-mesh.yaml in the open folder: its data products and contracts as one map, made or brought up to date. False: the folder has none. */
  const meshInFolder = (w: Workspace): boolean => {
    const path = 'data-mesh.yaml';
    const was = w.files.get(path)?.text;
    if (was != null && !/^type:\s*data-products\s*$/m.test(was)) return (notify(`${path} in ${w.name} is another kind of diagram: rename it first`, { tone: 'error' }), true);
    const mesh = meshFrom([...w.files].filter(([p]) => p !== path).map(([p, f]) => ({ path: p, text: f.text })), was != null ? { existing: was } : {});
    if (!mesh?.yaml) return false;
    fileHandle.current = undefined;
    open(mesh.yaml, { name: path, path }, readSidecar(w, path));
    // Not on disk yet, or not like this: ⌘S writes it into the folder.
    setSavedText(was ?? null);
    const more = remember(path, 'From the data products and contracts', meshNotes(mesh.problems));
    notify(`${mesh.summary} in ${w.name} → ${path}${was != null ? ', what you added by hand is kept' : ''}${meshRemarks(mesh.problems)}`, { ...more, ...(mesh.problems.some((p) => p.severity === 'error') ? { tone: 'error' } : {}) });
    focusDrawing();
    return true;
  };
  /** access.yaml or github.yaml in the open folder: its exports as one diagram, made or brought up to date. False: the folder has none. */
  const exportInFolder = (w: Workspace): boolean => {
    const files = [...w.files].map(([p, f]) => ({ path: p, text: f.text }));
    const kind = exportKind(files);
    if (!kind) return false;
    const path = `${kind}.yaml`;
    const was = w.files.get(path)?.text;
    if (was != null && !new RegExp(`^type:\\s*${kind}\\s*$`, 'm').test(was)) return (notify(`${path} in ${w.name} is another kind of diagram: rename it first`, { tone: 'error' }), true);
    const r = exportFrom(files.filter((f) => f.path !== path), was != null ? { existing: was } : {});
    if (!r?.yaml) return (notify(`Nothing to draw in ${w.name}${r ? exportRemark(r) : ''}`, { tone: 'error', ...(r ? remember(doc.name, 'From the exports (nothing drawn)', exportNotes(r)) : {}) }), true);
    fileHandle.current = undefined;
    open(r.yaml, { name: path, path }, readSidecar(w, path));
    setSavedText(was ?? null);
    const more = remember(path, 'From the exports', exportNotes(r));
    notify(`${r.summary} in ${w.name} → ${path}${was != null ? ', what you added by hand is kept' : ''}${exportRemark(r)}`, { ...more, ...(r.problems.some((p) => p.severity === 'error') ? { tone: 'error' } : {}) });
    focusDrawing();
    return true;
  };
  const meshRemarks = (problems: { file?: string; message: string }[]) =>
    problems.length ? `. ${problems[0]!.file ? `${problems[0]!.file}: ` : ''}${problems[0]!.message}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ''}` : '';
  const meshNotes = (problems: { file?: string; message: string }[]) => problems.map((p) => (p.file ? `${p.file}: ${p.message}` : p.message));

  /** Files picked or dropped. A drawing from draw.io, Excalidraw or Mermaid is imported; data products and contracts (ODPS, ODCS) become one data mesh map; otherwise the first diagram opens. */
  const openTexts = async (files: { path: string; text: string }[], handle?: FileSystemFileHandle) => {
    // A folder of data products may hold a drawing too: the mesh goes first.
    const other = hasMesh(files) ? undefined : files.find((f) => foreign(f.path, f.text));
    if (other) {
      setIncoming({ name: other.path.split('/').pop()!, text: other.text });
      setModal('templates');
      return;
    }
    const folder = folderOf(files);
    const mesh = meshFrom(files);
    if (mesh?.yaml) {
      if (!(await leave())) return;
      fileHandle.current = undefined;
      open(mesh.yaml, { name: `${folder ?? 'data-mesh'}.yaml`, files: mesh.files }, undefined, false, `${mesh.summary} as one map${meshRemarks(mesh.problems)}`, { title: 'From the data products and contracts', items: meshNotes(mesh.problems) });
      return focusDrawing();
    }
    if (mesh) return notify(`Nothing to draw${meshRemarks(mesh.problems) || ': no data product or contract could be read'}`, { tone: 'error', ...remember(doc.name, 'From the data products and contracts (nothing drawn)', meshNotes(mesh.problems)) });
    // Access exports (az, Graph, AzureHound) or gh api responses: one access or GitHub diagram.
    const exported = exportFrom(files);
    if (exported?.yaml) {
      if (!(await leave())) return;
      fileHandle.current = undefined;
      open(exported.yaml, { name: `${folder ?? exported.kind}.yaml` }, undefined, false, `${exported.summary}${exportRemark(exported)}`, { title: 'From the exports', items: exportNotes(exported) });
      return focusDrawing();
    }
    if (exported) return notify(`Nothing to draw${exportRemark(exported)}`, { tone: 'error', ...remember(doc.name, 'From the exports (nothing drawn)', exportNotes(exported)) });
    const diagram = files.find((f) => /\.ya?ml$/i.test(f.path) && /^type:\s*[\w-]+/m.test(f.text)) ?? (files.length === 1 && /\.ya?ml$/i.test(files[0]!.path) ? files[0] : undefined);
    if (!diagram) return notify('Nothing to open there: drop a diagram (.yaml), or data product and data contract files (ODPS, ODCS)', { tone: 'error' });
    if (!(await leave())) return;
    fileHandle.current = files.length === 1 ? handle : undefined;
    open(diagram.text, { name: diagram.path.split('/').pop()! });
  };

  // Files dragged over the page: the whole page takes them, before the YAML editor reads them as text to insert.
  const [dropping, setDropping] = useState(false);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  const onDragFiles = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropping(true);
  };
  const onDropFiles = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropping(false);
    void dropped(e.dataTransfer)
      .then((files) => openTexts(files))
      .catch((err: unknown) => notify(`Opening failed: ${err instanceof Error ? err.message : String(err)}`, { tone: 'error' }));
  };

  const openFile = () => {
    if ('showOpenFilePicker' in window) {
      void (async () => {
        try {
          const hs = await (window as unknown as { showOpenFilePicker(o: object): Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
            multiple: true,
            types: [
              { description: 'Cartography diagram, data products and contracts, or access, GitHub and Azure exports (JSON)', accept: { 'text/yaml': ['.yaml', '.yml'], 'application/json': ['.json'] } },
              { description: 'draw.io, Excalidraw, Mermaid, D2 or PlantUML, to import', accept: OTHER },
            ],
          });
          const files = await Promise.all(hs.map(async (h) => ((f) => f.text().then((text) => ({ path: f.name, text })))(await h.getFile())));
          await openTexts(files, hs[0]);
        } catch (e) {
          if ((e as Error).name !== 'AbortError') notify(`Opening failed: ${(e as Error).message}`, { tone: 'error' });
        }
      })();
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,.json,text/yaml,.drawio,.dio,.xml,.excalidraw,.mmd,.mermaid,.d2,.puml,.plantuml';
    input.multiple = true;
    input.onchange = async () => {
      const files = await Promise.all([...(input.files ?? [])].map(async (f) => ({ path: f.name, text: await f.text() })));
      if (files.length) await openTexts(files);
    };
    input.click();
  };

  // ------------------------------------------------------------ export

  const exportInput = () => ({ text: editor.current?.text() ?? text, theme, load, sidecar: pins, view: viewName, file: docFile, previous: drawnLayout, step: stepNo, focus: focusAsked });
  const attempt = (what: string, run: () => Promise<void>) => () =>
    void run().catch((e: unknown) => notify(`${what} failed: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' }));
  const saveYaml = () => void save();
  const downloadYaml = () => download(yamlName(doc.name), editor.current?.text() ?? text, 'text/yaml');
  const saveLayout = () => pins && download(`${baseName(doc.name)}.layout.json`, JSON.stringify(pins, null, 2) + '\n', 'application/json');
  // SVG for Office: the same drawing without what PowerPoint and Word drop. The choice is remembered.
  const svgNow = () => (safeSvg ? exportSafeSvg(exportInput()) : exportSvg(exportInput()));
  const saveSvg = attempt('Export', async () => download(`${baseName(doc.name)}.svg`, await svgNow(), 'image/svg+xml'));
  /** Another tool's file is there; what it could not hold is said, not hidden. */
  const handed = (what: string, h: Handed) =>
    h.warnings.length ? notify(`${what}. ${h.warnings[0]}${h.warnings.length > 1 ? `, and ${h.warnings.length - 1} more left out` : ''}`, { action: { label: 'OK', run: () => {} }, ...remember(doc.name, `${what}: left out`, h.warnings) }) : notify(what);
  const saveDrawio = attempt('Export', async () => {
    const h = await exportDrawio(exportInput());
    download(`${baseName(doc.name)}.drawio`, h.data, 'application/xml');
    handed('Saved for draw.io', h);
  });
  const saveExcalidraw = attempt('Export', async () => {
    const h = await exportExcalidraw(exportInput());
    download(`${baseName(doc.name)}.excalidraw`, h.data, 'application/json');
    handed('Saved for Excalidraw', h);
  });
  const saveMermaid = attempt('Export', async () => {
    const h = await exportMermaid(exportInput());
    download(`${baseName(doc.name)}.mmd`, h.data, 'text/plain');
    handed('Saved as Mermaid', h);
  });
  const copyMermaid = attempt('Copy', async () => {
    const h = await exportMermaid(exportInput());
    await navigator.clipboard.writeText('```mermaid\n' + h.data + '```\n');
    handed('Mermaid copied, paste it into a README', h);
  });
  const savePng = attempt('Export', async () => download(`${baseName(doc.name)}.png`, await exportPng(exportInput(), 2)));
  const saveSlide = attempt('Export', async () => download(`${baseName(doc.name)}-slide.png`, await exportSlide(exportInput())));
  const savePptx = attempt('Export', async () => {
    const { blob, small } = await exportPptx(exportInput(), yamlName(doc.name));
    download(`${baseName(doc.name)}.pptx`, blob);
    // Every slide is checked for text too small to read from the back of a room.
    if (small.length) notify(`${count(small.length, 'slide')} with text under 9 pt (${small.map((t) => `slide ${t.slide}: ${t.smallestPt} pt`).join(', ')}): split into views, or Tidy for the page`, { tone: 'error' });
  });
  const pageName = (result?.page ?? drawn?.page)?.name ?? '16:9 slide';
  const savePageSvg = attempt('Export', async () => download(`${baseName(doc.name)}-page.svg`, await exportPageSvg(exportInput()), 'image/svg+xml'));
  const savePdf = attempt('Export', async () => download(`${baseName(doc.name)}.pdf`, await exportPdf(exportInput(), yamlName(doc.name))));
  const copySvg = attempt('Copy', async () => {
    await navigator.clipboard.writeText(await svgNow());
    notify('SVG copied');
  });
  // A share link carries the diagram in its #fragment, which never reaches a server.
  const copyShare = attempt('Share', async () => {
    const link = await shareLink({ yaml: editor.current?.text() ?? text, name: doc.name, layout: pins, ...(brand().choice && themes[brand().choice] ? { theme: brand().choice } : {}) }, location.origin + location.pathname);
    if (link.length > SHARE_LIMIT) {
      notify(`Too large for a link: ${Math.ceil(link.length / 1000)} kB where ${SHARE_LIMIT / 1000} kB is the most links safely carry. Share the YAML file instead.`, { tone: 'error' });
      return;
    }
    await navigator.clipboard.writeText(link);
    const away = result?.includes?.length ? ` It does not carry ${result.includes.length === 1 ? 'the included file' : `the ${result.includes.length} included files`}.` : '';
    notify(`Share link copied: it opens read-only, and the diagram travels in the link itself, nothing was uploaded.${away}`);
  });
  const copyPng = attempt('Copy', async () => {
    // Safari wants the ClipboardItem created right in the click, with the PNG still on its way.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportPng(exportInput(), 2) })]);
    notify('PNG copied, paste it into slides or docs');
  });

  // ------------------------------------------------------------ selection

  const pathOf = useCallback(
    (s: Selection | undefined): Path | undefined => {
      const g = result?.graph ?? drawn?.graph;
      if (!s || !g) return undefined;
      return (s.kind === 'node' ? g.nodes.find((n) => n.id === s.id) : s.kind === 'group' ? g.groups.find((x) => x.id === s.id) : g.edges.find((e) => e.id === s.id))?.path;
    },
    [result?.graph, drawn?.graph],
  );

  const select = (s: Selection | undefined, reveal = true) => {
    setSelected(s);
    if (s) setInspector(true);
    const e = s && current && entries.find((x) => x.kind === s.kind && x.id === s.id);
    if (e && reveal) editor.current?.reveal(e.from, e.to);
  };
  /** Shift-click: in or out of the selection. */
  const toggle = (s: Selection) => {
    setInspector(true);
    setSelection((prev) => (prev.some((x) => x.kind === s.kind && x.id === s.id) ? prev.filter((x) => x.kind !== s.kind || x.id !== s.id) : [...prev, s]));
  };
  const selectMany = (list: Selection[], add: boolean) => {
    setInspector(true);
    setSelection((prev) => (add ? [...prev, ...list.filter((s) => !prev.some((x) => x.kind === s.kind && x.id === s.id))] : list));
  };
  const onCursor = (pos: number) => {
    if (!current) return;
    // A selection made in the drawing stays when a builder edit moves the cursor; typing takes over.
    if (selection.length > 1 && !document.activeElement?.closest('.cm-editor')) return;
    const e = entryAt(entries, pos);
    setSelected((s) => (e ? (s?.kind === e.kind && s.id === e.id ? s : { kind: e.kind, id: e.id }) : undefined));
  };

  // ------------------------------------------------------------ builder

  /** Applies a text edit (and optionally new pins) as one undo step. */
  const apply = (next: string | undefined, nextPins?: LayoutSidecar | null) => {
    if (next == null) return notify('That change did not work on this YAML: fix the problems in the editor, or make it there', { tone: 'error' });
    editor.current?.replace(next, { pins: nextPins === undefined ? undefined : (withViewPins(pins, drawn?.view, nextPins) ?? null) });
    acted();
  };
  /** Changes only pins (of the view drawn), as one undo step. */
  const pinTo = (next: LayoutSidecar | null | undefined) => {
    editor.current?.pin(withViewPins(pins, drawn?.view, next));
    acted();
  };
  /** Pins with nodes (and groups) moved, or unpinned with undefined; null when nothing is pinned any more. */
  const withPins = (movedNodes: Record<string, Point | undefined>, movedGroups: Record<string, Point | undefined> = {}): LayoutSidecar | null => {
    const nodes = { ...(vpins?.nodes ?? {}) };
    const groups = { ...(vpins?.groups ?? {}) };
    const set = (target: Record<string, Point>, moved: Record<string, Point | undefined>) => {
      for (const [id, at] of Object.entries(moved)) {
        if (at) target[id] = at;
        else delete target[id];
      }
    };
    set(nodes, movedNodes);
    set(groups, movedGroups);
    // Bent lines and locks stay as they are; a lock without its pin goes (it would hold nothing).
    const out: LayoutSidecar = { version: 1, ...(vpins?.edges ? { edges: vpins.edges } : {}) };
    if (Object.keys(nodes).length) out.nodes = nodes;
    if (Object.keys(groups).length) out.groups = groups;
    const keep = (vpins?.locked ?? []).filter((id) => nodes[id] || groups[id]);
    if (keep.length) out.locked = keep;
    return noted(out);
  };
  /** Unpins everything and draws the view from scratch: the automatic layout for the diagram as it is now. */
  const resetLayout = () => {
    setFresh((n) => n + 1);
    // Positions that were asked for stay asked for: the note is filled in again with the next save.
    if (vpins) pinTo(tracked ? { version: 1, layout: { at: '' } } : null);
    else acted();
  };
  /** Pins with one line's bends set (or reset with undefined). */
  const withEdge = (id: string, via: Point[] | undefined): LayoutSidecar | null => {
    const e = result?.graph?.edges.find((x) => x.id === id);
    const edges = { ...(vpins?.edges ?? {}) };
    if (via?.length && e) edges[id] = { via, from: e.from.node, to: e.to.node };
    else delete edges[id];
    const out: LayoutSidecar = { ...(vpins ?? {}), version: 1, edges };
    if (!Object.keys(edges).length) delete out.edges;
    return noted(out);
  };
  /** Pins with one node (or group) moved or unpinned; null when nothing is pinned any more. */
  const withPin = (id: string, at: Point | undefined, group = false): LayoutSidecar | null => (group ? withPins({}, { [id]: at }) : withPins({ [id]: at }));
 /** A moved group carries everything inside, including elements and groups that have their own pins. */
  const moveGroupPins = (id: string, at: Point): LayoutSidecar | null => {
    const graph = result?.graph;
    const box = result?.placed?.groups.get(id);
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const next = withPin(id, at, true);
    if (!graph || !box || !next) return next;
    const dx = at.x - (box.x + shift.x);
    const dy = at.y - (box.y + shift.y);
    const inside = new Set<string>();
    const walk = (g: string) => graph.groups.filter((c) => c.parent === g).forEach((c) => (inside.add(c.id), walk(c.id)));
    walk(id);
    const move = (p: Point) => ({ x: p.x + dx, y: p.y + dy });
    for (const n of graph.nodes) if (n.parent && (n.parent === id || inside.has(n.parent)) && next.nodes?.[n.id]) next.nodes[n.id] = move(next.nodes[n.id]!);
    for (const g of inside) if (next.groups?.[g]) next.groups[g] = move(next.groups[g]!);
    return next;
  };
  const pinCount = Object.keys(vpins?.nodes ?? {}).length + Object.keys(vpins?.groups ?? {}).length;
  const textNow = () => editor.current?.text() ?? text;
  /** Builder actions use the drawing's paths, so they wait for a drawing of the current text. */
  const ready = () => {
    if (result?.graph && current) return true;
    notify(result?.graph ? 'One moment: the drawing is catching up with the text' : 'Fix the problems in the YAML first', { tone: 'error' });
    return false;
  };
  /** Put the cursor in a field of the inspector once it shows this selection: on a busy machine that is more than one frame away. */
  const toInspector = (sel: Selection, field: string, select = false, tries = 60) => {
    const el = document.querySelector(`.inspector[data-selection="${CSS.escape(`${sel.kind}:${sel.id}`)}"] ${field}`) as HTMLInputElement | null;
    if (el) return select ? el.select() : el.focus();
    if (tries > 0) requestAnimationFrame(() => toInspector(sel, field, select, tries - 1));
  };
  const [pendingEdge, setPendingEdge] = useState<{ from: string; to: string; count: number }>();
  useEffect(() => {
    if (!pendingEdge || !result?.graph || !current) return;
    const edges = result.graph.edges;
    if (edges.length <= pendingEdge.count) return;
    const e = [...edges].reverse().find((x) => x.from.node === pendingEdge.from && x.to.node === pendingEdge.to);
    setPendingEdge(undefined);
    if (!e) return;
    setSelected({ kind: 'edge', id: e.id });
    setInspector(true);
    toInspector({ kind: 'edge', id: e.id }, '.field input:not([type="checkbox"])');
  }, [pendingEdge, result, current]);

  /** After an add, select the new element once it is drawn (node or group, whatever its type makes it). */
  const [pendingPath, setPendingPath] = useState<string>();
  useEffect(() => {
    if (!pendingPath || !result?.graph || !current) return;
    const n = result.graph.nodes.find((x) => JSON.stringify(x.path) === pendingPath);
    const g = result.graph.groups.find((x) => JSON.stringify(x.path) === pendingPath);
    if (n || g) {
      setSelected(n ? { kind: 'node', id: n.id } : { kind: 'group', id: g!.id });
      setInspector(true);
      toInspector(n ? { kind: 'node', id: n.id } : { kind: 'group', id: g!.id }, '.inspector-body > .field input', true);
    }
    setPendingPath(undefined);
  }, [pendingPath, result, current]);
  /** After a paste or a duplicate of several: select the copies once they are drawn. */
  const [pendingPaths, setPendingPaths] = useState<string[]>();
  useEffect(() => {
    if (!pendingPaths || !result?.graph || !current) return;
    const want = new Set(pendingPaths);
    setSelection([
      ...result.graph.nodes.filter((x) => want.has(JSON.stringify(x.path))).map((x) => ({ kind: 'node' as const, id: x.id })),
      ...result.graph.groups.filter((x) => want.has(JSON.stringify(x.path))).map((x) => ({ kind: 'group' as const, id: x.id })),
    ]);
    setPendingPaths(undefined);
  }, [pendingPaths, result, current]);

  const add = (item: PaletteItem, parentGroup?: string | null, at?: Point) => {
    setAdding(false);
    if (!type) return;
    const g = (parentGroup === undefined ? (selected?.kind === 'group' ? selected.id : undefined) : parentGroup) ?? undefined;
    const gp = g ? result?.graph?.groups.find((x) => x.id === g)?.path : undefined;
    // A selected element that can hold the new one (a capability, a manager) takes it in the same way as a group.
    const np = parentGroup === undefined && selected?.kind === 'node' ? result?.graph?.nodes.find((x) => x.id === selected.id)?.path : undefined;
    const holder = np && isEntryPath(np) && parentKey(type, item.collection, String(np[0])) ? { collection: String(np[0]), id: String(np.at(-1)) } : undefined;
    const parent = gp && gp.length === 2 && parentKey(type, item.collection, String(gp[0])) ? { collection: String(gp[0]), id: String(gp[1]) } : holder;
    const r = addEntry(textNow(), type, item, parent);
    if (!r) return apply(undefined);
    // Dropped at a point: it stays there, pinned as a node or, for a new group, by its top-left.
    const drawnAt = at && drawnAs(r.text, type, r.path);
    apply(r.text, at && drawnAt ? withPin(drawnAt.id, at, drawnAt.kind === 'group') : undefined);
    // The label is what people change first: selected and focused once it is drawn.
    setPendingPath(JSON.stringify(r.path));
  };

  /** Deletes the selection (or another element, e.g. a line from the inspector's connection list). */
  const remove = (sel: Selection | undefined = selected) => {
    const path = pathOf(sel);
    if (!path || !sel || !type || !ready()) return;
    // One arrow of a chain ("a -> b -> c"): the chain is cut there, the rest of it stays.
    if (sel.kind === 'edge' && isChainLine(textNow(), type, sel.id)) {
      const next = editChainLine(textNow(), type, sel.id);
      apply(next);
      if (next != null && sel === selected) setSelected(undefined);
      return;
    }
    // A line that stands for part of something bigger (a policy, a list) is changed in the YAML.
    const deletable = isEntryPath(path) || typeof path.at(-1) === 'number' || (sel.kind === 'edge' && isScalarAt(textNow(), path));
    if (!deletable) {
      notify('This one is part of a larger entry: change it in the YAML', { tone: 'error' });
      const e = entries.find((x) => x.kind === sel.kind && x.id === sel.id);
      if (e) editor.current?.reveal(e.from, e.to);
      return;
    }
    const next = deleteEntry(textNow(), type, path);
    const pinned = sel.kind === 'node' ? vpins?.nodes?.[sel.id] : sel.kind === 'group' ? vpins?.groups?.[sel.id] : undefined;
    apply(next, pinned ? withPin(sel.id, undefined, sel.kind === 'group') : undefined);
    if (next != null && sel === selected) setSelected(undefined);
  };

  const duplicate = () => {
    if (selection.length > 1) return paste(copy(false));
    const path = pathOf(selected);
    if (!path || !selected || path.length !== 2 || !ready()) return;
    const r = duplicateEntry(textNow(), path, type);
    if (!r) return apply(undefined);
    const box = result?.placed?.nodes.get(selected.id);
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    apply(r.text, box ? withPin(r.id, { x: Math.round(box.x + shift.x + 24), y: Math.round(box.y + shift.y + 24) }) : undefined);
    setSelected({ kind: selected.kind, id: r.id });
  };

  /** Deletes everything selected as one step; parts of larger entries stay (they are changed in the YAML). */
  const removeAll = () => {
    if (!type || !ready()) return;
    const t = textNow();
    const chain = selection.filter((s) => s.kind === 'edge' && isChainLine(t, type, s.id));
    const rest = selection.filter((s) => !chain.includes(s));
    const paths = rest.map(pathOf).filter((p): p is Path => !!p && (isEntryPath(p) || typeof p.at(-1) === 'number' || isScalarAt(t, p)));
    if (!paths.length && !chain.length) return notify('These are parts of larger entries: change them in the YAML', { tone: 'error' });
    // Arrows of chains and whole list items go together, last written first, so the places of the
    // others stay right; an arrow in an item that goes anyway is left alone.
    const place = (p: Path | undefined) => (typeof p?.at(-1) === 'number' ? (p.at(-1) as number) : -1);
    const items = paths.filter((p) => place(p) >= 0);
    const ops = [...items.map((p) => ({ at: place(p), path: p, id: '' })), ...chain.map((s) => ({ at: place(pathOf(s)), path: undefined, id: s.id }))];
    ops.sort((a, b) => b.at - a.at || Number(!!b.path) - Number(!!a.path) || b.id.localeCompare(a.id, undefined, { numeric: true }));
    let next: string | undefined = t;
    for (const op of ops) {
      if (next == null) break;
      if (op.path) next = deleteEntry(next, type, op.path);
      else if (!items.some((p) => place(p) === op.at)) next = editChainLine(next, type, op.id);
    }
    const others = paths.filter((p) => place(p) < 0);
    if (next != null && others.length) next = deleteEntries(next, type, others);
    const gone = (kind: 'node' | 'group') => Object.fromEntries(selection.filter((s) => s.kind === kind).map((s) => [s.id, undefined]));
    const unpinned = vpins && selection.some((s) => (s.kind === 'node' ? vpins.nodes?.[s.id] : s.kind === 'group' ? vpins.groups?.[s.id] : undefined));
    const nextPins = unpinned ? withPins(gone('node'), gone('group')) : undefined;
    apply(next, nextPins);
    if (next != null) {
      setSelection([]);
      if (paths.length < rest.length) notify(`Deleted ${paths.length + chain.length}; ${rest.length - paths.length} that are part of larger entries stayed`);
    }
  };

  /** Copies the selected entries (with the lines between them) to the app's clipboard. */
  const copy = (announce = true): Clip | undefined => {
    if (!type || !ready()) return undefined;
    const clip = copyEntries(textNow(), type, selection.map(pathOf).filter((p): p is Path => !!p));
    if (!clip) {
      if (announce) notify('Nothing to copy: select shapes or groups', { tone: 'error' });
      return undefined;
    }
    clipboard = clip;
    if (announce) notify(`Copied ${clip.entries.length} ${clip.entries.length === 1 ? 'element' : 'elements'}`);
    return clip;
  };
  /** Pastes under new ids, selected afterwards, as one undo step. The copies are not pinned: the layout gives
   * them a free spot, where a fixed offset would put them over the originals or inside a group they are not in. */
  const paste = (clip: Clip | undefined = clipboard) => {
    if (!clip || !type || !ready()) return;
    if (clip.type !== type.id) return notify(`That was copied from another kind of diagram (${typeName(clip.type)})`, { tone: 'error' });
    const r = pasteEntries(textNow(), type, clip);
    if (!r) return apply(undefined);
    apply(r.text);
    setPendingPaths(r.paths.map((p) => JSON.stringify(p)));
  };

  // ------------------------------------------------------------ labels in place

  /** The label field of an entry: what the drawing shows as its name. */
  const labelField = (path: Path) => {
    const f = type && fieldsFor(textNow(), type, path).find((x) => x.kind === 'text' && ['label', 'title', 'name'].includes(x.key));
    return f && f.kind === 'text' ? f : undefined;
  };
  const labelOf = (t: LabelTarget): string | undefined => {
    if (!type || !current) return undefined;
    if (t.kind === 'title' || t.kind === 'subtitle') return String((result?.graph as { title?: string; subtitle?: string } | undefined)?.[t.kind] ?? '');
    const path = pathOf(t as Selection);
    if (!path) return undefined;
    if (t.kind === 'edge') {
      if (isChainLine(textNow(), type, t.id)) return result?.graph?.edges.find((x) => x.id === t.id)?.label ?? '';
      const f = path[0] === 'edges' && typeof path[1] === 'number' ? edgeFields(textNow(), type, path).find((x) => x.key === 'label') : undefined;
      return f?.kind === 'text' ? f.value : undefined;
    }
    if (!isEntryPath(path)) return undefined;
    const f = labelField(path);
    if (!f) return undefined;
    const n = t.kind === 'node' ? result?.graph?.nodes.find((x) => x.id === t.id) : undefined;
    const g = t.kind === 'group' ? result?.graph?.groups.find((x) => x.id === t.id) : undefined;
    return f.value || (n ? label(n) : g?.label) || '';
  };
  const onLabel = (t: LabelTarget, value: string) => {
    if (!type || !ready()) return;
    if (t.kind === 'title' || t.kind === 'subtitle') return apply(setField(textNow(), type, [], t.kind, value));
    const path = pathOf(t as Selection);
    if (!path) return;
    if (t.kind === 'edge') return apply(isChainLine(textNow(), type, t.id) ? editChainLine(textNow(), type, t.id, value) : setEdgeField(textNow(), path, 'label', value));
    const f = labelField(path);
    if (!f) return;
    // A step or a state is its name: typing another one renames it wherever it is written. Only a
    // name the YAML cannot hold as a key (a colon, an arrow) becomes a label on the entry.
    if (type.freeNames && !f.value && value.trim()) {
      const renamed = renameEntry(textNow(), type, path, value.trim());
      if (renamed != null) return apply(renamed);
    }
    apply(setField(textNow(), type, path, f.key, value));
  };

  const rename = (to: string): boolean => {
    const path = pathOf(selected);
    if (!path || !selected) return false;
    if (!type) return false;
    const next = renameEntry(textNow(), type, path, to);
    if (next == null) return false;
    const old = String(path.at(-1));
    const nodeId = selected.id.endsWith(old) ? selected.id.slice(0, -old.length) + to : selected.id;
    // Pins of the element and of what is drawn for it ("dev:policy:0") move to the new id.
    const rekey = (k: string) => (k === selected.id ? nodeId : k.startsWith(`${selected.id}:`) ? nodeId + k.slice(selected.id.length) : k);
    const moved = vpins?.nodes && Object.keys(vpins.nodes).some((k) => rekey(k) !== k);
    apply(next, moved ? { ...vpins, nodes: Object.fromEntries(Object.entries(vpins!.nodes!).map(([k, v]) => [rekey(k), v])) } : undefined);
    setSelected({ kind: selected.kind, id: nodeId });
    return true;
  };

  /** Where the selected nodes go when `id` moves to `at`: all by the same distance. */
  const movedWith = (id: string, at: Point): Record<string, Point> => {
    const many = selection.length > 1 && selection.some((s) => s.kind === 'node' && s.id === id);
    const box = result?.placed?.nodes.get(id);
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    if (!many || !box) return { [id]: at };
    const dx = at.x - (box.x + shift.x);
    const dy = at.y - (box.y + shift.y);
    const out: Record<string, Point> = {};
    for (const s of selection) {
      const b = s.kind === 'node' && !locked.has(s.id) ? result?.placed?.nodes.get(s.id) : undefined;
      if (b) out[s.id] = { x: Math.round(b.x + shift.x + dx), y: Math.round(b.y + shift.y + dy) };
    }
    out[id] = at;
    return out;
  };

  const move = (id: string, at: Point, done: boolean, group?: string | null) => {
    const moved = movedWith(id, at);
    if (!done) return setDraft({ nodes: moved });
    setDraft(undefined);
    const nextPins = withPins(moved);
    // Moving and changing group are one step: one undo puts both back.
    const reparented = group !== undefined ? reparent(id, group) : undefined;
    if (reparented) {
      apply(reparented.text, nextPins);
      notify(reparented.message);
    } else pinTo(nextPins);
  };

  /** The text with a node moved into a group (or out of all), if its type can say so. */
  const reparent = (id: string, group: string | null): { text: string; message: string } | undefined => {
    const path = pathOf({ kind: 'node', id });
    if (!type || !path || path.length !== 2) return undefined;
    const graph = result?.graph;
    const g = group ? graph?.groups.find((x) => x.id === group) : undefined;
    const parentId = graph?.nodes.find((n) => n.id === id)?.parent;
    const was = parentId ? graph?.groups.find((x) => x.id === parentId) : undefined;
    const key = parentKey(type, String(path[0]), String((g ?? was)?.path[0] ?? ''));
    if (!key || (g && g.path.length !== 2)) return undefined;
    const text = setField(textNow(), type, path, key, g ? String(g.path[1]) : undefined);
    return text == null ? undefined : { text, message: g ? `Moved into ${g.label}` : 'Moved out of its group' };
  };

  const connect = (from: string, to: string) => {
    if (!type || !ready()) return;
    const r = connectEntries(textNow(), type, from, to);
    if ('error' in r) return notify(r.error, { tone: 'error' });
    apply(r.text);
    notify(`Connected ${nodeName(from)} to ${nodeName(to)}`);
    // The new line is selected once drawn, with its label ready to type.
    setPendingEdge({ from, to, count: result?.graph?.edges.length ?? 0 });
  };

  const nudge = (dx: number, dy: number) => {
    if (!current) return;
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const moved: Record<string, Point> = {};
    for (const s of selection) {
      const box = s.kind === 'node' && !locked.has(s.id) ? result?.placed?.nodes.get(s.id) : undefined;
      if (box) moved[s.id] = { x: Math.round(box.x + shift.x + dx), y: Math.round(box.y + shift.y + dy) };
    }
    if (Object.keys(moved).length) pinTo(withPins(moved));
    else if (selection.some((s) => locked.has(s.id))) notify('Locked: unlock it first (⇧⌘L)');
  };

  /** Aligns or distributes the selected shapes (locked ones stay put and others line up with them), as one undo step. */
  const arrangeSelection = (op: ArrangeOp) => {
    if (!current) return;
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const boxes = selection.flatMap((s) => {
      const b = s.kind === 'node' ? result?.placed?.nodes.get(s.id) : undefined;
      return b ? [[s.id, { ...b, x: b.x + shift.x, y: b.y + shift.y }] as [string, typeof b]] : [];
    });
    const need = op.startsWith('distribute') ? 3 : 2;
    if (boxes.length < need) return notify(`Select ${need} or more shapes first`, { tone: 'error' });
    const moved = Object.fromEntries(Object.entries(arrange(boxes, op)).filter(([id]) => !locked.has(id)));
    if (!Object.keys(moved).length) return;
    // The ones already in line are pinned too: unpinned, the layout would push them out of the others' way.
    const stay = Object.fromEntries(boxes.filter(([id]) => !moved[id] && !vpins?.nodes?.[id]).map(([id, b]) => [id, { x: Math.round(b.x), y: Math.round(b.y) }]));
    pinTo(withPins({ ...stay, ...moved }));
  };

  /** Locks the selected nodes and groups where they are (pinning them), or unlocks them when all are locked. */
  const toggleLock = () => {
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const items = selection.filter((s) => s.kind !== 'edge' && (s.kind === 'node' ? result?.placed?.nodes.has(s.id) : result?.placed?.groups.has(s.id)));
    if (!items.length || !current) return;
    const unlock = items.every((s) => locked.has(s.id));
    const at = (s: Selection) => {
      const b = (s.kind === 'node' ? result?.placed?.nodes : result?.placed?.groups)!.get(s.id)!;
      return { x: Math.round(b.x + shift.x), y: Math.round(b.y + shift.y) };
    };
    const pinned = (s: Selection) => (s.kind === 'node' ? vpins?.nodes?.[s.id] : vpins?.groups?.[s.id]);
    const next = unlock ? withPins({}) : withPins(
      Object.fromEntries(items.filter((s) => s.kind === 'node' && !pinned(s)).map((s) => [s.id, at(s)])),
      Object.fromEntries(items.filter((s) => s.kind === 'group' && !pinned(s)).map((s) => [s.id, at(s)])),
    );
    const ids = new Set(items.map((s) => s.id));
    const list = unlock ? [...locked].filter((id) => !ids.has(id)) : [...new Set([...locked, ...ids])];
    const out: LayoutSidecar = { ...(next ?? { version: 1 }), locked: list };
    if (!list.length) delete out.locked;
    pinTo(noted(out));
    notify(unlock ? `Unlocked ${count(items.length, 'element')}` : `Locked ${count(items.length, 'element')}: it stays where it is`);
  };

  /** ⌥ arrows: the selection moves to the nearest element in that direction. */
  const focusToward = (dir: Direction) => {
    const pl = result?.placed;
    if (!pl) return;
    const from = selected && (selected.kind === 'node' ? pl.nodes.get(selected.id) : selected.kind === 'group' ? pl.groups.get(selected.id) : undefined);
    if (!from) return void cycle(1);
    const all: [string, typeof from][] = [...pl.nodes].filter(([id]) => id !== selected!.id);
    const id = nearestToward(from, all, dir);
    if (id) select({ kind: 'node', id });
  };

  /** Tab order: elements, then groups, then lines. */
  const cycle = (dir: 1 | -1): boolean => {
    const g = result?.graph;
    if (!g) return false;
    const all: Selection[] = [
      ...g.nodes.map((n) => ({ kind: 'node' as const, id: n.id })),
      ...g.groups.filter((x) => result?.placed?.groups.has(x.id)).map((x) => ({ kind: 'group' as const, id: x.id })),
      ...g.edges.map((e) => ({ kind: 'edge' as const, id: e.id })),
    ];
    const i = selected ? all.findIndex((s) => s.kind === selected.kind && s.id === selected.id) : -1;
    const next = i + dir;
    if (next < 0 || next >= all.length) return false;
    select(all[next]);
    return true;
  };

  const onCanvasKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    if (mod(e) && e.key.toLowerCase() === 'z') e.shiftKey ? editor.current?.redo() : editor.current?.undo();
    else if (mod(e) && e.key.toLowerCase() === 'y') editor.current?.redo();
    else if (mod(e) && e.key.toLowerCase() === 'd') duplicate();
    else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === 'c') copy();
    else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === 'v') paste();
    else if (mod(e) && !e.shiftKey && e.key.toLowerCase() === 'a') selectMany([...(result?.graph?.nodes ?? []).map((n) => ({ kind: 'node' as const, id: n.id }))], false);
    else if (e.key === 'Delete' || e.key === 'Backspace') selection.length > 1 ? removeAll() : remove();
    else if (e.key === 'Escape') selection.length || !focusOn ? setSelection([]) : leaveFocus();
    else if (e.key.toLowerCase() === 'f' && !mod(e) && !e.altKey) focusOnSelection();
    else if ((e.key === '+' || e.key === '=' || e.key === '-') && !mod(e) && !e.altKey && drawn?.focus) focusHops(e.key === '-' ? -1 : 1);
    else if (e.key === 'd' && !mod(e) && !e.altKey && drawn?.focus) focusDirection();
    else if (arrangeKey(e)) arrangeSelection(arrangeKey(e)!);
    else if (craftKey(e) === 'lock') toggleLock();
    else if (craftKey(e) === 'grid' || craftKey(e) === 'minimap') craft.toggle(craftKey(e) as 'grid' | 'minimap');
    else if (e.altKey && e.key.startsWith('Arrow')) focusToward(e.key.slice(5).toLowerCase() as Direction);
    else if ((e.key === '[' || e.key === ']') && !mod(e)) stepBy(e.key === ']' ? 1 : -1);
    else if (e.key === 's' && !mod(e) && !e.altKey) addStepFromSelection();
    else if (e.key === 'v' && !mod(e) && !e.altKey) nextView();
    else if (e.key === 'ArrowLeft') nudge(-step, 0);
    else if (e.key === 'ArrowRight') nudge(step, 0);
    else if (e.key === 'ArrowUp') nudge(0, -step);
    else if (e.key === 'ArrowDown') nudge(0, step);
    else if (e.key === 'Tab' && !mod(e)) {
      if (!cycle(e.shiftKey ? -1 : 1)) return;
    } else if (e.key === 'a' && !mod(e) && !e.altKey) addShape();
    else if (e.key === 'c' && !mod(e) && !e.altKey && selected?.kind === 'node') setModal('connect');
    else if (e.key === 'F2' && selected) (document.querySelector('.inspector-body > .field input') as HTMLInputElement | null)?.select();
    else if (e.key === 'Enter' && selected) (document.querySelector('.inspector input, .inspector select') as HTMLElement | null)?.focus();
    else return;
    e.preventDefault();
  };

  // ------------------------------------------------------------ links and views

  /** This diagram's path in its folder (or under examples/): links to other diagrams are relative to it. */
  const here = ws && doc.path ? doc.path : doc.starter?.startsWith('example:') ? doc.starter.slice('example:'.length) : undefined;

  /** Follows a link: a URL in a new tab, another view here, or another diagram (and view) next to this one. */
  const follow = (link: Link) => {
    const t = linkTarget(link, here);
    if (t.kind === 'url') return void window.open(t.url, '_blank', 'noopener');
    if (t.kind === 'none') return notify(t.why, { tone: 'error' });
    if (t.kind === 'view') return setPicked({ doc: docId, name: t.view });
    if (ws && doc.path) {
      if (!ws.files.has(t.path)) return notify(`There is no ${t.path} in ${ws.name}`, { tone: 'error' });
      setPicked({ doc: t.path, name: t.view });
      return void openInFolder(ws, t.path);
    }
    const s = starters.find((x) => x.id === `example:${t.path}`);
    if (!s) return notify(`There is no example ${t.path}`, { tone: 'error' });
    setPicked({ doc: s.id, name: t.view });
    void pick(s);
  };

  // ------------------------------------------------------------ views

  /** The views to pick from, in the picker's order: as written first where there is such a drawing. */
  const viewList = (): (string | undefined)[] => (drawn?.views?.length ? [...(drawn.onlyViews ? [] : [undefined]), ...drawn.views.map((v) => v.name)] : []);
  const viewTitle = (name?: string) => (name === undefined ? 'as written' : (drawn?.views?.find((v) => v.name === name)?.title ?? name));
  const showView = (name: string | undefined) => {
    setPicked({ doc: docId, name });
    notify(`View: ${viewTitle(name)}`);
  };
  /**
   * V: the next view of the diagram; the YAML stays as it is. Views the type draws itself (data products
   * overview and detailed) go round without "as written", which is one of them: the one in `view:`.
   */
  /** Only views the type draws itself (no model `views:`, nothing included): as written is one of them. */
  const ownViews = !!type?.views && !!drawn?.views?.length && !drawn.onlyViews && !/^(views|include):/m.test(textNow());
  /** The view drawn: one picked, else for a type with views of its own the one in its `view:` (or its first). */
  const viewNow = () => viewName ?? (ownViews ? (drawn!.views!.find((v) => v.name === /^view:[ \t]*([\w-]+)/m.exec(textNow())?.[1]) ?? drawn!.views![0]!).name : undefined);
  const nextView = () => {
    const list = ownViews ? viewList().slice(1) : viewList();
    if (list.length < 2) return notify('This diagram has one view');
    const now = viewNow();
    showView(list[(list.indexOf(now) + 1) % list.length]);
  };
  /** A view the type draws itself (data products overview or detailed) written as the diagram's `view:`. */
  const ownView = !!viewName && !!type?.views && !!(type.schema as { properties?: Record<string, unknown> }).properties?.view && drawn?.view === viewName;
  const keepView = () => {
    if (!type || !viewName) return;
    apply(setField(textNow(), type, [], 'view', viewName));
    setPicked(undefined);
  };

  // ------------------------------------------------------------ focus

  /** A focus is drawn, or one of the YAML is switched off: there is a way back. */
  const focusOn = focusAsked !== undefined || !!drawn?.focus?.written;
  const setFocus = (focus: NonNullable<typeof lens>['focus'] | undefined) => setLens(focus === undefined ? undefined : { doc: docId, view: viewName, focus });
  /** Esc: out of a focus set here; a focus the YAML has is switched off, and on again. */
  const leaveFocus = () => setFocus(focusAsked !== undefined ? undefined : drawn?.focus?.written ? null : undefined);
  /** F: the drawing cut down to the selection and what is around it. In a focus, that walks on to a neighbour. */
  const focusOnSelection = () => {
    const g = drawn?.graph;
    if (!g) return;
    if (!selection.length) return focusOn ? leaveFocus() : notify('Select what to focus on, then press F');
    const ends = (id: string) => g.edges.filter((e) => e.id === id).flatMap((e) => [e.from.node, e.to.node]);
    const on = [...new Set(selection.flatMap((x) => (x.kind === 'edge' ? ends(x.id) : [x.id])))];
    if (!on.length) return;
    const now = drawn?.focus;
    setFocus({ on, hops: !now ? 1 : now.hops === Infinity ? 'all' : now.hops, direction: now?.direction ?? 'both' });
  };
  const refocus = (change: (now: Focus) => Partial<Pick<Focus, 'hops' | 'direction'>>) => {
    const now = drawn?.focus;
    if (!now) return notify('No focus yet: select something and press F');
    const next = { hops: now.hops, direction: now.direction, ...change(now) };
    setFocus({ on: now.on, hops: next.hops === Infinity ? 'all' : next.hops, direction: next.direction });
  };
  const focusHops = (by: 1 | -1) => refocus((now) => ({ hops: hopsBy(now.hops, by) }));
  const focusDirection = () => refocus((now) => ({ direction: nextDirection(now.direction) }));
  // A drawing that is one shape (a sequence, a roadmap) has nothing to walk from: say so and stay on the whole.
  useEffect(() => {
    if (!focusAsked || !result?.svg || result.focus || rendered?.text !== text) return;
    const why = result.diagnostics.find((d) => d.message.startsWith('Focus'));
    setLens(undefined);
    notify(why ? why.message.replace(/^Focus: /, '') : 'Nothing to focus on there');
  }, [result]);

  // ------------------------------------------------------------ steps and presenting

  const stepList = drawn?.steps ?? [];
  /** Steps somebody wrote: PowerPoint and PDF get a slide or page for each. */
  const written = stepList.length > 0 && !drawn?.stepsImplied;
  const pickStep = (n: number | undefined) => setStepAt(n ? { doc: docId, view: viewName, n } : undefined);
  /** [ and ]: through the steps, and past the last one back to the whole drawing. */
  const stepBy = (dir: 1 | -1) => {
    if (!stepList.length) return notify('No steps yet: select what a step is about and press S');
    pickStep(((drawn?.step ?? 0) + dir + stepList.length + 1) % (stepList.length + 1) || undefined);
  };
  /** A step edit as one undo step; without text the YAML could not take it. */
  const editSteps = (next: string | undefined, show?: number) => {
    if (next == null) return notify(drawn?.view ? `The steps of ${drawn.view} are not written in this file, or its YAML has problems: change them there` : 'That change did not work on these steps: make it in the YAML', { tone: 'error' });
    apply(next);
    if (show) pickStep(show);
  };
  /** S: a new step after the one shown, with the selection as its focus. */
  const addStepFromSelection = () => {
    const g = drawn?.graph;
    if (!ready() || !g) return;
    if (drawn?.stepsImplied) return notify(g.steps?.length ? 'This view is told by its numbered lines already' : 'A sequence diagram is told message by message already');
    const edgeOf = (id: string) => g.edges.find((e) => e.id === id);
    const focus = selection.flatMap((x) => (x.kind !== 'edge' ? [x.id] : edgeOf(x.id) ? [`${edgeOf(x.id)!.from.node} -> ${edgeOf(x.id)!.to.node}`] : []));
    const names = selection.map((x) => (x.kind === 'node' ? nodeName(x.id) : x.kind === 'group' ? (g.groups.find((y) => y.id === x.id)?.label ?? x.id) : edgeOf(x.id) ? `${nodeName(edgeOf(x.id)!.from.node)} to ${nodeName(edgeOf(x.id)!.to.node)}` : x.id));
    const n = (drawn?.step ?? stepList.length) + 1;
    const next = addStep(textNow(), stepsPath(drawn?.view), { title: names.length === 1 ? names[0]! : names.length === 2 ? names.join(' and ') : `Step ${n}`, focus }, drawn?.step);
    editSteps(next, n);
    if (next) setNaming(n);
  };
  const present = () => {
    if (!drawn?.svg) return notify('Nothing to present yet: fix the problems in the YAML first', { tone: 'error' });
    setModal(undefined);
    setPresenting(true);
  };
  /** Another diagram for a link followed while presenting: from the open folder, or the bundled examples. */
  const presentOther = (path: string): PresentDoc | undefined => {
    const file = path.split('/').pop();
    if (ws && doc.path) {
      const hit = ws.files.get(path);
      return hit && { text: hit.text, path, file, sidecar: readSidecar(ws, path), load: folderLoader(ws, path) };
    }
    const s = starters.find((x) => x.id === `example:${path}`);
    return s && { text: s.text, path, file, load: exampleLoader(s.id) };
  };

  // ------------------------------------------------------------ inspector

  const selectedPath = pathOf(selected);
  const selNode = selected?.kind === 'node' ? (result ?? drawn)?.graph?.nodes.find((n) => n.id === selected.id) : undefined;
  const selGroup = selected?.kind === 'group' ? (result ?? drawn)?.graph?.groups.find((g) => g.id === selected.id) : undefined;
  const selEdge = selected?.kind === 'edge' ? (result ?? drawn)?.graph?.edges.find((e) => e.id === selected.id) : undefined;
  const isEntry = !!selectedPath && isEntryPath(selectedPath) && selected?.kind !== 'edge';
  const isEdgeItem = !!selectedPath && selectedPath[0] === 'edges' && typeof selectedPath[1] === 'number';
  /** One arrow of a chain ("a -> b -> c" in a process): its label is the one thing to set. */
  const isChain = !!type && selected?.kind === 'edge' && isChainLine(text, type, selected.id);
  const fields = useMemo(
    () =>
      type && selectedPath
        ? isChain
          ? [{ key: 'label', kind: 'text' as const, label: 'Label', value: selEdge?.label ?? '', hint: type.lines?.hint }]
          : isEntry
            ? fieldsFor(text, type, selectedPath)
            : isEdgeItem
              ? edgeFields(text, type, selectedPath)
              : []
        : [],
    [type, isEntry, isEdgeItem, isChain, selEdge?.label, selectedPath, text],
  );
  const showInspector = !!(selected && inspector && type && (selNode || selGroup || selEdge)) || (selection.length > 1 && inspector);
  /** A diagram with nothing in it yet: the canvas says how to start. */
  const empty = !!result?.graph && current && !result.graph.nodes.length && !result.graph.groups.length;
  const quick = useMemo(() => {
    const items = type?.palette ?? [];
    // Shapes first (not containers), then whatever there is.
    return [...items.filter((i) => i.collection !== 'groups'), ...items.filter((i) => i.collection === 'groups')].slice(0, 4);
  }, [type]);
  const kindLabel = (path: Path | undefined) => (path ? String(path[0]).replace(/ies$/, 'y').replace(/s$/, '').replace(/-/g, ' ') : '');
  const nodeName = (id: string) => {
    const n = result?.graph?.nodes.find((x) => x.id === id);
    return n ? label(n) : id;
  };
  /** The focused element as a screen reader says it: name, kind, and whether it is pinned or locked. */
  const describe = (s: Selection) => {
    const g = result?.graph;
    const e = s.kind === 'edge' ? g?.edges.find((x) => x.id === s.id) : undefined;
    const name = s.kind === 'node' ? nodeName(s.id) : s.kind === 'group' ? (g?.groups.find((x) => x.id === s.id)?.label ?? s.id) : e ? `Line from ${nodeName(e.from.node)} to ${nodeName(e.to.node)}${e.label ? `, ${e.label}` : ''}` : s.id;
    const kind = s.kind === 'edge' ? '' : `, ${kindLabel(pathOf(s)) || s.kind}`;
    const state = locked.has(s.id) ? ', locked' : (s.kind === 'node' ? vpins?.nodes?.[s.id] : s.kind === 'group' ? vpins?.groups?.[s.id] : bent.has(s.id)) ? (s.kind === 'edge' ? ', bent by hand' : ', pinned') : '';
    return `${name}${kind}${state}`;
  };

  // ------------------------------------------------------------ commands

  /** What the last import or export said, while its document is open. */
  const shownNotes = notes?.doc === doc.name ? notes : undefined;
  const buildCommands = (): Command[] => [
    { id: 'new', group: 'File', label: 'New diagram…', hint: 'template, then AI, builder or YAML', icon: 'file-plus', run: () => setModal('templates') },
    view === 'visual'
      ? { id: 'view-code', group: 'View', label: 'Show the YAML', icon: 'code', shortcut: '⌘\\', run: () => setView('code') }
      : { id: 'view-visual', group: 'View', label: 'Build visually (hide the YAML)', icon: 'mouse-pointer-2', shortcut: '⌘\\', run: () => setView('visual') },
    { id: 'open', group: 'File', label: 'Open file…', hint: 'a diagram; data products and contracts; az, Graph, AzureHound or gh api JSON; draw.io, Excalidraw or Mermaid to import', icon: 'folder-open', shortcut: '⌘O', run: openFile },
    { id: 'save', group: 'File', label: ws && doc.path ? `Save ${doc.path}` : 'Save', icon: 'save', shortcut: '⌘S', run: saveYaml },
    { id: 'download', group: 'File', label: 'Download YAML', icon: 'download', run: downloadYaml },
    ...(canUseFolders ? [{ id: 'folder', group: 'File', label: 'Open folder…', icon: 'folder-open', run: () => void openFolder() }] : []),
    ...(ws && meshInWs ? [{ id: 'mesh', group: 'File', label: `Data mesh map of ${ws.name}`, hint: 'its data products and contracts (ODPS, ODCS) in data-mesh.yaml', icon: 'waypoints', run: () => void leave().then((ok) => ok && meshInFolder(ws)) }] : []),
    ...(ws && exportInWs ? [{ id: 'export', group: 'File', label: EXPORT_ENTRY[exportInWs].label(ws.name), hint: EXPORT_ENTRY[exportInWs].hint, icon: EXPORT_ENTRY[exportInWs].icon, run: () => void leave().then((ok) => ok && exportInFolder(ws)) }] : []),
    ...(ws ? diagrams(ws).map((p) => ({ id: `file:${p}`, group: `Files in ${ws.name}`, label: p, icon: 'file-code', run: () => void openInFolder(ws, p) })) : []),
    ...(pins ? [{ id: 'save-layout', group: 'File', label: 'Save layout (.layout.json)', icon: 'save', run: saveLayout }] : []),
    { id: 'svg', group: 'Export', label: 'Export SVG', icon: 'download', shortcut: '⌘E', run: saveSvg },
    { id: 'png', group: 'Export', label: 'Export PNG (2×)', icon: 'image', shortcut: '⇧⌘E', run: savePng },
    { id: 'slide', group: 'Export', label: `PNG on the page (${pageName})`, icon: 'monitor', run: saveSlide },
    { id: 'page-svg', group: 'Export', label: `SVG on the page (${pageName})`, icon: 'monitor', run: savePageSvg },
    { id: 'pptx', group: 'Export', label: written ? 'PowerPoint slides, one per step (.pptx)' : 'PowerPoint slide (.pptx)', icon: 'layout-template', run: savePptx },
    { id: 'pdf', group: 'Export', label: written ? 'Export PDF, a page per step' : 'Export PDF', icon: 'file-text', run: savePdf },
    { id: 'copy-png', group: 'Export', label: 'Copy as PNG', icon: 'copy', run: copyPng },
    { id: 'copy-svg', group: 'Export', label: 'Copy as SVG', icon: 'copy', run: copySvg },
    { id: 'svg-safe', group: 'Export', label: safeSvg ? 'SVG as drawn (Office-safe SVG off)' : 'Office-safe SVG on', hint: 'for PowerPoint, Word and Keynote', icon: 'monitor', run: toggleSafeSvg },
    { id: 'drawio', group: 'Export', label: 'Export for draw.io (.drawio)', hint: 'editable shapes, every view a page', icon: 'workflow', run: saveDrawio },
    { id: 'excalidraw', group: 'Export', label: 'Export for Excalidraw (.excalidraw)', icon: 'square-dashed', run: saveExcalidraw },
    { id: 'mermaid', group: 'Export', label: 'Export Mermaid (.mmd)', icon: 'file-code', run: saveMermaid },
    { id: 'share', group: 'Export', label: 'Copy share link', hint: 'read-only, the diagram travels in the link', icon: 'link', run: copyShare },
    { id: 'copy-mermaid', group: 'Export', label: 'Copy as Mermaid', hint: 'a fenced block for a README', icon: 'copy', run: copyMermaid },
    { id: 'present', group: 'Present', label: 'Present full screen', hint: stepList.length ? `${count(stepList.length, 'step')}` : drawn?.views?.length ? 'its views in order' : 'step by step', icon: 'play', shortcut: 'P', run: present },
    ...(type && !drawn?.stepsImplied
      ? [{ id: 'step-add', group: 'Present', label: selection.length ? 'Add a step from the selection' : 'Add a step', hint: 'what is selected stands out in it', icon: 'plus', shortcut: 'S', run: addStepFromSelection }]
      : []),
    ...(stepList.length
      ? [
          { id: 'step-next', group: 'Present', label: 'Next step', icon: 'layers', shortcut: ']', run: () => stepBy(1) },
          { id: 'step-previous', group: 'Present', label: 'Previous step', icon: 'layers', shortcut: '[', run: () => stepBy(-1) },
          ...(drawn?.step ? [{ id: 'step-none', group: 'Present', label: 'Show the whole drawing', hint: 'no step', icon: 'layers', run: () => pickStep(undefined) }] : []),
          ...stepList.map((x, i) => ({ id: `step:${i + 1}`, group: 'Steps', label: `${i + 1}. ${x.title ?? x.caption ?? 'Step'}`, hint: x.title ? x.caption : undefined, icon: 'layers', run: () => pickStep(i + 1) })),
        ]
      : []),
    { id: 'undo', group: 'Edit', label: 'Undo', icon: 'undo-2', shortcut: '⌘Z', run: () => editor.current?.undo() },
    { id: 'redo', group: 'Edit', label: 'Redo', icon: 'redo-2', shortcut: '⇧⌘Z', run: () => editor.current?.redo() },
    ...(vpins || drawnLayout?.held ? [{ id: 'reset', group: 'Edit', label: 'Reset layout (unpin everything)', icon: 'pin-off', run: resetLayout }] : []),
    ...arrangeCommands(arrangeSelection),
    { id: 'lock', group: 'Arrange', label: selection.length && selection.every((s) => locked.has(s.id)) ? 'Unlock the selection' : 'Lock the selection in place', icon: 'lock', shortcut: '⇧⌘L', run: toggleLock },
    ...(selected?.kind === 'edge' && bent.has(selected.id) ? [{ id: 'reset-line', group: 'Arrange', label: 'Reset line (route it automatically)', icon: 'route', run: () => pinTo(withEdge(selected.id, undefined)) }] : []),
    { id: 'zoom-fit', group: 'View', label: 'Zoom to fit', icon: 'maximize', shortcut: '⇧1', run: () => previewControl.current?.fit() },
    ...viewList()
      .filter((v) => v !== viewName)
      .map((v) => ({ id: `view-${v ?? 'as-written'}`, group: 'View', label: v === undefined ? 'Show the diagram as written' : `Show the ${viewTitle(v)} view`, hint: 'the YAML stays as it is', icon: 'layers', run: () => showView(v) })),
    ...(viewList().length > 1 ? [{ id: 'view-next', group: 'View', label: 'Next view', hint: `now ${viewTitle(viewName)}`, icon: 'layers', shortcut: 'V', run: nextView }] : []),
    ...(ownView ? [{ id: 'view-keep', group: 'View', label: `Write view: ${viewName} into the YAML`, hint: 'so it opens like this', icon: 'save', run: keepView }] : []),
    { id: 'zoom-selection', group: 'View', label: 'Zoom to selection', icon: 'focus', shortcut: '⇧2', run: () => previewControl.current?.zoomToSelection() },
    { id: 'focus', group: 'Focus', label: selection.length === 1 && selected && selected.kind !== 'edge' ? `Focus on ${selected.kind === 'node' ? nodeName(selected.id) : (drawn?.graph?.groups.find((g) => g.id === selected.id)?.label ?? selected.id)}` : 'Focus on the selection', hint: 'only it and what is around it', icon: 'focus', shortcut: 'F', run: focusOnSelection },
    ...(drawn?.focus
      ? [
          { id: 'focus-more', group: 'Focus', label: 'Focus: one hop more', hint: drawn.focus.hops === Infinity ? 'everything connected is shown' : `now ${drawn.focus.hops}`, icon: 'plus', shortcut: '+', run: () => focusHops(1) },
          { id: 'focus-fewer', group: 'Focus', label: 'Focus: one hop fewer', icon: 'minus', shortcut: '−', run: () => focusHops(-1) },
          { id: 'focus-direction', group: 'Focus', label: 'Focus: both ways, upstream or downstream', hint: `now ${drawn.focus.direction}`, icon: 'arrow-left-right', shortcut: 'D', run: focusDirection },
        ]
      : []),
    ...(focusOn ? [{ id: 'focus-leave', group: 'Focus', label: drawn?.focus ? (drawn.focus.written ? 'Show everything (the YAML has a focus)' : 'Leave the focus') : 'Back to the focus of the YAML', icon: drawn?.focus ? 'x' : 'focus', shortcut: 'Esc', run: leaveFocus }] : []),
    { id: 'grid', group: 'View', label: craft.grid ? 'Stop snapping to the grid' : 'Snap to the 8px grid', icon: 'grid-3x3', shortcut: '⇧G', run: () => craft.toggle('grid') },
    { id: 'minimap', group: 'View', label: craft.minimap ? 'Hide the minimap' : 'Show the minimap', icon: 'map', shortcut: '⇧M', run: () => craft.toggle('minimap') },
    { id: 'theme-light', group: 'View', label: 'Light theme', icon: 'sun', run: () => setPref('light') },
    { id: 'theme-dark', group: 'View', label: 'Dark theme', icon: 'moon', run: () => setPref('dark') },
    { id: 'theme-system', group: 'View', label: 'Theme follows system', icon: 'monitor', run: () => setPref('system') },
    { id: 'shortcuts', group: 'View', label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', run: () => setTimeout(() => setModal('shortcuts')) },
    { id: 'problems', group: 'View', label: 'Show problems', hint: shownNotes ? `and ${shownNotes.items.length} from the import` : undefined, icon: 'circle-exclamation-point', run: () => setModal('problems') },
    ...(type?.palette ?? []).map((item, i) => ({ id: `add:${i}`, group: 'Add', label: item.label, hint: item.collection, icon: item.icon, run: () => add(item) })),
    ...(selected?.kind === 'node'
      ? [{ id: 'connect', group: 'Edit', label: `Connect ${nodeName(selected.id)} to…`, icon: 'arrow-right-from-line', shortcut: 'C', run: () => setTimeout(() => setModal('connect')) }]
      : []),
    ...(result?.graph?.groups ?? []).map((g) => ({ id: `group:${g.id}`, group: 'Go to', label: g.label, hint: g.caption ?? g.id, icon: g.icon ?? 'square-dashed', run: () => select({ kind: 'group', id: g.id }) })),
    ...(result?.graph?.nodes ?? []).map((n) => ({ id: `node:${n.id}`, group: 'Go to', label: label(n), hint: n.id, icon: iconOf(n) ?? 'box', run: () => select({ kind: 'node', id: n.id }) })),
    ...starters.map((s) => ({
      id: `starter:${s.id}`,
      group: 'Start from',
      label: s.title,
      hint: `${s.kind === 'template' ? 'Template' : 'Example'} · ${typeName(s.type)}`,
      icon: 'layout-template',
      run: () => void pick(s),
    })),
    ...[...new Set(starters.map((s) => s.type))].map((t) => ({
      id: `blank:${t}`,
      group: 'Start from',
      label: `Blank ${typeName(t).toLowerCase()}`,
      hint: 'empty diagram',
      icon: 'file-plus',
      run: () => {
        setModal(undefined);
        fileHandle.current = undefined;
        open(blankText(t), { name: `${t}.yaml` }, undefined, true);
        focusDrawing();
      },
    })),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F6 moves between the editor, the drawing and the properties, like panes in other apps.
      if (e.key === 'F6') {
        const panes = ['.cm-content', '.preview', '.inspector input, .inspector select'].map((q) => document.querySelector(q) as HTMLElement | null).filter((x): x is HTMLElement => !!x?.offsetParent);
        const at = panes.findIndex((p) => p.contains(document.activeElement) || p === document.activeElement || (p.closest('.inspector') && p.closest('.inspector')!.contains(document.activeElement)));
        panes[(at + (e.shiftKey ? panes.length - 1 : 1)) % panes.length]?.focus();
        return e.preventDefault();
      }
      // "?" opens the shortcuts, unless someone is typing.
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-content');
      if (e.key === '?' && !typing && !modal) {
        setModal('shortcuts');
        return e.preventDefault();
      }
      // "P" presents, from anywhere but a text field.
      if (e.key.toLowerCase() === 'p' && !typing && !modal && !mod(e) && !e.altKey && !e.ctrlKey && !e.metaKey) {
        present();
        return e.preventDefault();
      }
      if (e.defaultPrevented || e.altKey || !mod(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'k' && !e.shiftKey) setModal((m) => (m === 'palette' ? undefined : 'palette'));
      else if (k === 's' && !e.shiftKey) saveYaml();
      else if (k === 'o' && !e.shiftKey) openFile();
      else if (k === 'e') e.shiftKey ? savePng() : saveSvg();
      else if (e.key === '\\') setView(view === 'visual' ? 'code' : 'visual');
      else return;
      e.preventDefault();
    };
    // ⌘↩ presents too, also while typing YAML: caught before the editor takes it for a new line.
    const onPresentKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !mod(e) || e.shiftKey || e.altKey || modal || presenting) return;
      e.preventDefault();
      e.stopPropagation();
      present();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onPresentKey, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onPresentKey, true);
    };
  });

  // Splitter between editor and drawing, by pointer or arrow keys.
  const dragSplit = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setSplit(Math.min(0.7, Math.max(0.2, ev.clientX / window.innerWidth)));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const closeModal = () => {
    setModal(undefined);
    setIncoming(undefined);
    setGuiding(false);
    store.set('started', true);
  };
  /** A: the popup over the drawing, or in the builder view the shapes panel that is already open. */
  function addShape() {
    const search = view === 'visual' ? (document.querySelector('.shapes input') as HTMLInputElement | null) : null;
    if (search) search.focus();
    else setAdding((a) => !a);
  }
  const typeId = type?.id;
  return (
    <div
      className={hint && !adding && !modal ? 'app with-hint' : 'app'}
      style={{ ['--split' as string]: `${split * 100}%`, ['--hint-h' as string]: `${hintHeight}px` }}
      onDragOverCapture={onDragFiles}
      onDragLeaveCapture={(e) => e.relatedTarget == null && setDropping(false)}
      onDropCapture={onDropFiles}
    >
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          Cartography
        </div>
        <div className="doc-name">
          <Icon name="file-code" />
          <span>{ws && doc.path ? `${ws.name}/${doc.path}` : doc.name}</span>
          {dirty && <span className="dirty" title="Unsaved changes (⌘S saves)" aria-label="Unsaved changes" />}
          {type && (
            <div className="menu-anchor type-anchor">
              <button className="type-pill" onClick={() => setTypeCard((o) => !o)} title={type.tagline} aria-expanded={typeCard} aria-haspopup="menu">
                {type.name}
              </button>
              {typeCard && (
                <Menu onClose={() => setTypeCard(false)}>
                  <div className="type-card-pop">
                    <strong>
                      <Icon name={type.icon ?? 'layout-template'} size={15} /> {type.name}
                    </strong>
                    {type.tagline && <p>{type.tagline}</p>}
                  </div>
                  <button role="menuitem" onClick={() => (setTypeCard(false), setGuiding(true), setModal('templates'))}>
                    <Icon name="circle-question-mark" /> Which type do I need?
                  </button>
                  <p className="type-card-fine">Also in docs/types.md and <code>carto types</code></p>
                </Menu>
              )}
            </div>
          )}
        </div>
        <div className="actions">
          {canUseFolders && !ws && remembered && (
            <button className="button ghost wide-only" onClick={() => void openFolder(remembered)} title="Open the last folder again">
              <Icon name="folder-open" /> {remembered.name}
            </button>
          )}
          {canUseFolders && (
            <button className="button ghost wide-only" onClick={() => void openFolder()} title="Open a folder with diagrams">
              <Icon name="folder-open" /> {ws ? 'Folder' : 'Open folder'}
            </button>
          )}
          <div className="segmented view-switch" role="radiogroup" aria-label="Way of working">
            <button role="radio" aria-checked={view === 'visual'} className={view === 'visual' ? 'active' : ''} onClick={() => setView('visual')} title="Build visually (⌘\\)">
              <Icon name="mouse-pointer-2" /> Builder
            </button>
            <button role="radio" aria-checked={view === 'code'} className={view === 'code' ? 'active' : ''} onClick={() => setView('code')} title="YAML and drawing side by side (⌘\\)">
              <Icon name="code" /> YAML
            </button>
          </div>
          <button className="button ghost wide-only" onClick={() => setModal('templates')}>
            <Icon name="file-plus" /> New
          </button>
          <button className="button ghost wide-only" onClick={() => setModal('palette')} title="Command palette">
            <Icon name="search" /> Commands <kbd>⌘K</kbd>
          </button>
          {/* On a phone the actions above fold into one menu. */}
          <div className="menu-anchor narrow-only">
            <button className="icon-button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-haspopup="menu" aria-label="More actions">
              <span className="more-dots" aria-hidden="true">⋯</span>
            </button>
            {more && (
              <Menu onClose={() => setMore(false)}>
                <button role="menuitem" onClick={() => (setMore(false), setModal('templates'))}>
                  <Icon name="file-plus" /> New diagram
                </button>
                <button role="menuitem" onClick={() => (setMore(false), setModal('palette'))}>
                  <Icon name="search" /> Commands
                </button>
                {canUseFolders && (
                  <button role="menuitem" onClick={() => (setMore(false), void openFolder())}>
                    <Icon name="folder-open" /> Open folder
                  </button>
                )}
                <button role="menuitem" onClick={() => (setMore(false), setPref(theme === 'dark' ? 'light' : 'dark'))}>
                  <Icon name={theme === 'dark' ? 'sun' : 'moon'} /> {theme === 'dark' ? 'Light' : 'Dark'} theme
                </button>
              </Menu>
            )}
          </div>
          <BrandMenu ws={ws} onError={(m) => notify(m, { tone: 'error' })} />
          <button
            className="icon-button wide-only"
            onClick={() => setPref(theme === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="Toggle theme"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <div className="menu-anchor">
            <button className="button primary" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
              <Icon name="download" /> Export <Icon name="chevron-down" size={14} />
            </button>
            {menu && (
              <Menu onClose={() => setMenu(false)}>
                <button role="menuitem" onClick={saveSvg}>
                  <Icon name="download" /> {safeSvg ? 'SVG, Office-safe' : 'SVG'} <kbd>⌘E</kbd>
                </button>
                <button role="menuitem" onClick={savePng}>
                  <Icon name="image" /> PNG 2× <kbd>⇧⌘E</kbd>
                </button>
                <button role="menuitem" onClick={saveSlide}>
                  <Icon name="monitor" /> PNG on the page ({pageName})
                </button>
                <button role="menuitem" onClick={savePageSvg}>
                  <Icon name="monitor" /> SVG on the page ({pageName})
                </button>
                <button role="menuitem" onClick={savePptx}>
                  <Icon name="layout-template" /> {written ? 'PowerPoint slides, one per step (.pptx)' : 'PowerPoint slide (.pptx)'}
                </button>
                <button role="menuitem" onClick={savePdf}>
                  <Icon name="file-text" /> {written ? 'PDF, a page per step' : 'PDF'}
                </button>
                <hr />
                <button role="menuitem" onClick={copyPng}>
                  <Icon name="copy" /> Copy as PNG
                </button>
                <button role="menuitem" onClick={copySvg}>
                  <Icon name="copy" /> Copy as SVG
                </button>
                <button
                  role="menuitemcheckbox"
                  aria-checked={safeSvg}
                  title="SVG without what PowerPoint, Word and Keynote drop: no CSS or effects, system fonts, one group per node"
                  onClick={(e) => {
                    // A switch: the menu stays open, the SVG rows above follow it.
                    e.stopPropagation();
                    toggleSafeSvg();
                  }}
                >
                  <Icon name={safeSvg ? 'check' : 'square'} /> Office-safe SVG
                </button>
                <hr />
                <button role="menuitem" onClick={saveDrawio}>
                  <Icon name="workflow" /> draw.io (.drawio)
                </button>
                <button role="menuitem" onClick={saveExcalidraw}>
                  <Icon name="square-dashed" /> Excalidraw (.excalidraw)
                </button>
                <button role="menuitem" onClick={saveMermaid}>
                  <Icon name="file-code" /> Mermaid (.mmd)
                </button>
                <button role="menuitem" onClick={copyMermaid}>
                  <Icon name="copy" /> Copy as Mermaid
                </button>
                <hr />
                <button role="menuitem" onClick={copyShare} title="The diagram goes in the link itself: nothing is uploaded">
                  <Icon name="link" /> Copy share link
                </button>
                <hr />
                <button role="menuitem" onClick={saveYaml}>
                  <Icon name="save" /> Save <kbd>⌘S</kbd>
                </button>
                <button role="menuitem" onClick={downloadYaml}>
                  <Icon name="download" /> Download YAML
                </button>
                {pins && (
                  <button role="menuitem" onClick={saveLayout}>
                    <Icon name="pin" /> Save layout
                  </button>
                )}
              </Menu>
            )}
          </div>
        </div>
      </header>

      <nav className="pane-tabs" role="tablist" aria-label="Show">
        <button role="tab" aria-selected={pane === 'yaml'} onClick={() => setPane('yaml')}>
          <Icon name="file-code" /> YAML
        </button>
        <button role="tab" aria-selected={pane === 'drawing'} onClick={() => setPane('drawing')}>
          <Icon name="image" /> Drawing
        </button>
      </nav>
      <main className={`workspace view-${view}${showInspector ? ' with-inspector' : ''}${ws ? ' with-files' : ''} show-${pane}`}>
        {ws && (
          <nav className="files" aria-label={`Diagrams in ${ws.name}`}>
            <header>
              <Icon name="folder-open" size={14} /> {ws.name}
            </header>
            {diagrams(ws).map((p) => (
              <button key={p} className={doc.path === p ? 'file active' : 'file'} onClick={() => void openInFolder(ws, p)} title={p} aria-current={doc.path === p}>
                <Icon name="file-code" size={14} />
                <span>{p}</span>
                {doc.path === p && dirty && <span className="dirty" />}
              </button>
            ))}
            {diagrams(ws).length === 0 && <p className="files-empty">No diagrams yet. Start from a template, then save.</p>}
          </nav>
        )}
        {view === 'visual' && type && (
          <aside className="shapes" aria-label="Shapes">
            <AddMenu inline items={type.palette} onAdd={(item) => add(item)} onClose={focusDrawing} />
          </aside>
        )}
        <section className="pane editor-pane" aria-label="YAML">
          <Editor
            ref={editor}
            initial={text}
            initialPins={pins}
            diagnostics={diagnostics}
            source={rendered?.text}
            mark={mark}
            onChange={onChange}
            onCursor={onCursor}
            onPins={(p) => {
              setPins(p);
              // A move also ends the "undo open" offer: undoing the open would lose it.
              if (openedText.current != null) {
                openedText.current = null;
                setToast((t) => (t?.action?.label === 'Undo' ? undefined : t));
              }
            }}
          />
        </section>
        <div
          className="splitter"
          onPointerDown={dragSplit}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize editor"
          aria-valuemin={20}
          aria-valuemax={70}
          aria-valuenow={Math.round(split * 100)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0.2, s - 0.02));
            else if (e.key === 'ArrowRight') setSplit((s) => Math.min(0.7, s + 0.02));
          }}
        />
        <section className={`pane canvas-pane${stepList.length ? ' with-steps' : ''}`} aria-label="Drawing">
          <Preview
            result={drawn}
            stale={!!rendered && drawn !== result}
            selection={selection}
            docKey={`${rendered?.docKey ?? -1}:${drawn?.view ?? ''}:${drawn?.focus ? `${drawn.focus.on.join(' ')} ${drawn.focus.hops} ${drawn.focus.direction}` : ''}`}
            onSelect={(s, add) => (add && s ? toggle(s) : select(s))}
            onSelectMany={selectMany}
            labelOf={labelOf}
            onLabel={onLabel}
            onMove={move}
            onConnect={connect}
            onMoveGroup={(id, at, done) => {
              if (!done) return setDraft({ groups: { [id]: at } });
              setDraft(undefined);
              pinTo(moveGroupPins(id, at));
            }}
            onDragCancel={() => setDraft(undefined)}
            canConnect={(id) => {
              const path = pathOf({ kind: 'node', id });
              // A type that writes its own lines says what can be joined (a start dot has no entry of its own).
              const entry = !!path && (type?.lines ? true : path.length === 2 && typeof path[1] === 'string');
              return !!type && !type.unconnected && entry && (!!type.connect || !!(type.schema as { properties?: { edges?: unknown } }).properties?.edges);
            }}
            canDrop={(group, what) => {
              const g = result?.graph?.groups.find((x) => x.id === group);
              if (!type || !g || g.path.length !== 2) return false;
              const collection = what.palette != null ? type.palette[what.palette]?.collection : String(pathOf({ kind: 'node', id: what.node! })?.[0] ?? '');
              return !!collection && !!parentKey(type, collection, String(g.path[0]));
            }}
            onPaletteDrop={(i, at, group, refused) => {
              const item = type?.palette[i];
              if (!item) return;
              add(item, group, at);
              if (refused) notify(`${item.label} cannot go in ${result?.graph?.groups.find((g) => g.id === refused)?.label ?? refused}: placed outside it`);
            }}
            onKeyDown={onCanvasKey}
            locked={locked}
            bent={bent}
            grid={craft.grid}
            minimap={craft.minimap}
            onToggle={craft.toggle}
            control={previewControl}
            describe={describe}
            onBend={(id, via, done) => {
              const e = result?.graph?.edges.find((x) => x.id === id);
              if (!done) return setDraft({ edges: { [id]: { via, from: e?.from.node, to: e?.to.node } } });
              setDraft(undefined);
              pinTo(withEdge(id, via));
            }}
            onFollow={(s) => {
              const g = drawn?.graph;
              const links = s.kind === 'node' ? g?.nodes.find((n) => n.id === s.id)?.links : s.kind === 'group' ? g?.groups.find((x) => x.id === s.id)?.links : undefined;
              if (!links?.length) return false;
              follow(links[0]!);
              return true;
            }}
          >
            <div className="canvas-top">
            <div className="canvas-tools" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
              <button className={adding ? 'tool active' : 'tool'} onClick={addShape} title="Add a shape (A)" aria-expanded={adding} disabled={!type}>
                <Icon name="plus" /> Add <kbd>A</kbd>
              </button>
              <button className="tool" onClick={() => editor.current?.undo()} title="Undo (⌘Z)" aria-label="Undo">
                <Icon name="undo-2" />
              </button>
              <button className="tool" onClick={() => editor.current?.redo()} title="Redo (⇧⌘Z)" aria-label="Redo">
                <Icon name="redo-2" />
              </button>
              {(vpins || drawnLayout?.held) && (
                <button className="tool" onClick={resetLayout} title="Unpin everything and draw again from scratch: back to the automatic layout" aria-label="Reset layout">
                  <Icon name="pin-off" />
                </button>
              )}
              <ViewPicker views={drawn?.views} value={drawn?.view} asWritten={!drawn?.onlyViews} onChange={(name) => setPicked({ doc: docId, name })} />
              <button className={drawn?.focus ? 'tool active' : 'tool'} onClick={focusOnSelection} title="Focus: only what is selected and what is around it (F)" disabled={!selection.length && !focusOn}>
                <Icon name="focus" /> Focus <kbd>F</kbd>
              </button>
              {!stepList.length && (
                <button className="tool" onClick={addStepFromSelection} title="A step to present: what is selected stands out in it (S)" disabled={!type}>
                  <Icon name="layers" /> Step <kbd>S</kbd>
                </button>
              )}
              <button className="tool" onClick={present} title="Present full screen, step by step (P or ⌘↩)" disabled={!drawn?.svg}>
                <Icon name="play" /> Present <kbd>P</kbd>
              </button>
            </div>
            {!adding && <FocusChip focus={drawn?.focus} off={focusAsked === null && !!drawn?.focusWritten} onHops={focusHops} onDirection={focusDirection} onLeave={leaveFocus} />}
            {/* Notes about the drawing go on a row of their own under the tools, never under them. */}
            {!!rendered && !!drawn?.svg && drawn !== result && (
              <div className="canvas-note">
                <div className="stale-note" role="status">
                  <Icon name="circle-exclamation-point" size={14} /> Showing the last version that worked: fix the problems in the editor
                </div>
              </div>
            )}
            </div>
            {hint && !adding && !modal && (
              <div className="hint" role="note" ref={(el) => void (el && el.offsetHeight !== hintHeight && setHintHeight(el.offsetHeight))}>
                <span>
                  {view === 'visual' ? (
                    <>
                      Drag shapes onto the drawing or into a group, drag the dot on a shape to connect it, double-click to rename. <kbd>?</kbd> shows all keys.
                    </>
                  ) : (
                    <>
                      Edit the YAML (<kbd>Tab</kbd> indents two spaces; <kbd>Esc</kbd> <kbd>Tab</kbd> or <kbd>F6</kbd> leaves it), or build here: <kbd>A</kbd> adds a shape, drag the dot on a shape to connect it, <kbd>?</kbd> shows all keys.
                    </>
                  )}
                </span>
                <button className="icon-button small" onClick={dismissHint} aria-label="Dismiss hint">
                  <Icon name="x" size={14} />
                </button>
              </div>
            )}
            {empty && type && !adding && (
              <div className="canvas-empty">
                <p>
                  <strong>Drag a shape here</strong> or press <kbd>A</kbd>
                </p>
                <div className="chips inline">
                  {quick.map((item) => (
                    <button key={item.collection + item.kind} className="chip" onClick={() => add(item)}>
                      <Icon name={item.icon} size={14} /> {item.label}
                    </button>
                  ))}
                </div>
                <p className="fine">Double-click the title to name the diagram.</p>
              </div>
            )}
            {adding && type && (
              <AddMenu
                items={type.palette}
                onAdd={(item) => add(item)}
                onClose={() => {
                  setAdding(false);
                  (document.querySelector('.preview') as HTMLElement | null)?.focus();
                }}
              />
            )}
          </Preview>
          {stepList.length > 0 && (
            <StepsStrip
              steps={stepList}
              implied={drawn?.stepsImplied}
              value={drawn?.step}
              selected={selection.length}
              naming={current ? naming : undefined}
              onNamed={() => setNaming(undefined)}
              onPick={pickStep}
              onAdd={addStepFromSelection}
              onRename={(n, title) => editSteps(renameStep(textNow(), stepsPath(drawn?.view), n, title))}
              onMove={(n, to) => editSteps(moveStep(textNow(), stepsPath(drawn?.view), n, to), drawn?.step === n ? to : drawn?.step === to ? n : undefined)}
              onDelete={(n) => editSteps(deleteStep(textNow(), stepsPath(drawn?.view), n))}
            />
          )}
        </section>
            {selected && inspector && type && (selNode || selGroup || selEdge) && (
          <Inspector
            key={`${selected.kind}:${selected.id}`}
            selection={`${selected.kind}:${selected.id}`}
            id={isEntry ? String(selectedPath!.at(-1)) : selected.id}
            title={selNode ? label(selNode) : selGroup ? selGroup.label : selEdge ? `${nodeName(selEdge.from.node)} → ${nodeName(selEdge.to.node)}` : selected.id}
            icon={selNode ? iconOf(selNode) : selGroup ? selGroup.icon : 'arrow-right-from-line'}
            kindLabel={selEdge ? (selEdge.label ? `Line · ${selEdge.label}` : 'Line') : kindLabel(selectedPath)}
            fields={fields}
            renamable={isEntry}
            freeName={!!type.freeNames}
            pinned={selected.kind === 'node' ? !!vpins?.nodes?.[selected.id] : selected.kind === 'group' && !!vpins?.groups?.[selected.id]}
            locked={selected.kind === 'edge' ? undefined : locked.has(selected.id)}
            onLock={toggleLock}
            onResetLine={selected.kind === 'edge' && bent.has(selected.id) ? () => pinTo(withEdge(selected.id, undefined)) : undefined}
            links={(selNode ?? selGroup)?.links}
            onFollowLink={follow}
            onField={(key, value) =>
              type &&
              selectedPath &&
              apply(
                isChain
                  ? editChainLine(textNow(), type, selected.id, String(value ?? ''))
                  : isEdgeItem
                    ? setEdgeField(textNow(), selectedPath, key, value)
                    : setField(textNow(), type, selectedPath, key, value),
              )
            }
            onRename={rename}
            onReveal={() => {
              const e = entries.find((x) => x.kind === selected.kind && x.id === selected.id);
              if (e) editor.current?.reveal(e.from, e.to);
              editor.current?.focus();
            }}
            onDuplicate={isEntry ? duplicate : undefined}
            onMove={
              isEntry && type?.ordered?.[String(selectedPath![0])]
                ? {
                    earlier: canMove(text, type, selectedPath!, -1) ? () => apply(moveEntry(textNow(), type, selectedPath!, -1)) : undefined,
                    later: canMove(text, type, selectedPath!, 1) ? () => apply(moveEntry(textNow(), type, selectedPath!, 1)) : undefined,
                  }
                : undefined
            }
            onDelete={() => remove()}
            connections={
              selNode
                ? (result?.graph?.edges ?? [])
                    .filter((e) => e.from.node === selNode.id || e.to.node === selNode.id)
                    .map((e) => ({ id: e.id, out: e.from.node === selNode.id, other: nodeName(e.from.node === selNode.id ? e.to.node : e.from.node), label: e.label }))
                : undefined
            }
            onSelectEdge={(id) => select({ kind: 'edge', id })}
            onDeleteEdge={(id) => remove({ kind: 'edge', id })}
            onUnpin={() => {
              // Unpinning lets go of the lock too: there is no place left to hold it at.
              const next = withPin(selected.id, undefined, selected.kind === 'group');
              editor.current?.pin(withViewPins(pins, drawn?.view, next && { ...next, locked: next.locked?.filter((id) => id !== selected.id) }));
            }}
            onClose={() => setInspector(false)}
          />
        )}
        {selection.length > 1 && inspector && (
          <aside className="inspector" aria-label="Selection">
            <header>
              <span className="inspector-icon">
                <Icon name="mouse-pointer-2" />
              </span>
              <div className="inspector-title">
                <strong>{selection.length} selected</strong>
                <span>{(['node', 'group', 'edge'] as const)
                    .map((k) => [selection.filter((s) => s.kind === k).length, { node: 'shape', group: 'group', edge: 'line' }[k]] as const)
                    .filter(([n]) => n)
                    .map(([n, what]) => count(n, what))
                    .join(', ')}</span>
              </div>
              <button className="icon-button" onClick={() => setSelection([])} aria-label="Clear the selection" title="Clear (Esc)">
                <Icon name="x" />
              </button>
            </header>
            <div className="inspector-body">
              <ArrangeBar shapes={selection.filter((s) => s.kind === 'node').length} onArrange={arrangeSelection} />
              <p className="fine">
                Drag one to move them all, arrows nudge them, <kbd>⌘C</kbd> <kbd>⌘V</kbd> copies and pastes. Shift-click adds or removes one.
              </p>
            </div>
            <footer>
              <button className="button ghost" onClick={duplicate} title="Duplicate (⌘D)">
                <Icon name="copy" /> Duplicate
              </button>
              <button className="button ghost" onClick={toggleLock} title="Lock or unlock (⇧⌘L)">
                <Icon name={selection.every((s) => locked.has(s.id)) ? 'lock-open' : 'lock'} /> {selection.every((s) => locked.has(s.id)) ? 'Unlock' : 'Lock'}
              </button>
              <button className="button ghost danger" onClick={removeAll} title="Delete (⌫)">
                <Icon name="trash" /> Delete
              </button>
            </footer>
          </aside>
        )}
      </main>

      <footer className="statusbar">
        <button className={`status-problems${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`} onClick={() => setModal('problems')}>
          <Icon name={errors || warnings ? 'circle-exclamation-point' : 'check'} size={14} />
          {errors || warnings ? `${errors} error${errors === 1 ? '' : 's'}${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}` : 'No problems'}
        </button>
        {result?.graph && <span>{drawnCount(result.graph)}</span>}
        {pinCount > 0 && (
          <span className="status-selected">
            <Icon name="pin" size={13} /> {pinCount} pinned
          </span>
        )}
        {selection.length > 0 && (
          <span className="status-selected">
            <Icon name="mouse-pointer-2" size={13} /> {selected ? selected.id : `${selection.length} selected`}
          </span>
        )}
        <span className="spacer" />
        <button className="status-link" onClick={() => setModal('shortcuts')} title="Keyboard shortcuts">
          <Icon name="keyboard" size={13} /> ?
        </button>
        {rendered && <span>{rendered.ms} ms</span>}
        <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
      </footer>

      {presenting && <Present doc={{ text: textNow(), path: here, file: docFile, sidecar: pins, load }} theme={theme} view={drawn?.view ?? viewNow()} step={drawn?.step} focus={focusAsked} open={presentOther} onClose={() => setPresenting(false)} />}
      {modal === 'palette' && <Palette commands={buildCommands()} onClose={closeModal} />}
      {modal === 'connect' && selected?.kind === 'node' && (
        <Palette
          placeholder={`Connect ${nodeName(selected.id)} to…`}
          onClose={() => {
            closeModal();
            focusDrawing();
          }}
          commands={(result?.graph?.nodes ?? [])
            .filter((n) => n.id !== selected.id)
            .map((n) => ({ id: `to:${n.id}`, group: `Connect ${nodeName(selected.id)} to`, label: label(n), hint: n.id, icon: iconOf(n) ?? 'box', run: () => connect(selected.id, n.id) }))}
        />
      )}
      {modal === 'shortcuts' && <Shortcuts onClose={closeModal} />}
      {modal === 'templates' && <Start key={incoming?.name} theme={theme} incoming={incoming} current={guiding ? typeId : undefined} onOpen={start} onClose={closeModal} />}
      {modal === 'problems' && (
        <Palette
          placeholder={diagnostics.length || shownNotes ? 'Filter problems…' : 'No problems: everything draws'}
          onClose={closeModal}
          commands={[...diagnostics.map((d, i) => ({
            id: `p${i}`,
            group: d.severity === 'error' ? 'Errors' : 'Warnings',
            label: d.message,
            hint: d.line ? `line ${d.line}` : undefined,
            icon: 'circle-exclamation-point',
            run: () => {
              if (d.from != null && current) editor.current?.reveal(d.from, d.to ?? d.from);
              requestAnimationFrame(() => editor.current?.focus());
            },
          })), ...(shownNotes?.items.map((m, i) => ({ id: `n${i}`, group: shownNotes.title, label: m, icon: 'triangle-exclamation-point', run: () => {} })) ?? [])]}
        />
      )}
      {dropping && (
        <div className="drop-here" aria-hidden="true">
          <div>
            <Icon name="folder-open" size={22} />
            <strong>Drop to open</strong>
            <span>A diagram; data products and contracts (ODPS, ODCS); or a folder of az, Graph, AzureHound or gh api JSON: it becomes one diagram</span>
          </div>
        </div>
      )}
      {toast && (
        <div className={toast.tone === 'error' ? 'toast error' : 'toast'} role={toast.tone === 'error' ? 'alert' : 'status'}>
          {toast.message}
          {toast.action && (
            <button
              onClick={() => {
                toast.action!.run();
                setToast(undefined);
              }}
            >
              {toast.action.label}
            </button>
          )}
          {toast.more && (
            <button
              onClick={() => {
                toast.more!.run();
                setToast(undefined);
              }}
            >
              {toast.more.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

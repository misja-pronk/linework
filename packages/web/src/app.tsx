// The editor app: YAML on the left, the drawing on the right, both selecting the same element.
// Builder actions (inspector, palette, drag) are edits of the YAML text plus pins, all in the
// editor's one undo history.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { viewPins, withViewPins, type Diagnostic, type GraphNode, type LayoutSidecar, type Link, type PaletteItem, type Path, type Point } from '@cartography/core';
import { Editor, type EditorHandle } from './editor.tsx';
import { Preview, type LabelTarget, type Selection } from './preview.tsx';
import { Palette, type Command } from './palette.tsx';
import { Start, type Opened, type View } from './start.tsx';
import { Inspector } from './inspector.tsx';
import { AddMenu } from './add-menu.tsx';
import { Menu } from './menu.tsx';
import { Shortcuts } from './shortcuts.tsx';
import { Icon } from './icon.tsx';
import { useRender } from './use-render.ts';
import { ViewPicker } from './view-picker.tsx';
import { linkTarget } from './links.ts';
import { entryAt, entryRanges } from './ranges.ts';
import { blankText, exampleLoader, starters, typeName, type Starter } from './library.ts';
import { baseName, download, exportPng, exportSlide, exportSvg, yamlName } from './export.ts';
import { addEntry, connectEntries, copyEntries, deleteEntries, deleteEntry, duplicateEntry, pasteEntries, type Clip, edgeFields, fieldsFor, isScalarAt, parentKey, renameEntry, setEdgeField, setField } from './builder.ts';
import { store } from './store.ts';
import { BrandMenu } from './brand-menu.tsx';
import { canSaveFiles, canUseFolders, diagrams, diskText, folderLoader, lastFolder, pickFolder, readSidecar, reopen, saveAs, saveFile, saveInFolder, scan, type Workspace } from './files.ts';

type ThemePref = 'system' | 'light' | 'dark';

interface Doc {
  name: string;
  /** Where it came from, so bundled examples can read their contract files. */
  starter?: string;
  /** Path inside the open folder. */
  path?: string;
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
const label = (n: GraphNode) => (n.shape.kind === 'card' ? n.shape.label : n.shape.kind === 'table' ? n.shape.title : n.id);
const iconOf = (n: GraphNode) => (n.shape.kind === 'card' || n.shape.kind === 'table' ? n.shape.icon : 'table');

export function App() {
  const saved = useMemo(() => store.get<Saved>('doc'), []);
  const [text, setText] = useState(saved?.text ?? firstStarter.text);
  const [doc, setDoc] = useState<Doc>(saved?.doc ?? { name: firstStarter.file, starter: firstStarter.id });
  const [pins, setPins] = useState<LayoutSidecar | undefined>(saved?.pins);
  /** A node being dragged: its pin before it is committed to the history. */
  const [draft, setDraft] = useState<{ nodes?: Record<string, Point>; groups?: Record<string, Point> }>();
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
  const [modal, setModal] = useState<'palette' | 'templates' | 'problems' | 'connect' | 'shortcuts' | undefined>(() => (store.get('started') ? undefined : 'templates'));
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
  const [toast, setToast] = useState<{ message: string; tone?: 'error'; action?: { label: string; run(): void } }>();
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
    () => (ws && doc.path ? folderLoader(ws, doc.path) : doc.starter ? exampleLoader(doc.starter) : undefined),
    [ws, doc.path, doc.starter],
  );
  // Views: the one asked for (per document) and the one drawn (a diagram of only views draws its first).
  // Pins live per view in the sidecar; everything below works on the drawn view's pins.
  const docId = doc.path ?? doc.starter ?? doc.name;
  const [picked, setPicked] = useState<{ doc: string; name?: string }>();
  const viewName = picked?.doc === docId ? picked.name : undefined;
  const drawnView = useRef<string>(undefined);
  const sidecar = useMemo<LayoutSidecar | undefined>(() => {
    if (!draft) return pins;
    const v = viewPins(pins, drawnView.current);
    return withViewPins(pins, drawnView.current, { version: 1, nodes: { ...(v?.nodes ?? {}), ...draft.nodes }, groups: { ...(v?.groups ?? {}), ...draft.groups } });
  }, [pins, draft]);
  // Slow (big) diagrams wait a little longer between keystrokes, so typing stays smooth.
  const [renderMs, setRenderMs] = useState(0);
  const docFile = (doc.path ?? doc.starter ?? doc.name).split('/').pop();
  const rendered = useRender(useDebounced(text, Math.min(400, Math.max(40, renderMs * 1.5)), docKey), theme, sidecar, load, docKey, viewName, docFile);
  useEffect(() => {
    if (rendered) setRenderMs(rendered.ms);
  }, [rendered]);
  const result = rendered?.result;
  const drawn = rendered?.drawn;
  drawnView.current = drawn?.view;
  const vpins = viewPins(pins, drawn?.view);
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

  const notify = useCallback((message: string, opts: { tone?: 'error'; action?: { label: string; run(): void } } = {}) => setToast({ message, ...opts }), []);
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
    (next: string, nextDoc: Doc, nextPins?: LayoutSidecar, quiet = false) => {
      const before = { text: editor.current?.text() ?? text, doc, pins, handle: fileHandle.current, savedText, savedPins };
      editor.current?.load(next, nextPins);
      setDoc(nextDoc);
      setSelected(undefined);
      setDocKey((k) => k + 1);
      setSavedText(next);
      setSavedPins(JSON.stringify(nextPins ?? null));
      openedText.current = next;
      // Within a folder, files are saved before switching: nothing to undo. A blank start says nothing either.
      if (nextDoc.path || quiet) return;
      notify(`Opened ${nextDoc.name}`, {
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

  /** Before replacing the document: save it where it lives, or ask. False keeps it open. */
  const leave = async (): Promise<boolean> => {
    if (!dirty) return true;
    if ((ws && doc.path) || fileHandle.current) return save();
    return window.confirm(`${doc.name} has changes that are not saved in a file. Discard them?`);
  };

  const focusDrawing = () => requestAnimationFrame(() => (document.querySelector('.preview') as HTMLElement | null)?.focus({ preventScroll: true }));

  const pick = (s: Starter) => {
    setModal(undefined);
    fileHandle.current = undefined;
    open(s.text, { name: s.file, starter: s.id });
    focusDrawing();
  };

  /** From the start dialog: the chosen template or generated YAML, in the chosen way of working. */
  const start = (o: Opened) => {
    closeModal();
    fileHandle.current = undefined;
    setView(o.view);
    open(o.text, { name: o.name, starter: o.starter }, undefined, o.blank);
    if (o.view === 'code') requestAnimationFrame(() => editor.current?.focus());
    else focusDrawing();
  };

  /** Saves where the document lives: its folder, its file, or a new file. Returns false when cancelled. */
  const save = async (): Promise<boolean> => {
    const now = textNow();
    // All pins are kept: other views of the same file (access matrices, data-products overview) draw other things.
    const pinsToSave = pins;
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
          setDoc({ name: r.name });
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

  const openFile = () => {
    if ('showOpenFilePicker' in window) {
      void (async () => {
        try {
          const [h] = await (window as unknown as { showOpenFilePicker(o: object): Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
            types: [{ description: 'Cartography diagram', accept: { 'text/yaml': ['.yaml', '.yml'] } }],
          });
          const f = await h!.getFile();
          fileHandle.current = h;
          open(await f.text(), { name: f.name });
        } catch (e) {
          if ((e as Error).name !== 'AbortError') notify(`Opening failed: ${(e as Error).message}`, { tone: 'error' });
        }
      })();
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,text/yaml';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) open(await f.text(), { name: f.name });
    };
    input.click();
  };

  // ------------------------------------------------------------ export

  const exportInput = () => ({ text: editor.current?.text() ?? text, theme, load, sidecar: pins, view: viewName, file: docFile });
  const attempt = (what: string, run: () => Promise<void>) => () =>
    void run().catch((e: unknown) => notify(`${what} failed: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' }));
  const saveYaml = () => void save();
  const downloadYaml = () => download(yamlName(doc.name), editor.current?.text() ?? text, 'text/yaml');
  const saveLayout = () => pins && download(`${baseName(doc.name)}.layout.json`, JSON.stringify(pins, null, 2) + '\n', 'application/json');
  const saveSvg = attempt('Export', async () => download(`${baseName(doc.name)}.svg`, await exportSvg(exportInput()), 'image/svg+xml'));
  const savePng = attempt('Export', async () => download(`${baseName(doc.name)}.png`, await exportPng(exportInput(), 2)));
  const saveSlide = attempt('Export', async () => download(`${baseName(doc.name)}-slide.png`, await exportSlide(exportInput())));
  const copySvg = attempt('Copy', async () => {
    await navigator.clipboard.writeText(await exportSvg(exportInput()));
    notify('SVG copied');
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
    const out: LayoutSidecar = { version: 1 };
    if (Object.keys(nodes).length) out.nodes = nodes;
    if (Object.keys(groups).length) out.groups = groups;
    return out.nodes || out.groups ? out : null;
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
    requestAnimationFrame(() => (document.querySelector('.inspector .field input:not([type="checkbox"])') as HTMLInputElement | null)?.focus());
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
      requestAnimationFrame(() => (document.querySelector('.inspector .field:nth-child(2) input') as HTMLInputElement | null)?.select());
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
    const parent = gp && gp.length === 2 && parentKey(type, item.collection, String(gp[0])) ? { collection: String(gp[0]), id: String(gp[1]) } : undefined;
    const r = addEntry(textNow(), type, item, parent);
    if (!r) return apply(undefined);
    apply(r.text, at ? withPin(r.id, at) : undefined);
    // The label is what people change first: selected and focused once it is drawn.
    setPendingPath(JSON.stringify(r.path));
  };

  /** Deletes the selection (or another element, e.g. a line from the inspector's connection list). */
  const remove = (sel: Selection | undefined = selected) => {
    const path = pathOf(sel);
    if (!path || !sel || !type || !ready()) return;
    // A line that stands for part of something bigger (a policy, a list) is changed in the YAML.
    const deletable = (path.length === 2 && typeof path[1] === 'string') || typeof path.at(-1) === 'number' || (sel.kind === 'edge' && isScalarAt(textNow(), path));
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
    const r = duplicateEntry(textNow(), path);
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
    const paths = selection.map(pathOf).filter((p): p is Path => !!p && ((p.length === 2 && typeof p[1] === 'string') || typeof p.at(-1) === 'number' || isScalarAt(t, p)));
    if (!paths.length) return notify('These are parts of larger entries: change them in the YAML', { tone: 'error' });
    const next = deleteEntries(t, type, paths);
    const gone = (kind: 'node' | 'group') => Object.fromEntries(selection.filter((s) => s.kind === kind).map((s) => [s.id, undefined]));
    const unpinned = vpins && selection.some((s) => (s.kind === 'node' ? vpins.nodes?.[s.id] : s.kind === 'group' ? vpins.groups?.[s.id] : undefined));
    const nextPins = unpinned ? withPins(gone('node'), gone('group')) : undefined;
    apply(next, nextPins);
    if (next != null) {
      setSelection([]);
      if (paths.length < selection.length) notify(`Deleted ${paths.length}; ${selection.length - paths.length} that are part of larger entries stayed`);
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
      const f = path[0] === 'edges' && typeof path[1] === 'number' ? edgeFields(textNow(), type, path).find((x) => x.key === 'label') : undefined;
      return f?.kind === 'text' ? f.value : undefined;
    }
    if (path.length !== 2 || typeof path[1] !== 'string') return undefined;
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
    if (t.kind === 'edge') return apply(setEdgeField(textNow(), path, 'label', value));
    const f = labelField(path);
    if (f) apply(setField(textNow(), type, path, f.key, value));
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
      const b = s.kind === 'node' ? result?.placed?.nodes.get(s.id) : undefined;
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
      const box = s.kind === 'node' ? result?.placed?.nodes.get(s.id) : undefined;
      if (box) moved[s.id] = { x: Math.round(box.x + shift.x + dx), y: Math.round(box.y + shift.y + dy) };
    }
    if (Object.keys(moved).length) pinTo(withPins(moved));
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
    else if (e.key === 'Escape') setSelection([]);
    else if (e.key === 'ArrowLeft') nudge(-step, 0);
    else if (e.key === 'ArrowRight') nudge(step, 0);
    else if (e.key === 'ArrowUp') nudge(0, -step);
    else if (e.key === 'ArrowDown') nudge(0, step);
    else if (e.key === 'Tab' && !mod(e)) {
      if (!cycle(e.shiftKey ? -1 : 1)) return;
    } else if (e.key === 'a' && !mod(e) && !e.altKey) addShape();
    else if (e.key === 'c' && !mod(e) && !e.altKey && selected?.kind === 'node') setModal('connect');
    else if (e.key === 'F2' && selected) (document.querySelector('.inspector .field:nth-child(2) input') as HTMLInputElement | null)?.select();
    else if (e.key === 'Enter' && selected) (document.querySelector('.inspector input, .inspector select') as HTMLElement | null)?.focus();
    else return;
    e.preventDefault();
  };

  // ------------------------------------------------------------ links and views

  /** Follows a link: a URL in a new tab, another view here, or another diagram (and view) next to this one. */
  const follow = (link: Link) => {
    const here = ws && doc.path ? doc.path : doc.starter?.startsWith('example:') ? doc.starter.slice('example:'.length) : undefined;
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
    pick(s);
  };

  // ------------------------------------------------------------ inspector

  const selectedPath = pathOf(selected);
  const selNode = selected?.kind === 'node' ? (result ?? drawn)?.graph?.nodes.find((n) => n.id === selected.id) : undefined;
  const selGroup = selected?.kind === 'group' ? (result ?? drawn)?.graph?.groups.find((g) => g.id === selected.id) : undefined;
  const selEdge = selected?.kind === 'edge' ? (result ?? drawn)?.graph?.edges.find((e) => e.id === selected.id) : undefined;
  const isEntry = !!selectedPath && selectedPath.length === 2 && typeof selectedPath[1] === 'string';
  const isEdgeItem = !!selectedPath && selectedPath[0] === 'edges' && typeof selectedPath[1] === 'number';
  const fields = useMemo(
    () => (type && selectedPath ? (isEntry ? fieldsFor(text, type, selectedPath) : isEdgeItem ? edgeFields(text, type, selectedPath) : []) : []),
    [type, isEntry, isEdgeItem, selectedPath, text],
  );
  const showInspector = !!(selected && inspector && type && (selNode || selGroup || selEdge)) || (selection.length > 1 && inspector);
  /** A diagram with nothing in it yet: the canvas says how to start. */
  const empty = !!result?.graph && current && !result.graph.nodes.length && !result.graph.groups.length;
  const quick = useMemo(() => {
    const items = type?.palette ?? [];
    // Shapes first (not containers), then whatever there is.
    return [...items.filter((i) => i.collection !== 'groups'), ...items.filter((i) => i.collection === 'groups')].slice(0, 4);
  }, [type]);
  const kindLabel = (path: Path | undefined) => (path ? String(path[0]).replace(/s$/, '').replace(/-/g, ' ') : '');
  const nodeName = (id: string) => {
    const n = result?.graph?.nodes.find((x) => x.id === id);
    return n ? label(n) : id;
  };

  // ------------------------------------------------------------ commands

  const buildCommands = (): Command[] => [
    { id: 'new', group: 'File', label: 'New diagram…', hint: 'template, then AI, builder or YAML', icon: 'file-plus', run: () => setModal('templates') },
    view === 'visual'
      ? { id: 'view-code', group: 'View', label: 'Show the YAML', icon: 'code', shortcut: '⌘\\', run: () => setView('code') }
      : { id: 'view-visual', group: 'View', label: 'Build visually (hide the YAML)', icon: 'mouse-pointer-2', shortcut: '⌘\\', run: () => setView('visual') },
    { id: 'open', group: 'File', label: 'Open YAML file…', icon: 'folder-open', shortcut: '⌘O', run: openFile },
    { id: 'save', group: 'File', label: ws && doc.path ? `Save ${doc.path}` : 'Save', icon: 'save', shortcut: '⌘S', run: saveYaml },
    { id: 'download', group: 'File', label: 'Download YAML', icon: 'download', run: downloadYaml },
    ...(canUseFolders ? [{ id: 'folder', group: 'File', label: 'Open folder…', icon: 'folder-open', run: () => void openFolder() }] : []),
    ...(ws ? diagrams(ws).map((p) => ({ id: `file:${p}`, group: `Files in ${ws.name}`, label: p, icon: 'file-code', run: () => void openInFolder(ws, p) })) : []),
    ...(pins ? [{ id: 'save-layout', group: 'File', label: 'Save layout (.layout.json)', icon: 'save', run: saveLayout }] : []),
    { id: 'svg', group: 'Export', label: 'Export SVG', icon: 'download', shortcut: '⌘E', run: saveSvg },
    { id: 'png', group: 'Export', label: 'Export PNG (2×)', icon: 'image', shortcut: '⇧⌘E', run: savePng },
    { id: 'slide', group: 'Export', label: 'PNG for slides (16:9)', icon: 'monitor', run: saveSlide },
    { id: 'copy-png', group: 'Export', label: 'Copy as PNG', icon: 'copy', run: copyPng },
    { id: 'copy-svg', group: 'Export', label: 'Copy as SVG', icon: 'copy', run: copySvg },
    { id: 'undo', group: 'Edit', label: 'Undo', icon: 'undo-2', shortcut: '⌘Z', run: () => editor.current?.undo() },
    { id: 'redo', group: 'Edit', label: 'Redo', icon: 'redo-2', shortcut: '⇧⌘Z', run: () => editor.current?.redo() },
    ...(vpins ? [{ id: 'reset', group: 'Edit', label: 'Reset layout (unpin everything)', icon: 'pin-off', run: () => pinTo(null) }] : []),
    { id: 'theme-light', group: 'View', label: 'Light theme', icon: 'sun', run: () => setPref('light') },
    { id: 'theme-dark', group: 'View', label: 'Dark theme', icon: 'moon', run: () => setPref('dark') },
    { id: 'theme-system', group: 'View', label: 'Theme follows system', icon: 'monitor', run: () => setPref('system') },
    { id: 'shortcuts', group: 'View', label: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', run: () => setTimeout(() => setModal('shortcuts')) },
    { id: 'problems', group: 'View', label: 'Show problems', icon: 'circle-exclamation-point', run: () => setModal('problems') },
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
      run: () => pick(s),
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
    <div className="app" style={{ ['--split' as string]: `${split * 100}%` }}>
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
                  <Icon name="download" /> SVG <kbd>⌘E</kbd>
                </button>
                <button role="menuitem" onClick={savePng}>
                  <Icon name="image" /> PNG 2× <kbd>⇧⌘E</kbd>
                </button>
                <button role="menuitem" onClick={saveSlide}>
                  <Icon name="monitor" /> PNG for slides (16:9)
                </button>
                <hr />
                <button role="menuitem" onClick={copyPng}>
                  <Icon name="copy" /> Copy as PNG
                </button>
                <button role="menuitem" onClick={copySvg}>
                  <Icon name="copy" /> Copy as SVG
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
        <section className="pane canvas-pane" aria-label="Drawing">
          <Preview
            result={drawn}
            stale={!!rendered && drawn !== result}
            selection={selection}
            docKey={`${rendered?.docKey ?? -1}:${drawn?.view ?? ''}`}
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
              return !!type && !!path && path.length === 2 && typeof path[1] === 'string' && (!!type.connect || !!(type.schema as { properties?: { edges?: unknown } }).properties?.edges);
            }}
            canDrop={(group, what) => {
              const g = result?.graph?.groups.find((x) => x.id === group);
              if (!type || !g || g.path.length !== 2) return false;
              const collection = what.palette != null ? type.palette[what.palette]?.collection : String(pathOf({ kind: 'node', id: what.node! })?.[0] ?? '');
              return !!collection && !!parentKey(type, collection, String(g.path[0]));
            }}
            onPaletteDrop={(i, at, group) => type?.palette[i] && add(type.palette[i], group, at)}
            onKeyDown={onCanvasKey}
            onFollow={(s) => {
              const g = drawn?.graph;
              const links = s.kind === 'node' ? g?.nodes.find((n) => n.id === s.id)?.links : s.kind === 'group' ? g?.groups.find((x) => x.id === s.id)?.links : undefined;
              if (!links?.length) return false;
              follow(links[0]!);
              return true;
            }}
          >
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
              {vpins && (
                <button className="tool" onClick={() => pinTo(null)} title="Unpin everything: back to the automatic layout" aria-label="Reset layout">
                  <Icon name="pin-off" />
                </button>
              )}
              <ViewPicker views={drawn?.views} value={drawn?.view} asWritten={!drawn?.onlyViews} onChange={(name) => setPicked({ doc: docId, name })} />
            </div>
            {hint && !adding && !modal && (
              <div className="hint" role="note">
                <span>
                  {view === 'visual' ? (
                    <>
                      Drag shapes onto the drawing or into a group, drag the dot on a shape to connect it, double-click to rename. <kbd>?</kbd> shows all keys.
                    </>
                  ) : (
                    <>
                      Edit the YAML, or build here: <kbd>A</kbd> adds a shape, drag the dot on a shape to connect it, <kbd>F6</kbd> switches panes, <kbd>?</kbd> shows all keys.
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
        </section>
            {selected && inspector && type && (selNode || selGroup || selEdge) && (
          <Inspector
            key={`${selected.kind}:${selected.id}`}
            id={isEntry ? String(selectedPath![1]) : selected.id}
            title={selNode ? label(selNode) : selGroup ? selGroup.label : selEdge ? `${nodeName(selEdge.from.node)} → ${nodeName(selEdge.to.node)}` : selected.id}
            icon={selNode ? iconOf(selNode) : selGroup ? selGroup.icon : 'arrow-right-from-line'}
            kindLabel={selEdge ? (selEdge.label ? `Line · ${selEdge.label}` : 'Line') : kindLabel(selectedPath)}
            fields={fields}
            renamable={isEntry}
            pinned={selected.kind === 'node' ? !!vpins?.nodes?.[selected.id] : selected.kind === 'group' && !!vpins?.groups?.[selected.id]}
            links={(selNode ?? selGroup)?.links}
            onFollowLink={follow}
            onField={(key, value) =>
              type && selectedPath && apply(isEdgeItem ? setEdgeField(textNow(), selectedPath, key, value) : setField(textNow(), type, selectedPath, key, value))
            }
            onRename={rename}
            onReveal={() => {
              const e = entries.find((x) => x.kind === selected.kind && x.id === selected.id);
              if (e) editor.current?.reveal(e.from, e.to);
              editor.current?.focus();
            }}
            onDuplicate={isEntry ? duplicate : undefined}
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
            onUnpin={() => editor.current?.pin(withViewPins(pins, drawn?.view, withPin(selected.id, undefined, selected.kind === 'group')))}
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
              <p className="fine">
                Drag one to move them all, arrows nudge them, <kbd>⌘C</kbd> <kbd>⌘V</kbd> copies and pastes. Shift-click adds or removes one.
              </p>
            </div>
            <footer>
              <button className="button ghost" onClick={duplicate} title="Duplicate (⌘D)">
                <Icon name="copy" /> Duplicate
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
        {result?.graph && (
          <span>
            {count(result.graph.nodes.length, 'element')} · {count(result.graph.edges.length, 'connection')}
          </span>
        )}
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
      {modal === 'templates' && <Start theme={theme} current={guiding ? typeId : undefined} onOpen={start} onClose={closeModal} />}
      {modal === 'problems' && (
        <Palette
          placeholder={diagnostics.length ? 'Filter problems…' : 'No problems: everything draws'}
          onClose={closeModal}
          commands={diagnostics.map((d, i) => ({
            id: `p${i}`,
            group: d.severity === 'error' ? 'Errors' : 'Warnings',
            label: d.message,
            hint: d.line ? `line ${d.line}` : undefined,
            icon: 'circle-exclamation-point',
            run: () => {
              if (d.from != null && current) editor.current?.reveal(d.from, d.to ?? d.from);
              requestAnimationFrame(() => editor.current?.focus());
            },
          }))}
        />
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
        </div>
      )}
    </div>
  );
}

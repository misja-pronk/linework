// The editor app: YAML on the left, the drawing on the right, both selecting the same element.
// Builder actions (inspector, palette, drag) are edits of the YAML text plus pins, all in the
// editor's one undo history.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Diagnostic, GraphNode, LayoutSidecar, PaletteItem, Path, Point } from '@cartography/core';
import { Editor, type EditorHandle } from './editor.tsx';
import { Preview, type Selection } from './preview.tsx';
import { Palette, type Command } from './palette.tsx';
import { Templates } from './templates.tsx';
import { Inspector } from './inspector.tsx';
import { AddMenu } from './add-menu.tsx';
import { Menu } from './menu.tsx';
import { Icon } from './icon.tsx';
import { useRender } from './use-render.ts';
import { entryAt, entryRanges } from './ranges.ts';
import { exampleLoader, starters, typeName, type Starter } from './library.ts';
import { baseName, download, exportPng, exportSvg, yamlName } from './export.ts';
import { addEntry, connectEntries, deleteEntry, duplicateEntry, edgeFields, fieldsFor, isScalarAt, parentKey, renameEntry, setEdgeField, setField } from './builder.ts';
import { store } from './store.ts';
import { canSaveFiles, canUseFolders, diagrams, folderLoader, lastFolder, pickFolder, readSidecar, reopen, saveAs, saveFile, saveInFolder, scan, type Workspace } from './files.ts';

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

const firstStarter = starters.find((s) => s.id === 'example:data-products/customer-detailed.yaml') ?? starters[0]!;
const label = (n: GraphNode) => (n.shape.kind === 'card' ? n.shape.label : n.shape.kind === 'table' ? n.shape.title : n.id);
const iconOf = (n: GraphNode) => (n.shape.kind === 'card' || n.shape.kind === 'table' ? n.shape.icon : 'table');

export function App() {
  const saved = useMemo(() => store.get<Saved>('doc'), []);
  const [text, setText] = useState(saved?.text ?? firstStarter.text);
  const [doc, setDoc] = useState<Doc>(saved?.doc ?? { name: firstStarter.file, starter: firstStarter.id });
  const [pins, setPins] = useState<LayoutSidecar | undefined>(saved?.pins);
  /** A node being dragged: its pin before it is committed to the history. */
  const [draft, setDraft] = useState<{ id: string; at: Point }>();
  const [docKey, setDocKey] = useState(0);
  const [pref, setPref] = useState<ThemePref>(store.get('theme') ?? 'system');
  const systemDark = useSystemDark();
  const theme: 'light' | 'dark' = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  const [selected, setSelected] = useState<Selection>();
  const [modal, setModal] = useState<'palette' | 'templates' | 'problems' | 'connect'>();
  const [adding, setAdding] = useState(false);
  const [inspector, setInspector] = useState(true);
  const [menu, setMenu] = useState(false);
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
  // Back in the window: read the folder again, so contract files edited elsewhere show up.
  useEffect(() => {
    if (!ws) return;
    const onFocus = () => void scan(ws.dir).then(setWs).catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ws]);

  const load = useMemo(
    () => (ws && doc.path ? folderLoader(ws, doc.path) : doc.starter ? exampleLoader(doc.starter) : undefined),
    [ws, doc.path, doc.starter],
  );
  const sidecar = useMemo<LayoutSidecar | undefined>(
    () => (draft ? { version: 1, nodes: { ...(pins?.nodes ?? {}), [draft.id]: draft.at } } : pins),
    [pins, draft],
  );
  const rendered = useRender(useDebounced(text, 40, docKey), theme, sidecar, load, docKey);
  const result = rendered?.result;
  const drawn = rendered?.drawn;
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

  const onChange = (next: string) => {
    setText(next);
    // The "undo open" offer ends with the first edit: it would throw that edit away.
    if (openedText.current != null && next !== openedText.current) {
      openedText.current = null;
      setToast((t) => (t?.action?.label === 'Undo' ? undefined : t));
    }
  };

  const open = useCallback(
    (next: string, nextDoc: Doc, nextPins?: LayoutSidecar) => {
      const before = { text: editor.current?.text() ?? text, doc, pins };
      editor.current?.load(next, nextPins);
      setDoc(nextDoc);
      setSelected(undefined);
      setDocKey((k) => k + 1);
      setSavedText(next);
      setSavedPins(JSON.stringify(nextPins ?? null));
      openedText.current = next;
      // Within a folder, files are saved before switching: nothing to undo.
      if (nextDoc.path) return;
      notify(`Opened ${nextDoc.name}`, {
        action: {
          label: 'Undo',
          run: () => {
            editor.current?.load(before.text, before.pins);
            setDoc(before.doc);
            setSavedText(null);
            setSelected(undefined);
            setDocKey((k) => k + 1);
          },
        },
      });
    },
    [text, doc, pins, notify],
  );

  const pick = (s: Starter) => {
    setModal(undefined);
    fileHandle.current = undefined;
    open(s.text, { name: s.file, starter: s.id });
  };

  /** Saves where the document lives: its folder, its file, or a new file. Returns false when cancelled. */
  const save = async (): Promise<boolean> => {
    const now = textNow();
    // Pins of elements that are no longer drawn are left out of the saved layout.
    const drawnIds = new Set(result?.graph?.nodes.map((n) => n.id) ?? []);
    const kept = pins?.nodes && result?.graph ? Object.fromEntries(Object.entries(pins.nodes).filter(([k]) => drawnIds.has(k))) : pins?.nodes;
    const pinsToSave: LayoutSidecar | undefined = kept && Object.keys(kept).length ? { version: 1, nodes: kept } : undefined;
    try {
      if (ws && doc.path) await saveInFolder(ws, doc.path, now, pinsToSave);
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
    // Switching files keeps work: the current one is saved first when it lives in the folder.
    if (dirty && ws && doc.path && doc.path !== path && !(await save())) return;
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

  const exportInput = () => ({ text: editor.current?.text() ?? text, theme, load, sidecar: pins });
  const attempt = (what: string, run: () => Promise<void>) => () =>
    void run().catch((e: unknown) => notify(`${what} failed: ${e instanceof Error ? e.message : String(e)}`, { tone: 'error' }));
  const saveYaml = () => void save();
  const downloadYaml = () => download(yamlName(doc.name), editor.current?.text() ?? text, 'text/yaml');
  const saveLayout = () => pins && download(`${baseName(doc.name)}.layout.json`, JSON.stringify(pins, null, 2) + '\n', 'application/json');
  const saveSvg = attempt('Export', async () => download(`${baseName(doc.name)}.svg`, await exportSvg(exportInput()), 'image/svg+xml'));
  const savePng = attempt('Export', async () => download(`${baseName(doc.name)}.png`, await exportPng(exportInput(), 2)));
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
  const onCursor = (pos: number) => {
    if (!current) return;
    const e = entryAt(entries, pos);
    setSelected((s) => (e ? (s?.kind === e.kind && s.id === e.id ? s : { kind: e.kind, id: e.id }) : undefined));
  };

  // ------------------------------------------------------------ builder

  /** Applies a text edit (and optionally new pins) as one undo step. */
  const apply = (next: string | undefined, nextPins?: LayoutSidecar | null) => {
    if (next == null) return notify('That change did not work on this YAML: fix the problems in the editor, or make it there', { tone: 'error' });
    editor.current?.replace(next, { pins: nextPins });
  };
  const withPin = (id: string, at: Point | undefined): LayoutSidecar | null => {
    const nodes = { ...(pins?.nodes ?? {}) };
    if (at) nodes[id] = at;
    else delete nodes[id];
    return Object.keys(nodes).length ? { version: 1, nodes } : null;
  };
  const textNow = () => editor.current?.text() ?? text;
  /** Builder actions use the drawing's paths, so they wait for a drawing of the current text. */
  const ready = () => {
    if (result?.graph && current) return true;
    notify(result?.graph ? 'One moment: the drawing is catching up with the text' : 'Fix the problems in the YAML first', { tone: 'error' });
    return false;
  };
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

  const remove = () => {
    const path = pathOf(selected);
    if (!path || !selected || !type || !ready()) return;
    // A line that stands for part of something bigger (a policy, a list) is changed in the YAML.
    const deletable = (path.length === 2 && typeof path[1] === 'string') || typeof path.at(-1) === 'number' || (selected.kind === 'edge' && isScalarAt(textNow(), path));
    if (!deletable) {
      notify('This one is part of a larger entry: change it in the YAML', { tone: 'error' });
      const e = entries.find((x) => x.kind === selected.kind && x.id === selected.id);
      if (e) editor.current?.reveal(e.from, e.to);
      return;
    }
    const next = deleteEntry(textNow(), type, path);
    apply(next, selected.kind === 'node' && pins?.nodes?.[selected.id] ? withPin(selected.id, undefined) : undefined);
    if (next != null) setSelected(undefined);
  };

  const duplicate = () => {
    const path = pathOf(selected);
    if (!path || !selected || path.length !== 2 || !ready()) return;
    const r = duplicateEntry(textNow(), path);
    if (!r) return apply(undefined);
    const box = result?.placed?.nodes.get(selected.id);
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    apply(r.text, box ? withPin(r.id, { x: Math.round(box.x + shift.x + 24), y: Math.round(box.y + shift.y + 24) }) : undefined);
    setSelected({ kind: selected.kind, id: r.id });
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
    const moved = pins?.nodes && Object.keys(pins.nodes).some((k) => rekey(k) !== k);
    apply(next, moved ? { version: 1, nodes: Object.fromEntries(Object.entries(pins!.nodes!).map(([k, v]) => [rekey(k), v])) } : undefined);
    setSelected({ kind: selected.kind, id: nodeId });
    return true;
  };

  const move = (id: string, at: Point, done: boolean, group?: string | null) => {
    if (!done) return setDraft({ id, at });
    setDraft(undefined);
    const nextPins = withPin(id, at);
    // Moving and changing group are one step: one undo puts both back.
    const reparented = group !== undefined ? reparent(id, group) : undefined;
    if (reparented) {
      apply(reparented.text, nextPins);
      notify(reparented.message);
    } else editor.current?.pin(nextPins ?? undefined);
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
  };

  const nudge = (dx: number, dy: number) => {
    if (selected?.kind !== 'node' || !current) return;
    const box = result?.placed?.nodes.get(selected.id);
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    if (box) editor.current?.pin(withPin(selected.id, { x: Math.round(box.x + shift.x + dx), y: Math.round(box.y + shift.y + dy) }) ?? undefined);
  };

  const cycle = (dir: 1 | -1): boolean => {
    const nodes = result?.graph?.nodes ?? [];
    if (!nodes.length) return false;
    const i = selected?.kind === 'node' ? nodes.findIndex((n) => n.id === selected.id) : -1;
    const next = i + dir;
    if (next < 0 || next >= nodes.length) return false;
    select({ kind: 'node', id: nodes[next]!.id });
    return true;
  };

  const onCanvasKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    if (mod(e) && e.key.toLowerCase() === 'z') e.shiftKey ? editor.current?.redo() : editor.current?.undo();
    else if (mod(e) && e.key.toLowerCase() === 'y') editor.current?.redo();
    else if (mod(e) && e.key.toLowerCase() === 'd') duplicate();
    else if (e.key === 'Delete' || e.key === 'Backspace') remove();
    else if (e.key === 'Escape') setSelected(undefined);
    else if (e.key === 'ArrowLeft') nudge(-step, 0);
    else if (e.key === 'ArrowRight') nudge(step, 0);
    else if (e.key === 'ArrowUp') nudge(0, -step);
    else if (e.key === 'ArrowDown') nudge(0, step);
    else if (e.key === 'Tab' && !mod(e)) {
      if (!cycle(e.shiftKey ? -1 : 1)) return;
    } else if (e.key === 'a' && !mod(e) && !e.altKey) setAdding(true);
    else if (e.key === 'c' && !mod(e) && !e.altKey && selected?.kind === 'node') setModal('connect');
    else if (e.key === 'Enter' && selected) (document.querySelector('.inspector input, .inspector select') as HTMLElement | null)?.focus();
    else return;
    e.preventDefault();
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
  const showInspector = !!(selected && inspector && type && (selNode || selGroup || selEdge));
  const kindLabel = (path: Path | undefined) => (path ? String(path[0]).replace(/s$/, '').replace(/-/g, ' ') : '');
  const nodeName = (id: string) => {
    const n = result?.graph?.nodes.find((x) => x.id === id);
    return n ? label(n) : id;
  };

  // ------------------------------------------------------------ commands

  const buildCommands = (): Command[] => [
    { id: 'new', group: 'File', label: 'New from template…', icon: 'layout-template', run: () => setModal('templates') },
    { id: 'open', group: 'File', label: 'Open YAML file…', icon: 'folder-open', shortcut: '⌘O', run: openFile },
    { id: 'save', group: 'File', label: ws && doc.path ? `Save ${doc.path}` : 'Save', icon: 'save', shortcut: '⌘S', run: saveYaml },
    { id: 'download', group: 'File', label: 'Download YAML', icon: 'download', run: downloadYaml },
    ...(canUseFolders ? [{ id: 'folder', group: 'File', label: 'Open folder…', icon: 'folder-open', run: () => void openFolder() }] : []),
    ...(ws ? diagrams(ws).map((p) => ({ id: `file:${p}`, group: `Files in ${ws.name}`, label: p, icon: 'file-code', run: () => void openInFolder(ws, p) })) : []),
    ...(pins ? [{ id: 'save-layout', group: 'File', label: 'Save layout (.layout.json)', icon: 'save', run: saveLayout }] : []),
    { id: 'svg', group: 'Export', label: 'Export SVG', icon: 'download', shortcut: '⌘E', run: saveSvg },
    { id: 'png', group: 'Export', label: 'Export PNG (2×)', icon: 'image', shortcut: '⇧⌘E', run: savePng },
    { id: 'copy-png', group: 'Export', label: 'Copy as PNG', icon: 'copy', run: copyPng },
    { id: 'copy-svg', group: 'Export', label: 'Copy as SVG', icon: 'copy', run: copySvg },
    { id: 'undo', group: 'Edit', label: 'Undo', icon: 'undo-2', shortcut: '⌘Z', run: () => editor.current?.undo() },
    { id: 'redo', group: 'Edit', label: 'Redo', icon: 'redo-2', shortcut: '⇧⌘Z', run: () => editor.current?.redo() },
    ...(pins ? [{ id: 'reset', group: 'Edit', label: 'Reset layout (unpin everything)', icon: 'pin-off', run: () => editor.current?.pin(undefined) }] : []),
    { id: 'theme-light', group: 'View', label: 'Light theme', icon: 'sun', run: () => setPref('light') },
    { id: 'theme-dark', group: 'View', label: 'Dark theme', icon: 'moon', run: () => setPref('dark') },
    { id: 'theme-system', group: 'View', label: 'Theme follows system', icon: 'monitor', run: () => setPref('system') },
    { id: 'problems', group: 'View', label: 'Show problems', icon: 'circle-exclamation-point', run: () => setModal('problems') },
    ...(type?.palette ?? []).map((item, i) => ({ id: `add:${i}`, group: 'Add', label: item.label, hint: item.collection, icon: item.icon, run: () => add(item) })),
    ...(selected?.kind === 'node'
      ? [{ id: 'connect', group: 'Edit', label: `Connect ${nodeName(selected.id)} to…`, icon: 'arrow-right-from-line', shortcut: 'C', run: () => setTimeout(() => setModal('connect')) }]
      : []),
    ...(result?.graph?.nodes ?? []).map((n) => ({ id: `node:${n.id}`, group: 'Go to', label: label(n), hint: n.id, icon: iconOf(n) ?? 'box', run: () => select({ kind: 'node', id: n.id }) })),
    ...starters.map((s) => ({
      id: `starter:${s.id}`,
      group: 'Start from',
      label: s.title,
      hint: `${s.kind === 'template' ? 'Template' : 'Example'} · ${typeName(s.type)}`,
      icon: 'layout-template',
      run: () => pick(s),
    })),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || !mod(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'k' && !e.shiftKey) setModal((m) => (m === 'palette' ? undefined : 'palette'));
      else if (k === 's' && !e.shiftKey) saveYaml();
      else if (k === 'o' && !e.shiftKey) openFile();
      else if (k === 'e') e.shiftKey ? savePng() : saveSvg();
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

  const closeModal = () => setModal(undefined);
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
          {typeId && <span className="type-pill">{typeName(typeId)}</span>}
        </div>
        <div className="actions">
          {canUseFolders && !ws && remembered && (
            <button className="button ghost" onClick={() => void openFolder(remembered)} title="Open the last folder again">
              <Icon name="folder-open" /> {remembered.name}
            </button>
          )}
          {canUseFolders && (
            <button className="button ghost" onClick={() => void openFolder()} title="Open a folder with diagrams">
              <Icon name="folder-open" /> {ws ? 'Folder' : 'Open folder'}
            </button>
          )}
          <button className="button ghost" onClick={() => setModal('templates')}>
            <Icon name="layout-template" /> Templates
          </button>
          <button className="button ghost" onClick={() => setModal('palette')} title="Command palette">
            <Icon name="search" /> Commands <kbd>⌘K</kbd>
          </button>
          <button
            className="icon-button"
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

      <main className={`workspace${showInspector ? ' with-inspector' : ''}${ws ? ' with-files' : ''}`}>
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
            selected={selected}
            docKey={rendered?.docKey ?? -1}
            onSelect={select}
            onMove={move}
            onConnect={connect}
            onDragCancel={() => setDraft(undefined)}
            canDrop={(group, what) => {
              const g = result?.graph?.groups.find((x) => x.id === group);
              if (!type || !g || g.path.length !== 2) return false;
              const collection = what.palette != null ? type.palette[what.palette]?.collection : String(pathOf({ kind: 'node', id: what.node! })?.[0] ?? '');
              return !!collection && !!parentKey(type, collection, String(g.path[0]));
            }}
            onPaletteDrop={(i, at, group) => type?.palette[i] && add(type.palette[i], group, at)}
            onKeyDown={onCanvasKey}
          >
            <div className="canvas-tools" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
              <button className={adding ? 'tool active' : 'tool'} onClick={() => setAdding((a) => !a)} title="Add a shape (A)" aria-expanded={adding} disabled={!type}>
                <Icon name="plus" /> Add <kbd>A</kbd>
              </button>
              <button className="tool" onClick={() => editor.current?.undo()} title="Undo (⌘Z)" aria-label="Undo">
                <Icon name="undo-2" />
              </button>
              <button className="tool" onClick={() => editor.current?.redo()} title="Redo (⇧⌘Z)" aria-label="Redo">
                <Icon name="redo-2" />
              </button>
              {pins && (
                <button className="tool" onClick={() => editor.current?.pin(undefined)} title="Unpin everything: back to the automatic layout" aria-label="Reset layout">
                  <Icon name="pin-off" />
                </button>
              )}
            </div>
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
            pinned={selected.kind === 'node' && !!pins?.nodes?.[selected.id]}
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
            onDelete={remove}
            onUnpin={() => editor.current?.pin(withPin(selected.id, undefined) ?? undefined)}
            onClose={() => setInspector(false)}
          />
        )}

      </main>

      <footer className="statusbar">
        <button className={`status-problems${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`} onClick={() => setModal('problems')}>
          <Icon name={errors || warnings ? 'circle-exclamation-point' : 'check'} size={14} />
          {errors || warnings ? `${errors} error${errors === 1 ? '' : 's'}${warnings ? `, ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}` : 'No problems'}
        </button>
        {result?.graph && (
          <span>
            {result.graph.nodes.length} elements · {result.graph.edges.length} connections
          </span>
        )}
        {pins?.nodes && Object.keys(pins.nodes).length > 0 && (
          <span className="status-selected">
            <Icon name="pin" size={13} /> {Object.keys(pins.nodes).length} pinned
          </span>
        )}
        {selected && (
          <span className="status-selected">
            <Icon name="mouse-pointer-2" size={13} /> {selected.id}
          </span>
        )}
        <span className="spacer" />
        {rendered && <span>{rendered.ms} ms</span>}
        <span>{theme === 'dark' ? 'Dark' : 'Light'}</span>
      </footer>

      {modal === 'palette' && <Palette commands={buildCommands()} onClose={closeModal} />}
      {modal === 'connect' && selected?.kind === 'node' && (
        <Palette
          placeholder={`Connect ${nodeName(selected.id)} to…`}
          onClose={closeModal}
          commands={(result?.graph?.nodes ?? [])
            .filter((n) => n.id !== selected.id)
            .map((n) => ({ id: `to:${n.id}`, group: `Connect ${nodeName(selected.id)} to`, label: label(n), hint: n.id, icon: iconOf(n) ?? 'box', run: () => connect(selected.id, n.id) }))}
        />
      )}
      {modal === 'templates' && <Templates theme={theme} onPick={pick} onClose={closeModal} />}
      {modal === 'problems' && (
        <Palette
          placeholder={diagnostics.length ? 'Filter problems…' : 'No problems'}
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

// The editor app: YAML on the left, the drawing on the right, both selecting the same element.
// Builder actions (inspector, palette, drag) are edits of the YAML text plus pins, all in the
// editor's one undo history.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { packLayout, viewPins, withViewPins, type Diagnostic, type EdgeOverride, type GraphNode, type LayoutSidecar, type Link, type PaletteItem, type Path, type Point, renamePins } from '@cartography/core';
import { Editor, type EditorHandle } from './editor.tsx';
import { Preview, type LabelTarget, type PreviewControl, type Selection } from './preview.tsx';
import { arrange, nearestToward, type ArrangeOp, type Direction } from './craft.ts';
import { ArrangeBar, arrangeCommands, arrangeKey, useCraftPrefs } from './craft-actions.tsx';
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
import { SLIDE_MIN_PT } from '@cartography/engine';
import { exportFrom, exportKind, exportNotes, exportRemark } from './exports.ts';
import { isRepo, scanRepo, type RepoDiagram } from '@cartography/import';
import { RepoDialog, type RepoOffer } from './repo-dialog.tsx';

/** The command palette's entry for the exports in the open folder, by what they are. */
const EXPORT_ENTRY = {
  access: { label: (name: string) => t('Who reaches what in {name}', { name }), hint: 'its az, Graph or AzureHound exports in access.yaml', icon: 'shield-user' },
  github: { label: (name: string) => t('GitHub organisation of {name}', { name }), hint: 'its gh api responses in github.yaml', icon: 'folder-git-2' },
  azure: { label: (name: string) => t('Azure resources in {name}', { name }), hint: 'its az graph query, az bicep build or terraform show -json output in azure.yaml', icon: 'cloud' },
};
import { ViewPicker } from './view-picker.tsx';
import { is, keyHint, shortcutFor } from './keys.ts';
import { paneColumns, paneLayout, RAIL } from './pane-layout.ts';
import { useConfirm } from './confirm.tsx';
import { useLayers } from './layers-control.tsx';
import { useStages } from './stages/use-stages.tsx';
import { useCompare } from './compare/index.tsx';
import { AskPanel } from './ai/ask-panel.tsx';
import { forYourAi } from './ai/copy.ts';
import { useLive } from './live/use-live.ts';
import { served, servedFolder } from './live/serve.ts';
import { Present, type PresentDoc } from './present.tsx';
import { StepsStrip } from './steps-strip.tsx';
import { addStep, deleteStep, moveStep, renameStep, stepsPath } from './steps-edit.ts';
import { linkTarget } from './links.ts';
import { entryAt, entryRanges } from './ranges.ts';
import { blankText, exampleLoader, starters, typeName, type Starter } from './library.ts';
import { folderBytes, TemplateItems, useTemplateChoice } from './pptx-template.tsx';
import { baseName, download, exportDrawio, exportExcalidraw, exportMermaid, exportPageSvg, exportPdf, exportPng, exportPptx, exportSafeSvg, exportSlide, exportSvg, yamlName, type Handed } from './export.ts';
import { addEntry, canMove, drawnAs, connectEntries, copyEntries, deleteEntries, deleteEntry, duplicateEntry, editChainLine, isChainLine, isEntryPath, moveEntry, pasteEntries, type Clip, edgeFields, fieldsFor, isScalarAt, parentKey, renameEntry, setEdgeField, setField } from './builder.ts';
import { store } from './store.ts';
import { decodeShare, SHARE_LIMIT, shareLink } from '@cartography/core';
import { themes } from '@cartography/theme';
import { brand } from './brand.ts';
import { OPEN_KEY } from './viewer.tsx';
import { BrandMenu } from './brand-menu.tsx';
import { useWorkspaceTools } from './workspace/use-tools.tsx';
import { useTrace } from './trace/use-trace.tsx';
import { useBlocks } from './blocks/use-blocks.tsx';
import { useReview } from './notes-state.ts';
import { NoteMarkers, NotesPanel, type NoteFilter } from './notes-panel.tsx';
import { useDecisionsTool } from './decisions-panel.tsx';
import { useReviewTool } from './review-panel.tsx';
import { AnimateDialog } from './animate-dialog.tsx';
import { DescribeDialog } from './describe-dialog.tsx';
import { copyRich, describeResult } from './describe.ts';
import { anchorFor, anchorLabel, notesInView, resolveAnchor, type NoteAnchor } from '@cartography/core';
import { t, say, useUiLang, withUiLang, type Message } from './i18n/index.ts';
import { canSaveFiles, canUseFolders, diagrams, diskText, folderLoader, lastFolder, pickFolder, readSidecar, reopen, saveAs, saveFile, saveInFolder, scan, sidecarPath, writeInFolder, type Workspace } from './files.ts';

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
/** The window's width, for sharing it out between the panes (pane-layout.ts). */
function useWindowWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/**
 * Puts a toast just under the drawing's tools, at their left: where the eyes are after an action, and
 * never over the zoom bar, the hint, a panel or an open popover. Without a drawing on screen (a phone on the YAML tab)
 * it stays at the bottom of the window.
 */
function dockToast(el: HTMLDivElement | null) {
  if (!el) return;
  const top = [...document.querySelectorAll('.canvas-top > *')].filter((x) => (x as HTMLElement).offsetParent);
  const pane = document.querySelector('.canvas-pane')?.getBoundingClientRect();
  if (!top.length || !pane?.width) return el.classList.remove('docked');
  el.classList.add('docked');
  // Under an open popover too (the Layers panel, ⋯): a toast never covers what is being used.
  const open = [...document.querySelectorAll('.canvas-top [role="menu"]')];
  el.style.top = `${Math.max(...[...top, ...open].map((x) => x.getBoundingClientRect().bottom)) + 8}px`;
  el.style.left = `${pane.left + 16}px`;
  el.style.maxWidth = `${pane.width - 32}px`;
}

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
const count = (n: number, what: Message) => t(what, { count: n });
/** What the status bar counts: what the type draws. One shape drawn whole (a sequence, a roadmap) is
 * counted by its parts; everything else by its elements and connections. */
function drawnCount(graph: { nodes: GraphNode[]; edges: unknown[] }): string {
  const s = graph.nodes.length === 1 ? graph.nodes[0]!.shape : undefined;
  if (s?.kind === 'sequence') return `${count(s.participants.length, '{count} participant|{count} participants')} · ${count(s.events.filter((e) => e.kind === 'message').length, '{count} message|{count} messages')}`;
  if (s?.kind === 'gitflow') return `${count(s.branches.length, '{count} branch|{count} branches')} · ${count(s.commits.length, '{count} commit|{count} commits')}`;
  if (s?.kind === 'roadmap') return `${count(s.lanes.length, '{count} lane|{count} lanes')} · ${count(s.items.length, '{count} item|{count} items')}`;
  if (s?.kind === 'journey') return `${count(s.phases.length, '{count} phase|{count} phases')} · ${count(s.steps.length, '{count} step|{count} steps')}`;
  if (s?.kind === 'matrix') return `${count(s.rows.length, '{count} row|{count} rows')} · ${count(s.columns.length, '{count} column|{count} columns')}`;
  return `${count(graph.nodes.length, '{count} element|{count} elements')} · ${count(graph.edges.length, '{count} connection|{count} connections')}`;
}
const label = (n: GraphNode) => (n.shape.kind === 'card' || n.shape.kind === 'journey-part' || n.shape.kind === 'block' ? n.shape.label || n.id : n.shape.kind === 'flow' ? n.shape.label || n.id : n.shape.kind === 'table' ? n.shape.title : n.id);
const iconOf = (n: GraphNode) => (n.shape.kind === 'card' || n.shape.kind === 'table' || n.shape.kind === 'journey-part' ? n.shape.icon : n.shape.kind === 'flow' ? 'workflow' : n.shape.kind === 'block' ? (n.shape.form === 'person' ? 'user' : n.shape.form === 'topic' ? 'brain' : n.shape.form === 'area' || n.shape.form === 'capability' || n.shape.form === 'chip' ? 'layout-grid' : 'users') : 'table');

export function App() {
  const lang = useUiLang();
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
  /** Questions before something is lost, in the app's own dialog (confirm.tsx). */
  const confirmer = useConfirm();
  // Opened by carto serve, the folder's first diagram opens instead.
  const [modal, setModal] = useState<'palette' | 'templates' | 'problems' | 'connect' | 'shortcuts' | undefined>(() => (store.get('started') || served() ? undefined : 'templates'));
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
  const dismissHint = () => {
    setHint(false);
    store.set('hinted', true);
  };
  /** The hint has done its job once something is built. */
  const acted = () => hint && dismissHint();
  const [inspector, setInspector] = useState(true);
  const [menu, setMenu] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [more, setMore] = useState(false);
  /** The drawing's tools that fold into ⋯ when the pane is narrow. */
  const [toolsMore, setToolsMore] = useState(false);
  /** The type pill's card: what this type is for, and the way to the type guide. */
  const [typeCard, setTypeCard] = useState(false);
  /** Opened from the type pill: the dialog marks the open diagram's type. */
  const [guiding, setGuiding] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'error'; action?: { label: string; run(): void }; more?: { label: string; run(): void } }>();
  /** All an import or export had to say (the toast says the first), for the document it was about: listed with the problems. */
  const [notes, setNotes] = useState<{ doc: string; title: string; items: string[] }>();
  const [split, setSplit] = useState(() => Math.min(0.7, Math.max(0.2, Number(store.get('split')) || 0.4)));
  /** The file list and the YAML as people left them: open, or folded to a rail (pane-layout.ts). */
  const [filesPref, setFilesPrefState] = useState<'list' | 'rail'>(() => (store.get('files') === 'rail' ? 'rail' : 'list'));
  const setFilesPref = (v: 'list' | 'rail') => (setFilesPrefState(v), store.set('files', v));
  const [yamlFolded, setYamlFoldedState] = useState(() => store.get<boolean>('yaml-folded') === true);
  const setYamlFolded = (v: boolean) => (setYamlFoldedState(v), store.set('yaml-folded', v), setForceYaml(false));
  /** The YAML opened from its rail although there is no room: it stays open until folded again. */
  const [forceYaml, setForceYaml] = useState(false);
  /** The file list over the drawing, opened from its rail when there is no room for it beside. */
  const [filesOver, setFilesOver] = useState(false);
  const windowWidth = useWindowWidth();
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
  /** Review notes: saved with the diagram in a folder, kept in this browser otherwise (notes-state.ts). */
  const review = useReview(doc.path ?? doc.starter ?? doc.name, docKey, ws && doc.path ? { ws, path: doc.path } : undefined);
  const dirty = savedText !== text || savedPins !== JSON.stringify(pins ?? null) || (!!ws && !!doc.path && review.dirty);

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
  /** The open folder is a code repository (Compose, Helm, Bicep, OpenAPI, workflows …): a diagram can be made of each. */
  const repoInWs = useMemo(() => !!ws && !meshInWs && isRepo([...ws.files].map(([path, f]) => ({ path, text: f.text }))), [ws, meshInWs]);
  /** Diagrams from the code, offered in a dialog: written into the folder, or one opened. */
  const [repoOffer, setRepoOffer] = useState<RepoOffer>();
  // Views: the one asked for (per document) and the one drawn (a diagram of only views draws its first).
  // Pins live per view in the sidecar; everything below works on the drawn view's pins.
  const docId = doc.path ?? doc.starter ?? doc.name;
  const [picked, setPicked] = useState<{ doc: string; name?: string }>();
  const viewName = picked?.doc === docId ? picked.name : undefined;
  // Steps: the one looked at while editing (per document and view), and presenting full screen.
  const [stepAt, setStepAt] = useState<{ doc: string; view?: string; n: number }>();
  const stepNo = stepAt && stepAt.doc === docId && stepAt.view === viewName ? stepAt.n : undefined;
  const [presenting, setPresenting] = useState(false);
  /** The Your AI panel (⌘J): proposals from the user's own agent, and files changed on disk. */
  const [asking, setAsking] = useState(false);
  /** The panel stays mounted (what was decided kept) behind another tab until it is closed. */
  const [askKept, setAskKept] = useState(false);
  const askWith = () => {
    setAsking(true);
    setAskKept(true);
  };
  const toggleAsk = () => (asking ? setAsking(false) : askWith());
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
  // The file name people see (and Claude is told): a template is "sequence.yaml", never its id "template:sequence".
  const docFile = (doc.path ?? (doc.starter?.startsWith('example:') ? doc.starter.slice('example:'.length) : undefined) ?? doc.name).split('/').pop();
  /** Counts layout resets: the drawing remembers where things were until one (use-render.ts). */
  const [fresh, setFresh] = useState(0);
  /** Layers switched on here (layers-control.tsx), on top of what the YAML says. */
  const layering = useLayers(docId, viewName);
  // Stages (stages/): the one picked on the timeline is drawn, on the placement of everything.
  const staging = useStages(docId, viewName);
  const lenses = useMemo(() => (staging.options ? { ...layering.options, ...staging.options } : layering.options), [layering.options, staging.options]);
  const rendered = useRender(useDebounced(text, Math.min(400, Math.max(40, renderMs * 1.5)), docKey), theme, sidecar, load, docKey, viewName, docFile, stepNo, fresh, focusAsked, lenses);
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
  // A drawing of only some layers is not how the whole view is drawn: its note stays the whole one's.
  const layoutNote = () => (drawnLayout && !(drawn?.layers?.mode === 'only' && drawn.layers.active.length) ? packLayout(drawnLayout, tracked || !!drawnLayout.held) : vpins?.layout);
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
  const pinnedIds = useMemo(() => new Set([...Object.keys(vpins?.nodes ?? {}), ...Object.keys(vpins?.groups ?? {})]), [vpins?.nodes, vpins?.groups]);
  const craft = useCraftPrefs();
  const previewControl = useRef<PreviewControl>(null);
  const dragStartedInView = useRef(false);

  // ------------------------------------------------------------ review notes

  const [notesOpen, setNotesOpen] = useState(false);
  const [decisionsOpen, setDecisionsOpen] = useState(false);
  const [archReviewOpen, setArchReviewOpen] = useState(false);
  const [noteFilter, setNoteFilter] = useState<NoteFilter>('open');
  const [noteMine, setNoteMine] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [notesInExports, setNotesInExports] = useState(() => store.get<boolean>('notes-in-exports') ?? false);
  /** A note being written, and on what. */
  const [noteDraft, setNoteDraft] = useState<{ anchor: NoteAnchor; about: string }>();
  const [activeNote, setActiveNote] = useState<string>();
  /** Right-click on the drawing: where, and on what. */
  const [noteMenu, setNoteMenu] = useState<{ x: number; y: number; s?: Selection; at: Point }>();
  const anchorOf = (s: Selection | undefined) => {
    const g = drawn?.graph;
    const a = s && g ? anchorFor(g, s.kind, s.id) : undefined;
    return a && g ? { anchor: a, about: anchorLabel(a, g) } : undefined;
  };
  const pointAnchor = (at: Point) => ({ anchor: { kind: 'point' as const, x: Math.round(at.x), y: Math.round(at.y) }, about: 'A point on the canvas' });
  /** A note on the selection; with nothing selected, on the middle of what is in view. */
  const addNote = (on?: { anchor: NoteAnchor; about: string }) => {
    const centre = previewControl.current?.centre();
    const target = on ?? anchorOf(selected) ?? (centre && pointAnchor(centre));
    if (!target) return;
    setNoteDraft(target);
    setNotesOpen(true);
  };
  const toggleNotes = () => {
    setNotesOpen((o) => !o);
    setNoteDraft(undefined);
    if (notesOpen) setReviewMode(false);
  };
  const toggleReview = () => {
    if (!reviewMode) setNotesOpen(true);
    setReviewMode(!reviewMode);
  };
  const setExportsWithNotes = (on: boolean) => {
    setNotesInExports(on);
    store.set('notes-in-exports', on);
  };
  /** A marker clicked, or a thread picked in the palette: the thread opens and what it is about is selected. */
  const openNote = (id: string) => {
    const t = review.notes.threads.find((x) => x.id === id);
    setNotesOpen(true);
    setActiveNote(id);
    review.seen([id]);
    const r = t && drawn?.graph ? resolveAnchor(t.anchor, drawn.graph) : undefined;
    if (r?.state === 'attached') setSelected({ kind: r.kind, id: r.id });
  };
  const openNotes = notesInView(review.notes, drawn?.view).filter((t) => t.status === 'open');
  const unreadNotes = openNotes.filter((t) => review.unread(t)).length;
  const type = result?.type ?? drawn?.type;
  const diagnostics = result?.diagnostics ?? NONE;
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  /** A file of the folder that changed on disk while open, already in the editor (Your AI panel). */
  const [diskChange, setDiskChange] = useState<{ doc: number; path: string; before: string; after: string }>();
  const checkDisk = useRef<() => void>(() => undefined);
  const live = useLive(
    () => ({
      path: ws && doc.path ? doc.path : undefined,
      text,
      type,
      selection: selection.map((s) => ({ kind: s.kind, id: s.id })),
      view: drawn?.view,
      layers: drawn?.layers?.active,
      stage: drawn?.stage,
      step: stepNo,
      problems: diagnostics.map((d) => ({ severity: d.severity, message: d.message, ...(d.line ? { line: d.line } : {}) })),
      dirty,
    }),
    docKey,
    { changed: (p) => p === onDisk.current.doc.path && checkDisk.current(), propose: askWith },
  );
  const copyForAi = async () => {
    if (!type) return;
    await navigator.clipboard.writeText(forYourAi({ yaml: textNow(), type, file: docFile, selection: selection.map((s) => s.id) }));
    notify(t('Copied: paste it into your AI, then paste its YAML back here'));
  };
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
    return items.length > 1 ? { more: { label: t('Show all {count}', { count: items.length }), run: () => setModal('problems') } } : {};
  };
  useEffect(() => {
    if (!toast) return;
    // Gone within five seconds; one with an action to take waits a little longer for it.
    const t = setTimeout(() => setToast(undefined), toast.action ? 8000 : toast.tone ? 5000 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Files edited elsewhere (your AI agent, git, another editor) show up: the folder is read again
  // when the window gets focus, and the open file is watched while the tab is visible (carto serve
  // says when it changes; a folder picked here is asked, or polled for its lastModified). Without
  // unsaved changes the new text comes in as one undoable edit, marked in the Your AI panel; with
  // them, a warning (saving then asks first).
  const onDisk = useRef({ ws, doc, dirty, savedText, docKey });
  onDisk.current = { ws, doc, dirty, savedText, docKey };
  /** The open file as it is on disk now came in from elsewhere. */
  const tookFromDisk = (w: Workspace, path: string, disk: string, side: string | undefined) => {
    const { doc: d, dirty: changed, savedText: base, docKey: key } = onDisk.current;
    if (d.path !== path || base == null || disk === base) return;
    // What the editor has already (its own save, an accepted proposal saved): nothing came in.
    const before = textNow();
    if (disk === before) return setSavedText(disk);
    if (changed) return notify(t('{path} changed on disk. Saving will ask before it overwrites that.', { path }), { tone: 'error' });
    if (side !== undefined && w.files.has(sidecarPath(path))) w.files.set(sidecarPath(path), { ...w.files.get(sidecarPath(path))!, text: side });
    w.files.set(path, { ...w.files.get(path)!, text: disk });
    editor.current?.replace(disk, { pins: readSidecar(w, path) ?? null });
    setSavedText(disk);
    setSavedPins(JSON.stringify(readSidecar(w, path) ?? null));
    setDiskChange({ doc: key, path, before, after: disk });
    askWith();
  };
  useEffect(() => {
    if (!ws) return;
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 1500) return;
      last = Date.now();
      void scan(ws.dir)
        .then((next) => {
          const p = onDisk.current.doc.path;
          const disk = p ? next.files.get(p)?.text : undefined;
          // The open file's cache stays what the editor has until it is taken in below.
          if (p && disk != null && ws.files.has(p)) next.files.set(p, { ...next.files.get(p)!, text: ws.files.get(p)!.text });
          setWs(next);
          if (p && disk != null) tookFromDisk(next, p, disk, next.files.get(sidecarPath(p))?.text);
        })
        .catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ws, notify]);
  useEffect(() => {
    const path = doc.path;
    if (!ws || !path) return;
    let stamp = 0;
    let busy = false;
    const check = async (force = false) => {
      const h = ws.files.get(path)?.handle;
      if (!h || busy || document.hidden) return;
      busy = true;
      try {
        const f = await h.getFile();
        if (!force && f.lastModified === stamp) return;
        stamp = f.lastModified;
        const side = ws.files.get(sidecarPath(path))?.handle;
        tookFromDisk(ws, path, await f.text(), side ? await side.getFile().then((x) => x.text(), () => undefined) : undefined);
      } catch {
        /* gone, or no permission any more: the focus rescan says so */
      } finally {
        busy = false;
      }
    };
    checkDisk.current = () => void check(true);
    void ws.files.get(path)?.handle.getFile().then((f) => (stamp = f.lastModified), () => undefined);
    // carto serve says when a file changes; a folder picked here is asked to say so, or polled.
    if (live.served) return () => void (checkDisk.current = () => undefined);
    const Observer = (window as unknown as { FileSystemObserver?: new (cb: () => void) => { observe(h: unknown): Promise<void>; disconnect(): void } }).FileSystemObserver;
    if (Observer) {
      const o = new Observer(() => void check());
      void o.observe(ws.files.get(path)!.handle).catch(() => undefined);
      return () => o.disconnect();
    }
    const timer = setInterval(() => void check(), 2000);
    return () => clearInterval(timer);
  }, [ws, doc.path]);

  const onChange = (next: string) => {
    setText(next);
    // The "undo open" offer ends with the first edit: it would throw that edit away.
    if (openedText.current != null && next !== openedText.current) {
      openedText.current = null;
      setToast((ts) => (ts?.action?.label === t('Undo') ? undefined : ts));
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
      notify(said ?? t('Opened {name}', { name: nextDoc.name }), {
        ...more,
        action: {
          label: t('Undo'),
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
      if (!d) notify(t('That link does not hold a diagram: it may have been cut short'), { tone: 'error' });
      else {
        setModal(undefined);
        open(d.yaml, { name: d.name ?? 'shared.yaml' }, d.layout, false, t('Opened the shared diagram as {name}', { name: d.name ?? 'shared.yaml' }));
      }
    });
  }, [open, notify]);

  /** Before replacing the document: save it where it lives, or ask. False keeps it open. */
  const leave = async (): Promise<boolean> => {
    if (!dirty) return true;
    if ((ws && doc.path) || fileHandle.current) return save();
    return confirmer.ask({ title: t('Discard the unsaved changes?'), text: t('{name} has changes that are not saved in a file.', { name: doc.name }), ok: t('Discard'), cancel: t('Keep editing') });
  };

  const focusDrawing = () => requestAnimationFrame(() => (document.querySelector('.preview') as HTMLElement | null)?.focus({ preventScroll: true }));

  /** Opening something else over unsaved changes (a template, a drop, a file): asked first, as for a folder. */
  const pick = async (s: Starter) => {
    setModal(undefined);
    if (!(await leave())) return;
    fileHandle.current = undefined;
    open(withUiLang(s.text), { name: s.file, starter: s.id });
    focusDrawing();
  };

  /** From the start dialog: the chosen template or generated YAML, in the chosen way of working. */
  const start = async (o: Opened) => {
    closeModal();
    if (!(await leave())) return;
    fileHandle.current = undefined;
    setView(o.view);
    open(withUiLang(o.text), { name: o.name, starter: o.starter }, o.pins, o.blank);
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
        if (disk != null && savedText != null && disk !== savedText && disk !== now && !(await confirmer.ask({ title: t('Overwrite {path}?', { path: doc.path! }), text: t('{path} was changed outside Cartography since it was opened.', { path: doc.path! }), ok: t('Overwrite'), cancel: t('Keep the file') }))) return false;
        await saveInFolder(ws, doc.path, now, pinsToSave);
        await review.saveTo(ws, doc.path, drawn?.view ? undefined : drawn?.graph);
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
          await review.saveTo(ws, path, drawn?.view ? undefined : drawn?.graph);
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
      notify(t('Saved {name}', { name: doc.path ?? doc.name }));
      return true;
    } catch (e) {
      notify(t('Saving failed: {error}', { error: e instanceof Error ? e.message : String(e) }), { tone: 'error' });
      return false;
    }
  };

  const openFolder = async (dir?: FileSystemDirectoryHandle, given?: Workspace) => {
    try {
      const next = given ?? (dir ? await reopen(dir) : await pickFolder());
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
      else if (meshInFolder(next) || repoInFolder(next) || exportInFolder(next)) return;
      else notify(t('No diagrams in {name} yet: start from a template and save it there', { name: next.name }));
    } catch (e) {
      notify(t('Opening the folder failed: {error}', { error: e instanceof Error ? e.message : String(e) }), { tone: 'error' });
    }
  };

  // Opened by carto serve: its folder is the workspace, read and written through the server.
  useEffect(() => {
    const s = served();
    if (s) void servedFolder(s).then(scan).then((next) => openFolder(undefined, next), (e: unknown) => notify(t('Opening the folder failed: {error}', { error: e instanceof Error ? e.message : String(e) }), { tone: 'error' }));
  }, []);

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
    if (was != null && !/^type:\s*data-products\s*$/m.test(was)) return (notify(t('{path} in {folder} is another kind of diagram: rename it first', { path, folder: w.name }), { tone: 'error' }), true);
    const mesh = meshFrom([...w.files].filter(([p]) => p !== path).map(([p, f]) => ({ path: p, text: f.text })), was != null ? { existing: was } : {});
    if (!mesh?.yaml) return false;
    fileHandle.current = undefined;
    open(mesh.yaml, { name: path, path }, readSidecar(w, path));
    // Not on disk yet, or not like this: ⌘S writes it into the folder.
    setSavedText(was ?? null);
    const more = remember(path, t('From the data products and contracts'), meshNotes(mesh.problems));
    notify(`${t('{summary} in {folder} → {path}', { summary: mesh.summary, folder: w.name, path })}${was != null ? t(', what you added by hand is kept') : ''}${meshRemarks(mesh.problems)}`, { ...more, ...(mesh.problems.some((p) => p.severity === 'error') ? { tone: 'error' } : {}) });
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
    if (was != null && !new RegExp(`^type:\\s*${kind}\\s*$`, 'm').test(was)) return (notify(t('{path} in {folder} is another kind of diagram: rename it first', { path, folder: w.name }), { tone: 'error' }), true);
    const r = exportFrom(files.filter((f) => f.path !== path), was != null ? { existing: was } : {});
    if (!r?.yaml) return (notify(`${t('Nothing to draw in {folder}', { folder: w.name })}${r ? exportRemark(r) : ''}`, { tone: 'error', ...(r ? remember(doc.name, t('From the exports (nothing drawn)'), exportNotes(r)) : {}) }), true);
    fileHandle.current = undefined;
    open(r.yaml, { name: path, path }, readSidecar(w, path));
    setSavedText(was ?? null);
    const more = remember(path, t('From the exports'), exportNotes(r));
    notify(`${t('{summary} in {folder} → {path}', { summary: r.summary, folder: w.name, path })}${was != null ? t(', what you added by hand is kept') : ''}${exportRemark(r)}`, { ...more, ...(r.problems.some((p) => p.severity === 'error') ? { tone: 'error' } : {}) });
    focusDrawing();
    return true;
  };
  /** A code repository in the open folder: its diagrams offered, to be written into diagrams/. False: it is none. */
  const repoInFolder = (w: Workspace): boolean => {
    const files = [...w.files].map(([p, f]) => ({ path: p, text: f.text }));
    if (!isRepo(files)) return false;
    const scan = scanRepo(files, { name: w.name, existing: (file) => w.files.get(file)?.text });
    if (!scan.diagrams.length) return false;
    setRepoOffer({ scan, name: w.name, write: true });
    return true;
  };
  const writeRepo = async (chosen: RepoDiagram[]) => {
    const w = ws;
    setRepoOffer(undefined);
    if (!w || !chosen.length) return;
    if (!(await leave())) return;
    try {
      for (const d of chosen) await writeInFolder(w, d.file, d.yaml);
    } catch (e) {
      return notify(t('Writing the diagrams failed: {error}', { error: e instanceof Error ? e.message : String(e) }), { tone: 'error' });
    }
    const first = chosen[0]!;
    fileHandle.current = undefined;
    open(first.yaml, { name: first.file.split('/').pop()!, path: first.file }, readSidecar(w, first.file));
    setSavedText(first.yaml);
    const kept = chosen.filter((d) => d.kept).length;
    const notes = chosen.flatMap((d) => d.warnings.map((x) => `${d.file}: ${x}`));
    notify(`${t('{count} diagram from the code in {folder} → {dir}|{count} diagrams from the code in {folder} → {dir}', { count: chosen.length, folder: w.name, dir: first.file.includes('/') ? first.file.slice(0, first.file.lastIndexOf('/') + 1) : w.name })}${kept ? t(', what you added by hand is kept in {file}', { file: kept }) : ''}`, remember(first.file, t('From the code'), notes));
    focusDrawing();
  };
  const openRepoDiagram = async (d: RepoDiagram) => {
    const offer = repoOffer;
    setRepoOffer(undefined);
    if (!(await leave())) return;
    fileHandle.current = undefined;
    // In a folder it opens where it will be written (⌘S writes it); dropped, it is a new document.
    if (offer?.write && ws) {
      open(d.yaml, { name: d.file.split('/').pop()!, path: d.file }, readSidecar(ws, d.file));
      setSavedText(ws.files.get(d.file)?.text ?? null);
    } else open(d.yaml, { name: d.file.split('/').pop()! }, undefined, false, t('{summary}, from {sources}', { summary: d.summary, sources: d.sources.join(', ') }), { title: t('From the code'), items: d.warnings });
    focusDrawing();
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
      open(mesh.yaml, { name: `${folder ?? 'data-mesh'}.yaml`, files: mesh.files }, undefined, false, `${t('{summary} as one map', { summary: mesh.summary })}${meshRemarks(mesh.problems)}`, { title: t('From the data products and contracts'), items: meshNotes(mesh.problems) });
      return focusDrawing();
    }
    if (mesh) return notify(`${t('Nothing to draw')}${meshRemarks(mesh.problems) || t(': no data product or contract could be read')}`, { tone: 'error', ...remember(doc.name, t('From the data products and contracts (nothing drawn)'), meshNotes(mesh.problems)) });
    // Access exports (az, Graph, AzureHound) or gh api responses: one access or GitHub diagram.
    const exported = exportFrom(files);
    if (exported?.yaml) {
      if (!(await leave())) return;
      fileHandle.current = undefined;
      open(exported.yaml, { name: `${folder ?? exported.kind}.yaml` }, undefined, false, `${exported.summary}${exportRemark(exported)}`, { title: t('From the exports'), items: exportNotes(exported) });
      return focusDrawing();
    }
    if (exported) return notify(`${t('Nothing to draw')}${exportRemark(exported)}`, { tone: 'error', ...remember(doc.name, t('From the exports (nothing drawn)'), exportNotes(exported)) });
    // A code repository dropped: its diagrams offered, one to open.
    if (isRepo(files)) {
      const scan = scanRepo(files, { name: folder });
      if (scan.diagrams.length) return setRepoOffer({ scan, name: folder ?? 'the drop', write: false });
    }
    const diagram = files.find((f) => /\.ya?ml$/i.test(f.path) && /^type:\s*[\w-]+/m.test(f.text)) ?? (files.length === 1 && /\.ya?ml$/i.test(files[0]!.path) ? files[0] : undefined);
    if (!diagram) return notify(t('Nothing to open there: drop a diagram (.yaml), or data product and data contract files (ODPS, ODCS)'), { tone: 'error' });
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
      .catch((err: unknown) => notify(t('Opening failed: {error}', { error: err instanceof Error ? err.message : String(err) }), { tone: 'error' }));
  };

  const openFile = () => {
    if ('showOpenFilePicker' in window) {
      void (async () => {
        try {
          const hs = await (window as unknown as { showOpenFilePicker(o: object): Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
            multiple: true,
            types: [
              { description: t('Cartography diagram, data products and contracts, or access, GitHub and Azure exports (JSON)'), accept: { 'text/yaml': ['.yaml', '.yml'], 'application/json': ['.json'] } },
              { description: 'draw.io, Excalidraw, Mermaid, D2 or PlantUML, to import', accept: OTHER },
            ],
          });
          const files = await Promise.all(hs.map(async (h) => ((f) => f.text().then((text) => ({ path: f.name, text })))(await h.getFile())));
          await openTexts(files, hs[0]);
        } catch (e) {
          if ((e as Error).name !== 'AbortError') notify(t('Opening failed: {error}', { error: (e as Error).message }), { tone: 'error' });
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

  const exportInput = () => ({ text: editor.current?.text() ?? text, theme, load, sidecar: pins, view: viewName, file: docFile, previous: drawnLayout, step: stepNo, focus: focusAsked, ...lenses, notes: notesInExports ? review.notes : undefined, decisions: decisionsTool.forExport });
  const attempt = (what: string, run: () => Promise<void>) => () =>
    void run().catch((e: unknown) => notify(t('{what} failed: {error}', { what, error: e instanceof Error ? e.message : String(e) }), { tone: 'error' }));
  const saveYaml = () => void save();
  const downloadYaml = () => download(yamlName(doc.name), editor.current?.text() ?? text, 'text/yaml');
  const saveLayout = () => pins && download(`${baseName(doc.name)}.layout.json`, JSON.stringify(pins, null, 2) + '\n', 'application/json');
  // SVG for Office: the same drawing without what PowerPoint and Word drop. The choice is remembered.
  const svgNow = () => (safeSvg ? exportSafeSvg(exportInput()) : exportSvg(exportInput()));
  const saveSvg = attempt(t('Export'), async () => download(`${baseName(doc.name)}.svg`, await svgNow(), 'image/svg+xml'));
  /** Another tool's file is there; what it could not hold is said, not hidden. */
  const handed = (what: string, h: Handed) =>
    h.warnings.length ? notify(h.warnings.length > 1 ? t('{what}. {warning}, and {count} more left out', { what, warning: h.warnings[0]!, count: h.warnings.length - 1 }) : t('{what}. {warning}', { what, warning: h.warnings[0]! }), { action: { label: 'OK', run: () => {} }, ...remember(doc.name, t('{what}: left out', { what }), h.warnings) }) : notify(what);
  const saveDrawio = attempt(t('Export'), async () => {
    const h = await exportDrawio(exportInput());
    download(`${baseName(doc.name)}.drawio`, h.data, 'application/xml');
    handed(t('Saved for draw.io'), h);
  });
  const saveExcalidraw = attempt(t('Export'), async () => {
    const h = await exportExcalidraw(exportInput());
    download(`${baseName(doc.name)}.excalidraw`, h.data, 'application/json');
    handed(t('Saved for Excalidraw'), h);
  });
  const saveMermaid = attempt(t('Export'), async () => {
    const h = await exportMermaid(exportInput());
    download(`${baseName(doc.name)}.mmd`, h.data, 'text/plain');
    handed(t('Saved as Mermaid'), h);
  });
  const copyMermaid = attempt(t('Copy'), async () => {
    const h = await exportMermaid(exportInput());
    await navigator.clipboard.writeText('```mermaid\n' + h.data + '```\n');
    handed(t('Mermaid copied, paste it into a README'), h);
  });
  const savePng = attempt(t('Export'), async () => download(`${baseName(doc.name)}.png`, await exportPng(exportInput(), 2)));
  const saveSlide = attempt(t('Export'), async () => download(`${baseName(doc.name)}-slide.png`, await exportSlide(exportInput())));
  const pptxTemplate = useTemplateChoice(ws, (m) => notify(m, { tone: 'error' }));
  const savePptx = attempt(t('Export'), async () => {
    // In the template chosen in the menu, or the one the theme names (read from the open folder, next to the diagram).
    const read = async (p: string) => (ws ? ((await folderBytes(ws, [...(doc.path?.split('/').slice(0, -1) ?? []), p].join('/'))) ?? (await folderBytes(ws, p))) : undefined);
    const { blob, small, warnings } = await exportPptx(exportInput(), yamlName(doc.name), { bytes: pptxTemplate.chosen?.bytes, keepLook: pptxTemplate.chosen?.keepLook, read });
    download(`${baseName(doc.name)}.pptx`, blob);
    if (warnings.length && !small.length) notify(warnings.length > 1 ? t('In the template: {warning} (and {count} more)', { warning: warnings[0]!, count: warnings.length - 1 }) : t('In the template: {warning}', { warning: warnings[0]! }));
    // Every slide is checked for text too small to read from the back of a room.
    if (small.length) notify(t('{count} slide with text under {min} pt ({list}): split into views, or Tidy for the page|{count} slides with text under {min} pt ({list}): split into views, or Tidy for the page', { count: small.length, min: SLIDE_MIN_PT, list: small.map((x) => t('slide {n}: {pt} pt', { n: x.slide, pt: x.smallestPt })).join(', ') }), { tone: 'error' });
  });
  const pageName = (result?.page ?? drawn?.page)?.name ?? t('16:9 slide');
  const savePageSvg = attempt(t('Export'), async () => download(`${baseName(doc.name)}-page.svg`, await exportPageSvg(exportInput()), 'image/svg+xml'));
  const savePdf = attempt(t('Export'), async () => download(`${baseName(doc.name)}.pdf`, await exportPdf(exportInput(), yamlName(doc.name))));
  const saveHtml = (folder?: boolean) =>
    attempt(t('Export'), async () => {
      const page = await (await import('./html-export.ts')).exportPage({ file: ws && doc.path ? doc.path : yamlName(doc.name), text: editor.current?.text() ?? text, ws, load, pins, notes: notesInExports ? review.notes : undefined, decisions: decisionsTool.forExport?.list, folder });
      download(`${folder && ws ? ws.name : baseName(doc.name)}.html`, page, 'text/html');
    })();
  const copySvg = attempt(t('Copy'), async () => {
    await navigator.clipboard.writeText(await svgNow());
    notify(t('SVG copied'));
  });
  // A share link carries the diagram in its #fragment, which never reaches a server.
  const copyShare = attempt(t('Share'), async () => {
    const link = await shareLink({ yaml: editor.current?.text() ?? text, name: doc.name, layout: pins, ...(brand().choice && themes[brand().choice] ? { theme: brand().choice } : {}) }, location.origin + location.pathname);
    if (link.length > SHARE_LIMIT) {
      notify(t('Too large for a link: {size} kB where {limit} kB is the most links safely carry. Share the YAML file instead.', { size: Math.ceil(link.length / 1000), limit: SHARE_LIMIT / 1000 }), { tone: 'error' });
      return;
    }
    await navigator.clipboard.writeText(link);
    const away = result?.includes?.length ? (result.includes.length === 1 ? t(' It does not carry the included file.') : t(' It does not carry the {count} included files.', { count: result.includes.length })) : '';
    notify(`${t('Share link copied: it opens read-only, and the diagram travels in the link itself, nothing was uploaded.')}${away}`);
  });
  // The drawing on screen in words (docs/describe.md), and with its picture for a wiki page.
  const description = () => describeResult(result ?? drawn, docFile);
  const copyForWiki = attempt(t('Copy'), async () => {
    const d = description();
    if (!d) throw new Error(t('Nothing to copy: fix the problems first'));
    await copyRich(exportInput(), d);
    notify(t('Picture and description copied: paste into Confluence, Notion or Google Docs'));
  });
  const copyPng = attempt(t('Copy'), async () => {
    // Safari wants the ClipboardItem created right in the click, with the PNG still on its way.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': exportPng(exportInput(), 2) })]);
    notify(t('PNG copied, paste it into slides or docs'));
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
    if (next == null) return notify(t('That change did not work on this YAML: fix the problems in the editor, or make it there'), { tone: 'error' });
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
  /**
   * Tidy: lays out afresh everything that is not pinned, around what is (pins, locks and bent lines
   * stay). The drawing before is forgotten, so the rest is placed as a new drawing would place it.
   */
  const tidyLayout = () => {
    previewControl.current?.fitNext();
    setFresh((n) => n + 1);
    if (!vpins) return void acted();
    const { layout: _, ...kept } = vpins;
    pinTo(kept.nodes || kept.groups || kept.edges ? kept : tracked ? { version: 1, layout: { at: '' } } : null);
    notify(pinCount ? count(pinCount, 'Tidied: {count} pinned element stayed, the rest is laid out afresh (⌘Z undoes it)|Tidied: {count} pinned elements stayed, the rest is laid out afresh (⌘Z undoes it)') : t('Tidied: laid out afresh'));
  };
  /** Tidy all: unpins everything and lays it out afresh, as one undo step. */
  const tidyAll = () => {
    previewControl.current?.fitNext();
    resetLayout();
    if (vpins) notify(pinCount ? count(pinCount, 'Unpinned {count} element and laid it all out afresh|Unpinned {count} elements and laid it all out afresh') : t('Laid it all out afresh'), { action: { label: t('Undo'), run: () => editor.current?.undo() } });
  };
  /** Pins the selected nodes and groups where they are, or unpins them when all are pinned: the layout places them again. */
  const togglePin = () => {
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const items = selection.filter((s) => s.kind !== 'edge' && (s.kind === 'node' ? result?.placed?.nodes.has(s.id) : result?.placed?.groups.has(s.id)));
    if (!items.length || !current) return;
    const isPinned = (s: Selection) => (s.kind === 'node' ? vpins?.nodes?.[s.id] : vpins?.groups?.[s.id]);
    const unpin = items.every(isPinned);
    if (unpin && items.some((s) => locked.has(s.id))) return notify(t('Locked: unlock it first (⇧⌘L)'));
    const at = (s: Selection) => {
      const b = (s.kind === 'node' ? result!.placed!.nodes : result!.placed!.groups).get(s.id)!;
      return unpin ? undefined : { x: Math.round(b.x + shift.x), y: Math.round(b.y + shift.y) };
    };
    pinTo(withPins(Object.fromEntries(items.filter((s) => s.kind === 'node').map((s) => [s.id, at(s)])), Object.fromEntries(items.filter((s) => s.kind === 'group').map((s) => [s.id, at(s)]))));
    notify(unpin ? count(items.length, 'Unpinned {count} element: the layout places it|Unpinned {count} elements: the layout places it') : count(items.length, 'Pinned {count} element: it stays where it is|Pinned {count} elements: it stays where it is'));
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
    notify(result?.graph ? t('One moment: the drawing is catching up with the text') : t('Fix the problems in the YAML first'), { tone: 'error' });
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
    apply(stages.onAdd(r.text, r.path), at && drawnAt ? withPin(drawnAt.id, at, drawnAt.kind === 'group') : undefined);
    // The label is what people change first: selected and focused once it is drawn.
    setPendingPath(JSON.stringify(r.path));
  };

  /** Deletes the selection (or another element, e.g. a line from the inspector's connection list). */
  const remove = (sel: Selection | undefined = selected) => {
    const path = pathOf(sel);
    if (!path || !sel || !type || !ready()) return;
    // While a later stage is picked, deleting records that it goes in that stage.
    if (stages.onRemove([sel])) return;
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
      notify(t('This one is part of a larger entry: change it in the YAML'), { tone: 'error' });
      const e = entries.find((x) => x.kind === sel.kind && x.id === sel.id);
      if (e) editor.current?.reveal(e.from, e.to);
      return;
    }
    const next = stages.tidy(deleteEntry(textNow(), type, path));
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
    if (stages.onRemove(selection)) return;
    const tx = textNow();
    const chain = selection.filter((s) => s.kind === 'edge' && isChainLine(tx, type, s.id));
    const rest = selection.filter((s) => !chain.includes(s));
    const paths = rest.map(pathOf).filter((p): p is Path => !!p && (isEntryPath(p) || typeof p.at(-1) === 'number' || isScalarAt(tx, p)));
    if (!paths.length && !chain.length) return notify(t('These are parts of larger entries: change them in the YAML'), { tone: 'error' });
    // Arrows of chains and whole list items go together, last written first, so the places of the
    // others stay right; an arrow in an item that goes anyway is left alone.
    const place = (p: Path | undefined) => (typeof p?.at(-1) === 'number' ? (p.at(-1) as number) : -1);
    const items = paths.filter((p) => place(p) >= 0);
    const ops = [...items.map((p) => ({ at: place(p), path: p, id: '' })), ...chain.map((s) => ({ at: place(pathOf(s)), path: undefined, id: s.id }))];
    ops.sort((a, b) => b.at - a.at || Number(!!b.path) - Number(!!a.path) || b.id.localeCompare(a.id, undefined, { numeric: true }));
    let next: string | undefined = tx;
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
    apply(stages.tidy(next), nextPins);
    if (next != null) {
      setSelection([]);
      if (paths.length < rest.length) notify(t('Deleted {count}; {kept} that are part of larger entries stayed', { count: paths.length + chain.length, kept: rest.length - paths.length }));
    }
  };

  /** Copies the selected entries (with the lines between them) to the app's clipboard. */
  const copy = (announce = true): Clip | undefined => {
    if (!type || !ready()) return undefined;
    const clip = copyEntries(textNow(), type, selection.map(pathOf).filter((p): p is Path => !!p));
    if (!clip) {
      if (announce) notify(t('Nothing to copy: select shapes or groups'), { tone: 'error' });
      return undefined;
    }
    clipboard = clip;
    if (announce) notify(count(clip.entries.length, 'Copied {count} element|Copied {count} elements'));
    return clip;
  };
  /** Pastes under new ids, selected afterwards, as one undo step. The copies are not pinned: the layout gives
   * them a free spot, where a fixed offset would put them over the originals or inside a group they are not in. */
  const paste = (clip: Clip | undefined = clipboard) => {
    if (!clip || !type || !ready()) return;
    if (clip.type !== type.id) return notify(t('That was copied from another kind of diagram ({type})', { type: typeName(clip.type) }), { tone: 'error' });
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
      if (renamed != null) {
        if (t.kind === 'node' || t.kind === 'group') review.rename(t.kind, t.id, value.trim());
        return apply(renamed);
      }
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
    // Review notes on it, and on its lines, go along.
    if (selected.kind !== 'edge') review.rename(selected.kind, selected.id, nodeId);
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
    // A drawing wholly in view before a drag fits again when the drag took it past the edge.
    if (!done && !draft) dragStartedInView.current = previewControl.current?.wholly() ?? false;
    if (!done) return setDraft({ nodes: moved });
    previewControl.current?.keepInView(dragStartedInView.current);
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
    return text == null ? undefined : { text, message: g ? t('Moved into {group}', { group: g.label }) : t('Moved out of its group') };
  };

  const connect = (from: string, to: string) => {
    if (!type || !ready()) return;
    const r = connectEntries(textNow(), type, from, to);
    if ('error' in r) return notify(r.error, { tone: 'error' });
    apply(r.text);
    notify(t('Connected {from} to {to}', { from: nodeName(from), to: nodeName(to) }));
    // The new line is selected once drawn, with its label ready to type.
    setPendingEdge({ from, to, count: result?.graph?.edges.length ?? 0 });
  };

  const nudge = (dx: number, dy: number) => {
    if (!current) return;
    const shift = result?.placed?.shift ?? { x: 0, y: 0 };
    const moved: Record<string, Point> = {};
    const groups: Record<string, Point> = {};
    for (const s of selection) {
      if (locked.has(s.id)) continue;
      const box = s.kind === 'node' ? result?.placed?.nodes.get(s.id) : s.kind === 'group' ? result?.placed?.groups.get(s.id) : undefined;
      if (box) (s.kind === 'group' ? groups : moved)[s.id] = { x: Math.round(box.x + shift.x + dx), y: Math.round(box.y + shift.y + dy) };
    }
    // A group moves with everything in it: what is pinned inside moves along.
    const graph = result?.graph;
    const inside = (id: string, g: string) => {
      for (let p = graph?.nodes.find((n) => n.id === id)?.parent ?? graph?.groups.find((x) => x.id === id)?.parent; p; p = graph?.groups.find((x) => x.id === p)?.parent) if (p === g) return true;
      return false;
    };
    const next = Object.keys(moved).length || Object.keys(groups).length ? withPins(moved, groups) : undefined;
    if (next && Object.keys(groups).length) {
      for (const [id, at] of Object.entries(next.nodes ?? {})) if (!moved[id] && Object.keys(groups).some((g) => inside(id, g))) next.nodes![id] = { x: at.x + dx, y: at.y + dy };
      for (const [id, at] of Object.entries(next.groups ?? {})) if (!groups[id] && Object.keys(groups).some((g) => inside(id, g))) next.groups![id] = { x: at.x + dx, y: at.y + dy };
    }
    if (next !== undefined) pinTo(next);
    else if (selection.some((s) => locked.has(s.id))) notify(t('Locked: unlock it first (⇧⌘L)'));
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
    if (boxes.length < need) return notify(t('Select {count} or more shapes first', { count: need }), { tone: 'error' });
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
    notify(unlock ? count(items.length, 'Unlocked {count} element|Unlocked {count} elements') : count(items.length, 'Locked {count} element: it stays where it is|Locked {count} elements: it stays where it is'));
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
    const arrange = arrangeKey(e);
    if (arrange) {
      arrangeSelection(arrange);
      return e.preventDefault();
    }
    // The drawing's keys, by the table in keys.ts (the sheet shows the same).
    const id = shortcutFor(e, drawn?.focus ? ['drawing', 'focus'] : ['drawing']);
    const step = e.shiftKey ? NUDGE * 5 : NUDGE;
    switch (id) {
      case 'undo': editor.current?.undo(); break;
      case 'redo': editor.current?.redo(); break;
      case 'duplicate': duplicate(); break;
      case 'copy': copy(); break;
      case 'paste': paste(); break;
      case 'select-all': selectMany([...(result?.graph?.nodes ?? []).map((n) => ({ kind: 'node' as const, id: n.id }))], false); break;
      case 'delete': selection.length > 1 ? removeAll() : remove(); break;
      case 'escape': selection.length || !focusOn ? setSelection([]) : leaveFocus(); break;
      case 'focus': focusOnSelection(); break;
      case 'focus-hops': focusHops(e.key === '-' ? -1 : 1); break;
      case 'focus-direction': focusDirection(); break;
      case 'lock': toggleLock(); break;
      case 'pin': togglePin(); break;
      case 'tidy': tidyLayout(); break;
      case 'grid':
      case 'minimap':
      case 'page': craft.toggle(id); break;
      case 'nearest': focusToward(e.key.slice(5).toLowerCase() as Direction); break;
      case 'step-by': stepBy(e.key === ']' ? 1 : -1); break;
      case 'stage-by': if (!stages.onKey(e)) return; break;
      case 'step': addStepFromSelection(); break;
      case 'next-view': nextView(); break;
      case 'nudge': nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0); break;
      case 'cycle': if (!cycle(e.shiftKey ? -1 : 1)) return; break;
      case 'add': addShape(); break;
      case 'connect': if (selected?.kind !== 'node') return; setModal('connect'); break;
      case 'layers': if (!layers.onKey(e)) return; break;
      case 'note': addNote(); break;
      case 'notes': toggleNotes(); break;
      case 'review': toggleReview(); break;
      case 'decisions': decisionsTool.toggle(); break;
      case 'decision-new': decisionsTool.newAbout(); break;
      case 'arch-review': reviewTool.toggle(); break;
      case 'edit':
        if (!selected) return;
        if (e.key === 'F2') (document.querySelector('.inspector-body > .field input') as HTMLInputElement | null)?.select();
        else (document.querySelector('.inspector input, .inspector select') as HTMLElement | null)?.focus();
        break;
      default: return;
    }
    e.preventDefault();
  };

  // ------------------------------------------------------------ links and views

  /** This diagram's path in its folder (or under examples/): links to other diagrams are relative to it. */
  const here = ws && doc.path ? doc.path : doc.starter?.startsWith('example:') ? doc.starter.slice('example:'.length) : undefined;

  /** Follows a link: a URL in a new tab, another view here, or another diagram (and view) next to this one. */
  const follow = (link: Link) => {
    const to = linkTarget(link, here);
    if (to.kind === 'url') return void window.open(to.url, '_blank', 'noopener');
    if (to.kind === 'none') return notify(to.why, { tone: 'error' });
    if (to.kind === 'view') return setPicked({ doc: docId, name: to.view });
    if (ws && doc.path) {
      if (!ws.files.has(to.path)) return notify(t('There is no {path} in {folder}', { path: to.path, folder: ws.name }), { tone: 'error' });
      setPicked({ doc: to.path, name: to.view });
      return void openInFolder(ws, to.path);
    }
    const s = starters.find((x) => x.id === `example:${to.path}`);
    if (!s) return notify(t('There is no example {path}', { path: to.path }), { tone: 'error' });
    setPicked({ doc: s.id, name: to.view });
    void pick(s);
  };

  // ------------------------------------------------------------ views

  /** The views to pick from, in the picker's order: as written first where there is such a drawing. */
  const viewList = (): (string | undefined)[] => (drawn?.views?.length ? [...(drawn.onlyViews ? [] : [undefined]), ...drawn.views.map((v) => v.name)] : []);
  const viewTitle = (name?: string) => (name === undefined ? t('as written') : (drawn?.views?.find((v) => v.name === name)?.title ?? name));
  const showView = (name: string | undefined) => {
    setPicked({ doc: docId, name });
    notify(t('View: {view}', { view: viewTitle(name) }));
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
    if (list.length < 2) return notify(t('This diagram has one view'));
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
    if (!selection.length) return focusOn ? leaveFocus() : notify(t('Select what to focus on, then press F'));
    const ends = (id: string) => g.edges.filter((e) => e.id === id).flatMap((e) => [e.from.node, e.to.node]);
    const on = [...new Set(selection.flatMap((x) => (x.kind === 'edge' ? ends(x.id) : [x.id])))];
    if (!on.length) return;
    const now = drawn?.focus;
    setFocus({ on, hops: !now ? 1 : now.hops === Infinity ? 'all' : now.hops, direction: now?.direction ?? 'both' });
  };
  const refocus = (change: (now: Focus) => Partial<Pick<Focus, 'hops' | 'direction'>>) => {
    const now = drawn?.focus;
    if (!now) return notify(t('No focus yet: select something and press F'));
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
    notify(why ? why.message.replace(/^Focus: /, '') : t('Nothing to focus on there'));
  }, [result]);

  // ------------------------------------------------------------ steps and presenting

  const stepList = drawn?.steps ?? [];
  /** Steps somebody wrote: PowerPoint and PDF get a slide or page for each. */
  const written = stepList.length > 0 && !drawn?.stepsImplied;
  const pickStep = (n: number | undefined) => setStepAt(n ? { doc: docId, view: viewName, n } : undefined);
  /** [ and ]: through the steps, and past the last one back to the whole drawing. */
  const stepBy = (dir: 1 | -1) => {
    if (!stepList.length) return notify(t('No steps yet: select what a step is about and press S'));
    pickStep(((drawn?.step ?? 0) + dir + stepList.length + 1) % (stepList.length + 1) || undefined);
  };
  /** A step edit as one undo step; without text the YAML could not take it. */
  const editSteps = (next: string | undefined, show?: number) => {
    if (next == null) return notify(drawn?.view ? t('The steps of {view} are not written in this file, or its YAML has problems: change them there', { view: drawn.view }) : t('That change did not work on these steps: make it in the YAML'), { tone: 'error' });
    apply(next);
    if (show) pickStep(show);
  };
  /** S: a new step after the one shown, with the selection as its focus. */
  const addStepFromSelection = () => {
    const g = drawn?.graph;
    if (!ready() || !g) return;
    if (drawn?.stepsImplied) return notify(g.steps?.length ? t('This view is told by its numbered lines already') : t('A sequence diagram is told message by message already'));
    const edgeOf = (id: string) => g.edges.find((e) => e.id === id);
    const focus = selection.flatMap((x) => (x.kind !== 'edge' ? [x.id] : edgeOf(x.id) ? [`${edgeOf(x.id)!.from.node} -> ${edgeOf(x.id)!.to.node}`] : []));
    const names = selection.map((x) => (x.kind === 'node' ? nodeName(x.id) : x.kind === 'group' ? (g.groups.find((y) => y.id === x.id)?.label ?? x.id) : edgeOf(x.id) ? `${nodeName(edgeOf(x.id)!.from.node)} to ${nodeName(edgeOf(x.id)!.to.node)}` : x.id));
    const n = (drawn?.step ?? stepList.length) + 1;
    const next = addStep(textNow(), stepsPath(drawn?.view), { title: names.length === 1 ? names[0]! : names.length === 2 ? names.join(' and ') : `Step ${n}`, focus }, drawn?.step);
    editSteps(next, n);
    if (next) {
      setNaming(n);
      notify(t('Step {n} added: {what}', { n, what: names.length === 1 ? names[0]! : names.length === 2 ? t('{a} and {b}', { a: names[0]!, b: names[1]! }) : t('{count} elements stand out', { count: names.length }) }), { action: { label: t('Undo'), run: () => editor.current?.undo() } });
    }
  };
  const present = () => {
    if (!drawn?.svg) return notify(t('Nothing to present yet: fix the problems in the YAML first'), { tone: 'error' });
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
            ? withDrawnName(fieldsFor(text, type, selectedPath), selNode ? label(selNode) : selGroup?.label)
            : isEdgeItem
              ? edgeFields(text, type, selectedPath)
              : []
        : [],
    [type, isEntry, isEdgeItem, isChain, selEdge?.label, selectedPath, text, selNode, selGroup],
  );
  /** The selection has properties to show (one element, or several to arrange). */
  const hasProperties = !!(selected && type && (selNode || selGroup || selEdge)) || selection.length > 1;
  /** One panel on the right, with tabs: the selection's properties, the review notes, the decisions, or Ask. */
  const sideTab: 'properties' | 'notes' | 'decisions' | 'review' | 'ask' = asking ? 'ask' : notesOpen ? 'notes' : decisionsOpen ? 'decisions' : archReviewOpen ? 'review' : 'properties';
  const showInspector = sideTab === 'properties' && inspector && hasProperties;
  const sideOpen = asking || notesOpen || decisionsOpen || archReviewOpen || showInspector;
  const showSide = (tab: typeof sideTab) => {
    setAsking(tab === 'ask');
    setDecisionsOpen(tab === 'decisions');
    setArchReviewOpen(tab === 'review');
    if (tab === 'ask') setAskKept(true);
    if (tab !== 'notes' && notesOpen) toggleNotes();
    else if (tab === 'notes' && !notesOpen) setNotesOpen(true);
    if (tab === 'properties') setInspector(true);
  };
  const panes = paneLayout({ width: windowWidth, folder: !!ws, files: filesPref, view, editor: { width: split * windowWidth, folded: yamlFolded }, forceEditor: forceYaml, side: inspector || sideOpen });
  /** A diagram with nothing in it yet: the canvas says how to start. */
  const empty = !!result?.graph && current && !result.graph.nodes.length && !result.graph.groups.length;
  const quick = useMemo(() => {
    const items = type?.palette ?? [];
    // Shapes first (not containers), then whatever there is.
    return [...items.filter((i) => i.collection !== 'groups'), ...items.filter((i) => i.collection === 'groups')].slice(0, 4);
  }, [type]);
  const kindLabel = (path: Path | undefined) => (path ? String(path[0]).replace(/ies$/, 'y').replace(/(ss)es$/, '$1').replace(/(?<!s)s$/, '').replace(/-/g, ' ') : '');
  const nodeName = (id: string) => {
    const n = result?.graph?.nodes.find((x) => x.id === id);
    return n ? label(n) : id;
  };
  /** The focused element as a screen reader says it: name, kind, and whether it is pinned or locked. */
  const describe = (s: Selection) => {
    const g = result?.graph;
    const e = s.kind === 'edge' ? g?.edges.find((x) => x.id === s.id) : undefined;
    const name = s.kind === 'node' ? nodeName(s.id) : s.kind === 'group' ? (g?.groups.find((x) => x.id === s.id)?.label ?? s.id) : e ? `${t('Line from {from} to {to}', { from: nodeName(e.from.node), to: nodeName(e.to.node) })}${e.label ? `, ${e.label}` : ''}` : s.id;
    const kind = s.kind === 'edge' ? '' : `, ${kindLabel(pathOf(s)) || s.kind}`;
    const state = locked.has(s.id) ? t(', locked') : (s.kind === 'node' ? vpins?.nodes?.[s.id] : s.kind === 'group' ? vpins?.groups?.[s.id] : bent.has(s.id)) ? (s.kind === 'edge' ? t(', bent by hand') : t(', pinned')) : '';
    return `${name}${kind}${state}`;
  };

  // ------------------------------------------------------------ the folder as one model (workspace/)

  /** The decisions tool, for where-used (made after the workspace tools, which it reads). */
  const decisionsRef = useRef<ReturnType<typeof useDecisionsTool>>(undefined);
  const wsTools = useWorkspaceTools({
    ws,
    file: ws && doc.path ? doc.path : docId,
    inFolder: !!(ws && doc.path),
    text: rendered?.text ?? text,
    textNow,
    pins,
    drawn,
    view: viewName,
    selected,
    current,
    open: async (file, name) => {
      setPicked({ doc: file, name });
      if (ws) await openInFolder(ws, file);
    },
    showView: (name) => setPicked({ doc: docId, name }),
    select: (s) => select(s),
    focus: (node, name) => setLens({ doc: docId, view: name, focus: { on: [node], hops: 1, direction: 'both' } }),
    zoomToSelection: () => previewControl.current?.zoomToSelection(),
    fit: () => previewControl.current?.fit(),
    reveal: (from, to) => editor.current?.reveal(from, to),
    replace: (next, nextPins) => editor.current?.replace(next, { pins: nextPins }),
    refresh: (w) => setWs({ ...w }),
    noteIds: () => review.notes.threads.flatMap((t) => (t.anchor.kind === 'node' || t.anchor.kind === 'group' ? [t.anchor.id] : t.anchor.kind === 'edge' ? [t.anchor.from, t.anchor.to] : [])),
    renameNotes: (node) => {
      const ids = new Map<string, 'node' | 'group'>();
      for (const { anchor: a } of review.notes.threads) {
        if (a.kind === 'node' || a.kind === 'group') ids.set(a.id, a.kind);
        else if (a.kind === 'edge') for (const id of [a.from, a.to]) if (!ids.has(id)) ids.set(id, 'node');
      }
      for (const [id, kind] of ids) if (node(id) !== id) review.rename(kind, id, node(id));
    },
    notify,
    whereExtra: (el) => decisionsRef.current?.whereSection(el),
    openDecision: (file) => {
      const d = wsTools.index.decisions.find((x) => x.file === file);
      if (d) decisionsTool.show(d.number);
      return !!d;
    },
  });

  // Architecture decisions (decisions-panel.tsx): the panel, the markers, their keys and commands.
  const decisionsTool = useDecisionsTool({
    ws,
    index: wsTools.index,
    file: ws && doc.path ? doc.path : docId,
    drawn,
    selected,
    selection,
    select: (s) => select(s),
    zoomToSelection: () => previewControl.current?.zoomToSelection(),
    focusDrawing,
    refresh: (w) => setWs({ ...w }),
    notify,
    open: decisionsOpen,
    setOpen: setDecisionsOpen,
  });
  decisionsRef.current = decisionsTool;

  // Architecture review (review-panel.tsx): the Review tab, its flags on the drawing, its commands.
  const reviewTool = useReviewTool({
    ws,
    drawn,
    text: rendered?.text ?? text,
    textNow,
    load,
    inline: !!(type?.schema as { properties?: { nodes?: { additionalProperties?: { anyOf?: { properties?: object }[] } } } } | undefined)?.properties?.nodes?.additionalProperties?.anyOf?.some((x) => !!x.properties && 'review' in x.properties),
    select: (s) => select(s),
    zoomToSelection: () => previewControl.current?.zoomToSelection(),
    focusDrawing,
    notify,
    apply: (yaml) => apply(yaml),
    decide: (title, about, context) => (setArchReviewOpen(false), decisionsTool.newWith(title, about, context)),
    open: archReviewOpen,
    setOpen: (o) => (o ? showSide('review') : setArchReviewOpen(false)),
  });
  // One panel on the right at a time: notes and decisions take turns.
  useEffect(() => {
    if (notesOpen && decisionsTool.open) decisionsTool.close();
  }, [notesOpen]);
  useEffect(() => {
    if (decisionsTool.open && notesOpen) toggleNotes();
  }, [decisionsTool.open]);

  // Trace a request through the drawing into a sequence diagram (trace/).
  const trace = useTrace({
    ws,
    file: ws && doc.path ? doc.path : docId,
    inFolder: !!(ws && doc.path),
    text: rendered?.text ?? text,
    drawn,
    current,
    selection,
    theme,
    index: wsTools.index,
    // In a folder the diagram traced is saved first; outside one the toast's Undo brings it back.
    openNew: (next, name, path) =>
      void (path ? leave() : Promise.resolve(true)).then((ok) => {
        if (!ok) return;
        fileHandle.current = undefined;
        open(next, path ? { name, path } : { name }, undefined, false, t('Traced into {name}: ⌘S keeps it', { name }));
        if (path) notify(t('Traced into {path}: ⌘S writes it into the folder', { path }));
        setSavedText(null);
        focusDrawing();
      }),
    replace: (next, name) => {
      editor.current?.replace(next);
      if (name) setPicked({ doc: docId, name });
    },
    go: (p) => void wsTools.go(p),
    notify,
  });

  // Reusable fragments (blocks/): the shapes panel's Blocks section, B and ⇧B, drops, updates.
  const blocks = useBlocks({
    ws,
    refresh: (w) => setWs({ ...w }),
    inFolder: !!(ws && doc.path),
    type,
    text: rendered?.text ?? text,
    textNow,
    drawn,
    current,
    selection,
    pathOf: (s) => pathOf(s),
    theme,
    // An inserted block grows the drawing: fit it again (review 3: it ran past the edge, under the
    // minimap); dropped at a point it stays where dropped, kept in view.
    apply: (next, nodePins) => (nodePins ? previewControl.current?.keepInView(true) : previewControl.current?.fitNext(), apply(next, nodePins ? withPins(nodePins) : undefined)),
    selectPaths: (paths) => setPendingPaths(paths.map((p) => JSON.stringify(p))),
    notify,
  });

  // ------------------------------------------------------------ commands

  // Compare with an earlier version (compare/): its commands, its view over the drawing and its dialogs.
  const comparing = useCompare({
    docKey: ws && doc.path ? `${ws.name}/${doc.path}` : docId,
    docName: doc.name,
    path: ws ? doc.path : undefined,
    ws,
    text,
    textNow,
    pins,
    savedText,
    savedPins,
    load,
    file: docFile,
    view: drawn?.view ?? viewName,
    theme,
    blocked: !!modal || presenting,
    notify,
    onSelect: (s) => select(s),
  });
  const layers = layering.ui(drawn, comparing.active);
  const stages = staging.ui({
    drawn,
    textNow,
    apply: (next) => apply(next),
    notify,
    compare: comparing.stages,
    openDoc: (next, name, said) => void leave().then((ok) => ok && (open(next, { name }, undefined, false, said), focusDrawing())),
    name: doc.name,
  });

  /** What the last import or export said, while its document is open. */
  const shownNotes = notes?.doc === doc.name ? notes : undefined;
  const buildCommands = (): Command[] => [
    { id: 'ask', group: t('Your AI'), label: asking ? t('Close Your AI') : t('Your AI…'), hint: t('proposals from your own AI agent, through the MCP server'), icon: 'sparkles', shortcut: keyHint('ask'), run: toggleAsk },
    ...(type ? [{ id: 'copy-for-ai', group: t('Your AI'), label: t('Copy for your AI'), hint: t('the YAML, its schema and instructions, to paste into any chat'), icon: 'copy', run: () => void copyForAi() }] : []),
    ...wsTools.commands,
    ...trace.commands,
    ...blocks.commands,
    { id: 'new', group: t('File'), label: t('New diagram…'), hint: t('template, then AI, builder or YAML'), icon: 'file-plus', run: () => setModal('templates') },
    view === 'visual'
      ? { id: 'view-code', group: t('View'), label: t('Show the YAML'), icon: 'code', shortcut: keyHint('switch-view'), run: () => setView('code') }
      : { id: 'view-visual', group: t('View'), label: t('Builder (hide the YAML)'), icon: 'mouse-pointer-2', shortcut: keyHint('switch-view'), run: () => setView('visual') },
    { id: 'open', group: t('File'), label: t('Open file…'), hint: t('a diagram; data products and contracts; az, Graph, AzureHound or gh api JSON; draw.io, Excalidraw or Mermaid to import'), icon: 'folder-open', shortcut: keyHint('open'), run: openFile },
    { id: 'save', group: t('File'), label: ws && doc.path ? t('Save {path}', { path: doc.path }) : t('Save'), icon: 'save', shortcut: keyHint('save'), run: saveYaml },
    { id: 'download', group: t('File'), label: t('Download YAML'), icon: 'download', run: downloadYaml },
    ...(canUseFolders ? [{ id: 'folder', group: t('File'), label: t('Open folder…'), icon: 'folder-open', run: () => void openFolder() }] : []),
    ...(ws && meshInWs ? [{ id: 'mesh', group: t('File'), label: t('Data mesh map of {folder}', { folder: ws.name }), hint: t('its data products and contracts (ODPS, ODCS) in data-mesh.yaml'), icon: 'waypoints', run: () => void leave().then((ok) => ok && meshInFolder(ws)) }] : []),
    ...(ws && repoInWs ? [{ id: 'repo', group: t('File'), label: t('Diagrams from the code in {folder}', { folder: ws.name }), hint: t('Compose, Helm, Bicep, OpenAPI, AsyncAPI, workflows → diagrams/'), icon: 'folder-git-2', run: () => void leave().then((ok) => ok && repoInFolder(ws)) }] : []),
    ...(ws && exportInWs ? [{ id: 'export', group: t('File'), label: EXPORT_ENTRY[exportInWs].label(ws.name), hint: say(EXPORT_ENTRY[exportInWs].hint), icon: EXPORT_ENTRY[exportInWs].icon, run: () => void leave().then((ok) => ok && exportInFolder(ws)) }] : []),
    ...(ws ? diagrams(ws).map((p) => ({ id: `file:${p}`, group: t('Files in {folder}', { folder: ws.name }), label: p, icon: 'file-code', run: () => void openInFolder(ws, p) })) : []),
    ...(pins ? [{ id: 'save-layout', group: t('File'), label: t('Save layout (.layout.json)'), icon: 'save', run: saveLayout }] : []),
    { id: 'svg', group: t('Export'), label: t('Export SVG'), icon: 'download', shortcut: keyHint('export-svg'), run: saveSvg },
    { id: 'png', group: t('Export'), label: t('Export PNG (2×)'), icon: 'image', shortcut: keyHint('export-png'), run: savePng },
    { id: 'slide', group: t('Export'), label: t('PNG on the page ({page})', { page: pageName }), icon: 'monitor', run: saveSlide },
    { id: 'page-svg', group: t('Export'), label: t('SVG on the page ({page})', { page: pageName }), icon: 'monitor', run: savePageSvg },
    { id: 'pptx', group: t('Export'), label: written ? t('PowerPoint slides, one per step (.pptx)') : t('PowerPoint slide (.pptx)'), icon: 'layout-template', run: savePptx },
    { id: 'pdf', group: t('Export'), label: written ? t('Export PDF, a page per step') : t('Export PDF'), icon: 'file-text', run: savePdf },
    { id: 'animate', group: t('Export'), label: t('Animation (GIF / MP4)…'), hint: t('the steps or layers, a short blend between them'), icon: 'circle-play', run: () => setTimeout(() => setAnimating(true)) },
    { id: 'html', group: t('Export'), label: t('Interactive HTML (.html)'), hint: t('one file to send: every view and step, zoom, search, drill-down'), icon: 'globe', run: () => saveHtml() },
    ...(ws ? [{ id: 'html-folder', group: t('Export'), label: t('Interactive HTML of {folder}', { folder: ws.name }), hint: t('every diagram in the folder, with a contents page'), icon: 'globe', run: () => saveHtml(true) }] : []),
    { id: 'copy-png', group: t('Export'), label: t('Copy as PNG'), icon: 'copy', run: copyPng },
    { id: 'describe', group: t('Export'), label: t('Describe in words…'), hint: t('what the diagram shows, for a screen reader or a handout; copy as text or Markdown'), icon: 'scroll-text', run: () => setTimeout(() => setDescribing(true)) },
    { id: 'copy-wiki', group: t('Export'), label: t('Copy for Confluence / Notion'), hint: t('the picture and the description in one paste'), icon: 'book-open', run: copyForWiki },
    { id: 'copy-svg', group: t('Export'), label: t('Copy as SVG'), icon: 'copy', run: copySvg },
    { id: 'svg-safe', group: t('Export'), label: safeSvg ? t('SVG as drawn (SVG for PowerPoint / Word off)') : t('SVG for PowerPoint / Word on'), hint: t('an SVG that PowerPoint, Word and Keynote take whole'), icon: 'monitor', run: toggleSafeSvg },
    { id: 'drawio', group: t('Export'), label: t('Export for draw.io (.drawio)'), hint: t('editable shapes, every view a page'), icon: 'workflow', run: saveDrawio },
    { id: 'excalidraw', group: t('Export'), label: t('Export for Excalidraw (.excalidraw)'), icon: 'square-dashed', run: saveExcalidraw },
    { id: 'mermaid', group: t('Export'), label: t('Export Mermaid (.mmd)'), icon: 'file-code', run: saveMermaid },
    { id: 'share', group: t('Export'), label: t('Copy share link'), hint: t('read-only, the diagram travels in the link'), icon: 'link', run: copyShare },
    { id: 'copy-mermaid', group: t('Export'), label: t('Copy as Mermaid'), hint: t('a fenced block for a README'), icon: 'copy', run: copyMermaid },
    { id: 'present', group: t('Present'), label: t('Present full screen'), hint: stepList.length ? count(stepList.length, '{count} step|{count} steps') : drawn?.views?.length ? t('its views in order') : t('step by step'), icon: 'play', shortcut: keyHint('present'), run: present },
    ...(type && !drawn?.stepsImplied
      ? [{ id: 'step-add', group: t('Present'), label: selection.length ? t('Add a step from the selection') : t('Add a step'), hint: t('what is selected stands out in it'), icon: 'plus', shortcut: keyHint('step'), run: addStepFromSelection }]
      : []),
    ...(stepList.length
      ? [
          { id: 'step-next', group: t('Present'), label: t('Next step'), icon: 'layers', shortcut: keyHint('step-by'), run: () => stepBy(1) },
          { id: 'step-previous', group: t('Present'), label: t('Previous step'), icon: 'layers', shortcut: '[', run: () => stepBy(-1) },
          ...(drawn?.step ? [{ id: 'step-none', group: t('Present'), label: t('Show the whole drawing'), hint: t('no step'), icon: 'layers', run: () => pickStep(undefined) }] : []),
          ...stepList.map((x, i) => ({ id: `step:${i + 1}`, group: t('Steps'), label: `${i + 1}. ${x.title ?? x.caption ?? t('Step')}`, hint: x.title ? x.caption : undefined, icon: 'layers', run: () => pickStep(i + 1) })),
        ]
      : []),
    ...comparing.commands,
    ...layers.commands,
    ...stages.commands,
    { id: 'note-add', group: t('Notes'), label: selected ? t('Add a note on the selection') : t('Add a note'), icon: 'message-square', shortcut: keyHint('note'), run: () => addNote() },
    { id: 'notes', group: t('Notes'), label: notesOpen ? t('Hide the notes') : t('Show the notes'), hint: t('{count} open', { count: openNotes.length }), icon: 'message-square', shortcut: keyHint('notes'), run: toggleNotes },
    { id: 'review-mode', group: t('Notes'), label: reviewMode ? t('Leave review mode') : t('Review mode'), hint: t('only the notes stand out'), icon: 'eye', shortcut: keyHint('review'), run: toggleReview },
    { id: 'notes-export', group: t('Notes'), label: notesInExports ? t('Exports without review notes') : t('Exports with review notes'), hint: t('numbered markers and the notes under the drawing'), icon: 'download', run: () => setExportsWithNotes(!notesInExports) },
    ...(review.notes.threads.length && !(ws && doc.path) ? [{ id: 'notes-file', group: t('Notes'), label: t('Download review notes (.notes.json)'), hint: t('kept in this browser until then'), icon: 'download', run: () => download(`${baseName(doc.name)}.notes.json`, review.fileText() ?? '', 'application/json') }] : []),
    ...decisionsTool.commands,
    ...reviewTool.commands,
    ...openNotes.map((n) => ({ id: `note:${n.id}`, group: t('Open notes'), label: n.text.split('\n')[0]!, hint: n.author, icon: 'message-square', run: () => openNote(n.id) })),
    { id: 'undo', group: t('Edit'), label: t('Undo'), icon: 'undo-2', shortcut: keyHint('undo'), run: () => editor.current?.undo() },
    { id: 'redo', group: t('Edit'), label: t('Redo'), icon: 'redo-2', shortcut: keyHint('redo'), run: () => editor.current?.redo() },
    { id: 'tidy', group: t('Arrange'), label: t('Tidy'), hint: t('lay out again what is not pinned; pins stay'), icon: 'layout-grid', shortcut: keyHint('tidy'), run: tidyLayout },
    ...(vpins || drawnLayout?.held ? [{ id: 'reset', group: t('Arrange'), label: t('Tidy all (unpin everything)'), hint: t('unpin everything and lay it all out afresh; Undo in the message'), icon: 'pin-off', run: tidyAll }] : []),
    { id: 'pin', group: t('Arrange'), label: selection.length && selection.every((s) => (s.kind === 'node' ? vpins?.nodes?.[s.id] : vpins?.groups?.[s.id])) ? t('Unpin the selection') : t('Pin the selection where it is'), icon: 'pin', shortcut: keyHint('pin'), run: togglePin },
    ...arrangeCommands(arrangeSelection),
    { id: 'lock', group: t('Arrange'), label: selection.length && selection.every((s) => locked.has(s.id)) ? t('Unlock the selection') : t('Lock the selection in place'), icon: 'lock', shortcut: keyHint('lock'), run: toggleLock },
    ...(selected?.kind === 'edge' && bent.has(selected.id) ? [{ id: 'reset-line', group: t('Arrange'), label: t('Reset line (route it automatically)'), icon: 'route', run: () => pinTo(withEdge(selected.id, undefined)) }] : []),
    { id: 'zoom-fit', group: t('View'), label: t('Zoom to fit'), icon: 'maximize', shortcut: keyHint('fit'), run: () => previewControl.current?.fit() },
    ...viewList()
      .filter((v) => v !== viewName)
      .map((v) => ({ id: `view-${v ?? 'as-written'}`, group: t('View'), label: v === undefined ? t('Show the diagram as written') : t('Show the {view} view', { view: viewTitle(v) }), hint: t('the YAML stays as it is'), icon: 'layers', run: () => showView(v) })),
    ...(viewList().length > 1 ? [{ id: 'view-next', group: t('View'), label: t('Next view'), hint: t('now {what}', { what: viewTitle(viewName) }), icon: 'layers', shortcut: keyHint('next-view'), run: nextView }] : []),
    ...(ownView ? [{ id: 'view-keep', group: t('View'), label: t('Write view: {view} into the YAML', { view: viewName! }), hint: t('so it opens like this'), icon: 'save', run: keepView }] : []),
    { id: 'zoom-selection', group: t('View'), label: t('Zoom to selection'), icon: 'focus', shortcut: keyHint('zoom-selection'), run: () => previewControl.current?.zoomToSelection() },
    { id: 'focus', group: t('Focus'), label: selection.length === 1 && selected && selected.kind !== 'edge' ? t('Focus on {name}', { name: selected.kind === 'node' ? nodeName(selected.id) : (drawn?.graph?.groups.find((g) => g.id === selected.id)?.label ?? selected.id) }) : t('Focus on the selection'), hint: t('only it and what is around it'), icon: 'focus', shortcut: keyHint('focus'), run: focusOnSelection },
    ...(drawn?.focus
      ? [
          { id: 'focus-more', group: t('Focus'), label: t('Focus: one hop more'), hint: drawn.focus.hops === Infinity ? t('everything connected is shown') : t('now {what}', { what: drawn.focus.hops }), icon: 'plus', shortcut: '+', run: () => focusHops(1) },
          { id: 'focus-fewer', group: t('Focus'), label: t('Focus: one hop fewer'), icon: 'minus', shortcut: '−', run: () => focusHops(-1) },
          { id: 'focus-direction', group: t('Focus'), label: t('Focus: both ways, upstream or downstream'), hint: t('now {what}', { what: say(drawn.focus.direction) }), icon: 'arrow-left-right', shortcut: keyHint('focus-direction'), run: focusDirection },
        ]
      : []),
    ...(focusOn ? [{ id: 'focus-leave', group: t('Focus'), label: drawn?.focus ? (drawn.focus.written ? t('Show everything (the YAML has a focus)') : t('Leave the focus')) : t('Back to the focus of the YAML'), icon: drawn?.focus ? 'x' : 'focus', shortcut: keyHint('escape'), run: leaveFocus }] : []),
    { id: 'grid', group: t('View'), label: craft.grid ? t('Stop snapping to the grid') : t('Snap to the 8px grid'), icon: 'grid-3x3', shortcut: keyHint('grid'), run: () => craft.toggle('grid') },
    { id: 'minimap', group: t('View'), label: craft.minimap ? t('Hide the minimap') : t('Show the minimap'), icon: 'map', shortcut: keyHint('minimap'), run: () => craft.toggle('minimap') },
    { id: 'page', group: t('View'), label: craft.page ? t('Hide the page') : t('Show the page ({page})', { page: pageName }), hint: t('and text too small on it'), icon: 'monitor', shortcut: keyHint('page'), run: () => craft.toggle('page') },
    { id: 'theme-light', group: t('View'), label: t('Light theme'), icon: 'sun', run: () => setPref('light') },
    { id: 'theme-dark', group: t('View'), label: t('Dark theme'), icon: 'moon', run: () => setPref('dark') },
    { id: 'theme-system', group: t('View'), label: t('Theme follows system'), icon: 'monitor', run: () => setPref('system') },
    { id: 'shortcuts', group: t('View'), label: t('Keyboard shortcuts'), icon: 'keyboard', shortcut: keyHint('sheet'), run: () => setTimeout(() => setModal('shortcuts')) },
    { id: 'problems', group: t('View'), label: t('Show problems'), hint: shownNotes ? t('and {count} from the import', { count: shownNotes.items.length }) : undefined, icon: 'circle-exclamation-point', run: () => setModal('problems') },
    ...(type?.palette ?? []).map((item, i) => ({ id: `add:${i}`, group: t('Add'), label: item.label, hint: item.collection, icon: item.icon, run: () => add(item) })),
    ...(selected?.kind === 'node'
      ? [{ id: 'connect', group: t('Edit'), label: t('Connect {name} to…', { name: nodeName(selected.id) }), icon: 'arrow-right-from-line', shortcut: keyHint('connect'), run: () => setTimeout(() => setModal('connect')) }]
      : []),
    ...(result?.graph?.groups ?? []).map((g) => ({ id: `group:${g.id}`, group: t('Go to'), label: g.label, hint: g.caption ?? g.id, icon: g.icon ?? 'square-dashed', ...(g.tags ? { tags: g.tags } : {}), run: () => select({ kind: 'group', id: g.id }) })),
    ...(result?.graph?.nodes ?? []).map((n) => ({ id: `node:${n.id}`, group: t('Go to'), label: label(n), hint: n.id, icon: iconOf(n) ?? 'box', ...(n.tags ? { tags: n.tags } : {}), run: () => select({ kind: 'node', id: n.id }) })),
    ...starters.map((s) => ({
      id: `starter:${s.id}`,
      group: t('Start from'),
      label: s.title,
      hint: `${s.kind === 'template' ? t('Template') : t('Example')} · ${typeName(s.type)}`,
      icon: 'layout-template',
      run: () => void pick(s),
    })),
    ...[...new Set(starters.map((s) => s.type))].map((ty) => ({
      id: `blank:${ty}`,
      group: t('Start from'),
      label: t('Blank {type}', { type: typeName(ty).toLowerCase() }),
      hint: t('empty diagram'),
      icon: 'file-plus',
      run: () => {
        setModal(undefined);
        fileHandle.current = undefined;
        open(withUiLang(blankText(ty)), { name: `${ty}.yaml` }, undefined, true);
        focusDrawing();
      },
    })),
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F6 moves between the editor, the drawing and the properties, like panes in other apps.
      if (is(e, 'next-pane')) {
        const panes = ['.cm-content', '.preview', '.side input, .side select, .side textarea'].map((q) => document.querySelector(q) as HTMLElement | null).filter((x): x is HTMLElement => !!x?.offsetParent);
        const at = panes.findIndex((p) => p.contains(document.activeElement) || p === document.activeElement || (p.closest('.side') && p.closest('.side')!.contains(document.activeElement)));
        panes[(at + (e.shiftKey ? panes.length - 1 : 1)) % panes.length]?.focus();
        return e.preventDefault();
      }
      // Keys from keys.ts: those with ⌘ (or F6) work while typing too; the others only outside text fields.
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-content, [contenteditable="true"]');
      if (!modal && !presenting && (wsTools.onKey(e, !!typing) || trace.onKey(e, mod(e), !!typing) || blocks.onKey(e, !!typing))) return e.preventDefault();
      if (e.defaultPrevented) return;
      const id = shortcutFor(e, typing || modal || presenting ? ['anywhere'] : ['anywhere', 'not-typing']);
      if (!id || (modal && id !== 'palette') || presenting) return;
      if (id === 'sheet') setModal('shortcuts');
      else if (id === 'present') present();
      else if (id === 'palette') setModal((m) => (m === 'palette' ? undefined : 'palette'));
      else if (id === 'ask') toggleAsk();
      else if (id === 'save') saveYaml();
      else if (id === 'open') openFile();
      else if (id === 'export-svg') saveSvg();
      else if (id === 'export-png') savePng();
      else if (id === 'switch-view') setView(view === 'visual' ? 'code' : 'visual');
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
    // The YAML's wanted width, from its left edge (the file list is beside it in a folder).
    const left = el.parentElement!.getBoundingClientRect().left + panes.files;
    const move = (ev: PointerEvent) => setSplit(Math.min(0.7, Math.max(0.15, (ev.clientX - left) / window.innerWidth)));
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
      className="app"
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
          {dirty && <span className="dirty" title={t('Unsaved changes (⌘S saves)')} aria-label={t('Unsaved changes')} />}
          {type && (
            <div className="menu-anchor type-anchor">
              <button className="type-pill" onClick={() => setTypeCard((o) => !o)} title={`${t('{name}, written type: {id}', { name: type.name, id: type.id })}${type.tagline ? ` · ${type.tagline}` : ''}`} aria-expanded={typeCard} aria-haspopup="menu">
                {type.name}
              </button>
              {typeCard && (
                <Menu onClose={() => setTypeCard(false)}>
                  <div className="type-card-pop">
                    <strong>
                      <Icon name={type.icon ?? 'layout-template'} size={15} /> {type.name}
                    </strong>
                    <code className="type-yaml" title={t('What the YAML says')}>type: {type.id}</code>
                    {type.tagline && <p>{type.tagline}</p>}
                  </div>
                  <button role="menuitem" onClick={() => (setTypeCard(false), setGuiding(true), setModal('templates'))}>
                    <Icon name="circle-question-mark" /> {t('Which type do I need?')}
                  </button>
                  <p className="type-card-fine">{t('Also in docs/types.md and')} <code>carto types</code></p>
                </Menu>
              )}
            </div>
          )}
        </div>
        <div className="actions">
          {canUseFolders && !ws && remembered && (
            <button className="button ghost wide-only" onClick={() => void openFolder(remembered)} title={t('Open the last folder again')}>
              <Icon name="folder-open" /> {remembered.name}
            </button>
          )}
          {canUseFolders && (
            <button className="button ghost wide-only" onClick={() => void openFolder()} title={t('Open a folder with diagrams')}>
              <Icon name="folder-open" /> {ws ? t('Folder') : t('Open folder')}
            </button>
          )}
          <div className="segmented view-switch" role="radiogroup" aria-label={t('Way of working')}>
            <button role="radio" aria-checked={view === 'visual'} className={view === 'visual' ? 'active' : ''} onClick={() => setView('visual')} title={`${t('Builder: the drawing and the shapes to drag onto it')} (⌘\\\\)`}>
              <Icon name="mouse-pointer-2" /> Builder
            </button>
            <button role="radio" aria-checked={view === 'code'} className={view === 'code' ? 'active' : ''} onClick={() => setView('code')} title={`${t('YAML and drawing side by side')} (⌘\\\\)`}>
              <Icon name="code" /> YAML
            </button>
          </div>
          <button className="button ghost wide-only" onClick={() => setModal('templates')} title={t('A new diagram: from a template, a wizard, an example or an import')}>
            <Icon name="file-plus" /> {t('New')}
          </button>
          <button className="button ghost wide-only" onClick={() => setModal('palette')} title={t('Commands, elements and templates (⌘K)')}>
            <Icon name="search" /> {t('Commands')} <kbd>⌘K</kbd>
          </button>
          {/* On a phone the actions above fold into one menu. */}
          <div className="menu-anchor narrow-only">
            <button className="icon-button" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-haspopup="menu" aria-label={t('More actions')}>
              <span className="more-dots" aria-hidden="true">⋯</span>
            </button>
            {more && (
              <Menu onClose={() => setMore(false)}>
                <button role="menuitem" onClick={() => (setMore(false), setModal('templates'))}>
                  <Icon name="file-plus" /> {t('New diagram')}
                </button>
                <button role="menuitem" onClick={() => (setMore(false), setModal('palette'))}>
                  <Icon name="search" /> {t('Commands')}
                </button>
                {canUseFolders && (
                  <button role="menuitem" onClick={() => (setMore(false), void openFolder())}>
                    <Icon name="folder-open" /> {t('Open folder')}
                  </button>
                )}
                <button role="menuitem" onClick={() => (setMore(false), setPref(theme === 'dark' ? 'light' : 'dark'))}>
                  <Icon name={theme === 'dark' ? 'sun' : 'moon'} /> {theme === 'dark' ? t('Light theme') : t('Dark theme')}
                </button>
              </Menu>
            )}
          </div>
          <BrandMenu ws={ws} onError={(m) => notify(m, { tone: 'error' })} onNotice={(m) => notify(m)} />
          <button
            className="icon-button wide-only"
            onClick={() => setPref(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? t('Switch to light theme') : t('Switch to dark theme')}
            aria-label={t('Toggle theme')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <div className="menu-anchor">
            {pptxTemplate.picker}
            <button className="button primary" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
              <Icon name="download" /> {t('Export')} <Icon name="chevron-down" size={14} />
            </button>
            {menu && (
              <Menu onClose={() => setMenu(false)}>
                <div className="menu-heading">{t('Image')}</div>
                <button role="menuitem" onClick={saveSvg}>
                  <Icon name="download" /> {safeSvg ? t('SVG for PowerPoint / Word') : 'SVG'} <kbd>{keyHint('export-svg')}</kbd>
                </button>
                <button role="menuitem" onClick={savePng}>
                  <Icon name="image" /> PNG 2× <kbd>{keyHint('export-png')}</kbd>
                </button>
                <button role="menuitem" onClick={copyPng}>
                  <Icon name="copy" /> {t('Copy as PNG')}
                </button>
                <button role="menuitem" onClick={copySvg}>
                  <Icon name="copy" /> {t('Copy as SVG')}
                </button>
                <button
                  role="menuitemcheckbox"
                  aria-checked={safeSvg}
                  title={t('SVG without what PowerPoint, Word and Keynote drop: no CSS or effects, system fonts, one group per node')}
                  onClick={(e) => {
                    // A switch: the menu stays open, the SVG rows above follow it.
                    e.stopPropagation();
                    toggleSafeSvg();
                  }}
                >
                  <Icon name={safeSvg ? 'check' : 'square'} /> {t('SVG for PowerPoint / Word')}
                </button>
                <div className="menu-heading">{t('Document, on the page ({page})', { page: pageName })}</div>
                <button role="menuitem" onClick={savePptx}>
                  <Icon name="layout-template" /> {pptxTemplate.chosen ? `${t('PowerPoint in {template}', { template: pptxTemplate.chosen.name.split('/').pop()! })}${written ? t(', a slide per step') : ''}` : written ? t('PowerPoint, a slide per step (.pptx)') : 'PowerPoint (.pptx)'}
                </button>
                <TemplateItems t={pptxTemplate} />
                <button role="menuitem" onClick={savePdf}>
                  <Icon name="file-text" /> {written ? t('PDF, a page per step') : 'PDF'}
                </button>
                <button role="menuitem" onClick={saveSlide}>
                  <Icon name="monitor" /> {t('PNG of the page')}
                </button>
                <button role="menuitem" onClick={savePageSvg}>
                  <Icon name="monitor" /> {t('SVG of the page')}
                </button>
                <button role="menuitem" onClick={() => setDescribing(true)} title={t('What the diagram shows, in words: for a screen reader, a handout or a wiki')}>
                  <Icon name="scroll-text" /> {t('Describe in words…')}
                </button>
                <div className="menu-heading">{t('Share')}</div>
                <button role="menuitem" onClick={copyShare} title={t('The diagram goes in the link itself: nothing is uploaded')}>
                  <Icon name="link" /> {t('Copy share link')}
                </button>
                <button role="menuitem" onClick={() => saveHtml()} title={t('One file to send: every view and step, zoom, search, drill-down')}>
                  <Icon name="globe" /> {t('Interactive HTML (.html)')}
                </button>
                <button role="menuitem" onClick={() => setAnimating(true)} title={t('The steps or layers, a short blend between them')}>
                  <Icon name="circle-play" /> {t('Animation (GIF / MP4)')}
                </button>
                <button role="menuitem" onClick={copyForWiki} title={t('The picture and the description in one paste, for Confluence, Notion or Google Docs')}>
                  <Icon name="book-open" /> {t('Copy for Confluence / Notion')}
                </button>
                <details>
                  {/* Opening the fold keeps the menu open; a format in it closes the menu as the others do. */}
                  <summary onClick={(e) => e.stopPropagation()}>
                    <Icon name="workflow" /> {t('Other tools: draw.io, Excalidraw, Mermaid')} <Icon name="chevron-down" size={14} />
                  </summary>
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
                    <Icon name="copy" /> {t('Copy as Mermaid')}
                  </button>
                </details>
                <hr />
                <button role="menuitem" onClick={saveYaml}>
                  <Icon name="save" /> {t('Save')} <kbd>{keyHint('save')}</kbd>
                </button>
                <button role="menuitem" onClick={downloadYaml}>
                  <Icon name="download" /> {t('Download YAML')}
                </button>
                {pins && (
                  <button role="menuitem" onClick={saveLayout}>
                    <Icon name="pin" /> {t('Save layout')}
                  </button>
                )}
              </Menu>
            )}
          </div>
        </div>
      </header>

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
        {ws && panes.filesMode === 'rail' && (
          <nav className="rail files-rail" aria-label={t('Diagrams in {folder}', { folder: ws.name })}>
            <button
              className="rail-button"
              onClick={() => (paneLayout({ width: windowWidth, folder: true, files: 'list', view, editor: { width: split * windowWidth, folded: yamlFolded }, forceEditor: forceYaml, side: inspector || sideOpen }).filesMode === 'list' ? setFilesPref('list') : setFilesOver((o) => !o))}
              aria-expanded={filesOver}
              title={t('The diagrams in {folder}', { folder: ws.name })}
              aria-label={t('Files: {count} diagrams in {folder}', { count: diagrams(ws).length, folder: ws.name })}
            >
              <Icon name="file-code" size={16} />
              <span className="rail-label">Files · {diagrams(ws).length}</span>
            </button>
          </nav>
        )}
        {ws && (panes.filesMode === 'list' || filesOver) && (
          <nav className={panes.filesMode === 'list' ? 'files' : 'files over'} aria-label={t('Diagrams in {folder}', { folder: ws.name })} onKeyDown={(e) => e.key === 'Escape' && filesOver && (setFilesOver(false), e.stopPropagation())}>
            <header>
              <Icon name="folder-open" size={14} /> <span className="files-name">{ws.name}</span>
              <button className="icon-button small" onClick={() => (filesOver ? setFilesOver(false) : setFilesPref('rail'))} title={filesOver ? t('Close the file list') : t('Fold the file list to the side')} aria-label={t('Fold the file list')}>
                <Icon name="panel-left-close" size={14} />
              </button>
            </header>
            {diagrams(ws).map((p) => (
              <button key={p} className={doc.path === p ? 'file active' : 'file'} onClick={() => (setFilesOver(false), void openInFolder(ws, p))} title={p} aria-current={doc.path === p}>
                <Icon name="file-code" size={14} />
                <span>{p}</span>
                {doc.path === p && dirty && <span className="dirty" />}
              </button>
            ))}
            {diagrams(ws).length === 0 && <p className="files-empty">{t('No diagrams yet. Start from a template, then save.')}</p>}
          </nav>
        )}
        {view === 'visual' && type && (
          <aside className="shapes" aria-label={t('Shapes')}>
            <AddMenu inline items={type.palette} onAdd={(item) => add(item)} onClose={focusDrawing} />
            {blocks.panel}
          </aside>
        )}
        {panes.editorMode === 'rail' && (
          <button
            className="rail rail-button yaml-rail"
            onClick={() => (panes.editorSqueezed ? setForceYaml(true) : (setYamlFolded(false), setForceYaml(true)))}
            title={panes.editorSqueezed ? t('Show the YAML (the window is narrow: the drawing gets less room)') : t('Show the YAML')}
            aria-label={t('Show the YAML')}
          >
            <Icon name="code" size={16} />
            <span className="rail-label">YAML</span>
          </button>
        )}
        <section className="pane editor-pane" aria-label="YAML" hidden={panes.editorMode === 'rail'}>
          {view === 'code' && (
            <button className="icon-button small fold-yaml" onClick={() => setYamlFolded(true)} title={t('Fold the YAML to the side: more room for the drawing')} aria-label={t('Fold the YAML')}>
              <Icon name="panel-left-close" size={14} />
            </button>
          )}
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
                setToast((ts) => (ts?.action?.label === t('Undo') ? undefined : ts));
              }
            }}
          />
        </section>
        <div
          className="splitter"
          hidden={panes.editorMode === 'rail'}
          onPointerDown={dragSplit}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t('Resize editor')}
          aria-valuemin={20}
          aria-valuemax={70}
          aria-valuenow={Math.round(split * 100)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0.2, s - 0.02));
            else if (e.key === 'ArrowRight') setSplit((s) => Math.min(0.7, s + 0.02));
          }}
        />
        <section className={`pane canvas-pane${stepList.length || stages.active ? ' with-steps' : ''}${reviewMode ? ' review-mode' : ''}`} aria-label={t('Drawing')}>
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
              if (refused) notify(t('{item} cannot go in {group}: placed outside it', { item: item.label, group: result?.graph?.groups.find((g) => g.id === refused)?.label ?? refused }));
            }}
            onBlockDrop={blocks.onDrop}
            onKeyDown={onCanvasKey}
            locked={locked}
            bent={bent}
            grid={craft.grid}
            minimap={craft.minimap}
            page={craft.page}
            pinned={pinnedIds}
            onToggle={craft.toggle}
            control={previewControl}
            describe={describe}
            overlay={(scale) => (
              <>
                <NoteMarkers result={drawn} review={review} filter={notesOpen ? noteFilter : 'open'} scale={scale} active={activeNote} onOpen={openNote} />
                {blocks.overlay(scale)}
                {decisionsTool.markers(scale)}
                {reviewTool.markers(scale)}
              </>
            )}
            onContextMenu={(s, at, client) => {
              if (s) select(s, false);
              setNoteMenu({ x: client.x, y: client.y, s, at });
            }}
            onBend={(id, via, done) => {
              const e = result?.graph?.edges.find((x) => x.id === id);
              if (!done) return setDraft({ edges: { [id]: { via, from: e?.from.node, to: e?.to.node } } });
              setDraft(undefined);
              pinTo(withEdge(id, via));
            }}
            onDrill={wsTools.onDrill}
            onFollow={(s) => {
              const g = drawn?.graph;
              const links = s.kind === 'node' ? g?.nodes.find((n) => n.id === s.id)?.links : s.kind === 'group' ? g?.groups.find((x) => x.id === s.id)?.links : undefined;
              if (!links?.length) return false;
              follow(links[0]!);
              return true;
            }}
          >
            <div className="canvas-top">
            {wsTools.crumbBar}
            <div className="canvas-tools" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
              <button className={adding ? 'tool active' : 'tool'} onClick={addShape} title={t('Add a shape (A)')} aria-label={t('Add a shape')} aria-expanded={adding} disabled={!type}>
                <Icon name="plus" /> <span className="tool-label">{t('Add')}</span> <kbd>A</kbd>
              </button>
              <button className="tool" onClick={() => editor.current?.undo()} title={t('Undo (⌘Z)')} aria-label={t('Undo')}>
                <Icon name="undo-2" />
              </button>
              <button className="tool" onClick={() => editor.current?.redo()} title={t('Redo (⇧⌘Z)')} aria-label={t('Redo')}>
                <Icon name="redo-2" />
              </button>
              <button className="tool" onClick={tidyLayout} title={t('Tidy: lay out again what is not pinned, pins stay (T)')} aria-label={t('Tidy')}>
                <Icon name="layout-grid" />
              </button>
              {(vpins || drawnLayout?.held) && (
                <button className="tool tool-more" onClick={tidyAll} title={t('Tidy all: unpin everything and lay it out afresh (⌘Z undoes it)')} aria-label={t('Tidy all')}>
                  <Icon name="pin-off" />
                </button>
              )}
              <ViewPicker views={drawn?.views} value={drawn?.view} asWritten={!drawn?.onlyViews} onChange={(name) => setPicked({ doc: docId, name })} />
              {layers.button}
              <button className={drawn?.focus ? 'tool tool-more active' : 'tool tool-more'} onClick={focusOnSelection} title={t('Focus: only what is selected and what is around it (F)')} aria-label={t('Focus')} disabled={!selection.length && !focusOn}>
                <Icon name="focus" /> <span className="tool-label">{t('Focus')}</span> <kbd>F</kbd>
              </button>
              {!stepList.length && (
                <button className="tool tool-more" onClick={addStepFromSelection} title={t('A step to present: what is selected stands out in it (S)')} aria-label={t('Add a step')} disabled={!type}>
                  <Icon name="layers" /> <span className="tool-label">{t('Step')}</span> <kbd>S</kbd>
                </button>
              )}
              <button className="tool" onClick={present} title={t('Present full screen, step by step (P or ⌘↩)')} aria-label={t('Present')} disabled={!drawn?.svg}>
                <Icon name="play" /> <span className="tool-label">{t('Present')}</span> <kbd>P</kbd>
              </button>
              <button className={asking ? 'tool active' : 'tool'} onClick={toggleAsk} title={t('Proposals from your own AI ({key})', { key: keyHint('ask') })} aria-label={t('Your AI')} aria-expanded={asking} disabled={!type}>
                <Icon name="sparkles" /> <span className="tool-label">{t('AI')}</span> <kbd>{keyHint('ask')}</kbd>{live.proposal && <span className="tool-count unread">1</span>}
              </button>
              <button className={notesOpen ? 'tool active' : 'tool'} onClick={toggleNotes} title={t('Review notes (⇧N); N adds one on the selection')} aria-pressed={notesOpen} aria-label={unreadNotes ? t('Notes, {count} open, {unread} unread', { count: openNotes.length, unread: unreadNotes }) : t('Notes, {count} open', { count: openNotes.length })}>
                <Icon name="message-square" />
                {openNotes.length > 0 && <span className={unreadNotes ? 'tool-count unread' : 'tool-count'}>{openNotes.length}</span>}
              </button>
              {/* Decisions in one click, with its count, like Notes, once there are any (review 3: they hid in ⋯); the first one is written from ⋯. */}
              {(decisionsTool.count > 0 || decisionsOpen) && (
              <button className={decisionsOpen ? 'tool active' : 'tool'} onClick={() => decisionsTool.toggle()} title={`Architecture decisions (${keyHint('decisions')})`} aria-pressed={decisionsOpen} aria-label={`Decisions${decisionsTool.count ? `, ${decisionsTool.count}` : ''}`}>
                <Icon name="scroll-text" />
                {decisionsTool.count > 0 && <span className="tool-count">{decisionsTool.count}</span>}
              </button>
              )}
              {/* Compare and the view's switches, at every width (several items, so ⋯ never holds just one); in a narrow drawing also the tools that fold away, in the same order. */}
              <div className="menu-anchor tool-overflow">
                <button className={toolsMore ? 'tool active' : 'tool'} onClick={() => setToolsMore((m) => !m)} aria-expanded={toolsMore} aria-haspopup="menu" aria-label={t('More tools')} title={t('More: compare with an earlier version, zoom to the selection, grid, minimap')}>
                  <span className="more-dots" aria-hidden="true">⋯</span>
                </button>
                {toolsMore && (
                  <Menu onClose={() => setToolsMore(false)}>
                    {(vpins || drawnLayout?.held) && (
                      <button role="menuitem" className="tool-folded" onClick={() => (setToolsMore(false), tidyAll())}>
                        <Icon name="pin-off" /> {t('Tidy all')}
                      </button>
                    )}
                    <button role="menuitem" className="tool-folded" onClick={() => (setToolsMore(false), focusOnSelection())} disabled={!selection.length && !focusOn}>
                      <Icon name="focus" /> {t('Focus')} <kbd>F</kbd>
                    </button>
                    {!stepList.length && (
                      <button role="menuitem" className="tool-folded" onClick={() => (setToolsMore(false), addStepFromSelection())} disabled={!type}>
                        <Icon name="layers" /> {t('Add a step')} <kbd>S</kbd>
                      </button>
                    )}
                    {!(decisionsTool.count > 0 || decisionsOpen) && (
                      <button role="menuitem" onClick={() => (setToolsMore(false), decisionsTool.toggle())}>
                        <Icon name="scroll-text" /> {t('Decisions')} <kbd>{keyHint('decisions')}</kbd>
                      </button>
                    )}
                    <button role="menuitem" onClick={() => (setToolsMore(false), comparing.toggle())}>
                      <Icon name="clock" /> {comparing.active ? t('Stop comparing') : t('Compare with an earlier version')} <kbd>{keyHint('compare')}</kbd>
                    </button>
                    <hr />
                    <button role="menuitem" onClick={() => (setToolsMore(false), previewControl.current?.zoomToSelection())} disabled={!selection.length}>
                      <Icon name="focus" /> Zoom to the selection <kbd>{keyHint('zoom-selection')}</kbd>
                    </button>
                    <button role="menuitemcheckbox" aria-checked={!!craft.grid} onClick={() => (setToolsMore(false), craft.toggle('grid'))}>
                      <Icon name="grid-3x3" /> Snap to grid {craft.grid && <Icon name="check" size={14} />} <kbd>{keyHint('grid')}</kbd>
                    </button>
                    <button role="menuitemcheckbox" aria-checked={!!craft.minimap} onClick={() => (setToolsMore(false), craft.toggle('minimap'))}>
                      <Icon name="map" /> Minimap {craft.minimap && <Icon name="check" size={14} />} <kbd>{keyHint('minimap')}</kbd>
                    </button>
                  </Menu>
                )}
              </div>
            </div>
            {!adding && <FocusChip focus={drawn?.focus} off={focusAsked === null && !!drawn?.focusWritten} onHops={focusHops} onDirection={focusDirection} onLeave={leaveFocus} />}
            {!adding && layers.chip}
            {/* Notes about the drawing go on a row of their own under the tools, never under them. */}
            {!!rendered && !!drawn?.svg && drawn !== result && (
              <div className="canvas-note">
                <div className="stale-note" role="status">
                  <Icon name="circle-exclamation-point" size={14} /> {t('Showing the last version that worked: fix the problems in the editor')}
                </div>
              </div>
            )}
            </div>
            {hint && !adding && !modal && (
              <div className="hint" role="note">
                <span>
                  {view === 'visual' ? (
                    <>
                      {t('Drag shapes onto the drawing or into a group, drag the dot on a shape to connect it, double-click to rename.')} <kbd>?</kbd> {t('shows all keys.')}
                    </>
                  ) : (
                    <>
                      {t('Edit the YAML (')}<kbd>Tab</kbd> {t('indents two spaces;')} <kbd>Esc</kbd> <kbd>Tab</kbd> {t('or')} <kbd>F6</kbd> {t('leaves it), or build here:')} <kbd>A</kbd> {t('adds a shape, drag the dot on a shape to connect it,')} <kbd>?</kbd> {t('shows all keys.')}
                    </>
                  )}
                </span>
                <button className="icon-button small" onClick={dismissHint} aria-label={t('Dismiss hint')}>
                  <Icon name="x" size={14} />
                </button>
              </div>
            )}
            {empty && type && !adding && (
              <div className="canvas-empty">
                <p>
                  <strong>{t('Drag a shape here')}</strong> {t('or press')} <kbd>A</kbd>
                </p>
                <div className="chips inline">
                  {quick.map((item) => (
                    <button key={item.collection + item.kind} className="chip" onClick={() => add(item)}>
                      <Icon name={item.icon} size={14} /> {item.label}
                    </button>
                  ))}
                </div>
                <p className="fine">{t('Double-click the title to name the diagram.')}</p>
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
          {comparing.view}
          {stages.strip}
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
        {sideOpen && (
          <div className="side" role="region" aria-label={t('Side panel')}>
            <div className="side-tabs" role="tablist" aria-label={t('Side panel')}>
              <button role="tab" aria-selected={sideTab === 'properties'} onClick={() => showSide('properties')} disabled={!hasProperties} title={hasProperties ? t('What is selected') : t('Select something to see its properties')}>
                <Icon name="file-sliders" size={14} /> <span className="tab-label">{t('Properties')}</span>
              </button>
              <button role="tab" aria-selected={sideTab === 'notes'} onClick={() => showSide('notes')} title={t('Review notes ({key})', { key: keyHint('notes') })}>
                <Icon name="message-square" size={14} /> <span className="tab-label">{t('Notes')}</span>{openNotes.length > 0 && <span className="tab-count">{openNotes.length}</span>}
              </button>
              <button role="tab" aria-selected={sideTab === 'decisions'} onClick={() => showSide('decisions')} title={t('Architecture decisions ({key})', { key: keyHint('decisions') })}>
                <Icon name="scroll-text" size={14} /> <span className="tab-label">{t('Decisions')}</span>{decisionsTool.count > 0 && <span className="tab-count">{decisionsTool.count}</span>}
              </button>
              <button role="tab" aria-selected={sideTab === 'review'} onClick={() => showSide('review')} disabled={!type} title={t('Architecture review ({key})', { key: keyHint('arch-review') })}>
                <Icon name="shield-check" size={14} /> <span className="tab-label">{t('Review')}</span>{reviewTool.count > 0 && <span className="tab-count">{reviewTool.count}</span>}
              </button>
              <button role="tab" aria-selected={sideTab === 'ask'} onClick={() => showSide('ask')} disabled={!type} title={t('Your AI ({key})', { key: keyHint('ask') })}>
                <Icon name="sparkles" size={14} /> <span className="tab-label">{t('Your AI')}</span>
              </button>
            </div>
          {askKept && (
            <AskPanel
              hidden={sideTab !== 'ask'}
              text={text}
              type={type}
              sidecar={sidecar}
              load={load}
              theme={theme}
              live={live}
              change={diskChange?.doc === docKey ? diskChange : undefined}
              onAccept={(yaml, renames) => apply(yaml, renames.size ? (renamePins(vpins, renames) ?? null) : undefined)}
              onUndoChange={() => {
                editor.current?.undo();
                setDiskChange(undefined);
              }}
              onDismissChange={() => setDiskChange(undefined)}
              onCopyForAi={() => void copyForAi()}
              onClose={() => {
                setAsking(false);
                setAskKept(false);
                focusDrawing();
              }}
            />
          )}
        {sideTab === 'decisions' && decisionsTool.panel}
        {sideTab === 'review' && reviewTool.panel}
        {notesOpen && !asking && (
          <NotesPanel
            review={review}
            graph={drawn?.graph}
            view={drawn?.view}
            filter={noteFilter}
            onFilter={setNoteFilter}
            mine={noteMine}
            onMine={setNoteMine}
            reviewMode={reviewMode}
            onReviewMode={(on) => setReviewMode(on)}
            withExports={notesInExports}
            onWithExports={setExportsWithNotes}
            draft={noteDraft}
            onDraftDone={() => {
              setNoteDraft(undefined);
              focusDrawing();
            }}
            active={activeNote}
            onActive={setActiveNote}
            onGo={(target) => {
              if ('point' in target) return;
              select(target);
              requestAnimationFrame(() => previewControl.current?.zoomToSelection());
            }}
            selectionAnchor={anchorOf(selected)}
            onClose={toggleNotes}
          />
        )}
        {showInspector && selected && type && (selNode || selGroup || selEdge) && (
          <Inspector
            key={`${selected.kind}:${selected.id}`}
            selection={`${selected.kind}:${selected.id}`}
            id={isEntry ? String(selectedPath!.at(-1)) : selected.id}
            title={selNode ? label(selNode) : selGroup ? selGroup.label : selEdge ? `${nodeName(selEdge.from.node)} → ${nodeName(selEdge.to.node)}` : selected.id}
            icon={selNode ? iconOf(selNode) : selGroup ? selGroup.icon : 'arrow-right-from-line'}
            kindLabel={selEdge ? (selEdge.label ? t('Line · {label}', { label: selEdge.label }) : t('Line')) : wsTools.definedElsewhere ? (wsTools.definedElsewhere.kind ?? t('element')).replace(/-/g, ' ') : say(kindLabel(selectedPath))}
            fields={fields}
            renamable={isEntry}
            freeName={!!type.freeNames}
            pinned={selected.kind === 'node' ? !!vpins?.nodes?.[selected.id] : selected.kind === 'group' && !!vpins?.groups?.[selected.id]}
            locked={selected.kind === 'edge' ? undefined : locked.has(selected.id)}
            onLock={toggleLock}
            onResetLine={selected.kind === 'edge' && bent.has(selected.id) ? () => pinTo(withEdge(selected.id, undefined)) : undefined}
            links={(selNode ?? selGroup)?.links}
            onFollowLink={follow}
            tags={layers.tags}
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
            definedIn={wsTools.definedElsewhere}
          >
            {wsTools.wherePanel}
          </Inspector>
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
              <button className="icon-button" onClick={() => setSelection([])} aria-label={t('Clear the selection')} title={t('Clear (Esc)')}>
                <Icon name="x" />
              </button>
            </header>
            <div className="inspector-body">
              <ArrangeBar shapes={selection.filter((s) => s.kind === 'node').length} onArrange={arrangeSelection} />
              <p className="fine">
                {t('Drag one to move them all, arrows nudge them,')} <kbd>⌘C</kbd> <kbd>⌘V</kbd> {t('copies and pastes. Shift-click adds or removes one.')}
              </p>
            </div>
            <footer>
              <button className="button ghost" onClick={duplicate} title={t('Duplicate (⌘D)')}>
                <Icon name="copy" /> {t('Duplicate')}
              </button>
              <button className="button ghost" onClick={toggleLock} title={t('Lock or unlock (⇧⌘L)')}>
                <Icon name={selection.every((s) => locked.has(s.id)) ? 'lock-open' : 'lock'} /> {selection.every((s) => locked.has(s.id)) ? t('Unlock') : t('Lock')}
              </button>
              <button className="button ghost danger" onClick={removeAll} title={t('Delete (⌫)')}>
                <Icon name="trash" /> {t('Delete')}
              </button>
            </footer>
          </aside>
        )}
          </div>
        )}
      </main>

      <footer className="statusbar">
        <button className={`status-problems${errors ? ' has-errors' : warnings ? ' has-warnings' : ''}`} onClick={() => setModal('problems')} title={rendered ? `Drawn in ${rendered.ms} ms` : undefined}>
          <Icon name={errors || warnings ? 'circle-exclamation-point' : 'check'} size={14} />
          {errors || warnings ? `${t('{count} error|{count} errors', { count: errors })}${warnings ? `, ${t('{count} warning|{count} warnings', { count: warnings })}` : ''}` : t('No problems')}
        </button>
        {ws && wsTools.folderProblems.length > 0 && (
          <button className="status-problems status-folder has-warnings" onClick={() => setModal('problems')} title={t('Problems across the files of {folder}', { folder: ws.name })}>
            <Icon name="folder-open" size={14} /> {t('{count} across {folder}', { count: wsTools.folderProblems.length, folder: ws.name })}
          </button>
        )}
        {result?.graph && <span>{drawnCount(result.graph)}</span>}
        {pinCount > 0 && (
          <span className="status-selected">
            <Icon name="pin" size={13} /> {t('{count} pinned', { count: pinCount })}
          </span>
        )}
        {selection.length > 0 && (
          <span className="status-selected">
            <Icon name="mouse-pointer-2" size={13} /> {selected ? selected.id : t('{count} selected', { count: selection.length })}
          </span>
        )}
        <span className="spacer" />
        <button className="status-link" onClick={() => setModal('shortcuts')} title={t('Keyboard shortcuts')}>
          <Icon name="keyboard" size={13} /> ?
        </button>
        <span>{theme === 'dark' ? t('Dark') : t('Light')}</span>
      </footer>

      {presenting && <Present doc={{ text: textNow(), path: here, file: docFile, sidecar: pins, load }} theme={theme} view={drawn?.view ?? viewNow()} step={drawn?.step} focus={focusAsked} layers={layering.options} open={presentOther} onClose={() => setPresenting(false)} />}
      {modal === 'palette' && <Palette commands={buildCommands()} onClose={closeModal} />}
      {comparing.dialogs}
      {confirmer.dialog}
      {modal === 'connect' && selected?.kind === 'node' && (
        <Palette
          placeholder={t('Connect {name} to…', { name: nodeName(selected.id) })}
          onClose={() => {
            closeModal();
            focusDrawing();
          }}
          commands={(result?.graph?.nodes ?? [])
            .filter((n) => n.id !== selected.id)
            .map((n) => ({ id: `to:${n.id}`, group: t('Connect {name} to', { name: nodeName(selected.id) }), label: label(n), hint: n.id, icon: iconOf(n) ?? 'box', run: () => connect(selected.id, n.id) }))}
        />
      )}
      {modal === 'shortcuts' && <Shortcuts onClose={closeModal} />}
      {repoOffer && <RepoDialog offer={repoOffer} onWrite={(chosen) => void writeRepo(chosen)} onOpen={(d) => void openRepoDiagram(d)} onClose={() => setRepoOffer(undefined)} />}
      {describing && description() && <DescribeDialog description={description()!} input={exportInput} onClose={() => setDescribing(false)} onDone={(message, tone) => notify(message, tone ? { tone } : {})} />}
      {animating && <AnimateDialog input={exportInput} name={baseName(doc.name)} theme={theme} onClose={() => setAnimating(false)} onDone={(message, tone) => notify(message, tone ? { tone } : {})} />}
      {wsTools.dialogs}
      {trace.dialog}
      {blocks.dialog}
      {noteMenu && (
        <div className="context-menu" style={{ left: noteMenu.x, top: noteMenu.y }}>
          <Menu onClose={() => setNoteMenu(undefined)}>
            {anchorOf(noteMenu.s) && (
              <button role="menuitem" onClick={() => addNote(anchorOf(noteMenu.s))}>
                <Icon name="message-square" /> {t('Add a note on {what}', { what: anchorOf(noteMenu.s)!.about })}
              </button>
            )}
            <button role="menuitem" onClick={() => addNote(pointAnchor(noteMenu.at))}>
              <Icon name="map-pin" /> {t('Add a note here')}
            </button>
            <button role="menuitem" onClick={() => setNotesOpen(true)}>
              <Icon name="message-square" /> {t('Show the notes')}
            </button>
            {trace.menuItems(() => setNoteMenu(undefined))}
            {blocks.menuItems(() => setNoteMenu(undefined))}
          </Menu>
        </div>
      )}
      {modal === 'templates' && <Start key={incoming?.name} theme={theme} incoming={incoming} current={guiding ? typeId : undefined} onOpen={start} onClose={closeModal} />}
      {modal === 'problems' && (
        <Palette
          placeholder={diagnostics.length || shownNotes || wsTools.folderProblems.length ? t('Filter problems…') : t('No problems: everything draws')}
          onClose={closeModal}
          commands={[...diagnostics.map((d, i) => ({
            id: `p${i}`,
            group: d.severity === 'error' ? t('Errors') : t('Warnings'),
            label: d.message,
            hint: d.line ? t('line {line}', { line: d.line }) : undefined,
            icon: 'circle-exclamation-point',
            run: () => {
              if (d.from != null && current) editor.current?.reveal(d.from, d.to ?? d.from);
              requestAnimationFrame(() => editor.current?.focus());
            },
          })), ...(shownNotes?.items.map((m, i) => ({ id: `n${i}`, group: shownNotes.title, label: m, icon: 'triangle-exclamation-point', run: () => {} })) ?? []), ...wsTools.problemCommands]}
        />
      )}
      {dropping && (
        <div className="drop-here" aria-hidden="true">
          <div>
            <Icon name="folder-open" size={22} />
            <strong>{t('Drop to open')}</strong>
            <span>{t('A diagram; data products and contracts (ODPS, ODCS); or a folder of az, Graph, AzureHound or gh api JSON: it becomes one diagram')}</span>
          </div>
        </div>
      )}
      {toast && (
        <div className={toast.tone === 'error' ? 'toast error' : 'toast'} role={toast.tone === 'error' ? 'alert' : 'status'} ref={dockToast} key={toast.message}>
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

/** An empty label field says what is drawn instead ("Users", from the kind) as its placeholder: empty is not "no name". */
function withDrawnName<F extends { key: string; kind: string; value?: unknown; note?: string }>(fields: F[], drawn: string | undefined): F[] {
  if (!drawn) return fields;
  return fields.map((f) => (f.kind === 'text' && ['label', 'name', 'title'].includes(f.key) && f.value === '' ? { ...f, note: `${drawn} (as drawn; type to change it)` } : f));
}

// The diagrams of a folder read together: elements by id across files, the relations, the views, and
// which drawing shows each element. The HTML export uses it to link a drawing to the next one down.
//
// Each file is read on its own (`indexFile`); the links between files (includes, what is in scope, what
// each view shows) are worked out afterwards over those summaries. What a view shows is worked out from
// the view as written, the way the engine picks it, without laying anything out: close, not drawn.
import { parseSource } from './source.ts';
import { includesOf, joinPath } from './include.ts';
import { viewKinds, type ViewKind } from './catalogue.ts';
import type { Path } from './model.ts';

export interface WsElement {
  id: string;
  name: string;
  parent?: string;
  kind?: string;
  label?: string;
  description?: string;
  technology?: string;
  owner?: string;
  tags: string[];
  file: string;
  path: Path;
  line?: number;
}

export interface WsRelation {
  from: string;
  to: string;
  label?: string;
  file: string;
  line?: number;
}

export interface WsView {
  file: string;
  name: string;
  title?: string;
  kind?: ViewKind;
  of?: string;
  path: Path;
  line?: number;
  /** As written, for working out what it shows. */
  raw: Record<string, unknown>;
}

/** An entry of a diagram: a node, a group, a principal, a data product … */
export interface WsEntry {
  id: string;
  collection: string;
  label?: string;
  kind?: string;
  ref?: string;
  of?: string;
  path: Path;
  line?: number;
}

/** What one file says, read from that file alone. */
export interface WsFile {
  file: string;
  text: string;
  type?: string;
  title?: string;
  /** Why it could not be read. */
  error?: { message: string; line?: number };
  /** Includes as written, relative to the file, and resolved to workspace paths. */
  includes: { rel: string; file: string; line?: number }[];
  elements: WsElement[];
  relations: WsRelation[];
  views: WsView[];
  entries: WsEntry[];
  /** Ids named in the fields of a type that does not draw the model itself (a capability's `systems: [crm]`). */
  names: string[];
}

export interface WorkspaceIndex {
  files: Map<string, WsFile>;
  /** Every definition of each id; more than one is the same id in two models. */
  elements: Map<string, WsElement[]>;
  relations: WsRelation[];
  views: WsView[];
  /** Files in scope of each file: itself and what it includes, transitively. */
  scope: Map<string, string[]>;
  /** What each drawing shows: "file#view" (or "file") → element id → the id it is drawn under. */
  shows: Map<string, Map<string, string>>;
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Keys that are not collections of entries. */
const NOT_ENTRIES = new Set(['type', 'title', 'subtitle', 'direction', 'include', 'elements', 'relations', 'views', 'focus', 'steps', 'theme', 'icons', 'aspect', 'badges', 'view', 'provider', 'edges']);

/** Types that resolve the model into their nodes and groups (ref:, of:, views). */
export const GRAPH_TYPES = new Set(['model', 'c4', 'systems', 'azure', 'cloud', 'kubernetes', 'network']);
/** Fields that hold words, not ids. */
const PROSE = new Set(['label', 'title', 'subtitle', 'caption', 'description', 'note', 'notes', 'technology', 'owner', 'kind', 'class', 'version', 'icon', 'tone', 'file', 'links']);

/** Diagram files of a folder: YAML with a top-level type:, not a data contract or a layout. */
// A Helm chart's Chart.yaml (type: application) and Kubernetes manifests have a top-level type: too, and are code, not diagrams.
export const isDiagramFile = (path: string, text: string) => /\.ya?ml$/i.test(path) && !/\.odcs\.ya?ml$/i.test(path) && /^type:\s*[\w-]+/m.test(text) && !/(^|\/)Chart\.yaml$/.test(path) && !/^apiVersion\s*:/m.test(text);

const dirOf = (file: string) => file.split('/').slice(0, -1).join('/');

/** Reads one file. */
export function indexFile(file: string, text: string): WsFile {
  const out: WsFile = { file, text, includes: [], elements: [], relations: [], views: [], entries: [], names: [] };
  const src = parseSource(text);
  const line = (p: Path) => src.locate(p)?.line;
  if (src.data === undefined || !isMap(src.data)) {
    const d = src.diagnostics.find((x) => x.severity === 'error');
    out.error = { message: d?.message ?? 'not a diagram', line: d?.line };
    return out;
  }
  const data = src.data;
  out.type = str(data.type);
  out.title = str(data.title);
  for (const [i, rel] of includesOf(data).entries()) out.includes.push({ rel, file: joinPath(dirOf(file), rel), line: line(['include', Array.isArray(data.include) ? i : []].flat() as Path) });

  const walk = (map: unknown, parent: string | undefined, base: Path) => {
    if (!isMap(map)) return;
    for (const [name, raw] of Object.entries(map)) {
      const path = [...base, name];
      const id = parent ? `${parent}.${name}` : name;
      const o = isMap(raw) ? raw : typeof raw === 'string' ? { kind: raw } : {};
      out.elements.push({
        id,
        name,
        ...(parent ? { parent } : {}),
        kind: str(o.kind),
        label: str(o.label),
        description: str(o.description),
        technology: str(o.technology),
        owner: str(o.owner),
        tags: [...list(o.tags).map(String), ...(o.external === true ? ['external'] : [])],
        file,
        path,
        line: line(path),
      });
      walk(o.elements, id, [...path, 'elements']);
    }
  };
  walk(data.elements, undefined, ['elements']);

  if (Array.isArray(data.relations))
    data.relations.forEach((item, i) => {
      const text = typeof item === 'string' ? item : isMap(item) && Object.keys(item).length === 1 && /->|--|\.\.>|<-/.test(Object.keys(item)[0]!) ? Object.keys(item)[0]! : undefined;
      const [from, to] = text ? edgeIds(text) : [];
      if (from && to) out.relations.push({ from, to, label: relationLabel(data, ['relations', i]), file, line: line(['relations', i]) });
    });
  out.names = namesOf(data);

  if (isMap(data.views))
    for (const [name, raw] of Object.entries(data.views)) {
      const o = isMap(raw) ? raw : {};
      out.views.push({ file, name, title: str(o.title), kind: viewKinds.find((k) => k === o.kind), of: str(o.of), path: ['views', name], line: line(['views', name]), raw: o });
    }

  for (const [coll, v] of Object.entries(data)) {
    if (NOT_ENTRIES.has(coll) || !isMap(v)) continue;
    for (const [id, raw] of Object.entries(v)) {
      const o = isMap(raw) ? raw : {};
      out.entries.push({
        id,
        collection: coll,
        label: str(o.label) ?? str(o.title) ?? (typeof raw === 'string' && coll !== 'nodes' && coll !== 'groups' ? raw : undefined),
        kind: str(o.kind) ?? (typeof raw === 'string' && (coll === 'nodes' || coll === 'groups') ? raw : undefined),
        ...(str(o.ref) ? { ref: str(o.ref) } : raw == null && (coll === 'nodes' || coll === 'groups') ? { ref: id } : {}),
        ...(str(o.of) ? { of: str(o.of) } : {}),
        path: [coll, id],
        line: line([coll, id]),
      });
    }
  }
  return out;
}

const relationLabel = (data: Record<string, unknown>, path: Path): string | undefined => {
  const item = (data.relations as unknown[])[path[1] as number];
  if (!isMap(item)) return undefined;
  const v = Object.values(item)[0];
  return typeof v === 'string' ? v : isMap(v) ? str(v.label) : str(item.label);
};

/** The two ends of "a -> b" (the first and last of a chain). */
export function edgeIds(s: string): string[] {
  const ids = s.split(/\s*(?:<->|-->|\.\.>|->|--|<-)\s*/).map((x) => x.trim()).filter(Boolean);
  return ids.length >= 2 ? [ids[0]!, ids.at(-1)!] : [];
}

/** Ids named in the fields of a type that does not draw the model itself: any value that may be an element's id. */
function namesOf(data: Record<string, unknown>): string[] {
  if (GRAPH_TYPES.has(String(data.type))) return [];
  const out: string[] = [];
  const walk = (v: unknown, path: Path) => {
    if (typeof v === 'string') return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(v) && out.push(v.trim());
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, [...path, i]));
    // A participant's ref: is an entry's ref:, not a name.
    if (isMap(v)) for (const [k, x] of Object.entries(v)) if (!PROSE.has(k) && !(k === 'ref' && path[0] === 'participants' && path.length === 2)) walk(x, [...path, k]);
  };
  for (const [k, v] of Object.entries(data)) if (!NOT_ENTRIES.has(k)) walk(v, [k]);
  return out;
}

// ---------------------------------------------------------------- the whole workspace

/** The index of a set of files: the diagrams among them, read and linked. */
export function indexWorkspace(files: Iterable<[string, string]>): WorkspaceIndex {
  const read = new Map<string, WsFile>();
  for (const [path, text] of files) if (isDiagramFile(path, text)) read.set(path, indexFile(path, text));
  return link(read);
}

const key = (file: string, view?: string) => (view ? `${file}#${view}` : file);

function link(files: Map<string, WsFile>): WorkspaceIndex {
  const elements = new Map<string, WsElement[]>();
  const relations: WsRelation[] = [];
  const views: WsView[] = [];
  for (const f of files.values()) {
    for (const el of f.elements) elements.set(el.id, [...(elements.get(el.id) ?? []), el]);
    relations.push(...f.relations);
    views.push(...f.views);
  }

  // Scope: the file and what it includes, transitively.
  const scope = new Map<string, string[]>();
  const scopeOf = (file: string): string[] => {
    const known = scope.get(file);
    if (known) return known;
    const seen: string[] = [];
    const visit = (f: string) => {
      if (seen.includes(f)) return;
      seen.push(f);
      for (const inc of files.get(f)?.includes ?? []) if (files.has(inc.file)) visit(inc.file);
    };
    visit(file);
    scope.set(file, seen);
    return seen;
  };
  for (const f of files.values()) scopeOf(f.file);

  const shows = new Map<string, Map<string, string>>();
  for (const f of files.values()) {
    if (f.error) continue;
    const inScope = scopeOf(f.file);
    const els = new Map<string, WsElement>();
    for (const s of inScope) for (const el of files.get(s)?.elements ?? []) if (!els.has(el.id)) els.set(el.id, el);
    const rels = inScope.flatMap((s) => files.get(s)?.relations ?? []);
    const children = new Map<string, string[]>();
    for (const el of els.values()) if (el.parent) children.set(el.parent, [...(children.get(el.parent) ?? []), el.id]);
    const top = [...els.values()].filter((e) => !e.parent).map((e) => e.id);

    // Entries that stand for an element: ref:, of:, or the same id as one.
    const graphish = f.entries.some((e) => e.collection === 'nodes' || e.collection === 'groups');
    const local = new Map<string, string>();
    const runs: [string, string][] = [];
    for (const e of f.entries) {
      if (e.of) {
        if (els.has(e.of)) runs.push([e.of, e.id]);
        continue;
      }
      const el = e.ref ?? (els.has(e.id) ? e.id : undefined);
      if (el && els.has(el) && !local.has(el)) local.set(el, e.id);
    }
    const drawnAs = (id: string) => local.get(id) ?? id;

    const named = new Set(f.names.filter((id) => els.has(id)));

    // What each drawing shows.
    const drawings: { view?: WsView; ids: Set<string> }[] = [];
    const asWritten = new Set<string>();
    for (const [el] of local) asWritten.add(el);
    for (const [el] of runs) asWritten.add(el);
    for (const el of named) asWritten.add(el);
    const ownViews = f.views;
    const drawsItself = graphish || f.entries.length > 0;
    // A model (or a C4 file) without views draws its top level; with only views, the first view is the drawing.
    if (!drawsItself && !ownViews.length && f.elements.length) for (const id of top) asWritten.add(id);
    if (drawsItself || !ownViews.length) drawings.push({ ids: asWritten });
    for (const v of ownViews) drawings.push({ view: v, ids: viewShows(v, { els, top, children, rels, local: [...local.keys()], runs }) });
    for (const d of drawings) {
      const m = new Map<string, string>();
      for (const id of d.ids) {
        if (!els.has(id)) continue;
        const node = d.view?.kind === 'deployment' ? id : drawnAs(id);
        m.set(id, (d.view ? undefined : runs.find(([e]) => e === id)?.[1]) ?? node);
      }
      shows.set(key(f.file, d.view?.name), m);
    }
  }

  return { files, elements, relations, views, scope, shows };
}

interface ViewWorld {
  els: Map<string, WsElement>;
  top: string[];
  children: Map<string, string[]>;
  rels: WsRelation[];
  local: string[];
  runs: [string, string][];
}

const within = (id: string, root: string) => id === root || id.startsWith(root + '.');

/** The ancestor of `id` one level under `parent` (or at the top). */
function liftTo(id: string, parent: string | undefined): string {
  const parts = id.split('.');
  const depth = parent ? parent.split('.').length + 1 : 1;
  return parts.slice(0, depth).join('.');
}

/** What a view shows, from the view as written. */
export function viewShows(v: WsView, w: ViewWorld): Set<string> {
  const out = new Set<string>();
  const o = v.raw;
  const sel = (k: string) => list(o[k]).map(String);
  const of = v.of;
  const related = (inside: (id: string) => boolean, lift: (id: string) => string) => {
    for (const r of w.rels) {
      const a = inside(r.from);
      const b = inside(r.to);
      if (a && !b) out.add(lift(r.to));
      if (b && !a) out.add(lift(r.from));
    }
  };
  switch (v.kind) {
    case 'landscape':
      w.top.forEach((id) => out.add(id));
      break;
    case 'context':
      if (of) (out.add(of), related((id) => within(id, of), (id) => liftTo(id, undefined)));
      break;
    case 'container':
      if (of) {
        out.add(of);
        (w.children.get(of) ?? []).forEach((id) => out.add(id));
        related((id) => within(id, of), (id) => liftTo(id, undefined));
      }
      break;
    case 'component':
      if (of) {
        out.add(of);
        const parent = w.els.get(of)?.parent;
        if (parent) out.add(parent);
        (w.children.get(of) ?? []).forEach((id) => out.add(id));
        related((id) => within(id, of), (id) => (parent && within(id, parent) ? liftTo(id, parent) : liftTo(id, undefined)));
      }
      break;
    case 'dynamic':
      for (const s of list(o.steps)) {
        const t = typeof s === 'string' ? s : isMap(s) ? Object.keys(s)[0] : undefined;
        if (t) edgeIds(t).forEach((id) => out.add(id));
      }
      break;
    case 'deployment': {
      const walk = (nodes: unknown) => {
        if (!isMap(nodes)) return;
        for (const raw of Object.values(nodes)) {
          if (!isMap(raw)) continue;
          list(raw.instances).forEach((id) => out.add(String(id)));
          if (typeof raw.of === 'string') out.add(raw.of);
          walk(raw.nodes);
        }
      };
      walk(o.nodes);
      break;
    }
    default: {
      const include = o.include == null ? ['*'] : sel('include');
      for (const s of include) pick(s, w).forEach((id) => out.add(id));
      // What is written in the diagram is in `*` too.
      if (include.includes('*')) (w.local.forEach((id) => out.add(id)), w.runs.forEach(([id]) => out.add(id)));
    }
  }
  for (const id of sel('expand')) (w.children.get(id) ?? []).forEach((c) => out.add(c));
  if (!v.kind || v.kind === 'context' || v.kind === 'container' || v.kind === 'component') {
    if (v.kind && o.include != null) for (const s of sel('include')) pick(s, w).forEach((id) => out.add(id));
    for (const s of sel('exclude')) if (!/->/.test(s)) pick(s, w).forEach((id) => out.delete(id));
  }
  // An expanded element is a boundary around its parts, still in the drawing.
  return out;
}

function pick(s: string, w: ViewWorld): string[] {
  const t = s.trim();
  if (t === '*') return w.top;
  if (t.startsWith('tag:')) return [...w.els.values()].filter((e) => e.tags.includes(t.slice(4))).map((e) => e.id);
  if (t.startsWith('kind:')) return [...w.els.values()].filter((e) => e.kind === t.slice(5)).map((e) => e.id);
  if (/->/.test(t)) return edgeIds(t).filter((x) => x !== '*' && w.els.has(x));
  if (t.endsWith('.*')) return w.children.get(t.slice(0, -2)) ?? [];
  return w.els.has(t) ? [t] : [];
}

// ---------------------------------------------------------------- questions

/** The element a drawn node stands for, in a file (and view) of the workspace. */
export function elementAt(ix: WorkspaceIndex, file: string, view: string | undefined, node: string): string | undefined {
  const m = ix.shows.get(key(file, view));
  if (m) for (const [el, n] of m) if (n === node) return el;
  // Not in what the view is thought to show: a node of the file that names the element.
  const f = ix.files.get(file);
  const e = f?.entries.find((x) => x.id === node);
  if (e?.of) return e.of;
  if (e?.ref) return e.ref;
  const base = node.replace(/@.*$/, '');
  return ix.elements.has(base) ? base : undefined;
}

/** The next view down from an element: its containers, its components, else its context. */
export function drillTarget(ix: WorkspaceIndex, id: string, from?: { file: string; view?: string }): { file: string; view: string } | undefined {
  const here = from?.view ? ix.views.find((v) => v.file === from.file && v.name === from.view) : undefined;
  const order: ViewKind[] = here?.kind === 'landscape' ? ['context', 'container', 'component'] : here?.kind === 'context' ? ['container', 'component'] : ['container', 'component', 'context'];
  // Views in the file we are in come first, then the files that include the same model.
  const near = (v: WsView) => (v.file === from?.file ? 0 : 1);
  for (const kind of order) {
    const hit = ix.views.filter((v) => v.kind === kind && v.of === id && !(v.file === from?.file && v.name === from?.view)).sort((a, b) => near(a) - near(b))[0];
    if (hit) return { file: hit.file, view: hit.name };
  }
  // Untyped views that open it.
  const open = ix.views.find((v) => list(v.raw.expand).map(String).includes(id) && !(v.file === from?.file && v.name === from?.view));
  return open ? { file: open.file, view: open.name } : undefined;
}

/** The view about the level above: for breadcrumbs and drilling up. */
export function viewAbout(ix: WorkspaceIndex, id: string | undefined, prefer?: string): { file: string; view: string } | undefined {
  const pick = (vs: WsView[]) => vs.sort((a, b) => (a.file === prefer ? 0 : 1) - (b.file === prefer ? 0 : 1))[0];
  const hit = id
    ? pick(ix.views.filter((v) => (v.kind === 'container' || v.kind === 'component') && v.of === id)) ?? pick(ix.views.filter((v) => v.kind === 'context' && v.of === id))
    : pick(ix.views.filter((v) => v.kind === 'landscape'));
  return hit ? { file: hit.file, view: hit.name } : undefined;
}

/** The element a view is about, and the chain above it: online.api → [online, online.api]. */
export function trail(ix: WorkspaceIndex, file: string, view?: string): string[] {
  const v = view ? ix.views.find((x) => x.file === file && x.name === view) : undefined;
  if (!v?.of) return [];
  const parts = v.of.split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
}

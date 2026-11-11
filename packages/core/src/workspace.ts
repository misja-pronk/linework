// The workspace: every diagram of a folder read into one model view of it. Elements by id across
// files, which diagrams and views show each one, the relations, and every `ref:`, `of:`, instance or
// view that names one. The editor searches it, walks it (drill down, where used) and checks it; the
// CLI checks it with `carto validate <folder>`.
//
// Each file is read on its own (`indexFile`, cached by its text), so a change re-reads one file; the
// links between files (includes, what is in scope, what each view shows) are worked out afterwards
// over those summaries, which is cheap. What a view shows is worked out from the view as written, the
// way the engine picks it, without laying anything out: close, not drawn.
import { parseSource } from './source.ts';
import { includesOf, joinPath } from './include.ts';
import { viewKinds, type ViewKind } from './catalogue.ts';
import type { Path } from './model.ts';

/** How a file names an element. */
export type WsHow = 'ref' | 'of' | 'instance' | 'same-id' | 'relation' | 'view' | 'selector' | 'step' | 'edge' | 'name';

/** A place in the YAML that holds ids: what rename rewrites and where-used lists. */
export interface WsSite {
  path: Path;
  /** The id is in the single key of the map at `path` ("a -> b": …). */
  key?: boolean;
  /** id: the whole string is one id; selector: a view rule (id, id.*, a -> b, tag:x); edge: "a -> b" or a chain. */
  form: 'id' | 'selector' | 'edge';
  how: WsHow;
  view?: string;
  /** The string as written. */
  text: string;
}

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
  sites: (WsSite & { line?: number })[];
}

/** Where an element appears: a drawing (file and view) and how it is named there. */
export interface WsUse {
  file: string;
  /** The view; undefined for the diagram as written. */
  view?: string;
  how: WsHow | 'shown' | 'defined';
  line?: number;
  /** The id it is drawn under there, when it is drawn: a node's own key for a ref: or of:. */
  node?: string;
}

export interface WsProblem {
  file: string;
  line?: number;
  path?: Path;
  severity: 'error' | 'warning';
  message: string;
  /** The element it is about, for jumping to it. */
  element?: string;
}

export interface WorkspaceIndex {
  files: Map<string, WsFile>;
  /** Every definition of each id; more than one is the same id in two models. */
  elements: Map<string, WsElement[]>;
  relations: WsRelation[];
  views: WsView[];
  /** Drawings (file + view) each element is in, and every place that names it. */
  uses: Map<string, WsUse[]>;
  /** Files in scope of each file: itself and what it includes, transitively. */
  scope: Map<string, string[]>;
  /** What each drawing shows: "file#view" (or "file") → element id → the id it is drawn under. */
  shows: Map<string, Map<string, string>>;
  problems: WsProblem[];
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
  const out: WsFile = { file, text, includes: [], elements: [], relations: [], views: [], entries: [], sites: [] };
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

  for (const site of sitesOf(data)) {
    out.sites.push({ ...site, line: line(site.path) });
    if (site.how === 'relation') {
      const [from, to] = edgeIds(site.text);
      if (from && to) out.relations.push({ from, to, label: relationLabel(data, site.path), file, line: line(site.path) });
    }
  }

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

/** Ids a site names: the plain ids in it, without `.*`, wildcards, tag: and kind: rules. */
export function siteIds(site: Pick<WsSite, 'form' | 'text'>): string[] {
  if (site.form === 'id') return [site.text.trim()].filter(Boolean);
  if (/^(tag|kind):/.test(site.text.trim())) return [];
  return site.text
    .split(/\s*(?:<->|-->|\.\.>|->|--|<-)\s*/)
    .map((x) => x.trim().replace(/\.\*$/, ''))
    .filter((x) => x && x !== '*' && /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(x));
}

/** Every place in a diagram that names model elements (or entries, in the edge and focus rules). */
export function sitesOf(data: Record<string, unknown>): WsSite[] {
  const out: WsSite[] = [];
  const id = (v: unknown, path: Path, how: WsHow, view?: string) => typeof v === 'string' && out.push({ path, form: 'id', how, text: v, ...(view ? { view } : {}) });
  const ids = (v: unknown, path: Path, how: WsHow, view?: string) => (Array.isArray(v) ? v.forEach((x, i) => id(x, [...path, i], how, view)) : id(v, path, how, view));
  const selectors = (v: unknown, path: Path, view?: string) =>
    Array.isArray(v) ? v.forEach((x, i) => typeof x === 'string' && out.push({ path: [...path, i], form: 'selector', how: 'selector', text: x, ...(view ? { view } : {}) })) : typeof v === 'string' && out.push({ path, form: 'selector', how: 'selector', text: v, ...(view ? { view } : {}) });
  const edges = (items: unknown, base: Path, how: WsHow, view?: string) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, i) => {
      const path = [...base, i];
      if (typeof item === 'string') out.push({ path, form: 'edge', how, text: item, ...(view ? { view } : {}) });
      else if (isMap(item)) {
        if (typeof item.from === 'string' || typeof item.to === 'string') {
          for (const k of ['from', 'to']) if (typeof item[k] === 'string') out.push({ path: [...path, k], form: 'id', how, text: item[k] as string, ...(view ? { view } : {}) });
        } else {
          const keys = Object.keys(item);
          if (keys.length === 1 && /->|--|\.\.>|<-/.test(keys[0]!)) out.push({ path, key: true, form: 'edge', how, text: keys[0]!, ...(view ? { view } : {}) });
        }
      }
    });
  };
  const focus = (v: unknown, path: Path, view?: string) => (isMap(v) ? selectors(v.on, [...path, 'on'], view) : selectors(v, path, view));
  const presentSteps = (items: unknown, base: Path, view?: string) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, i) => {
      if (!isMap(item)) return;
      for (const k of ['focus', 'show', 'hide', 'path']) if (item[k] != null) (k === 'focus' ? focus(item[k], [...base, i, k], view) : selectors(item[k], [...base, i, k], view));
    });
  };
  const deployment = (nodes: unknown, base: Path, view: string) => {
    if (!isMap(nodes)) return;
    for (const [k, raw] of Object.entries(nodes)) {
      if (!isMap(raw)) continue;
      ids(raw.instances, [...base, k, 'instances'], 'instance', view);
      id(raw.of, [...base, k, 'of'], 'of', view);
      deployment(raw.nodes, [...base, k, 'nodes'], view);
    }
  };

  edges(data.relations, ['relations'], 'relation');
  // Types that do not draw the model themselves name its elements in fields of their own (a capability's
  // `systems: [crm]`, a data product's `inputs: [ledger]`): any value that is an element's id is one.
  if (!GRAPH_TYPES.has(String(data.type))) {
    const walk = (v: unknown, path: Path) => {
      if (typeof v === 'string') return /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(v) && out.push({ path, form: 'id', how: 'name', text: v });
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, [...path, i]));
      // A participant's ref: is listed as one below, not once more as a name.
      if (isMap(v)) for (const [k, x] of Object.entries(v)) if (!PROSE.has(k) && !(k === 'ref' && path[0] === 'participants' && path.length === 2)) walk(x, [...path, k]);
    };
    for (const [k, v] of Object.entries(data)) if (!NOT_ENTRIES.has(k)) walk(v, [k]);
  }
  if (isMap(data.views))
    for (const [name, raw] of Object.entries(data.views)) {
      if (!isMap(raw)) continue;
      const at: Path = ['views', name];
      id(raw.of, [...at, 'of'], 'view', name);
      for (const k of ['include', 'exclude', 'expand']) selectors(raw[k], [...at, k], name);
      if (raw.complete !== true) selectors(raw.complete, [...at, 'complete'], name);
      if (raw.focus != null) focus(raw.focus, [...at, 'focus'], name);
      if (raw.kind === 'dynamic') edges(raw.steps, [...at, 'steps'], 'step', name);
      else presentSteps(raw.steps, [...at, 'steps'], name);
      deployment(raw.nodes, [...at, 'nodes'], name);
      edges(raw.edges, [...at, 'edges'], 'edge', name);
    }
  for (const coll of ['nodes', 'groups', 'participants']) {
    const m = data[coll];
    if (!isMap(m)) continue;
    for (const [k, raw] of Object.entries(m)) {
      if (!isMap(raw)) continue;
      id(raw.ref, [coll, k, 'ref'], 'ref');
      id(raw.of, [coll, k, 'of'], 'of');
    }
  }
  if (data.focus != null) focus(data.focus, ['focus']);
  presentSteps(data.steps, ['steps']);
  edges(data.edges, ['edges'], 'edge');
  return out;
}

// ---------------------------------------------------------------- the whole workspace

/** A workspace index kept up to date file by file. */
export class Workspace {
  private cache = new Map<string, WsFile>();
  private built?: WorkspaceIndex;

  constructor(files?: Iterable<[string, string]>) {
    if (files) this.sync(files);
  }

  /** Brings the index to these files: only changed files are read again. Returns how many were. */
  sync(files: Iterable<[string, string]>): number {
    const next = new Map<string, WsFile>();
    let read = 0;
    for (const [path, text] of files) {
      if (!isDiagramFile(path, text)) continue;
      const had = this.cache.get(path);
      if (had && had.text === text) next.set(path, had);
      else (next.set(path, indexFile(path, text)), read++);
    }
    if (read || next.size !== this.cache.size) this.built = undefined;
    this.cache = next;
    return read;
  }

  /** One file changed (or went: text undefined). */
  update(path: string, text: string | undefined) {
    if (text == null || !isDiagramFile(path, text)) this.cache.delete(path);
    else if (this.cache.get(path)?.text !== text) this.cache.set(path, indexFile(path, text));
    else return;
    this.built = undefined;
  }

  get index(): WorkspaceIndex {
    return (this.built ??= link(this.cache));
  }
}

/** The index of a set of files at once. */
export function indexWorkspace(files: Iterable<[string, string]>): WorkspaceIndex {
  return new Workspace(files).index;
}

const key = (file: string, view?: string) => (view ? `${file}#${view}` : file);

function link(files: Map<string, WsFile>): WorkspaceIndex {
  const elements = new Map<string, WsElement[]>();
  const relations: WsRelation[] = [];
  const views: WsView[] = [];
  const problems: WsProblem[] = [];
  for (const f of files.values()) {
    for (const el of f.elements) elements.set(el.id, [...(elements.get(el.id) ?? []), el]);
    relations.push(...f.relations);
    views.push(...f.views);
    if (f.error) problems.push({ file: f.file, line: f.error.line, severity: 'error', message: `Cannot be read: ${f.error.message}` });
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
  for (const f of files.values()) {
    scopeOf(f.file);
    for (const inc of f.includes) if (!files.has(inc.file)) problems.push({ file: f.file, line: inc.line, severity: 'error', message: `include: ${inc.rel} is not in the folder` });
  }

  const uses = new Map<string, WsUse[]>();
  const use = (id: string, u: WsUse) => uses.set(id, [...(uses.get(id) ?? []), u]);
  for (const [id, defs] of elements) for (const d of defs) use(id, { file: d.file, how: 'defined', line: d.line });

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
      // A ref: written out is a site of its own (below); a bare key or the same id is the element itself.
      const written = f.sites.some((s) => s.how === 'ref' && s.path[0] === e.collection && s.path[1] === e.id);
      if (el && els.has(el) && !written) use(el, { file: f.file, how: 'same-id', line: e.line, node: e.id });
    }
    const drawnAs = (id: string) => local.get(id) ?? id;

    // Sites: where-used, and the dangling ones.
    const localIds = new Set(f.entries.map((e) => e.id));
    const deployed = new Map<string, Set<string>>();
    for (const v of f.views) {
      const keys = new Set<string>();
      const walk = (nodes: unknown) => isMap(nodes) && Object.entries(nodes).forEach(([k, raw]) => (keys.add(k), isMap(raw) && walk(raw.nodes)));
      walk(v.raw.nodes);
      deployed.set(v.name, keys);
    }
    const named = new Set<string>();
    for (const s of f.sites) {
      for (const id of siteIds(s)) {
        if (s.how === 'name') {
          if (els.has(id)) (named.add(id), use(id, { file: f.file, how: 'name', line: s.line }));
          continue;
        }
        if (s.view && deployed.get(s.view)?.has(id.split('.')[0]!)) continue;
        if (els.has(id)) {
          use(id, { file: f.file, view: s.view, how: s.how, line: s.line });
          continue;
        }
        // Rules and lines may name the diagram's own entries; a ref:, of:, instance or a view's of: names the model.
        if (localIds.has(id) || localIds.has(id.split('.')[0]!)) continue;
        if (s.how === 'selector' || s.how === 'edge') {
          if (!id.includes('.') && !els.size) continue;
        }
        const what = { ref: 'ref:', of: 'of:', instance: 'instances:', view: 'of:', relation: 'relation', step: 'step', selector: 'rule', edge: 'line', 'same-id': '' }[s.how];
        const near = closest(id, [...els.keys()]);
        problems.push({
          file: f.file,
          line: s.line,
          path: s.path,
          severity: s.how === 'selector' || s.how === 'edge' ? 'warning' : 'error',
          message: els.size
            ? `${what} ${id}: there is no element "${id}" in ${inScope.filter((x) => files.get(x)?.elements.length).join(', ') || 'the model'}${near ? `; did you mean ${near}?` : ''}`
            : `${what} ${id}: there is no model here; include the file that defines it`,
        });
      }
    }

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
        use(id, { file: f.file, view: d.view?.name, how: 'shown', node: m.get(id), line: d.view ? d.view.line : f.entries.find((e) => e.id === (local.get(id) ?? runs.find(([x]) => x === id)?.[1]))?.line });
      }
      shows.set(key(f.file, d.view?.name), m);
    }
  }

  // The same id in two models that meet (one folder, or a diagram that includes both), saying different things.
  const together = (a: string, b: string) => dirOf(a) === dirOf(b) || [...scope.values()].some((s) => s.includes(a) && s.includes(b));
  for (const [id, defs] of elements) {
    for (const d of defs) {
      const other = defs.filter((x) => x !== d && x.file !== d.file && together(x.file, d.file) && sameKind(x.kind) !== sameKind(d.kind));
      if (other.length)
        problems.push({ file: d.file, line: d.line, path: d.path, element: id, severity: 'warning', message: `"${id}" is ${a(d.kind)} here, but ${other.map((x) => `${a(x.kind)} in ${x.file}`).join(', ')}` });
    }
  }
  // Elements no drawing shows.
  for (const [id, defs] of elements) {
    if ((uses.get(id) ?? []).some((u) => u.how === 'shown')) continue;
    const d = defs[0]!;
    problems.push({ file: d.file, line: d.line, path: d.path, element: id, severity: 'warning', message: `${d.label ?? id} (${id}) is in no diagram or view` });
  }

  problems.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));
  return { files, elements, relations, views, uses, scope, shows, problems };
}

/** Words for the same kind of thing. */
const SAME: Record<string, string> = { system: 'software-system', 'software-system': 'software-system', user: 'person', person: 'person', db: 'database', database: 'database' };
const sameKind = (k: string | undefined) => (k ? (SAME[k] ?? k) : '');
const a = (kind: string | undefined) => (!kind ? 'an element without kind' : /^[aeiou]/i.test(kind) ? `an ${kind}` : `a ${kind}`);

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

/** The id that looks most like `id`: one typo away, or the same last part. */
export function closest(id: string, ids: string[]): string | undefined {
  let best: string | undefined;
  let score = Infinity;
  const last = id.split('.').at(-1);
  for (const x of ids) {
    const d = distance(id, x);
    const s = x.split('.').at(-1) === last ? Math.min(d, 1.5) : d;
    if (s < score) (score = s), (best = x);
  }
  return best && score <= Math.max(2, Math.floor(id.length / 4)) ? best : undefined;
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 4) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length]!;
}

// ---------------------------------------------------------------- questions

/** Every drawing an element is in: file and view, and the id it has there. */
/** Best first: a view about it, the view about its parent, a landscape or context, other views, other diagrams. */
export function drawingsOf(ix: WorkspaceIndex, id: string): { file: string; view?: string; node: string }[] {
  const out: { file: string; view?: string; node: string; rank: number }[] = [];
  const parent = ix.elements.get(id)?.[0]?.parent;
  const GRAPH = new Set(['model', 'c4', 'systems', 'azure', 'cloud', 'kubernetes', 'network']);
  for (const [k, m] of ix.shows) {
    const node = m.get(id);
    if (node == null) continue;
    const hash = k.indexOf('#');
    const file = hash < 0 ? k : k.slice(0, hash);
    const view = hash < 0 ? undefined : k.slice(hash + 1);
    const v = view ? ix.views.find((x) => x.file === file && x.name === view) : undefined;
    const rank = v?.of === id ? 0 : parent && v?.of === parent ? 1 : v?.kind === 'context' || v?.kind === 'landscape' ? 2 : v ? 3 : GRAPH.has(ix.files.get(file)?.type ?? '') ? 4 : 5;
    out.push({ file, ...(view ? { view } : {}), node, rank });
  }
  return out.sort((a, b) => a.rank - b.rank || a.file.localeCompare(b.file)).map(({ rank: _, ...w }) => w);
}

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

// ---------------------------------------------------------------- search

export interface WsHit {
  kind: 'element' | 'view' | 'file' | 'entry';
  /** Element id, view name, file path or entry id. */
  id: string;
  title: string;
  detail?: string;
  file: string;
  view?: string;
  /** The node to select when it opens. */
  node?: string;
  /** Where it is written. */
  line?: number;
  /** For elements: the drawings it is in. */
  where?: { file: string; view?: string; node: string }[];
  score: number;
}

/** How well `q` (lower case) matches `text`: whole, start, word start, inside, or letters in order. */
function grade(text: string | undefined, q: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const at = t.indexOf(q);
  if (at > 0 && /[^a-z0-9]/.test(t[at - 1]!)) return 65;
  if (at > 0) return 40;
  // Letters in order, close together: "bapi" finds "banking api".
  let i = 0;
  let gaps = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    else if (i > 0) gaps++;
    if (i === q.length) break;
  }
  return i === q.length && q.length >= 3 && gaps <= q.length * 2 ? 18 : 0;
}

interface Field {
  text?: string;
  weight: number;
  /** Fuzzy (letters in order) only counts on names. */
  fuzzy?: boolean;
}

function score(fields: Field[], words: string[]): number {
  let total = 0;
  for (const w of words) {
    let best = 0;
    for (const f of fields) {
      const g = grade(f.text, w);
      if (g === 18 && !f.fuzzy) continue;
      best = Math.max(best, g * f.weight);
    }
    if (!best) return 0;
    total += best;
  }
  return total / words.length;
}

/** Everything that matches, best first: elements, views, files and the entries of other diagrams. */
export function searchWorkspace(ix: WorkspaceIndex, query: string, limit = 50): WsHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: WsHit[] = [];
  if (!words.length) return hits;
  for (const [id, defs] of ix.elements) {
    const d = defs[0]!;
    const s = score(
      [
        { text: id, weight: 1, fuzzy: true },
        { text: d.name, weight: 1 },
        { text: d.label, weight: 1, fuzzy: true },
        { text: d.technology, weight: 0.6 },
        { text: d.owner, weight: 0.6 },
        { text: d.kind, weight: 0.5 },
        ...d.tags.map((t) => ({ text: t, weight: 0.6 })),
        { text: d.description, weight: 0.4 },
      ],
      words,
    );
    if (!s) continue;
    const where = drawingsOf(ix, id);
    // The drawing to open: a view about it, else the one it is most at home in (its own level), else any.
    const first = where[0];
    hits.push({
      kind: 'element',
      id,
      title: d.label ?? id,
      detail: [id, d.kind, d.technology].filter(Boolean).join(' · '),
      file: first?.file ?? d.file,
      view: first?.view,
      node: first?.node,
      line: first ? undefined : d.line,
      where,
      score: s + 10 + Math.min(5, where.length),
    });
  }
  for (const v of ix.views) {
    const s = score([{ text: v.name, weight: 1, fuzzy: true }, { text: v.title, weight: 1, fuzzy: true }, { text: v.kind, weight: 0.5 }, { text: v.of, weight: 0.7 }], words);
    if (s) hits.push({ kind: 'view', id: v.name, title: v.title ?? v.name, detail: `${v.kind ? `${v.kind} view` : 'view'} in ${v.file}`, file: v.file, view: v.name, score: s + 5 });
  }
  for (const f of ix.files.values()) {
    const s = score([{ text: f.file, weight: 1, fuzzy: true }, { text: f.file.split('/').pop(), weight: 1 }, { text: f.title, weight: 0.9 }, { text: f.type, weight: 0.5 }], words);
    if (s) hits.push({ kind: 'file', id: f.file, title: f.file, detail: [f.type, f.title].filter(Boolean).join(' · '), file: f.file, score: s });
    for (const e of f.entries) {
      // Entries that stand for an element are found as that element.
      if (e.of || (e.ref && ix.elements.has(e.ref)) || (ix.elements.has(e.id) && (ix.scope.get(f.file) ?? []).some((x) => ix.files.get(x)?.elements.some((el) => el.id === e.id)))) continue;
      const s2 = score([{ text: e.id, weight: 0.9, fuzzy: true }, { text: e.label, weight: 0.9, fuzzy: true }, { text: e.kind, weight: 0.4 }], words);
      if (s2) hits.push({ kind: 'entry', id: e.id, title: e.label ?? e.id, detail: `${e.collection} in ${f.file}`, file: f.file, node: e.id, line: e.line, score: s2 - 5 });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

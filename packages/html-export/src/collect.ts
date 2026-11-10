// Draws everything the page will show, once, ahead of time: each diagram as written and each of
// its views, in the light and the dark look, and each written step. What every drawn shape stands
// for comes from the model (the workspace index), so a reader can click a box and see what it is,
// where else it appears, and open the view a level down. Runs in Node and in the editor alike.
import { parse as parseYaml } from 'yaml';
import { decisionsOnDrawing, drillTarget, elementAt, indexFile, indexWorkspace, isDiagramFile, joinPath, markdownBlocks, noteNumbers, notePlain, notesInView, readConcern, statusSaid, trail, viewAbout, type Decision, type Graph, type LayoutSidecar, type Link, type NotesFile, type WorkspaceIndex } from '@cartography/core';
import { noteSpots, render, withDecisions, withReviewNotes, type RenderOptions, type RenderResult } from '@cartography/engine';
import type { Theme } from '@cartography/theme';
import { describe, linkTarget, linkText } from '@cartography/embed/shared';
import type { PDecision, PDrawing, PElement, PFile, PNote, PStep, Picture } from './payload.ts';

export interface HtmlExportInput {
  /** The diagrams to export, by path (forward slashes, relative to one root). */
  entries: string[];
  /** Reads a file by path; undefined when it is not there. */
  read: (path: string) => string | undefined;
  /** Other diagrams of the folder: those an entry drills or links into are exported with it. */
  nearby?: string[];
  /** Follow links and drill-down into `nearby` files (default true). */
  follow?: boolean;
  title?: string;
  /** A contents page and an index of elements (default: when there is more than one diagram). */
  site?: boolean;
  /** Draw the open review notes as markers and list them. */
  notes?: boolean;
  notesFor?: (path: string) => NotesFile | undefined;
  /** Architecture decisions to draw and list (files relative to the same root); see core decisions.ts. */
  decisions?: Decision[];
  sidecarFor?: (path: string) => LayoutSidecar | undefined;
  assetsFor?: (path: string) => RenderOptions['assets'];
  /** What every render gets as well: a theme picked, icon packs, official icons. */
  render?: Pick<RenderOptions, 'themeOverride' | 'packs' | 'pack' | 'iconsOverride' | 'icons' | 'iconPacks' | 'fontScale'>;
  /** Also steps nobody wrote (a dynamic view's numbered lines, a sequence's messages). */
  allSteps?: boolean;
}

export interface Problem {
  file: string;
  line?: number;
  message: string;
}

export interface Collected {
  title: string;
  subtitle?: string;
  site: boolean;
  files: PFile[];
  drawings: PDrawing[];
  elements: PElement[];
  /** The looks the drawings were made in, for their fonts and the page's colours. */
  themes: Theme[];
  problems: Problem[];
  decisions?: PDecision[];
}

const dirOf = (p: string) => p.split('/').slice(0, -1).join('/');
const baseOf = (p: string) => p.split('/').pop() ?? p;
const keyOf = (file: string, view?: string) => (view ? `${file}#${view}` : file);

/** Fields an element is described by elsewhere in the panel, or that only place it. */
const SHOWN = new Set(['kind', 'label', 'title', 'description', 'technology', 'owner', 'tags', 'elements', 'links', 'link', 'in', 'parent', 'of', 'ref', 'icon', 'tone', 'pack', 'rank', 'x', 'y', 'pin', 'style', 'shape', 'color', 'caption', 'nodes', 'groups', 'edges']);

/** Shapes drawn in an SVG: "n:id" for nodes, "g:id" for groups. */
export function drawnShapes(svg: string): string[] {
  const out = new Set<string>();
  for (const m of svg.matchAll(/\sdata-(node|group)="([^"]*)"/g)) out.add(`${m[1] === 'node' ? 'n' : 'g'}:${unescapeAttr(m[2]!)}`);
  return [...out];
}

const unescapeAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** A YAML value as one line of text, or undefined for maps and empty things. */
function scalar(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v) && v.length && v.every((x) => ['string', 'number', 'boolean'].includes(typeof x))) return v.join(', ');
  return undefined;
}

/** The written fields of an entry that the panel does not show already: owner-defined properties. */
function propsOf(raw: unknown): [string, string][] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (SHOWN.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
        const s = scalar(pv);
        if (s) out.push([pk, s]);
      }
      continue;
    }
    const s = scalar(v);
    if (s) out.push([k, s]);
  }
  return out;
}

export async function collect(input: HtmlExportInput): Promise<Collected> {
  const problems: Problem[] = [];
  const texts = new Map<string, string>();
  const read = (p: string) => {
    if (!texts.has(p)) {
      const t = input.read(p);
      if (t !== undefined) texts.set(p, t);
    }
    return texts.get(p);
  };

  // The index knows every diagram that can be reached, and what they include.
  const known = [...new Set([...input.entries, ...(input.nearby ?? [])])];
  const seen = new Set<string>();
  const queue = [...known];
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p)) continue;
    seen.add(p);
    const t = read(p);
    if (t !== undefined) for (const inc of indexFile(p, t).includes) queue.push(inc.file);
  }
  const ix: WorkspaceIndex = indexWorkspace([...texts].filter(([p, t]) => isDiagramFile(p, t)));
  const parsed = new Map<string, unknown>();
  const rawAt = (file: string, path: (string | number)[]) => {
    if (!parsed.has(file)) {
      try {
        parsed.set(file, parseYaml(texts.get(file) ?? ''));
      } catch {
        parsed.set(file, undefined);
      }
    }
    let v = parsed.get(file);
    for (const k of path) v = v && typeof v === 'object' ? (v as Record<string | number, unknown>)[k] : undefined;
    return v;
  };

  const drawings: PDrawing[] = [];
  const files: PFile[] = [];
  const themes: Theme[] = [];
  const addTheme = (t?: Theme) => t && !themes.includes(t) && themes.push(t);
  const elements: PElement[] = [];
  const elementIndex = new Map<string, number>();
  /** Drill and link targets by key, resolved to drawing indices once everything is drawn. */
  const pendingDrill: { drawing: number; shape: string; key: string }[] = [];
  const pendingTrail: { drawing: number; crumbs: { label: string; key?: string }[] }[] = [];

  const subtitles = new Map<string, string>();
  const exportSet: string[] = [];
  const want = (p: string) => !exportSet.includes(p) && read(p) !== undefined && exportSet.push(p);
  input.entries.forEach(want);
  const follow = input.follow ?? true;
  let n = 0;

  const elementFor = (file: string, view: string | undefined, shape: string, graph: Graph, said: ReturnType<typeof describe>): number => {
    const [kind, id] = [shape.slice(0, 1), shape.slice(2)];
    const model = elementAt(ix, file, view, id);
    const def = model ? ix.elements.get(model)?.[0] : undefined;
    const key = def ? def.id : `${file}::${shape}`;
    let at = elementIndex.get(key);
    if (at !== undefined) return at;
    const node = kind === 'n' ? graph.nodes.find((x) => x.id === id) : undefined;
    const group = kind === 'g' ? graph.groups.find((x) => x.id === id) : undefined;
    const told = said.elements.find((e) => e.id === id);
    const entry = ix.files.get(file)?.entries.find((e) => e.id === id);
    const raw = def ? rawAt(def.file, def.path) : entry ? rawAt(file, entry.path) : undefined;
    const own = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const tags = def?.tags.length ? def.tags : node?.tags;
    const technology = def?.technology ?? text(own.technology);
    const owner = def?.owner ?? text(own.owner);
    // A part of a journey: a step (told with its feeling, touchpoints and pains), a phase or the persona.
    const part = node?.shape.kind === 'journey-part' ? node.shape : undefined;
    const kindOf = def?.kind ?? node?.kind ?? entry?.kind ?? part?.part;
    const el: PElement = {
      id: def?.id ?? id,
      label: def?.label ?? told?.label ?? group?.label ?? part?.label ?? id,
      ...(kindOf ? { kind: kindOf } : {}),
      ...((def?.description ?? told?.description) ? { description: def?.description ?? told?.description } : {}),
      ...(technology ? { technology } : {}),
      ...(owner ? { owner } : {}),
      ...(tags?.length ? { tags } : {}),
      where: [],
    };
    const props = propsOf(raw);
    if (part && told?.detail) props.unshift(['about', told.detail]);
    if (part && told?.in) props.unshift(['phase', told.in]);
    if (props.length) el.props = props;
    at = elements.push(el) - 1;
    elementIndex.set(key, at);
    if (def?.parent) {
      // The parent is an element too, even when no drawing shows it.
      const p = ix.elements.get(def.parent)?.[0];
      if (p) {
        let pi = elementIndex.get(p.id);
        if (pi === undefined) {
          pi = elements.push({ id: p.id, label: p.label ?? p.id, ...(p.kind ? { kind: p.kind } : {}), ...(p.description ? { description: p.description } : {}), where: [] }) - 1;
          elementIndex.set(p.id, pi);
        }
        el.parent = pi;
      }
    }
    return at;
  };

  const linkKey = (from: string, link: Link): string | undefined => {
    const t = linkTarget(link);
    if (t.kind === 'view') return keyOf(from, t.view);
    if (t.kind === 'diagram') return keyOf(joinPath(dirOf(from), t.file), t.view);
    return undefined;
  };

  for (let fi = 0; fi < exportSet.length; fi++) {
    const file = exportSet[fi]!;
    const text = read(file)!;
    const common: RenderOptions = {
      ...input.render,
      file: baseOf(file),
      load: (rel: string) => {
        const t = read(joinPath(dirOf(file), rel));
        if (t === undefined) throw new Error(`${rel} is not there`);
        return t;
      },
      sidecar: input.sidecarFor?.(file),
      assets: input.assetsFor?.(file),
      fonts: 'none',
      interactive: true,
      hints: false,
    };
    const prefix = `c${fi}`;
    const first = await render(text, { ...common, theme: 'light', idPrefix: `${prefix}v0` });
    for (const d of first.diagnostics) if (d.severity === 'error') problems.push({ file, line: d.line, message: d.message });
    if (!first.svg) continue;
    const notes = input.notes ? input.notesFor?.(file) : undefined;
    const pfile: PFile = { path: file, title: ix.files.get(file)?.title ?? first.graph?.title ?? baseOf(file), type: ix.files.get(file)?.type ?? first.type?.id ?? '', drawings: [] };
    files.push(pfile);
    if (first.graph?.subtitle) subtitles.set(file, first.graph.subtitle);
    const views: (string | undefined)[] = first.onlyViews ? (first.views ?? []).map((v) => v.name) : [undefined, ...(first.views ?? []).map((v) => v.name)];
    for (const [vi, view] of views.entries()) {
      const idPrefix = `${prefix}v${vi}`;
      const light = vi === 0 ? first : await render(text, { ...common, theme: 'light', view, idPrefix });
      if (!light.svg || !light.graph) {
        for (const d of light.diagnostics) if (d.severity === 'error') problems.push({ file: `${file}${view ? `#${view}` : ''}`, line: d.line, message: d.message });
        continue;
      }
      // A view that picks nothing is left out, as --all-views and decks leave it out.
      if (light.empty) continue;
      const viewName = light.view ?? view;
      const dark = await render(text, { ...common, theme: 'dark', view: viewName, idPrefix });
      addTheme(light.theme);
      addTheme(dark.theme);
      const decided = (r: RenderResult) => withDecisionMarks(r, input.decisions, ix, file);
      const pic = picture(decided(marked(light, notes)), decided(marked(dark, notes)));
      const wsView = viewName ? ix.views.find((v) => v.file === file && v.name === viewName) : undefined;
      const title = (viewName ? first.views?.find((v) => v.name === viewName)?.title : undefined) ?? light.graph.title ?? baseOf(file).replace(/\.ya?ml$/i, '');
      const typeName = first.type?.name ?? first.type?.id ?? pfile.type;
      const drawing: PDrawing = { key: keyOf(file, viewName), file, ...(viewName ? { view: viewName } : {}), title, kind: wsView?.kind ? `${wsView.kind} view` : viewName ? `view of ${typeName}` : `${typeName}`, ...pic, shapes: {}, drill: {} };
      const index = n++;
      drawings.push(drawing);
      pfile.drawings.push(index);

      // Steps: drawn without their caption, which the viewer shows itself.
      if (light.steps?.length && (!light.stepsImplied || input.allSteps)) {
        const steps: PStep[] = [];
        for (let s = 1; s <= light.steps.length; s++) {
          const [l, d] = await Promise.all([
            render(text, { ...common, theme: 'light', view: viewName, idPrefix: `${idPrefix}s${s}`, step: s, stepCaption: false }),
            render(text, { ...common, theme: 'dark', view: viewName, idPrefix: `${idPrefix}s${s}`, step: s, stepCaption: false }),
          ]);
          const state = light.steps[s - 1]!;
          if (l.svg) steps.push({ ...(state.title ? { title: state.title } : {}), ...(state.caption ? { caption: state.caption } : {}), ...picture(l, d) });
        }
        if (steps.length) drawing.steps = steps;
      }

      // What each shape is, and where it leads.
      const graph = light.graph;
      const said = describe(graph);
      // A matrix, a sequence, a git graph, a roadmap or a journey is one shape: the drawing, not an element
      // of it. A journey's steps, phases and persona are drawn as shapes of their own on top: those click.
      const whole = new Set(graph.nodes.filter((x) => ['matrix', 'sequence', 'gitflow', 'roadmap', 'journey'].includes(x.shape.kind)).map((x) => `n:${x.id}`));
      for (const shape of drawnShapes(light.svg)) {
        if (whole.has(shape)) continue;
        const ei = elementFor(file, viewName, shape, graph, said);
        drawing.shapes[shape] = ei;
        const el = elements[ei]!;
        if (!el.where.some(([d, s]) => d === index && s === shape)) el.where.push([index, shape]);
        const id = shape.slice(2);
        const links = (shape.startsWith('n:') ? graph.nodes.find((x) => x.id === id)?.links : graph.groups.find((x) => x.id === id)?.links) ?? [];
        let target: string | undefined;
        for (const l of links) {
          const k = linkKey(file, l);
          if (k) {
            target ??= k;
            continue;
          }
          const t = linkTarget(l);
          // A link that is not safe to follow is not a link at all.
          if (t.kind === 'none') continue;
          const href = t.kind === 'url' && t.external ? t.href : undefined;
          const label = linkText(l);
          el.links ??= [];
          if (!el.links.some((x) => x.label === label)) el.links.push({ label, ...(href ? { href } : {}) });
        }
        const model = ix.elements.has(el.id) ? el.id : undefined;
        if (!target && model) {
          const down = drillTarget(ix, model, { file, view: viewName });
          if (down) target = keyOf(down.file, down.view);
        }
        if (target && target !== drawing.key) {
          pendingDrill.push({ drawing: index, shape, key: target });
          const tf = target.split('#')[0]!;
          if (follow && ix.files.has(tf)) want(tf);
        }
      }

      // Breadcrumbs: the elements above the one this view is about.
      const chain = trail(ix, file, viewName);
      if (chain.length) {
        const label = (id: string) => ix.elements.get(id)?.[0]?.label ?? id;
        const top = ix.views.find((v) => v.kind === 'context' && v.of === chain[0]) ?? ix.views.find((v) => v.kind === 'landscape');
        const crumbs: { label: string; key?: string }[] = [];
        if (top && !(top.file === file && top.name === viewName)) crumbs.push({ label: top.title ?? 'Context', key: keyOf(top.file, top.name) });
        for (const id of chain.slice(0, -1)) {
          const v = viewAbout(ix, id, file);
          crumbs.push({ label: label(id), ...(v ? { key: keyOf(v.file, v.view) } : {}) });
        }
        crumbs.push({ label: label(chain.at(-1)!) });
        pendingTrail.push({ drawing: index, crumbs });
      }

      if (notes) {
        const list = noteList(notes, graph, light, viewName);
        if (list.length) drawing.notes = list;
      }
      if (input.decisions?.length) {
        const shows = ix.shows.get(keyOf(file, viewName));
        const on = decisionsOnDrawing(input.decisions, graph, { file, view: viewName, drawnAs: (id) => shows?.get(id) });
        if (on.length) drawing.decisions = on.map(({ decision, target }) => ({ n: decision.number, ...(target.kind === 'node' ? { shape: `n:${target.id}` } : target.kind === 'group' ? { shape: `g:${target.id}` } : {}) }));
      }
    }
  }

  const byKey = new Map(drawings.map((d, i) => [d.key, i]));
  // A link to a diagram (no view) opens the first drawing of it.
  for (const f of files) if (f.drawings.length && !byKey.has(f.path)) byKey.set(f.path, f.drawings[0]!);
  for (const p of pendingDrill) {
    const to = byKey.get(p.key);
    if (to !== undefined && to !== p.drawing) drawings[p.drawing]!.drill[p.shape] = to;
  }
  for (const t of pendingTrail) drawings[t.drawing]!.trail = t.crumbs.map((c) => ({ label: c.label, ...(c.key && byKey.has(c.key) ? { to: byKey.get(c.key)! } : {}) }));

  // Names that tell the diagrams apart: a file of several views without a title is named after the file.
  const pretty = (p: string) => baseOf(p).replace(/\.ya?ml$/i, '').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  for (const f of files) {
    const own = ix.files.get(f.path)?.title;
    f.title = own ?? (f.drawings.length > 1 ? pretty(f.path) : (drawings[f.drawings[0]!]?.title ?? pretty(f.path)));
  }
  for (const f of files) {
    if (files.filter((g) => g.title === f.title).length < 2) continue;
    const sub = subtitles.get(f.path);
    f.title = `${f.title} — ${sub ?? (f.type === 'model' ? 'model' : pretty(f.path))}`;
  }
  // A folder reads from the top down: the landscape and context first, then containers, components, where it runs.
  const LEVEL: Record<string, number> = { landscape: 0, context: 1, container: 2, component: 3, deployment: 4 };
  const DEPLOY = new Set(['azure', 'cloud', 'kubernetes', 'network', 'deployment']);
  const rank = (f: PFile) => Math.min(DEPLOY.has(f.type) ? 4 : 5, ...ix.views.filter((v) => v.file === f.path).map((v) => LEVEL[v.kind ?? ''] ?? 5));
  const order = files.map((f, i) => ({ f, i, r: rank(f) }));
  if (input.site ?? files.length > 1) order.sort((a, b) => a.r - b.r || a.i - b.i);
  files.splice(0, files.length, ...order.map((o) => o.f));

  const site = input.site ?? files.length > 1;
  const model = [...ix.files.values()].find((f) => f.type === 'model' && f.title);
  const title = input.title ?? (site ? (model?.title ?? files[0]?.title) : files[0]?.title) ?? 'Diagrams';
  const decisions = input.decisions?.length ? input.decisions.map((d) => decisionOf(d, ix)) : undefined;
  return { title, site, files, drawings, elements, themes, problems, ...(decisions ? { decisions } : {}) };
}

/** The decision markers on a drawing (the decisions themselves are a page of their own). */
function withDecisionMarks(r: RenderResult, decisions: Decision[] | undefined, ix: WorkspaceIndex, file: string): RenderResult {
  if (!decisions?.length || !r.svg || !r.graph || !r.placed || !r.width || !r.height || !r.theme) return r;
  const shows = ix.shows.get(keyOf(file, r.view));
  const m = withDecisions({ svg: r.svg, width: r.width, height: r.height, origin: r.origin }, r.graph, r.placed, decisions, r.theme, { file, view: r.view, drawnAs: (id) => shows?.get(id), appendix: false });
  return { ...r, svg: m.svg };
}

/** A decision as the page shows it: its text as blocks, what it is about by name. */
function decisionOf(d: Decision, ix: WorkspaceIndex): PDecision {
  const name = (id: string) => ix.elements.get(id)?.[0]?.label ?? id;
  const about = d.concerns.map((s) => {
    const c = readConcern(s);
    return !c ? s : c.kind === 'edge' ? `${name(c.from)} → ${name(c.to)}` : c.kind === 'view' ? (ix.views.find((v) => v.name === c.view)?.title ?? c.view) : name(c.id);
  });
  // The title is the page's heading: the text starts under it.
  const blocks = markdownBlocks(d.body.replace(/^\s*#[ \t]+.*\n/, ''));
  return { n: d.number, title: d.title, status: d.status, said: statusSaid(d), ...(d.date ? { date: d.date } : {}), about, blocks };
}

/** The open review notes as markers on the drawing (the list goes into the page). */
function marked(r: RenderResult, notes: NotesFile | undefined): RenderResult {
  if (!notes || !r.svg || !r.graph || !r.placed || !r.width || !r.height || !r.theme) return r;
  const m = withReviewNotes({ svg: r.svg, width: r.width, height: r.height, origin: r.origin }, r.graph, r.placed, notes, r.theme, { view: r.view, appendix: false });
  return { ...r, svg: m.svg, width: m.width, height: m.height };
}

/** Open threads only: a resolved note is not for the customer. */
function noteList(notes: NotesFile, graph: Graph, r: RenderResult, view: string | undefined): PNote[] {
  const numbers = noteNumbers(notes);
  const spots = r.placed ? new Map(noteSpots(notes, graph, r.placed, view, {}).map((s) => [s.thread.id, s])) : new Map();
  return notesInView(notes, view)
    .filter((t) => t.status === 'open')
    .sort((a, b) => numbers.get(a.id)! - numbers.get(b.id)!)
    .map((t) => {
      const spot = spots.get(t.id);
      const shape = t.anchor.kind === 'node' ? `n:${t.anchor.id}` : t.anchor.kind === 'group' ? `g:${t.anchor.id}` : undefined;
      return {
        n: numbers.get(t.id)!,
        about: spot?.about ?? (t.anchor.kind === 'point' ? 'the drawing' : (t.anchor.label ?? ('id' in t.anchor ? t.anchor.id : `${t.anchor.from} → ${t.anchor.to}`))),
        ...(shape ? { shape } : {}),
        author: t.author || 'someone',
        date: t.created.slice(0, 10),
        text: notePlain(t.text).join('\n'),
        replies: (t.replies ?? []).map((x) => ({ author: x.author || 'someone', date: x.created.slice(0, 10), text: notePlain(x.text).join('\n') })),
      };
    });
}

/** Light and dark as one picture; dark only when it differs (a brand theme draws the same in both). */
function picture(light: RenderResult, dark: RenderResult): Picture {
  const pic: Picture = { w: light.width ?? 0, h: light.height ?? 0, light: light.svg ?? '' };
  if (dark.svg && dark.svg !== light.svg) pic.dark = dark.svg;
  return pic;
}

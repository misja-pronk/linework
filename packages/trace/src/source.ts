// A diagram file as something to trace: a view (or the diagram as written) is traced as drawn; a
// model without a view asked for is traced whole, at every level, so a request can be followed down
// to the components that handle it.
import { compose, parseSource, type Diagnostic, type Graph } from '@cartography/core';
import { render } from '@cartography/engine';
import { fromCatalogue, fromGraph, type TraceGraph } from './graph.ts';
import { findElement, paths, story, until, type StoryStep, type TraceOption } from './trace.ts';

export interface Traceable {
  graph: TraceGraph;
  /** The story the drawing is told in: its `steps:` routes, or the numbered lines of a dynamic view. */
  steps?: StoryStep[];
  view?: string;
  views: string[];
  diagnostics: Diagnostic[];
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const GRAPHS = new Set(['model', 'c4', 'systems', 'azure', 'cloud', 'kubernetes', 'network']);

/** The file has a model of its own or from an include: its ids are model ids. */
export function hasModel(data: Record<string, unknown>): boolean {
  return GRAPHS.has(String(data.type)) && (isMap(data.elements) || data.include != null);
}

/** The routes of written steps: "a -> b -> c", "a -> b: caption", { title, path }. Selectors that are not ids are left out. */
export function writtenStory(raw: unknown, g: TraceGraph): StoryStep[] {
  if (!Array.isArray(raw)) return [];
  const route = (s: string) => {
    const ids = s.split('->').map((x) => x.trim());
    return ids.length >= 2 && ids.every((id) => g.elements.has(id)) ? [ids] : [];
  };
  const firstSentence = (s: string) => {
    const one = s.split(/(?<=[.!?])\s/)[0]!.replace(/[.!?]$/, '');
    return one.length > 40 ? `${one.slice(0, 38).replace(/\s+\S*$/, '')}…` : one;
  };
  return raw.flatMap((item): StoryStep[] => {
    if (typeof item === 'string') return route(item).length ? [{ routes: route(item) }] : [];
    if (!isMap(item)) return [];
    const keys = Object.keys(item).filter((k) => k.includes('->'));
    const caption = typeof item.caption === 'string' ? item.caption : keys.map((k) => item[k]).find((v): v is string => typeof v === 'string');
    const pathsOf = (v: unknown) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.map(String) : []);
    const routes = [...keys, ...pathsOf(item.path)].flatMap(route);
    const title = typeof item.title === 'string' ? item.title : caption ? firstSentence(caption) : undefined;
    return routes.length ? [{ ...(title ? { title } : {}), routes }] : [];
  });
}

/** The story of a drawn graph: a dynamic view's numbered lines, else the steps written for it. */
export function storyOf(g: TraceGraph, data: Record<string, unknown>, view?: string): StoryStep[] {
  if (g.steps?.length) return g.steps.map((s) => ({ routes: [[s.from, s.to]] }));
  const v = view && isMap(data.views) ? data.views[view] : undefined;
  return writtenStory(isMap(v) ? v.steps : data.steps, g);
}

/** What is drawn on screen, ready to trace (the editor has the graph already). */
export function traceableGraph(graph: Graph, text: string, view?: string): Traceable {
  const data = parseSource(text).data;
  const d = isMap(data) ? data : {};
  const g = fromGraph(graph, hasModel(d));
  const steps = storyOf(g, d, view);
  return { graph: g, ...(steps.length ? { steps } : {}), ...(view ? { view } : {}), views: isMap(d.views) ? Object.keys(d.views) : [], diagnostics: [] };
}

/** A file, ready to trace: the view asked for as drawn, a model whole, anything else as written. */
export async function traceable(text: string, o: { load?: (file: string) => string; file?: string; view?: string } = {}): Promise<Traceable> {
  const src = parseSource(text);
  const data = isMap(src.data) ? src.data : undefined;
  if (!data) return { graph: { elements: new Map(), relations: [], model: false }, views: [], diagnostics: src.diagnostics };
  if (!o.view && hasModel(data) && !isMap(data.nodes)) {
    const diagnostics: Diagnostic[] = [...src.diagnostics];
    const c = compose(data, { load: o.load, schemaOf: () => undefined, report: (path, message, severity = 'error') => diagnostics.push(src.at(path, message, severity)), self: o.file, text });
    const g = fromCatalogue(c.catalogue, typeof data.title === 'string' ? data.title : undefined);
    const steps = writtenStory(data.steps, g);
    return { graph: g, ...(steps.length ? { steps } : {}), views: [...c.catalogue.views.keys()], diagnostics };
  }
  const r = await render(text, { fonts: 'none', load: o.load, file: o.file, view: o.view, focus: null });
  if (!r.graph) return { graph: { elements: new Map(), relations: [], model: false }, views: r.views?.map((v) => v.name) ?? [], diagnostics: r.diagnostics };
  const t = traceableGraph(r.graph, text, r.view);
  return { ...t, views: r.views?.map((v) => v.name) ?? [], diagnostics: r.diagnostics };
}

export interface TraceAsk {
  from?: string;
  /** Left out: from `from` until each call ends. */
  to?: string;
  /** Trace the story (steps:, or the dynamic view) instead of two elements. */
  steps?: boolean;
  /** How many routes to offer between two elements. */
  limit?: number;
}

export interface Traced {
  options: TraceOption[];
  mode: 'between' | 'until' | 'steps';
  from?: string;
  to?: string;
  /** Why there is nothing to show. */
  error?: string;
}

/** What to trace, by the names people give: ids, the end of a dotted id, labels. */
export function traceAsk(t: Traceable, ask: TraceAsk): Traced {
  const g = t.graph;
  if (ask.steps) {
    if (!t.steps?.length) return { options: [], mode: 'steps', error: 'There are no steps with routes to trace here: write steps like "a -> b -> c", or pick a dynamic view' };
    const o = story(g, t.steps);
    return o ? { options: [o], mode: 'steps' } : { options: [], mode: 'steps', error: 'The steps name no route between elements drawn here' };
  }
  if (!ask.from) return { options: [], mode: 'between', error: 'Say where the request starts (--from)' };
  const a = findElement(g, ask.from);
  if (!a.id) return { options: [], mode: 'between', error: a.message };
  if (!ask.to) {
    const o = until(g, a.id);
    return o ? { options: [o], mode: 'until', from: a.id } : { options: [], mode: 'until', from: a.id, error: `Nothing goes out from ${g.elements.get(a.id)!.label}: it has no relations to follow` };
  }
  const b = findElement(g, ask.to);
  if (!b.id) return { options: [], mode: 'between', from: a.id, error: b.message };
  if (a.id === b.id) return { options: [], mode: 'between', from: a.id, to: b.id, error: 'Start and end are the same element' };
  const options = paths(g, a.id, b.id, ask.limit ?? 5);
  if (options.length) return { options, mode: 'between', from: a.id, to: b.id };
  const back = paths(g, b.id, a.id, 1).length;
  const name = (id: string) => g.elements.get(id)!.label;
  return {
    options,
    mode: 'between',
    from: a.id,
    to: b.id,
    error: `No request goes from ${name(a.id)} to ${name(b.id)} along the arrows${back ? `; one goes the other way: trace from ${b.id} to ${a.id}` : ''}`,
  };
}

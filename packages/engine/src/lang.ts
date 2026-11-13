// The words a type put in a drawing itself, in the diagram's `lang:` (see docs/nederlands.md): the
// key's labels, the kind names cards and groups carry as captions, and the label of an entry that has
// none of its own (users: { kind: users } draws "Gebruikers"). What the author wrote stays as written.
import type { Graph, GraphGroup, GraphNode, Path } from '@cartography/core';
import { readLang, type Lang } from '@cartography/i18n';
import { term } from '@cartography/i18n/drawing';

/** `lang:` as written: nl or en (also nl-NL, Dutch); undefined when it says neither. */
export const diagramLang = (v: unknown): Lang | undefined => readLang(v);

const get = (data: unknown, path: Path): unknown => {
  let at = data;
  for (const k of path) {
    if (!at || typeof at !== 'object') return undefined;
    at = (at as Record<string | number, unknown>)[k];
  }
  return at;
};

/** The author wrote this field on the entry at `path` (a shorthand "web: ecs" writes none). */
const written = (data: unknown, path: Path, field: string) => {
  const entry = get(data, path);
  return !!entry && typeof entry === 'object' && field in entry;
};

export function translateGraph(graph: Graph, lang: Lang, source: unknown): Graph {
  if (lang === 'en') return graph;
  // A name that is the entry's own key is the author's too: a class called Member stays Member.
  const own = (x: { path: Path }, field: string, text?: string) => written(source, x.path, field) || (text !== undefined && x.path.at(-1) === text);
  const word = (s: string | undefined) => (s === undefined ? s : term(lang, s));
  const group = (g: GraphGroup): GraphGroup => ({
    ...g,
    ...(own(g, 'label', g.label) ? {} : { label: word(g.label)! }),
    ...(g.caption && !own(g, 'caption') ? { caption: word(g.caption) } : {}),
  });
  const node = (n: GraphNode): GraphNode => {
    const s = n.shape;
    if (s.kind !== 'card' && s.kind !== 'flow' && s.kind !== 'table' && s.kind !== 'block') return n;
    const shape = { ...s } as typeof s & { label?: string; title?: string; caption?: string };
    if ('label' in shape && typeof shape.label === 'string' && !own(n, 'label', shape.label)) shape.label = word(shape.label)!;
    if (shape.kind === 'table' && !own(n, 'label', shape.title) && !own(n, 'title')) shape.title = word(shape.title)!;
    if (shape.caption && !own(n, 'caption')) shape.caption = word(shape.caption);
    return { ...n, shape };
  };
  return {
    ...graph,
    groups: graph.groups.map(group),
    nodes: graph.nodes.map(node),
    ...(graph.legend ? { legend: graph.legend.map((l) => ({ ...l, label: term(lang, l.label) })) } : {}),
  };
}

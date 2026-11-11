// What the interactive HTML export and the docs site share, and nothing that needs a browser or the
// engine: where a link leads, the text alternative of a drawing, and the cleaning of an SVG before it
// goes into a page. A diagram may be written by anyone, so everything from the YAML is untrusted here.
import type { Diagnostic, Graph, Link } from '@cartography/core';

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** http, https, mailto or a relative path; the same rule as `safeHref` in core, kept here so the loader stays small. */
export function safeHref(href: string): string | undefined {
  const clean = href.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+/, '');
  if (!clean) return undefined;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(clean)?.[1]?.toLowerCase();
  return !scheme || scheme === 'http' || scheme === 'https' || scheme === 'mailto' ? clean : undefined;
}

export type LinkTarget =
  /** A web address or a file that is not a diagram: the browser opens it. */
  | { kind: 'url'; href: string; external: boolean }
  /** Another view of the diagram that is open. */
  | { kind: 'view'; view: string }
  /** Another diagram, as written (relative to the open one), and maybe one of its views. */
  | { kind: 'diagram'; file: string; view?: string }
  | { kind: 'none' };

/** Where a link on an element leads from inside an embedded diagram. */
export function linkTarget(link: Link): LinkTarget {
  if (link.kind === 'url') {
    const href = safeHref(link.target);
    return href ? { kind: 'url', href, external: true } : { kind: 'none' };
  }
  if (!link.file) return link.view ? { kind: 'view', view: link.view } : { kind: 'none' };
  if (/\.ya?ml$/i.test(link.file)) return { kind: 'diagram', file: link.file, ...(link.view ? { view: link.view } : {}) };
  const href = safeHref(link.target);
  return href ? { kind: 'url', href, external: false } : { kind: 'none' };
}

export const linkText = (l: Link) => l.label ?? (l.kind === 'url' ? l.target.replace(/^https?:\/\//, '') : l.kind === 'view' && !l.file ? `${l.view} view` : l.target);

export interface Description {
  title?: string;
  subtitle?: string;
  elements: { id: string; label: string; detail?: string; in?: string; description?: string; links: Link[] }[];
  relations: { from: string; to: string; label?: string }[];
}

/** The drawing in words: what is in it and what connects to what. Read by screen readers and by search. */
export function describe(graph: Graph): Description {
  const groups = new Map(graph.groups.map((g) => [g.id, g]));
  const names = new Map<string, string>(graph.groups.map((g) => [g.id, g.label]));
  const elements: Description['elements'] = [];
  const relations: Description['relations'] = [];
  for (const g of graph.groups) {
    const parent = g.parent ? groups.get(g.parent)?.label : undefined;
    elements.push({ id: g.id, label: g.label, detail: g.caption, ...(parent ? { in: parent } : {}), description: g.description, links: g.links ?? [] });
  }
  for (const n of graph.nodes) {
    if (n.folded) continue;
    const parent = n.parent ? groups.get(n.parent)?.label : undefined;
    const s = n.shape;
    if (s.kind === 'sequence') {
      // A sequence diagram is one shape: its participants are the elements, its messages the relations.
      for (const p of s.participants) {
        names.set(p.id, p.label);
        elements.push({ id: p.id, label: p.label, detail: p.caption, links: [] });
      }
      for (const e of s.events) if (e.kind === 'message') relations.push({ from: e.from, to: e.to, label: e.label });
      continue;
    }
    if (s.kind === 'gitflow') {
      // Branches are the elements; merges and cherry-picks between branches are the relations.
      const at = new Map(s.commits.map((c) => [c.id, c.branch]));
      for (const b of s.branches) {
        const own = s.commits.filter((c) => c.branch === b.name);
        const tags = own.flatMap((c) => c.tags);
        const detail = [`${own.length} ${own.length === 1 ? 'commit' : 'commits'}`, tags.length ? `tags ${tags.join(', ')}` : ''].filter(Boolean).join(', ');
        names.set(b.name, b.label ?? b.name);
        elements.push({ id: b.name, label: b.label ?? b.name, detail, links: [] });
      }
      for (const c of s.commits) {
        const from = c.merge ? at.get(c.merge) : c.pick ? at.get(c.pick) : undefined;
        if (from && from !== c.branch) relations.push({ from, to: c.branch, label: c.merge ? 'merge' : 'cherry-pick' });
      }
      for (const p of s.pipelines) {
        const detail = p.steps.map((st) => (st.gate ? `${st.gate}, then ${st.label}` : st.label)).join(' → ');
        elements.push({ id: p.label, label: p.label, detail, links: [] });
      }
      continue;
    }
    if (s.kind === 'roadmap') {
      // Items are the elements, in their lane; "after" dependencies are the relations.
      const lanes = new Map(s.lanes.map((l) => [l.id, l.label]));
      const when = (at: number) => {
        const t = s.ticks.find((k) => at >= k.start && at < k.end) ?? s.ticks.at(-1);
        return t ? [t.label, t.group].filter(Boolean).join(' ') : '';
      };
      for (const i of s.items) {
        const first = when(i.start);
        const last = when(i.end - 1e-6);
        const span = i.milestone ? `milestone, ${first}` : first === last ? first : `${first} to ${last}`;
        const lane = i.lane ? lanes.get(i.lane) : undefined;
        names.set(i.id, i.label);
        elements.push({ id: i.id, label: i.label, detail: [span, i.status].filter(Boolean).join(', '), ...(lane ? { in: lane } : {}), links: [] });
      }
      for (const i of s.items) for (const a of i.after) relations.push({ from: a, to: i.id, label: 'then' });
      continue;
    }
    if (s.kind === 'journey') {
      // Steps are the elements, in their phase; each leads to the next.
      const phases = new Map(s.phases.map((p) => [p.id, p.label]));
      const linksOf = new Map(graph.nodes.map((x) => [x.id, x.links ?? []]));
      const tell = (steps: typeof s.steps, track?: string) => {
        for (const [i, st] of steps.entries()) {
          const detail = [
            st.score != null ? `feeling ${st.score} on ${s.scale.min} to ${s.scale.max}${st.feeling ? ` (${st.feeling})` : ''}` : st.feeling,
            st.touchpoints.length ? `uses ${st.touchpoints.map((t) => t.label).join(', ')}` : '',
            st.actors.length ? `with ${st.actors.join(', ')}` : '',
            st.pains.length ? `pains: ${st.pains.join('; ')}` : '',
            st.gains.length ? `gains: ${st.gains.join('; ')}` : '',
            st.ideas.length ? `opportunities: ${st.ideas.join('; ')}` : '',
          ]
            .filter(Boolean)
            .join(', ');
          const phase = phases.get(st.phase);
          names.set(st.id, st.label);
          elements.push({ id: st.id, label: track ? `${track}: ${st.label}` : st.label, detail, ...(phase ? { in: phase } : {}), description: st.thought ?? st.says, links: linksOf.get(st.id) ?? [] });
          if (i) relations.push({ from: steps[i - 1]!.id, to: st.id, label: 'then' });
        }
      };
      tell(s.steps);
      if (s.view === 'compare' && s.future) tell(s.future.steps, s.future.label);
      continue;
    }
    // Drawn and told by the journey it is part of.
    if (s.kind === 'journey-part') continue;
    if (s.kind === 'flow') {
      // What its outline says, in words: a reader cannot see the diamond or the heavy ring.
      const trigger = n.kind && !['start', 'end'].includes(n.kind) ? `${n.kind} ` : '';
      const what =
        s.form === 'event'
          ? `${trigger}${s.mark === 'mid' ? 'intermediate' : (s.mark ?? '')} event`.trim()
          : s.form === 'gateway'
            ? s.mark === 'and' ? 'parallel gateway' : s.mark === 'or' ? 'inclusive gateway' : s.mark === 'event' ? 'event gateway' : 'decision'
            : s.form === 'pseudo'
              ? s.mark === 'final' ? 'end' : s.mark === 'choice' ? 'choice' : s.mark === 'history' ? 'history' : 'start'
              : s.form === 'task' && n.kind && n.kind !== 'task' ? `${n.kind} task` : s.form;
      const label = s.label || what;
      names.set(n.id, label);
      elements.push({ id: n.id, label, detail: [s.label ? what : '', s.caption, ...(s.lines ?? [])].filter(Boolean).join(', '), ...(parent ? { in: parent } : {}), description: n.description, links: n.links ?? [] });
      continue;
    }
    if (s.kind === 'block') {
      // A heatmap value and a vacancy are said in words as well: a reader cannot see the colour or the dashes.
      names.set(n.id, s.label);
      elements.push({ id: n.id, label: s.label, detail: [s.vacant ? 'vacancy' : '', s.caption, s.heat?.text, ...(s.lines ?? [])].filter(Boolean).join(', '), ...(parent ? { in: parent } : {}), description: n.description, links: n.links ?? [] });
      continue;
    }
    const label = s.kind === 'card' ? s.label : s.kind === 'table' ? s.title : (s.corner ?? n.id);
    const detail =
      s.kind === 'card'
        ? s.caption
        : s.kind === 'table'
          ? [s.caption, `${s.rows.filter((r) => r.kind === 'row').length} rows`].filter(Boolean).join(', ')
          : `table of ${s.rows.length} by ${s.columns.length}`;
    names.set(n.id, label);
    elements.push({ id: n.id, label, detail, ...(parent ? { in: parent } : {}), description: n.description, links: n.links ?? [] });
  }
  for (const e of graph.edges) relations.push({ from: e.from.node, to: e.to.node, label: e.label });
  return {
    title: graph.title,
    subtitle: graph.subtitle,
    elements,
    relations: relations.map((r) => ({ from: names.get(r.from) ?? r.from, to: names.get(r.to) ?? r.to, ...(r.label ? { label: r.label } : {}) })),
  };
}

/** "diagram.yaml:12:5: message", the way compilers say it. */
export function diagnosticText(d: Diagnostic, file?: string): string {
  const where = [file, d.line, d.line ? d.column : undefined].filter((x) => x != null && x !== '').join(':');
  return where ? `${where}: ${d.message}` : d.message;
}

// ---------------------------------------------------------------- SVG cleaning

/** What our renderer draws with. Anything else in an SVG does not belong there and is dropped. */
export const SVG_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'a', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'image', 'filter', 'feDropShadow',
  'clipPath', 'mask', 'linearGradient', 'radialGradient', 'stop', 'marker', 'use', 'symbol', 'pattern', 'style',
]); // prettier-ignore

/**
 * Whether an attribute may stay on an element: no event handlers, links only to safe places, images
 * only as data: pictures or safe paths, `use` only within the drawing.
 */
export function safeAttribute(element: string, name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith('on')) return false;
  if (n === 'href' || n === 'xlink:href') {
    if (element === 'a') return safeHref(value) === value;
    if (element === 'image') return /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(value) || safeHref(value) === value;
    return value.startsWith('#');
  }
  if (n === 'style') return !/url\s*\(|expression\s*\(|@import/i.test(value);
  return true;
}

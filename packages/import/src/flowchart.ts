// Mermaid flowchart / graph → systems, or → process when it is one. Nodes with shapes, subgraphs as
// nested groups, edges with labels: -.-> becomes async, ==> becomes sync (the main path), --> stays
// a plain arrow.
// Flow logic keeps its shapes: {…}, {{…}} and questions become decisions, ([…]) and ((…)) at the
// ends of the flow start and end; in such a process flow every other box is a plain step.
// A flowchart is a process when it decides something: at least one decision, and decisions, starts
// and ends together are two or more and at least a quarter of its nodes, or every other node is a
// plain step (nothing in its words names a part of a system). Then it lands as
// `type: process` (subgraphs become lanes); an architecture with one stray question stays systems.
import { processYaml, type FlowLink, type FlowNode } from './process.ts';
import { guessGroupKind, guessKind, systemsYaml, type SysDiagram, type SysEdge, type SysGroup, type SysNode } from './systems.ts';
import { cleanLabel, faIcon, Ids, slug, type Warnings } from './text.ts';

type Shape = 'rect' | 'round' | 'stadium' | 'subroutine' | 'cylinder' | 'circle' | 'asymmetric' | 'rhombus' | 'hexagon' | 'parallelogram' | 'trapezoid';

// Longest openers first, so "((" is not read as "(".
const SHAPES: [string, string[], Shape][] = [
  ['(((', [')))'], 'circle'],
  ['((', ['))'], 'circle'],
  ['([', ['])'], 'stadium'],
  ['[(', [')]'], 'cylinder'],
  ['[[', [']]'], 'subroutine'],
  ['[/', ['/]', '\\]'], 'parallelogram'],
  ['[\\', ['\\]', '/]'], 'parallelogram'],
  ['{{', ['}}'], 'hexagon'],
  ['[', [']'], 'rect'],
  ['(', [')'], 'round'],
  ['{', ['}'], 'rhombus'],
  ['>', [']'], 'asymmetric'],
];

// Shape names of the newer `id@{ shape: … }` syntax.
const NAMED: Record<string, Shape> = {
  cyl: 'cylinder', cylinder: 'cylinder', db: 'cylinder', database: 'cylinder', das: 'cylinder', 'h-cyl': 'cylinder', 'lin-cyl': 'cylinder', disk: 'cylinder',
  circle: 'circle', circ: 'circle', 'dbl-circ': 'circle', 'sm-circ': 'circle', 'fr-circ': 'circle', start: 'circle', stop: 'circle',
  diamond: 'rhombus', decision: 'rhombus', diam: 'rhombus', question: 'rhombus', hex: 'hexagon', hexagon: 'hexagon', prepare: 'hexagon',
  stadium: 'stadium', pill: 'stadium', terminal: 'stadium', rounded: 'round', event: 'round', subproc: 'subroutine', subroutine: 'subroutine',
};

interface Node {
  source: string;
  label?: string;
  shape?: Shape;
  hint?: string;
  parent?: string;
}

interface Link {
  start: boolean;
  end: boolean;
  line: 'solid' | 'dotted' | 'thick' | 'invisible';
  label?: string;
}

const ID = /[\p{L}\p{N}_]+(?:[-.](?![-.=>])[\p{L}\p{N}_]+)*/uy;
const TEXT_LINK = /([<ox]?)(--|-\.|==)(?![-.=>])\s*(.+?)\s*(-{2,}>|-{3,}|\.-+>|\.-+(?=\s)|={2,}>|={3,}|-{2,}[ox](?=\s)|={2,}[ox](?=\s))/y;
const LINK = /([<ox]?)(-{2,}>|-\.+->|={2,}>|-{2,}[ox](?=\s)|={2,}[ox](?=\s)|-\.+-[ox](?=\s)|-{3,}|-\.+-|={3,}|~{3,})/y;

export function importFlowchart(body: string[], header: string, title: string | undefined, warn: Warnings): string {
  const dir = /^(?:flowchart|graph)\s+(\w+)/i.exec(header)?.[1]?.toUpperCase() ?? 'TD';
  if (dir === 'RL' || dir === 'BT') warn.onceFor('dir', `Direction ${dir} is drawn as ${dir === 'RL' ? 'LR' : 'TD'}: Cartography reads left to right or top to bottom`);
  // The way the source runs is written down, default or not: an edit later must not turn the drawing.
  const direction = dir === 'LR' || dir === 'RL' ? 'right' : 'down';

  const nodes = new Map<string, Node>();
  const groups = new Map<string, { source: string; label: string; parent?: string }>();
  const links: { from: string[]; to: string[]; link: Link }[] = [];
  const stack: string[] = [];

  const node = (source: string, label?: string, shape?: Shape, hint?: string) => {
    let n = nodes.get(source);
    if (!n) nodes.set(source, (n = { source }));
    if (label !== undefined && n.label === undefined) {
      n.label = label;
      n.shape = shape;
      n.hint = hint;
    }
    if (!n.parent && stack.length && !groups.has(source)) n.parent = stack[stack.length - 1];
  };

  for (const raw of body) {
    for (const stmt of splitStatements(raw)) {
      const s = stmt.trim();
      if (!s) continue;
      const sub = /^subgraph\b\s*(.*)$/.exec(s);
      if (sub) {
        const g = subgraphHeader(sub[1]!);
        groups.set(g.source, { ...g, parent: stack[stack.length - 1] });
        stack.push(g.source);
        continue;
      }
      if (s === 'end') {
        if (!stack.pop()) warn.add('An "end" without a subgraph was skipped');
        continue;
      }
      if (/^direction\s+\w+$/.test(s)) {
        if (stack.length) warn.onceFor('subdir', 'Subgraph directions are not imported: the whole diagram uses one direction');
        continue;
      }
      const kw = /^(classDef|class|style|linkStyle|click|accTitle|accDescr)\b/.exec(s)?.[1];
      if (kw) {
        if (!kw.startsWith('acc')) warn.onceFor('style', `Styling (${kw}) is not imported: Cartography colours by kind`);
        continue;
      }
      if (!parseChain(s, node, links, warn)) warn.add(`Could not read "${s}"`);
    }
  }
  if (stack.length) warn.add(`Subgraph "${stack[stack.length - 1]}" has no "end"`);

  // Edges to a subgraph id point at the group; a node with the same id as a group is that group.
  for (const id of groups.keys()) nodes.delete(id);

  const ids = new Ids();
  const groupList: SysGroup[] = [];
  for (const g of groups.values()) groupList.push({ id: ids.get(g.source), label: g.label, kind: guessGroupKind(g.label), parent: g.parent && ids.get(g.parent) });

  // Where the flow starts and ends: nodes without lines in, or without lines out.
  const into = new Set<string>();
  const outOf = new Set<string>();
  for (const { from, to, link } of links)
    if (link.line !== 'invisible')
      for (const a of from)
        for (const b of to) {
          const back = link.start && !link.end;
          into.add(back ? a : b);
          outOf.add(back ? b : a);
        }
  const kinds = new Map([...nodes.values()].map((n) => [n, kindFor(n.label ?? n.source, n.source, n.shape, n.hint, !into.has(n.source), !outOf.has(n.source))]));
  // Where decisions and terminals are a good part of the drawing it is a process: its boxes are
  // steps, whatever their words suggest. One stray question in an architecture changes nothing.
  const logic = [...kinds.values()].filter((k) => k === 'decision' || k === 'start' || k === 'end').length;
  // So it is where everything else is a plain step: nothing in their words names a part of a system.
  const plainSteps = [...kinds.values()].every((k) => k === 'decision' || k === 'start' || k === 'end' || k === 'step');
  const process = logic >= 2 && (logic * 4 >= kinds.size || plainSteps);
  // A process that decides something is drawn as one, unless a line ends on a subgraph: a lane is
  // not something a flow can point at.
  const visible = links.filter((l) => l.link.line !== 'invisible');
  if (process && [...kinds.values()].includes('decision') && !visible.some((l) => [...l.from, ...l.to].some((id) => groups.has(id)))) {
    if (links.length > visible.length) warn.onceFor('invisible', 'Invisible links (~~~) are left out');
    // Lanes do not nest: what stands in a subgraph of a subgraph stands in the outer one.
    const top = (g: string | undefined): string | undefined => (g && groups.get(g)?.parent ? top(groups.get(g)!.parent) : g);
    if ([...groups.values()].some((g) => g.parent)) warn.onceFor('nested', 'Subgraphs inside subgraphs are not kept: lanes do not nest, their steps stand in the outer lane');
    // A diamond with one way in and one way out decides nothing: it comes in as a step.
    const ways = (id: string, end: 'from' | 'to') => visible.reduce((n, l) => n + (l[end].includes(id) ? l[end === 'from' ? 'to' : 'from'].length : 0), 0);
    const flowNodes: FlowNode[] = [...kinds].map(([n, kind]) => ({
      source: n.source,
      label: n.label ?? n.source,
      kind: kind === 'decision' ? (ways(n.source, 'from') > 1 || ways(n.source, 'to') > 1 ? kind : 'task') : kind === 'start' || kind === 'end' ? kind : n.shape === 'subroutine' ? 'subprocess' : n.shape === 'cylinder' ? 'document' : 'task',
      ...(n.parent ? { lane: ids.get(top(n.parent)!) } : {}),
    }));
    const flowLinks: FlowLink[] = [];
    for (const { from, to, link } of visible)
      for (const a of from)
        for (const b of to) {
          if (link.start && link.end) warn.onceFor('both', 'Lines with an arrow at both ends are drawn one way');
          const [x, y] = link.start && !link.end ? [b, a] : [a, b];
          flowLinks.push({ from: x, to: y, ...(link.label ? { label: link.label } : {}), message: link.line === 'dotted' });
        }
    return processYaml({ title, direction, lanes: [...groups.values()].filter((g) => !g.parent).map((g) => ({ id: ids.get(g.source), label: g.label })), nodes: flowNodes, links: flowLinks });
  }
  const nodeList: SysNode[] = [];
  for (const [n, kind] of kinds) {
    const box = !n.shape || ['rect', 'round', 'subroutine', 'asymmetric', 'parallelogram', 'trapezoid'].includes(n.shape);
    nodeList.push({ id: ids.get(n.source), label: n.label ?? n.source, kind: process && box && !n.hint ? 'step' : kind, parent: n.parent && ids.get(n.parent) });
  }

  const edges: SysEdge[] = [];
  for (const { from, to, link } of links) {
    if (link.line === 'invisible') {
      warn.onceFor('invisible', 'Invisible links (~~~) are left out');
      continue;
    }
    for (const a of from)
      for (const b of to) {
        const style = link.line === 'thick' ? 'sync' : link.line === 'dotted' ? (/\b(logs?|metrics|traces?|monitor|auth|token|config|reads? config)\b/i.test(link.label ?? '') ? 'dotted' : 'async') : undefined;
        // "a <-- b" has only a start arrow: turn it round so it points the way it is drawn.
        const [x, y] = link.start && !link.end ? [b, a] : [a, b];
        edges.push({ from: ids.get(x), to: ids.get(y), op: link.start && link.end ? '<->' : link.end || link.start ? '->' : '--', label: link.label, style });
      }
  }

  const d: SysDiagram = { title, direction, explicit: true, groups: groupList, nodes: nodeList, edges };
  return systemsYaml(d);
}

function kindFor(label: string, source: string, shape: Shape | undefined, hint: string | undefined, first: boolean, last: boolean): string {
  // A diamond or a question is a decision whatever it mentions ("Valid session?").
  if (shape === 'rhombus' || /\?\s*$/.test(label)) return 'decision';
  const byWords = guessKind(label) ?? (hint && guessKind(hint)) ?? guessKind(source.replace(/([a-z])([A-Z])/g, '$1 $2'));
  if (shape === 'cylinder') return byWords && ['cache', 'queue', 'topic', 'storage', 'warehouse', 'search', 'database'].includes(byWords) ? byWords : 'database';
  if (byWords) return byWords;
  // {{API Gateway}} is a gateway by its words; a hexagon that says nothing more is a decision.
  if (shape === 'hexagon') return 'decision';
  // Pills and circles are terminals only where the flow begins or stops; mid-flow they are boxes.
  if ((shape === 'stadium' || shape === 'circle') && (first || last)) return first ? 'start' : 'end';
  // Nothing says what it is: a plain step, without a guessed kind to caption it.
  return 'step';
}

/** `id[Title]`, `id ["Title"]`, `"Title"` or `Some title`. */
function subgraphHeader(rest: string): { source: string; label: string } {
  const r = rest.trim();
  const m = /^([^\s[]+)\s*\[(.*)\]$/.exec(r);
  if (m) return { source: m[1]!, label: cleanLabel(m[2]!) };
  const label = cleanLabel(r);
  return { source: /^[\w-]+$/.test(r) ? r : slug(label), label };
}

/** Split on ";" outside quotes and brackets. */
function splitStatements(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of line) {
    if (ch === '"') quote = !quote;
    else if (!quote && '[({'.includes(ch)) depth++;
    else if (!quote && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === ';' && !quote && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

type NodeFn = (source: string, label?: string, shape?: Shape, hint?: string) => void;

/** `A[x] & B --> |label| C --- D`: node groups joined by links. False when it is not that. */
function parseChain(s: string, node: NodeFn, links: { from: string[]; to: string[]; link: Link }[], warn: Warnings): boolean {
  let pos = 0;
  const ws = () => {
    while (pos < s.length && /\s/.test(s[pos]!)) pos++;
  };
  const nodeRef = (): string | undefined => {
    ws();
    ID.lastIndex = pos;
    const m = ID.exec(s);
    if (!m) return undefined;
    const id = m[0];
    pos = ID.lastIndex;
    if (s.startsWith(':::', pos)) pos = skip(/:::[\w-]+/y);
    if (s.startsWith('@{', pos)) {
      const close = s.indexOf('}', pos);
      const spec = s.slice(pos + 2, close < 0 ? s.length : close);
      pos = close < 0 ? s.length : close + 1;
      const shape = /\bshape\s*:\s*([\w-]+)/.exec(spec)?.[1];
      const label = /\blabel\s*:\s*("([^"]*)"|[^,]+)/.exec(spec);
      const icon = /\bicon\s*:\s*"?([\w:-]+)/.exec(spec)?.[1];
      node(id, label ? cleanLabel(label[2] ?? label[1]!) : id, shape ? NAMED[shape] : undefined, icon?.replace(/^\w+:/, '').replace(/-/g, ' '));
      return id;
    }
    for (const [open, closers, shape] of SHAPES) {
      if (!s.startsWith(open, pos)) continue;
      const start = pos + open.length;
      // A quoted label may hold the closer itself: ["a [b]"].
      const after = s[start] === '"' ? s.indexOf('"', start + 1) + 1 : start;
      if (after === 0) return undefined;
      const hit = closers.map((c) => [c, s.indexOf(c, after)] as const).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1])[0];
      if (!hit) return undefined;
      const [closer, end] = hit;
      const raw = s.slice(start, end);
      pos = end + closer.length;
      if (s.startsWith(':::', pos)) pos = skip(/:::[\w-]+/y);
      node(id, cleanLabel(raw) || id, shape, faIcon(raw));
      return id;
    }
    node(id);
    return id;
  };
  const skip = (re: RegExp) => {
    re.lastIndex = pos;
    return re.exec(s) ? re.lastIndex : pos;
  };
  const group = (): string[] | undefined => {
    const first = nodeRef();
    if (!first) return undefined;
    const out = [first];
    for (;;) {
      ws();
      if (s[pos] !== '&') return out;
      pos++;
      const next = nodeRef();
      if (!next) return undefined;
      out.push(next);
    }
  };
  const link = (): Link | undefined => {
    ws();
    for (const re of [TEXT_LINK, LINK]) {
      re.lastIndex = pos;
      const m = re.exec(s);
      if (!m) continue;
      const token = re === TEXT_LINK ? m[2]! + m[4]! : m[2]!;
      pos = re.lastIndex;
      let label = re === TEXT_LINK ? cleanLabel(m[3]!) : undefined;
      ws();
      if (s[pos] === '|') {
        const close = s.indexOf('|', pos + 1);
        if (close > 0) {
          label = cleanLabel(s.slice(pos + 1, close));
          pos = close + 1;
        }
      }
      if (/[ox]$/.test(token) || /^[ox]$/.test(m[1]!)) warn.onceFor('ends', 'Circle and cross arrow ends (--o, --x) are drawn as arrows');
      return {
        start: m[1] !== '',
        end: /[>ox]$/.test(token),
        line: token.includes('~') ? 'invisible' : token.includes('.') ? 'dotted' : token.includes('=') ? 'thick' : 'solid',
        label: label || undefined,
      };
    }
    return undefined;
  };

  let from = group();
  if (!from) return false;
  for (;;) {
    ws();
    if (pos >= s.length) return true;
    const l = link();
    if (!l) return false;
    const to = group();
    if (!to) return false;
    links.push({ from, to, link: l });
    from = to;
  }
}

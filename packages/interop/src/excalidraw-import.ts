// An Excalidraw file read as a Cartography diagram. A file Cartography wrote carries what each
// shape stands for in its customData and comes back as it left. Any other file is read by its
// shapes: a box with text is a node, a frame or a box around other boxes a group, an arrow
// between two shapes a connection.
import type { Box } from '@cartography/core';
import { graphTypes, Ids, writeImported, type End, type ImportedDiagram, type ImportOptions, type InDiagram, type InEdge, type InMessage, type Line } from './imported.ts';

interface Shape {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  strokeStyle?: string;
  groupIds?: string[];
  frameId?: string | null;
  containerId?: string | null;
  text?: string;
  name?: string | null;
  points?: [number, number][];
  startBinding?: { elementId?: string } | null;
  endBinding?: { elementId?: string } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  customData?: Record<string, unknown>;
}

/** Whether a text is an Excalidraw file (or what Excalidraw puts on the clipboard). */
export function isExcalidraw(text: string): boolean {
  return /^\s*\{/.test(text) && /"type"\s*:\s*"excalidraw(\/clipboard)?"/.test(text) && /"elements"\s*:/.test(text);
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const boxOf = (s: Shape): Box => ({ x: s.x, y: s.y, width: s.width, height: s.height });
const area = (b: Box) => b.width * b.height;
const contains = (a: Box, b: Box) => a.x <= b.x + 1 && a.y <= b.y + 1 && a.x + a.width >= b.x + b.width - 1 && a.y + a.height >= b.y + b.height - 1 && area(a) > area(b) * 1.05;
const inside = (a: Box, x: number, y: number) => x >= a.x && y >= a.y && x <= a.x + a.width && y <= a.y + a.height;
const lines = (t: string | undefined) => (t ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/** An Excalidraw arrowhead as the end of a connection. */
function endOf(head: string | null | undefined): End {
  if (!head) return 'none';
  if (head === 'crowfoot_one') return 'one';
  if (head === 'crowfoot_many') return 'many';
  if (head === 'crowfoot_one_or_many') return 'oneOrMany';
  return 'arrow';
}

/** A file Cartography wrote: every shape says what it is. */
function readOwn(shapes: Shape[]): InDiagram {
  const page = (shapes.find((s) => s.customData?.page)?.customData?.page ?? {}) as Record<string, unknown>;
  const type = str(page.type) ?? 'systems';
  const d: InDiagram = {
    type: graphTypes[type] || type === 'erd' || type === 'sequence' ? type : 'systems',
    ...(str(page.title) ? { title: str(page.title) } : {}),
    ...(str(page.subtitle) ? { subtitle: str(page.subtitle) } : {}),
    ...(page.direction === 'down' ? { direction: 'down' as const } : {}),
    exact: true,
    groups: [],
    nodes: [],
    edges: [],
    tables: [],
    texts: [],
    dropped: [],
  };
  if (d.type !== type) d.dropped.push(`This was a ${type} diagram: its boxes and lines are kept as a systems diagram, what the ${type} type knew beyond that is not`);
  const messages: InMessage[] = [];
  // A participant drawn at the head and the foot of its lifeline is one participant.
  const seen = new Set<string>();
  for (const s of shapes) {
    const k = s.customData;
    const what = str(k?.carto);
    const id = str(k?.id);
    if (!k || !what) continue;
    const box = boxOf(s);
    const parent = str(k.in);
    if (what === 'group' && id) d.groups.push({ id, label: str(k.label) ?? id, kind: str(k.kind), caption: str(k.caption), parent, box });
    else if ((what === 'node' || what === 'participant') && id && !seen.has(id)) {
      seen.add(id);
      if (type === 'erd') {
        const rows = shapes.filter((r) => r.customData?.carto === 'row' && r.customData.in === id);
        d.tables.push({ id, label: str(k.label) ?? id, parent, columns: rows.map((r) => ({ id: str(r.customData!.id) ?? 'column', type: str(r.customData!.type), marks: (str(r.customData!.marks) ?? '').split(' ').filter(Boolean) })), box });
      } else d.nodes.push({ id, label: str(k.label) ?? id, kind: str(k.kind), caption: str(k.caption), parent, box });
    } else if ((what === 'edge' || what === 'badge') && str(k.from) && str(k.to)) {
      d.edges.push({
        from: str(k.from)!,
        to: str(k.to)!,
        ...(str(k.label) ? { label: str(k.label) } : {}),
        line: (str(k.line) as Line | undefined) ?? 'solid',
        start: (str(k.start) as End | undefined) ?? 'none',
        end: (str(k.end) as End | undefined) ?? 'arrow',
        ...(str(k.style) ? { style: str(k.style) } : {}),
        ...(what === 'badge' ? { badge: true } : {}),
      });
      // A node that was only ever a badge comes back as a node; the type folds it again.
      const to = str(k.to)!;
      if (what === 'badge' && (k.toKind || k.toLabel) && !seen.has(to)) {
        seen.add(to);
        d.nodes.push({ id: to, label: str(k.toLabel) ?? to, kind: str(k.toKind), caption: str(k.toCaption), parent: str(k.toIn) });
      }
    } else if (what === 'message' && str(k.from) && str(k.to)) messages.push({ from: str(k.from)!, to: str(k.to)!, arrow: (str(k.arrow) as InMessage['arrow'] | undefined) ?? 'sync', ...(str(k.label) ? { label: str(k.label) } : {}) });
    else if (what === 'matrix' && id) d.nodes.push({ id, label: id, parent, box });
  }
  if (type === 'sequence') d.messages = messages;
  return d;
}

/** Any other Excalidraw drawing, read by its shapes. */
function readForeign(shapes: Shape[]): InDiagram {
  const d: InDiagram = { type: 'systems', groups: [], nodes: [], edges: [], tables: [], texts: [], dropped: [] };
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const boxes = shapes.filter((s) => s.type === 'rectangle' || s.type === 'ellipse' || s.type === 'diamond');
  const frames = shapes.filter((s) => s.type === 'frame' || s.type === 'magicframe');
  const texts = shapes.filter((s) => s.type === 'text' && lines(s.text).length);
  const arrows = shapes.filter((s) => s.type === 'arrow');

  // A box drawn around other boxes is a group, as a frame is.
  const groups = new Set<Shape>(frames);
  for (const b of boxes) if (boxes.some((o) => o !== b && contains(boxOf(b), boxOf(o)))) groups.add(b);
  const holder = (s: Shape): Shape | undefined => {
    let best: Shape | undefined;
    for (const g of groups) {
      if (g === s) continue;
      const frame = g.type !== 'rectangle' && g.type !== 'ellipse' && g.type !== 'diamond';
      // In a frame by what the file says, or by lying within it.
      if (!(frame && s.frameId === g.id) && !contains(boxOf(g), boxOf(s))) continue;
      if (!best || area(boxOf(g)) < area(boxOf(best))) best = g;
    }
    return best;
  };

  // The words of a box: the text bound to it, else the texts that lie on it.
  const words = new Map<Shape, string[]>();
  const loose: Shape[] = [];
  const arrowText = new Map<string, string>();
  for (const t of texts) {
    const owner = t.containerId ? byId.get(t.containerId) : undefined;
    if (owner?.type === 'arrow') arrowText.set(owner.id, lines(t.text).join(' '));
    else if (owner && boxes.includes(owner)) words.set(owner, [...lines(t.text), ...(words.get(owner) ?? [])]);
    else loose.push(t);
  }
  const left: Shape[] = [];
  for (const t of loose.sort((a, b) => a.y - b.y)) {
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    let best: Shape | undefined;
    for (const b of boxes) if (!groups.has(b) && inside(boxOf(b), cx, cy) && (!best || area(boxOf(b)) < area(boxOf(best)))) best = b;
    if (best) words.set(best, [...(words.get(best) ?? []), ...lines(t.text)]);
    else left.push(t);
  }
  // A group without words of its own takes the loose text at its top as its label.
  const said: string[] = [];
  for (const t of left) {
    const g = holder(t);
    if (g && !words.has(g) && !(g.type === 'frame' && str(g.name))) words.set(g, lines(t.text));
    else said.push(lines(t.text).join(' '));
  }
  d.texts.push(...said);

  const ids = new Ids();
  const depth = (s: Shape) => {
    let n = 0;
    for (let p = holder(s); p; p = holder(p)) n++;
    return n;
  };
  for (const g of [...groups].sort((a, b) => depth(a) - depth(b))) {
    const w = str(g.name) ? [str(g.name)!, ...(words.get(g) ?? [])] : (words.get(g) ?? []);
    const text = w[0] ?? 'Group';
    const up = holder(g);
    d.groups.push({ id: ids.get(g.id, text), label: text, ...(w.length > 1 ? { caption: w.slice(1).join(' ') } : {}), parent: up ? ids.find(up.id) : undefined, box: boxOf(g) });
  }
  const bound = new Set<string>();
  for (const a of arrows) for (const e of [a.startBinding?.elementId, a.endBinding?.elementId]) if (e) bound.add(e);
  let decoration = 0;
  const nodes: Shape[] = [];
  for (const b of boxes) {
    if (groups.has(b)) continue;
    const w = words.get(b) ?? [];
    if (!w.length && !bound.has(b.id)) {
      decoration++;
      continue;
    }
    const text = w[0] ?? 'Shape';
    const up = holder(b);
    nodes.push(b);
    // A diamond is a decision where the type knows one; the rest is guessed from the words.
    d.nodes.push({ id: ids.get(b.id, text), label: text, ...(b.type === 'diamond' ? { kind: 'decision' } : {}), ...(w.length > 1 ? { caption: w.slice(1).join(' ') } : {}), parent: up ? ids.find(up.id) : undefined, box: boxOf(b) });
  }

  // Arrows: a bound end is an end on that shape; a loose end that lies on a shape is attached to it.
  const near = (x: number, y: number): string | undefined => {
    let best: Shape | undefined;
    for (const b of nodes) {
      const q = boxOf(b);
      if (x < q.x - 8 || y < q.y - 8 || x > q.x + q.width + 8 || y > q.y + q.height + 8) continue;
      if (!best || area(q) < area(boxOf(best))) best = b;
    }
    return best ? ids.find(best.id) : undefined;
  };
  const end = (a: Shape, binding: { elementId?: string } | null | undefined, p: [number, number] | undefined): string | undefined => {
    let to = binding?.elementId ? byId.get(binding.elementId) : undefined;
    // An arrow bound to a text is bound to the box the text is in.
    if (to?.type === 'text' && to.containerId) to = byId.get(to.containerId);
    return (to ? ids.find(to.id) : undefined) ?? (p ? near(a.x + p[0], a.y + p[1]) : undefined);
  };
  let unbound = 0;
  let down = 0;
  for (const a of arrows) {
    const from = end(a, a.startBinding, a.points?.[0]);
    const to = end(a, a.endBinding, a.points?.at(-1));
    if (!from || !to) {
      unbound++;
      continue;
    }
    // The words of an arrow: the text bound to it, else a text grouped with it.
    const grouped = a.groupIds?.length ? texts.find((t) => !t.containerId && t.groupIds?.some((g) => a.groupIds!.includes(g))) : undefined;
    const label = arrowText.get(a.id) ?? (grouped ? lines(grouped.text).join(' ') : undefined);
    const edge: InEdge = { from, to, ...(label ? { label } : {}), line: a.strokeStyle === 'dashed' ? 'dashed' : a.strokeStyle === 'dotted' ? 'dotted' : 'solid', start: endOf(a.startArrowhead), end: endOf(a.endArrowhead) };
    d.edges.push(edge);
    if (grouped) d.texts = d.texts.filter((t) => t !== label);
    const p = a.points ?? [];
    const dx = (p.at(-1)?.[0] ?? 0) - (p[0]?.[0] ?? 0);
    const dy = (p.at(-1)?.[1] ?? 0) - (p[0]?.[1] ?? 0);
    down += Math.abs(dy) > Math.abs(dx) ? 1 : -1;
  }
  if (down > 0) d.direction = 'down';

  const other = shapes.filter((s) => s.type === 'line' || s.type === 'freedraw' || s.type === 'image' || s.type === 'embeddable' || s.type === 'iframe').length;
  if (unbound) d.dropped.push(`${unbound} arrow(s) were not attached to a shape at both ends: left out`);
  if (decoration) d.dropped.push(`${decoration} shape(s) without text were left out`);
  if (other) d.dropped.push(`${other} line(s), drawing(s) or picture(s) were left out`);
  return d;
}

/** An Excalidraw file as a Cartography diagram, with its report. */
export function importExcalidraw(text: string, opts: ImportOptions = {}): ImportedDiagram {
  let file: { elements?: unknown };
  try {
    file = JSON.parse(text) as { elements?: unknown };
  } catch {
    return { type: 'systems', yaml: '', report: ['This is not an Excalidraw file: it is not JSON'] };
  }
  const shapes = (Array.isArray(file.elements) ? (file.elements as Shape[]) : []).filter((s) => s && typeof s === 'object' && !s.isDeleted && typeof s.type === 'string');
  for (const s of shapes) for (const k of ['x', 'y', 'width', 'height'] as const) if (!Number.isFinite(s[k])) s[k] = 0;
  const own = shapes.some((s) => s.customData?.page && s.customData.carto);
  const d = own ? readOwn(shapes) : readForeign(shapes);
  if (!own && shapes.length === 1 && shapes[0]!.type === 'image') d.dropped.push('The file is one picture: there are no shapes to read');
  if (own && !d.nodes.length && !d.tables.length && shapes.some((s) => s.type === 'image')) d.dropped.push('The file is one picture of the diagram (a git flow or a roadmap): there are no shapes to read back');
  const r = writeImported(d, opts);
  return !d.nodes.length && !d.tables.length ? { ...r, yaml: '', report: ['Nothing to import in this file', ...d.dropped] } : r;
}

// Reads a draw.io file (compressed or not, every page) into Cartography diagrams.
//
// A file Cartography wrote itself carries what each cell stood for (carto="node", cartoKind=…),
// so it comes back as it left. Any other file is read by its shapes: containers and swimlanes
// and boxes drawn around other boxes are groups, stencils say the kind and the diagram type,
// connectors attached at both ends are edges, tables stay tables.
import type { Box } from '@cartography/core';
import { config as cloud } from '@cartography/cloud';
import { inflateSync, strFromU8 } from 'fflate';
import { graphTypes, Ids, slug, writeImported, type End, type ImportedDiagram, type ImportOptions, type InDiagram, type InEdge, type InMessage, type Line } from './imported.ts';
import { readStencil, typeFor, type Family, type Stencil } from './stencils.ts';
import { fromBase64, htmlLines } from './text.ts';
import { findAll, parseXml, type XmlNode } from './xml.ts';

interface Cell {
  id: string;
  value: string;
  style: Record<string, string>;
  vertex: boolean;
  edge: boolean;
  parent?: Cell;
  source?: string;
  target?: string;
  /** Its own geometry: relative to the parent cell. */
  geo?: Box;
  /** Loose ends of a connector that is not attached. */
  ends: { source?: { x: number; y: number }; target?: { x: number; y: number } };
  /** The attributes of the <object> around it: Cartography's own notes, or a user's data. */
  data: Record<string, string>;
  children: Cell[];
}

export const isDrawio = (text: string) => /<mxfile[\s>]|<mxGraphModel[\s>]/.test(text.slice(0, 4000));

/** The pages of a file, each as its graph model. A compressed page is base64 of deflated, URL-encoded XML. */
export function drawioPages(text: string): { name: string; model: XmlNode }[] {
  const doc = parseXml(text);
  const diagrams = findAll(doc, 'diagram');
  if (!diagrams.length) {
    const model = findAll(doc, 'mxGraphModel')[0];
    if (!model) throw new Error('Not a draw.io file: it has no <mxfile> or <mxGraphModel>');
    return [{ name: 'Page-1', model }];
  }
  return diagrams.map((d, i) => {
    const name = d.attrs.name ?? `Page-${i + 1}`;
    const plain = d.children.find((c) => c.name === 'mxGraphModel');
    if (plain) return { name, model: plain };
    let xml: string;
    try {
      xml = decodeURIComponent(strFromU8(inflateSync(fromBase64(d.text.trim()))));
    } catch {
      throw new Error(`The page "${name}" could not be unpacked: it is not compressed the way draw.io does`);
    }
    const model = findAll(parseXml(xml), 'mxGraphModel')[0];
    if (!model) throw new Error(`The page "${name}" has no <mxGraphModel>`);
    return { name, model };
  });
}

function parseStyle(s: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (s ?? '').split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) out[part] = '';
    else out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

const num = (s: string | undefined) => (s === undefined || Number.isNaN(Number(s)) ? 0 : Number(s));

/** The cells of a page as a tree. The root cell and the layers under it hold no shape themselves. */
function readCells(model: XmlNode): { root: Cell | undefined; cells: Map<string, Cell> } {
  const cells = new Map<string, Cell>();
  const parents = new Map<string, string>();
  const rootNode = model.children.find((c) => c.name === 'root');
  for (const el of rootNode?.children ?? []) {
    const wrapped = el.name !== 'mxCell';
    const mx = wrapped ? el.children.find((c) => c.name === 'mxCell') : el;
    const id = el.attrs.id ?? mx?.attrs.id;
    if (!mx || id === undefined) continue;
    const g = mx.children.find((c) => c.name === 'mxGeometry');
    const point = (as: string) => {
      const p = g?.children.find((c) => c.name === 'mxPoint' && c.attrs.as === as);
      return p ? { x: num(p.attrs.x), y: num(p.attrs.y) } : undefined;
    };
    const data: Record<string, string> = {};
    if (wrapped) for (const [k, v] of Object.entries(el.attrs)) if (k !== 'id' && k !== 'label') data[k] = v;
    const cell: Cell = {
      id,
      value: (wrapped ? el.attrs.label : mx.attrs.value) ?? '',
      style: parseStyle(mx.attrs.style),
      vertex: mx.attrs.vertex === '1',
      edge: mx.attrs.edge === '1',
      ...(mx.attrs.source ? { source: mx.attrs.source } : {}),
      ...(mx.attrs.target ? { target: mx.attrs.target } : {}),
      ...(g && mx.attrs.vertex === '1' && g.attrs.relative !== '1' ? { geo: { x: num(g.attrs.x), y: num(g.attrs.y), width: num(g.attrs.width), height: num(g.attrs.height) } } : {}),
      ends: { source: point('sourcePoint'), target: point('targetPoint') },
      data,
      children: [],
    };
    cells.set(id, cell);
    if (mx.attrs.parent !== undefined) parents.set(id, mx.attrs.parent);
  }
  let root: Cell | undefined;
  for (const c of cells.values()) {
    const p = parents.get(c.id);
    const parent = p === undefined ? undefined : cells.get(p);
    if (parent && parent !== c) {
      c.parent = parent;
      parent.children.push(c);
    } else root ??= c;
  }
  return { root, cells };
}

/** Where a cell is on the page: its own geometry plus that of every cell it sits in. */
function absolute(c: Cell): Box | undefined {
  if (!c.geo) return undefined;
  let { x, y } = c.geo;
  for (let p = c.parent; p; p = p.parent) {
    if (p.geo) {
      x += p.geo.x;
      y += p.geo.y;
    }
  }
  return { x, y, width: c.geo.width, height: c.geo.height };
}

const plainText = (html: string) => htmlLines(html).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

const END: Record<string, End> = { none: 'none', ERmandOne: 'one', ERone: 'one', ERzeroToOne: 'zeroOrOne', ERmany: 'many', ERoneToMany: 'oneOrMany', ERzeroToMany: 'zeroOrMany' };
const endOf = (name: string | undefined, fallback: End): End => (name === undefined ? fallback : (END[name] ?? 'arrow'));

function lineOf(style: Record<string, string>): Line {
  if (style.dashed !== '1') return 'solid';
  const first = Number((style.dashPattern ?? '').split(' ')[0]);
  return first > 0 && first <= 2 ? 'dotted' : 'dashed';
}

/** One page that Cartography wrote: every cell says what it was. */
function readOwn(name: string, root: Cell, cells: Map<string, Cell>): InDiagram {
  const type = root.data.cartoType ?? 'systems';
  const graph = !!graphTypes[type];
  const d: InDiagram = {
    name,
    type: graph || type === 'erd' || type === 'sequence' ? type : 'systems',
    ...(root.data.cartoTitle ? { title: root.data.cartoTitle } : {}),
    ...(root.data.cartoSubtitle ? { subtitle: root.data.cartoSubtitle } : {}),
    ...(root.data.cartoDirection === 'down' ? { direction: 'down' as const } : {}),
    exact: true,
    groups: [],
    nodes: [],
    edges: [],
    tables: [],
    texts: [],
    dropped: [],
  };
  if (d.type !== type) d.dropped.push(`This was a ${type} diagram: its boxes and lines are kept as a systems diagram, what the ${type} type knew beyond that is not`);
  const groupOf = (c: Cell) => {
    for (let p = c.parent; p; p = p.parent) if (p.data.carto === 'group') return p.data.cartoId;
    return undefined;
  };
  const messages: InMessage[] = [];
  let pictures = 0;
  // A participant drawn at the head and the foot of its lifeline is one participant.
  const seen = new Set<string>();
  for (const c of cells.values()) {
    const k = c.data;
    const box = absolute(c);
    if ((k.carto === 'node' || k.carto === 'participant') && seen.has(k.cartoId!)) continue;
    if (k.carto === 'node' || k.carto === 'participant') seen.add(k.cartoId!);
    if (k.carto === 'group') d.groups.push({ id: k.cartoId!, label: k.cartoLabel ?? k.cartoId!, kind: k.cartoKind, caption: k.cartoCaption, parent: groupOf(c), ...(box ? { box } : {}) });
    else if (k.carto === 'node' || k.carto === 'participant') {
      const rows = c.children.filter((r) => r.data.carto === 'row');
      if (type === 'erd') d.tables.push({ id: k.cartoId!, label: k.cartoLabel ?? k.cartoId!, parent: groupOf(c), columns: rows.map((r) => ({ id: r.data.cartoId!, type: r.data.cartoType, marks: (r.data.cartoMarks ?? '').split(' ').filter(Boolean) })), ...(box ? { box } : {}) });
      else d.nodes.push({ id: k.cartoId!, label: k.cartoLabel ?? k.cartoId!, kind: k.cartoKind, caption: k.cartoCaption, parent: groupOf(c), ...(box ? { box } : {}) });
    } else if (k.carto === 'edge' || k.carto === 'badge') {
      d.edges.push({
        from: k.cartoFrom!,
        to: k.cartoTo!,
        ...(k.cartoLabel ? { label: k.cartoLabel } : {}),
        line: (k.cartoLine as Line | undefined) ?? 'solid',
        start: (k.cartoStart as End | undefined) ?? 'none',
        end: (k.cartoEnd as End | undefined) ?? 'arrow',
        ...(k.cartoStyle ? { style: k.cartoStyle } : {}),
        ...(k.carto === 'badge' ? { badge: true } : {}),
      });
      // A node that was only ever a badge comes back as a node; the type folds it again.
      if (k.carto === 'badge' && (k.cartoToKind || k.cartoToLabel) && !seen.has(k.cartoTo!)) {
        seen.add(k.cartoTo!);
        d.nodes.push({ id: k.cartoTo!, label: k.cartoToLabel ?? k.cartoTo!, kind: k.cartoToKind, caption: k.cartoToCaption, parent: k.cartoToIn });
      }
    } else if (k.carto === 'message') messages.push({ from: k.cartoFrom!, to: k.cartoTo!, arrow: (k.cartoArrow as InMessage['arrow'] | undefined) ?? 'sync', ...(k.cartoLabel ? { label: k.cartoLabel } : {}) });
    else if (k.carto === 'matrix') d.nodes.push({ id: k.cartoId!, label: k.cartoId!, parent: groupOf(c), ...(box ? { box } : {}) });
    else if (c.id === 'picture') pictures++;
  }
  if (type === 'sequence') d.messages = messages;
  if (pictures) d.dropped.push('The page is one picture of the diagram (a git flow or a roadmap): there are no shapes to read back');
  // A model or C4 view names its elements by their path (online.api): a dot is no name in the type
  // the page comes back as, so those are respelled with a dash.
  const all = [...d.groups, ...d.nodes, ...d.tables];
  const used = new Set(all.map((x) => x.id));
  const renamed = new Map<string, string>();
  for (const x of all) {
    if (/^[A-Za-z0-9_-]+$/.test(x.id)) continue;
    const base = slug(x.id);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    renamed.set(x.id, id);
  }
  if (renamed.size) {
    const name = (id: string) => renamed.get(id) ?? id;
    for (const x of all) {
      x.id = name(x.id);
      if (x.parent) x.parent = name(x.parent);
    }
    for (const e of [...d.edges, ...messages]) {
      e.from = name(e.from);
      e.to = name(e.to);
    }
    d.dropped.push(`${renamed.size} name${renamed.size === 1 ? '' : 's'} with a dot ${renamed.size === 1 ? 'is' : 'are'} written with a dash (${[...renamed].slice(0, 2).map(([a, b]) => `${a} → ${b}`).join(', ')}${renamed.size > 2 ? ', …' : ''})`);
  }
  return d;
}

type Role = 'group' | 'node' | 'table' | 'row' | 'text' | 'part' | 'wrapper' | 'skip';

const isText = (c: Cell) => 'text' in c.style || c.style.shape === 'text' || (c.style.strokeColor === 'none' && (c.style.fillColor ?? 'none') === 'none' && !c.style.shape && !c.style.image);
const isRowLike = (c: Cell) => 'text' in c.style || 'line' in c.style || c.style.shape === 'partialRectangle' || c.style.shape === 'tableRow' || c.style.shape === 'line';
const contains = (a: Box, b: Box) => a.x <= b.x + 1 && a.y <= b.y + 1 && a.x + a.width >= b.x + b.width - 1 && a.y + a.height >= b.y + b.height - 1 && a.width * a.height > b.width * b.height * 1.05;

/** One row of a table: its marks, name and type from the text ("PK id: uuid", "+ name : text"). */
function readRow(texts: string[]) {
  const marks: string[] = [];
  const words: string[] = [];
  for (const t of texts) {
    for (const w of t.split(/\s+/).filter(Boolean)) {
      // "PK", "FK1", "PK,FK" before the name; a comma later on belongs to the type: numeric(10,2).
      if (!words.length && /^((PK|FK|UK|UQ)\d*,?)+$/.test(w)) for (const m of w.matchAll(/PK|FK|UK|UQ/g)) marks.push(m[0] === 'PK' ? 'pk' : m[0] === 'FK' ? 'fk' : 'unique');
      else words.push(w);
    }
  }
  const line = words.join(' ').replace(/^[+#~-]\s*/, '');
  const m = /^([^\s:]+)\s*:?\s*(.*)$/.exec(line);
  if (!m) return undefined;
  return { id: m[1]!, ...(m[2] ? { type: m[2] } : {}), marks: [...new Set(marks)] };
}

/** One page drawn by hand or by another tool, read by its shapes. */
function readForeign(name: string, cells: Map<string, Cell>): InDiagram {
  const d: InDiagram = { name, type: 'systems', groups: [], nodes: [], edges: [], tables: [], texts: [], dropped: [] };
  const role = new Map<Cell, Role>();
  const stencil = new Map<Cell, Stencil>();
  const box = new Map<Cell, Box>();
  const vertices = [...cells.values()].filter((c) => c.vertex);
  // A connector that ends on a row of a table ends on table.column.
  const rowIds = new Map<Cell, string>();
  const attached = new Set<string>();
  for (const c of cells.values()) {
    if (!c.edge) continue;
    if (c.source) attached.add(c.source);
    if (c.target) attached.add(c.target);
  }
  let decoration = 0;

  // First what each shape says of itself, parents before children.
  const classify = (c: Cell) => {
    const b = absolute(c);
    if (b) box.set(c, b);
    const st = readStencil(c.style);
    stencil.set(c, st);
    const kids = c.children.filter((k) => k.vertex);
    const up = c.parent ? role.get(c.parent) : undefined;
    let r: Role;
    if (c.parent?.edge) r = 'part';
    else if (up === 'table') r = 'row';
    else if (up === 'row' || up === 'node' || up === 'part') r = 'part';
    else if (c.style.shape === 'table' || ('swimlane' in c.style && kids.length > 0 && kids.every(isRowLike))) r = 'table';
    else if ('group' in c.style && !c.value.trim()) r = 'wrapper';
    else if ('swimlane' in c.style || c.style.container === '1' || st.group || kids.some((k) => !isText(k))) r = 'group';
    else if (isText(c) && !st.family) r = attached.has(c.id) && c.value.trim() ? 'node' : 'text';
    else if (!c.value.trim() && !st.family && !st.kind && !attached.has(c.id) && !kids.length) r = 'skip';
    else r = 'node';
    role.set(c, r);
    for (const k of c.children) if (k.vertex) classify(k);
  };
  for (const c of vertices) if (!c.parent || !c.parent.vertex) classify(c);

  // A box drawn around other boxes is a group too, though nothing in the file says so.
  const within = new Map<Cell, Cell>();
  const frame = (c: Cell) => role.get(c) === 'skip' && c.style.shape !== 'line' && !('line' in c.style);
  const holders = vertices.filter((c) => (role.get(c) === 'group' || frame(c) || (role.get(c) === 'node' && !stencil.get(c)?.family)) && box.has(c));
  for (const c of vertices) {
    const r = role.get(c);
    const b = box.get(c);
    if (!b || (r !== 'node' && r !== 'group' && r !== 'table' && r !== 'text')) continue;
    let best: Cell | undefined;
    for (const h of holders) {
      if (h === c || !contains(box.get(h)!, b)) continue;
      if (!best || box.get(h)!.width * box.get(h)!.height < box.get(best)!.width * box.get(best)!.height) best = h;
    }
    if (best) within.set(c, best);
  }
  for (const [c, h] of within) if (role.get(c) !== 'text' && (role.get(h) === 'node' || role.get(h) === 'skip')) role.set(h, 'group');
  // A text over a node is that node's own words, not a group's contents.
  for (const [c, h] of [...within]) if (role.get(h) !== 'group') within.delete(c);

  const ids = new Ids();
  const label = (c: Cell) => plainText(c.value);
  const groupOf = (c: Cell): string | undefined => {
    const h = within.get(c);
    if (h && role.get(h) === 'group') return ids.find(h.id);
    for (let p = c.parent; p; p = p.parent) if (role.get(p) === 'group') return ids.find(p.id);
    return undefined;
  };

  // The stencils decide the type; tables win when the page is mostly tables.
  const families = new Map<Family, number>();
  for (const c of vertices) {
    const f = stencil.get(c)?.family;
    if (f && (role.get(c) === 'node' || role.get(c) === 'group')) families.set(f, (families.get(f) ?? 0) + 1);
  }
  const count = (r: Role) => vertices.filter((c) => role.get(c) === r).length;
  const erd = count('table') > 0 && count('table') >= count('node');
  const picked = erd ? { type: 'erd' } : typeFor(families);
  d.type = picked.type;
  if (picked.provider) d.provider = picked.provider;
  const kinds = graphTypes[d.type];

  // A group without words of its own takes the loose text at its top as its label.
  const titles = new Map<Cell, Cell>();
  for (const c of vertices) {
    const h = within.get(c) ?? (c.parent && role.get(c.parent) === 'group' ? c.parent : undefined);
    if (role.get(c) !== 'text' || !h || role.get(h) !== 'group' || label(h).length || !label(c).length) continue;
    const now = titles.get(h);
    if (!now || box.get(c)!.y < box.get(now)!.y) titles.set(h, c);
  }
  const taken = new Set(titles.values());

  // Groups from the outside in, so a group's parent has its id before the group asks for it.
  const depth = (c: Cell) => {
    let n = 0;
    for (let p: Cell | undefined = within.get(c) ?? c.parent; p; p = within.get(p) ?? p.parent) n++;
    return n;
  };
  const groupKind = (c: Cell, text: string) => {
    const st = stencil.get(c);
    if (st?.group) return st.group;
    const words = text.toLowerCase();
    return Object.keys(kinds?.groupKinds ?? {}).find((k) => k !== 'group' && new RegExp(`\\b${k.replace(/-/g, '[ -]?')}\\b`).test(words));
  };
  for (const c of vertices.filter((v) => role.get(v) === 'group').sort((a, b) => depth(a) - depth(b))) {
    const words = label(c).length ? label(c) : titles.has(c) ? label(titles.get(c)!) : [];
    const text = words[0] ?? 'Group';
    const id = ids.get(c.id, text);
    d.groups.push({ id, label: text, kind: groupKind(c, words.join(' ')), ...(words.length > 1 ? { caption: words.slice(1).join(' ') } : {}), parent: groupOf(c), ...(box.has(c) ? { box: box.get(c)! } : {}) });
  }

  let plainTables = 0;
  for (const c of vertices) {
    const r = role.get(c);
    const words = label(c);
    if (r === 'node') {
      const st = stencil.get(c)!;
      // A kind from another library than the page's type is only a hint: its name goes to the guess by words.
      const home = st.family === undefined || (d.type === 'cloud' ? st.family === 'aws' || st.family === 'gcp' || st.family === 'azure' : st.family === d.type);
      let kind = home ? st.kind : undefined;
      if (kind && d.type === 'cloud' && st.family === 'azure' && !cloud.nodeKinds[kind] && cloud.nodeKinds[`azure-${kind}`]) kind = `azure-${kind}`;
      const known = kind ? kinds?.nodeKinds[kind]?.label : undefined;
      const text = words[0] ?? known ?? st.name?.replace(/-/g, ' ') ?? 'Shape';
      d.nodes.push({ id: ids.get(c.id, text), label: text, kind: kind ?? st.name, ...(words.length > 1 ? { caption: words.slice(1).join(' ') } : {}), parent: groupOf(c), ...(box.has(c) ? { box: box.get(c)! } : {}) });
    } else if (r === 'table') {
      const text = words[0] ?? 'table';
      const id = ids.get(c.id, text);
      if (!erd) {
        plainTables++;
        d.nodes.push({ id, label: text, kind: 'database', parent: groupOf(c), ...(box.has(c) ? { box: box.get(c)! } : {}) });
        continue;
      }
      const columns = [];
      const used = new Set<string>();
      const rows = c.style.shape === 'table' ? c.children.filter((k) => k.vertex) : c.children.filter((k) => k.vertex && !('line' in k.style) && k.style.shape !== 'line');
      for (const row of rows) {
        const cellsOf = row.children.filter((k) => k.vertex);
        const col = readRow(cellsOf.length ? cellsOf.flatMap(label) : label(row));
        if (!col || used.has(col.id)) continue;
        used.add(col.id);
        ids.get(row.id, col.id);
        rowIds.set(row, `${id}.${col.id}`);
        columns.push(col);
      }
      d.tables.push({ id, label: text, columns, ...(box.has(c) ? { box: box.get(c)! } : {}) });
    } else if (r === 'text' && words.length && !taken.has(c)) d.texts.push(words.join(' '));
    else if (r === 'skip') decoration++;
  }

  // Connectors: an end on a part of a shape is an end on the shape; a loose end that lies on a shape is attached to it.
  const endId = (c: Cell | undefined): string | undefined => {
    for (let p = c; p; p = p.parent) {
      const r = role.get(p);
      if (r === 'row' && rowIds.has(p)) return rowIds.get(p);
      if (r === 'node' || r === 'group' || r === 'table') return ids.find(p.id);
    }
    return undefined;
  };
  const at = (p: { x: number; y: number } | undefined, edge: Cell): string | undefined => {
    if (!p) return undefined;
    let x = p.x;
    let y = p.y;
    for (let q = edge.parent; q; q = q.parent) {
      if (q.geo) {
        x += q.geo.x;
        y += q.geo.y;
      }
    }
    let best: Cell | undefined;
    for (const c of vertices) {
      const r = role.get(c);
      const b = box.get(c);
      if (!b || (r !== 'node' && r !== 'table')) continue;
      if (x < b.x - 8 || y < b.y - 8 || x > b.x + b.width + 8 || y > b.y + b.height + 8) continue;
      if (!best || b.width * b.height < box.get(best)!.width * box.get(best)!.height) best = c;
    }
    return best ? ids.find(best.id) : undefined;
  };
  let loose = 0;
  let down = 0;
  const centre = new Map<string, { x: number; y: number }>();
  for (const [c, b] of box) {
    const id = ids.find(c.id);
    if (id) centre.set(id, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  }
  for (const c of cells.values()) {
    if (!c.edge) continue;
    const from = endId(c.source ? cells.get(c.source) : undefined) ?? at(c.ends.source, c);
    const to = endId(c.target ? cells.get(c.target) : undefined) ?? at(c.ends.target, c);
    if (!from || !to) {
      loose++;
      continue;
    }
    const words = [...label(c), ...c.children.filter((k) => k.vertex).flatMap(label)].join(' ');
    const edge: InEdge = { from, to, ...(words ? { label: words } : {}), line: lineOf(c.style), start: endOf(c.style.startArrow, 'none'), end: endOf(c.style.endArrow, 'arrow') };
    d.edges.push(edge);
    const a = centre.get(from.split('.')[0]!);
    const b = centre.get(to.split('.')[0]!);
    if (a && b) down += Math.abs(b.y - a.y) > Math.abs(b.x - a.x) ? 1 : -1;
  }
  if (down > 0 && !erd) d.direction = 'down';

  if (erd && count('node') > 0) d.dropped.push(`${count('node')} shape(s) that are not tables were left out of the table diagram`);
  if (plainTables) d.dropped.push(`${plainTables} table(s) became plain boxes: their columns were left out`);
  if (loose) d.dropped.push(`${loose} connector(s) were not attached to a shape at both ends: left out`);
  if (decoration) d.dropped.push(`${decoration} shape(s) without text or icon were left out`);
  return d;
}

/** Every page of a draw.io file as a Cartography diagram, with its report. */
export function importDrawio(text: string, opts: ImportOptions = {}): ImportedDiagram[] {
  const out: ImportedDiagram[] = [];
  for (const page of drawioPages(text)) {
    const { root, cells } = readCells(page.model);
    const d = root && root.data.carto === 'page' ? readOwn(page.name, root, cells) : readForeign(page.name, cells);
    const empty = !d.nodes.length && !d.tables.length;
    const r = writeImported(d, { ...opts, title: /^Page-\d+$/.test(page.name) ? opts.title : page.name });
    out.push(empty ? { ...r, yaml: '', report: [`Nothing to import on this page`, ...d.dropped] } : r);
  }
  return out;
}

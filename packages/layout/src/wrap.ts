// Wrapping: a drawing far wider than its target shape (a long left-to-right chain of clouds and
// systems) is cut between columns and its parts are stacked as rows, read like lines of text; one
// far taller (a deep top-down drawing) is cut between rows and its parts stand side by side. Only
// whole blocks move: a top-level group with everything in it, or a top-level node. When the drawing
// is a single group, the blocks inside it are wrapped instead and the group fits around them.
import type { Box, Graph } from '@linework/core';
import type { Placement } from './dot.ts';

/** The shortest part is at least this share of the longest. */
const BALANCE = 0.4;

interface Block {
  /** The node or group ids that move together, the block's own first. */
  ids: string[];
  box: Box;
}

const grid = (n: number) => Math.round(n / 8) * 8;

const union = (list: Box[]): Box => {
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  return { x, y, width: Math.max(...list.map((b) => b.x + b.width)) - x, height: Math.max(...list.map((b) => b.y + b.height)) - y };
};

export interface WrapOptions {
  /** The group whose contents are wrapped; by default the top level (or the one group holding everything). */
  scope?: string;
  /** Cut a plain chain too (one block a column): its lines then run back to the start of the next row. */
  chains?: boolean;
  /**
   * Cut between blocks that overlap along the flow too (groups dot laid out on a diagonal), and close
   * the empty room left across in each row. Each block is then a column of its own.
   */
  loose?: boolean;
  /**
   * Turn every row after the first over across, when those rows hold only cards: what the lines
   * from the row before come into stands nearest it, and they need not cross the row's own line to reach it.
   */
  flip?: boolean;
  /**
   * Cut across the flow instead: a left-to-right drawing far taller than its page (domains stacked
   * one under the other) is cut between its bands, and the bands stand side by side.
   */
  transpose?: boolean;
}

/**
 * The groups worth wrapping inside of: those that take up at least half the drawing's length along
 * the flow and hold two or more blocks. Cutting the top level alone cannot shorten a drawing that is
 * mostly one long group (a cloud account with its ingest, lake and serve stages in a row).
 */
export function wrapScopes(p: Placement, graph: Graph): string[] {
  const down = graph.direction === 'down';
  const [at, size] = down ? (['y', 'height'] as const) : (['x', 'width'] as const);
  const all = union([...p.nodes.values(), ...p.groups.values()]);
  return graph.groups
    .filter((g) => {
      const b = p.groups.get(g.id);
      if (!b || b[size] < 0.5 * all[size]) return false;
      const kids = [...graph.groups.filter((c) => c.parent === g.id && p.groups.has(c.id)), ...graph.nodes.filter((n) => n.parent === g.id && p.nodes.has(n.id))];
      return kids.length >= 2 && kids.length < graph.nodes.length + graph.groups.length && b[at] >= all[at] - 1;
    })
    .map((g) => g.id);
}

/**
 * The placement in `parts` rows (a left-to-right drawing) or columns (top-down), each part keeping
 * its blocks where they were relative to each other; undefined when there is nothing to cut.
 * `scale` says how large a placement comes out on the page.
 */
export function wrap(p: Placement, graph: Graph, parts: number, gap: number, header: number, pad: number, minWidth: Map<string, number>, opts: WrapOptions = {}, scale?: (q: Placement) => number): Placement | undefined {
  const down = (graph.direction === 'down') !== !!opts.transpose;
  const parentOf = new Map<string, string | undefined>([...graph.groups.map((g) => [g.id, g.parent] as const), ...graph.nodes.map((n) => [n.id, n.parent] as const)]);
  const inside = (id: string, g: string) => {
    for (let x = parentOf.get(id); x; x = parentOf.get(x)) if (x === g) return true;
    return false;
  };
  // The level to wrap: the top, or inside the one group that holds everything.
  let scope: string | undefined = opts.scope;
  for (;;) {
    const top = [...graph.groups.filter((g) => g.parent === scope && p.groups.has(g.id)), ...graph.nodes.filter((n) => n.parent === scope && p.nodes.has(n.id))];
    if (top.length === 1 && graph.groups.some((g) => g.id === top[0]!.id)) scope = top[0]!.id;
    else break;
  }
  const blocks: Block[] = [];
  for (const g of graph.groups) if (g.parent === scope && p.groups.has(g.id)) blocks.push({ ids: [g.id, ...[...p.nodes.keys(), ...p.groups.keys()].filter((id) => inside(id, g.id))], box: p.groups.get(g.id)! });
  for (const n of graph.nodes) if (n.parent === scope && p.nodes.has(n.id)) blocks.push({ ids: [n.id], box: p.nodes.get(n.id)! });
  // An annex (a contract on its table's row) moves with its table: cut apart, it would stand far from what it governs.
  for (const e of graph.edges) {
    if (!e.annex) continue;
    const table = blocks.find((b) => b.ids[0] === e.from.node);
    const annex = blocks.find((b) => b.ids[0] === e.to.node);
    if (!table || !annex || table === annex) continue;
    table.ids.push(...annex.ids);
    table.box = union([table.box, annex.box]);
    blocks.splice(blocks.indexOf(annex), 1);
  }
  if (blocks.length < 2) return undefined;
  // Only cards, one after the other (a path): cut, it snakes back at every cut, and reads best drawn as it came.
  if ((opts.chains || opts.loose) && blocks.every((b) => b.ids.length === 1 && p.nodes.has(b.ids[0]!))) {
    const ids = new Set(blocks.map((b) => b.ids[0]!));
    const lines = graph.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node) && e.from.node !== e.to.node);
    const degree = new Map<string, number>();
    for (const e of lines) for (const id of [e.from.node, e.to.node]) degree.set(id, (degree.get(id) ?? 0) + 1);
    if (lines.length === ids.size - 1 && [...degree.values()].every((d) => d <= 2)) return undefined;
  }

  // Columns along the flow: blocks that overlap along it stand in one and are never cut apart.
  const [at, size] = down ? (['y', 'height'] as const) : (['x', 'width'] as const);
  const sorted = [...blocks].sort((a, b) => a.box[at] - b.box[at]);
  const columns: Block[][] = [];
  let end = -Infinity;
  for (const b of sorted) {
    if (!opts.loose && b.box[at] < end - 1) columns[columns.length - 1]!.push(b);
    else columns.push([b]);
    end = Math.max(end, b.box[at] + b.box[size]);
  }
  // A plain chain (one block a column) reads best in one line: cut, it would run back to its start.
  if (columns.length < parts || (!opts.chains && !opts.loose && columns.every((c) => c.length === 1))) return undefined;
  // Cut where the parts come out most even in length along the flow.
  const spans = columns.map((c) => union(c.map((b) => b.box)));
  const total = spans[spans.length - 1]![at] + spans[spans.length - 1]![size] - spans[0]![at];
  const cuts: number[] = [];
  for (let k = 1; k < parts; k++) {
    const want = spans[0]![at] + (total * k) / parts;
    let best = -1;
    for (let i = Math.max(1, (cuts[cuts.length - 1] ?? 0) + 1); i < columns.length; i++) if (best < 0 || Math.abs(spans[i]![at] - want) < Math.abs(spans[best]![at] - want)) best = i;
    if (best < 0 || cuts.includes(best)) return undefined;
    cuts.push(best);
  }
  const rows = [0, ...cuts, columns.length].slice(1).map((e, i, a) => columns.slice(i ? a[i - 1]! : 0, e).flat());
  if (rows.some((r) => !r.length)) return undefined;
  // A part far shorter than the longest is a block left on a row of its own: that only adds room.
  // (Cutting a chain or across blocks is weighed by how the result reads on the page instead.)
  const lengths = rows.map((r) => union(r.map((b) => b.box))[size]);
  if (!opts.chains && !opts.loose && Math.min(...lengths) < BALANCE * Math.max(...lengths)) return undefined;

  const across = down ? 'x' : 'y';
  const thick = down ? 'width' : 'height';
  const origin = union(blocks.map((b) => b.box));
  // The rows laid out one after the other, each block where it was relative to the rest of its row.
  const lay = (rows: Block[][], nodes: Map<string, Box>): Placement => {
    const groups = new Map(p.groups);
    // Each part starts at the start of the flow; the next one comes below (beside, top-down).
    let next = origin[across];
    for (const [i, row] of rows.entries()) {
      if (opts.loose) closeAcross(row, nodes, groups, at, size, across, thick, gap);
      // Only rows of cards (states, steps) turn over: groups turned over would stand against the order they are written in.
      if (opts.flip && i > 0 && row.every((b) => b.ids.length === 1 && p.nodes.has(b.ids[0]!))) flipAcross(row, nodes, groups, across, thick);
      const box = union(row.map((b) => b.box));
      // Whole grid steps, so centres tidied onto the 8px grid stay on it.
      const dx = grid(down ? next - box.x : origin.x - box.x);
      const dy = grid(down ? origin.y - box.y : next - box.y);
      for (const b of row)
        for (const id of b.ids) {
          const m = nodes.has(id) ? nodes : groups;
          const o = m.get(id)!;
          m.set(id, { ...o, x: o.x + dx, y: o.y + dy });
        }
      next = Math.max(next + box[thick] + gap, (down ? box.x + dx : box.y + dy) + box[thick] + gap);
    }
    // Wrapped inside a group that does not hold everything: what comes after that group along the
    // flow closes up by what it got shorter, and what lies beyond it across moves out of its way.
    const own = scope ? groups.get(scope) : undefined;
    const ancestors = new Set<string>();
    for (let g = scope; g; g = parentOf.get(g)) ancestors.add(g);
    if (own && scope) {
      const moved = new Set(blocks.flatMap((b) => b.ids));
      const u = union(blocks.map((b) => (nodes.get(b.ids[0]!) ?? groups.get(b.ids[0]!))!));
      const end0 = own[at] + own[size];
      const end1 = u[at] + u[size] + pad;
      const far0 = own[across] + own[thick];
      const far1 = u[across] + u[thick] + pad;
      const shrink = Math.floor((end0 - end1) / 8) * 8;
      const grow = Math.ceil((far1 - far0) / 8) * 8;
      for (const m of [nodes, groups])
        for (const [id, b] of m) {
          if (moved.has(id) || ancestors.has(id)) continue;
          let o = b;
          if (o[across] >= far0 - 1 && o[at] < end0 && o[at] + o[size] > own[at]) o = { ...o, [across]: o[across] + grow };
          if (o[at] >= end0 - 1) o = { ...o, [at]: o[at] - shrink };
          m.set(id, o);
        }
    }
    // The groups around the wrapped level fit around it again, innermost first.
    for (let g = scope; g; g = parentOf.get(g)) {
      const kids = [...graph.groups.filter((c) => c.parent === g && groups.has(c.id)).map((c) => groups.get(c.id)!), ...graph.nodes.filter((n) => n.parent === g && nodes.has(n.id)).map((n) => nodes.get(n.id)!)];
      const u = union(kids);
      const width = Math.max(u.width + 2 * pad, minWidth.get(g) ?? 0);
      groups.set(g, { x: u.x - pad, y: u.y - header, width, height: u.height + header + pad });
    }
    const all = union([...nodes.values(), ...groups.values()]);
    return { nodes, groups, width: all.width, height: all.height };
  };
  // Laying out moves the blocks of a row about (closing up, turning over): each try starts from the cut as made.
  const copy = () => rows.map((r) => r.map((b) => ({ ...b })));
  const plain = lay(copy(), new Map(p.nodes));
  // A card outside the groups that stayed behind in another row than the card it is joined to
  // follows it, where that leaves the drawing as large on the page (no larger, without a page).
  const asLarge = (q: Placement) => (scale ? scale(q) >= scale(plain) - 1e-9 : q.width <= plain.width + 1 && q.height <= plain.height + 1);
  for (const way of ['level', 'across'] as const) {
    const moved = copy();
    const nodes = new Map(p.nodes);
    if (!followCards(moved, graph, nodes, p.groups, at, size, gap, way)) break;
    const q = lay(moved, nodes);
    if (asLarge(q)) return q;
  }
  return plain;
}

/**
 * A card that stands outside the groups (customers, a third party) and whose lines all go into one
 * group goes to that group's row: left in the row its column fell in, its line would run across the
 * drawing to the next row. 'level': it stands just before (or after) the row, level with the card it
 * is joined to, as far from the row as dot put it from the next column. 'across': it stands beside
 * the row, on the side of that card, in line with it along the flow. Whether anything moved.
 */
function followCards(rows: Block[][], graph: Graph, nodes: Map<string, Box>, groups: Map<string, Box>, at: 'x' | 'y', size: 'width' | 'height', gap: number, way: 'level' | 'across'): boolean {
  const [across, thick] = at === 'x' ? (['y', 'height'] as const) : (['x', 'width'] as const);
  const blocks = rows.flat();
  const rowOf = (b: Block) => rows.findIndex((r) => r.includes(b));
  const blockOf = new Map(blocks.flatMap((b) => b.ids.map((id) => [id, b] as const)));
  const hit = (a: Box, o: Box) => a.x < o.x + o.width && o.x < a.x + a.width && a.y < o.y + o.height && o.y < a.y + a.height;
  const mid = (o: Box, k: 'x' | 'y') => o[k] + o[k === 'x' ? 'width' : 'height'] / 2;
  const follows = new Map<Block, Block>();
  for (const b of blocks) {
    const id = b.ids[0]!;
    if (b.ids.length !== 1 || !nodes.has(id)) continue;
    const lines = graph.edges.filter((e) => (e.from.node === id) !== (e.to.node === id));
    const others = new Set(lines.map((e) => blockOf.get(e.from.node === id ? e.to.node : e.from.node)));
    const home = [...others][0];
    // Only into a group: a card joined to a card is a chain, cut where it reads best.
    if (lines.length && others.size === 1 && home && !nodes.has(home.ids[0]!) && rowOf(b) !== rowOf(home)) follows.set(b, home);
  }
  // A row of nothing but such cards stays as it is: the cut was made for them.
  for (const row of rows) if (row.every((b) => follows.has(b))) for (const b of row) follows.delete(b);
  let any = false;
  for (const [b, home] of follows) {
    const id = b.ids[0]!;
    const row = rows[rowOf(home)]!;
    const line = graph.edges.find((e) => (e.from.node === id) !== (e.to.node === id))!;
    const far = line.from.node === id ? line.to.node : line.from.node;
    const card = (nodes.get(far) ?? groups.get(far))!;
    const span = union(row.map((o) => o.box));
    let to: Box;
    if (way === 'level') {
      const mine = b.box[at];
      const before = mine + b.box[size] <= span[at];
      // As far from the row as it stood from the next block along the flow.
      const rest = blocks.filter((o) => o !== b);
      const room = before
        ? Math.min(...rest.filter((o) => o.box[at] >= mine + b.box[size]).map((o) => o.box[at] - mine - b.box[size]))
        : Math.min(...rest.filter((o) => o.box[at] + o.box[size] <= mine).map((o) => mine - o.box[at] - o.box[size]));
      if (!Number.isFinite(room)) continue;
      to = { ...b.box, [at]: grid(before ? span[at] - room - b.box[size] : span[at] + span[size] + room), [across]: b.box[across] + grid(mid(card, across) - mid(b.box, across)) };
    } else {
      const after = mid(card, across) > mid(span, across);
      to = { ...b.box, [at]: b.box[at] + grid(mid(card, at) - mid(b.box, at)), [across]: grid(after ? span[across] + span[thick] + gap : span[across] - gap - b.box[thick]) };
    }
    // Never onto another card that followed there.
    if (row.some((o) => hit(to, o.box))) continue;
    const o = nodes.get(id)!;
    nodes.set(id, { ...o, x: o.x + to.x - b.box.x, y: o.y + to.y - b.box.y });
    const left = rows[rowOf(b)]!;
    left.splice(left.indexOf(b), 1);
    b.box = to;
    row.push(b);
    any = true;
  }
  return any;
}

/**
 * The blocks of one row moved together across, in the order they stand, each as near the row's start
 * as the blocks before it that share its stretch along the flow allow: the room left by blocks that
 * went to another row closes up.
 */
function closeAcross(row: Block[], nodes: Map<string, Box>, groups: Map<string, Box>, at: 'x' | 'y', size: 'width' | 'height', across: 'x' | 'y', thick: 'width' | 'height', gap: number) {
  const start = Math.min(...row.map((b) => b.box[across]));
  const done: Box[] = [];
  for (const b of [...row].sort((x, y) => x.box[across] - y.box[across])) {
    const want = Math.max(start, ...done.filter((d) => d[at] < b.box[at] + b.box[size] && b.box[at] < d[at] + d[size]).map((d) => d[across] + d[thick] + gap));
    const by = Math.ceil((want - b.box[across]) / 8) * 8;
    if (by < 0) {
      for (const id of b.ids) {
        const m = nodes.has(id) ? nodes : groups;
        const o = m.get(id)!;
        m.set(id, { ...o, [across]: o[across] + by });
      }
      b.box = { ...b.box, [across]: b.box[across] + by };
    }
    done.push(b.box);
  }
}

/** The blocks of one row turned over across, each moved whole (what is inside a group stays as it is). */
function flipAcross(row: Block[], nodes: Map<string, Box>, groups: Map<string, Box>, across: 'x' | 'y', thick: 'width' | 'height') {
  const lo = Math.min(...row.map((b) => b.box[across]));
  const hi = Math.max(...row.map((b) => b.box[across] + b.box[thick]));
  for (const b of row) {
    const by = grid(lo + hi - 2 * b.box[across] - b.box[thick]);
    for (const id of b.ids) {
      const m = nodes.has(id) ? nodes : groups;
      const o = m.get(id)!;
      m.set(id, { ...o, [across]: o[across] + by });
    }
    b.box = { ...b.box, [across]: b.box[across] + by };
  }
}

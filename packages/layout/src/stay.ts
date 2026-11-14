// Staying put: when the previous drawing is known, what was already there keeps its place and only
// what is new looks for room. A diagram that jumps around on every edit cannot be reviewed in a
// pull request, and loses the reader who knew where things were.
import type { Box, Graph, LayoutMemory, Point } from '@linework/core';
import type { Placement } from './dot.ts';

/** A node this far (px) from where it was, once the drawing as a whole is slid back, has moved. */
export const MOVED = 12;

const centre = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : 0;
};

/**
 * Share of the nodes both drawings have that sit elsewhere. A drawing that only slid as a whole
 * (something new on the left pushes all the rest right) has not moved: the slide is taken out first.
 */
export function movedShare(nodes: Map<string, Box>, was: Map<string, Point> | undefined): number {
  if (!was?.size) return 0;
  const d: Point[] = [];
  for (const [id, b] of nodes) {
    const w = was.get(id);
    if (w) d.push({ x: centre(b).x - w.x, y: centre(b).y - w.y });
  }
  if (!d.length) return 0;
  const mx = median(d.map((p) => p.x));
  const my = median(d.map((p) => p.y));
  return d.filter((p) => Math.hypot(p.x - mx, p.y - my) > MOVED).length / d.length;
}

const hit = (a: Box, b: Box, gap: number) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
const within = (a: Box, b: Box, slack = 0.5) => a.x >= b.x - slack && a.y >= b.y - slack && a.x + a.width <= b.x + b.width + slack && a.y + a.height <= b.y + b.height + slack;
const holds = (b: Box, p: Point) => p.x > b.x && p.x < b.x + b.width && p.y > b.y && p.y < b.y + b.height;

/** How far a new node looks for room (grid steps each way) and how many spots get the full check. */
const STEP = 16;
const REACH = 30;
const TRIES = 1200;

/**
 * The previous drawing with the graph as it is now: nodes that were there stay exactly where they
 * were, groups keep their boxes while they hold what they held, and new nodes take the nearest
 * free spot to where the fresh placement has them relative to their neighbours. Undefined when that
 * cannot be done cleanly (a box grew into its neighbour, a group would run over another).
 */
export function stayPlacement(graph: Graph, fresh: Placement, prev: LayoutMemory, header: number, pad: number, gap: number, minWidth: Map<string, number>, pins?: Map<string, Point>): Placement | undefined {
  const was = prev.nodes;
  if (!was?.size) return undefined;
  const common = [...fresh.nodes.keys()].filter((id) => was.has(id));
  // Mostly another diagram: nothing to stay close to.
  if (!common.length || common.length * 2 < fresh.nodes.size) return undefined;

  const offset = new Map<string, Point>();
  const at = new Map<string, Box>();
  for (const id of common) {
    const b = fresh.nodes.get(id)!;
    const c = was.get(id)!;
    at.set(id, { x: c.x - b.width / 2, y: c.y - b.height / 2, width: b.width, height: b.height });
    offset.set(id, { x: c.x - centre(b).x, y: c.y - centre(b).y });
  }
  // Placed by hand (pins, top-left): there, whatever was before. What they then run into is for
  // pins.ts to clear, so they are not held against this placement.
  for (const [id, p] of pins ?? []) {
    const b = fresh.nodes.get(id);
    if (b) at.set(id, { ...b, x: p.x, y: p.y });
  }
  const lenient = !!pins?.size;
  const slide = (ids: string[]): Point => ({ x: median(ids.map((id) => offset.get(id)!.x)), y: median(ids.map((id) => offset.get(id)!.y)) });
  const whole = slide(common);

  const parentOf = new Map(graph.nodes.map((n) => [n.id, n.parent]));
  const groupParent = new Map(graph.groups.map((g) => [g.id, g.parent]));
  const depth = (id: string | undefined): number => (id ? 1 + depth(groupParent.get(id)) : 0);
  const inner = [...graph.groups].filter((g) => fresh.groups.has(g.id)).sort((a, b) => depth(b.id) - depth(a.id));
  const ancestors = (id: string) => {
    const out = new Set<string>();
    for (let g = parentOf.get(id); g; g = groupParent.get(g)) out.add(g);
    return out;
  };
  const mine = new Map([...fresh.nodes.keys()].map((id) => [id, ancestors(id)]));
  const gone = [...was].filter(([id]) => !fresh.nodes.has(id)).map(([, p]) => p);

  /** Group boxes around the nodes as placed: the box it had while it holds what it held, else a snug fit. */
  const groupsFor = (nodes: Map<string, Box>): Map<string, Box> => {
    const groups = new Map<string, Box>();
    const changed = new Set<string>();
    for (const g of inner) {
      const kidNodes = graph.nodes.filter((n) => n.parent === g.id && nodes.has(n.id));
      const kidGroups = graph.groups.filter((c) => c.parent === g.id && groups.has(c.id));
      const kids = [...kidNodes.map((n) => nodes.get(n.id)!), ...kidGroups.map((c) => groups.get(c.id)!)];
      const old = prev.groups?.get(g.id);
      if (!kids.length) {
        // An empty group is only its box: where it was, or where the fresh placement has it.
        const f = fresh.groups.get(g.id)!;
        groups.set(g.id, old ?? { ...f, x: f.x + whole.x, y: f.y + whole.y });
        continue;
      }
      let x0 = Math.min(...kids.map((k) => k.x)) - pad;
      const y0 = Math.min(...kids.map((k) => k.y)) - header;
      let x1 = Math.max(...kids.map((k) => k.x + k.width)) + pad;
      const y1 = Math.max(...kids.map((k) => k.y + k.height)) + pad;
      // A title wider than what the group holds: the extra width goes where the box had it (as in
      // tidy.ts), to the right first, then to the left.
      const extra = (minWidth.get(g.id) ?? 0) - (x1 - x0);
      if (extra > 0) {
        const right = old ? Math.max(0, Math.min(extra, old.x + old.width - x1)) : extra;
        const left = old ? Math.max(0, Math.min(extra - right, x0 - old.x)) : 0;
        x0 -= left;
        x1 += extra - left;
      }
      const fit = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
      const same =
        !!old &&
        within(fit, old) &&
        kidNodes.every((n) => was.has(n.id)) &&
        kidGroups.every((c) => !changed.has(c.id)) &&
        !gone.some((p) => holds(old, p)) &&
        // Nothing that was inside has left it (moved to another group in the YAML).
        ![...at].some(([id, b]) => !mine.get(id)!.has(g.id) && holds(old, centre(b)));
      if (!same) changed.add(g.id);
      groups.set(g.id, same ? old : fit);
    }
    return groups;
  };

  /** Two nodes on top of each other: never. */
  const stacked = (nodes: Map<string, Box>): boolean => {
    const list = [...nodes.values()];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (hit(list[i]!, list[j]!, -1)) return true;
    return false;
  };
  /** How often a group runs over a node it does not hold, or over a group beside it. */
  const overruns = (nodes: Map<string, Box>, groups: Map<string, Box>): number => {
    let n = 0;
    for (const [gid, gb] of groups) {
      for (const [id, b] of nodes) if (!mine.get(id)!.has(gid) && hit(b, gb, -1)) n++;
      for (const [other, ob] of groups) {
        if (other <= gid || !hit(gb, ob, -1)) continue;
        // Nested groups overlap by nature; any other two should not.
        let nested = false;
        for (let a = groupParent.get(gid); a; a = groupParent.get(a)) nested ||= a === other;
        for (let a = groupParent.get(other); a; a = groupParent.get(a)) nested ||= a === gid;
        if (!nested) n++;
      }
    }
    return n;
  };

  const nodes = new Map(at);
  // What was there must still fit as it was (a longer label can have grown a card into its
  // neighbour). An overrun the previous drawing already had is not held against this one.
  const before = overruns(nodes, new Map([...(prev.groups ?? [])].filter(([id]) => fresh.groups.has(id))));
  if (!lenient && (stacked(nodes) || overruns(nodes, groupsFor(nodes)) > before)) return undefined;

  const spots: Point[] = [];
  for (let i = -REACH; i <= REACH; i++) for (let j = -REACH; j <= REACH; j++) spots.push({ x: i * STEP, y: j * STEP });
  spots.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

  const linked = new Map<string, string[]>();
  for (const e of graph.edges) {
    linked.set(e.from.node, [...(linked.get(e.from.node) ?? []), e.to.node]);
    linked.set(e.to.node, [...(linked.get(e.to.node) ?? []), e.from.node]);
  }
  for (const n of graph.nodes) {
    const f = fresh.nodes.get(n.id);
    if (!f || was.has(n.id) || pins?.has(n.id)) continue;
    // Beside the same neighbours as in the fresh placement: its lines first, then its group, then anything.
    const lines = (linked.get(n.id) ?? []).filter((id) => offset.has(id));
    const siblings = graph.nodes.filter((o) => o.parent === n.parent && offset.has(o.id)).map((o) => o.id);
    const by = lines.length ? slide(lines) : siblings.length ? slide(siblings) : whole;
    const tx = Math.round((f.x + by.x) / 8) * 8;
    const ty = Math.round((f.y + by.y) / 8) * 8;
    let found: Box | undefined;
    // With pins about, a spot where its group grows over something will do when there is no other:
    // pins.ts moves what is in the way. A clean spot is still looked for first.
    let fallback: Box | undefined;
    let tries = 0;
    for (const s of spots) {
      const b = { ...f, x: tx + s.x, y: ty + s.y };
      let free = true;
      for (const o of nodes.values()) if (hit(b, o, gap)) { free = false; break; }
      if (!free) continue;
      if (++tries > TRIES) break;
      nodes.set(n.id, b);
      const groups = groupsFor(nodes);
      // Clear of the groups it is not in, with a little air; and its own group may not grow over anything.
      const air = Math.min(gap, pad) / 2;
      if (![...groups].some(([gid, gb]) => !mine.get(n.id)!.has(gid) && hit(b, gb, air))) {
        if (overruns(nodes, groups) <= before) {
          found = b;
          break;
        }
        if (lenient) fallback ??= b;
      }
      nodes.delete(n.id);
    }
    found ??= fallback;
    if (!found) return undefined;
    nodes.set(n.id, found);
  }

  // In the fresh placement's order, so everything after this sees the nodes as it always does.
  const ordered = new Map([...fresh.nodes.keys()].map((id) => [id, nodes.get(id)!]));
  const groups = groupsFor(ordered);
  if (!lenient && overruns(ordered, groups) > before) return undefined;
  const boxes = [...ordered.values(), ...groups.values()];
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  return { nodes: ordered, groups, width: Math.max(...boxes.map((b) => b.x + b.width)) - x0, height: Math.max(...boxes.map((b) => b.y + b.height)) - y0 };
}

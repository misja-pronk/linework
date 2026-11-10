// Places a process: lanes as bands, the flow running along them, lines on a grid.
//
// A process is read along its main line, so that line decides everything. Nodes get a column from
// their distance to the start (loops aside) and a row inside their lane: the main line on the
// lane's first row, branches on rows beside it. Lines then run on the grid that leaves: through the
// middle of a row or column where the cells are empty, or in the channels between them. Every
// line tries the few shapes a person would draw (straight, one bend off a gateway, one bend into
// a join, a step between lanes, around the outside for a loop) and takes the cheapest that passes
// through nothing. There is no search and no chance in it: the same source gives the same drawing,
// and a small edit moves little.
//
// All of it is worked out along the flow (u) and across it (v); a process that runs down is the
// same drawing with the two swapped at the end.
import type { Box, GraphEdge, Placed, PlacedEdge, Point, Sized } from '@cartography/core';

const GAP = { col: 44, row: 22, line: 12, margin: 16, lanePad: 14, lane: 8, label: 26 } as const;

interface Seg {
  hor: boolean;
  /** Which grid line it runs on: a row or row channel when level, a column or column channel when upright. */
  line: number;
  a: number;
  b: number;
}

interface Run extends Seg {
  edge: GraphEdge;
  first: boolean;
  last: boolean;
  /** Its place among the lines that share a channel. */
  sub?: number;
  /** Which side of the channel it came from: -1 the low side, 1 the high side. */
  side?: number;
}

const hz = (line: number, a: number, b: number): Seg => ({ hor: true, line, a, b });
const vt = (line: number, a: number, b: number): Seg => ({ hor: false, line, a, b });

export function flowLayout(sized: Sized): Placed {
  const g = sized.graph;
  const across = g.direction !== 'down';
  const lanes = g.groups.filter((l) => l.lane);
  const laneAt = new Map(lanes.map((l, i) => [l.id, i]));
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const index = new Map(g.nodes.map((n, i) => [n.id, i]));
  // A node outside every lane stands in a band of its own after them, without a box.
  const laneOf = (id: string) => laneAt.get(byId.get(id)?.parent ?? '') ?? lanes.length;
  const su = (id: string) => (across ? sized.nodes.get(id)!.width : sized.nodes.get(id)!.height);
  const sv = (id: string) => (across ? sized.nodes.get(id)!.height : sized.nodes.get(id)!.width);
  const beside = (id: string) => {
    const l = sized.nodes.get(id)?.label;
    return l ? { u: across ? l.width : l.height, v: across ? l.height : l.width } : undefined;
  };
  const labelOf = (e: GraphEdge) => {
    const l = sized.edgeLabels.get(e.id);
    return l ? { u: across ? l.width : l.height, v: across ? l.height : l.width } : undefined;
  };

  const edges = g.edges.filter((e) => byId.has(e.from.node) && byId.has(e.to.node) && e.from.node !== e.to.node);
  const loops = g.edges.filter((e) => byId.has(e.from.node) && e.from.node === e.to.node);
  // A message or a note's link ties two things together without putting one after the other.
  const soft = (e: GraphEdge) => e.line !== 'solid';
  const main = new Set(g.walk?.flatMap((b) => b.edges) ?? []);
  const mainNodes = [...new Set(g.walk?.flatMap((b) => b.nodes) ?? [])].filter((id) => byId.has(id));
  const onMain = new Set(mainNodes);
  const order = (list: GraphEdge[]) => list.sort((a, b) => +main.has(b.id) - +main.has(a.id) || +soft(a) - +soft(b) || g.edges.indexOf(a) - g.edges.indexOf(b));
  const outs = new Map<string, GraphEdge[]>(g.nodes.map((n) => [n.id, []]));
  const ins = new Map<string, GraphEdge[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of edges) (outs.get(e.from.node)!.push(e), ins.get(e.to.node)!.push(e));
  for (const list of outs.values()) order(list);

  // ---------------------------------------------------------------- columns
  // A line that leads back to something still being walked is a loop: it does not push anything further.
  const back = new Set<string>();
  const seen = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    seen.set(id, 1);
    for (const e of outs.get(id)!) {
      const s = seen.get(e.to.node);
      if (s === 1) back.add(e.id);
      else if (!s) visit(e.to.node);
    }
    seen.set(id, 2);
  };
  for (const id of [...mainNodes.slice(0, 1), ...g.nodes.filter((n) => !ins.get(n.id)!.some((e) => !soft(e))).map((n) => n.id), ...g.nodes.map((n) => n.id)]) if (!seen.has(id)) visit(id);
  const forward = edges.filter((e) => !back.has(e.id));
  // A gateway's way straight on keeps its row. One other way may leave by its lower point and one by its
  // upper point, to what then stands right under or over it: the branch drops off without a bend.
  const gate = (id: string) => {
    const s = byId.get(id)!.shape;
    return s.kind === 'flow' && (s.form === 'gateway' || (s.form === 'pseudo' && s.mark === 'choice'));
  };
  const drop = new Map<string, 1 | -1>();
  const rank = new Map<string, number>();
  // What something else keeps further on cannot stand under its gateway: that point goes to the next way out.
  const held = new Set<string>();
  for (let round = 0; round < 4; round++) {
    drop.clear();
    for (const n of g.nodes) {
      const ways = outs.get(n.id)!.filter((e) => !back.has(e.id) && !soft(e));
      if (!gate(n.id) || ways.length < 2) continue;
      const lane = laneOf(n.id);
      const straight = ways.find((e) => laneOf(e.to.node) === lane);
      const used = new Set<number>();
      for (const e of ways) {
        if (e === straight || held.has(e.id)) continue;
        const to = laneOf(e.to.node);
        const side = to > lane ? 1 : to < lane ? -1 : used.has(1) ? -1 : 1;
        if (used.has(side)) continue;
        used.add(side);
        drop.set(e.id, side);
      }
    }
    for (const n of g.nodes) rank.set(n.id, 0);
    for (let i = 0, moved = true; moved && i <= g.nodes.length; i++) {
      moved = false;
      for (const e of forward) {
        const need = rank.get(e.from.node)! + (soft(e) || drop.has(e.id) ? 0 : 1);
        if (rank.get(e.to.node)! < need) (rank.set(e.to.node, need), (moved = true));
      }
    }
    const off = [...drop.keys()].filter((id) => {
      const e = forward.find((x) => x.id === id)!;
      return rank.get(e.to.node) !== rank.get(e.from.node);
    });
    if (!off.length) break;
    for (const id of off) (held.add(id), drop.delete(id));
  }
  // What nothing leads to (a second trigger, a document) stands right before what it leads to.
  for (const n of g.nodes) {
    const next = forward.filter((e) => e.from.node === n.id);
    if (n.id === mainNodes[0] || !next.length || forward.some((e) => e.to.node === n.id)) continue;
    rank.set(n.id, Math.max(0, Math.min(...next.map((e) => rank.get(e.to.node)! - (soft(e) ? 0 : 1)))));
  }
  const nCols = Math.max(0, ...rank.values()) + 1;

  // ---------------------------------------------------------------- rows
  const track = new Map<string, number>();
  const taken = new Set<string>();
  const key = (lane: number, t: number, r: number) => `${lane}|${t}|${r}`;
  for (const id of mainNodes) (track.set(id, 0), taken.add(key(laneOf(id), 0, rank.get(id)!)));
  // The main line runs straight: keep the cells it passes free.
  for (const [i, id] of mainNodes.entries()) {
    const next = mainNodes[i + 1];
    if (next && laneOf(next) === laneOf(id)) for (let r = rank.get(id)! + 1; r < rank.get(next)!; r++) taken.add(key(laneOf(id), 0, r));
  }
  // What dropped off a gateway is placed after that gateway, though they share a column.
  const dropped = (id: string, depth = 0): number => {
    const via = depth > g.nodes.length ? undefined : ins.get(id)!.find((e) => drop.has(e.id) && rank.get(e.from.node) === rank.get(id));
    return via ? dropped(via.from.node, depth + 1) + 1 : 0;
  };
  const rest = g.nodes.map((n) => n.id).filter((id) => !track.has(id)).sort((a, b) => rank.get(a)! - rank.get(b)! || dropped(a) - dropped(b) || index.get(a)! - index.get(b)!);
  for (const id of rest) {
    const lane = laneOf(id);
    const r = rank.get(id)!;
    const via = ins.get(id)!.find((e) => drop.has(e.id) && rank.get(e.from.node) === r && laneOf(e.from.node) === lane && track.has(e.from.node));
    if (via) {
      const dir = drop.get(via.id)!;
      let want = track.get(via.from.node)! + dir;
      while (taken.has(key(lane, want, r))) want += dir;
      track.set(id, want);
      taken.add(key(lane, want, r));
      continue;
    }
    const from = ins.get(id)!.filter((e) => !back.has(e.id)).map((e) => e.from.node).find((p) => track.has(p)) ?? outs.get(id)!.filter((e) => !back.has(e.id)).map((e) => e.to.node).find((p) => track.has(p));
    let want = 0;
    let dir = 1;
    if (from !== undefined && laneOf(from) === lane) {
      const t = track.get(from)!;
      const siblings = [...new Set(outs.get(from)!.filter((e) => !back.has(e.id) && !main.has(e.id) && !drop.has(e.id) && laneOf(e.to.node) === lane).map((e) => e.to.node))];
      const k = Math.max(0, siblings.indexOf(id));
      const straight = outs.get(from)!.some((e) => main.has(e.id) && laneOf(e.to.node) === lane);
      if (onMain.has(from) && (straight || rank.get(from) === r)) {
        // Off the main line: the first branch below it, the second above, and so on outwards.
        dir = k % 2 ? -1 : 1;
        want = t + dir * (Math.floor(k / 2) + 1);
      } else {
        dir = t < 0 ? -1 : 1;
        want = t + dir * k;
      }
    }
    while (taken.has(key(lane, want, r))) want += dir;
    track.set(id, want);
    taken.add(key(lane, want, r));
  }

  // Grid lines across the flow, in order: per lane a channel, a row, a channel, a row, …, a channel.
  const nLanes = Math.max(lanes.length, ...g.nodes.map((n) => laneOf(n.id) + 1), 1);
  const hlines: { lane: number; row?: number; edge: boolean }[] = [];
  const rowLine: number[] = [];
  const rowAt = new Map<string, number>();
  for (let lane = 0; lane < nLanes; lane++) {
    const tracks = [...new Set(g.nodes.filter((n) => laneOf(n.id) === lane).map((n) => track.get(n.id)!))].sort((a, b) => a - b);
    if (!tracks.length) tracks.push(0);
    for (const [i, t] of tracks.entries()) {
      hlines.push({ lane, edge: i === 0 });
      rowAt.set(`${lane}|${t}`, rowLine.length);
      rowLine.push(hlines.length);
      hlines.push({ lane, row: rowLine.length - 1, edge: false });
    }
    hlines.push({ lane, edge: true });
  }
  const rowOf = (id: string) => rowAt.get(`${laneOf(id)}|${track.get(id)}`)!;
  const xOf = (id: string) => 2 * rank.get(id)! + 1;
  const yOf = (id: string) => rowLine[rowOf(id)]!;
  const isRow = (y: number) => hlines[y]?.row !== undefined;
  const cell = new Map<string, string>(g.nodes.map((n) => [`${xOf(n.id)},${yOf(n.id)}`, n.id]));

  // ---------------------------------------------------------------- lines
  const runs: Run[] = [];
  const routes = new Map<string, Run[]>();
  const splits = (id: string) => outs.get(id)!.filter((e) => !soft(e)).length > 1;
  const joins = (id: string) => ins.get(id)!.filter((e) => !soft(e)).length > 1;
  const span = (s: Seg) => [Math.min(s.a, s.b), Math.max(s.a, s.b)] as const;

  const shapes = (xs: number, ys: number, xt: number, yt: number): Seg[][] => {
    const out: Seg[][] = [];
    const besideX = (x: number) => [x + 1, x - 1];
    const besideY = (y: number) => [y + 1, y - 1];
    const eitherY = [...new Set([...besideY(ys), ...besideY(yt)])];
    if (ys === yt) out.push([hz(ys, xs, xt)]);
    if (xs === xt) out.push([vt(xs, ys, yt)]);
    if (xs !== xt && ys !== yt) {
      out.push([vt(xs, ys, yt), hz(yt, xs, xt)], [hz(ys, xs, xt), vt(xt, ys, yt)]);
      for (const k of new Set([...besideX(xt), ...besideX(xs)])) out.push([hz(ys, xs, k), vt(k, ys, yt), hz(yt, k, xt)]);
    }
    if (xs !== xt) for (const j of eitherY) out.push([vt(xs, ys, j), hz(j, xs, xt), vt(xt, j, yt)]);
    for (const k of besideX(xs)) for (const j of besideY(yt)) out.push([hz(ys, xs, k), vt(k, ys, j), hz(j, k, xt), vt(xt, j, yt)]);
    for (const j of besideY(ys)) for (const k of besideX(xt)) out.push([vt(xs, ys, j), hz(j, xs, k), vt(k, j, yt), hz(yt, k, xt)]);
    for (const k1 of besideX(xs)) for (const k2 of besideX(xt)) for (const j of eitherY) out.push([hz(ys, xs, k1), vt(k1, ys, j), hz(j, k1, k2), vt(k2, j, yt), hz(yt, k2, xt)]);
    return out.filter((segs) => segs.every((s) => s.a !== s.b));
  };

  const cost = (segs: Seg[], e: GraphEdge): number => {
    const s = e.from.node;
    const t = e.to.node;
    const loop = back.has(e.id);
    let c = (segs.length - 1) * 20;
    for (const [i, seg] of segs.entries()) {
      const [lo, hi] = span(seg);
      c += hi - lo;
      // Through a node: never.
      if (seg.hor && isRow(seg.line)) for (let x = lo + 1; x < hi; x++) if (cell.has(`${x},${seg.line}`)) c += 10000;
      if (!seg.hor && seg.line % 2) for (let y = lo + 1; y < hi; y++) if (cell.has(`${seg.line},${y}`)) c += 10000;
      const next = segs[i + 1];
      if (next && cell.has(seg.hor ? `${next.line},${seg.line}` : `${seg.line},${next.line}`)) c += 10000;
      const channel = seg.hor ? !isRow(seg.line) : seg.line % 2 === 0;
      for (const r of runs) {
        const [rlo, rhi] = span(r);
        if (r.hor === seg.hor) {
          if (r.line !== seg.line || Math.max(lo, rlo) >= Math.min(hi, rhi)) continue;
          // Lines that leave one node together or arrive at one together may share their way; others may not lie on each other.
          const shared = (i === 0 && !gate(s) && r.first && r.edge.from.node === s && r.a === seg.a && Math.sign(r.b - r.a) === Math.sign(seg.b - seg.a)) || (i === segs.length - 1 && r.last && r.edge.to.node === t && r.b === seg.b && Math.sign(r.b - r.a) === Math.sign(seg.b - seg.a));
          c += channel ? 2 : shared ? -3 : 1000;
        } else if (lo < r.line && r.line < hi && rlo < seg.line && seg.line < rhi) c += 16;
      }
    }
    const first = segs[0]!;
    const last = segs[segs.length - 1]!;
    // A task hands on at its end and takes over at its start; a gateway's branches peel off its points, a join is met from the side.
    if (!first.hor) c += splits(s) && !main.has(e.id) ? -8 : loop || soft(e) ? 0 : 12;
    else if (first.b < first.a) c += 10;
    if (!last.hor) c += joins(t) && !main.has(e.id) ? -4 : loop || soft(e) ? 0 : 12;
    else if (last.b < last.a) c += 14;
    // Each way out of a gateway has its own point, while there are points left.
    if (splits(s) && runs.some((r) => r.first && r.edge.from.node === s && r.hor === first.hor && Math.sign(r.b - r.a) === Math.sign(first.b - first.a))) c += gate(s) ? 60 : 6;
    // A loop goes back along the outside: over the main line, under a branch below it.
    if (loop && segs.length === 3 && !first.hor && yOf(s) === yOf(t)) c += (track.get(s)! > 0 ? first.b > first.a : first.b < first.a) ? -2 : 0;
    return c;
  };

  const length = (e: GraphEdge) => Math.abs(xOf(e.to.node) - xOf(e.from.node)) + Math.abs(yOf(e.to.node) - yOf(e.from.node));
  const queue = [
    ...edges.filter((e) => main.has(e.id)),
    ...edges.filter((e) => !main.has(e.id) && !back.has(e.id) && !soft(e)).sort((a, b) => length(a) - length(b)),
    ...edges.filter((e) => !main.has(e.id) && back.has(e.id) && !soft(e)),
    ...edges.filter((e) => !main.has(e.id) && soft(e)),
  ];
  for (const e of queue) {
    const options = shapes(xOf(e.from.node), yOf(e.from.node), xOf(e.to.node), yOf(e.to.node));
    let best = options[0]!;
    let bestCost = Infinity;
    for (const o of options) {
      const c = cost(o, e);
      if (c < bestCost) (best = o), (bestCost = c);
    }
    const mine = best.map((s, i): Run => ({ ...s, edge: e, first: i === 0, last: i === best.length - 1 }));
    for (const [i, r] of mine.entries()) {
      const from = mine[i - 1] ?? mine[i + 1];
      if (from) r.side = (i > 0 ? from.line : mine[i + 1]!.line) < r.line ? -1 : 1;
    }
    routes.set(e.id, mine);
    runs.push(...mine);
  }

  // Lines that share a channel each get a place in it: short ones nearest the side they came from, so they nest instead of cross.
  const channels = new Map<string, { low: number; high: number }>();
  const inChannel = (r: Seg) => (r.hor ? !isRow(r.line) : r.line % 2 === 0);
  for (const hor of [true, false]) {
    const lines = new Set(runs.filter((r) => r.hor === hor && inChannel(r)).map((r) => r.line));
    for (const line of lines) {
      const count = { low: 0, high: 0 };
      for (const side of [-1, 1]) {
        const list = runs.filter((r) => r.hor === hor && r.line === line && (r.side ?? -1) === side).sort((p, q) => span(p)[1] - span(p)[0] - (span(q)[1] - span(q)[0]) || span(p)[0] - span(q)[0]);
        const placed: Run[] = [];
        for (const r of list) {
          const [lo, hi] = span(r);
          const used = new Set(placed.filter((p) => span(p)[0] <= hi && lo <= span(p)[1]).map((p) => p.sub));
          let sub = 0;
          while (used.has(sub)) sub++;
          r.sub = sub;
          placed.push(r);
          count[side < 0 ? 'low' : 'high'] = Math.max(count[side < 0 ? 'low' : 'high'], sub + 1);
        }
      }
      channels.set(`${hor ? 'h' : 'v'}${line}`, count);
    }
  }
  const lineCount = (hor: boolean, line: number) => {
    const c = channels.get(`${hor ? 'h' : 'v'}${line}`);
    return c ? c.low + c.high : 0;
  };
  const subOf = (r: Run) => {
    const c = channels.get(`${r.hor ? 'h' : 'v'}${r.line}`)!;
    return (r.side ?? -1) < 0 ? r.sub! : c.low + c.high - 1 - r.sub!;
  };

  // ---------------------------------------------------------------- names beside their shape
  type Side = 'N' | 'S' | 'E' | 'W';
  const used = new Map<string, Set<Side>>(g.nodes.map((n) => [n.id, new Set<Side>()]));
  const sideOf = (s: Seg, start: boolean): Side => (s.hor ? (s.b > s.a === start ? 'E' : 'W') : s.b > s.a === start ? 'S' : 'N');
  for (const list of routes.values()) {
    used.get(list[0]!.edge.from.node)!.add(sideOf(list[0]!, true));
    used.get(list[0]!.edge.to.node)!.add(sideOf(list[list.length - 1]!, false));
  }
  for (const e of loops) used.get(e.from.node)!.add('N');
  // Under an event, over a gateway (its question reads before its answers), and off to the corner when both are taken.
  const nameAt = new Map<string, 'N' | 'S' | 'NW'>();
  for (const n of g.nodes) {
    if (!beside(n.id)) continue;
    const u = used.get(n.id)!;
    const prefer: ('N' | 'S')[] = n.shape.kind === 'flow' && n.shape.form === 'gateway' ? ['N', 'S'] : ['S', 'N'];
    nameAt.set(n.id, prefer.find((p) => !u.has(p)) ?? 'NW');
  }

  // ---------------------------------------------------------------- sizes
  const colW = Array.from({ length: nCols }, () => 0);
  for (const n of g.nodes) {
    const c = rank.get(n.id)!;
    const l = beside(n.id);
    colW[c] = Math.max(colW[c]!, su(n.id), l ? (nameAt.get(n.id) === 'NW' ? su(n.id) + 2 * l.u : l.u) : 0);
  }
  const exitLabel = (e: GraphEdge) => {
    const n = byId.get(e.from.node)!;
    return !!e.label && n.shape.kind === 'flow' && (n.shape.form === 'gateway' || (n.shape.form === 'pseudo' && n.shape.mark === 'choice'));
  };
  const chanW = Array.from({ length: nCols + 1 }, (_, k) => {
    const n = lineCount(false, 2 * k);
    const lines = n ? 2 * GAP.margin + (n - 1) * GAP.line : 0;
    return k === 0 || k === nCols ? lines : Math.max(GAP.col, lines);
  });
  // A label on a line needs the line to be longer than itself.
  for (const [id, list] of routes) {
    const e = list[0]!.edge;
    const l = labelOf(e);
    if (!l || !list[0]!.hor) continue;
    const c = rank.get(e.from.node)!;
    const forwards = list[0]!.b > list[0]!.a;
    const k = forwards ? c + 1 : c;
    const inside = (colW[c]! - su(e.from.node)) / 2;
    const bends = list.length > 1 && list[1]!.line === 2 * k;
    const need = l.u + (exitLabel(e) ? 22 : 30) - inside + (bends ? lineCount(false, 2 * k) * GAP.line + GAP.margin : 0);
    chanW[k] = Math.max(chanW[k]!, need);
    void id;
  }
  const header = lanes.length ? (across ? Math.max(...lanes.map((l) => sized.groupMinWidth.get(l.id) ?? 0)) : sized.groupHeader) : 0;
  const colU: number[] = [];
  const chanU: number[] = [];
  let u = lanes.length ? header + GAP.margin : 0;
  for (let k = 0; k <= nCols; k++) {
    chanU.push(u);
    u += chanW[k]!;
    if (k < nCols) (colU.push(u + colW[k]! / 2), (u += colW[k]!));
  }
  const totalU = u + (lanes.length ? GAP.margin : 0);

  const nRows = rowLine.length;
  const up = Array.from({ length: nRows }, () => 0);
  const down = Array.from({ length: nRows }, () => 0);
  for (const n of g.nodes) {
    const r = rowOf(n.id);
    const l = beside(n.id);
    const at = nameAt.get(n.id);
    const self = loops.some((e) => e.from.node === n.id) ? 26 : 0;
    up[r] = Math.max(up[r]!, sv(n.id) / 2 + Math.max(self, l && at === 'N' ? l.v + 6 : l && at === 'NW' ? Math.max(0, l.v + 16 - sv(n.id) / 2) : 0));
    down[r] = Math.max(down[r]!, sv(n.id) / 2 + (l && at === 'S' ? l.v + 6 : 0));
  }
  // A label right where its line leaves a gateway's point needs room before the line may turn.
  const bandTop = new Map<number, number>();
  const bandBottom = new Map<number, number>();
  for (const list of routes.values()) {
    const e = list[0]!.edge;
    const l = labelOf(e);
    if (!l || list[0]!.hor || !exitLabel(e)) continue;
    const y = yOf(e.from.node);
    if (list[0]!.b > list[0]!.a) bandTop.set(y + 1, Math.max(bandTop.get(y + 1) ?? 0, l.v + 8));
    else bandBottom.set(y - 1, Math.max(bandBottom.get(y - 1) ?? 0, l.v + 8));
  }
  const chanV = new Map<number, { top: number; height: number }>();
  const rowV: number[] = [];
  const laneBox: { top: number; bottom: number }[] = [];
  let v = 0;
  for (let lane = 0; lane < nLanes; lane++) {
    const boxed = lane < lanes.length;
    const top = v;
    if (boxed) v += GAP.lanePad;
    for (const [y, h] of hlines.entries()) {
      if (h.lane !== lane) continue;
      if (h.row !== undefined) {
        rowV[h.row] = v + up[h.row]!;
        v += up[h.row]! + down[h.row]!;
        continue;
      }
      const n = lineCount(true, y);
      const lines = n ? 20 + (n - 1) * GAP.line : 0;
      const outer = y === 0 || hlines[y - 1]!.lane !== lane || y === hlines.length - 1 || hlines[y + 1]!.lane !== lane;
      const height = (outer ? lines : Math.max(GAP.row, lines)) + (bandTop.get(y) ?? 0) + (bandBottom.get(y) ?? 0);
      chanV.set(y, { top: v + (bandTop.get(y) ?? 0), height: height - (bandTop.get(y) ?? 0) - (bandBottom.get(y) ?? 0) });
      v += height;
    }
    if (boxed) v += GAP.lanePad;
    laneBox.push({ top, bottom: v });
    v += lane < nLanes - 1 ? (boxed ? GAP.lane : GAP.row) : 0;
  }
  const totalV = v;

  // ---------------------------------------------------------------- coordinates
  const where = (r: Run): number => {
    if (r.hor) {
      if (isRow(r.line)) return rowV[hlines[r.line]!.row!]!;
      const c = chanV.get(r.line)!;
      const n = lineCount(true, r.line);
      return c.top + (c.height - (n - 1) * GAP.line) / 2 + subOf(r) * GAP.line;
    }
    if (r.line % 2) return colU[(r.line - 1) / 2]!;
    const k = r.line / 2;
    const n = lineCount(false, r.line);
    return chanU[k]! + (chanW[k]! - (n - 1) * GAP.line) / 2 + subOf(r) * GAP.line;
  };
  const centre = (id: string) => ({ u: colU[rank.get(id)!]!, v: rowV[rowOf(id)]! });
  const port = (id: string, s: Seg, start: boolean) => {
    const c = centre(id);
    const out = s.b > s.a === start ? 1 : -1;
    return s.hor ? { u: c.u + (out * su(id)) / 2, v: c.v } : { u: c.u, v: c.v + (out * sv(id)) / 2 };
  };

  type UV = { u: number; v: number };
  const box = (b: { u: number; v: number; du: number; dv: number }): Box => (across ? { x: b.u, y: b.v, width: b.du, height: b.dv } : { x: b.v, y: b.u, width: b.dv, height: b.du });
  const point = (p: UV): Point => (across ? { x: p.u, y: p.v } : { x: p.v, y: p.u });
  const placed: Placed = { nodes: new Map(), groups: new Map(), edges: new Map(), width: across ? totalU : totalV, height: across ? totalV : totalU, labels: new Map() };

  for (const n of g.nodes) {
    const c = centre(n.id);
    placed.nodes.set(n.id, box({ u: c.u - su(n.id) / 2, v: c.v - sv(n.id) / 2, du: su(n.id), dv: sv(n.id) }));
    const l = beside(n.id);
    const at = nameAt.get(n.id);
    if (!l || !at) continue;
    const uv = at === 'N' ? { u: c.u - l.u / 2, v: c.v - sv(n.id) / 2 - 5 - l.v } : at === 'S' ? { u: c.u - l.u / 2, v: c.v + sv(n.id) / 2 + 5 } : { u: c.u - 12 - l.u, v: c.v - 16 - l.v };
    placed.labels!.set(n.id, box({ ...uv, du: l.u, dv: l.v }));
  }
  for (const [i, lane] of lanes.entries()) placed.groups.set(lane.id, box({ u: 0, v: laneBox[i]!.top, du: totalU, dv: laneBox[i]!.bottom - laneBox[i]!.top }));

  for (const [id, list] of routes) {
    const e = list[0]!.edge;
    const at = list.map(where);
    const pts: UV[] = [port(e.from.node, list[0]!, true)];
    for (let i = 0; i + 1 < list.length; i++) pts.push(list[i]!.hor ? { u: at[i + 1]!, v: at[i]! } : { u: at[i]!, v: at[i + 1]! });
    pts.push(port(e.to.node, list[list.length - 1]!, false));
    const out: PlacedEdge = { points: pts.map(point) };
    const l = labelOf(e);
    if (l) {
      const [p, q] = [pts[0]!, pts[1]!];
      let c: UV;
      if (exitLabel(e)) {
        // Right at the way out: "no" belongs to the gateway, not to the middle of the line.
        const d = { u: Math.sign(q.u - p.u), v: Math.sign(q.v - p.v) };
        c = { u: p.u + d.u * (8 + l.u / 2), v: p.v + d.v * (6 + l.v / 2) };
      } else {
        // On the middle of its longest piece.
        let k = 0;
        const len = (i: number) => Math.abs(pts[i + 1]!.u - pts[i]!.u) + Math.abs(pts[i + 1]!.v - pts[i]!.v);
        for (let i = 1; i + 1 < pts.length; i++) if (len(i) > len(k) + 1) k = i;
        c = { u: (pts[k]!.u + pts[k + 1]!.u) / 2, v: (pts[k]!.v + pts[k + 1]!.v) / 2 };
      }
      out.label = box({ u: c.u - l.u / 2, v: c.v - l.v / 2, du: l.u, dv: l.v });
    }
    placed.edges.set(id, out);
  }
  // Back to itself: a small loop over the top.
  for (const e of loops) {
    const c = centre(e.from.node);
    const top = c.v - sv(e.from.node) / 2;
    const pts = [{ u: c.u + 14, v: top }, { u: c.u + 14, v: top - 18 }, { u: c.u - 14, v: top - 18 }, { u: c.u - 14, v: top }];
    const l = labelOf(e);
    placed.edges.set(e.id, { points: pts.map(point), ...(l ? { label: box({ u: c.u - l.u / 2, v: top - 18 - l.v / 2, du: l.u, dv: l.v }) } : {}) });
  }
  return placed;
}

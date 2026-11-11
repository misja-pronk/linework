// Git flow shape: branches as rows, commits as dots along one time axis, metro-map style. Each commit
// owns a column; the lanes engine stacks the rows (each as tall as its tags and labels) and spreads
// the columns, each gap only as wide as what has to fit: labels of neighbours on one row, the corner
// of a fork or merge, and every line that passes through a row next to someone's label.
//
// Forks leave their commit vertically and turn onto the new row; merges run along their own row and
// turn into the merge commit. So lines never leave a dot on the side its text is on: a commit's label
// and notes go below the line, its tags above, unless a line takes that side.
import type { Box, GitBranch, GitCommit, GitflowShape, GitPipeline, GitStage, Tone } from '@cartography/core';
import { spread, stack, tracks, type Apart, type Row, type Span } from '@cartography/lanes';
import { baselineOffset, fitText, groupFill, groupLine, look, measureText, type Theme } from '@cartography/theme';
import { icon } from '@cartography/icons';
import { wrapLines } from './sequence.ts';
import { arrowHead, cardStroke, chipBack, iconTile, shadowAttr, tagRadius, esc } from './paint.ts';

const K = {
  dot: 6.5,
  line: 3,
  gap: 26,
  corner: 14,
  pad: 10,
  label: { size: 11.5, line: 15, max: 132 },
  pill: { h: 20, size: 11, padX: 8, icon: 12 },
  stackGap: 4,
  room: 14,
  rowGap: 18,
  gutter: { padX: 10, h: 24, gap: 24 },
  env: { row: 40, marker: 22 },
  end: 40,
};

type Side = 'up' | 'down';

interface Piece {
  kind: 'tag' | 'label' | 'note' | 'branch';
  text: string;
  lines?: string[];
  width: number;
  height: number;
}

export interface GitCommitPlace {
  c: GitCommit;
  x: number;
  y: number;
  /** Half the width of the dot (wider for a "12 commits" pill). */
  half: number;
  up: Piece[];
  down: Piece[];
  tone: Tone;
}

export interface GitLink {
  kind: 'fork' | 'merge' | 'pick';
  d: string;
  tone: Tone;
  /** Arrowhead at the end, pointing along `dir`. */
  head?: { x: number; y: number; dx: number; dy: number };
}

export interface GitflowGeometry {
  width: number;
  height: number;
  gutter: number;
  rows: { label: string; tone: Tone; y: number; top: number; bottom: number }[];
  lines: { tone: Tone; x1: number; x2: number; y: number; keep: boolean }[];
  commits: GitCommitPlace[];
  links: GitLink[];
  envs: { label: string; tone: Tone; y: number }[];
  deploys: { x: number; y1: number; y2: number; tone: Tone; label: string }[];
  delivery?: DeliveryGeometry;
}

const cache = new WeakMap<GitflowShape, Map<Theme, GitflowGeometry>>();

export function gitflowGeometry(shape: GitflowShape, theme: Theme): GitflowGeometry {
  let byTheme = cache.get(shape);
  if (!byTheme) cache.set(shape, (byTheme = new Map()));
  let g = byTheme.get(theme);
  if (!g) byTheme.set(theme, (g = shape.view === 'delivery' ? placeDelivery(shape, theme) : place(shape)));
  return g;
}

const pillWidth = (text: string, withIcon: boolean) => Math.ceil(measureText(text, K.pill.size, 600) + 2 * K.pill.padX + (withIcon ? K.pill.icon + 4 : 0));
const stackHeight = (ps: Piece[]) => (ps.length ? K.dot + 6 + ps.reduce((h, p, i) => h + p.height + (i ? K.stackGap : 0), 0) : 0);
const stackWidth = (ps: Piece[]) => Math.max(0, ...ps.map((p) => p.width));
const countText = (n: number) => `${n} commits`;

/** Lane label in the gutter: one branch's name, or the family when short-lived branches share the row. */
function rowLabel(bs: GitBranch[]): string {
  if (bs.length === 1) return bs[0]!.label ?? bs[0]!.name;
  const prefix = bs[0]!.name.includes('/') ? bs[0]!.name.split('/')[0] : undefined;
  return prefix && bs.every((b) => b.name.startsWith(`${prefix}/`)) ? `${prefix}/*` : bs.map((b) => b.name).join(', ');
}

function place(shape: GitflowShape): GitflowGeometry {
  const branches = shape.branches;
  const commits = shape.commits;
  const byId = new Map(commits.map((c, i) => [c.id, i]));
  const branchOf = new Map(branches.map((b) => [b.name, b]));
  const col = (id: string | undefined) => (id === undefined ? undefined : byId.get(id));

  // 1. Rows: long-lived branches have their own; short-lived ones of a family share rows when they
  // do not overlap in time (tracks of the lanes engine, a column's gap apart).
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const touch = (b: string, i: number) => {
    first.set(b, Math.min(first.get(b) ?? i, i));
    last.set(b, Math.max(last.get(b) ?? i, i));
  };
  for (const [i, c] of commits.entries()) {
    touch(c.branch, i);
    const f = col(c.fork);
    if (f !== undefined) first.set(c.branch, Math.min(first.get(c.branch)!, f));
    const m = col(c.merge);
    if (m !== undefined) touch(commits[m]!.branch, i);
  }
  const used = branches.filter((b) => first.has(b.name));
  // Rows are shared within a family and a prefix: feature/a and feature/b, never feature/a and fix/b.
  const laneKey = (b: GitBranch) => (b.keep ? `keep:${b.name}` : `${b.family}:${b.name.includes('/') ? b.name.split('/')[0] : b.name}`);
  const families = [...new Set(used.map(laneKey))];
  const spans: Span[] = used.map((b) => ({ lane: families.indexOf(laneKey(b)), from: first.get(b.name)!, to: b.keep ? Infinity : last.get(b.name)! + 1 }));
  const track = tracks(spans);
  const rowKeys = [...new Set(used.map((b, i) => `${spans[i]!.lane}:${track[i]}`))].sort((p, q) => {
    const [a, b] = [p.split(':').map(Number), q.split(':').map(Number)];
    return a[0]! - b[0]! || a[1]! - b[1]!;
  });
  const rowOf = new Map(used.map((b, i) => [b.name, rowKeys.indexOf(`${spans[i]!.lane}:${track[i]}`)]));
  const rowBranches = rowKeys.map((_, r) => used.filter((b) => rowOf.get(b.name) === r));
  const shared = rowBranches.map((bs) => bs.length > 1);

  // 2. Which side of each dot a line takes. Merges arrive vertically into their dot, deploys leave it
  // downwards; a fork leaves its dot vertically when the dot is free, otherwise it splits off the line
  // a little later (`late`), so two lines never share a stretch and text keeps one free side.
  const blocked = commits.map(() => new Set<Side>());
  const rowIdx = (i: number) => rowOf.get(commits[i]!.branch)!;
  const toward = (from: number, to: number): Side => (rowIdx(to) > rowIdx(from) ? 'down' : 'up');
  const mergeFrom = (i: number) => {
    const m = col(commits[i]!.merge);
    return m !== undefined && rowIdx(m) !== rowIdx(i) ? m : undefined;
  };
  for (const [i, c] of commits.entries()) {
    const m = mergeFrom(i);
    if (m !== undefined) blocked[i]!.add(toward(i, m));
    if (c.deploy.length) blocked[i]!.add('down');
    // A cherry-pick leaves its commit and enters the copy vertically, in one dashed curve.
    const s = col(c.pick);
    if (s !== undefined && rowIdx(s) !== rowIdx(i)) {
      blocked[i]!.add(toward(i, s));
      blocked[s]!.add(toward(s, i));
    }
  }
  const late = new Set<number>();
  for (const [i, c] of commits.entries()) {
    const f = col(c.fork);
    if (f === undefined || rowIdx(f) === rowIdx(i)) continue;
    if (blocked[f]!.size) late.add(i);
    else blocked[f]!.add(toward(f, i));
  }

  // 3. What each commit shows above and below its dot.
  const L = K.label;
  const places: GitCommitPlace[] = commits.map((c, i) => {
    const b = branchOf.get(c.branch)!;
    const tags: Piece[] = c.tags.map((t) => ({ kind: 'tag', text: t, width: pillWidth(t, true), height: K.pill.h }));
    const text: Piece[] = [];
    // On a shared row the branch names itself at its first commit.
    if (shared[rowIdx(i)] && first.get(c.branch) !== undefined && commits.findIndex((x) => x.branch === c.branch) === i)
      text.push({ kind: 'branch', text: c.branch, width: Math.ceil(measureText(c.branch, L.size, 600)), height: L.line });
    if (c.label) {
      const lines = wrapLines(c.label, L.size, 500, L.max);
      text.push({ kind: 'label', text: c.label, lines, width: Math.ceil(Math.max(...lines.map((l) => measureText(l, L.size, 500)))), height: lines.length * L.line });
    }
    for (const n of c.notes) text.push({ kind: 'note', text: n, width: pillWidth(n, true), height: K.pill.h });
    const up: Piece[] = [];
    const down: Piece[] = [];
    const bu = blocked[i]!.has('up');
    const bd = blocked[i]!.has('down');
    (bu && !bd ? down : up).push(...tags);
    (bd && !bu ? up : down).push(...text);
    const half = c.count ? pillWidth(countText(c.count), false) / 2 : K.dot;
    return { c, x: 0, y: 0, half, up, down, tone: b.tone };
  });

  // 4. Along (here: down the page): rows stacked, each as tall as the text above and below its line.
  const envs = shape.environments;
  const rows: Row[] = rowKeys.map((_, r) => {
    const mine = places.filter((p, i) => rowIdx(i) === r);
    const up = Math.max(K.room, ...mine.map((p) => stackHeight(p.up)));
    const down = Math.max(K.room, ...mine.map((p) => stackHeight(p.down)));
    return { size: up + down, anchor: up };
  });
  const stacked = stack(rows, [], K.rowGap);
  const top = 6;
  const lineY = (r: number) => top + stacked.rows[r]!.at;
  for (const [i, p] of places.entries()) p.y = lineY(rowIdx(i));
  const envTop = top + stacked.size + (envs.length ? K.rowGap + 8 : 0);
  const envY = (k: number) => envTop + k * K.env.row + K.env.row / 2;

  // 5. Across: columns spread by what has to fit between them.
  const aparts: Apart[] = [];
  const contentHalf = (p: GitCommitPlace, side: Side) => stackWidth(side === 'up' ? p.up : p.down) / 2;
  for (let r = 0; r < rowKeys.length; r++) {
    const on = places.map((p, i) => i).filter((i) => rowIdx(i) === r);
    for (const [k, i] of on.entries()) {
      if (k) aparts.push({ a: on[k - 1]!, b: i, min: places[on[k - 1]!]!.half + places[i]!.half + K.gap });
      // The next commit on each side with text there keeps clear of this one's text.
      for (const side of ['up', 'down'] as Side[]) {
        if (!contentHalf(places[i]!, side)) continue;
        const next = on.slice(k + 1).find((j) => contentHalf(places[j]!, side));
        if (next !== undefined) aparts.push({ a: i, b: next, min: contentHalf(places[i]!, side) + contentHalf(places[next]!, side) + 14 });
      }
    }
  }
  // Vertical lines: `dx` right of a column, from y1 to y2. Every dot and text they would cut keeps clear.
  const R = K.corner;
  const verticals: { at: number; dx: number; y1: number; y2: number }[] = [];
  /** How far right of its source a late fork turns: past the source's text on that side. */
  const lateDx = new Map<number, number>();
  /** Where a deploy line starts: under the dot, or under the corner of a merge that comes from below. */
  const deployFrom = new Map<number, number>();
  for (const [i, c] of commits.entries()) {
    const p = places[i]!;
    const f = col(c.fork);
    if (f !== undefined && rowIdx(f) !== rowIdx(i)) {
      const s = places[f]!;
      // Several late forks from one commit turn one after the other, each a corner further.
      const before = [...lateDx.keys()].filter((j) => col(commits[j]!.fork) === f).length;
      const dx = late.has(i) ? Math.max(s.half, contentHalf(s, toward(f, i))) + R + 6 + before * (R + 8) : 0;
      if (dx) lateDx.set(i, dx);
      aparts.push({ a: f, b: i, min: dx + R + p.half + 8 });
      verticals.push({ at: f, dx, y1: s.y, y2: p.y });
    }
    const m = mergeFrom(i);
    if (m !== undefined) {
      aparts.push({ a: m, b: i, min: R + places[m]!.half + p.half + 8 });
      verticals.push({ at: i, dx: 0, y1: places[m]!.y, y2: p.y });
    }
    const s = col(c.pick);
    if (s !== undefined) {
      aparts.push({ a: s, b: i, min: 2 * R + places[s]!.half + p.half });
      // The curve runs near the source's column in its first half and near the copy's in its second.
      const mid = (places[s]!.y + p.y) / 2;
      verticals.push({ at: s, dx: 0, y1: places[s]!.y, y2: mid }, { at: i, dx: 0, y1: mid, y2: p.y });
    }
    if (c.deploy.length) {
      const lowest = Math.max(...c.deploy.map((d) => envs.findIndex((e) => e.id === d)));
      const y1 = m !== undefined && places[m]!.y > p.y ? places[m]!.y + R / 2 : p.y + K.dot + 3;
      deployFrom.set(i, y1);
      verticals.push({ at: i, dx: 0, y1, y2: envY(lowest) });
    }
  }
  const extentY = (p: GitCommitPlace, side: Side): [number, number] => (side === 'up' ? [p.y - stackHeight(p.up), p.y] : [p.y, p.y + stackHeight(p.down)]);
  for (const v of verticals) {
    const [y1, y2] = [Math.min(v.y1, v.y2), Math.max(v.y1, v.y2)];
    for (const [k, p] of places.entries()) {
      // The dot the line leaves or enters is drawn over it; its text is on its free side.
      if (k === v.at) continue;
      let half = p.y >= y1 - K.dot && p.y <= y2 + K.dot ? p.half : 0;
      for (const side of ['up', 'down'] as Side[]) {
        const [a, b] = extentY(p, side);
        if (b > y1 && a < y2) half = Math.max(half, contentHalf(p, side));
      }
      if (!half) continue;
      if (k > v.at) aparts.push({ a: v.at, b: k, min: v.dx + half + 9 });
      else if (half + 9 - v.dx > 0) aparts.push({ a: k, b: v.at, min: half + 9 - v.dx });
    }
  }
  const sizes = places.map((p) => 2 * p.half);
  const { centres } = spread(sizes, 6, aparts);

  // The gutter of lane names, then the columns; a commit's text may stick out left of its dot.
  const rowLabels = rowBranches.map(rowLabel);
  const gutter = Math.ceil(Math.max(0, ...rowLabels.map((l) => measureText(l, K.pill.size + 0.5, 600) + 2 * K.gutter.padX + 16), ...envs.map((e) => measureText(e.label, K.pill.size + 0.5, 600) + 2 * K.gutter.padX + 16)) + K.gutter.gap);
  const lead = Math.max(0, ...places.map((p, i) => Math.max(contentHalf(p, 'up'), contentHalf(p, 'down'), p.half) - centres[i]!)) + 12;
  for (const [i, p] of places.entries()) p.x = gutter + lead + centres[i]!;
  const right = Math.max(gutter + lead, ...places.map((p) => p.x + Math.max(p.half, contentHalf(p, 'up'), contentHalf(p, 'down')))) + K.end;

  // 6. Lines, forks, merges, picks.
  const lines: GitflowGeometry['lines'] = [];
  for (const b of used) {
    const mine = places.filter((p) => p.c.branch === b.name);
    if (!mine.length) continue;
    const y = lineY(rowOf.get(b.name)!);
    // A late fork splits off this line: it runs at least to where the fork turns away.
    const forks = [...lateDx].filter(([i]) => commits[col(commits[i]!.fork)!]!.branch === b.name).map(([i, dx]) => places[col(commits[i]!.fork)!]!.x + dx - R);
    lines.push({ tone: b.tone, x1: mine[0]!.x, x2: b.keep ? right - 8 : Math.max(mine.at(-1)!.x, ...forks), y, keep: b.keep });
  }
  const links: GitLink[] = [];
  for (const [i, p] of places.entries()) {
    const c = p.c;
    const f = col(c.fork);
    if (f !== undefined) {
      const s = places[f]!;
      const dir = p.y > s.y ? 1 : -1;
      const dx = lateDx.get(i);
      if (s.y === p.y) links.push({ kind: 'fork', tone: p.tone, d: `M${r1(s.x)} ${r1(s.y)}H${r1(p.x)}` });
      else if (dx) {
        // Splits off the source's line after its dot, in a curve, then down (or up) to its own row.
        const xv = s.x + dx;
        links.push({ kind: 'fork', tone: p.tone, d: `M${r1(xv - R)} ${r1(s.y)}Q${r1(xv)} ${r1(s.y)} ${r1(xv)} ${r1(s.y + dir * R)}V${r1(p.y - dir * R)}Q${r1(xv)} ${r1(p.y)} ${r1(xv + R)} ${r1(p.y)}H${r1(p.x - p.half)}` });
      } else links.push({ kind: 'fork', tone: p.tone, d: `M${r1(s.x)} ${r1(s.y + dir * K.dot)}V${r1(p.y - dir * R)}Q${r1(s.x)} ${r1(p.y)} ${r1(s.x + R)} ${r1(p.y)}H${r1(p.x - p.half)}` });
    }
    const m = col(c.merge);
    if (m !== undefined) {
      const s = places[m]!;
      const dir = p.y > s.y ? 1 : -1;
      const tone = branchOf.get(s.c.branch)!.tone;
      if (s.y === p.y) links.push({ kind: 'merge', tone, d: `M${r1(s.x)} ${r1(s.y)}H${r1(p.x)}` });
      else {
        const end = p.y - dir * (K.dot + 2.5);
        links.push({ kind: 'merge', tone, d: `M${r1(s.x + s.half)} ${r1(s.y)}H${r1(p.x - R)}Q${r1(p.x)} ${r1(s.y)} ${r1(p.x)} ${r1(s.y + dir * R)}V${r1(end - dir * 5)}`, head: { x: p.x, y: end, dx: 0, dy: dir } });
      }
    }
    const k = col(c.pick);
    if (k !== undefined) {
      const s = places[k]!;
      const tone = branchOf.get(s.c.branch)!.tone;
      if (s.y === p.y) {
        const ex = p.x - p.half - 3;
        links.push({ kind: 'pick', tone, d: `M${r1(s.x + s.half)} ${r1(s.y)}H${r1(ex - 5)}`, head: { x: ex, y: p.y, dx: 1, dy: 0 } });
      } else {
        const dir = p.y > s.y ? 1 : -1;
        const sy = s.y + dir * K.dot;
        const ey = p.y - dir * (K.dot + 2.5);
        const mid = (sy + ey) / 2;
        links.push({ kind: 'pick', tone, d: `M${r1(s.x)} ${r1(sy)}C${r1(s.x)} ${r1(mid)} ${r1(p.x)} ${r1(mid)} ${r1(p.x)} ${r1(ey - dir * 5)}`, head: { x: p.x, y: ey, dx: 0, dy: dir } });
      }
    }
  }

  const deploys: GitflowGeometry['deploys'] = [];
  for (const [i, p] of places.entries())
    for (const d of p.c.deploy) {
      const k = envs.findIndex((e) => e.id === d);
      if (k >= 0) deploys.push({ x: p.x, y1: deployFrom.get(i)!, y2: envY(k), tone: envs[k]!.tone, label: envs[k]!.label });
    }

  const rowsOut = rowKeys.map((_, r) => ({
    label: rowLabels[r]!,
    tone: rowBranches[r]![0]!.tone,
    y: lineY(r),
    top: top + stacked.rows[r]!.start,
    bottom: top + stacked.rows[r]!.start + rows[r]!.size,
  }));
  const height = Math.ceil(envs.length ? envTop + envs.length * K.env.row + 4 : top + stacked.size + 6);
  return {
    width: Math.ceil(right),
    height,
    gutter,
    rows: rowsOut,
    lines,
    commits: places,
    links,
    envs: envs.map((e, k) => ({ label: e.label, tone: e.tone, y: envY(k) })),
    deploys,
  };
}

/** The box of every tag, label and note as drawn, stacked out from the dot: for checks and tests. */
export function gitTextBoxes(g: GitflowGeometry): (Box & { commit: string })[] {
  const out: (Box & { commit: string })[] = [];
  for (const p of g.commits)
    for (const [side, pieces] of [['up', p.up], ['down', p.down]] as const) {
      let y = side === 'up' ? p.y - K.dot - 6 : p.y + K.dot + 6;
      for (const piece of pieces) {
        const top = side === 'up' ? y - piece.height : y;
        out.push({ x: p.x - piece.width / 2, y: top, width: piece.width, height: piece.height, commit: p.c.id });
        y += (side === 'up' ? -1 : 1) * (piece.height + K.stackGap);
      }
    }
  return out;
}

// ---------------------------------------------------------------- delivery view

const D = {
  head: { h: 54, tile: 30, padX: 12, gap: 10, min: 150 },
  cell: { h: 36, padX: 12, icon: 14, min: 96 },
  gate: { h: 22 },
  row: 64,
  gap: 34,
  bandPad: 12,
};

export interface DeliveryGeometry {
  stages: { s: GitStage; x: number; width: number }[];
  headerHeight: number;
  rows: { p: GitPipeline; y: number }[];
  cells: { box: Box; label: string; icon: string; tone: Tone; stage: string }[];
  arrows: { x1: number; x2: number; y: number; tone: Tone; gate?: { box: Box; label: string } }[];
  /** A row handing over to the one it merges into: out of its last step, through the gap between the rows, into the other's first. */
  merges: { d: string; tone: Tone; tip: { x: number; y: number; dy: number }; at: { x: number; y: number } }[];
  bands: Box[];
}

function placeDelivery(shape: GitflowShape, theme: Theme): GitflowGeometry {
  const stages = shape.stages;
  const idx = new Map(stages.map((s, i) => [s.id, i]));
  const cellWidth = (label: string) => Math.ceil(Math.max(D.cell.min, measureText(label, theme.size.caption, 600) + 2 * D.cell.padX + D.cell.icon + 6));
  const headWidth = (s: GitStage) => Math.ceil(Math.max(D.head.min, measureText(s.label, theme.size.label, 600) + D.head.tile + D.head.gap + 2 * D.head.padX + 8));
  const gateWidth = (g: string) => pillWidth(g, true);
  const widths = stages.map((s, i) => Math.max(headWidth(s), ...shape.pipelines.flatMap((p) => p.steps.filter((st) => idx.get(st.stage) === i).map((st) => cellWidth(st.label)))));
  const aparts: Apart[] = [];
  for (const p of shape.pipelines)
    for (const [k, st] of p.steps.entries()) {
      if (!k || !st.gate) continue;
      const a = idx.get(p.steps[k - 1]!.stage)!;
      const b = idx.get(st.stage)!;
      // The gate sits in the last gap before its stage: that gap holds the pill and two arrow stubs.
      if (b - 1 >= a) aparts.push({ a: b - 1, b, min: (widths[b - 1]! + widths[b]!) / 2 + gateWidth(st.gate) + 2 * 18 });
    }
  const { centres } = spread(widths, D.gap, aparts);
  const labels = shape.pipelines.map((p) => p.label);
  const gutter = Math.ceil(Math.max(0, ...labels.map((l) => measureText(l, K.pill.size + 0.5, 600) + 2 * K.gutter.padX + 16)) + K.gutter.gap);
  const x0 = gutter - Math.min(0, ...centres.map((c, i) => c - widths[i]! / 2));
  const cx = (i: number) => x0 + centres[i]!;
  const headerHeight = D.head.h;
  const stacked = stack(shape.pipelines.map(() => ({ size: D.row })), [], 0);
  const rowY = (r: number) => headerHeight + 18 + stacked.rows[r]!.at;
  const cells: DeliveryGeometry['cells'] = [];
  const arrows: DeliveryGeometry['arrows'] = [];
  for (const [r, p] of shape.pipelines.entries()) {
    const y = rowY(r);
    let prev: Box | undefined;
    for (const st of p.steps) {
      const i = idx.get(st.stage)!;
      const w = cellWidth(st.label);
      const box = { x: cx(i) - w / 2, y: y - D.cell.h / 2, width: w, height: D.cell.h };
      if (prev) {
        const a = { x1: prev.x + prev.width, x2: box.x, y, tone: p.tone } as DeliveryGeometry['arrows'][number];
        if (st.gate) {
          const gw = gateWidth(st.gate);
          // Centred in the gap right before the stage, so a long arrow that skips stages reads "…then approve".
          const gapMid = i > 0 ? (cx(i - 1) + widths[i - 1]! / 2 + cx(i) - widths[i]! / 2) / 2 : box.x - gw / 2 - 18;
          const mid = Math.max(a.x1 + gw / 2 + 14, Math.min(gapMid, a.x2 - gw / 2 - 14));
          a.gate = { box: { x: mid - gw / 2, y: y - D.gate.h / 2, width: gw, height: D.gate.h }, label: st.gate };
        }
        arrows.push(a);
      }
      const stage = stages[i]!;
      cells.push({ box, label: st.label, icon: stage.icon, tone: stage.tone, stage: stage.id });
      prev = box;
    }
  }
  const merges: DeliveryGeometry['merges'] = [];
  for (const [r, p] of shape.pipelines.entries()) {
    const t = p.into ? shape.pipelines.findIndex((q) => q.label === p.into) : -1;
    const last = p.steps.at(-1);
    const first = shape.pipelines[t]?.steps[0];
    if (t < 0 || !last || !first) continue;
    const dir = t < r ? -1 : 1;
    const x1 = cx(idx.get(last.stage)!);
    const x2 = cx(idx.get(first.stage)!);
    const y1 = rowY(r) + (dir * D.cell.h) / 2;
    const y2 = rowY(t) - (dir * D.cell.h) / 2;
    // The elbow runs halfway between this row and the next one towards the target.
    const ym = (rowY(r) + rowY(r + dir)) / 2;
    const R = 8;
    const sx = Math.sign(x2 - x1) || 1;
    const d = `M${r1(x1)} ${r1(y1)}V${r1(ym - dir * R)}Q${r1(x1)} ${r1(ym)} ${r1(x1 + sx * R)} ${r1(ym)}H${r1(x2 - sx * R)}Q${r1(x2)} ${r1(ym)} ${r1(x2)} ${r1(ym + dir * R)}V${r1(y2 - dir * 6)}`;
    merges.push({ d, tone: p.tone, tip: { x: x2, y: y2, dy: dir }, at: { x: (x1 + x2) / 2, y: ym } });
  }
  const bottom = rowY(shape.pipelines.length - 1) + D.row / 2 + 6;
  const bands = stages.map((_, i) => ({ x: cx(i) - widths[i]! / 2 - D.bandPad, y: 0, width: widths[i]! + 2 * D.bandPad, height: bottom }));
  const width = Math.ceil(Math.max(...bands.map((b) => b.x + b.width)) + 4);
  const rows = shape.pipelines.map((p, r) => ({ label: p.label, tone: p.tone, y: rowY(r), top: rowY(r) - D.row / 2, bottom: rowY(r) + D.row / 2 }));
  return {
    width,
    height: Math.ceil(bottom),
    gutter,
    rows,
    lines: [],
    commits: [],
    links: [],
    envs: [],
    deploys: [],
    delivery: {
      stages: stages.map((s, i) => ({ s, x: cx(i), width: widths[i]! })),
      headerHeight,
      rows: shape.pipelines.map((p, r) => ({ p, y: rowY(r) })),
      cells,
      arrows,
      merges,
      bands,
    },
  };
}

// ---------------------------------------------------------------- drawing

const r1 = (n: number) => Math.round(n * 10) / 10;

function text(x: number, cy: number, s: string, size: number, weight: number, fill: string, anchor?: 'middle' | 'end', extra = '') {
  const a = anchor ? ` text-anchor="${anchor}"` : '';
  return `<text x="${r1(x)}" y="${r1(cy + baselineOffset(size))}" font-size="${size}" font-weight="${weight}" fill="${fill}"${a}${extra}>${esc(s)}</text>`;
}

function glyph(name: string, x: number, y: number, size: number, color: string, stroke = 1.75) {
  const markup = icon(name);
  if (!markup) return '';
  const s = size / 24;
  return `<g transform="translate(${r1(x)} ${r1(y)}) scale(${s})" fill="none" stroke="${color}" stroke-width="${r1(stroke / s)}" stroke-linecap="round" stroke-linejoin="round">${markup}</g>`;
}

function rect(b: Box, rx: number, attrs: string) {
  return `<rect x="${r1(b.x)}" y="${r1(b.y)}" width="${r1(b.width)}" height="${r1(b.height)}" rx="${rx}" ${attrs}/>`;
}

/** A pill with an optional icon, centred on cx: tags, notes, gates, lane names. */
function pill(theme: Theme, cx: number, cy: number, label: string, iconName: string | undefined, fill: string, stroke: string | undefined, color: string, iconColor = color): string {
  const P = K.pill;
  const w = pillWidth(label, !!iconName);
  const x = cx - w / 2;
  let s = rect({ x, y: cy - P.h / 2, width: w, height: P.h }, tagRadius(theme, P.h), `fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1"` : ''}`);
  let tx = x + P.padX;
  if (iconName) {
    s += glyph(iconName, tx, cy - P.icon / 2, P.icon, iconColor, 1.9);
    tx += P.icon + 4;
  }
  return s + text(tx, cy, label, P.size, 600, color);
}

export function drawGitflow(shape: GitflowShape, at: Box, theme: Theme, shadowId: string): string {
  const g = gitflowGeometry(shape, theme);
  const out: string[] = [`<g transform="translate(${r1(at.x)} ${r1(at.y)})">`];
  if (g.delivery) out.push(drawDelivery(g, theme, shadowId));
  else out.push(drawBranches(g, theme));
  out.push('</g>');
  return out.join('');
}

function laneLabel(x: number, cy: number, label: string, tone: Tone, theme: Theme, iconName?: string): string {
  const t = theme.tones[tone];
  const size = K.pill.size + 0.5;
  const w = Math.ceil(measureText(label, size, 600) + 2 * K.gutter.padX + (iconName ? 16 : 0));
  let s = chipBack(theme, x, cy - K.gutter.h / 2, w, K.gutter.h, t, tagRadius(theme, K.gutter.h));
  let tx = x + K.gutter.padX;
  if (iconName) {
    s += glyph(iconName, tx - 2, cy - 6.5, 13, t.fg, 1.9);
    tx += 14;
  }
  return s + text(tx, cy, label, size, 600, t.fg);
}

function drawBranches(g: GitflowGeometry, theme: Theme): string {
  const out: string[] = [];
  const tone = (t: Tone) => theme.tones[t];
  const halo = ` stroke="${theme.canvas}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`;

  // Faint row guides, so a dot is easy to place on its lane even far from the label.
  for (const r of g.rows) out.push(`<path d="M${r1(g.gutter - 8)} ${r1(r.y)}H${r1(g.width - 8)}" stroke="${tone(r.tone).line}" stroke-width="1" stroke-dasharray="2 5" stroke-linecap="round"/>`);
  for (const e of g.envs) out.push(`<path d="M${r1(g.gutter - 8)} ${r1(e.y)}H${r1(g.width - 8)}" stroke="${tone(e.tone).line}" stroke-width="1.2" stroke-dasharray="6 5"/>`);
  if (g.envs.length) {
    const y = g.envs[0]!.y - K.env.row / 2 - 4;
    out.push(`<path d="M0 ${r1(y)}H${r1(g.width)}" stroke="${theme.border}" stroke-width="1"/>`);
  }
  for (const d of g.deploys) out.push(`<path d="M${r1(d.x)} ${r1(d.y1)}V${r1(d.y2 - K.env.marker / 2)}" stroke="${tone(d.tone).fg}" stroke-opacity="0.55" stroke-width="1.3" stroke-dasharray="1.5 3.5" stroke-linecap="round"/>`);

  for (const l of g.lines) {
    const t = tone(l.tone);
    out.push(`<path d="M${r1(l.x1)} ${r1(l.y)}H${r1(l.x2)}" stroke="${t.fg}" stroke-width="${K.line}" stroke-linecap="round"/>`);
    // A long-lived branch fades out instead of stopping, it goes on.
    if (l.keep) out.push(`<path d="M${r1(l.x2 + 6)} ${r1(l.y)}H${r1(l.x2 + 8)}M${r1(l.x2 + 14)} ${r1(l.y)}H${r1(l.x2 + 15)}" stroke="${t.fg}" stroke-width="${K.line}" stroke-linecap="round" stroke-opacity="0.5"/>`);
  }
  for (const l of g.links) {
    const t = tone(l.tone);
    const dash = l.kind === 'pick' ? ' stroke-dasharray="5 4"' : '';
    out.push(`<path d="${l.d}" fill="none" stroke="${t.fg}" stroke-width="${l.kind === 'pick' ? 1.8 : K.line}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`);
    if (l.head) {
      const { x, y, dx, dy } = l.head;
      // Perpendicular of the direction: the two wings of the head.
      const px = -dy;
      const py = dx;
      if (look(theme).line.arrow !== 'filled') out.push(arrowHead({ x, y }, { x: x - dx, y: y - dy }, t.fg, theme, 1.8));
      else out.push(`<path d="M${r1(x - dx * 7 + px * 4.5)} ${r1(y - dy * 7 + py * 4.5)}L${r1(x)} ${r1(y)}L${r1(x - dx * 7 - px * 4.5)} ${r1(y - dy * 7 - py * 4.5)}Z" fill="${t.fg}" stroke="${t.fg}" stroke-width="1" stroke-linejoin="round"/>`);
    }
  }

  for (const p of g.commits) {
    const t = tone(p.tone);
    const c = p.c;
    if (c.count) {
      const w = 2 * p.half;
      out.push(rect({ x: p.x - p.half, y: p.y - 10, width: w, height: 20 }, tagRadius(theme, 20), `fill="${t.bg}" stroke="${t.fg}" stroke-width="1.6"`));
      out.push(text(p.x, p.y, countText(c.count), K.pill.size, 600, t.fg, 'middle'));
    } else if (c.merge) out.push(`<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${K.dot}" fill="${theme.surface}" stroke="${t.fg}" stroke-width="3"/>`);
    else out.push(`<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${K.dot}" fill="${t.fg}" stroke="${theme.canvas}" stroke-width="2"/>`);
    for (const [side, pieces] of [['up', p.up], ['down', p.down]] as const) {
      let y = side === 'up' ? p.y - K.dot - 6 : p.y + K.dot + 6;
      for (const piece of pieces) {
        const h = piece.height;
        const cy = side === 'up' ? y - h / 2 : y + h / 2;
        if (piece.kind === 'tag') out.push(pill(theme, p.x, cy, piece.text, 'tag', theme.text, undefined, theme.canvas));
        else if (piece.kind === 'note') out.push(pill(theme, p.x, cy, piece.text, 'message-square', theme.tones.amber.bg, theme.tones.amber.line, theme.text, theme.tones.amber.fg));
        else if (piece.kind === 'branch') out.push(text(p.x, cy, piece.text, K.label.size, 600, t.fg, 'middle', halo));
        else for (const [k, l] of piece.lines!.entries()) out.push(text(p.x, cy - h / 2 + K.label.line * k + K.label.line / 2, l, K.label.size, 500, theme.textMuted, 'middle', halo));
        y += (side === 'up' ? -1 : 1) * (h + K.stackGap);
      }
    }
  }
  for (const d of g.deploys) out.push(`<circle cx="${r1(d.x)}" cy="${r1(d.y2)}" r="${K.env.marker / 2}" fill="${tone(d.tone).bg}" stroke="${tone(d.tone).fg}" stroke-width="1.4"/>` + glyph('rocket', d.x - 6.5, d.y2 - 6.5, 13, tone(d.tone).fg, 1.9));

  // Lane names last, on a patch of canvas so a fork's corner never runs under them.
  for (const r of g.rows) out.push(rect({ x: 0, y: r.y - K.gutter.h / 2 - 2, width: g.gutter - 12, height: K.gutter.h + 4 }, 0, `fill="${theme.canvas}"`) + laneLabel(0, r.y, r.label, r.tone, theme, 'git-branch'));
  for (const e of g.envs) out.push(laneLabel(0, e.y, e.label, e.tone, theme, 'server'));
  return out.join('');
}

function drawDelivery(g: GitflowGeometry, theme: Theme, shadowId: string): string {
  const d = g.delivery!;
  const out: string[] = [];
  const tone = (t: Tone) => theme.tones[t];
  for (const [i, b] of d.bands.entries()) {
    // A stage is a band like a group: the paper tint and contour on a paper look, its tone's wash otherwise.
    const t = tone(d.stages[i]!.s.tone);
    const line = groupLine(theme, t);
    out.push(rect(b, theme.radius.group, `fill="${groupFill(theme, 0, t)}"${line ? ` stroke="${line}" stroke-width="1"` : ''}`));
  }
  for (const r of d.rows) out.push(`<path d="M${r1(g.gutter - 8)} ${r1(r.y)}H${r1(g.width - 4)}" stroke="${theme.border}" stroke-width="1" stroke-dasharray="2 5" stroke-linecap="round"/>`);
  // Stage headers: icon tile and name at the top of each band.
  for (const st of d.stages) {
    const t = tone(st.s.tone);
    const H = D.head;
    const w = st.width;
    const b = { x: st.x - w / 2, y: 8, width: w, height: H.h - 12 };
    out.push(rect(b, theme.radius.card, `fill="${theme.surface}" stroke="${cardStroke(theme, t)}" stroke-width="${theme.stroke.card}"${shadowAttr(theme, shadowId)}`));
    const tw = measureText(st.s.label, theme.size.label, 600);
    const x = st.x - (H.tile + H.gap + tw) / 2;
    const cy = b.y + b.height / 2;
    out.push(iconTile(theme, { x, y: cy - H.tile / 2 + 2, slot: H.tile - 4, tone: t, icon: st.s.icon, rx: Math.min(7, theme.radius.tile), iconSize: look(theme).tile === 'bare' ? 19 : look(theme).tile === 'disc' || look(theme).tile === 'ring' ? 14 : 15 }));
    out.push(text(x + H.tile + H.gap - 4, cy, st.s.label, theme.size.label, 600, theme.text));
  }
  for (const a of d.arrows) {
    const t = tone(a.tone);
    const end = a.x2 - 3;
    if (a.gate) {
      const gb = a.gate.box;
      out.push(`<path d="M${r1(a.x1 + 2)} ${r1(a.y)}H${r1(gb.x)}M${r1(gb.x + gb.width)} ${r1(a.y)}H${r1(end - 6)}" stroke="${t.fg}" stroke-width="1.8" stroke-linecap="round"/>`);
    } else out.push(`<path d="M${r1(a.x1 + 2)} ${r1(a.y)}H${r1(end - 6)}" stroke="${t.fg}" stroke-width="1.8" stroke-linecap="round"/>`);
    if (look(theme).line.arrow !== 'filled') out.push(arrowHead({ x: end, y: a.y }, { x: end - 1, y: a.y }, t.fg, theme, 1.8));
    else out.push(`<path d="M${r1(end - 8)} ${r1(a.y - 4.5)}L${r1(end)} ${r1(a.y)}L${r1(end - 8)} ${r1(a.y + 4.5)}Z" fill="${t.fg}" stroke="${t.fg}" stroke-width="1" stroke-linejoin="round"/>`);
    if (a.gate) {
      const gb = a.gate.box;
      out.push(pill(theme, gb.x + gb.width / 2, a.y, a.gate.label, 'shield-check', theme.tones.amber.bg, theme.tones.amber.line, theme.text, theme.tones.amber.fg));
    }
  }
  for (const m of d.merges) {
    const t = tone(m.tone);
    out.push(`<path d="${m.d}" fill="none" stroke="${t.fg}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`);
    out.push(arrowHead({ x: m.tip.x, y: m.tip.y }, { x: m.tip.x, y: m.tip.y - m.tip.dy }, t.fg, theme, 1.8));
    out.push(pill(theme, m.at.x, m.at.y, 'merge', 'git-merge', theme.canvas, t.line, theme.text, t.fg));
  }
  for (const c of d.cells) {
    const t = tone(c.tone);
    out.push(rect(c.box, Math.min(10, theme.radius.card + 2), `fill="${theme.surface}" stroke="${t.line}" stroke-width="1.2"`));
    const tw = measureText(c.label, theme.size.caption, 600);
    const x = c.box.x + c.box.width / 2 - (D.cell.icon + 6 + tw) / 2;
    const cy = c.box.y + c.box.height / 2;
    out.push(glyph(c.icon, x, cy - D.cell.icon / 2, D.cell.icon, t.fg, 1.9));
    out.push(text(x + D.cell.icon + 6, cy, fitText(c.label, theme.size.caption, 600, c.box.width - 2 * D.cell.padX - D.cell.icon - 6), theme.size.caption, 600, theme.text));
  }
  for (const r of d.rows) out.push(laneLabel(0, r.y, r.p.label, r.p.tone, theme, 'git-branch'));
  return out.join('');
}

// Stability lab: how much of a drawing moves when one line or one element is added to it.
// Every example (and each of its views) gets a handful of such edits, made the way the builder
// makes them; each is drawn twice, once from scratch and once knowing the drawing before the edit.
//   pnpm stability            the table
//   pnpm stability --json     the same as JSON
//   pnpm stability network    only the examples with "network" in their path; --trials lists every edit
// stability.test.ts keeps the result under the limit.
import fs from 'node:fs';
import path from 'node:path';
import type { DiagramType, LayoutMemory, Point } from '@linework/core';
import { measure, score } from '@linework/layout';
import { addEntry, connectEntries } from '../../web/src/builder.ts';
import { render, type RenderResult } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../..');

/** A node this far from where it was (after the drawing as a whole is slid back) counts as moved. */
export const THRESHOLD = 16;
const EDGE_EDITS = 6;
const NODE_EDITS = 4;

export interface Trial {
  kind: 'edge' | 'node';
  what: string;
  /** Share of the nodes that were already there that moved: drawn from scratch, and drawn knowing the drawing before. */
  fresh: number;
  kept: number;
  /** Quality (lower is better) of both drawings, to see what staying put costs. */
  freshScore: number;
  keptScore: number;
}

export interface Row {
  drawing: string;
  nodes: number;
  trials: Trial[];
}

export function exampleFiles(): string[] {
  return fs
    .readdirSync(path.join(root, 'examples'))
    .flatMap((d) => fs.readdirSync(path.join(root, 'examples', d)).filter((f) => f.endsWith('.yaml')).map((f) => path.join('examples', d, f)))
    .sort();
}

/** Small seeded generator, so the lab makes the same edits every run. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2 : 0;
};

/** Share of the nodes in both drawings that moved more than the threshold, the common slide taken out. */
export function moved(before: Map<string, Point>, after: Map<string, Point>): number {
  const d = [...before].filter(([id]) => after.has(id)).map(([id, p]) => ({ x: after.get(id)!.x - p.x, y: after.get(id)!.y - p.y }));
  if (!d.length) return 0;
  const mx = median(d.map((p) => p.x));
  const my = median(d.map((p) => p.y));
  return d.filter((p) => Math.hypot(p.x - mx, p.y - my) > THRESHOLD).length / d.length;
}

const quality = (r: RenderResult) => score(measure(r.graph!, r.placed!));
const ok = (r: RenderResult) => !!r.svg && !!r.placed?.memory?.nodes && !r.diagnostics.some((d) => d.severity === 'error');

export async function lab(files = exampleFiles(), edits: { edges?: number; nodes?: number } = {}): Promise<Row[]> {
  const EDGES = edits.edges ?? EDGE_EDITS;
  const NODES = edits.nodes ?? NODE_EDITS;
  const rows: Row[] = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const load = (rel: string) => fs.readFileSync(path.resolve(root, path.dirname(file), rel), 'utf8');
    const draw = (t: string, view: string | undefined, previous: LayoutMemory | null) => render(t, { fonts: 'none', load, file: path.basename(file), view, previous });
    const first = await draw(text, undefined, null);
    // Types with a layout of their own (sequence, git flow, roadmap) place by rule: nothing to remember.
    if (!first.type || first.type.layout) continue;
    const type: DiagramType = first.type;
    const views: (string | undefined)[] = first.onlyViews ? [] : [undefined];
    for (const v of first.views ?? []) views.push(v.name);
    for (const view of views) {
      const base = view === undefined ? first : await draw(text, view, null);
      if (!ok(base)) continue;
      const was = base.placed!.memory!;
      const ids = base.graph!.nodes.filter((n) => base.placed!.nodes.has(n.id)).map((n) => n.id);
      if (ids.length < 3) continue;
      const row: Row = { drawing: file.replace(/^examples\//, '') + (view ? `#${view}` : ''), nodes: ids.length, trials: [] };
      const random = rng(row.drawing);
      const pick = <T>(list: T[]) => list[Math.floor(random() * list.length)]!;
      const joined = new Set(base.graph!.edges.flatMap((e) => [`${e.from.node}>${e.to.node}`, `${e.to.node}>${e.from.node}`]));

      const trial = async (kind: Trial['kind'], what: string, next: string, expect: (r: RenderResult) => boolean) => {
        const fresh = await draw(next, view, null);
        // An edit that does not show in this view (or does not draw) says nothing about stability.
        if (!ok(fresh) || !expect(fresh) || !ids.every((id) => fresh.placed!.nodes.has(id))) return false;
        const kept = await draw(next, view, was);
        row.trials.push({ kind, what, fresh: moved(was.nodes!, fresh.placed!.memory!.nodes!), kept: moved(was.nodes!, kept.placed!.memory!.nodes!), freshScore: quality(fresh), keptScore: quality(kept) });
        return true;
      };

      for (let tries = 0, done = 0; done < EDGES && tries < EDGES * 8; tries++) {
        const a = pick(ids);
        const b = pick(ids);
        if (a === b || joined.has(`${a}>${b}`)) continue;
        const r = connectEntries(text, type, a, b);
        if ('error' in r) continue;
        joined.add(`${a}>${b}`).add(`${b}>${a}`);
        if (await trial('edge', `${a} -> ${b}`, r.text, (f) => f.graph!.edges.length === base.graph!.edges.length + 1)) done++;
      }

      const items = type.palette.filter((i) => i.collection !== 'groups');
      for (let tries = 0, done = 0; items.length && done < NODES && tries < NODES * 6; tries++) {
        const item = pick(items);
        const near = pick(ids);
        const parentId = base.graph!.nodes.find((n) => n.id === near)?.parent;
        const gp = parentId ? base.graph!.groups.find((g) => g.id === parentId)?.path : undefined;
        const added = addEntry(text, type, item, gp && gp.length === 2 ? { collection: String(gp[0]), id: String(gp[1]) } : undefined);
        if (!added) continue;
        // A new element usually comes with a line to something that is there.
        const linked = connectEntries(added.text, type, near, added.id);
        const next = 'error' in linked ? added.text : linked.text;
        if (await trial('node', `${item.kind} by ${near}`, next, (f) => f.graph!.nodes.length === base.graph!.nodes.length + 1)) done++;
      }
      if (row.trials.length) rows.push(row);
    }
  }
  return rows;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const pct = (n: number) => `${Math.round(n * 100)}%`.padStart(4);

/** Per drawing and kind of edit: mean and worst share moved, from scratch and kept. */
export function summary(rows: Row[]) {
  return rows.map((r) => {
    const of = (kind: Trial['kind']) => {
      const t = r.trials.filter((x) => x.kind === kind);
      return { n: t.length, fresh: mean(t.map((x) => x.fresh)), kept: mean(t.map((x) => x.kept)), worstFresh: Math.max(0, ...t.map((x) => x.fresh)), worstKept: Math.max(0, ...t.map((x) => x.kept)), cost: mean(t.map((x) => x.keptScore - x.freshScore)) };
    };
    return { drawing: r.drawing, nodes: r.nodes, edge: of('edge'), node: of('node') };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const rows = await lab(exampleFiles().filter((f) => !only.length || only.some((o) => f.includes(o))));
  if (process.argv.includes('--trials'))
    for (const r of rows) for (const t of r.trials) console.log(`${r.drawing.padEnd(40)} ${t.kind.padEnd(5)} ${t.what.padEnd(44)} ${pct(t.fresh)} → ${pct(t.kept)}  score ${t.freshScore.toFixed(1)} → ${t.keptScore.toFixed(1)}`);
  if (process.argv.includes('--json')) console.log(JSON.stringify(summary(rows), null, 1));
  else {
    console.log(`${'drawing'.padEnd(40)} nodes |  add a line: from scratch → kept (worst)  cost |  add an element: from scratch → kept (worst)  cost`);
    const all = summary(rows);
    for (const s of all) {
      const col = (k: typeof s.edge) => (k.n ? `${String(k.n).padStart(2)}× ${pct(k.fresh)} (${pct(k.worstFresh)}) → ${pct(k.kept)} (${pct(k.worstKept)}) ${(k.cost >= 0 ? '+' : '') + k.cost.toFixed(1)}`.padEnd(46) : '—'.padEnd(46));
      console.log(`${s.drawing.padEnd(40)} ${String(s.nodes).padStart(5)} | ${col(s.edge)} | ${col(s.node)}`);
    }
    const total = (k: 'edge' | 'node', f: 'fresh' | 'kept') => mean(all.filter((s) => s[k].n).map((s) => s[k][f]));
    console.log(`${'mean over drawings'.padEnd(40)}       | ${pct(total('edge', 'fresh'))} → ${pct(total('edge', 'kept'))}`.padEnd(96) + `| ${pct(total('node', 'fresh'))} → ${pct(total('node', 'kept'))}`);
    const over = (k: 'edge' | 'node', f: 'fresh' | 'kept') => all.filter((s) => s[k].n && s[k][f] >= 0.1).length;
    console.log(`drawings at or over 10% moved (mean): a line ${over('edge', 'fresh')} → ${over('edge', 'kept')}, an element ${over('node', 'fresh')} → ${over('node', 'kept')} of ${all.length}`);
  }
}

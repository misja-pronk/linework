// The Mermaid sources of the comparison and the layout benchmark (docs/comparison, docs/benchmark),
// imported untouched and drawn: what someone coming from Mermaid sees first. Budgets per case, so
// what the benchmark shows cannot quietly get worse. When a change improves a case, lower its budget.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Box, Placed } from '@cartography/core';
import { render } from '@cartography/engine';
import { measure } from '@cartography/layout';
import { importMermaid } from '../src/index.ts';

const docs = path.resolve(import.meta.dirname, '../../../docs');

interface Budget {
  file: string;
  type: string;
  direction: 'right' | 'down';
  crossings: number;
  /** Width over height of the drawing, at most. */
  aspect: number;
  /** The benchmark's edit: one shape and one line. */
  edit: string;
  /** Mean shift of the shapes that were there, as a share of the diagonal, drawn from scratch after the edit. */
  moved: number;
}

const cases: Budget[] = [
  { file: 'comparison/src/microservices.mmd', type: 'systems', direction: 'right', crossings: 0, aspect: 3.5, edit: 'orders --> audit[Audit log]', moved: 0.02 },
  { file: 'comparison/src/data-platform.mmd', type: 'systems', direction: 'down', crossings: 0, aspect: 1, edit: 'wh --> reverse[Reverse ETL]', moved: 0.05 },
  { file: 'comparison/src/leave-request.mmd', type: 'process', direction: 'right', crossings: 0, aspect: 3.2, edit: 'done --> payroll[Tell payroll]', moved: 0.01 },
  { file: 'comparison/src/login-flow.mmd', type: 'process', direction: 'down', crossings: 0, aspect: 0.9, edit: 'home --> logout[Sign out]', moved: 0.01 },
  // Still very wide: a chain left to right with long labels, and the shared layout does not cut a chain into rows.
  { file: 'comparison/src/order-states.mmd', type: 'states', direction: 'right', crossings: 0, aspect: 9.5, edit: 'Delivered --> Returned: customer returns', moved: 0.02 },
  // A dense mesh of lines back and forth: dot left to right does not untangle it (Mermaid gets 2).
  { file: 'benchmark/src/event-mesh.mmd', type: 'systems', direction: 'right', crossings: 6, aspect: 4.2, edit: 'stockTopic --> forecast[Demand forecast]', moved: 0.21 },
  // Redrawn from scratch after the edit, dot orders the nested groups differently (the editor keeps the drawing before).
  { file: 'benchmark/src/cloud-platform.mmd', type: 'systems', direction: 'down', crossings: 4, aspect: 1.3, edit: 'api --> search[(Search index)]', moved: 0.3 }, // wrapped into two columns for a slide (its text was too small): wider, at a crossing more; drawn afresh after the edit, it is cut differently
  // A decision flowchart of plain steps: a process, wrapped into two rows that read on.
  { file: 'benchmark/src/ci-pipeline.mmd', type: 'process', direction: 'right', crossings: 0, aspect: 2.1, edit: 'smoke --> notify[Notify the team]', moved: 0.01 },
];

/** Line labels over a shape or its name beside it, or over another line label. */
function labelHits(p: Placed): number {
  const hit = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
  const union = (a: Box, b?: Box): Box => {
    if (!b) return a;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
  };
  const shapes = [...p.nodes].map(([id, b]) => union(b, p.labels?.get(id)));
  const labels = [...p.edges.values()].flatMap((e) => (e.label ? [e.label] : []));
  let n = 0;
  for (const [i, l] of labels.entries()) n += shapes.filter((s) => hit(l, s)).length + labels.slice(i + 1).filter((m) => hit(l, m)).length;
  return n;
}

/** How far the shapes that were there moved, the whole drawing slid back by the mean shift first, as a share of the diagonal before. */
function moved(a: Placed, b: Placed): number {
  const centre = (x: Box) => ({ x: x.x + x.width / 2, y: x.y + x.height / 2 });
  const ids = [...a.nodes.keys()].filter((id) => b.nodes.has(id));
  const d = ids.map((id) => {
    const [p, q] = [centre(a.nodes.get(id)!), centre(b.nodes.get(id)!)];
    return { x: q.x - p.x, y: q.y - p.y };
  });
  const mx = d.reduce((s, v) => s + v.x, 0) / d.length;
  const my = d.reduce((s, v) => s + v.y, 0) / d.length;
  return d.reduce((s, v) => s + Math.hypot(v.x - mx, v.y - my), 0) / d.length / Math.hypot(a.width, a.height);
}

describe('Mermaid sources of the comparison and the benchmark', () => {
  for (const c of cases)
    it(`${path.basename(c.file)}: ${c.type}, ${c.direction}, within its budgets`, async () => {
      const mmd = fs.readFileSync(path.join(docs, c.file), 'utf8');
      const { yaml } = importMermaid(mmd);
      const doc = parse(yaml);
      // The way the source runs is written down, so no edit can turn the drawing.
      expect(doc).toMatchObject({ type: c.type, direction: c.direction });
      const r = await render(yaml, { fonts: 'none' });
      expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const p = r.placed!;
      const m = measure(r.graph!, p);
      expect(m.crossings, 'crossings').toBeLessThanOrEqual(c.crossings);
      expect(m.edgeThroughNode, 'lines through shapes').toBe(0);
      expect(labelHits(p), 'line labels on shapes, names or each other').toBe(0);
      expect(p.width / p.height, 'aspect').toBeLessThanOrEqual(c.aspect);
      const edited = importMermaid(`${mmd.trimEnd()}\n    ${c.edit}\n`).yaml;
      expect(parse(edited).direction).toBe(c.direction);
      const after = await render(edited, { fonts: 'none', previous: null });
      expect(moved(p, after.placed!), 'moved after the edit').toBeLessThanOrEqual(c.moved);
    });
});

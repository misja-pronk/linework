import os from 'node:os';
import { render } from '../src/index.ts';
// A large, realistic diagram: 10 resource groups × 18 services, chained with cross links.
export function big(groups = 10, per = 18): string {
  const kinds = ['app-service', 'function-app', 'sql-database', 'storage', 'service-bus', 'key-vault'];
  let y = 'type: azure\ntitle: Large\ngroups:\n  sub: subscription\n';
  for (let g = 0; g < groups; g++) y += `  rg${g}: { kind: resource-group, in: sub }\n`;
  y += 'nodes:\n';
  for (let g = 0; g < groups; g++) for (let i = 0; i < per; i++) y += `  n${g}_${i}: { kind: ${kinds[(g + i) % kinds.length]}, in: rg${g} }\n`;
  y += 'edges:\n';
  for (let g = 0; g < groups; g++)
    for (let i = 0; i < per; i++) {
      if (i + 1 < per && i % 3 !== 2) y += `  - n${g}_${i} -> n${g}_${i + 1}\n`;
      if (i % 6 === 0 && g + 1 < groups) y += `  - n${g}_${i} -> n${g + 1}_${(i + 2) % per}: link\n`;
    }
  return y;
}
/** Milliseconds for one render, best of a few (the first run also loads Graphviz). */
export async function timed(text: string, opts: Parameters<typeof render>[1] = {}, runs = 3): Promise<{ ms: number; result: Awaited<ReturnType<typeof render>> }> {
  let best = Infinity;
  let result!: Awaited<ReturnType<typeof render>>;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    result = await render(text, { fonts: 'none', ...opts });
    best = Math.min(best, performance.now() - t);
  }
  return { ms: best, result };
}
/**
 * A time budget for this machine as busy as it is now: the budget for an idle machine, stretched by
 * how far the load is above the number of cores (the test suite runs files side by side, other work
 * shares the machine). A tight budget on a busy machine fails for the wrong reason.
 */
export function budget(ms: number): number {
  return ms * Math.max(1, os.loadavg()[0]! / os.cpus().length);
}

/** Milliseconds for two kinds of render taken in turns, best of a few each: load slows both alike. */
export async function race(a: () => Promise<unknown>, b: () => Promise<unknown>, runs = 3): Promise<[number, number]> {
  let [ta, tb] = [Infinity, Infinity];
  for (let i = 0; i < runs; i++) {
    let t = performance.now();
    await a();
    ta = Math.min(ta, performance.now() - t);
    t = performance.now();
    await b();
    tb = Math.min(tb, performance.now() - t);
  }
  return [ta, tb];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await render(big(2, 5), { fonts: 'none' });
  for (const [g, n] of [[2, 10], [5, 12], [10, 20]] as const) {
    const text = big(g, n);
    const fresh = await timed(text);
    // The same diagram one line later, drawn knowing the drawing before (what the editor and --stable do).
    const edited = text + `  - n0_1 -> n${g - 1}_${n - 1}\n`;
    const kept = await timed(edited, { previous: fresh.result.placed!.memory });
    const pinned = await timed(text, { sidecar: { version: 1, nodes: { n0_0: { x: 40, y: 40 } }, layout: { variant: fresh.result.placed!.memory!.variant } } });
    console.log(`${g * n} nodes, ${fresh.result.graph!.edges.length} edges: ${Math.round(fresh.ms)} ms from scratch, ${Math.round(kept.ms)} ms after an edit (previous drawing known), ${Math.round(pinned.ms)} ms with a pin`);
  }
}

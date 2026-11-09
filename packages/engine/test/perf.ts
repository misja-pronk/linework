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
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [g, n] of [[2, 10], [5, 12], [10, 20]] as const) {
    const t = performance.now();
    const r = await render(big(g, n), { fonts: 'none' });
    console.log(`${g * n} nodes, ${r.graph!.edges.length} edges: ${Math.round(performance.now() - t)} ms`);
  }
}

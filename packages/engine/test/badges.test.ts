import { describe, expect, it } from 'vitest';
import { chips, withoutBadges } from '@cartography/core';
import { size } from '@cartography/render';
import { themes } from '@cartography/theme';
import { render } from '../src/index.ts';

const diagram = (extra = '', edges = '') => `type: azure
nodes:
  api: { kind: container-app, label: Orders }
  db: sql-database
  kv: { kind: key-vault, label: Secrets }
  logs: { kind: app-insights, label: Telemetry }
${extra}
edges:
  - api -> db: { style: private }
  - api -> kv: { style: identity }
  - api -> logs: { style: management }
${edges}`;

describe('badges', () => {
  it('reads the diagram list and the per-edge switch, the edge winning', async () => {
    const r = await render(diagram('badges: [identity]', '  - db -> logs: { style: identity, badge: false }\n  - db -> kv: { badge: true }'));
    expect(r.diagnostics).toEqual([]);
    const badge = Object.fromEntries(r.graph!.edges.map((e) => [`${e.from.node}-${e.to.node}`, !!e.badge]));
    expect(badge).toEqual({ 'api-db': false, 'api-kv': true, 'api-logs': false, 'db-logs': false, 'db-kv': true });
  });

  it('rejects unknown styles in the list', async () => {
    const r = await render(diagram('badges: [nope]'));
    expect(r.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('keeps badged edges out of layout', async () => {
    const r = await render(diagram('badges: [identity, management]'));
    const graph = r.graph!;
    expect(graph.edges).toHaveLength(3);
    expect(withoutBadges(graph).edges.map((e) => e.to.node)).toEqual(['db']);
    expect([...r.placed!.edges.keys()]).toEqual(['e0']);
    // Sizing still sees them: the card grows to hold its chips.
    expect(size(graph, themes.light).nodes.get('api')!.height).toBeGreaterThan(themes.light.space.card.height);
  });

  it('draws a chip on the source card, sized to fit', async () => {
    const r = await render(diagram('badges: [identity, management]'), { fonts: 'none', interactive: true });
    const list = chips(r.graph!).get('api')!;
    expect(list.map((c) => c.label)).toEqual(['Secrets', 'Telemetry']);
    expect(r.svg).toContain('<title>Orders → Secrets (Identity)</title>');
    expect(r.svg).toContain('data-edge="e1"><title>');
    expect(r.svg).toContain('>Telemetry</text>');
    expect(r.svg).toContain('Reached with its managed identity');
    const api = r.placed!.nodes.get('api')!;
    const plain = r.placed!.nodes.get('kv')!;
    expect(api.height).toBeGreaterThan(plain.height);
  });

  it('stays a line when the source is a group', async () => {
    const r = await render(`type: azure
groups:
  rg: resource-group
nodes:
  kv: key-vault
edges:
  - rg -> kv: { style: identity, badge: true }
`);
    expect(r.diagnostics.map((d) => d.severity)).toEqual(['warning']);
    expect(r.graph!.edges[0]!.badge).toBeUndefined();
    expect(r.placed!.edges.has('e0')).toBe(true);
  });
});

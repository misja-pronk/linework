// Capability maps and org charts in draw.io and Excalidraw: every block a shape of its own.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { toDrawio, toExcalidraw, toScene } from '../src/index.ts';

const example = (f: string) => render(fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8'), { fonts: 'none' });

describe('blocks', () => {
  it('a capability map: a shape per capability with its name and value', async () => {
    const r = await example('capabilities/enterprise.yaml');
    const scene = toScene(r);
    expect(scene.elements.filter((e) => e.role === 'node')).toHaveLength(r.graph!.nodes.length);
    const xml = toDrawio([scene]);
    for (const word of ['Campaigns', 'Order management', 'STRATEGY']) expect(xml).toContain(word);
  });
  it('an org chart: cards and the reporting lines bound to them', async () => {
    const r = await example('teams/consultancy-team.yaml');
    const json = JSON.parse(toExcalidraw(toScene(r)));
    const text = JSON.stringify(json.elements);
    for (const word of ['Noor El Amrani', 'Engagement lead']) expect(text).toContain(word);
    expect(json.elements.some((e: { type: string; startBinding?: unknown }) => e.type === 'arrow' && e.startBinding)).toBe(true);
  });
});

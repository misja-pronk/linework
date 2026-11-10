// Capability maps, org charts and Team Topologies views on a slide: native shapes with their words
// in them, and the legend's block samples too.
import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { toPptx } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8');
const slide = async (f: string, view?: string) => {
  const r = await render(example(f), { fonts: 'none', view });
  return strFromU8(unzipSync(await toPptx(r))['ppt/slides/slide1.xml']!);
};

describe('blocks on a slide', () => {
  it('a capability map: every capability a shape with its name and its value', async () => {
    const xml = await slide('capabilities/enterprise.yaml');
    for (const word of ['Campaigns', 'Order management', 'Optimised', 'STRATEGY']) expect(xml).toContain(word);
    expect(xml.match(/<p:sp>/g)!.length).toBeGreaterThan(100);
  });
  it('an org chart: cards, initials and connectors', async () => {
    const xml = await slide('teams/consultancy-team.yaml');
    for (const word of ['Noor El Amrani', 'NA', 'Engagement lead', 'Vacancy', 'Dotted-line report']) expect(xml).toContain(word);
    expect(xml).toContain('<p:cxnSp>');
  });
  it('a Team Topologies view: teams, zones and the flow of change', async () => {
    const xml = await slide('teams/platform-org.yaml');
    for (const word of ['Payments', 'COLLABORATION', 'FLOW OF CHANGE TO CUSTOMERS', 'X-as-a-Service']) expect(xml).toContain(word);
  });
});

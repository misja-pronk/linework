// Mermaid journey → journey.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import type { JourneyShape } from '../../core/src/index.ts';
import { importMarkdown, importMermaid } from '../src/index.ts';

const working = `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 5: Me
`;

describe('journey', () => {
  it('turns sections into phases and tasks into scored steps, short where it can', async () => {
    const { yaml, warnings } = importMermaid(working);
    expect(warnings).toEqual([]);
    expect(yaml).toBe(`type: journey
title: My working day
persona: Me

phases:
  go-to-work: Go to work
  go-home: Go home

steps:
  Make tea: { in: go-to-work, feel: 5 }
  Go upstairs: 3
  Do work: { feel: 1, with: Cat }
  Go downstairs: { in: go-home, feel: 5 }
  Sit down: 5
`);
    const r = await render(yaml, { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    const shape = r.graph!.nodes[0]!.shape as JourneyShape;
    expect(shape.persona?.name).toBe('Me');
    expect(shape.phases.map((p) => p.label)).toEqual(['Go to work', 'Go home']);
    expect(shape.steps.map((s) => `${s.phase} ${s.label} ${s.score}`)).toEqual(['go-to-work Make tea 5', 'go-to-work Go upstairs 3', 'go-to-work Do work 1', 'go-home Go downstairs 5', 'go-home Sit down 5']);
    expect(shape.steps[2]!.actors).toEqual(['Cat']);
    expect(shape.scale).toEqual({ min: 1, max: 5 });
  });

  it('keeps tasks of the same name apart and names with a colon whole', async () => {
    const { yaml } = importMermaid('journey\n  Wait: 2: Sam\n  Wait: 1: Sam\n  Step 3: retry: 4: Sam\n');
    const doc = parse(yaml);
    expect(Object.keys(doc.steps)).toEqual(['Wait', 'wait-2', 'Step 3: retry']);
    expect(doc.steps['wait-2']).toEqual({ label: 'Wait', feel: 1 });
    expect(doc.steps['Step 3: retry']).toBe(4);
    expect((await render(yaml, { fonts: 'none' })).diagnostics).toEqual([]);
  });

  it('says who it took as the persona when tasks have different people', () => {
    const { yaml, warnings } = importMermaid('journey\n  section Buy\n    Order: 4: Customer\n    Pick: 3: Warehouse\n    Receive: 5: Customer, Courier\n');
    expect(parse(yaml).persona).toBe('Customer');
    expect(parse(yaml).steps.Pick).toEqual({ feel: 3, with: 'Warehouse' });
    expect(warnings).toEqual(['"Customer" is taken as the persona; steps without them keep the others under with:']);
  });

  it('is found in a Markdown file', () => {
    const blocks = importMarkdown(`# Notes\n\n## Tea\n\n\`\`\`mermaid\njourney\n  Make tea: 5: Me\n\`\`\`\n`);
    expect(blocks).toHaveLength(1);
    expect(parse(blocks[0]!.yaml)).toEqual({ type: 'journey', title: 'Tea', persona: 'Me', steps: { 'Make tea': 5 } });
  });
});

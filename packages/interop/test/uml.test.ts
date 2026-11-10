// Class diagrams and mind maps in draw.io, Excalidraw and Mermaid.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { toDrawio, toExcalidraw, toMermaid, toScene } from '../src/index.ts';

const example = (f: string) => render(fs.readFileSync(new URL(`../../../examples/${f}`, import.meta.url), 'utf8'), { fonts: 'none' });

describe('class diagrams', () => {
  it('draw.io: rows with their visibility, UML ends as draw.io ends', async () => {
    const xml = toDrawio([toScene(await example('class/strategy.yaml'))]);
    for (const word of ['ShippingCost', 'cost(parcel: Parcel)', '«interface»']) expect(xml).toContain(word);
    expect(xml).toMatch(/startArrow=block;startFill=0/);
    expect(xml).toMatch(/startArrow=diamond;startFill=0/);
  });
  it('Excalidraw: outlined triangle and diamond heads', async () => {
    const text = toExcalidraw(toScene(await example('class/domain-model.yaml')));
    expect(text).toContain('triangle_outline');
    expect(text).toContain('"diamond"');
  });
  it('Mermaid: a classDiagram with namespaces, stereotypes, members and relations', async () => {
    const m = toMermaid(await example('class/domain-model.yaml'));
    expect(m.kind).toBe('classDiagram');
    for (const line of ['  namespace catalogue {', '      <<abstract>>', '      +loanPeriod()* Days', '      +MAX_LOANS: Int = 5$', '  Item <|-- Book', '  Item "1" *-- "1..*" Copy', '  Member "1" -- "0..5" Loan : borrows']) expect(m.text.split('\n')).toContain(line);
  });
});

describe('mind maps', () => {
  it('Mermaid: one indent per level from the root', async () => {
    const m = toMermaid(await example('mindmap/workshop-agenda.yaml'));
    expect(m.kind).toBe('mindmap');
    expect(m.text).toContain('  root((Platform strategy))\n    Where we stand\n      Survey results\n');
  });
  it('draw.io: a shape per topic, the branches as lines', async () => {
    const r = await example('mindmap/capability-brainstorm.yaml');
    const xml = toDrawio([toScene(r)]);
    for (const word of ['Data platform', 'Lakehouse tables']) expect(xml).toContain(word);
    expect((xml.match(/edge="1"/g) ?? []).length).toBe(r.graph!.edges.length);
  });
});

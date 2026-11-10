import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importMermaid, importPlantUml } from '../src/index.ts';
import { memberFrom, relationFrom } from '../src/uml.ts';

const draws = async (yaml: string) => {
  const r = await render(yaml, { fonts: 'none' });
  return r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
};

describe('members and relations from other languages', () => {
  it('turns type-first members into name: Type, ~generics~ into <generics>, $ and * into {static} and {abstract}', () => {
    expect(memberFrom('+String owner')).toBe('+owner: String');
    expect(memberFrom('-List~int~ ids$')).toBe('-{static} ids: List<int>');
    expect(memberFrom('+deposit(amount) bool')).toBe('+deposit(amount): bool');
    expect(memberFrom('+area()* double')).toBe('+{abstract} area(): double');
    expect(memberFrom('- radius : double', false)).toBe('-radius: double');
    expect(memberFrom('+ {abstract} area() : double', false)).toBe('+{abstract} area(): double');
    expect(memberFrom('void reset()', false)).toBe('reset(): void');
  });

  it('reads relations with multiplicities, labels and PlantUML direction words', () => {
    expect(relationFrom('Customer "1" --> "*" Ticket : buys')).toEqual({ a: 'Customer', b: 'Ticket', arrow: '-->', aMult: '1', bMult: '*', label: 'buys' });
    expect(relationFrom('Circle "1" *-up- "0..*" Color : fill >')).toMatchObject({ arrow: '*--', label: 'fill' });
    expect(relationFrom('A ---|> B')).toMatchObject({ arrow: '--|>' });
    expect(relationFrom('A .[#red].> B')).toMatchObject({ arrow: '..>' });
    expect(relationFrom('nothing here')).toBeUndefined();
  });
});

describe('Mermaid classDiagram and mindmap', () => {
  it('a class diagram with members, annotations, generics, namespaces and relations', async () => {
    const r = importMermaid(`classDiagram
  direction LR
  namespace shop {
    class Order {
      <<aggregate>>
      +String id
      +total() Money
    }
    class Line
  }
  class Repo~T~
  <<interface>> Repo
  Order "1" *-- "1..*" Line : lines
  SqlRepo ..|> Repo
  note for Order "the root"
`);
    const d = parse(r.yaml);
    expect(d).toMatchObject({ type: 'class', direction: 'right', packages: { shop: 'shop' } });
    expect(d.classes.Order).toEqual({ stereotype: 'aggregate', package: 'shop', members: [{ '+id': 'String' }, '+total(): Money'] });
    expect(d.classes.Repo).toEqual({ kind: 'interface', generic: 'T' });
    expect(d.relations).toEqual([{ 'Order "1" *-- "1..*" Line': 'lines' }, 'SqlRepo ..|> Repo']);
    expect(r.warnings.join('\n')).toMatch(/Notes/);
    expect(await draws(r.yaml)).toEqual([]);
  });

  it('a mind map from its indents, shapes taken off, icons named in a warning', async () => {
    const r = importMermaid('mindmap\n  root((Launch))\n    Market\n      ::icon(fa fa-book)\n      Pricing\n      id1[Channels]\n    Product\n      Beta{{Private beta}}\n');
    expect(parse(r.yaml)).toEqual({ type: 'mindmap', title: 'Launch', center: 'Launch', topics: { Market: ['Pricing', 'Channels'], Product: ['Private beta'] } });
    expect(r.warnings.join('\n')).toMatch(/icon/);
    expect(await draws(r.yaml)).toEqual([]);
  });
});

describe('PlantUML class and mindmap', () => {
  it('classes, abstract and interface, enums, packages, extends and implements', async () => {
    const [r] = importPlantUml(`@startuml
title Shapes
package geometry {
  abstract class Shape <<entity>> {
    - String name
    + {abstract} area() : double
    --
    + getName() : String
  }
  interface Drawable
  class Circle extends Shape implements Drawable {
    - radius : double
  }
  enum Color {
    RED
    GREEN
  }
}
class "Paint canvas" as Canvas
Circle "1" *-up- "0..*" Color : fill >
Canvas ..> Drawable
@enduml`);
    const d = parse(r!.yaml);
    expect(d.title).toBe('Shapes');
    expect(d.classes.Shape).toEqual({ kind: 'abstract', stereotype: 'entity', package: 'geometry', members: [{ '-name': 'String' }, '+{abstract} area(): double', '+getName(): String'] });
    expect(d.classes.Color).toEqual({ kind: 'enum', package: 'geometry', values: ['RED', 'GREEN'] });
    expect(d.classes.Canvas).toEqual({ label: 'Paint canvas' });
    expect(d.relations).toEqual(['Circle --|> Shape', 'Circle ..|> Drawable', { 'Circle "1" *-- "0..*" Color': 'fill' }, 'Canvas ..> Drawable']);
    expect(await draws(r!.yaml)).toEqual([]);
  });

  it('@startmindmap with sides, boxless and multi-line topics', async () => {
    const [r] = importPlantUml('@startmindmap\ntitle Release plan\n* Release 3\n** Features\n*** Search\n++ Quality\n+++ Tests\nleft side\n** Risks\n***_ Holidays\n-- :Budget\nreview in May;\n@endmindmap');
    expect(parse(r!.yaml)).toEqual({
      type: 'mindmap',
      title: 'Release plan',
      center: 'Release 3',
      topics: { Features: { side: 'right', topics: ['Search'] }, Quality: { side: 'right', topics: ['Tests'] }, Risks: { side: 'left', topics: ['Holidays'] }, 'Budget review in May': { side: 'left' } },
    });
    expect(await draws(r!.yaml)).toEqual([]);
  });
});

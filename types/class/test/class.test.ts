import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { TableShape } from '@cartography/core';
import { render } from '../../../packages/engine/src/index.ts';
import { classDiagram, memberLine, parseMember, parseRelationLine, type ClassSource } from '../src/index.ts';

const example = (f: string) => fs.readFileSync(new URL(`../../../examples/class/${f}`, import.meta.url), 'utf8');
const messages = (r: Awaited<ReturnType<typeof render>>, severity = 'error') => r.diagnostics.filter((d) => d.severity === severity).map((d) => d.message);
const table = (r: Awaited<ReturnType<typeof render>>, id: string) => r.graph!.nodes.find((n) => n.id === id)!.shape as TableShape;

describe('class members', () => {
  it('reads visibility, types, parameters, static and abstract, written the short ways', () => {
    expect(parseMember('+name: String')).toEqual({ visibility: '+', name: 'name', type: 'String' });
    expect(parseMember({ '-count': 'Int = 0' })).toEqual({ visibility: '-', name: 'count', type: 'Int', value: '0' });
    expect(parseMember('+total(): Money')).toEqual({ visibility: '+', name: 'total', params: '', type: 'Money' });
    expect(parseMember('+addLine(product: ProductId, qty: Int): void')).toEqual({ visibility: '+', name: 'addLine', params: 'product: ProductId, qty: Int', type: 'void' });
    expect(parseMember('+{static} of(amount: Decimal): Money')).toMatchObject({ static: true, name: 'of' });
    expect(parseMember('#{abstract} area(): Double')).toMatchObject({ visibility: '#', abstract: true, name: 'area' });
    expect(parseMember('+area()* Double')).toMatchObject({ abstract: true, type: 'Double' });
    expect(parseMember('+MAX$')).toMatchObject({ static: true, name: 'MAX' });
    expect(parseMember('id')).toEqual({ name: 'id' });
    expect(parseMember('')).toBeUndefined();
    for (const s of ['+name: String', '-count: Int = 0', '+{static} of(amount: Decimal): Money']) expect(memberLine(parseMember(s)!)).toBe(s);
  });

  it('reads relations with their ends, multiplicities and label', () => {
    expect(parseRelationLine('Car --|> Vehicle')).toMatchObject({ a: 'Car', b: 'Vehicle', kind: 'generalization', bEnd: 'triangle', dashed: false });
    expect(parseRelationLine('Repo ..|> Port')).toMatchObject({ kind: 'realization', dashed: true });
    expect(parseRelationLine('Order "1" *-- "1..*" Line: lines')).toMatchObject({ kind: 'composition', aEnd: 'filledDiamond', aMult: '1', bMult: '1..*', label: 'lines' });
    expect(parseRelationLine('Team o-- Person')).toMatchObject({ kind: 'aggregation', aEnd: 'diamond' });
    expect(parseRelationLine('A --> B')).toMatchObject({ kind: 'association', bEnd: 'open' });
    expect(parseRelationLine('A ..> B')).toMatchObject({ kind: 'dependency', dashed: true });
    expect(parseRelationLine('Vehicle <|-- Car')).toMatchObject({ kind: 'generalization', aEnd: 'triangle' });
    expect(parseRelationLine('A -> B')).toBeUndefined();
    expect(parseRelationLine('just words')).toBeUndefined();
  });
});

describe('class diagram', () => {
  it('draws compartments: values or attributes, a rule, operations; stereotypes in guillemets', async () => {
    const r = await render(classDiagram.template, { fonts: 'none' });
    expect(messages(r)).toEqual([]);
    const order = table(r, 'Order');
    expect(order).toMatchObject({ form: 'class', title: 'Order', caption: '«aggregate root»' });
    expect(order.rows.map((x) => (x.kind === 'section' ? '—' : `${x.sign ?? ''}${x.cells[0]!.text}`))).toEqual(['-id', '-status', '-placedAt', '—', '+addLine(product: ProductId, quantity: Int)', '+place()', '+total()']);
    expect(table(r, 'OrderStatus').caption).toBe('«enumeration»');
    expect(table(r, 'OrderRepository').caption).toBe('«interface»');
    expect(r.width! > 0 && r.height! > 0).toBe(true);
  });

  it('puts parents above their children and draws UML ends', async () => {
    const r = await render(example('strategy.yaml'), { fonts: 'none' });
    expect(messages(r)).toEqual([]);
    const at = (id: string) => r.placed!.nodes.get(id)!;
    for (const c of ['FlatRate', 'ByWeight', 'FreeAbove']) expect(at(c).y).toBeGreaterThan(at('ShippingCost').y + at('ShippingCost').height);
    const real = r.graph!.edges.filter((e) => e.kind === 'realization');
    expect(real.map((e) => [e.from.node, e.start, e.line])).toEqual([['ShippingCost', 'triangle', 'dashed'], ['ShippingCost', 'triangle', 'dashed'], ['ShippingCost', 'triangle', 'dashed']]);
    expect(r.graph!.edges.find((e) => e.kind === 'aggregation')).toMatchObject({ from: { node: 'Checkout' }, start: 'diamond', end: 'open' });
    expect(r.graph!.legend!.map((l) => l.label)).toEqual(['Implements', 'Aggregates (shares)', 'Depends on']);
    expect(r.svg).toContain('«interface»');
  });

  it('checks: unknown classes, inheritance cycles, members written twice, the wrong word for an interface', async () => {
    const src = `type: class
classes:
  A: { extends: B }
  B: { extends: A, members: [+x: Int, +x: Int, +f(a: Int), +f(b: String)] }
  I: interface
  C: { extends: I, implements: A }
relations:
  - A --> Nowhere
  - nonsense
`;
    const r = await render(src, { fonts: 'none' });
    expect(messages(r)).toEqual(expect.arrayContaining(['There is no class "Nowhere"', 'B cannot extend A: A already comes from B', expect.stringMatching(/^A relation is/)]));
    expect(messages(r, 'warning')).toEqual(expect.arrayContaining(['"x" is in B twice', 'I is an interface: a class implements it (..|>)', 'A is not an interface: a class extends it (--|>), it does not implement it']));
    // Overloads are fine.
    expect(messages(r, 'warning').filter((m) => m.includes('"f"'))).toEqual([]);
  });

  it('follows references for renames: relations, extends, packages', () => {
    const src: ClassSource = { type: 'class', packages: { p: null }, classes: { A: { package: 'p' }, B: { extends: 'A' } }, relations: ['A "1" *-- B', { 'B --> A': 'uses' }] };
    const refs = classDiagram.references!(src);
    expect(refs.map((r) => [r.path.join('.'), r.id, r.start, !!r.key])).toEqual([
      ['classes.A.package', 'p', 0, false],
      ['classes.B.extends', 'A', 0, false],
      ['relations.0', 'A', 0, false],
      ['relations.0', 'B', 10, false],
      ['relations.1', 'B', 0, true],
      ['relations.1', 'A', 6, true],
    ]);
    expect(classDiagram.connect!(src, 'A', 'B')).toEqual({ path: ['relations'], value: 'A --> B' });
  });

  it('draws every example without errors', async () => {
    for (const f of fs.readdirSync(new URL('../../../examples/class/', import.meta.url))) {
      const r = await render(example(f), { fonts: 'none' });
      expect(messages(r), f).toEqual([]);
    }
  });
});

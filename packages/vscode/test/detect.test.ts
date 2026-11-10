import { describe, expect, it } from 'vitest';
import { isDiagram, sidecarName, typeLine } from '../src/detect.ts';
import { typeIds, typeChoices } from '../src/types.ts';

describe('which files are diagrams', () => {
  it('reads the top-level type line', () => {
    expect(typeLine('title: x\ntype: erd # tables\n')).toBe('erd');
    expect(typeLine("type: 'c4'\n")).toBe('c4');
    expect(typeLine('nodes:\n  type: erd\n')).toBeUndefined();
  });

  it('knows a diagram by its name or its type', () => {
    const ids = typeIds();
    expect(isDiagram('/a/b.carto.yaml', 'whatever: 1', ids)).toBe(true);
    expect(isDiagram('/a/b.yaml', 'type: systems\n', ids)).toBe(true);
    expect(isDiagram('/a/b.yml', 'type: model\n', ids)).toBe(true);
    expect(isDiagram('/a/b.yaml', 'type: object\nproperties: {}\n', ids)).toBe(false);
    expect(isDiagram('/a/b.json', 'type: systems\n', ids)).toBe(false);
    expect(isDiagram('untitled:Untitled-1', 'type: erd\n', ids)).toBe(true);
  });

  it('names the sidecar as the CLI does', () => {
    expect(sidecarName('/x/shop.yaml')).toBe('/x/shop.layout.json');
    expect(sidecarName('/x/shop.carto.yml')).toBe('/x/shop.carto.layout.json');
  });

  it('offers every type with when to pick it, best matches first', () => {
    const all = typeChoices();
    expect(all.length).toBe(typeIds().length);
    expect(all.every((c) => c.template.startsWith('type:') || c.template.includes('\ntype:'))).toBe(true);
    expect(all.find((c) => c.id === 'erd')!.detail).toMatch(/Use when/);
    expect(typeChoices('who has access')[0]!.id).toBe('access');
  });
});

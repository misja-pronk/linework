import { describe, expect, it } from 'vitest';
import { pinned, splitFonts } from '../src/draw.ts';

describe('drag to pin', () => {
  it('pins a node at the top level without a view, keeping the views', () => {
    const before = { version: 1 as const, nodes: { a: { x: 1, y: 2 } }, views: { ops: { nodes: { b: { x: 3, y: 4 } } } } };
    expect(pinned(before, undefined, 'c', { x: 5, y: 6 })).toEqual({ version: 1, nodes: { a: { x: 1, y: 2 }, c: { x: 5, y: 6 } }, views: { ops: { nodes: { b: { x: 3, y: 4 } } } } });
  });

  it('pins in the view drawn, leaving the top level alone', () => {
    const before = { version: 1 as const, nodes: { a: { x: 1, y: 2 } } };
    expect(pinned(before, 'ops', 'b', { x: 3, y: 4 })).toEqual({ version: 1, nodes: { a: { x: 1, y: 2 } }, views: { ops: { nodes: { b: { x: 3, y: 4 } } } } });
  });

  it('lets a pin go, and its lock; nothing left is no sidecar', () => {
    const before = { version: 1 as const, nodes: { a: { x: 1, y: 2 } }, locked: ['a'] };
    expect(pinned(before, undefined, 'a', undefined)).toBeUndefined();
    expect(pinned(undefined, undefined, 'a', undefined)).toBeUndefined();
  });

  it('keeps the edges bent by hand', () => {
    const before = { version: 1 as const, edges: { e0: { via: [{ x: 1, y: 1 }] } } };
    expect(pinned(before, undefined, 'a', { x: 0, y: 0 })).toEqual({ version: 1, nodes: { a: { x: 0, y: 0 } }, edges: { e0: { via: [{ x: 1, y: 1 }] } } });
  });
});

describe('fonts apart', () => {
  it('takes the font faces out of the SVG', () => {
    const r = splitFonts('<svg><defs><style>@font-face{font-family:X}</style></defs></svg>');
    expect(r).toEqual({ svg: '<svg><defs></defs></svg>', css: '@font-face{font-family:X}' });
    expect(splitFonts('<svg/>')).toEqual({ svg: '<svg/>', css: '' });
  });
});

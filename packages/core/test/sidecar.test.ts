import { describe, expect, it } from 'vitest';
import { decodeShare, encodeShare, parseSidecar, SHARE_UNPACKED_LIMIT } from '../src/index.ts';

describe('parseSidecar', () => {
  it('keeps a good sidecar as it is', () => {
    const side = { version: 1, nodes: { api: { x: 10, y: 20 } }, groups: { g: { x: 0, y: 0 } }, edges: { e1: { via: [{ x: 1, y: 2 }], from: 'a', to: 'b' } }, locked: ['api'], layout: { variant: 'down/out/ca' }, views: { ops: { nodes: { db: { x: 5, y: 6 } } } } };
    expect(parseSidecar(side)).toEqual({ sidecar: side, warnings: [] });
  });

  it('drops what cannot be read, says so, and keeps the rest', () => {
    const r = parseSidecar({ nodes: { meters: 'zz', api: { x: 1, y: 2 }, nan: { x: 1, y: null } }, edges: { e1: { via: 'no' }, e2: { via: [{ x: 3, y: 4 }] } }, views: { a: 7, b: { groups: { g: { x: 1 } } } } });
    expect(r.sidecar).toEqual({ version: 1, nodes: { api: { x: 1, y: 2 } }, edges: { e2: { via: [{ x: 3, y: 4 }] } }, views: { b: { groups: {} } } });
    expect(r.warnings).toEqual([
      'nodes.meters: not a position {x, y}; ignored',
      'nodes.nan: not a position {x, y}; ignored',
      'edges.e1: needs "via", a list of bend points {x, y}; ignored',
      'views.a: not an object; ignored',
      'views.b.groups.g: not a position {x, y}; ignored',
    ]);
  });

  it('gives no sidecar for what is not an object', () => {
    for (const v of [null, 3, 'x', [1]]) {
      const r = parseSidecar(v);
      expect(r.sidecar).toBeUndefined();
      expect(r.warnings).toHaveLength(1);
    }
  });
});

describe('decodeShare', () => {
  it('round-trips, with only the readable part of a layout', async () => {
    const value = await encodeShare({ yaml: 'title: x', name: 'x.yaml', layout: { version: 1, nodes: { a: { x: 1, y: 2 }, b: { x: 'zz' } as never } } });
    expect(await decodeShare(value)).toEqual({ yaml: 'title: x', name: 'x.yaml', layout: { version: 1, nodes: { a: { x: 1, y: 2 } } } });
  });

  it('gives up on a link that unpacks to more than the limit', async () => {
    // A deflate bomb in small: megabytes of spaces pack into a few kB.
    const value = await encodeShare({ yaml: `title: x${' '.repeat(2 * SHARE_UNPACKED_LIMIT)}` });
    expect(value.length).toBeLessThan(10_000);
    expect(await decodeShare(value)).toBeUndefined();
    expect(await decodeShare(value, 4 * SHARE_UNPACKED_LIMIT)).toBeDefined();
  });
});

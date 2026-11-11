import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { drillTarget, elementAt, indexWorkspace } from '@cartography/core';
import { render } from '../src/index.ts';

const dir = path.resolve(import.meta.dirname, '../../../examples/workspace');
const bank = (): Map<string, string> => new Map(fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));

describe('workspace index', () => {
  it('knows which drawing shows each element, and as what', () => {
    const ix = indexWorkspace(bank());
    expect(ix.files.size).toBe(6);
    expect(ix.shows.get('containers.yaml#api')?.get('online.api')).toBe('online.api');
    expect(ix.shows.get('deployment.yaml')?.get('online.api')).toBe('api');
    // The same id in an access diagram and a data products map is the same thing.
    const drawn = (f: string, id: string) => [...ix.shows].some(([k, m]) => (k === f || k.startsWith(`${f}#`)) && m.has(id));
    for (const f of ['access.yaml', 'data-products.yaml', 'deployment.yaml', 'context.yaml', 'model.yaml']) expect(drawn(f, 'ledger'), f).toBe(true);
  });

  it('agrees with the engine on what a view shows', async () => {
    const files = bank();
    const ix = indexWorkspace(files);
    const load = (f: string) => files.get(f)!;
    for (const [file, view] of [['containers.yaml', 'online'], ['containers.yaml', 'api'], ['context.yaml', 'context'], ['model.yaml', 'landscape']] as const) {
      const r = await render(files.get(file)!, { load, view, file, fonts: 'none' });
      // The enterprise boundary of a landscape is a group of the drawing, not an element.
      const drawn = new Set([...r.graph!.nodes.map((n) => n.id), ...r.graph!.groups.map((g) => g.id)].filter((id) => id !== 'enterprise'));
      const thought = new Set(ix.shows.get(`${file}#${view}`)!.values());
      expect([...thought].sort(), `${file}#${view}`).toEqual([...drawn].sort());
    }
  });

  it('walks down and finds the element under a node', () => {
    const ix = indexWorkspace(bank());
    expect(drillTarget(ix, 'online', { file: 'model.yaml', view: 'landscape' })).toEqual({ file: 'context.yaml', view: 'context' });
    expect(drillTarget(ix, 'online', { file: 'context.yaml', view: 'context' })).toEqual({ file: 'containers.yaml', view: 'online' });
    expect(drillTarget(ix, 'online.api', { file: 'containers.yaml', view: 'online' })).toEqual({ file: 'containers.yaml', view: 'api' });
    expect(elementAt(ix, 'deployment.yaml', undefined, 'gateway')).toBe('payments.gateway');
    expect(elementAt(ix, 'containers.yaml', 'online', 'online.db')).toBe('online.db');
  });
});

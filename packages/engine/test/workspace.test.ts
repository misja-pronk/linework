import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { drawingsOf, drillTarget, elementAt, indexWorkspace, lineDiff, planRename, renameSidecar, searchWorkspace, Workspace } from '@cartography/core';
import { findType, render } from '../src/index.ts';

const dir = path.resolve(import.meta.dirname, '../../../examples/workspace');
const bank = (): Map<string, string> => new Map(fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
const references = (type: string, data: unknown) => findType(type)?.references?.(data as never);

describe('workspace index', () => {
  it('knows where each element is drawn and named', () => {
    const ix = indexWorkspace(bank());
    expect(ix.files.size).toBe(6);
    expect(ix.problems).toEqual([]);
    const api = drawingsOf(ix, 'online.api');
    // The view about it first, then the view about its system, then the deployment that runs it.
    expect(api.map((d) => `${d.file}#${d.view ?? ''}@${d.node}`)).toEqual(['containers.yaml#api@online.api', 'containers.yaml#online@online.api', 'deployment.yaml#@api']);
    const how = (id: string) => ix.uses.get(id)!.filter((u) => u.how !== 'shown').map((u) => `${u.file}:${u.how}`);
    expect(how('online.api')).toEqual(expect.arrayContaining(['model.yaml:defined', 'deployment.yaml:of', 'containers.yaml:view', 'model.yaml:relation']));
    // The same id in an access diagram and a data products map is the same thing.
    expect(how('ledger')).toEqual(expect.arrayContaining(['access.yaml:same-id', 'data-products.yaml:same-id', 'deployment.yaml:ref']));
    expect(drawingsOf(ix, 'ledger').map((d) => d.file)).toEqual(expect.arrayContaining(['access.yaml', 'data-products.yaml', 'deployment.yaml', 'context.yaml', 'model.yaml']));
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

  it('reads again only what changed', () => {
    const files = bank();
    const ws = new Workspace(files);
    expect(ws.index.elements.has('online.api')).toBe(true);
    expect(ws.sync(files)).toBe(0);
    files.set('model.yaml', files.get('model.yaml')!.replace('api:\n', 'backend:\n'));
    expect(ws.sync(files)).toBe(1);
    expect(ws.index.elements.has('online.backend')).toBe(true);
    // What still names the old id is now dangling, with the nearest id there is.
    const p = ws.index.problems.find((x) => x.file === 'deployment.yaml');
    expect(p?.severity).toBe('error');
    expect(p?.message).toMatch(/of: online\.api: there is no element "online\.api".*did you mean online\.app/);
    ws.update('extra.yaml', 'type: systems\ninclude: [model.yaml]\nnodes:\n  ledger:\n');
    expect(drawingsOf(ws.index, 'ledger').some((d) => d.file === 'extra.yaml')).toBe(true);
  });

  it('checks what only shows across files', () => {
    const ix = indexWorkspace([
      ['model.yaml', 'type: model\nelements:\n  shop: { kind: system, label: Shop }\n  cache: { kind: cache }\n  lonely: { kind: queue, label: Lonely queue }\nviews:\n  main: { include: [shop] }\n'],
      ['other.yaml', 'type: model\nelements:\n  cache: { kind: database }\n'],
      ['azure.yaml', 'type: azure\ninclude: [model.yaml, missing.yaml]\nnodes:\n  web: { ref: shopp, kind: app-service }\n  c: { ref: cache, kind: redis }\n'],
      ['sub/far.yaml', 'type: model\nelements:\n  cache: { kind: queue }\n'],
    ]);
    const say = ix.problems.map((p) => `${p.file}:${p.line} ${p.severity} ${p.message}`);
    expect(say).toContain('azure.yaml:2 error include: missing.yaml is not in the folder');
    expect(say).toContain('azure.yaml:4 error ref: shopp: there is no element "shopp" in model.yaml; did you mean shop?');
    expect(say).toContain('model.yaml:4 warning "cache" is a cache here, but a database in other.yaml');
    expect(say).toContain('other.yaml:3 warning "cache" is a database here, but a cache in model.yaml');
    // In another folder and never drawn together: another model, not a conflict.
    expect(say.some((s) => s.startsWith('sub/far.yaml') && s.includes('is a queue here'))).toBe(false);
    expect(say).toContain('model.yaml:5 warning Lonely queue (lonely) is in no diagram or view');
  });
});

describe('workspace search', () => {
  const ix = indexWorkspace(bank());
  const top = (q: string, n = 1) => searchWorkspace(ix, q, n).map((h) => `${h.kind}:${h.id}`);

  it('ranks names over descriptions and elements over the rest', () => {
    expect(top('ledger')).toEqual(['element:ledger']);
    expect(top('banking api')).toEqual(['element:online.api']);
    expect(top('online.api.sig')).toEqual(['element:online.api.signin']);
    expect(top('kafka')).toEqual(['element:payments.events']);
    expect(top('team-payments')).toEqual(['element:payments']);
    expect(top('auditors')).toEqual(['entry:auditors']);
    expect(top('deployment.yaml')).toEqual(['file:deployment.yaml']);
    expect(top('components')).toEqual(['view:api']);
    // Letters in order find a name: "bnkapi" is the Banking API.
    expect(top('bnkapi')).toEqual(['element:online.api']);
    expect(top('nothing like this')).toEqual([]);
  });

  it('opens an element where it is most at home, and says where else it is', () => {
    const [hit] = searchWorkspace(ix, 'settlement engine', 1);
    expect(hit).toMatchObject({ kind: 'element', id: 'payments.engine', file: 'containers.yaml', view: 'payments', node: 'payments.engine' });
    expect(hit!.where!.map((w) => w.file)).toContain('deployment.yaml');
  });

  it('is quick on two hundred files, and quicker on one change', () => {
    const files = new Map<string, string>();
    const systems = Array.from({ length: 40 }, (_, i) => `s${i}`);
    files.set(
      'model.yaml',
      `type: model\nelements:\n${systems.map((s) => `  ${s}:\n    kind: system\n    label: System ${s}\n    elements:\n${Array.from({ length: 5 }, (_, j) => `      c${j}: { kind: container, label: Part ${j} of ${s}, technology: Go }`).join('\n')}`).join('\n')}\nrelations:\n${systems.slice(1).map((s, i) => `  - ${systems[i]}.c0 -> ${s}.c1: Calls`).join('\n')}\nviews:\n${systems.map((s) => `  ${s}: { kind: container, of: ${s} }`).join('\n')}\n`,
    );
    for (let i = 0; i < 199; i++) files.set(`d/diagram-${i}.yaml`, `type: azure\ninclude: [../model.yaml]\nnodes:\n${Array.from({ length: 10 }, (_, j) => `  n${j}: { of: s${(i + j) % 40}.c${j % 5}, kind: container-app }`).join('\n')}\nedges:\n  - n0 -> n1\n`);
    let t = performance.now();
    const ws = new Workspace(files);
    void ws.index;
    const full = performance.now() - t;
    files.set('d/diagram-7.yaml', files.get('d/diagram-7.yaml')! + '  - n1 -> n2\n');
    t = performance.now();
    ws.sync(files);
    void ws.index;
    const one = performance.now() - t;
    t = performance.now();
    searchWorkspace(ws.index, 'part 3 s12', 20);
    const search = performance.now() - t;
    console.log(`workspace of 200 files: index ${full.toFixed(0)} ms, after one change ${one.toFixed(0)} ms, search ${search.toFixed(1)} ms`);
    expect(ws.index.files.size).toBe(200);
    expect(full).toBeLessThan(2000);
    expect(one).toBeLessThan(full);
    expect(search).toBeLessThan(100);
  });
});

describe('rename everywhere', () => {
  it('renames an id in every file that names it, and nothing else', () => {
    const files = bank();
    const plan = planRename(indexWorkspace(files), 'ledger', 'core-ledger', { references });
    expect(plan.problem).toBeUndefined();
    const after = new Map(plan.files.map((f) => [f.file, f.after]));
    expect([...after.keys()].sort()).toEqual(['access.yaml', 'data-products.yaml', 'deployment.yaml', 'model.yaml']);
    expect(after.get('model.yaml')).toContain('  core-ledger: { kind: software-system, label: Core ledger');
    expect(after.get('model.yaml')).toContain('- desk -> core-ledger: Reads accounts');
    expect(after.get('model.yaml')).not.toMatch(/(?<![\w-])ledger (->|:)|-> ledger\b/);
    // A node with a key of its own keeps it; only its ref: changes.
    expect(after.get('deployment.yaml')).toContain('ledger: { ref: core-ledger, kind: external }');
    // An entry that is the element by its id is renamed with what refers to it in that type.
    expect(after.get('access.yaml')).toContain('core-ledger: { kind: app, label: Core ledger }');
    expect(after.get('access.yaml')).toContain('- auditors is reader on core-ledger');
    expect(after.get('data-products.yaml')).toContain('inputs: [core-ledger, { from: payments, label: events }]');
    // Comments and the rest of each file stay as they were.
    for (const f of plan.files) expect(f.after.split('\n').length).toBe(f.before.split('\n').length);
    expect(after.get('model.yaml')!.split('\n')[0]).toBe(files.get('model.yaml')!.split('\n')[0]);
  });

  it('renames the parts with their system, and the result still draws', async () => {
    const files = bank();
    files.set('access.yaml', files.get('access.yaml')!.replaceAll('digital', 'web-team'));
    const plan = planRename(indexWorkspace(files), 'online', 'digital', { references });
    expect(plan.problem).toBeUndefined();
    for (const f of plan.files) files.set(f.file, f.after);
    expect(files.get('containers.yaml')).toContain('api: { kind: component, of: digital.api');
    expect(files.get('deployment.yaml')).toContain('web: { of: digital.web');
    expect(files.get('model.yaml')).toContain('- digital.api.signin -> digital.db');
    const ix = indexWorkspace(files);
    expect(ix.problems).toEqual([]);
    expect(ix.elements.has('digital.api.signin')).toBe(true);
    const r = await render(files.get('containers.yaml')!, { load: (f) => files.get(f)!, view: 'api', file: 'containers.yaml', fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.graph!.nodes.map((n) => n.id)).toContain('digital.api.signin');
  });

  it('renames a part by its last name, with a new label', () => {
    const plan = planRename(indexWorkspace(bank()), 'online.api', 'backend', { label: 'Banking backend' });
    expect(plan.to).toBe('online.backend');
    const model = plan.files.find((f) => f.file === 'model.yaml')!.after;
    expect(model).toContain('      backend:\n        kind: container\n        label: Banking backend\n');
    expect(model).not.toContain('label: Banking API');
    expect(model).toContain('- online.web -> online.backend: { label: Calls');
    expect(model).toContain('- online.backend.signin -> online.db');
  });

  it('says why it cannot', () => {
    const ix = indexWorkspace(bank());
    expect(planRename(ix, 'nope', 'x').problem).toMatch(/no element "nope"/);
    expect(planRename(ix, 'online.api', 'payments.api').problem).toMatch(/keeps an element where it is/);
    expect(planRename(ix, 'online.api', 'db').problem).toMatch(/element "online.db" already/);
    expect(planRename(ix, 'ledger', 'bad id').problem).toMatch(/not an id/);
    // An access diagram has a principal "digital": a resource of that name would be the same node.
    expect(planRename(ix, 'online', 'digital', { references }).problem).toMatch(/access.yaml: principals has an entry "digital"/);
  });

  it('carries pins to the new ids, in every view', () => {
    const files = bank();
    files.delete('access.yaml');
    const plan = planRename(indexWorkspace(files), 'online', 'digital');
    const node = plan.files.find((f) => f.file === 'containers.yaml')!.node;
    const before = { version: 1, nodes: { online: { x: 1, y: 2 } }, views: { api: { nodes: { 'online.api.signin': { x: 3, y: 4 }, ledger: { x: 0, y: 0 } }, locked: ['online.db'], edges: { r4: { via: [], from: 'online.web', to: 'ledger' } } } } };
    const after = JSON.parse(renameSidecar(JSON.stringify(before), node)!);
    expect(Object.keys(after.nodes)).toEqual(['digital']);
    expect(Object.keys(after.views.api.nodes)).toEqual(['digital.api.signin', 'ledger']);
    expect(after.views.api.locked).toEqual(['digital.db']);
    expect(after.views.api.edges.r4).toMatchObject({ from: 'digital.web', to: 'ledger' });
    expect(renameSidecar(JSON.stringify({ version: 1, nodes: { x: {} } }), node)).toBeUndefined();
    // A node with its own key and ref: keeps its pins.
    const deploy = planRename(indexWorkspace(bank()), 'ledger', 'core-ledger').files.find((f) => f.file === 'deployment.yaml')!;
    expect(deploy.node('ledger')).toBe('ledger');
  });

  it('shows the change as a diff', () => {
    const hunks = lineDiff('a\nb\nc\nd\ne\nf\ng', 'a\nB\nc\nd\ne\nf\nG', 1);
    expect(hunks.map((h) => h.map((l) => (l.kind.trim() + l.text)).join(' '))).toEqual(['a -b +B c', 'f -g +G']);
  });
});

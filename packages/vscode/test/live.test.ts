// The live link's VS Code host against the stub: a proposal for a workspace file that is not open
// opens it (editor and preview) and shows there; a file outside the folders, or missing, is not-open.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { endpoints } from '@cartography/mcp/discovery';

vi.mock('vscode', () => import('./vscode-stub.ts'));
const stub = await import('./vscode-stub.ts');
const { activate } = await import('../src/extension.ts');

const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'carto-vscode-live-')));
const shop = 'type: systems\nnodes:\n  web: { kind: client }\n  api: { kind: api }\nedges:\n  - web -> api\n';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => T | undefined, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await wait(20);
  }
}

let call: (body: unknown) => Promise<{ result?: { outcome: string; message?: string }; error?: string }>;

beforeAll(async () => {
  stub.state.config['cartography.preview.debounce'] = 0;
  stub.workspace.workspaceFolders = [{ uri: stub.Uri.file(dir) }];
  activate({ subscriptions: [], extensionUri: stub.Uri.file('/ext') } as never);
  const e = await until(() => endpoints().find((x) => x.pid === process.pid && x.roots.includes(dir)));
  call = (body) => fetch(`${e.url}/live`, { method: 'POST', headers: { authorization: `Bearer ${e.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const addDb = [{ op: 'set', path: ['nodes', 'db'], value: { kind: 'database' } }];

describe('propose for a file that is not open', () => {
  it('opens it with its preview, shows the proposal there, and applies it on accept', async () => {
    const file = path.join(dir, 'shop.yaml');
    fs.writeFileSync(file, shop);
    expect(stub.state.documents.some((d) => d.fileName === file)).toBe(false);
    const answer = call({ method: 'propose', params: { file, summary: 'Add a database', edits: addDb } });
    const doc = await until(() => stub.state.documents.find((d) => d.fileName === file));
    expect(doc.getText()).toBe(shop);
    expect(stub.state.shown).toContain(doc);
    const panel = await until(() => stub.state.panels.find((p) => p.viewType === 'cartography.preview'));
    panel.received.fire({ type: 'ready' });
    const shown = (await until(() => panel.posted.find((m) => (m as { type: string }).type === 'proposal'))) as { summary: string; svg?: string };
    expect(shown.summary).toBe('Add a database');
    expect(shown.svg).toContain('<svg');
    panel.received.fire({ type: 'verdict', accept: true });
    expect((await answer).result).toMatchObject({ outcome: 'accepted' });
    expect(doc.getText()).toContain('db: { kind: database }');
  });

  it('says not-open for a file outside the workspace folders', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-vscode-outside-'));
    const file = path.join(outside, 'other.yaml');
    fs.writeFileSync(file, shop);
    const r = (await call({ method: 'propose', params: { file, edits: addDb } })).result;
    expect(r).toMatchObject({ outcome: 'not-open', message: expect.stringContaining('not in a folder VS Code has open') });
    expect(stub.state.documents.some((d) => d.fileName === file)).toBe(false);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('says not-open for a file that is not there', async () => {
    const file = path.join(dir, 'missing.yaml');
    const r = (await call({ method: 'propose', params: { file, edits: addDb } })).result;
    expect(r).toMatchObject({ outcome: 'not-open', message: expect.stringContaining('does not exist') });
    expect(stub.state.documents.some((d) => d.fileName === file)).toBe(false);
  });
});

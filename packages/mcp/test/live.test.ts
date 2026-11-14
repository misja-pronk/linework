// The live link from the agent's side: a host found through the discovery folder (as the VS Code
// extension announces itself), get_context and propose through it, and the protocol's checks.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkLiveCall, type LiveHost, type Proposal } from '@linework/core';
import { announce, discoveredLink, endpointFor, handleLive, proposeChange, type LiveEndpoint } from '../src/index.ts';
import { authorized } from '../src/http.ts';

const shop = `type: azure
nodes:
  web: { kind: app-service, label: Web }
  db: { kind: sql-database, label: Orders DB }
edges:
  - web -> db
`;

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linework-live-')));
const file = path.join(tmp, 'shop.yaml');
const proposed: Proposal[] = [];
const other = path.join(tmp, 'other.yaml');
const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linework-outside-')));
// As the editors do: a file of the folder is opened if it is not (here: shop.yaml is open, other.yaml
// is not), a file outside it cannot be.
const host: LiveHost = {
  context: () => ({ host: 'vscode', file, selection: [{ kind: 'node', id: 'web' }], problems: [] }),
  propose: async (p) => (p.file.startsWith(tmp + path.sep) ? (proposed.push(p), { outcome: 'accepted' }) : { outcome: 'not-open', message: `${p.file} is not in a folder VS Code has open.` }),
};
const token = 'a-token-for-the-test-only-0123456789';
let server: http.Server;
let forget: () => void;

beforeAll(async () => {
  fs.writeFileSync(file, shop);
  fs.writeFileSync(other, shop);
  fs.writeFileSync(path.join(outside, 'far.yaml'), shop);
  server = http.createServer((req, res) => (authorized(req, token) ? void handleLive(req, res, host) : res.writeHead(401).end()));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  forget = announce({ host: 'vscode', url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token, roots: [tmp] });
});
afterAll(() => {
  forget();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('the live protocol', () => {
  it('checks calls before a host sees them', () => {
    expect(checkLiveCall({ method: 'context' })).toEqual({ method: 'context' });
    expect(checkLiveCall({ method: 'rm' })).toMatchObject({ error: expect.stringContaining('Unknown method') });
    expect(checkLiveCall({ method: 'propose', params: { edits: [] } })).toMatchObject({ error: expect.stringContaining('file') });
    expect(checkLiveCall({ method: 'propose', params: { file: 'a.yaml', edits: [{ op: 'nope', path: ['x'] }] } })).toMatchObject({ error: expect.stringContaining('op must be') });
  });

  it('picks the host with the deepest folder around a path', () => {
    const e = (roots: string[], since: number): LiveEndpoint => ({ host: 'browser', url: '', token: '', roots, pid: 1, since });
    const a = e(['/w'], 1);
    const b = e(['/w/app'], 0);
    expect(endpointFor('/w/app/x.yaml', [a, b])).toBe(b);
    expect(endpointFor('/w/other.yaml', [a, b])).toBe(a);
    expect(endpointFor('/elsewhere/x.yaml', [a, b])).toBeUndefined();
  });
});

describe('a host found through discovery', () => {
  it('answers get_context', async () => {
    expect(await discoveredLink(tmp).context()).toMatchObject({ host: 'vscode', file, selection: [{ id: 'web' }] });
  });

  it('gets a proposal only when it validates', async () => {
    const link = discoveredLink(tmp);
    expect(await proposeChange(link, { file, summary: 'Rename', edits: [{ op: 'rename', path: ['nodes', 'db'], to: 'orders' }] }, tmp)).toMatchObject({ outcome: 'accepted' });
    expect(proposed.at(-1)).toMatchObject({ file, summary: 'Rename' });
    expect(await proposeChange(link, { file, edits: [{ op: 'set', path: ['nodes', 'x'], value: { kind: 'nope' } }] }, tmp)).toMatchObject({ outcome: 'invalid', problems: [expect.objectContaining({ severity: 'error' })] });
    expect(proposed).toHaveLength(1);
  });

  it('sends a proposal for a file that is not open to the host, which opens it', async () => {
    const r = await proposeChange(discoveredLink(tmp), { file: 'other.yaml', edits: [{ op: 'delete', path: ['nodes', 'db'] }] }, tmp);
    expect(r).toMatchObject({ outcome: 'accepted' });
    expect(proposed.at(-1)).toMatchObject({ file: other });
  });

  it('passes on not-open when the host cannot open the file', async () => {
    const far = path.join(outside, 'far.yaml');
    expect(await proposeChange(discoveredLink(tmp), { file: far, edits: [{ op: 'delete', path: ['nodes', 'db'] }] }, tmp)).toMatchObject({ outcome: 'not-open', message: expect.stringContaining('not in a folder') });
  });

  it('says there is no editor for a folder no host has open', async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'linework-none-'));
    fs.writeFileSync(path.join(elsewhere, 'a.yaml'), shop);
    expect(await discoveredLink(elsewhere).context()).toBeUndefined();
    expect(await proposeChange(discoveredLink(elsewhere), { file: 'a.yaml', edits: [{ op: 'delete', path: ['nodes', 'db'] }] }, elsewhere)).toMatchObject({ outcome: 'no-editor' });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
});

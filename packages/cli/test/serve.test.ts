// carto serve end to end, without a browser: a stand-in editor on the event stream answers the live
// calls, and an MCP client over HTTP calls the tools as an agent would.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToEditor } from '@cartography/core';
import { serve } from '../src/serve.ts';

const shop = `type: azure
title: Shop   # keep this comment
nodes:
  web: { kind: app-service, label: Web }
  db: { kind: sql-database, label: Orders DB }
edges:
  - web -> db: SQL
`;

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'carto-serve-')));
const root = path.join(tmp, 'folder');
const app = path.join(tmp, 'app');
const token = 'test-token-0123456789abcdefghijklmnop';
let s: Awaited<ReturnType<typeof serve>>;

beforeAll(async () => {
  fs.mkdirSync(root);
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(root, 'shop.yaml'), shop);
  fs.writeFileSync(path.join(app, 'index.html'), '<!doctype html><html><head><title>x</title></head><body></body></html>');
  s = await serve({ root, port: 0, app, token });
});
afterAll(() => {
  s.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const api = (p: string, init: RequestInit = {}) => fetch(`${s.url}${p}`, { ...init, headers: { 'x-carto-token': token, ...init.headers } });

async function agent() {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}
const text = (r: unknown) => ((r as { content: { type: string; text?: string }[] }).content.map((c) => c.text ?? '').join('\n'));

/** A browser tab, as far as the server can tell: it reads the event stream and answers calls. */
async function editor(answer: (m: Extract<ToEditor, { type: 'call' }>) => unknown) {
  const ctl = new AbortController();
  const res = await fetch(`${s.url}/api/events?token=${token}`, { signal: ctl.signal });
  const seen: ToEditor[] = [];
  const reader = res.body!.getReader();
  let buf = '';
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
      if (done) return;
      buf += new TextDecoder().decode(value);
      let at: number;
      while ((at = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (!data || block.startsWith('event: hello')) continue;
        const m = JSON.parse(data) as ToEditor;
        seen.push(m);
        if (m.type === 'call') void api('/api/reply', { method: 'POST', body: JSON.stringify({ id: m.id, result: answer(m) }) });
      }
    }
  })();
  await new Promise((r) => setTimeout(r, 100));
  return { seen, close: () => ctl.abort() };
}

describe('carto serve', () => {
  it('serves the app with the token, and only to this machine with the token', async () => {
    expect(await (await fetch(`${s.url}/`)).text()).toContain(`<meta name="carto-serve" content="${token}"`);
    expect((await fetch(`${s.url}/api/files`)).status).toBe(401);
    expect((await fetch(`${s.url}/mcp`, { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await fetch(`${s.url}/api/files`, { headers: { 'x-carto-token': token, origin: 'http://evil.example' } })).status).toBe(403);
    expect(((await (await api('/api/files')).json()) as { files: { path: string }[] }).files.map((f) => f.path)).toEqual(['shop.yaml']);
    expect((await api('/api/file?path=../app/index.html')).status).toBe(400);
  });

  it('reads and writes files of the folder', async () => {
    expect(await (await api('/api/file?path=shop.yaml')).text()).toBe(shop);
    await api('/api/file?path=docs/new.yaml', { method: 'PUT', body: 'type: systems\n' });
    expect(fs.readFileSync(path.join(root, 'docs/new.yaml'), 'utf8')).toBe('type: systems\n');
    await api('/api/file?path=docs/new.yaml', { method: 'DELETE' });
    expect(fs.existsSync(path.join(root, 'docs/new.yaml'))).toBe(false);
  });

  it('says when no editor is open', async () => {
    const c = await agent();
    expect(text(await c.callTool({ name: 'get_context', arguments: {} }))).toMatch(/No editor is connected/);
    const r = await c.callTool({ name: 'propose', arguments: { file: 'shop.yaml', edits: [{ op: 'set', path: ['nodes', 'web', 'label'], value: 'Shop' }] } });
    expect(text(r)).toMatch(/no-editor/);
    expect(text(r)).toMatch(/edit_diagram/);
    await c.close();
  });

  it('answers get_context and propose from the editor, and tells it of files changed on disk', async () => {
    const tab = await editor((m) =>
      m.call.method === 'context'
        ? { host: 'browser', file: 'shop.yaml', selection: [{ kind: 'node', id: 'db' }], problems: [] }
        : { outcome: m.call.params.file === 'shop.yaml' && m.call.params.summary === 'Rename' ? 'accepted' : 'rejected' },
    );
    const c = await agent();
    const ctx = text(await c.callTool({ name: 'get_context', arguments: {} }));
    expect(ctx).toContain(path.join(root, 'shop.yaml'));
    expect(ctx).toContain('selected: db');
    const p = await c.callTool({ name: 'propose', arguments: { file: path.join(root, 'shop.yaml'), summary: 'Rename', edits: [{ op: 'rename', path: ['nodes', 'db'], to: 'orders' }] } });
    expect(text(p)).toMatch(/Accepted/);
    // A change that does not validate never reaches the editor.
    const bad = await c.callTool({ name: 'propose', arguments: { file: 'shop.yaml', edits: [{ op: 'set', path: ['nodes', 'x'], value: { kind: 'nope' } }] } });
    expect(bad.isError).toBe(true);
    expect(tab.seen.filter((m) => m.type === 'call')).toHaveLength(2);

    const e = await c.callTool({ name: 'edit_diagram', arguments: { file: 'shop.yaml', edits: [{ op: 'set', path: ['nodes', 'web', 'label'], value: 'Storefront' }] } });
    expect(text(e)).toMatch(/^Wrote /);
    expect(fs.readFileSync(path.join(root, 'shop.yaml'), 'utf8')).toContain('title: Shop   # keep this comment');
    await expect.poll(() => tab.seen.some((m) => m.type === 'changed' && m.path === 'shop.yaml'), { timeout: 3000 }).toBe(true);
    await c.close();
    tab.close();
  });
});

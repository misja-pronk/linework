// End to end: the real server process, newline-delimited JSON-RPC over stdio, as a client sees it.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-mcp-e2e-'));
let server: ChildProcessWithoutNullStreams;
const pending = new Map<number, (msg: any) => void>();
let nextId = 1;

function request(method: string, params: object = {}): Promise<any> {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve) => pending.set(id, resolve));
}

beforeAll(async () => {
  server = spawn(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/mcp/src/main.ts')], { cwd: tmp });
  let buffer = '';
  server.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      const msg = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      pending.get(msg.id)?.(msg);
    }
  });
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  expect(init.result.serverInfo.name).toBe('cartography');
  server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
}, 30_000);

afterAll(() => {
  server?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('cartography-mcp over stdio', () => {
  it('lists its tools with input schemas', async () => {
    const { result } = await request('tools/list');
    const names = result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['describe', 'diff', 'edit_diagram', 'get_schema', 'import_mermaid', 'list_types', 'new_diagram', 'render', 'review', 'threats', 'trace', 'validate']);
    expect(result.tools.find((t: { name: string }) => t.name === 'render').inputSchema.properties).toHaveProperty('format');
  });

  it('validates', async () => {
    const { result } = await request('tools/call', { name: 'validate', arguments: { yaml: 'type: systems\nnodes:\n  a: servce\n' } });
    expect(result.content[0].text).toMatch(/^Invalid: 1 error/);
    expect(JSON.parse(result.content[1].text).problems[0]).toMatchObject({ line: 3, hint: 'Use "service" instead of "servce".' });
  });

  it('renders a PNG to a file and returns the image', async () => {
    const tpl = (await request('tools/call', { name: 'new_diagram', arguments: { type: 'systems' } })).result.content[0].text;
    const { result } = await request('tools/call', { name: 'render', arguments: { yaml: tpl, path: 'out.png' } });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/^Wrote .*out\.png/);
    const image = result.content.find((c: { type: string }) => c.type === 'image');
    expect(image.mimeType).toBe('image/png');
    expect(Buffer.from(image.data, 'base64').equals(fs.readFileSync(path.join(tmp, 'out.png')))).toBe(true);
  });

  it('reports tool errors as results, not crashes', async () => {
    const { result } = await request('tools/call', { name: 'render', arguments: { yaml: 'type: systems\n', path: '../x.svg' } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside the working directory/);
  });

  it('serves resources and the prompt', async () => {
    const list = (await request('resources/list')).result.resources.map((r: { uri: string }) => r.uri);
    expect(list).toEqual(expect.arrayContaining(['cartography://types', 'cartography://schema/erd']));
    const schema = (await request('resources/read', { uri: 'cartography://schema/erd' })).result.contents[0];
    expect(JSON.parse(schema.text)).toHaveProperty('properties.tables');
    const prompt = (await request('prompts/get', { name: 'create-diagram', arguments: { what: 'a webshop' } })).result;
    expect(prompt.messages[0].content.text).toContain('a webshop');
  });
});

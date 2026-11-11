// The MCP server over streamable HTTP, for carto serve: stateless, a fresh server per request (the
// tools keep no state between calls), and only for callers with the token. Plus the live link's
// POST /live, which the VS Code extension answers too.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { answerLive, type LiveHost } from '@cartography/core';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** The bearer token matches, in constant time. */
export function authorized(req: IncomingMessage, token: string): boolean {
  const got = Buffer.from(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Only for this machine: a page elsewhere that resolves a name to 127.0.0.1 (DNS rebinding) is turned away by its Host. */
export const localHost = (req: IncomingMessage) => /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host ?? '');

export function readBody(req: IncomingMessage, limit = 4_000_000): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        fail(new Error('Too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

export const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

/** POST /mcp: one JSON-RPC exchange. Token and Host are checked by the caller. */
export async function handleMcp(req: IncomingMessage, res: ServerResponse, make: () => McpServer): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server is stateless, use POST' }, id: null });
  const server = make();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
  }
  await transport.handleRequest(req, res, body);
}

/** POST /live: a live call for the editor this process stands for. */
export async function handleLive(req: IncomingMessage, res: ServerResponse, host: LiveHost): Promise<void> {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST' });
  let call: unknown;
  try {
    call = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: 'Not JSON' });
  }
  const out = await answerLive(host, call);
  sendJson(res, 'error' in out ? 400 : 200, out);
}

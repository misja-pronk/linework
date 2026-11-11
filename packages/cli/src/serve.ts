// carto serve [folder]: the web editor for one folder, and an MCP endpoint for the user's own AI, in
// one local process. The browser reads and writes the folder's files through it and hears when they
// change on disk; the agent's get_context and propose go to the editor that was used last.
//   GET  /                  the built web app (pnpm web:build), told the token in a <meta>
//   GET  /api/files         the folder's text files: path, size, mtime
//   GET|PUT|DELETE /api/file?path=…
//   GET  /api/events        Server-Sent Events to the editor: live calls and changed files
//   POST /api/reply         the editor's answer to a call; POST /api/active: this tab is the one in use
//   POST /mcp               MCP over streamable HTTP (Authorization: Bearer <token>)
//   POST /live              the live link for MCP servers started elsewhere (discovery.ts)
// Only 127.0.0.1, only requests with the token, and only with a Host of this machine.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { LiveCall, LiveContext, Proposal, ProposalResult, ToEditor } from '@cartography/core';
import { createServer as createMcp, type LiveLink } from '@cartography/mcp';
import { announce } from '@cartography/mcp/discovery';
import { authorized, handleLive, handleMcp, localHost, readBody, sendJson } from '@cartography/mcp/http';

/** The text files an editor opens (files.ts in the web app has the same list). */
const TEXT = /\.(ya?ml|json|md)$/i;
const SKIP = new Set(['node_modules', '.git', 'dist', '.cache', '.next', 'out']);
const MAX_FILES = 800;
const MAX_BYTES = 2_000_000;

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

export interface ServeOptions {
  root: string;
  port: number;
  /** The built web app; packages/web/dist in a clone. */
  app?: string;
  /** Lines for the person who started it. */
  log?: (line: string) => void;
  /** By default the one kept in ~/.cartography (serveToken). */
  token?: string;
}

/** One token per user, kept: `claude mcp add` once, and it works every time carto serve starts. */
export function serveToken(dir = path.join(os.homedir(), '.cartography')): string {
  const file = path.join(dir, 'serve-token');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t.length >= 32) return t;
  } catch {
    /* first time */
  }
  const t = randomBytes(24).toString('base64url');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${t}\n`, { mode: 0o600 });
  return t;
}

/** A path inside the root, from what the browser sent; undefined for anything that climbs out. */
function inRoot(root: string, rel: string | null): string | undefined {
  if (!rel || rel.includes('\0')) return undefined;
  const abs = path.resolve(root, rel);
  const r = path.relative(root, abs);
  return r && !r.startsWith('..') && !path.isAbsolute(r) ? abs : undefined;
}

function listFiles(root: string): { path: string; size: number; mtime: number }[] {
  const out: { path: string; size: number; mtime: number }[] = [];
  const walk = (dir: string, prefix: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.isDirectory()) {
        if (depth < 6 && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), `${prefix}${e.name}/`, depth + 1);
      } else if (e.isFile() && (TEXT.test(e.name) || e.name === '.adr-dir')) {
        const s = fs.statSync(path.join(dir, e.name));
        if (s.size <= MAX_BYTES) out.push({ path: prefix + e.name, size: s.size, mtime: s.mtimeMs });
      }
    }
  };
  walk(root, '', 0);
  return out;
}

interface Editor {
  id: number;
  res: http.ServerResponse;
}

/** The browser tabs connected, and the calls waiting for their answer. */
class Editors {
  private list: Editor[] = [];
  private next = 1;
  private calls = 1;
  private pending = new Map<number, { editor: number; done(v: { result?: unknown; error?: string }): void }>();

  add(res: http.ServerResponse): Editor {
    const e = { id: this.next++, res };
    this.list.push(e);
    res.on('close', () => {
      this.list = this.list.filter((x) => x !== e);
      for (const [id, p] of this.pending) if (p.editor === e.id) (this.pending.delete(id), p.done({ error: 'closed' }));
    });
    return e;
  }

  /** The tab in use last goes to the end of the list. */
  active(id: number) {
    const e = this.list.find((x) => x.id === id);
    if (e) this.list = [...this.list.filter((x) => x !== e), e];
  }

  send(m: ToEditor, to?: Editor) {
    const data = `data: ${JSON.stringify(m)}\n\n`;
    for (const e of to ? [to] : this.list) e.res.write(data);
  }

  /** A live call to the tab in use; undefined when no editor is open. */
  call(call: LiveCall): Promise<{ result?: unknown; error?: string }> | undefined {
    const e = this.list.at(-1);
    if (!e) return undefined;
    const id = this.calls++;
    return new Promise((done) => {
      this.pending.set(id, { editor: e.id, done });
      this.send({ type: 'call', id, call }, e);
    });
  }

  reply(id: number, v: { result?: unknown; error?: string }) {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    p.done(v);
    return true;
  }
}

export function serve(o: ServeOptions): Promise<{ server: http.Server; url: string; token: string; close(): void }> {
  const root = fs.realpathSync(o.root);
  const app = o.app ?? fileURLPath(new URL('../../web/dist/', import.meta.url));
  const token = o.token ?? serveToken();
  const editors = new Editors();
  const log = o.log ?? (() => undefined);

  // The browser speaks in paths relative to the folder; the agent in absolute paths.
  const link: LiveLink = {
    async context() {
      const r = await editors.call({ method: 'context' });
      const c = r && !r.error ? (r.result as LiveContext | null) : undefined;
      return c ? { ...c, ...(c.file ? { file: path.join(root, c.file) } : {}) } : undefined;
    },
    async propose(p: Proposal) {
      const rel = path.relative(root, p.file);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return { outcome: 'not-open', message: `${p.file} is outside the folder carto serve has open (${root}).` };
      const r = await editors.call({ method: 'propose', params: { ...p, file: rel.split(path.sep).join('/') } });
      if (!r) return undefined;
      if (r.error) return { outcome: 'rejected', message: r.error === 'closed' ? 'The editor was closed before the user decided.' : r.error };
      return r.result as ProposalResult;
    },
  };
  const host = {
    context: () => link.context(),
    propose: async (p: Proposal) => (await link.propose(p)) ?? { outcome: 'not-open' as const, message: 'No browser has the editor of carto serve open.' },
  };

  let page: string | undefined;
  const indexHtml = () =>
    (page ??= fs
      .readFileSync(path.join(app, 'index.html'), 'utf8')
      .replace('<head>', `<head>\n    <meta name="carto-serve" content="${token}" data-folder="${path.basename(root).replace(/[^\w .-]/g, '')}" />`));

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!localHost(req)) return sendJson(res, 403, { error: 'Only for this machine' });
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) return sendJson(res, 403, { error: 'Not from this page' });

      if (url.pathname === '/mcp' || url.pathname === '/live') {
        if (!authorized(req, token)) return sendJson(res, 401, { error: 'Unauthorized: send Authorization: Bearer <token>' });
        return url.pathname === '/mcp' ? handleMcp(req, res, () => createMcp(root, { live: link })) : handleLive(req, res, host);
      }

      if (url.pathname.startsWith('/api/')) {
        if ((req.headers['x-carto-token'] ?? url.searchParams.get('token')) !== token) return sendJson(res, 401, { error: 'Unauthorized' });
        if (url.pathname === '/api/files') return sendJson(res, 200, { name: path.basename(root), files: listFiles(root) });
        if (url.pathname === '/api/file') {
          const abs = inRoot(root, url.searchParams.get('path'));
          if (!abs) return sendJson(res, 400, { error: 'Not a path in the folder' });
          if (req.method === 'GET') {
            if (!fs.existsSync(abs)) return sendJson(res, 404, { error: 'Not found' });
            res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'x-mtime': String(fs.statSync(abs).mtimeMs), 'cache-control': 'no-store' });
            return res.end(fs.readFileSync(abs));
          }
          if (req.method === 'PUT') {
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, await readBody(req));
            return sendJson(res, 200, { mtime: fs.statSync(abs).mtimeMs });
          }
          if (req.method === 'DELETE') {
            fs.rmSync(abs, { force: true });
            return sendJson(res, 200, {});
          }
          return sendJson(res, 405, { error: 'GET, PUT or DELETE' });
        }
        if (url.pathname === '/api/events') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          const e = editors.add(res);
          res.write(`event: hello\ndata: ${JSON.stringify({ editor: e.id })}\n\n`);
          const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
          res.on('close', () => clearInterval(ping));
          return;
        }
        if (req.method === 'POST' && (url.pathname === '/api/reply' || url.pathname === '/api/active')) {
          const body = JSON.parse((await readBody(req)) || '{}') as { id?: number; editor?: number; result?: unknown; error?: string };
          if (url.pathname === '/api/active') return (editors.active(Number(body.editor)), sendJson(res, 200, {}));
          return sendJson(res, editors.reply(Number(body.id), body) ? 200 : 404, {});
        }
        return sendJson(res, 404, { error: 'Not found' });
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'GET' });
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': TYPES['.html']!, 'cache-control': 'no-store' });
        return res.end(indexHtml());
      }
      const file = inRoot(app, decodeURIComponent(url.pathname.slice(1)));
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    })().catch((e: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    });
  });

  // Files changed on disk (an agent's edit_diagram, git, another editor): the open editors hear it.
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(root, { recursive: true }, (_, name) => {
      if (!name) return;
      const rel = name.split(path.sep).join('/');
      if (rel.split('/').some((s) => SKIP.has(s)) || !TEXT.test(path.basename(rel))) return;
      clearTimeout(timers.get(rel));
      timers.set(rel, setTimeout(() => (timers.delete(rel), editors.send({ type: 'changed', path: rel })), 120));
    });
  } catch {
    log('Watching the folder for changes is not supported here: the editor checks the open file when it gets focus.');
  }

  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(o.port, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const url = `http://127.0.0.1:${port}`;
      const forget = announce({ host: 'browser', url, token, roots: [root] });
      const close = () => {
        forget();
        watcher?.close();
        server.closeAllConnections();
        server.close();
      };
      ok({ server, url, token, close });
    });
  });
}

const fileURLPath = (u: URL) => decodeURIComponent(u.pathname);

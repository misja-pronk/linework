// Serves the built site on localhost, so the editor (an ES module app) opens from the gallery links:
//   pnpm docs:serve [port]        default 5180
// The pages themselves also work straight from disk (file://); only the editor needs a server.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '../dist');
const port = Number(process.argv[2] ?? process.env.PORT ?? 5180);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.yaml': 'text/yaml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    let file = path.join(dist, url);
    if (!file.startsWith(dist)) return void res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return void res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, 'localhost', () => console.log(`http://localhost:${port}/`));

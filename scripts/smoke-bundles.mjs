// The bundles as a user runs them: copied to a temporary folder outside the repo (no node_modules,
// no tsx), run with plain node. Renders an example to SVG, PNG, PDF and PowerPoint, validates it,
// lists the MCP server's tools over stdio, and fetches the editor from linework serve.
//   pnpm build && pnpm smoke
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linework-smoke-')));
const work = path.join(tmp, 'work');
for (const [from, to] of [['packages/cli/dist', 'linework'], ['packages/mcp/dist', 'mcp']]) {
  if (!fs.existsSync(path.join(root, from))) throw new Error(`${from} is not built: pnpm build`);
  fs.cpSync(path.join(root, from), path.join(tmp, to), { recursive: true });
}
fs.mkdirSync(work);
fs.copyFileSync(path.join(root, 'examples/systems/web-shop.yaml'), path.join(work, 'shop.yaml'));
// Its own config folder and home: the serve token and icon packs stay in here.
const env = { PATH: process.env.PATH, HOME: tmp, LINEWORK_CONFIG_DIR: path.join(tmp, 'config'), LINEWORK_LANG: 'en' };
const linework = path.join(tmp, 'linework/linework.mjs');
const server = path.join(tmp, 'mcp/server.mjs');

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${String(e.stack ?? e).split('\n').join('\n      ')}`);
  }
}
const run = (...args) => execFileSync(process.execPath, [linework, ...args], { cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const head = (file, n) => fs.readFileSync(path.join(work, file)).subarray(0, n).toString('latin1');
const expect = (ok, what) => {
  if (!ok) throw new Error(what);
};

await check('linework --help', () => expect(/^Draw {4}render/m.test(run('--help')), 'no command list'));
await check('linework through a symlink on the PATH, by its shebang', () => {
  fs.mkdirSync(path.join(tmp, 'bin'));
  fs.symlinkSync(linework, path.join(tmp, 'bin/linework'));
  const out = execFileSync('linework', ['themes'], { cwd: work, env: { ...env, PATH: `${path.join(tmp, 'bin')}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${env.PATH}` }, encoding: 'utf8' });
  expect(out.includes('survey'), out);
});
await check('render to SVG', () => (run('render', 'shop.yaml', '-o', 'shop.svg'), expect(head('shop.svg', 5) === '<svg ', 'not an SVG')));
await check('render to PNG (resvg, the bundled fonts)', () => (run('render', 'shop.yaml', '-o', 'shop.png'), expect(head('shop.png', 4) === '\x89PNG', 'not a PNG')));
await check('render to PDF', () => (run('render', 'shop.yaml', '-o', 'shop.pdf'), expect(head('shop.pdf', 5) === '%PDF-', 'not a PDF')));
await check('render to PowerPoint', () => (run('render', 'shop.yaml', '-o', 'shop.pptx'), expect(head('shop.pptx', 2) === 'PK', 'not a pptx')));
await check('validate', () => expect(run('validate', 'shop.yaml').includes('shop.yaml ok'), 'not ok'));
await check('validate fails on a broken diagram', () => {
  fs.writeFileSync(path.join(work, 'broken.yaml'), 'type: systems\nnodes:\n  a: service\nedges:\n  - a -> nowhere\n');
  let code = 0;
  try {
    run('validate', 'broken.yaml');
  } catch (e) {
    code = e.status;
  }
  expect(code === 1, `exit ${code}`);
});

await check('MCP server over stdio: initialize, tools/list, get_schema with its example', async () => {
  const p = spawn(process.execPath, [server], { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const replies = new Map();
  let buf = '';
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  p.stdout.on('data', (d) => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
      const m = JSON.parse(buf.slice(0, i));
      if (m.id != null) replies.get(m.id)?.(m);
    }
  });
  let id = 0;
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      const timer = setTimeout(() => reject(new Error(`${method}: no answer in 20 s\n${err}`)), 20_000);
      replies.set(n, (m) => (clearTimeout(timer), m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  try {
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const { tools } = await call('tools/list', {});
    const names = tools.map((x) => x.name);
    expect(['list_types', 'get_schema', 'validate', 'render'].every((n) => names.includes(n)), `tools: ${names.join(', ')}`);
    const schema = await call('tools/call', { name: 'get_schema', arguments: { type: 'systems' } });
    expect(JSON.stringify(schema).includes('examples/systems/'), 'get_schema has no example: examples/ beside the bundle not found');
    const png = await call('tools/call', { name: 'render', arguments: { file: 'shop.yaml', format: 'png', path: 'mcp.png' } });
    expect(!png.isError && fs.readFileSync(path.join(work, 'mcp.png')).subarray(0, 4).toString('latin1') === '\x89PNG', `render png: ${JSON.stringify(png).slice(0, 300)}`);
  } finally {
    p.kill();
  }
});

await check('linework serve: the editor at /', async () => {
  const p = spawn(process.execPath, [linework, 'serve', work, '--port', '0'], { cwd: work, env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error(`no URL in 20 s: ${out}`)), 20_000);
      p.stdout.on('data', (d) => {
        out += d;
        const m = /(http:\/\/127\.0\.0\.1:\d+)\//.exec(out);
        if (m) (clearTimeout(timer), resolve(m[1]));
      });
      p.on('exit', (code) => reject(new Error(`exited ${code}: ${out}`)));
    });
    const res = await fetch(`${url}/`);
    const html = await res.text();
    expect(res.status === 200, `GET / ${res.status}`);
    expect(html.includes('name="linework-serve"') && /<script[^>]+src=/.test(html), 'not the editor page');
    const js = /<script[^>]+src="([^"]+)"/.exec(html)[1];
    expect((await fetch(new URL(js, `${url}/`))).status === 200, `GET ${js}`);
  } finally {
    p.kill();
  }
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nThe bundles run on their own.');

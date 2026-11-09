// Builds the plugins into dist/ as plain JavaScript for Node, with the engine inside: a docs site
// imports dist/remark.js or dist/markdown-it.js and needs nothing else installed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
await build({
  absWorkingDir: here,
  entryPoints: { index: 'src/index.ts', remark: 'src/remark.ts', 'markdown-it': 'src/markdown-it.ts', worker: 'src/worker.ts' },
  outdir: dist,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'warning',
  // Some of what the engine uses is CommonJS and asks for `require`.
  banner: { js: "import { createRequire as cartoRequire } from 'node:module'; const require = cartoRequire(import.meta.url);" },
});
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
for (const name of fs.readdirSync(dist).sort()) console.log(`${name.padEnd(28)} ${kb(fs.statSync(path.join(dist, name)).size).padStart(10)}`);

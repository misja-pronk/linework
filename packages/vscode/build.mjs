// Builds the extension into dist/: extension.js (the extension host's side, with the engine and
// Graphviz inside, CommonJS as VS Code loads it), worker.js (draws the Markdown preview's diagrams
// for the docs plugin), webview.js (the preview page) and schemas/ (each type's JSON Schema, for
// anyone who wants to point another tool at them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const minify = !process.argv.includes('--dev');

export async function buildExtension() {
  fs.rmSync(dist, { recursive: true, force: true });
  const node = {
    absWorkingDir: here,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    minify,
    sourcemap: minify ? false : 'inline',
    legalComments: 'none',
    logLevel: 'warning',
    external: ['vscode'],
    // The docs plugin finds its worker next to itself through import.meta.url, which CommonJS has not.
    define: { 'import.meta.url': '__cartoUrl' },
    banner: { js: "const __cartoUrl = require('node:url').pathToFileURL(__filename).href;" },
  };
  await build({ ...node, entryPoints: { extension: 'src/extension.ts' }, outdir: dist });
  await build({ ...node, entryPoints: { worker: '../docs-plugins/src/worker.ts' }, outdir: dist });
  await build({ absWorkingDir: here, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify, legalComments: 'none', logLevel: 'warning', entryPoints: { webview: 'src/webview/main.ts' }, outdir: dist });
  // The schemas, written by the same code the extension hands the YAML extension.
  const out = path.join(dist, 'schemas.cjs');
  await build({ ...node, minify: false, entryPoints: { schemas: 'src/schemas.ts' }, outfile: out, outdir: undefined });
  const { createRequire } = await import('node:module');
  const s = createRequire(import.meta.url)(out);
  fs.mkdirSync(path.join(dist, 'schemas'), { recursive: true });
  for (const id of s.schemaIds()) fs.writeFileSync(path.join(dist, 'schemas', `${id}.schema.json`), JSON.stringify(s.editorSchema(id), null, 2) + '\n');
  fs.writeFileSync(path.join(dist, 'schemas', 'cartography.schema.json'), JSON.stringify(s.combinedSchema(), null, 2) + '\n');
  fs.rmSync(out);
  return fs
    .readdirSync(dist)
    .sort()
    .map((name) => ({ name, bytes: fs.statSync(path.join(dist, name)).isDirectory() ? 0 : fs.statSync(path.join(dist, name)).size }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  for (const f of await buildExtension()) console.log(`${f.name.padEnd(20)} ${f.bytes ? kb(f.bytes).padStart(10) : ''}`);
}

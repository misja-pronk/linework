// Builds the embed into dist/: carto-diagram.js (the loader, a few kB), carto-engine.js (the engine
// with Graphviz, fetched on demand and once per page) and carto-diagram.standalone.js (both in one).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const common = { bundle: true, format: 'esm', target: 'es2022', minify: true, legalComments: 'none', logLevel: 'warning', absWorkingDir: here };

/** Returns the files written with their sizes, raw and gzipped. */
export async function buildEmbed() {
  fs.rmSync(dist, { recursive: true, force: true });
  // The loader imports the engine by its file name, so the two are exactly two requests.
  const engineApart = { name: 'engine-apart', setup: (b) => b.onResolve({ filter: /^\.\/engine\.ts$/ }, () => ({ path: './carto-engine.js', external: true })) };
  await build({ ...common, entryPoints: { 'carto-diagram': 'src/index.ts' }, plugins: [engineApart], outdir: dist });
  await build({ ...common, entryPoints: { 'carto-engine': 'src/engine.ts' }, outdir: dist });
  await build({ ...common, entryPoints: { 'carto-diagram.standalone': 'src/standalone.ts' }, outdir: dist });
  return fs
    .readdirSync(dist)
    .sort()
    .map((name) => {
      const bytes = fs.readFileSync(path.join(dist, name));
      return { name, bytes: bytes.length, gzip: zlib.gzipSync(bytes, { level: 9 }).length };
    });
}

/** The one-file build as text (built first when it is not there yet), for pages that carry everything. */
export async function standaloneScript() {
  const file = path.join(dist, 'carto-diagram.standalone.js');
  if (!fs.existsSync(file)) await buildEmbed();
  return fs.readFileSync(file, 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  for (const f of await buildEmbed()) console.log(`${f.name.padEnd(34)} ${kb(f.bytes).padStart(10)}  gzip ${kb(f.gzip).padStart(9)}`);
}

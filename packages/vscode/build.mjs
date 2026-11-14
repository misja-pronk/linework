// Builds the extension into dist/: extension.js (the extension host's side, with the engine and
// Graphviz inside, CommonJS as VS Code loads it), mcp.mjs (the MCP server VS Code starts for its
// agents), webview.js (the preview page) and schemas/ (each type's JSON Schema, for
// anyone who wants to point another tool at them).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const minify = !process.argv.includes('--dev');

/** @resvg/resvg-js in the MCP bundle: a class that says why there is no PNG. */
const noResvg = {
  name: 'no-resvg',
  setup(b) {
    b.onResolve({ filter: /^@resvg\/resvg-js$/ }, () => ({ path: 'resvg', namespace: 'no-resvg' }));
    b.onLoad({ filter: /.*/, namespace: 'no-resvg' }, () => ({
      contents: "export class Resvg { constructor() { throw new Error('The MCP server inside the VS Code extension draws no PNG (resvg is native code it does not ship). Render as svg, or use the linework CLI for PNG.'); } }",
      loader: 'js',
    }));
  },
};

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
    // CommonJS has no import.meta.url, and code in the bundle builds URLs on it when it loads
    // (pdfkit's ICC profile, the theme's font files): without this the bundle throws on require.
    define: { 'import.meta.url': '__lineworkUrl' },
    banner: { js: "const __lineworkUrl = require('node:url').pathToFileURL(__filename).href;" },
  };
  await build({ ...node, entryPoints: { extension: 'src/extension.ts' }, outdir: dist });
  // The MCP server VS Code starts for its agents (src/mcp.ts): packages/mcp's own main, as an ES
  // module for its top-level await. resvg is a native module per platform, so this copy has no PNG:
  // the shim says so, and render draws SVG.
  await build({
    ...node,
    format: 'esm',
    define: {},
    banner: { js: "import { createRequire as __lineworkRequire } from 'node:module'; const require = __lineworkRequire(import.meta.url);" },
    entryPoints: { mcp: '../mcp/src/main.ts' },
    outExtension: { '.js': '.mjs' },
    outdir: dist,
    plugins: [noResvg],
  });
  await build({ absWorkingDir: here, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify, legalComments: 'none', logLevel: 'warning', entryPoints: { webview: 'src/webview/main.ts' }, outdir: dist });
  // The schemas, written by the same code the extension hands the YAML extension.
  const out = path.join(dist, 'schemas.cjs');
  await build({ ...node, minify: false, entryPoints: { schemas: 'src/schemas.ts' }, outfile: out, outdir: undefined });
  const { createRequire } = await import('node:module');
  const s = createRequire(import.meta.url)(out);
  fs.mkdirSync(path.join(dist, 'schemas'), { recursive: true });
  for (const id of s.schemaIds()) fs.writeFileSync(path.join(dist, 'schemas', `${id}.schema.json`), JSON.stringify(s.editorSchema(id), null, 2) + '\n');
  fs.writeFileSync(path.join(dist, 'schemas', 'linework.schema.json'), JSON.stringify(s.combinedSchema(), null, 2) + '\n');
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

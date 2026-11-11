// Bundles the CLI and the MCP server into single ES modules that run on plain Node.js 24, without
// node_modules or tsx:
//   packages/cli/dist/carto.mjs     the carto command; web/ beside it is the editor `carto serve` serves
//   packages/mcp/dist/server.mjs    the MCP server over stdio
// Beside each bundle: fonts/ (the TTFs resvg and the PDF export read), examples/ (get_schema's
// examples) and resvg's native binary for this platform (PNG). Graphviz and wawoff2 carry their
// WebAssembly inline, so they bundle as they are.
//   node scripts/bundle.mjs [cli|mcp]      (pnpm build runs the web app's build first)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// esbuild comes from the VS Code extension, which bundles with it already: one version in the repo.
const { build } = createRequire(path.join(root, 'packages/vscode/package.json'))('esbuild');

/**
 * Paths that code finds next to itself with new URL(…, import.meta.url): in a bundle, "itself" is
 * the bundle, so each points at the copy beside it. A path that is no longer there fails the build.
 */
const relocate = {
  'packages/theme/src/node.ts': [['`../fonts/${f}`', '`./fonts/${f}`']],
  'packages/mcp/src/tools.ts': [["'../../../examples/'", "'./examples/'"]],
  'packages/cli/src/serve.ts': [["'../../web/dist/'", "'./web/'"]],
};

const relocatePlugin = {
  name: 'relocate',
  setup(b) {
    const files = Object.keys(relocate).map((f) => path.join(root, f));
    const filter = new RegExp(`(${files.map((f) => f.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})$`);
    b.onLoad({ filter }, (args) => {
      let text = fs.readFileSync(args.path, 'utf8');
      for (const [from, to] of relocate[path.relative(root, args.path).split(path.sep).join('/')]) {
        if (!text.includes(from)) throw new Error(`${args.path}: ${from} is not there any more; update scripts/bundle.mjs`);
        text = text.replaceAll(from, to);
      }
      return { contents: text, loader: 'ts' };
    });
  },
};

/** resvg's native binary for this machine (pnpm installs only the platform's own package). */
function resvgBinaries() {
  const pnpm = path.join(root, 'node_modules/.pnpm');
  return fs
    .readdirSync(pnpm)
    .filter((d) => /^@resvg\+resvg-js-[a-z0-9-]+@/.test(d))
    .flatMap((d) => {
      const dir = path.join(pnpm, d, 'node_modules/@resvg', d.replace(/^@resvg\+/, '').replace(/@.*$/, ''));
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.node')).map((f) => path.join(dir, f)) : [];
    });
}

const copy = (from, to, filter = () => true) => fs.cpSync(from, to, { recursive: true, filter: (src) => fs.statSync(src).isDirectory() || filter(src) });

/** One bundle and what it needs beside it. */
async function bundle({ entry, outfile, web }) {
  const dist = path.dirname(outfile);
  fs.rmSync(dist, { recursive: true, force: true });
  await build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node24',
    minify: true,
    legalComments: 'linked',
    logLevel: 'warning',
    // CommonJS inside the bundle (resvg's loader, yaml, fontkit, …) asks for require and __dirname.
    banner: {
      js: [
        '#!/usr/bin/env node',
        "import { createRequire as __cartoRequire } from 'node:module';",
        "import { fileURLToPath as __cartoPath } from 'node:url';",
        'const require = __cartoRequire(import.meta.url);',
        'const __filename = __cartoPath(import.meta.url);',
        "const __dirname = __cartoPath(new URL('.', import.meta.url));",
      ].join('\n'),
    },
    // resvg's loader requires ./resvgjs.<platform>.node beside itself (__dirname: the bundle's
    // folder), falling back to the platform's package: both stay outside, the binary is copied.
    external: ['*.node', '@resvg/resvg-js-*'],
    plugins: [relocatePlugin],
  });
  // The entry's own shebang is dropped by esbuild only when it is the first line: keep one.
  const text = fs.readFileSync(outfile, 'utf8');
  fs.writeFileSync(outfile, text.replace(/^(#!.*\n)(#!.*\n)+/, '$1'));
  fs.chmodSync(outfile, 0o755);
  copy(path.join(root, 'packages/theme/fonts'), path.join(dist, 'fonts'), (f) => /\.(ttf|txt)$/.test(f));
  copy(path.join(root, 'examples'), path.join(dist, 'examples'), (f) => /\.ya?ml$/.test(f));
  const binaries = resvgBinaries();
  if (!binaries.length) throw new Error('No @resvg/resvg-js binary installed for this platform: run pnpm install');
  for (const b of binaries) fs.copyFileSync(b, path.join(dist, path.basename(b)));
  if (web) {
    const app = path.join(root, 'packages/web/dist');
    if (!fs.existsSync(path.join(app, 'index.html'))) throw new Error('packages/web/dist is not built: pnpm web:build (pnpm build does both)');
    copy(app, path.join(dist, 'web'));
  }
  return dist;
}

const targets = {
  cli: { entry: 'packages/cli/src/main.ts', outfile: path.join(root, 'packages/cli/dist/carto.mjs'), web: true },
  mcp: { entry: 'packages/mcp/src/main.ts', outfile: path.join(root, 'packages/mcp/dist/server.mjs') },
};

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const asked = process.argv.slice(2).filter((a) => a in targets);
for (const name of asked.length ? asked : Object.keys(targets)) {
  const t = targets[name];
  const dist = await bundle(t);
  console.log(`${path.relative(root, t.outfile).padEnd(32)} ${mb(fs.statSync(t.outfile).size).padStart(8)}   (with what is beside it: ${mb(size(dist))})`);
}

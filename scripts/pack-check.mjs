// Checks what `npm publish` would upload, without publishing: builds each publishable package, packs
// it into a temporary folder with `pnpm pack` (which applies publishConfig and resolves workspace:
// versions), opens the tarball and checks the manifest and the files.
//   pnpm pack:check            build, pack and check every publishable package
// Only the packages in PUBLISH would be released; none are now. The others export TypeScript sources
// for use inside this repository and need a bundle step before they could go to npm; they are listed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
/** The packages released to npm. Each bundles the engine into dist/, so it needs none of our other packages at run time. */
export const PUBLISH = [];

const problems = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linework-pack-'));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

for (const dir of PUBLISH) {
  const abs = path.join(root, dir);
  const src = JSON.parse(fs.readFileSync(path.join(abs, 'package.json'), 'utf8'));
  const fail = (m) => problems.push(`${src.name}: ${m}`);
  if (src.private) fail('is marked private');
  if (src.scripts?.build && !process.argv.includes('--no-build')) run('pnpm', ['run', 'build'], abs);

  const out = path.join(tmp, path.basename(dir));
  fs.mkdirSync(out);
  run('pnpm', ['pack', '--pack-destination', out], abs);
  const tgz = fs.readdirSync(out).find((f) => f.endsWith('.tgz'));
  if (!tgz) {
    fail('pnpm pack wrote no tarball');
    continue;
  }
  run('tar', ['-xzf', tgz], out);
  const pkgDir = path.join(out, 'package');
  const files = run('tar', ['-tzf', tgz], out).trim().split('\n').map((f) => f.replace(/^package\//, ''));
  const m = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

  // The manifest as npm will see it.
  if (m.license !== 'MIT') fail(`license is ${m.license}, not MIT`);
  if (!m.description) fail('no description');
  if (!m.repository?.url) fail('no repository');
  if (!/^\d+\.\d+\.\d+/.test(m.version ?? '')) fail(`version "${m.version}" is not semver`);
  if (!files.some((f) => /^LICEN[CS]E/i.test(f))) fail('the tarball holds no LICENSE file');
  if (!Array.isArray(m.files)) fail('no "files" list: everything in the folder would be published');
  for (const kind of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(m[kind] ?? {})) {
      if (String(range).startsWith('workspace:')) fail(`${kind}.${name} is still "${range}"`);
      if (name.startsWith('@linework/') && !PUBLISH.some((d) => JSON.parse(fs.readFileSync(path.join(root, d, 'package.json'), 'utf8')).name === name)) fail(`${kind}.${name} is not published: users could not install this package`);
    }
  }
  // Every entry point must be in the tarball and be JavaScript: Node does not run TypeScript from node_modules.
  const targets = [];
  const collect = (v) => (typeof v === 'string' ? targets.push(v) : v && typeof v === 'object' ? Object.values(v).forEach(collect) : undefined);
  collect(m.exports ?? m.main ?? './index.js');
  collect(m.bin);
  for (const t of targets) {
    const f = t.replace(/^\.\//, '');
    if (!files.includes(f)) fail(`entry ${t} is not in the tarball`);
    if (/\.tsx?$/.test(f)) fail(`entry ${t} is TypeScript`);
  }
  // A bundle that imports one of our packages by name would fail on install.
  for (const f of files.filter((x) => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(pkgDir, f), 'utf8');
    const ours = /(?:from|import\()\s*["'](@linework\/[\w-]+)/.exec(text);
    if (ours) fail(`${f} imports ${ours[1]}, which is not bundled`);
  }
  const size = files.reduce((n, f) => n + (fs.existsSync(path.join(pkgDir, f)) ? fs.statSync(path.join(pkgDir, f)).size : 0), 0);
  console.log(`${m.name}@${m.version}  ${files.length} files, ${(size / 1024).toFixed(0)} kB unpacked  ${targets.join(' ')}`);
}

// The rest, for the record.
const rest = [];
for (const base of ['packages', 'types']) {
  for (const name of fs.readdirSync(path.join(root, base)).sort()) {
    const file = path.join(root, base, name, 'package.json');
    if (!fs.existsSync(file) || PUBLISH.includes(`${base}/${name}`)) continue;
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!p.private) rest.push(p.name.replace('@linework/', ''));
  }
}
if (rest.length) console.log(`not released (TypeScript sources for use inside this repository; a bundle step comes first): ${rest.join(', ')}`);

fs.rmSync(tmp, { recursive: true, force: true });
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `  ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(PUBLISH.length ? 'Every publishable package packs cleanly. Nothing was published.' : 'No package is published to npm.');

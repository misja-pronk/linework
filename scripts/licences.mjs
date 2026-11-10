// Licence check: every package in the dependency tree (production and development) must be under a
// permissive licence, or be listed below as an exception with the reason. Fails otherwise.
//   pnpm licences            the check
//   pnpm licences --list     every licence and how many packages carry it
// The tree comes from `pnpm licenses list`, which reads what is installed: no network.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Licences that ask nothing beyond keeping the notice. SPDX ids. */
const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  '0BSD',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'OFL-1.1',
  'CC0-1.0',
  'CC-BY-4.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Zlib',
  'Python-2.0',
  'PSF-2.0',
  'WTFPL',
]);

/**
 * Packages allowed although their licence is not in the list above. Each says why, and whether it
 * may be a production dependency (shipped to users) or only a development one.
 */
const EXCEPTIONS = {
  '@resvg/resvg-js': { scope: 'prod', why: 'MPL-2.0 (file-level copyleft): used unmodified as a native module for PNG export in the CLI; its source stays available upstream' },
  '@resvg/resvg-js-darwin-arm64': { scope: 'prod', why: 'the platform binary of @resvg/resvg-js, same terms' },
  '@resvg/resvg-js-darwin-x64': { scope: 'prod', why: 'the platform binary of @resvg/resvg-js, same terms' },
  '@resvg/resvg-js-linux-x64-gnu': { scope: 'prod', why: 'the platform binary of @resvg/resvg-js, same terms' },
  '@resvg/resvg-js-linux-x64-musl': { scope: 'prod', why: 'the platform binary of @resvg/resvg-js, same terms' },
  '@resvg/resvg-js-linux-arm64-gnu': { scope: 'prod', why: 'the platform binary of @resvg/resvg-js, same terms' },
  '@resvg/resvg-js-linux-arm64-musl': { scope: 'prod', why: 'the platform binary of @resvg/resvg-js, same terms' },
  '@resvg/resvg-js-win32-x64-msvc': { scope: 'prod', why: 'the platform binary of @resvg/resvg-js, same terms' },
  lightningcss: { scope: 'dev', why: 'MPL-2.0: CSS minifier inside Vite, a build tool; nothing of it is shipped' },
  elkjs: { scope: 'dev', why: 'EPL-2.0 OR GPL-3.0: a dependency of mermaid, which is only used to compare against Mermaid (pnpm compare, pnpm bench)' },
  khroma: { scope: 'dev', why: 'MIT per its licence file; its package.json has no licence field (a dependency of mermaid, dev only)' },
};

const prefix = 'lightningcss-';
const exceptionOf = (name) => EXCEPTIONS[name] ?? (name.startsWith(prefix) ? EXCEPTIONS.lightningcss : undefined);

/** An SPDX expression is fine when every AND part, or one OR part, is allowed. */
function allowed(expr) {
  const e = expr.trim().replace(/^\((.*)\)$/, '$1');
  if (/\sOR\s/i.test(e)) return e.split(/\s+OR\s+/i).some(allowed);
  if (/\sAND\s/i.test(e)) return e.split(/\s+AND\s+/i).every(allowed);
  return ALLOWED.has(e.replace(/\+$/, ''));
}

const root = path.resolve(import.meta.dirname, '..');
const read = (args) => JSON.parse(execFileSync('pnpm', ['licenses', 'list', '--json', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }));
const all = read([]);
const prod = read(['--prod']);
const prodNames = new Set(Object.values(prod).flat().map((p) => p.name));

const failures = [];
const used = new Set();
let count = 0;
for (const [licence, packages] of Object.entries(all)) {
  for (const p of packages) {
    count++;
    if (allowed(licence)) continue;
    const ex = exceptionOf(p.name);
    const isProd = prodNames.has(p.name);
    if (ex && (ex.scope === 'prod' || !isProd)) {
      used.add(p.name);
      continue;
    }
    failures.push(`${p.name}@${p.versions.join(',')}: ${licence}${isProd ? ' (production dependency)' : ' (development dependency)'}${ex ? ` — listed as a ${ex.scope} exception but used in production` : ''}`);
  }
}

if (process.argv.includes('--list')) {
  for (const [licence, packages] of Object.entries(all).sort((a, b) => b[1].length - a[1].length)) console.log(`${licence.padEnd(32)} ${String(packages.length).padStart(4)}  ${allowed(licence) ? '' : packages.map((p) => p.name).join(', ')}`);
}

// Our own packages: MIT, with the licence text where it is published.
for (const dir of ['packages', 'types']) {
  for (const name of fs.readdirSync(path.join(root, dir))) {
    const file = path.join(root, dir, name, 'package.json');
    if (!fs.existsSync(file)) continue;
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (pkg.license !== 'MIT') failures.push(`${pkg.name}: our own package must say "license": "MIT" (it says ${pkg.license ?? 'nothing'})`);
  }
}

for (const name of used) console.log(`exception: ${name} — ${exceptionOf(name).why}`);
if (failures.length) {
  console.error(`\n${failures.length} package(s) under a licence that is not allowed:\n${failures.map((f) => `  ${f}`).join('\n')}\n\nReplace the dependency, or add it to EXCEPTIONS in scripts/licences.mjs with the reason.`);
  process.exit(1);
}
console.log(`${count} packages checked: all permissive, ${used.size} listed exception(s).`);

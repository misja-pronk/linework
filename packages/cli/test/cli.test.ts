// The real command line, as CI runs it: exit codes, messages and what lands on disk.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-cli-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function carto(...args: string[]) {
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: tmp, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const write = (name: string, text: string) => fs.writeFileSync(path.join(tmp, name), text);
const read = (name: string) => fs.readFileSync(path.join(tmp, name), 'utf8');
const exists = (name: string) => fs.existsSync(path.join(tmp, name));

const shop = `type: azure
groups:
  rg: resource-group
nodes:
  web: { kind: app-service, in: rg }
  db: { kind: sql-database, in: rg }
  kv: key-vault
edges:
  - web -> db
  - web -> kv
views:
  data: { include: [web, db], title: Data }
`;

describe('carto render --stable', () => {
  it('notes the layout in the sidecar, once, and plain render never writes it', () => {
    write('shop.yaml', shop);
    expect(carto('render', 'shop.yaml').code).toBe(0);
    expect(exists('shop.layout.json')).toBe(false);

    const first = carto('render', 'shop.yaml', '--stable', '--all-views');
    expect(first.code).toBe(0);
    expect(first.out).toContain('layout noted');
    const sidecar = JSON.parse(read('shop.layout.json'));
    expect(sidecar.layout.variant).toMatch(/^(right|down)\//);
    expect(sidecar.layout.at).toMatch(/db@[\d.-]+,[\d.-]+;kv@[\d.-]+,[\d.-]+;web@[\d.-]+,[\d.-]+;#rg@/);
    expect(sidecar.views.data.layout.at).toMatch(/^db@[^;]+;web@[^;]+;#rg@/);

    // Nothing changed: nothing written, and the picture is the same with or without the note.
    const noted = read('shop.layout.json');
    const svg = read('shop.svg');
    const again = carto('render', 'shop.yaml', '--stable', '--all-views');
    expect(again.out).not.toContain('layout noted');
    expect(read('shop.layout.json')).toBe(noted);
    expect(read('shop.svg')).toBe(svg);

    // An edit: plain render reads the note and leaves it alone.
    write('shop.yaml', shop.replace('  kv: key-vault\n', '  kv: key-vault\n  cache: redis\n').replace('  - web -> kv\n', '  - web -> kv\n  - web -> cache\n'));
    expect(carto('render', 'shop.yaml').code).toBe(0);
    expect(read('shop.layout.json')).toBe(noted);
    // --stable brings it up to date, and keeps pins that were there.
    fs.writeFileSync(path.join(tmp, 'shop.layout.json'), JSON.stringify({ ...sidecar, nodes: { kv: { x: 700, y: 40 } } }));
    expect(carto('render', 'shop.yaml', '--stable').out).toContain('layout noted');
    const updated = JSON.parse(read('shop.layout.json'));
    expect(updated.layout.at).toContain('cache@');
    expect(updated.nodes).toEqual({ kv: { x: 700, y: 40 } });
    expect(updated.views.data.layout).toEqual(sidecar.views.data.layout);
  }, 60_000);
});

describe('carto validate --drift', () => {
  it('fails on stale entries, naming the file and the ids; --fix drops them', () => {
    write('drift.yaml', shop);
    const sidecar = {
      version: 1,
      nodes: { web: { x: 10, y: 10 }, cache: { x: 1, y: 1 } },
      edges: { e7: { via: [{ x: 1, y: 1 }] } },
      locked: ['cache'],
      views: { old: { nodes: { web: { x: 1, y: 1 } } } },
    };
    write('drift.layout.json', JSON.stringify(sidecar));

    // Without the flag the sidecar is not looked at.
    expect(carto('validate', 'drift.yaml').code).toBe(0);

    const bad = carto('validate', 'drift.yaml', '--drift');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('drift.layout.json  stale  nodes.cache: pinned node "cache" is not drawn');
    expect(bad.err).toContain('edges.e7: bent line "e7" is not drawn');
    expect(bad.err).toContain('locked.cache');
    expect(bad.err).toContain('views.old: view "old" does not exist (views: data)');
    expect(bad.err).toContain('4 stale entries');
    expect(bad.out).not.toContain('ok');
    expect(JSON.parse(read('drift.layout.json'))).toEqual(sidecar);

    const fixed = carto('validate', 'drift.yaml', '--drift', '--fix');
    expect(fixed.code).toBe(0);
    expect(fixed.out).toContain('4 stale entries dropped');
    expect(JSON.parse(read('drift.layout.json'))).toEqual({ version: 1, nodes: { web: { x: 10, y: 10 } } });

    const clean = carto('validate', 'drift.yaml', '--drift');
    expect(clean.code).toBe(0);
    expect(clean.err).toBe('');
  }, 60_000);

  it('removes a sidecar with nothing left, and passes files without one', () => {
    write('gone.yaml', shop);
    write('gone.layout.json', JSON.stringify({ version: 1, nodes: { nope: { x: 1, y: 1 } } }));
    write('plain.yaml', shop);
    expect(carto('validate', 'gone.yaml', 'plain.yaml', '--drift').code).toBe(1);
    const fixed = carto('validate', 'gone.yaml', 'plain.yaml', '--drift', '--fix');
    expect(fixed.code).toBe(0);
    expect(fixed.out).toContain('file removed');
    expect(exists('gone.layout.json')).toBe(false);
  }, 60_000);
});

describe('carto diff', () => {
  const grown = shop.replace('  kv: key-vault\n', '  kv: { kind: key-vault, label: Secrets }\n  cache: { kind: redis, in: rg }\n').replace('  - web -> kv\n', '  - web -> cache\n');

  it('compares two files: words, json, a picture, an exit code', () => {
    write('old.yaml', shop);
    write('new.yaml', grown);
    const text = carto('diff', 'old.yaml', 'new.yaml');
    expect(text.code).toBe(0);
    expect(text.out).toContain('new.yaml against old.yaml: 2 added, 1 removed, 1 changed');
    expect(text.out).toMatch(/\+ node  cache/);
    expect(text.out).toMatch(/~ node  kv +label: "Key Vault" → "Secrets"/);
    expect(text.out).toMatch(/- line  web -> kv/);
    expect(text.out).toMatch(/\+ line  web -> cache/);

    const json = JSON.parse(carto('diff', 'old.yaml', 'new.yaml', '--json').out);
    expect(json).toMatchObject({ file: 'new.yaml', against: 'old.yaml', summary: '2 added, 1 removed, 1 changed', counts: { added: 2, removed: 1, changed: 1 }, same: false });
    expect(json.nodes.map((n: { id: string; status: string }) => `${n.status} ${n.id}`).sort()).toEqual(['added cache', 'changed kv']);

    // No picture unless asked; with -o one file, svg or png by its name.
    expect(exists('new.diff.svg')).toBe(false);
    const svg = carto('diff', 'old.yaml', 'new.yaml', '-o', 'out/shop.svg');
    expect(svg.code).toBe(0);
    expect(read('out/shop.svg')).toContain('<g data-diff="added" data-node="cache">');
    expect(read('out/shop.svg')).toContain('against old.yaml');
    expect(carto('diff', 'old.yaml', 'new.yaml', '-o', 'out/shop.png', '--side-by-side').code).toBe(0);
    expect(fs.readFileSync(path.join(tmp, 'out/shop.png')).subarray(1, 4).toString()).toBe('PNG');
    // A folder: named after the diagram, and after the view when one is asked for.
    expect(carto('diff', 'old.yaml', 'new.yaml', '-o', 'pics', '--view', 'data').code).toBe(0);
    expect(read('pics/new-data.diff.svg')).toContain('No changes against old.yaml');

    // For CI: the exit code says whether anything changed, only when asked.
    expect(carto('diff', 'old.yaml', 'new.yaml', '--exit-code').code).toBe(1);
    const same = carto('diff', 'old.yaml', 'old.yaml', '--exit-code');
    expect(same.code).toBe(0);
    expect(same.out).toContain('no changes');
  }, 120_000);

  it('says what is wrong with the arguments', () => {
    const one = carto('diff', 'old.yaml');
    expect(one.code).toBe(1);
    expect(one.err).toContain('Two files');
    const none = carto('diff', 'nope-a.yaml', 'nope-b.yaml');
    expect(none.code).toBe(1);
    expect(none.err).toContain('not found');
  }, 60_000);

  it('compares with a snapshot the editor wrote, and says the changes in sentences', () => {
    write('snap.yaml', grown);
    fs.mkdirSync(path.join(tmp, 'snap.snapshots'), { recursive: true });
    write('snap.snapshots/Q3-review.yaml', shop);
    const r = carto('diff', '--snapshot', 'Q3 review', 'snap.yaml', '--json');
    expect(r.code).toBe(0);
    const [json] = JSON.parse(r.out);
    expect(json).toMatchObject({ file: 'snap.yaml', against: 'snapshot Q3 review', counts: { added: 2, removed: 1, changed: 1 } });
    expect(json.explained).toEqual(['Added Cache for Redis in rg', 'App Service now connects to Cache for Redis', 'Renamed “Key Vault” to “Secrets”; its kind now “Key Vault”', 'App Service no longer connects to Key Vault']);
    expect(carto('diff', '--snapshot', 'Q3 review', 'snap.yaml', '-o', 'snap.md').code).toBe(0);
    expect(read('snap.md')).toMatch(/^## Changes to snap.yaml since snapshot Q3 review\n\n2 added, 1 removed, 1 changed\.\n\n- Added /);
    const missing = carto('diff', '--snapshot', 'nope', 'snap.yaml');
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('there are: Q3-review');
  }, 60_000);

  it('compares the working tree with a commit, through included files too', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    const git = (...args: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const run = (...args: string[]) => {
      const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: path.join(repo, 'docs'), encoding: 'utf8' });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    const model = `type: model
elements:
  customer: { kind: person, label: Customer }
  shop: { kind: system, label: Web shop }
  mail: { kind: email, label: SendGrid }
relations:
  - customer -> shop: Orders
  - shop -> mail: Sends receipts
`;
    const context = 'type: systems\ntitle: Context\ninclude: [model.yaml]\nnodes:\n  customer:\n  shop:\n  mail:\n';
    fs.writeFileSync(path.join(repo, 'docs/model.yaml'), model);
    fs.writeFileSync(path.join(repo, 'docs/context.yaml'), context);
    fs.writeFileSync(path.join(repo, 'docs/shop.yaml'), shop);
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'first');

    // Only the model changes; the diagram that draws it shows the difference.
    fs.writeFileSync(path.join(repo, 'docs/model.yaml'), model.replace('label: SendGrid', 'label: Postmark').replace('Sends receipts', 'Sends mail'));
    fs.writeFileSync(path.join(repo, 'docs/shop.yaml'), grown);
    fs.writeFileSync(path.join(repo, 'docs/fresh.yaml'), shop);
    const r = run('diff', '--git', 'HEAD', 'context.yaml', 'shop.yaml', 'fresh.yaml', '--json', '-o', 'diffs', '--format', 'png');
    expect(r.err).not.toContain('error');
    expect(r.code).toBe(0);
    const [ctx, shp, fresh] = JSON.parse(r.out);
    // --since says the same as --git.
    expect(JSON.parse(run('diff', '--since', 'HEAD', 'shop.yaml', '--json').out)[0]).toMatchObject({ against: 'HEAD', counts: { added: 2, removed: 1, changed: 1 } });
    expect(ctx).toMatchObject({ file: 'context.yaml', against: 'HEAD', counts: { added: 0, removed: 0, changed: 2 } });
    expect(ctx.nodes).toEqual([{ kind: 'node', id: 'mail', status: 'changed', label: 'Postmark', changes: [{ field: 'label', before: 'SendGrid', after: 'Postmark' }] }]);
    expect(ctx.edges[0]).toMatchObject({ id: 'shop -> mail', status: 'changed', changes: [{ field: 'label', before: 'Sends receipts', after: 'Sends mail' }] });
    expect(shp.summary).toBe('2 added, 1 removed, 1 changed');
    expect(fresh).toMatchObject({ file: 'fresh.yaml', state: 'new', counts: { added: 6, removed: 0, changed: 0 } });
    for (const name of ['context', 'shop', 'fresh']) expect(fs.readFileSync(path.join(repo, 'docs/diffs', `${name}.diff.png`)).subarray(1, 4).toString()).toBe('PNG');

    // Committed: nothing differs from HEAD any more, and the first commit is still there to compare with.
    git('add', '.');
    git('commit', '-q', '-m', 'second');
    expect(run('diff', '--git', 'HEAD', 'context.yaml', '--exit-code').code).toBe(0);
    const back = run('diff', '--git', 'HEAD~1', 'context.yaml', 'shop.yaml', '--exit-code');
    expect(back.code).toBe(1);
    expect(back.out).toContain('context.yaml against HEAD~1: 2 changed');

    const bad = run('diff', '--git', 'no-such-ref', 'context.yaml');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('"no-such-ref" is not a commit, branch or tag here');
  }, 120_000);
});

describe('carto diff of access diagrams', () => {
  const before = 'type: access\nprincipals:\n  ops: { kind: group }\n  dev: { kind: group }\nresources:\n  rg: { kind: resource-group }\nroles:\n  reader: { permissions: [read] }\n  owner: { permissions: [write] }\nassignments:\n  - ops is reader on rg\n';
  it('tells who gained and lost what, as markdown with -o x.md', () => {
    write('before.yaml', before);
    write('after.yaml', before.replace('  - ops is reader on rg\n', '  - dev is owner on rg\n'));
    const r = carto('diff', 'before.yaml', 'after.yaml', '-o', 'access.md', '--exit-code');
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/\+ .*dev.* gained .*owner/i);
    expect(r.out).toMatch(/- .*ops.* lost .*reader/i);
    expect(read('access.md')).toContain('### Gained (1)');
  }, 60_000);
});

describe('carto render --layer and --all-layers', () => {
  const layered = `type: azure
title: Shop
groups:
  rg: resource-group
nodes:
  web: { kind: app-service, in: rg }
  db: { kind: sql-database, in: rg, tags: [data] }
  kv: { kind: key-vault, tags: [security] }
edges:
  - web -> db: { tags: [data] }
  - web -> kv
layers:
  data: [data]
  security: { tags: [security], dim-others: true }
`;
  it('draws one layer, or the whole and a file per layer; a deck holds them all', () => {
    write('layered.yaml', layered);
    const one = carto('render', 'layered.yaml', '--layer', 'data', '-o', 'one.svg');
    expect(one.code).toBe(0);
    expect(read('one.svg')).toContain('data layer');
    expect(read('one.svg')).not.toContain('Key Vault');
    const all = carto('render', 'layered.yaml', '--all-layers', '-o', 'layers/');
    expect(all.code).toBe(0);
    expect(['layered.svg', 'layered-data.svg', 'layered-security.svg'].every((f) => exists(`layers/${f}`))).toBe(true);
    expect(all.out).toContain('layered.yaml@security →');
    expect(carto('render', 'layered.yaml', '--all-layers', '-o', 'x.png').err).toContain('--all-layers writes one per layer');
    const deck = carto('render', 'layered.yaml', '--all-layers', '-o', 'layers.pptx');
    expect(deck.code).toBe(0);
    expect(deck.out).toContain('3 drawings: the whole and 2 layers');
    const bad = carto('render', 'layered.yaml', '--layer', 'nope');
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain('There is no layer "nope"');
    // Five runs of the command line.
  }, 60_000);
});

describe('carto share', () => {
  const model = fs.readFileSync(path.join(root, 'examples/systems/trust-zones.yaml'), 'utf8');
  it('prints a share link for a base URL, and refuses one too long for a link', () => {
    write('tm.yaml', model);
    const r = carto('share', 'tm.yaml', '--base', 'https://carto.example/');
    expect(r.code).toBe(0);
    expect(r.out.trim()).toMatch(/^https:\/\/carto\.example\/#share=[A-Za-z0-9_-]+$/);
    let big = 'type: systems\nnodes:\n';
    for (let i = 0; i < 3000; i++) big += `  n${i}: { kind: service, label: "${(i * 7919).toString(36)}-${(i * 104729).toString(36)}-${(i * 1299709).toString(36)}" }\n`;
    write('big.yaml', big);
    const no = carto('share', 'big.yaml');
    expect(no.code).toBe(1);
    expect(no.err).toContain('Share the file itself instead');
  }, 30_000);
});

describe('carto errors and help', () => {
  it('says a missing file in one line and exits 1, for every command that reads one', () => {
    for (const args of [['render', 'missing.yaml'], ['validate', 'missing.yaml'], ['share', 'missing.yaml'], ['deck', 'missing.yaml', '-o', 'd.pptx']]) {
      const r = carto(...args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err.trim(), args.join(' ')).toBe(`carto: ${args[1]}: no such file or folder`);
      expect(r.err).not.toMatch(/ENOENT|\n\s+at /);
    }
  }, 120_000);

  it('suggests the command meant, with a short usage instead of the whole manual', () => {
    const r = carto('rendr', 'x.yaml');
    expect(r.code).toBe(1);
    expect(r.err).toContain('Did you mean "carto render"?');
    expect(r.err.split('\n').length).toBeLessThan(6);
    const nothing = carto('frobnicate');
    expect(nothing.err).not.toContain('Did you mean');
    expect(nothing.err).toContain('carto --help');
  }, 120_000);

  it('has short top-level help, help per command, and the full list on request', () => {
    const top = carto('--help');
    expect(top.code).toBe(0);
    expect(top.out).toMatch(/^Draw {4}render/m);
    for (const g of ['Create', 'Draw', 'Export', 'Check', 'Look']) expect(top.out).toMatch(new RegExp(`^${g} `, 'm'));
    // One line per command in five groups, the three export-* folded into export --to: 29 lines with review, stages and serve, one screen.
    expect(top.out.trimEnd().split('\n').length).toBeLessThanOrEqual(29);
    const render = carto('render', '--help');
    expect(render.code).toBe(0);
    expect(render.out).toContain('carto render <file.yaml…>');
    // What most people need first; the rest under More options.
    const [common, more] = render.out.split('More options:');
    expect(common).toMatch(/Common options:[\s\S]*--view name[\s\S]*--step 3/);
    expect(common!.split('\n').length).toBeLessThan(12);
    expect(more).toContain('--svg-safe');
    expect(render.out).not.toMatch(/^  carto deck/m);
    expect(carto('help', 'diff').out).toContain('carto diff --git');
    expect(carto('help', 'all').out.split('\n').length).toBeGreaterThan(80);
    const bad = carto('render', 'x.yaml', '--bogus');
    expect(bad.code).toBe(1);
    expect(bad.err).toBe("carto: Unknown option '--bogus'\nOptions: carto render --help\n");
  }, 120_000);

  it('refuses formats it cannot write, before writing anything, and says what it can', () => {
    write('fmt.yaml', 'type: systems\nnodes:\n  a: service\n');
    write('afile', 'x');
    const jpg = carto('render', 'fmt.yaml', '--format', 'jpg', '-o', 'afile');
    expect(jpg.code).toBe(1);
    expect(jpg.err.trim()).toBe('carto: --format jpg is not one carto render writes; use one of: svg, png, pptx, pdf');
    const ext = carto('render', 'fmt.yaml', '-o', 'x.jpg');
    expect(ext.err.trim()).toBe('carto: -o x.jpg: carto render writes svg, png, pptx, pdf, not .jpg');
    expect(exists('x.jpg')).toBe(false);
    // A file where -o names a folder: said in words, never EEXIST.
    const inWay = carto('render', 'fmt.yaml', '-o', 'afile');
    expect(inWay.code).toBe(1);
    expect(inWay.err).toMatch(/^carto: afile: a file is in the way where a folder is needed/);
    for (const r of [jpg, ext, inWay]) expect(r.err).not.toMatch(/EEXIST|mkdir|\n\s+at /);
    expect(carto('render', 'fmt.yaml', '--scale', 'abc', '-o', 's.png').err).toContain('--scale abc: give a number above 0');
    expect(carto('describe', 'fmt.yaml', '--format', 'docx').err).toContain('carto describe writes text, md or html');
  }, 120_000);

  it('export --to is the umbrella; the export-* commands stay', () => {
    write('ex.yaml', 'type: systems\nnodes:\n  a: service\n  b: database\nedges:\n  - a -> b\n');
    expect(carto('export', 'ex.yaml', '--to', 'html', '-o', 'ex.html').code).toBe(0);
    expect(read('ex.html')).toMatch(/^<!doctype html>/i);
    expect(carto('export-html', 'ex.yaml', '-o', 'ex2.html').code).toBe(0);
    const bad = carto('export', 'ex.yaml', '--to', 'pdf');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('carto render <file> -o out.pdf');
  }, 120_000);

  it('shares to the dev server by default', () => {
    write('one.yaml', 'type: systems\nnodes:\n  a: service\n');
    expect(carto('share', 'one.yaml').out).toMatch(/^http:\/\/localhost:5178\/#/);
  }, 120_000);

  it('takes -o as a folder only when it ends in / or has no extension', () => {
    write('views.yaml', shop);
    const r = carto('render', 'views.yaml', '--all-views', '-o', 'x.png');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^carto: -o x\.png names one file, but --all-views writes one per view: give a folder, e\.g\. -o x\//);
    expect(exists('x.png')).toBe(false);
    expect(carto('render', 'views.yaml', '--all-views', '-o', 'pics/').code).toBe(0);
    expect(exists('pics/views-data.svg')).toBe(true);
    expect(carto('render', 'views.yaml', '-o', 'one.svg').code).toBe(0);
    expect(fs.statSync(path.join(tmp, 'one.svg')).isFile()).toBe(true);
  }, 120_000);

  it('writes nothing when the drawing has errors', () => {
    write('views.yaml', shop);
    const r = carto('render', 'views.yaml', '--view', 'nope', '-o', 'nope.png');
    expect(r.code).toBe(1);
    expect(r.err).toContain('There is no view "nope"');
    expect(r.err).toContain('nothing written');
    expect(exists('nope.png')).toBe(false);
  }, 120_000);

  it('takes - as standard output (and input) wherever a file is named', () => {
    const made = carto('new', 'mindmap', '-');
    expect(made.code).toBe(0);
    expect(made.out).toMatch(/^type: mindmap/);
    expect(exists('-')).toBe(false);
    write('views.yaml', shop);
    const svg = carto('render', 'views.yaml', '-o', '-');
    expect(svg.code).toBe(0);
    expect(svg.out).toMatch(/^<svg /);
    expect(svg.err).toContain('→ standard output');
    expect(exists('-')).toBe(false);
    const piped = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), 'render', '-'], { cwd: tmp, encoding: 'utf8', input: shop });
    expect(piped.status).toBe(0);
    expect(piped.stdout).toMatch(/^<svg /);
    expect(carto('render', 'views.yaml', '--all-views', '-o', '-').err).toContain('-o - writes one picture');
  }, 120_000);

  it('leaves empty views out of --all-views', () => {
    write('access.yaml', 'type: access\nprincipals:\n  ops: { kind: group }\nresources:\n  rg: { kind: resource-group }\nroles:\n  reader: { permissions: [read] }\nassignments:\n  - ops is reader on rg\n');
    const r = carto('render', 'access.yaml', '--all-views', '-o', 'acc/');
    expect(r.code).toBe(0);
    expect(fs.readdirSync(path.join(tmp, 'acc')).sort()).toEqual(['access-access.svg', 'access-graph.svg', 'access-roles.svg', 'access.svg']);
  }, 120_000);
});

describe('a sidecar that cannot be read', () => {
  it('leaves out a bad entry with a warning, never a NaN in the drawing', () => {
    write('odd.yaml', shop);
    write('odd.layout.json', JSON.stringify({ nodes: { meters: 'zz', web: { x: 40, y: 'n' } } }));
    const r = carto('render', 'odd.yaml');
    expect(r.code).toBe(0);
    expect(r.err).toContain('odd.layout.json  warning  nodes.meters: not a position {x, y}; ignored');
    expect(r.err).toContain('nodes.web: not a position');
    expect(read('odd.svg').replace(/<style>[^]*?<\/style>/g, '')).not.toContain('NaN');
  }, 30000);

  it('names the file when it is not JSON', () => {
    write('broken.yaml', shop);
    write('broken.layout.json', '{ "nodes": ');
    const r = carto('render', 'broken.yaml');
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('broken.layout.json: not valid JSON');
  }, 30000);
});

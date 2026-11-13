// The command line as CI runs it: exit codes, messages and what lands on disk. In-process through
// run(); the last block runs the real program, as a smoke test of the process around it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { toPptx, type SlideText } from '@cartography/export';
import { corporateTemplate } from '../../export/test/fixtures/templates.ts';
import { carto as inProcess, spawnCarto } from './support/carto.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'carto-cli-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const carto = (...args: string[]) => inProcess(tmp, args);
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
  it('notes the layout in the sidecar, once, and plain render never writes it', async () => {
    write('shop.yaml', shop);
    expect((await carto('render', 'shop.yaml')).code).toBe(0);
    expect(exists('shop.layout.json')).toBe(false);

    const first = await carto('render', 'shop.yaml', '--stable', '--all-views');
    expect(first.code).toBe(0);
    expect(first.out).toContain('layout noted');
    const sidecar = JSON.parse(read('shop.layout.json'));
    expect(sidecar.layout.variant).toMatch(/^(right|down)\//);
    expect(sidecar.layout.at).toMatch(/db@[\d.-]+,[\d.-]+;kv@[\d.-]+,[\d.-]+;web@[\d.-]+,[\d.-]+;#rg@/);
    expect(sidecar.views.data.layout.at).toMatch(/^db@[^;]+;web@[^;]+;#rg@/);

    // Nothing changed: nothing written, and the picture is the same with or without the note.
    const noted = read('shop.layout.json');
    const svg = read('shop.svg');
    const again = await carto('render', 'shop.yaml', '--stable', '--all-views');
    expect(again.out).not.toContain('layout noted');
    expect(read('shop.layout.json')).toBe(noted);
    expect(read('shop.svg')).toBe(svg);

    // An edit: plain render reads the note and leaves it alone.
    write('shop.yaml', shop.replace('  kv: key-vault\n', '  kv: key-vault\n  cache: redis\n').replace('  - web -> kv\n', '  - web -> kv\n  - web -> cache\n'));
    expect((await carto('render', 'shop.yaml')).code).toBe(0);
    expect(read('shop.layout.json')).toBe(noted);
    // --stable brings it up to date, and keeps pins that were there.
    fs.writeFileSync(path.join(tmp, 'shop.layout.json'), JSON.stringify({ ...sidecar, nodes: { kv: { x: 700, y: 40 } } }));
    expect((await carto('render', 'shop.yaml', '--stable')).out).toContain('layout noted');
    const updated = JSON.parse(read('shop.layout.json'));
    expect(updated.layout.at).toContain('cache@');
    expect(updated.nodes).toEqual({ kv: { x: 700, y: 40 } });
    expect(updated.views.data.layout).toEqual(sidecar.views.data.layout);
  }, 60_000);
});

describe('carto validate --drift', () => {
  it('fails on stale entries, naming the file and the ids; --fix drops them', async () => {
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
    expect((await carto('validate', 'drift.yaml')).code).toBe(0);

    const bad = await carto('validate', 'drift.yaml', '--drift');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('drift.layout.json  stale  nodes.cache: pinned node "cache" is not drawn');
    expect(bad.err).toContain('edges.e7: bent line "e7" is not drawn');
    expect(bad.err).toContain('locked.cache');
    expect(bad.err).toContain('views.old: view "old" does not exist (views: data)');
    expect(bad.err).toContain('4 stale entries');
    expect(bad.out).not.toContain('ok');
    expect(JSON.parse(read('drift.layout.json'))).toEqual(sidecar);

    const fixed = await carto('validate', 'drift.yaml', '--drift', '--fix');
    expect(fixed.code).toBe(0);
    expect(fixed.out).toContain('4 stale entries dropped');
    expect(JSON.parse(read('drift.layout.json'))).toEqual({ version: 1, nodes: { web: { x: 10, y: 10 } } });

    const clean = await carto('validate', 'drift.yaml', '--drift');
    expect(clean.code).toBe(0);
    expect(clean.err).toBe('');
  }, 60_000);

  it('removes a sidecar with nothing left, and passes files without one', async () => {
    write('gone.yaml', shop);
    write('gone.layout.json', JSON.stringify({ version: 1, nodes: { nope: { x: 1, y: 1 } } }));
    write('plain.yaml', shop);
    expect((await carto('validate', 'gone.yaml', 'plain.yaml', '--drift')).code).toBe(1);
    const fixed = await carto('validate', 'gone.yaml', 'plain.yaml', '--drift', '--fix');
    expect(fixed.code).toBe(0);
    expect(fixed.out).toContain('file removed');
    expect(exists('gone.layout.json')).toBe(false);
  }, 60_000);
});

describe('carto validate on a slide', () => {
  // 30 messages: far too tall for one 16:9 slide as a whole.
  const msgs = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `  - a -> b: Message ${from + i + 1}\n  - b --> a: ok\n`).join('');
  const head = 'type: sequence\ntitle: Long\nparticipants:\n  a: person\n  b: service\nmessages:\n';

  it('warns about a long sequence without phases', async () => {
    write('long.yaml', head + msgs(15));
    const r = await carto('validate', 'long.yaml');
    expect(r.err).toMatch(/warning {2}On a 16:9 slide its smallest text is [\d.]+ pt, under 6 pt/);
  }, 60_000);

  it('says the smallest text the PowerPoint slide has, on our own slide or the template\'s', async () => {
    const chain = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const text = `type: systems\ntitle: A long chain\nnodes:\n${chain.map((id, i) => `  ${id}: { kind: service, label: Service number ${i + 1} }`).join('\n')}\nedges:\n${chain.slice(1).map((id, i) => `  - ${chain[i]} -> ${id}: calls`).join('\n')}\n`;
    write('chain.yaml', text);
    const x = await render(text, { fonts: 'none' });
    const slide = async (template?: Uint8Array) => {
      const seen: SlideText[] = [];
      await toPptx(x, { theme: x.theme, steps: false, ...(template ? { template } : {}), onSlide: (s) => seen.push(s) });
      return seen[0]!.smallestPt;
    };
    const said = (err: string) => Number(/its smallest text is ([\d.]+) pt/.exec(err)?.[1]);
    const ours = await carto('validate', 'chain.yaml');
    expect(ours.err).toMatch(/On a 16:9 slide its smallest text is [\d.]+ pt/);
    expect(said(ours.err)).toBe(await slide());
    // In a template the room is the template's: smaller here, under its title bar and above its footers.
    const corporate = corporateTemplate();
    fs.writeFileSync(path.join(tmp, 'corporate.potx'), corporate);
    const theirs = await carto('validate', 'chain.yaml', '--template', 'corporate.potx');
    expect(theirs.err).toMatch(/On a slide of the template its smallest text is [\d.]+ pt/);
    expect(said(theirs.err)).toBe(await slide(corporate));
    expect(said(theirs.err)).toBeLessThan(said(ours.err));
  }, 60_000);

  it('checks the phases of a sequence for slides, and only hints at the whole', async () => {
    write('phased.yaml', `${head}  - divider: One\n${msgs(5)}  - divider: Two\n${msgs(5, 5)}  - divider: Three\n${msgs(5, 10)}`);
    const r = await carto('validate', 'phased.yaml');
    expect(r.code).toBe(0);
    expect(r.err).not.toContain('warning');
    expect(r.err).toMatch(/hint {2}On a 16:9 slide the whole drawing is [\d.]+ pt: present it per view \(phase-one, phase-two, phase-three\)/);
    // A phase too long for a slide is still said.
    write('phased.yaml', `${head}  - divider: One\n${msgs(15)}  - divider: Two\n${msgs(1)}`);
    expect((await carto('validate', 'phased.yaml')).err).toMatch(/warning {2}View "phase-one": on a 16:9 slide/);
  }, 60_000);

  it('checks the steps as their slides show them, once per drawing, naming the step that takes the room', async () => {
    // Just readable on a slide as a whole, and so are its steps: each title and caption fits on one line.
    // The example has room to spare, so here it has none: group names at 10 px, one more account written
    // to, and no notes beside the drawing.
    const ok = fs
      .readFileSync(path.join(root, 'examples/azure/workload-identities.yaml'), 'utf8')
      .replace(/^(subtitle: .*)$/m, '$1\ntheme: { extends: survey, group: { labelSize: 10 } }')
      .replace(/^( {2}stshopexportsprod: .*)$/m, '$1\n  logs: { kind: storage, label: stshoplogs, in: rg-shop-prod }')
      .replace(/^( {2}- id-shop-jobs-prod -> microsoft-graph:)/m, '  - id-shop-jobs-prod -> logs: { label: Storage Blob Data Reader, style: role }\n$1')
      .replace(/^ {4}note: .*\n/gm, '');
    write('ids.yaml', ok);
    const clean = await carto('validate', 'ids.yaml');
    expect(clean.code).toBe(0);
    expect(clean.err).not.toContain('warning');
    // One caption that runs to two lines makes every step smaller: said once, naming that step.
    const caption = /caption: (Only northwind\/shop[^\n]*)/.exec(ok)![1]!;
    write('ids.yaml', ok.replace(caption, `${caption} The workflow presents that token itself, and the federated credential checks its subject.`));
    const r = await carto('validate', 'ids.yaml');
    expect(r.code).toBe(0);
    const warnings = r.err.split('\n').filter((l) => l.includes('warning'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/warning {2}All 5 steps: on a 16:9 slide their smallest text is [\d.]+ pt, under 6 pt \(the drawing alone: [\d.]+ pt\): the title and caption of step 2 "Deploying from GitHub" run to 2 lines/);
  }, 60_000);
});

describe('carto diff', () => {
  const grown = shop.replace('  kv: key-vault\n', '  kv: { kind: key-vault, label: Secrets }\n  cache: { kind: redis, in: rg }\n').replace('  - web -> kv\n', '  - web -> cache\n');

  it('compares two files: words, json, a picture, an exit code', async () => {
    write('old.yaml', shop);
    write('new.yaml', grown);
    const text = await carto('diff', 'old.yaml', 'new.yaml');
    expect(text.code).toBe(0);
    expect(text.out).toContain('new.yaml against old.yaml: 2 added, 1 removed, 1 changed');
    expect(text.out).toMatch(/\+ node  cache/);
    expect(text.out).toMatch(/~ node  kv +label: "Key Vault" → "Secrets"/);
    expect(text.out).toMatch(/- line  web -> kv/);
    expect(text.out).toMatch(/\+ line  web -> cache/);

    const json = JSON.parse((await carto('diff', 'old.yaml', 'new.yaml', '--json')).out);
    expect(json).toMatchObject({ file: 'new.yaml', against: 'old.yaml', summary: '2 added, 1 removed, 1 changed', counts: { added: 2, removed: 1, changed: 1 }, same: false });
    expect(json.nodes.map((n: { id: string; status: string }) => `${n.status} ${n.id}`).sort()).toEqual(['added cache', 'changed kv']);

    // No picture unless asked; with -o one file, svg or png by its name.
    expect(exists('new.diff.svg')).toBe(false);
    const svg = await carto('diff', 'old.yaml', 'new.yaml', '-o', 'out/shop.svg');
    expect(svg.code).toBe(0);
    expect(read('out/shop.svg')).toContain('<g data-diff="added" data-node="cache">');
    expect(read('out/shop.svg')).toContain('against old.yaml');
    expect((await carto('diff', 'old.yaml', 'new.yaml', '-o', 'out/shop.png', '--side-by-side')).code).toBe(0);
    expect(fs.readFileSync(path.join(tmp, 'out/shop.png')).subarray(1, 4).toString()).toBe('PNG');
    // A folder: named after the diagram, and after the view when one is asked for.
    expect((await carto('diff', 'old.yaml', 'new.yaml', '-o', 'pics', '--view', 'data')).code).toBe(0);
    expect(read('pics/new-data.diff.svg')).toContain('No changes against old.yaml');

    // For CI: the exit code says whether anything changed, only when asked.
    expect((await carto('diff', 'old.yaml', 'new.yaml', '--exit-code')).code).toBe(1);
    const same = await carto('diff', 'old.yaml', 'old.yaml', '--exit-code');
    expect(same.code).toBe(0);
    expect(same.out).toContain('no changes');
  }, 120_000);

  it('says what is wrong with the arguments', async () => {
    const one = await carto('diff', 'old.yaml');
    expect(one.code).toBe(1);
    expect(one.err).toContain('Two files');
    const none = await carto('diff', 'nope-a.yaml', 'nope-b.yaml');
    expect(none.code).toBe(1);
    expect(none.err).toContain('not found');
  }, 60_000);

  it('compares with a snapshot the editor wrote, and says the changes in sentences', async () => {
    write('snap.yaml', grown);
    fs.mkdirSync(path.join(tmp, 'snap.snapshots'), { recursive: true });
    write('snap.snapshots/Q3-review.yaml', shop);
    const r = await carto('diff', '--snapshot', 'Q3 review', 'snap.yaml', '--json');
    expect(r.code).toBe(0);
    const [json] = JSON.parse(r.out);
    expect(json).toMatchObject({ file: 'snap.yaml', against: 'snapshot Q3 review', counts: { added: 2, removed: 1, changed: 1 } });
    expect(json.explained).toEqual(['Added Cache for Redis in rg', 'App Service now connects to Cache for Redis', 'Renamed “Key Vault” to “Secrets”; its kind now “Key Vault”', 'App Service no longer connects to Key Vault']);
    expect((await carto('diff', '--snapshot', 'Q3 review', 'snap.yaml', '-o', 'snap.md')).code).toBe(0);
    expect(read('snap.md')).toMatch(/^## Changes to snap.yaml since snapshot Q3 review\n\n2 added, 1 removed, 1 changed\.\n\n- Added /);
    const missing = await carto('diff', '--snapshot', 'nope', 'snap.yaml');
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('there are: Q3-review');
  }, 60_000);

  it('compares the working tree with a commit, through included files too', async () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    const git = (...args: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout.trim();
    };
    const run = (...args: string[]) => inProcess(path.join(repo, 'docs'), args);
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
    const r = await run('diff', '--git', 'HEAD', 'context.yaml', 'shop.yaml', 'fresh.yaml', '--json', '-o', 'diffs', '--format', 'png');
    expect(r.err).not.toContain('error');
    expect(r.code).toBe(0);
    const [ctx, shp, fresh] = JSON.parse(r.out);
    // --since says the same as --git.
    expect(JSON.parse((await run('diff', '--since', 'HEAD', 'shop.yaml', '--json')).out)[0]).toMatchObject({ against: 'HEAD', counts: { added: 2, removed: 1, changed: 1 } });
    expect(ctx).toMatchObject({ file: 'context.yaml', against: 'HEAD', counts: { added: 0, removed: 0, changed: 2 } });
    expect(ctx.nodes).toEqual([{ kind: 'node', id: 'mail', status: 'changed', label: 'Postmark', changes: [{ field: 'label', before: 'SendGrid', after: 'Postmark' }] }]);
    expect(ctx.edges[0]).toMatchObject({ id: 'shop -> mail', status: 'changed', changes: [{ field: 'label', before: 'Sends receipts', after: 'Sends mail' }] });
    expect(shp.summary).toBe('2 added, 1 removed, 1 changed');
    expect(fresh).toMatchObject({ file: 'fresh.yaml', state: 'new', counts: { added: 6, removed: 0, changed: 0 } });
    for (const name of ['context', 'shop', 'fresh']) expect(fs.readFileSync(path.join(repo, 'docs/diffs', `${name}.diff.png`)).subarray(1, 4).toString()).toBe('PNG');

    // Committed: nothing differs from HEAD any more, and the first commit is still there to compare with.
    git('add', '.');
    git('commit', '-q', '-m', 'second');
    expect((await run('diff', '--git', 'HEAD', 'context.yaml', '--exit-code')).code).toBe(0);
    const back = await run('diff', '--git', 'HEAD~1', 'context.yaml', 'shop.yaml', '--exit-code');
    expect(back.code).toBe(1);
    expect(back.out).toContain('context.yaml against HEAD~1: 2 changed');

    const bad = await run('diff', '--git', 'no-such-ref', 'context.yaml');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('"no-such-ref" is not a commit, branch or tag here');
  }, 120_000);
});

describe('carto diff of access diagrams', () => {
  const before = 'type: access\nprincipals:\n  ops: { kind: group }\n  dev: { kind: group }\nresources:\n  rg: { kind: resource-group }\nroles:\n  reader: { permissions: [read] }\n  owner: { permissions: [write] }\nassignments:\n  - ops is reader on rg\n';
  it('tells who gained and lost what, as markdown with -o x.md', async () => {
    write('before.yaml', before);
    write('after.yaml', before.replace('  - ops is reader on rg\n', '  - dev is owner on rg\n'));
    const r = await carto('diff', 'before.yaml', 'after.yaml', '-o', 'access.md', '--exit-code');
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
  it('draws one layer, or the whole and a file per layer; a deck holds them all', async () => {
    write('layered.yaml', layered);
    const one = await carto('render', 'layered.yaml', '--layer', 'data', '-o', 'one.svg');
    expect(one.code).toBe(0);
    expect(read('one.svg')).toContain('data layer');
    expect(read('one.svg')).not.toContain('Key Vault');
    const all = await carto('render', 'layered.yaml', '--all-layers', '-o', 'layers/');
    expect(all.code).toBe(0);
    expect(['layered.svg', 'layered--data.svg', 'layered--security.svg'].every((f) => exists(`layers/${f}`))).toBe(true);
    expect(all.out).toContain('layered.yaml@security →');
    expect((await carto('render', 'layered.yaml', '--all-layers', '-o', 'x.png')).err).toContain('--all-layers writes one per layer');
    const deck = await carto('render', 'layered.yaml', '--all-layers', '-o', 'layers.pptx');
    expect(deck.code).toBe(0);
    expect(deck.out).toContain('3 drawings: the whole and 2 layers');
    const bad = await carto('render', 'layered.yaml', '--layer', 'nope');
    expect(bad.code).not.toBe(0);
    expect(bad.err).toContain('There is no layer "nope"');
    // Five runs of the command line.
  }, 60_000);
});

describe('carto share', () => {
  const model = fs.readFileSync(path.join(root, 'examples/systems/trust-zones.yaml'), 'utf8');
  it('prints a share link for a base URL, and refuses one too long for a link', async () => {
    write('tm.yaml', model);
    const r = await carto('share', 'tm.yaml', '--base', 'https://carto.example/');
    expect(r.code).toBe(0);
    expect(r.out.trim()).toMatch(/^https:\/\/carto\.example\/#share=[A-Za-z0-9_-]+$/);
    let big = 'type: systems\nnodes:\n';
    for (let i = 0; i < 3000; i++) big += `  n${i}: { kind: service, label: "${(i * 7919).toString(36)}-${(i * 104729).toString(36)}-${(i * 1299709).toString(36)}" }\n`;
    write('big.yaml', big);
    const no = await carto('share', 'big.yaml');
    expect(no.code).toBe(1);
    expect(no.err).toContain('Share the file itself instead');
  }, 30_000);
});

describe('carto errors and help', () => {
  it('says a missing file in one line and exits 1, for every command that reads one', async () => {
    for (const args of [['render', 'missing.yaml'], ['validate', 'missing.yaml'], ['share', 'missing.yaml'], ['deck', 'missing.yaml', '-o', 'd.pptx']]) {
      const r = await carto(...args);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.err.trim(), args.join(' ')).toBe(`carto: ${args[1]}: no such file or folder`);
      expect(r.err).not.toMatch(/ENOENT|\n\s+at /);
    }
  }, 120_000);

  it('suggests the command meant, with a short usage instead of the whole manual', async () => {
    const r = await carto('rendr', 'x.yaml');
    expect(r.code).toBe(1);
    expect(r.err).toContain('Did you mean "carto render"?');
    expect(r.err.split('\n').length).toBeLessThan(6);
    const nothing = await carto('frobnicate');
    expect(nothing.err).not.toContain('Did you mean');
    expect(nothing.err).toContain('carto --help');
  }, 120_000);

  it('has short top-level help, help per command, and the full list on request', async () => {
    const top = await carto('--help');
    expect(top.code).toBe(0);
    expect(top.out).toMatch(/^Draw {4}render/m);
    for (const g of ['Create', 'Draw', 'Export', 'Check', 'Look']) expect(top.out).toMatch(new RegExp(`^${g} `, 'm'));
    // One line per command in five groups, one screen.
    expect(top.out.trimEnd().split('\n').length).toBeLessThanOrEqual(29);
    const render = await carto('render', '--help');
    expect(render.code).toBe(0);
    expect(render.out).toContain('carto render <file.yaml…>');
    // What most people need first; the rest under More options.
    const [common, more] = render.out.split('More options:');
    expect(common).toMatch(/Common options:[\s\S]*--view name[\s\S]*--step 3/);
    expect(common!.split('\n').length).toBeLessThan(12);
    expect(more).toContain('--svg-safe');
    expect(render.out).not.toMatch(/^  carto deck/m);
    expect((await carto('help', 'diff')).out).toContain('carto diff --git');
    expect((await carto('help', 'all')).out.split('\n').length).toBeGreaterThan(60);
    const bad = await carto('render', 'x.yaml', '--bogus');
    expect(bad.code).toBe(1);
    expect(bad.err).toBe("carto: Unknown option '--bogus'\nOptions: carto render --help\n");
  }, 120_000);

  it('refuses formats it cannot write, before writing anything, and says what it can', async () => {
    write('fmt.yaml', 'type: systems\nnodes:\n  a: service\n');
    write('afile', 'x');
    const jpg = await carto('render', 'fmt.yaml', '--format', 'jpg', '-o', 'afile');
    expect(jpg.code).toBe(1);
    expect(jpg.err.trim()).toBe('carto: --format jpg is not one carto render writes; use one of: svg, png, pptx, pdf');
    const ext = await carto('render', 'fmt.yaml', '-o', 'x.jpg');
    expect(ext.err.trim()).toBe('carto: -o x.jpg: carto render writes svg, png, pptx, pdf, not .jpg');
    expect(exists('x.jpg')).toBe(false);
    // A file where -o names a folder: said in words, never EEXIST.
    const inWay = await carto('render', 'fmt.yaml', '-o', 'afile');
    expect(inWay.code).toBe(1);
    expect(inWay.err).toMatch(/^carto: afile: a file is in the way where a folder is needed/);
    for (const r of [jpg, ext, inWay]) expect(r.err).not.toMatch(/EEXIST|mkdir|\n\s+at /);
    expect((await carto('render', 'fmt.yaml', '--scale', 'abc', '-o', 's.png')).err).toContain('--scale abc: give a number above 0');
    expect((await carto('describe', 'fmt.yaml', '--format', 'docx')).err).toContain('carto describe writes text, md or html');
  }, 120_000);

  it('export --to is the umbrella; the export-* commands stay', async () => {
    write('ex.yaml', 'type: systems\nnodes:\n  a: service\n  b: database\nedges:\n  - a -> b\n');
    expect((await carto('export', 'ex.yaml', '--to', 'html', '-o', 'ex.html')).code).toBe(0);
    expect(read('ex.html')).toMatch(/^<!doctype html>/i);
    expect((await carto('export-html', 'ex.yaml', '-o', 'ex2.html')).code).toBe(0);
    const bad = await carto('export', 'ex.yaml', '--to', 'pdf');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('carto render <file> -o out.pdf');
  }, 120_000);

  it('shares to the dev server by default', async () => {
    write('one.yaml', 'type: systems\nnodes:\n  a: service\n');
    expect((await carto('share', 'one.yaml')).out).toMatch(/^http:\/\/localhost:5178\/#/);
  }, 120_000);

  it('takes -o as a folder only when it ends in / or has no extension', async () => {
    write('views.yaml', shop);
    const r = await carto('render', 'views.yaml', '--all-views', '-o', 'x.png');
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^carto: -o x\.png names one file, but --all-views writes one per view: give a folder, e\.g\. -o x\//);
    expect(exists('x.png')).toBe(false);
    expect((await carto('render', 'views.yaml', '--all-views', '-o', 'pics/')).code).toBe(0);
    expect(exists('pics/views--data.svg')).toBe(true);
    expect((await carto('render', 'views.yaml', '-o', 'one.svg')).code).toBe(0);
    expect(fs.statSync(path.join(tmp, 'one.svg')).isFile()).toBe(true);
  }, 120_000);

  it('names a view so that it is never another file’s view', async () => {
    // views.yaml#data-x and views-data.yaml#x were both views-data-x.svg.
    write('views.yaml', shop.replace('  data: {', '  data-x: {'));
    write('views-data.yaml', shop.replace('  data: {', '  x: {'));
    expect((await carto('render', 'views.yaml', 'views-data.yaml', '--all-views', '-o', 'apart/')).code).toBe(0);
    expect(fs.readdirSync(path.join(tmp, 'apart')).sort()).toEqual(['views--data-x.svg', 'views-data--x.svg', 'views-data.svg', 'views.svg']);
  }, 120_000);

  it('writes nothing when the drawing has errors', async () => {
    write('views.yaml', shop);
    const r = await carto('render', 'views.yaml', '--view', 'nope', '-o', 'nope.png');
    expect(r.code).toBe(1);
    expect(r.err).toContain('There is no view "nope"');
    expect(r.err).toContain('nothing written');
    expect(exists('nope.png')).toBe(false);
  }, 120_000);

  it('takes - as standard output (and input) wherever a file is named', async () => {
    const made = await carto('new', 'mindmap', '-');
    expect(made.code).toBe(0);
    expect(made.out).toMatch(/^type: mindmap/);
    expect(exists('-')).toBe(false);
    write('views.yaml', shop);
    const svg = await carto('render', 'views.yaml', '-o', '-');
    expect(svg.code).toBe(0);
    expect(svg.out).toMatch(/^<svg /);
    expect(svg.err).toContain('→ standard output');
    expect(exists('-')).toBe(false);
    const piped = await inProcess(tmp, ['render', '-'], { input: shop });
    expect(piped.code).toBe(0);
    expect(piped.out).toMatch(/^<svg /);
    expect((await carto('render', 'views.yaml', '--all-views', '-o', '-')).err).toContain('-o - writes one picture');
  }, 120_000);

  it('puts every view in one deck with --all-views: a slide (page) each after the drawing as written, each drawing once', async () => {
    write('access.yaml', 'type: access\nprincipals:\n  ops: { kind: group }\nresources:\n  rg: { kind: resource-group }\nroles:\n  reader: { permissions: [read] }\nassignments:\n  - ops is reader on rg\n');
    // As SVG: the drawing as written and a file per view (access.svg and access-access.svg are the same drawing).
    // In a deck the drawing as written is the access view: not a second time.
    const r = await carto('render', 'access.yaml', '--all-views', '-o', 'acc.pptx');
    expect(r.code).toBe(0);
    expect(r.out).toContain('3 drawings: the whole and 2 views');
    // The part names stand uncompressed in the zip.
    expect(new Set(fs.readFileSync(path.join(tmp, 'acc.pptx'), 'latin1').match(/ppt\/slides\/slide\d+\.xml/g)).size).toBe(3);
    expect((await carto('render', 'access.yaml', '--all-views', '-o', 'acc.pdf')).code).toBe(0);
    expect(fs.readFileSync(path.join(tmp, 'acc.pdf'), 'latin1').match(/\/Type \/Page\b/g)).toHaveLength(3);
    // A sequence's whole is the drawing as written: the whole, then a slide per phase.
    const seq = await carto('render', path.join(root, 'examples/sequence/entra-sign-in.yaml'), '--all-views', '-o', 'seq.pptx');
    expect(seq.out).toContain('3 drawings: the whole and 2 views');
  }, 120_000);

  it('leaves empty views out of --all-views', async () => {
    write('access.yaml', 'type: access\nprincipals:\n  ops: { kind: group }\nresources:\n  rg: { kind: resource-group }\nroles:\n  reader: { permissions: [read] }\nassignments:\n  - ops is reader on rg\n');
    const r = await carto('render', 'access.yaml', '--all-views', '-o', 'acc/');
    expect(r.code).toBe(0);
    expect(fs.readdirSync(path.join(tmp, 'acc')).sort()).toEqual(['access--access.svg', 'access--graph.svg', 'access--roles.svg', 'access.svg']);
  }, 120_000);
});

describe('carto with a value it does not take', () => {
  const steps = `${shop}steps:\n  - { title: One, show: [web] }\n  - { title: Two, show: [web, db] }\n`;

  it('says which values there are and exits 1: --step, --aspect, --page', async () => {
    write('steps.yaml', steps);
    const step = await carto('render', 'steps.yaml', '--step', '9', '-o', 'nine.svg');
    expect(step.code).toBe(1);
    expect(step.err).toContain('--step 9: it has 2 steps; use one of 1–2');
    expect(exists('nine.svg')).toBe(false);
    expect((await carto('render', 'steps.yaml', '--step', 'two')).err).toBe('carto: --step two: give a step number from 1, e.g. --step 2\n');
    const aspect = await carto('deck', 'steps.yaml', '--aspect', '3:2', '-o', 'd.pptx');
    expect([aspect.code, aspect.err]).toEqual([1, 'carto: --aspect 3:2 is not a slide shape carto makes; use one of: 16:9, 4:3\n']);
    const page = await carto('deck', 'steps.yaml', '--page', 'letter', '-o', 'd.pdf');
    expect([page.code, page.err]).toEqual([1, 'carto: --page letter is not a page size carto makes; use one of: fit, a4, a3\n']);
    expect((await carto('render', 'steps.yaml', '--page', 'letter', '-o', 'd.pdf')).code).toBe(1);
  }, 60_000);

  it('writes one step to the file named, and says its version', async () => {
    write('steps.yaml', steps);
    expect((await carto('render', 'steps.yaml', '--step', '2', '-o', 'two.pptx')).code).toBe(0);
    expect(exists('two.pptx')).toBe(true);
    expect(exists('two-step-02.pptx')).toBe(false);
    const v = await carto('--version');
    expect(v.code).toBe(0);
    expect(v.out).toMatch(/^carto \d+\.\d+\.\d+\n$/);
  }, 60_000);

  it('reads standard input for describe and validate, and export-html -o - writes standard output', async () => {
    const described = await inProcess(tmp, ['describe', '-'], { input: shop });
    expect(described.code).toBe(0);
    expect(described.out).toContain('3 elements');
    const valid = await inProcess(tmp, ['validate', '-'], { input: shop });
    expect([valid.code, valid.out]).toEqual([0, 'stdin ok\n']);
    write('page.yaml', shop);
    const html = await carto('export-html', 'page.yaml', '-o', '-');
    expect(html.code).toBe(0);
    expect(html.out).toMatch(/^<!doctype html>/i);
    expect(html.err).toContain('→ standard output');
    expect(exists('-')).toBe(false);
  }, 60_000);

  it('warns when a deck\'s text is too small, as validate does: 4:3 and a template too', async () => {
    const chain = Array.from({ length: 12 }, (_, i) => `s${i}`);
    write('chain.yaml', `type: systems\ntitle: A long chain\nnodes:\n${chain.map((id, i) => `  ${id}: { kind: service, label: Service number ${i + 1} }`).join('\n')}\nedges:\n${chain.slice(1).map((id, i) => `  - ${chain[i]} -> ${id}: calls`).join('\n')}\n`);
    fs.writeFileSync(path.join(tmp, 'corporate.potx'), corporateTemplate());
    const four = await carto('deck', 'chain.yaml', '--aspect', '4:3', '-o', 'four.pptx');
    expect(four.code).toBe(0);
    expect(four.err).toMatch(/chain\.yaml {2}warning {2}"A long chain" \(slide 1\): on a 4:3 slide its smallest text is [\d.]+ pt, under 6 pt: a 16:9 slide \(--aspect 16:9\)/);
    const template = await carto('render', 'chain.yaml', '--template', 'corporate.potx', '-o', 'tpl.pptx');
    expect(template.code).toBe(0);
    expect(template.err).toMatch(/warning {2}"A long chain" \(slide 1\): on a slide of the template its smallest text is [\d.]+ pt/);
  }, 60_000);
});

describe('a sidecar that cannot be read', () => {
  it('leaves out a bad entry with a warning, never a NaN in the drawing', async () => {
    write('odd.yaml', shop);
    write('odd.layout.json', JSON.stringify({ nodes: { meters: 'zz', web: { x: 40, y: 'n' } } }));
    const r = await carto('render', 'odd.yaml');
    expect(r.code).toBe(0);
    expect(r.err).toContain('odd.layout.json  warning  nodes.meters: not a position {x, y}; ignored');
    expect(r.err).toContain('nodes.web: not a position');
    expect(read('odd.svg').replace(/<style>[^]*?<\/style>/g, '')).not.toContain('NaN');
  }, 30000);

  it('names the file when it is not JSON', async () => {
    write('broken.yaml', shop);
    write('broken.layout.json', '{ "nodes": ');
    const r = await carto('render', 'broken.yaml');
    expect(r.code).not.toBe(0);
    expect(r.err).toContain('broken.layout.json: not valid JSON');
  }, 30000);
});

describe('the real program (smoke test)', () => {
  it('exits with the code run() gives, reads standard input, and writes the picture to standard output', () => {
    write('smoke.yaml', shop);
    const help = spawnCarto(tmp, ['--help']);
    expect(help.code).toBe(0);
    expect(help.out).toMatch(/^Draw {4}render/m);
    const piped = spawnCarto(tmp, ['render', '-'], { input: shop });
    expect(piped.code).toBe(0);
    expect(piped.out).toMatch(/^<svg /);
    expect(piped.err).toContain('→ standard output');
    expect(spawnCarto(tmp, ['render', 'smoke.yaml', '-o', 'smoke.png']).code).toBe(0);
    expect(fs.readFileSync(path.join(tmp, 'smoke.png')).subarray(1, 4).toString()).toBe('PNG');
    const missing = spawnCarto(tmp, ['render', 'missing.yaml']);
    expect(missing.code).toBe(1);
    expect(missing.err).toBe('carto: missing.yaml: no such file or folder\n');
    const bad = spawnCarto(tmp, ['render', 'x.yaml', '--bogus']);
    expect(bad.code).toBe(1);
    expect(bad.err).toBe("carto: Unknown option '--bogus'\nOptions: carto render --help\n");
  }, 60_000);
});

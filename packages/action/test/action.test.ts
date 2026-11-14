// The action without GitHub: a local repository with a bare "origin" stands in for the checkout,
// a made-up event file for the pull request, and a fake for the one API the action calls.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { versionOnDisk } from '@linework/diff/node';
import {
  ApiError,
  commentBody,
  commitPictures,
  diagrams,
  githubApi,
  imageUrl,
  isDiagram,
  MARKER,
  pathspecs,
  plan,
  publish,
  renderAll,
  resolveBase,
  run,
  shoot,
  slug,
  unpublish,
  upsertComment,
  type Comment,
  type GitHubApi,
} from '../src/index.ts';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'linework-action-')));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function sh(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const shop = `type: azure
title: Shop
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
const grown = shop.replace('  kv: key-vault\n', '  kv: key-vault\n  cache: { kind: redis, in: rg }\n').replace('  - web -> kv\n', '  - web -> kv\n  - web -> cache\n');
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
const people = 'type: systems\ntitle: People\ninclude: [model.yaml]\nnodes:\n  customer:\n';
const workflow = 'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n';

/** A repository with a bare origin: `main` has the first commit, the work tree is on `feature` with the change. */
function repository(name: string, change: (write: (file: string, text: string | null) => void) => void = () => {}) {
  const origin = path.join(tmp, `${name}.git`);
  const root = path.join(tmp, name);
  fs.mkdirSync(root);
  const write = (file: string, text: string | null) => {
    const p = path.join(root, file);
    if (text === null) return fs.rmSync(p);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  sh(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  sh(root, 'init', '-q', '-b', 'main');
  sh(root, 'remote', 'add', 'origin', origin);
  write('docs/shop.yaml', shop);
  write('docs/model.yaml', model);
  write('docs/context.yaml', context);
  write('docs/people.yaml', people);
  write('docs/old.yaml', shop.replace('title: Shop', 'title: Old'));
  write('other/network.yaml', 'type: network\nnodes:\n  fw: firewall\n  sw: switch\nedges:\n  - fw -> sw\n');
  write('.github/workflows/ci.yml', workflow);
  write('README.md', '# Shop\n');
  sh(root, 'add', '.');
  sh(root, 'commit', '-q', '-m', 'first');
  sh(root, 'push', '-q', 'origin', 'main');
  const base = sh(root, 'rev-parse', 'HEAD');
  sh(root, 'checkout', '-q', '-b', 'feature');
  change(write);
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '--allow-empty', '-m', 'change');
  return { root, origin, base, head: sh(root, 'rev-parse', 'HEAD'), write };
}

const usual = (write: (file: string, text: string | null) => void) => {
  write('docs/shop.yaml', grown);
  write('docs/model.yaml', model.replace('label: SendGrid', 'label: Postmark'));
  write('docs/fresh.yaml', shop.replace('title: Shop', 'title: Fresh'));
  write('docs/old.yaml', null);
  write('README.md', '# Shop\n\nMore words.\n');
};

/** What a job on GitHub is given, for a pull request from `feature`. */
function job(r: { root: string; base: string; head: string }, name: string, extra: Record<string, string> = {}, event: Record<string, unknown> = {}) {
  const dir = path.join(tmp, `${name}-job`);
  fs.mkdirSync(dir, { recursive: true });
  const files = { event: path.join(dir, 'event.json'), output: path.join(dir, 'output.txt'), summary: path.join(dir, 'summary.md') };
  for (const f of [files.output, files.summary]) fs.writeFileSync(f, '');
  fs.writeFileSync(
    files.event,
    JSON.stringify({ action: 'synchronize', pull_request: { number: 7, base: { sha: r.base, ref: 'main' }, head: { sha: r.head, repo: { full_name: 'acme/shop' } } }, ...event }),
  );
  const env = {
    GITHUB_WORKSPACE: r.root,
    GITHUB_EVENT_PATH: files.event,
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_REPOSITORY: 'acme/shop',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_SHA: r.head,
    GITHUB_RUN_ID: '42',
    GITHUB_OUTPUT: files.output,
    GITHUB_STEP_SUMMARY: files.summary,
    RUNNER_TEMP: dir,
    INPUT_TOKEN: 'secret',
    ...extra,
  };
  const outputs = () => Object.fromEntries(fs.readFileSync(files.output, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  return { env, dir, outputs, summary: () => fs.readFileSync(files.summary, 'utf8') };
}

/** GitHub's comments, in memory. */
function fakeApi(start: Comment[] = []) {
  const comments = [...start];
  const calls: string[] = [];
  let next = 100;
  const api: GitHubApi = {
    async listComments() {
      calls.push('list');
      return comments.map((c) => ({ ...c }));
    },
    async createComment(_pr, body) {
      calls.push('create');
      const c = { id: next++, body, url: `https://github.com/acme/shop/pull/7#issuecomment-${next}` };
      comments.push(c);
      return c;
    },
    async updateComment(id, body) {
      calls.push('update');
      const c = comments.find((x) => x.id === id)!;
      c.body = body;
      return c;
    },
    async deleteComment(id) {
      calls.push('delete');
      comments.splice(comments.findIndex((x) => x.id === id), 1);
    },
  };
  return { api, comments, calls };
}

const onBranch = (origin: string, branch: string) => sh(origin, 'ls-tree', '-r', '--name-only', branch).split('\n').filter(Boolean);
const isPng = (data: Uint8Array) => Buffer.from(data).subarray(1, 4).toString() === 'PNG';

describe('finding diagrams', () => {
  it('takes YAML that Linework draws and nothing else', () => {
    expect(isDiagram(shop)).toBe(true);
    expect(isDiagram(model)).toBe(true);
    expect(isDiagram('type: "c4"\n')).toBe(true);
    expect(isDiagram(workflow)).toBe(false);
    expect(isDiagram('type: object\nproperties: {}\n')).toBe(false);
    expect(isDiagram('services:\n  web:\n    type: azure\n')).toBe(false);
    expect(isDiagram(undefined)).toBe(false);
  });

  it('reads globs the way git does, with exclusions', () => {
    const r = repository('globs');
    expect(diagrams(r.root)).toEqual(['docs/context.yaml', 'docs/model.yaml', 'docs/old.yaml', 'docs/people.yaml', 'docs/shop.yaml', 'other/network.yaml']);
    expect(diagrams(r.root, ['other/**'])).toEqual(['other/network.yaml']);
    expect(diagrams(r.root, ['docs/*.yaml', '!docs/old.yaml', '!docs/model.yaml'])).toEqual(['docs/context.yaml', 'docs/people.yaml', 'docs/shop.yaml']);
    expect(diagrams(r.root, ['!docs/**'])).toEqual(['other/network.yaml']);
    expect(pathspecs(['docs/**', ' !docs/x.yaml '])).toEqual([':(glob)docs/**', ':(glob,exclude)docs/x.yaml']);
    // Not tracked: not looked at.
    r.write('docs/untracked.yaml', shop);
    expect(diagrams(r.root)).not.toContain('docs/untracked.yaml');
  });

  it('names pictures after the diagram', () => {
    expect(slug('docs/shop.yaml')).toBe('docs-shop');
    expect(slug('docs/a b/model.yml', 'containers')).toBe('docs-a-b-model.containers');
  });
});

describe('what a change touches', () => {
  let r: ReturnType<typeof repository>;
  let p: Awaited<ReturnType<typeof plan>>;
  beforeAll(async () => {
    r = repository('plan', usual);
    p = await plan(r.root, r.base);
  }, 120_000);

  it('finds changed, new and removed diagrams, and the ones that read a changed file', () => {
    const got = p.targets.map((t) => `${t.file}${t.view ? '#' + t.view : ''}: ${t.state}`);
    // A model file is a drawing of its own as well: it shows everything it holds.
    expect(got).toEqual(['docs/context.yaml: changed', 'docs/fresh.yaml: new', 'docs/fresh.yaml#data: new', 'docs/model.yaml: changed', 'docs/old.yaml: removed', 'docs/old.yaml#data: removed', 'docs/shop.yaml: changed']);
    expect(p.problems).toEqual([]);
    // 7 diagrams exist before or after; the one under other/ reads nothing that changed and is skipped early.
    expect(p.checked).toBe(7);
  });

  it('says through which file an unchanged diagram changed', () => {
    const ctx = p.targets.find((t) => t.file === 'docs/context.yaml')!;
    expect(ctx.because).toEqual(['docs/model.yaml']);
    expect(ctx.comparison.diff.nodes).toEqual([{ kind: 'node', id: 'mail', status: 'changed', label: 'Postmark', changes: [{ field: 'label', before: 'SendGrid', after: 'Postmark' }] }]);
    expect(p.targets.find((t) => t.file === 'docs/shop.yaml')!.because).toEqual([]);
  });

  it('lists diagrams that read a changed file and draw the same, without a picture', () => {
    // people.yaml draws only the customer, whose name did not change.
    expect(p.untouched).toContain('docs/people.yaml');
    expect(p.targets.some((t) => t.file === 'other/network.yaml')).toBe(false);
  });

  it('leaves a view alone that looks the same, and reports one that does not', async () => {
    // The data view shows web and db: the new cache is not in it.
    expect(p.targets.some((t) => t.file === 'docs/shop.yaml' && t.view === 'data')).toBe(false);
    const v = repository('views', (write) => write('docs/shop.yaml', shop.replace('include: [web, db]', 'include: [web, db, kv]')));
    const q = await plan(v.root, v.base);
    expect(q.targets.map((t) => `${t.file}#${t.view}: ${t.state}`)).toEqual(['docs/shop.yaml#data: changed']);
    expect(q.targets[0]!.comparison.diff.counts).toEqual({ added: 2, removed: 0, changed: 0 });
    expect((await plan(v.root, v.base, { views: false })).targets).toEqual([]);
  }, 120_000);

  it('has nothing to say when no diagram is involved', async () => {
    const q = repository('quiet', (write) => write('README.md', '# Other\n'));
    const none = await plan(q.root, q.base);
    expect(none.targets).toEqual([]);
    expect(none.untouched).toEqual([]);
    expect(none.checked).toBe(6);
    expect(commentBody(none)).toBeUndefined();
  }, 60_000);

  it('tells a change of pins from a change of content', async () => {
    const q = repository('pins', (write) => write('docs/shop.layout.json', JSON.stringify({ version: 1, nodes: { kv: { x: 40, y: 400 } } })));
    const moved = await plan(q.root, q.base);
    expect(moved.targets.map((t) => `${t.file}: ${t.state}`)).toEqual(['docs/shop.yaml: layout']);
    expect(moved.targets[0]!.comparison.diff.same).toBe(true);
    const shots = await shoot(moved.targets);
    expect(shots).toHaveLength(1);
    expect(commentBody(moved)).toContain('layout only');
  }, 60_000);

  it('reports a diagram that no longer draws', async () => {
    const q = repository('broken', (write) => write('docs/shop.yaml', shop.replace('  - web -> kv\n', '  - web -> nowhere\n')));
    const bad = await plan(q.root, q.base);
    const t = bad.targets.find((x) => x.file === 'docs/shop.yaml' && !x.view)!;
    expect(t.comparison.failed).toBe(true);
    expect(commentBody(bad)).toMatch(/\*\*Error\*\* on line \d+: .*nowhere/);
  }, 60_000);

  it('does not read outside the repository, whatever a diagram asks for', async () => {
    fs.writeFileSync(path.join(tmp, 'secret.yaml'), model.replace('Customer', 'TOP-SECRET'));
    const q = repository('escape', (write) => {
      write('docs/context.yaml', context.replace('model.yaml', '../../secret.yaml'));
      fs.symlinkSync(path.join(tmp, 'secret.yaml'), path.join(q0, 'docs/link.yaml'));
      write('docs/linked.yaml', context.replace('model.yaml', 'link.yaml'));
    });
    const v = versionOnDisk(q.root, 'docs/context.yaml');
    expect(() => v.options.load!('../../secret.yaml')).toThrow('outside the repository');
    expect(() => v.options.load!('/etc/passwd')).toThrow('outside the repository');
    expect(() => v.options.load!('link.yaml')).toThrow('outside the repository');
    expect(v.options.assets!('../../secret.yaml')).toBeUndefined();
    expect(v.options.load!('model.yaml')).toContain('SendGrid');
    const bad = await plan(q.root, q.base);
    for (const t of bad.targets) {
      expect(t.comparison.failed).toBe(true);
      expect(JSON.stringify(t.comparison.after?.graph ?? {})).not.toContain('TOP-SECRET');
      expect(t.comparison.picture()?.svg ?? '').not.toContain('TOP-SECRET');
    }
    expect(bad.targets.map((t) => t.file)).toEqual(['docs/context.yaml', 'docs/linked.yaml']);
  }, 60_000);
  const q0 = path.join(tmp, 'escape');
});

describe('pictures on a branch', () => {
  const png = (text: string) => ({ name: `${text}.png`, data: Buffer.from(text) });

  it('keeps a folder per pull request on a branch with one commit, and leaves the checkout alone', () => {
    const r = repository('images', usual);
    const status = sh(r.root, 'status', '--porcelain');
    const first = publish(r.root, { branch: 'linework-diffs', folder: 'pr-7', files: [png('a'), png('b')] });
    expect(first.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(first.paths.get('a.png')).toBe('pr-7/a.png');
    expect(onBranch(r.origin, 'linework-diffs')).toEqual(['README.md', 'pr-7/a.png', 'pr-7/b.png']);
    expect(sh(r.origin, 'show', 'linework-diffs:pr-7/a.png')).toBe('a');

    // Another pull request: its own folder, the first one stays.
    publish(r.root, { branch: 'linework-diffs', folder: 'pr-8', files: [png('c')] });
    // A new push to the first: its folder is replaced, not added to.
    publish(r.root, { branch: 'linework-diffs', folder: 'pr-7', files: [png('d')] });
    expect(onBranch(r.origin, 'linework-diffs')).toEqual(['README.md', 'pr-7/d.png', 'pr-8/c.png']);
    expect(sh(r.origin, 'rev-list', '--count', 'linework-diffs')).toBe('1');

    // The same again: nothing to push.
    expect(publish(r.root, { branch: 'linework-diffs', folder: 'pr-7', files: [png('d')] }).commit).toBeUndefined();

    // Closed: the folder goes.
    expect(unpublish(r.root, { branch: 'linework-diffs', folder: 'pr-7' }).commit).toBeDefined();
    expect(onBranch(r.origin, 'linework-diffs')).toEqual(['README.md', 'pr-8/c.png']);
    expect(unpublish(r.root, { branch: 'linework-diffs', folder: 'pr-7' }).commit).toBeUndefined();

    // The checkout: same commit, same branch, nothing staged, no stray refs.
    expect(sh(r.root, 'rev-parse', 'HEAD')).toBe(r.head);
    expect(sh(r.root, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feature');
    expect(sh(r.root, 'status', '--porcelain')).toBe(status);
    expect(sh(r.root, 'for-each-ref', 'refs/linework')).toBe('');
  });

  it('does not make a branch just to say there is nothing', () => {
    const r = repository('images-none');
    expect(unpublish(r.root, { branch: 'linework-diffs', folder: 'pr-1' }).commit).toBeUndefined();
    expect(sh(r.origin, 'branch', '--list', 'linework-diffs')).toBe('');
  });

  it('starts over when another run pushed first', () => {
    const r = repository('images-race');
    publish(r.root, { branch: 'pics', folder: 'pr-1', files: [png('a')] });
    // A second checkout pushes while this one is not looking: git refuses a push that would lose it.
    const other = path.join(tmp, 'images-race-2');
    sh(tmp, 'clone', '-q', r.origin, other);
    const hook = path.join(r.origin, 'hooks', 'pre-receive');
    const flag = path.join(tmp, 'images-race-once');
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    // The first push to arrive is refused, once: as if the branch had just moved.
    fs.writeFileSync(hook, `#!/bin/sh\nif [ ! -e "${flag}" ]; then touch "${flag}"; echo "moved" >&2; exit 1; fi\n`, { mode: 0o755 });
    const done = publish(r.root, { branch: 'pics', folder: 'pr-2', files: [png('b')] });
    expect(done.commit).toBeDefined();
    expect(fs.existsSync(flag)).toBe(true);
    expect(onBranch(r.origin, 'pics')).toEqual(['README.md', 'pr-1/a.png', 'pr-2/b.png']);
    // And says so when it keeps being refused.
    fs.writeFileSync(hook, '#!/bin/sh\necho "protected branch" >&2\nexit 1\n', { mode: 0o755 });
    expect(() => publish(r.root, { branch: 'pics', folder: 'pr-3', files: [png('c')], attempts: 2 })).toThrow(/Could not push the pictures to pics/);
  });

  it('addresses a picture so that private repositories work too', () => {
    expect(imageUrl('https://github.com', 'acme/shop', 'linework-diffs', 'pr-7/abc1234-docs-shop.png')).toBe('https://github.com/acme/shop/blob/linework-diffs/pr-7/abc1234-docs-shop.png?raw=true');
    expect(imageUrl('https://ghe.example.com/', 'a/b', 'x/y', 'pr-1/a b.png')).toBe('https://ghe.example.com/a/b/blob/x/y/pr-1/a%20b.png?raw=true');
  });
});

describe('the comment', () => {
  it('finds its own comment again: one per pull request', async () => {
    const { api, comments, calls } = fakeApi([{ id: 1, body: 'LGTM' }]);
    expect((await upsertComment(api, 7, 'first')).action).toBe('created');
    expect(comments).toHaveLength(2);
    expect(comments[1]!.body).toBe(`${MARKER}\nfirst`);
    expect((await upsertComment(api, 7, 'second')).action).toBe('updated');
    expect(comments).toHaveLength(2);
    expect(comments[1]!.body).toBe(`${MARKER}\nsecond`);
    calls.length = 0;
    expect((await upsertComment(api, 7, 'second')).action).toBe('unchanged');
    expect(calls).toEqual(['list']);
    // Nothing to say any more: the comment goes, other people's stay.
    expect((await upsertComment(api, 7, undefined)).action).toBe('removed');
    expect(comments.map((c) => c.body)).toEqual(['LGTM']);
    expect((await upsertComment(api, 7, undefined)).action).toBe('none');
  });

  it('tidies up doubles from two runs at once', async () => {
    const { api, comments } = fakeApi([{ id: 1, body: `${MARKER}\na` }, { id: 2, body: `${MARKER}\nb` }]);
    await upsertComment(api, 7, 'c');
    expect(comments.map((c) => c.body)).toEqual([`${MARKER}\nc`]);
  });

  it('keeps text from a diagram as text', async () => {
    const hostile = 'Pay <img src=x onerror=alert(1)> | [free money](https://evil.example) `x`';
    const r = repository('hostile', (write) => write('docs/shop.yaml', shop.replace('  kv: key-vault\n', `  kv: { kind: key-vault, label: ${JSON.stringify(hostile)} }\n`)));
    const body = commentBody(await plan(r.root, r.base, { views: false }))!;
    expect(body).toContain('~ changed | node | `kv` |');
    expect(body).not.toMatch(/(?<!\\)<img/);
    expect(body).not.toMatch(/(?<!\\)\[free money/);
    expect(body).toContain('\\<img src=x onerror=alert(1)\\> \\| \\[free money\\](https://evil.example)');
    // One row stays one row.
    const row = body.split('\n').find((l) => l.includes('`kv`'))!;
    expect(row.replace(/\\\|/g, '').split('|')).toHaveLength(6);
  }, 60_000);

  it('talks to GitHub the documented way', async () => {
    const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = [];
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ id: from + i, body: `c${from + i}`, html_url: `u${from + i}` }));
    const fetch = (async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
      seen.push({ url, method: init.method, headers: init.headers, ...(init.body ? { body: init.body } : {}) });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.includes('/forbidden')) return new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), { status: 403 });
      if (init.method === 'GET') return Response.json(url.endsWith('page=1') ? page(100, 0) : page(3, 100));
      return Response.json({ id: 5, body: JSON.parse(init.body!).body, html_url: 'https://github.com/acme/shop/pull/7#issuecomment-5' });
    }) as unknown as typeof globalThis.fetch;
    const api = githubApi({ token: 't0ken', repo: 'acme/shop', fetch });
    expect(await api.listComments(7)).toHaveLength(103);
    expect(seen.map((s) => s.url)).toEqual(['https://api.github.com/repos/acme/shop/issues/7/comments?per_page=100&page=1', 'https://api.github.com/repos/acme/shop/issues/7/comments?per_page=100&page=2']);
    expect(seen[0]!.headers.authorization).toBe('Bearer t0ken');
    expect(seen[0]!.headers.accept).toBe('application/vnd.github+json');

    expect(await api.createComment(7, 'hello')).toEqual({ id: 5, body: 'hello', url: 'https://github.com/acme/shop/pull/7#issuecomment-5' });
    expect(seen.at(-1)).toMatchObject({ method: 'POST', url: 'https://api.github.com/repos/acme/shop/issues/7/comments', body: '{"body":"hello"}' });
    await api.updateComment(5, 'again');
    expect(seen.at(-1)).toMatchObject({ method: 'PATCH', url: 'https://api.github.com/repos/acme/shop/issues/comments/5' });
    await api.deleteComment(5);
    expect(seen.at(-1)).toMatchObject({ method: 'DELETE', url: 'https://api.github.com/repos/acme/shop/issues/comments/5' });

    const enterprise = githubApi({ token: 't', repo: 'acme/forbidden', api: 'https://ghe.example.com/api/v3/', fetch });
    const refused = await enterprise.createComment(1, 'x').catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).status).toBe(403);
    expect((refused as ApiError).message).toContain('Resource not accessible by integration');
    expect(seen.at(-1)!.url).toBe('https://ghe.example.com/api/v3/repos/acme/forbidden/issues/1/comments');
  });

  it('describes every drawing, with its picture and a table of what changed', async () => {
    const r = repository('comment', usual);
    const p = await plan(r.root, r.base);
    const images = new Map(p.targets.map((t) => [t, `https://example.com/${slug(t.file, t.view)}.png`]));
    const body = commentBody(p, { images, against: 'main', head: 'abc1234' })!;
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('5 diagrams changed against `main`, in 7 drawings.');
    expect(body).toContain('#### `docs/shop.yaml`: 2 added');
    expect(body).toContain('![docs/shop.yaml: 2 added](https://example.com/docs-shop.png)');
    expect(body).toContain('#### `docs/context.yaml`: 1 changed');
    expect(body).toContain('#### `docs/model.yaml`: 1 changed');
    expect(body).toContain('Through `docs/model.yaml`.');
    expect(body).toContain('#### `docs/fresh.yaml`: new diagram');
    expect(body).toContain('#### `docs/fresh.yaml` · view `data`: new view');
    expect(body).toContain('#### `docs/old.yaml`: removed');
    expect(body).toContain('| + added | node | `cache` |');
    expect(body).toContain('1 other diagram reads a changed file and draws the same: `docs/people.yaml`.');
    expect(body).toContain('Drawn from `abc1234`');

    // Without addresses: words, and where the pictures are.
    const plain = commentBody(p, { artifact: { url: 'https://github.com/acme/shop/actions/runs/42', name: 'linework-diagrams' } })!;
    expect(plain).not.toContain('![');
    expect(plain).toContain('Pictures: artifact `linework-diagrams` of [this run](https://github.com/acme/shop/actions/runs/42)');

    // GitHub refuses long comments: tables go first, then drawings, and it says how many.
    const tight = commentBody(p, { images, limit: 1500 })!;
    expect(tight.length).toBeLessThanOrEqual(1500);
    expect(tight).not.toContain('<details>');
    expect(tight.match(/!\[/g)).toHaveLength(7);
    const tighter = commentBody(p, { images, limit: 600 })!;
    expect(tighter).toMatch(/…and \d more drawings: `docs\//);
    expect(tighter.match(/!\[/g)!.length).toBeLessThan(7);
    expect(tighter).toContain('`docs/shop.yaml`');
  }, 120_000);
});

describe('a run on a pull request', () => {
  it('pushes the pictures, writes one comment and keeps it up to date', async () => {
    const r = repository('run', usual);
    const j = job(r, 'run');
    const { api, comments } = fakeApi();
    const lines: string[] = [];
    const first = await run(j.env, { api, log: (l) => lines.push(l) });
    expect(first).toMatchObject({ mode: 'diff', ok: true, changed: 5, images: 'branch', upload: false });
    expect(first.comment?.action).toBe('created');

    const sha = r.head.slice(0, 7);
    const files = onBranch(r.origin, 'linework-diffs');
    expect(files).toEqual(['README.md', ...['docs-context', 'docs-fresh.data', 'docs-fresh', 'docs-model', 'docs-old.data', 'docs-old', 'docs-shop'].map((n) => `pr-7/${sha}-${n}.png`)]);
    const body = comments[0]!.body;
    expect(body).toContain(MARKER);
    expect(body).toContain(`![docs/shop.yaml: 2 added](https://github.com/acme/shop/blob/linework-diffs/pr-7/${sha}-docs-shop.png?raw=true)`);
    expect(body).toContain('against `main`');
    expect(body.match(/!\[/g)).toHaveLength(7);

    // For later steps and for people: outputs, the job summary, the files of the run.
    const out = j.outputs();
    expect(out).toMatchObject({ mode: 'diff', changed: '5', images: 'branch', upload: 'false' });
    expect(JSON.parse(out.diagrams!)).toEqual(['docs/context.yaml', 'docs/fresh.yaml', 'docs/model.yaml', 'docs/old.yaml', 'docs/shop.yaml']);
    expect(out['comment-url']).toContain('issuecomment');
    expect(j.summary()).toContain('### Diagram changes');
    expect(j.summary()).not.toContain(MARKER);
    expect(isPng(fs.readFileSync(path.join(out.output!, 'docs-shop.png')))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(out.output!, 'diff.json'), 'utf8')).map((t: { file: string }) => t.file)).toContain('docs/context.yaml');
    expect(lines).toContain('7 diagrams looked at, 5 changed');

    // The same commit again: nothing new anywhere.
    const again = await run(j.env, { api, log: () => {} });
    expect(again.comment?.action).toBe('unchanged');
    expect(onBranch(r.origin, 'linework-diffs')).toEqual(files);

    // A new push: new addresses (no stale cached picture), the same comment.
    r.write('docs/shop.yaml', grown.replace('title: Shop', 'title: Web shop'));
    sh(r.root, 'commit', '-q', '-am', 'title');
    const head = sh(r.root, 'rev-parse', 'HEAD');
    const j2 = job({ ...r, head }, 'run');
    const next = await run(j2.env, { api, log: () => {} });
    expect(next.comment?.action).toBe('updated');
    expect(comments).toHaveLength(1);
    expect(comments[0]!.body).toContain(`pr-7/${head.slice(0, 7)}-docs-shop.png`);
    expect(onBranch(r.origin, 'linework-diffs').every((f) => f === 'README.md' || f.startsWith(`pr-7/${head.slice(0, 7)}-`))).toBe(true);

    // Closed: its pictures leave the branch, the comment stays as the record.
    const closed = await run(job({ ...r, head }, 'run', {}, { action: 'closed' }).env, { api, log: () => {} });
    expect(closed.mode).toBe('cleanup');
    expect(onBranch(r.origin, 'linework-diffs')).toEqual(['README.md']);
    expect(comments).toHaveLength(1);
  }, 180_000);

  it('from a fork: no push, no comment, everything in the run', async () => {
    const r = repository('fork', usual);
    const j = job(r, 'fork', {}, { pull_request: { number: 9, base: { sha: r.base, ref: 'main' }, head: { sha: r.head, repo: { full_name: 'stranger/shop' } } } });
    const lines: string[] = [];
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url));
      return new Response('{}', { status: 500 });
    }) as unknown as typeof globalThis.fetch;
    try {
      const done = await run(j.env, { log: (l) => lines.push(l) });
      expect(done).toMatchObject({ mode: 'diff', ok: true, changed: 5, images: 'artifact', upload: true });
      expect(done.comment).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual([]);
    expect(sh(r.origin, 'branch', '--list', 'linework-diffs')).toBe('');
    expect(lines.some((l) => l.startsWith('::notice::A pull request from a fork'))).toBe(true);
    const out = j.outputs();
    expect(fs.readdirSync(out.output!).sort()).toEqual(['comment.md', 'diff.json', 'docs-context.png', 'docs-fresh.data.png', 'docs-fresh.png', 'docs-model.png', 'docs-old.data.png', 'docs-old.png', 'docs-shop.png']);
    const md = fs.readFileSync(path.join(out.output!, 'comment.md'), 'utf8');
    expect(md).not.toContain('![');
    expect(md).toContain('artifact `linework-diagrams` of [this run](https://github.com/acme/shop/actions/runs/42)');
    expect(j.summary()).toContain('docs/shop.yaml');
  }, 120_000);

  it('carries on when the token may not push or comment, and fails only when told to use the branch', async () => {
    const r = repository('readonly', usual);
    fs.writeFileSync(path.join(r.origin, 'hooks', 'pre-receive'), '#!/bin/sh\necho "permission denied" >&2\nexit 1\n', { mode: 0o755 });
    const refusing: GitHubApi = {
      listComments: async () => [],
      createComment: async () => {
        throw new ApiError('GitHub POST /issues/7/comments: 403 Resource not accessible by integration', 403);
      },
      updateComment: async () => ({ id: 1, body: '' }),
      deleteComment: async () => {},
    };
    const lines: string[] = [];
    const auto = await run(job(r, 'readonly').env, { api: refusing, log: (l) => lines.push(l) });
    expect(auto).toMatchObject({ ok: true, images: 'artifact', upload: true });
    expect(lines.filter((l) => l.startsWith('::warning::'))).toHaveLength(2);
    expect(lines.join('\n')).toContain('contents: write');
    expect(lines.join('\n')).toContain('pull-requests: write');

    const forced = await run(job(r, 'readonly', { INPUT_IMAGES: 'branch', INPUT_COMMENT: 'false' }).env, { log: () => {} });
    expect(forced.ok).toBe(false);
  }, 180_000);

  it('removes its comment when a later push takes the diagram change back', async () => {
    const r = repository('reverted', (write) => write('README.md', '# Only words\n'));
    const { api, comments } = fakeApi([{ id: 3, body: `${MARKER}\n### Diagram changes\nold` }, { id: 4, body: 'Thanks!' }]);
    const done = await run(job(r, 'reverted').env, { api, log: () => {} });
    expect(done).toMatchObject({ ok: true, changed: 0, images: 'none', upload: false });
    expect(done.comment?.action).toBe('removed');
    expect(comments.map((c) => c.body)).toEqual(['Thanks!']);
  }, 60_000);

  it('marks errors where they are and fails, unless told not to', async () => {
    const r = repository('errors', (write) => write('docs/shop.yaml', shop.replace('  - web -> kv\n', '  - web -> nowhere\n')));
    const lines: string[] = [];
    const { api, comments } = fakeApi();
    const bad = await run(job(r, 'errors').env, { api, log: (l) => lines.push(l) });
    expect(bad.ok).toBe(false);
    expect(lines.some((l) => /^::error file=docs\/shop\.yaml,line=\d+(,col=\d+)?::.*nowhere/.test(l))).toBe(true);
    expect(comments[0]!.body).toContain('**Error**');
    const lenient = await run(job(r, 'errors', { INPUT_FAIL_ON_ERROR: 'false' }).env, { api, log: () => {} });
    expect(lenient.ok).toBe(true);
  }, 120_000);

  it('honours the inputs: which files, no pictures, side by side', async () => {
    const r = repository('inputs', usual);
    const { api, comments } = fakeApi();
    const some = await run(job(r, 'inputs', { INPUT_FILES: 'docs/shop.yaml\ndocs/context.yaml', INPUT_IMAGES: 'none', INPUT_VIEWS: 'false' }).env, { api, log: () => {} });
    expect(some).toMatchObject({ changed: 2, images: 'none', upload: false });
    expect(comments[0]!.body).not.toContain('![');
    expect(comments[0]!.body).not.toContain('docs/fresh.yaml');
    expect(sh(r.origin, 'branch', '--list', 'linework-diffs')).toBe('');

    const j = job(r, 'inputs', { INPUT_FILES: 'docs/shop.yaml', INPUT_IMAGES: 'artifact', INPUT_SIDE_BY_SIDE: 'true', INPUT_SCALE: '1', INPUT_OUTPUT: 'out/diff' });
    const side = await run(j.env, { api, log: () => {} });
    expect(side.output).toBe(path.join(r.root, 'out/diff'));
    const png = fs.readFileSync(path.join(r.root, 'out/diff/docs-shop.png'));
    expect(isPng(png)).toBe(true);
    // Two drawings stacked or next to each other: clearly larger than one.
    const single = (await shoot((await plan(r.root, r.base, { files: ['docs/shop.yaml'], views: false })).targets, { scale: 1 }))[0]!;
    const size = (b: Buffer) => b.readUInt32BE(16) * b.readUInt32BE(20);
    expect(size(png)).toBeGreaterThan(size(single.data) * 1.5);

    await expect(run(job(r, 'inputs', { INPUT_IMAGES: 'imgur' }).env, { api, log: () => {} })).rejects.toThrow('images: "imgur"');
    await expect(run(job(r, 'inputs', { INPUT_MODE: 'nonsense' }).env, { api, log: () => {} })).rejects.toThrow('mode: "nonsense"');
  }, 180_000);
});

describe('the commit to compare with', () => {
  it('is where the branch left main, not where main is now', () => {
    const r = repository('base', usual);
    // main moves on after the branch was made.
    sh(r.root, 'checkout', '-q', 'main');
    r.write('docs/later.yaml', shop);
    sh(r.root, 'add', '.');
    sh(r.root, 'commit', '-q', '-m', 'later');
    const tip = sh(r.root, 'rev-parse', 'HEAD');
    sh(r.root, 'checkout', '-q', 'feature');
    expect(resolveBase(r.root, '', { pull_request: { number: 1, base: { sha: tip } } })).toBe(r.base);
    // Asked for by name: taken as given.
    expect(resolveBase(r.root, 'main', {})).toBe(tip);
    expect(resolveBase(r.root, '', { before: r.base })).toBe(r.base);
    expect(() => resolveBase(r.root, '', {})).toThrow('Nothing to compare with');
    expect(() => resolveBase(r.root, '', { before: '0000000000000000000000000000000000000000' })).toThrow('Nothing to compare with');
    expect(() => resolveBase(r.root, 'no-such-branch', {})).toThrow('is not in this checkout');
  });

  it('is fetched when a shallow checkout does not have it', () => {
    const r = repository('shallow', usual);
    sh(r.root, 'push', '-q', 'origin', 'feature');
    const clone = path.join(tmp, 'shallow-clone');
    sh(tmp, 'clone', '-q', '--depth=1', '--branch', 'feature', `file://${r.origin}`, clone);
    expect(() => sh(clone, 'cat-file', '-e', `${r.base}^{commit}`)).toThrow();
    expect(resolveBase(clone, '', { pull_request: { number: 1, base: { sha: r.base } } })).toBe(r.base);
  });
});

describe('a run on push', () => {
  it('draws every diagram and commits the pictures that changed', async () => {
    const r = repository('render');
    sh(r.root, 'checkout', '-q', 'main');
    const j = job(r, 'render', { GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main', GITHUB_REF_TYPE: 'branch', INPUT_FILES: 'docs/**', INPUT_COMMIT: 'true' }, { pull_request: undefined, before: r.base });
    const lines: string[] = [];
    const done = await run(j.env, { log: (l) => lines.push(l) });
    expect(done).toMatchObject({ mode: 'render', ok: true, upload: false });
    expect(done.commit).toMatch(/^[0-9a-f]{40}$/);
    // On origin, with only the pictures in the commit.
    expect(sh(r.origin, 'rev-parse', 'main')).toBe(done.commit);
    const added = sh(r.origin, 'show', '--name-only', '--format=%s', 'main').split('\n').filter(Boolean);
    expect(added[0]).toBe('Render diagrams [skip ci]');
    expect(added.slice(1).sort()).toEqual(['docs/context.svg', 'docs/model.svg', 'docs/old--data.svg', 'docs/old.svg', 'docs/people.svg', 'docs/shop--data.svg', 'docs/shop.svg']);
    expect(fs.readFileSync(path.join(r.root, 'docs/shop.svg'), 'utf8')).toContain('<svg');
    expect(j.outputs().commit).toBe(done.commit);

    // Nothing changed: no commit.
    const again = await run(j.env, { log: () => {} });
    expect(again.commit).toBeUndefined();
    expect(sh(r.origin, 'rev-parse', 'main')).toBe(done.commit);
  }, 180_000);

  it('can leave them in a folder for an artifact instead, as PNG too', async () => {
    const r = repository('render-out');
    const done = await renderAll(r.root, { files: ['docs/shop.yaml', 'other/**'], formats: ['svg', 'png'], output: 'pictures', views: false });
    expect(done.written.sort()).toEqual(['pictures/docs/shop.png', 'pictures/docs/shop.svg', 'pictures/other/network.png', 'pictures/other/network.svg']);
    expect(isPng(fs.readFileSync(path.join(r.root, 'pictures/docs/shop.png')))).toBe(true);
    expect(done.failed).toBe(false);
    // Nothing staged by drawing alone, and committing is its own step.
    expect(sh(r.root, 'diff', '--cached', '--name-only')).toBe('');
    expect(commitPictures(r.root, [])).toBeUndefined();
    const j = job(r, 'render-out', { GITHUB_EVENT_NAME: 'push', INPUT_MODE: 'render', INPUT_OUTPUT: 'pictures', INPUT_FORMATS: 'png', INPUT_FILES: 'other/**' });
    const viaRun = await run(j.env, { log: () => {} });
    expect(viaRun).toMatchObject({ mode: 'render', changed: 1, upload: true, output: path.join(r.root, 'pictures') });
  }, 120_000);
});

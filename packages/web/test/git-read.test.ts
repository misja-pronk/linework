// The browser's git reader against real repositories made with git itself: loose objects, packfiles
// with deltas (gc), packed refs, annotated tags and history of one file.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDelta, Repo, type GitFiles } from '../src/compare/git.ts';

let dir: string;
const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Ann', GIT_AUTHOR_EMAIL: 'ann@example.com', GIT_COMMITTER_NAME: 'Ann', GIT_COMMITTER_EMAIL: 'ann@example.com', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();
const filesOf = (root: string): GitFiles => ({
  file: async (p) => {
    const f = path.join(root, '.git', p);
    return fs.existsSync(f) && fs.statSync(f).isFile() ? fs.openAsBlob(f) : undefined;
  },
  list: async (p) => {
    const f = path.join(root, '.git', p);
    return fs.existsSync(f) ? fs.readdirSync(f) : [];
  },
});

/** A diagram that grows by one node a commit: later versions are deltas of earlier ones once packed. */
const version = (n: number) => `type: azure\ntitle: Shop\nnodes:\n${Array.from({ length: n }, (_, i) => `  n${i}: { kind: app-service, label: Service number ${i} with a longer label }`).join('\n')}\n`;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linework-git-'));
  git('init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'docs'));
  for (let n = 1; n <= 6; n++) {
    fs.writeFileSync(path.join(dir, 'docs/shop.yaml'), version(n));
    if (n === 3) fs.writeFileSync(path.join(dir, 'README.md'), 'readme\n');
    git('add', '-A');
    git('commit', '-q', '-m', `Version ${n}`, '--date', `2026-01-0${n}T10:00:00Z`);
    if (n === 4) git('tag', '-a', 'v4', '-m', 'four');
  }
  // Only the README changes: no new version of the diagram.
  fs.writeFileSync(path.join(dir, 'README.md'), 'readme, longer\n');
  git('commit', '-q', '-am', 'Docs only');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('git reader', () => {
  it('reads loose objects, refs and a file at HEAD', async () => {
    const repo = await Repo.open(filesOf(dir));
    expect(await repo.resolve('HEAD')).toBe(git('rev-parse', 'HEAD'));
    expect(await repo.branch()).toBe('main');
    expect(new TextDecoder().decode(await repo.fileAt('HEAD', 'docs/shop.yaml'))).toBe(version(6));
    expect(await repo.fileAt('HEAD', 'docs/missing.yaml')).toBeUndefined();
    expect(await repo.fileAt('HEAD', 'docs')).toBeUndefined();
  });

  it('reads packfiles with deltas, packed refs and annotated tags after gc', async () => {
    git('gc', '-q', '--aggressive');
    expect(fs.readdirSync(path.join(dir, '.git/objects/pack')).some((f) => f.endsWith('.pack'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.git/refs/heads/main'))).toBe(false);
    // gc made deltas: some object in the pack is stored as one.
    expect(git('verify-pack', '-v', ...fs.readdirSync(path.join(dir, '.git/objects/pack')).filter((f) => f.endsWith('.idx')).map((f) => `.git/objects/pack/${f}`))).toMatch(/ \d+ [0-9a-f]{40}\n/);
    const repo = await Repo.open(filesOf(dir));
    expect(await repo.resolve('main')).toBe(git('rev-parse', 'main'));
    expect(await repo.resolve('v4')).toBe(git('rev-parse', 'v4^{commit}'));
    for (let n = 1; n <= 6; n++) {
      const oid = git('rev-parse', `HEAD~${7 - n}`);
      expect(new TextDecoder().decode(await repo.fileAt(oid, 'docs/shop.yaml'))).toBe(git('show', `${oid}:docs/shop.yaml`) + '\n');
    }
  });

  it('lists the versions of one file, newest first, each with the commit that made it', async () => {
    const repo = await Repo.open(filesOf(dir));
    const h = await repo.history('docs/shop.yaml');
    expect(h.map((v) => v.commit.message.trim())).toEqual(['Version 6', 'Version 5', 'Version 4', 'Version 3', 'Version 2', 'Version 1']);
    expect(h[0]!.commit.author).toBe('Ann');
    expect(h[0]!.commit.time).toBe(Date.parse('2026-01-06T10:00:00Z') / 1000);
    expect((await repo.history('docs/shop.yaml', { limit: 2 })).length).toBe(2);
    expect(await repo.history('nope.yaml')).toEqual([]);
  });

  it('applies copy and insert instructions of a delta', () => {
    const base = new TextEncoder().encode('hello world');
    // source 11, target 11: copy 6 from 0 ("hello "), insert "there"
    const delta = Uint8Array.from([11, 11, 0x90, 6, 5, ...new TextEncoder().encode('there')]);
    expect(new TextDecoder().decode(applyDelta(base, delta))).toBe('hello there');
  });

  it('refuses a folder without a repository', async () => {
    await expect(Repo.open(filesOf(os.tmpdir()))).rejects.toThrow(/No git repository/);
  });
});

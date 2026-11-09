// One run of the action: reads the inputs and the event GitHub hands a job, and does the work.
// Everything GitHub-specific comes in through `env` and `deps`, so tests run it against a local
// repository with a made-up event and a fake API.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Diagnostic } from '@cartography/core';
import { git, repoRoot } from '@cartography/diff/node';
import { commentBody, titleOf } from './comment.ts';
import { ApiError, githubApi, MARKER, upsertComment, type GitHubApi, type Posted } from './github.ts';
import { imageUrl, publish, unpublish } from './images.ts';
import { shoot, type Shot } from './pictures.ts';
import { plan, type Plan } from './plan.ts';
import { commitPictures, renderAll, type Format } from './render.ts';

export type Env = Record<string, string | undefined>;

export interface Deps {
  /** Instead of the real API (tests). */
  api?: GitHubApi;
  /** Where log lines and workflow commands go (default: stdout). */
  log?: (line: string) => void;
}

export interface RunResult {
  mode: 'diff' | 'render' | 'cleanup';
  ok: boolean;
  /** Diagrams the change touches (diff), or pictures written (render). */
  changed: number;
  /** Where the pictures went. */
  images: 'branch' | 'artifact' | 'none';
  /** The folder with this run's files. */
  output?: string;
  /** The workflow should upload `output` as an artifact. */
  upload: boolean;
  plan?: Plan;
  body?: string;
  comment?: Posted;
  commit?: string;
}

interface PullRequest {
  number: number;
  base?: { sha?: string; ref?: string };
  head?: { sha?: string; repo?: { full_name?: string } | null };
}
interface Event {
  action?: string;
  before?: string;
  pull_request?: PullRequest;
}

const yes = (v: string) => /^(true|yes|on|1)$/i.test(v);
const list = (v: string) => v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
/** Workflow commands end at a newline and read % and : specially. */
const escape = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export async function run(env: Env, deps: Deps = {}): Promise<RunResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const input = (name: string, fallback = '') => (env[`INPUT_${name.toUpperCase().replace(/-/g, '_')}`] ?? '').trim() || fallback;
  const root = repoRoot(env.GITHUB_WORKSPACE || process.cwd());
  const event: Event = env.GITHUB_EVENT_PATH && fs.existsSync(env.GITHUB_EVENT_PATH) ? (JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) as Event) : {};
  const pr = event.pull_request;
  const asked = input('mode', 'auto');
  const mode = asked === 'auto' ? (pr ? 'diff' : 'render') : asked;
  if (mode !== 'diff' && mode !== 'render') throw new Error(`mode: "${asked}" is not one of auto, diff, render, setup`);

  const files = list(input('files'));
  const output = path.resolve(root, input('output') || path.join(env.RUNNER_TEMP || os.tmpdir(), 'cartography'));
  const annotate = (file: string, diagnostics: Diagnostic[]) => {
    for (const d of diagnostics) log(`::${d.severity === 'error' ? 'error' : 'warning'} file=${file}${d.line ? `,line=${d.line}${d.column ? `,col=${d.column}` : ''}` : ''}::${escape(d.message)}`);
  };
  const finish = (r: RunResult, outputs: Record<string, string> = {}): RunResult => {
    const all = { mode: r.mode, changed: String(r.changed), images: r.images, output: r.output ?? '', upload: String(r.upload), ...outputs };
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries(all).map(([k, v]) => `${k}=${v.replace(/\r?\n/g, ' ')}\n`).join(''));
    return r;
  };
  const summarise = (text: string) => {
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text.replace(MARKER + '\n', '') + '\n');
  };

  if (mode === 'render') {
    const formats = list(input('formats', 'svg')).filter((f): f is Format => f === 'svg' || f === 'png');
    const into = input('output');
    const r = await renderAll(root, { ...(files.length ? { files } : {}), formats, ...(into ? { output: path.relative(root, output).split(path.sep).join('/') } : {}), views: yes(input('views', 'true')), scale: Number(input('scale')) || 2 });
    for (const rep of r.reports) annotate(rep.file, rep.diagnostics);
    log(`${r.written.length} picture${r.written.length === 1 ? '' : 's'} drawn`);
    let commit: string | undefined;
    const commits = yes(input('commit', 'false'));
    if (commits && r.written.length) {
      const branch = env.GITHUB_REF_TYPE === 'tag' ? undefined : env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME;
      commit = commitPictures(root, r.written, { message: input('commit-message', 'Render diagrams [skip ci]'), ...(branch ? { branch } : {}) });
      log(commit ? `Committed ${commit.slice(0, 7)}${branch ? ` and pushed to ${branch}` : ''}` : 'The pictures in the repository were up to date');
    }
    summarise(`### Diagrams\n\n${r.written.length} drawn${commit ? `, committed as \`${commit.slice(0, 7)}\`` : ''}${r.failed ? ', with errors (see the annotations)' : ''}.`);
    const ok = !(r.failed && yes(input('fail-on-error', 'true')));
    return finish({ mode: 'render', ok, changed: r.written.length, images: 'none', ...(into ? { output } : {}), upload: !commits && !!into && r.written.length > 0, ...(commit ? { commit } : {}) }, { commit: commit ?? '' });
  }

  // On a pull request.
  const repo = env.GITHUB_REPOSITORY ?? '';
  const fork = !!pr && pr.head?.repo?.full_name !== repo;
  const wanted = input('images', 'auto');
  if (!['auto', 'branch', 'artifact', 'none'].includes(wanted)) throw new Error(`images: "${wanted}" is not one of auto, branch, artifact, none`);
  const branch = input('image-branch', 'cartography-diffs');
  const folder = pr ? `pr-${pr.number}` : '';
  // A fork's token cannot push here, and a push to a branch needs a pull request to file it under.
  const onBranch = wanted === 'branch' || (wanted === 'auto' && !!pr && !fork);

  if (pr && event.action === 'closed') {
    if (onBranch) {
      try {
        const gone = unpublish(root, { branch, folder });
        log(gone.commit ? `Removed ${folder} from ${branch}` : `Nothing of this pull request on ${branch}`);
      } catch (e) {
        log(`::warning::${escape(`Could not tidy ${branch}: ${(e as Error).message}`)}`);
      }
    }
    return finish({ mode: 'cleanup', ok: true, changed: 0, images: 'none', upload: false });
  }

  const base = resolveBase(root, input('base'), event);
  const p = await plan(root, base, { ...(files.length ? { files } : {}), views: yes(input('views', 'true')) });
  for (const t of p.targets) annotate(t.file, t.comparison.diagnostics);
  for (const x of p.problems) log(`::error file=${x.file}::${escape(x.message)}`);
  const touched = new Set(p.targets.map((t) => t.file)).size;
  log(`${p.checked} diagram${p.checked === 1 ? '' : 's'} looked at, ${touched} changed`);

  const head = (pr?.head?.sha || env.GITHUB_SHA || git(['rev-parse', 'HEAD'], root).trim()).slice(0, 7);
  const against = pr?.base?.ref || base.slice(0, 7);
  const shots: Shot[] =
    wanted === 'none'
      ? []
      : await shoot(p.targets, { sideBySide: yes(input('side-by-side', 'false')), against, head: pr ? `#${pr.number}` : head, scale: Number(input('scale')) || 2, limit: Number(input('max-images')) || 12 });

  // This run's files, for an artifact or the next step.
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const s of shots) fs.writeFileSync(path.join(output, s.name), s.data);
  fs.writeFileSync(
    path.join(output, 'diff.json'),
    JSON.stringify(p.targets.map((t) => ({ file: t.file, ...(t.view ? { view: t.view } : {}), state: t.state, because: t.because, errors: t.comparison.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), ...t.comparison.diff })), null, 2),
  );

  let images: RunResult['images'] = shots.length ? 'artifact' : 'none';
  const urls = new Map<Shot['target'], string>();
  let ok = true;
  if (onBranch && pr) {
    try {
      // The commit in the name: a new push gets new addresses, so nobody is shown a cached old picture.
      const named = shots.map((s) => ({ shot: s, name: `${head}-${s.name}` }));
      const done = publish(root, { branch, folder, files: named.map((n) => ({ name: n.name, data: n.shot.data })) });
      for (const n of named) urls.set(n.shot.target, imageUrl(env.GITHUB_SERVER_URL || 'https://github.com', repo, branch, done.paths.get(n.name)!));
      if (shots.length) images = 'branch';
      if (done.commit) log(`${shots.length} picture${shots.length === 1 ? '' : 's'} on ${branch}/${folder}`);
    } catch (e) {
      const why = `${(e as Error).message}. The pictures are in the run's artifact instead; pushing to ${branch} needs "permissions: contents: write".`;
      if (wanted === 'branch') {
        log(`::error::${escape(why)}`);
        ok = false;
      } else log(`::warning::${escape(why)}`);
    }
  }

  const run = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : '';
  const body = commentBody(p, { images: urls, against, head, ...(run && images === 'artifact' ? { artifact: { url: run, name: input('artifact-name', 'cartography-diagrams') } } : {}) });
  if (body) fs.writeFileSync(path.join(output, 'comment.md'), body);
  summarise(body ?? '### Diagram changes\n\nNo diagram is touched by this change.');

  let comment: Posted | undefined;
  const token = input('token');
  if (pr && yes(input('comment', 'true'))) {
    if (fork && !deps.api) log('::notice::A pull request from a fork: the token is read-only, so no comment. The summary and the pictures are in this run.');
    else if (!token && !deps.api) log('::warning::No token: no comment on the pull request');
    else {
      try {
        const api = deps.api ?? githubApi({ token, repo, ...(env.GITHUB_API_URL ? { api: env.GITHUB_API_URL } : {}) });
        comment = await upsertComment(api, pr.number, body);
        log(`Comment ${comment.action}${comment.comment?.url ? `: ${comment.comment.url}` : ''}`);
      } catch (e) {
        // Not being allowed to comment is no reason to fail the build: the summary has it all.
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) log(`::warning::${escape(`${e.message}. Commenting needs "permissions: pull-requests: write".`)}`);
        else throw e;
      }
    }
  }

  for (const t of p.targets) log(`  ${titleOf(t)}: ${t.state}`);
  if (yes(input('fail-on-error', 'true')) && (p.problems.length || p.targets.some((t) => t.comparison.failed))) ok = false;
  return finish(
    { mode: 'diff', ok, changed: touched, images, output, upload: images === 'artifact', plan: p, ...(body ? { body } : {}), ...(comment ? { comment } : {}) },
    { diagrams: JSON.stringify([...new Set(p.targets.map((t) => t.file))]), 'comment-url': comment?.comment?.url ?? '' },
  );
}

const have = (root: string, rev: string) => {
  try {
    git(['cat-file', '-e', `${rev}^{commit}`], root);
    return true;
  } catch {
    return false;
  }
};

/**
 * The commit to compare with. On a pull request: where its branch left the base branch when the
 * checkout has the history to tell (fetch-depth: 0), else the tip of the base branch, which is what
 * the default checkout (the merge of the two) was made from. A shallow checkout does not have that
 * commit yet: it is fetched on its own.
 */
export function resolveBase(root: string, asked: string, event: Event): string {
  const wanted = asked || event.pull_request?.base?.sha || event.before || '';
  if (!wanted || /^0+$/.test(wanted)) throw new Error('Nothing to compare with: this is not a pull request. Set the `base` input to a commit or branch.');
  if (!have(root, wanted)) {
    try {
      git(['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', wanted], root);
    } catch {
      // reported below
    }
  }
  if (!have(root, wanted)) throw new Error(`${wanted} is not in this checkout and could not be fetched. Check out with fetch-depth: 0, or set the \`base\` input.`);
  if (!asked) {
    try {
      const fork = git(['merge-base', wanted, 'HEAD'], root).trim();
      if (fork) return fork;
    } catch {
      // shallow: no common history to find
    }
  }
  return git(['rev-parse', `${wanted}^{commit}`], root).trim();
}

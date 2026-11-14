// Pictures for a pull request comment need an address, and an action has no server. They go on a
// branch of their own in the same repository: readable by exactly the people who can read the pull
// request (private repositories included), no extra service, no secret beyond the job's own token.
//
// The branch never has history: every run writes one new commit without a parent that holds the
// current pictures of every open pull request, so the repository does not grow with each push.
// Written with git plumbing on a temporary index; the work tree and HEAD are not touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git } from '@linework/diff/node';

export interface ImageFile {
  name: string;
  data: Uint8Array;
}

export interface PublishOptions {
  remote?: string;
  /** The branch that holds the pictures. */
  branch: string;
  /** This run's folder on it ("pr-12"); what was there before is replaced. */
  folder: string;
  files: ImageFile[];
  message?: string;
  /** How often to start over when another run pushed first. */
  attempts?: number;
}

export interface Published {
  branch: string;
  /** The commit on the branch, or undefined when nothing had to change. */
  commit?: string;
  /** Picture name → its path on the branch. */
  paths: Map<string, string>;
}

const WHO = { GIT_AUTHOR_NAME: 'linework', GIT_AUTHOR_EMAIL: 'linework@users.noreply.github.com', GIT_COMMITTER_NAME: 'linework', GIT_COMMITTER_EMAIL: 'linework@users.noreply.github.com' };

const README = `# Diagram pictures

Pictures for pull request comments, written by the Linework action. Each open pull request has a
folder; it is replaced on every push and removed when the pull request closes. This branch holds one
commit and no history. Nothing else uses it: deleting it only breaks the pictures in old comments.
`;

/** Replaces `folder` on the branch with `files` (none: the folder goes) and pushes. Throws when the push is refused. */
export function publish(root: string, opts: PublishOptions): Published {
  const remote = opts.remote ?? 'origin';
  const ref = `refs/heads/${opts.branch}`;
  const local = `refs/linework/${opts.branch}`;
  const paths = new Map(opts.files.map((f) => [f.name, `${opts.folder}/${f.name}`]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linework-index-'));
  const env = { ...WHO, GIT_INDEX_FILE: path.join(tmp, 'index') };
  try {
    let last: unknown;
    for (let attempt = 0; attempt < (opts.attempts ?? 3); attempt++) {
      // What is on the branch now, if it exists.
      let old = '';
      try {
        git(['fetch', '--quiet', '--no-tags', '--depth=1', remote, `+${ref}:${local}`], root);
        old = git(['rev-parse', '--verify', '--quiet', local], root).trim();
      } catch {
        old = '';
      }
      if (old) git(['read-tree', old], root, undefined, env);
      else git(['read-tree', '--empty'], root, undefined, env);
      const before = old ? git(['rev-parse', `${old}^{tree}`], root).trim() : '';

      const stale = git(['ls-files', '-z', '--', `${opts.folder}/`], root, undefined, env).split('\0').filter(Boolean);
      if (stale.length) git(['update-index', '--force-remove', '-z', '--stdin'], root, stale.join('\0') + '\0', env);
      const put = (file: string, data: Uint8Array) => {
        const blob = git(['hash-object', '-w', '--stdin'], root, data).trim();
        git(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], root, undefined, env);
      };
      put('README.md', Buffer.from(README));
      for (const f of opts.files) put(paths.get(f.name)!, f.data);
      const tree = git(['write-tree'], root, undefined, env).trim();
      if (tree === before) return { branch: opts.branch, paths };
      // Nothing of ours to add and no branch yet: do not create one just to hold a README.
      if (!old && !opts.files.length) return { branch: opts.branch, paths };

      const commit = git(['commit-tree', tree, '-m', opts.message ?? `Diagram pictures: ${opts.folder}`], root, undefined, env).trim();
      try {
        // Only if the branch is still where it was read: another pull request's run may have pushed meanwhile.
        git(['push', '--quiet', `--force-with-lease=${ref}:${old}`, remote, `${commit}:${ref}`], root);
        return { branch: opts.branch, commit, paths };
      } catch (e) {
        last = e;
      }
    }
    throw new Error(`Could not push the pictures to ${opts.branch}: ${message(last)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    try {
      git(['update-ref', '-d', local], root);
    } catch {
      // never fetched
    }
  }
}

/** Takes a pull request's folder off the branch (when it closes). */
export function unpublish(root: string, opts: Omit<PublishOptions, 'files'>): Published {
  return publish(root, { ...opts, files: [], message: opts.message ?? `Diagram pictures: ${opts.folder} removed` });
}

const message = (e: unknown) => {
  const err = e as { stderr?: Buffer | string; message?: string };
  return (err?.stderr?.toString().trim() || err?.message || String(e)).split('\n').slice(-3).join(' ');
};

/**
 * The address of a file on a branch, as an image. github.com/<repo>/blob/<branch>/<path>?raw=true
 * rather than raw.githubusercontent.com: it also works in private repositories, where it sends a
 * signed-in reader on with their own access.
 */
export function imageUrl(server: string, repo: string, branch: string, file: string): string {
  const enc = (s: string) => s.split('/').map(encodeURIComponent).join('/');
  return `${server.replace(/\/+$/, '')}/${repo}/blob/${enc(branch)}/${enc(file)}?raw=true`;
}

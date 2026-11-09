// The one thing asked of GitHub's API: keep a single comment on the pull request up to date.
// Kept this thin on purpose, so everything else can be tested without GitHub.

export interface Comment {
  id: number;
  body: string;
  url?: string;
}

export interface GitHubApi {
  listComments(pr: number): Promise<Comment[]>;
  createComment(pr: number, body: string): Promise<Comment>;
  updateComment(id: number, body: string): Promise<Comment>;
  deleteComment(id: number): Promise<void>;
}

export interface ApiOptions {
  token: string;
  /** "owner/name" */
  repo: string;
  /** https://api.github.com, or a GitHub Enterprise Server's. */
  api?: string;
  fetch?: typeof globalThis.fetch;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function githubApi(opts: ApiOptions): GitHubApi {
  const base = `${(opts.api ?? 'https://api.github.com').replace(/\/+$/, '')}/repos/${opts.repo}`;
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const res = await (opts.fetch ?? globalThis.fetch)(`${base}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${opts.token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'cartography-action',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let said = text;
      try {
        said = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        // not JSON
      }
      throw new ApiError(`GitHub ${method} ${path}: ${res.status} ${said}`.trim(), res.status);
    }
    return res.status === 204 ? undefined : res.json();
  };
  const comment = (c: unknown): Comment => {
    const x = c as { id: number; body?: string; html_url?: string };
    return { id: x.id, body: x.body ?? '', ...(x.html_url ? { url: x.html_url } : {}) };
  };
  return {
    async listComments(pr) {
      const out: Comment[] = [];
      // A pull request with more than a thousand comments has other problems.
      for (let page = 1; page <= 10; page++) {
        const list = (await call('GET', `/issues/${pr}/comments?per_page=100&page=${page}`)) as unknown[];
        out.push(...list.map(comment));
        if (list.length < 100) break;
      }
      return out;
    },
    createComment: async (pr, body) => comment(await call('POST', `/issues/${pr}/comments`, { body })),
    updateComment: async (id, body) => comment(await call('PATCH', `/issues/comments/${id}`, { body })),
    deleteComment: async (id) => void (await call('DELETE', `/issues/comments/${id}`)),
  };
}

/** Hidden in the comment, to find it again on the next run. */
export const MARKER = '<!-- cartography-diff -->';

export type Posted = { action: 'created' | 'updated' | 'unchanged' | 'removed' | 'none'; comment?: Comment };

/**
 * One comment per pull request: the one carrying the marker is rewritten, a new one is made only
 * when there is none. `body` undefined: there is nothing to say (any more), so an old comment goes
 * and no new one appears.
 */
export async function upsertComment(api: GitHubApi, pr: number, body: string | undefined, marker = MARKER): Promise<Posted> {
  const mine = (await api.listComments(pr)).filter((c) => c.body.includes(marker));
  const [first, ...extra] = mine;
  // Left over from a run that raced another: keep one.
  for (const c of extra) await api.deleteComment(c.id);
  if (body === undefined) {
    if (!first) return { action: 'none' };
    await api.deleteComment(first.id);
    return { action: 'removed', comment: first };
  }
  const text = body.includes(marker) ? body : `${marker}\n${body}`;
  if (!first) return { action: 'created', comment: await api.createComment(pr, text) };
  if (first.body.trim() === text.trim()) return { action: 'unchanged', comment: first };
  return { action: 'updated', comment: await api.updateComment(first.id, text) };
}

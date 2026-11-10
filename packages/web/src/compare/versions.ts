// What the open diagram can be compared with in the browser: the file as last saved, a snapshot,
// another file, or a commit read from the folder's .git. Each comes with what render needs to draw it
// as it was: its own pins and, for a commit, the files it includes as they were in that commit.
import type { LayoutSidecar } from '@cartography/core';
import { render } from '@cartography/engine';
import type { Repo } from './git.ts';
import { t } from '../i18n/index.ts';

export type BaselineKind = 'saved' | 'snapshot' | 'file' | 'git' | 'stage';

export interface Baseline {
  /** 'saved', 'snapshot:<label>', 'file:<path>', 'git:<commit>'. */
  id: string;
  kind: BaselineKind;
  /** What it is called in the toolbar, the key and the summary: "last saved", "snapshot Before review", "HEAD". */
  name: string;
  /** Its text; undefined when the file did not exist then (everything is new). */
  text: string | undefined;
  sidecar?: LayoutSidecar;
  /** How it reads what it includes; without it, as the open diagram does. */
  load?: (file: string) => string;
  /** Comparing two stages of the open diagram: the stage drawn as before, the one drawn as now, and what replaces what between them. */
  stage?: string;
  toStage?: string;
  replaces?: { from: string; to: string }[];
}

const utf8 = new TextDecoder();

/** A path relative to a diagram, as a repository path; undefined when it leaves the repository. */
export function joinPath(diagram: string, rel: string): string | undefined {
  if (rel.startsWith('/')) return undefined;
  const parts = diagram.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '..') {
      if (!parts.length) return undefined;
      parts.pop();
    } else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * The engine reads includes synchronously; a commit is read asynchronously. So the diagram is drawn
 * once to learn what it asks for, those files are fetched, and again until it asks for nothing new.
 */
export async function prefetched(text: string, file: string, fetch: (path: string) => Promise<string | undefined>, rounds = 5): Promise<(f: string) => string> {
  const got = new Map<string, string | undefined>();
  const load = (rel: string) => {
    const p = joinPath(file, rel);
    if (p === undefined) throw new Error(`${rel} is outside the repository`);
    const hit = got.get(p);
    if (hit === undefined) throw new Error(got.has(p) ? `No file ${rel} in that version` : `Not read yet: ${rel}`);
    return hit;
  };
  for (let i = 0; i < rounds; i++) {
    const asked = new Set<string>();
    await render(text, { fonts: 'none', file: file.split('/').pop(), load: (rel) => {
      const p = joinPath(file, rel);
      if (p !== undefined && !got.has(p)) asked.add(p);
      return load(rel);
    } }).catch(() => undefined);
    if (!asked.size) break;
    for (const p of asked) got.set(p, await fetch(p));
  }
  return load;
}

const sidecarOf = (path: string) => path.replace(/\.ya?ml$/i, '') + '.layout.json';
const parsePins = (t: string | undefined): LayoutSidecar | undefined => {
  try {
    return t ? (JSON.parse(t) as LayoutSidecar) : undefined;
  } catch {
    return undefined;
  }
};

/** The diagram at a commit, with its pins and includes from that commit. `path` is from the top of the repository. */
export async function gitBaseline(repo: Repo, commit: string, path: string, name: string): Promise<Baseline> {
  const read = async (p: string) => ((b) => (b ? utf8.decode(b) : undefined))(await repo.fileAt(commit, p));
  const text = await read(path);
  const sidecar = parsePins(await read(sidecarOf(path)));
  const load = text === undefined ? undefined : await prefetched(text, path, read);
  return { id: `git:${commit}`, kind: 'git', name, text, ...(sidecar ? { sidecar } : {}), ...(load ? { load } : {}) };
}

/** "3 days ago", "just now": for a commit or a snapshot in a list. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return t('just now');
  if (s < 3600) return t('{count} minute ago|{count} minutes ago', { count: Math.round(s / 60) });
  if (s < 86400) return t('{count} hour ago|{count} hours ago', { count: Math.round(s / 3600) });
  if (s < 86400 * 45) return t('{count} day ago|{count} days ago', { count: Math.round(s / 86400) });
  return new Date(ms).toISOString().slice(0, 10);
}

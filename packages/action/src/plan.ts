// Which diagrams a change touches, and what it does to each. A diagram is touched when its own file
// changed, when its pins did, or when anything it reads did (a model it includes, a contract, an icon):
// found by drawing it and noting every file it asks for, so nothing has to be declared.
import { compare, type Comparison } from '@linework/diff';
import { changedFiles, git, sidecarOf, versionAt, versionOnDisk, type ChangedFile } from '@linework/diff/node';
import { findType, render } from '@linework/engine';

export interface Target {
  /** Repository path of the diagram. */
  file: string;
  /** One of its views; without it the diagram as written. */
  view?: string;
  /**
   * new and removed: the file (or the view) is. changed: what is drawn differs. layout: only where
   * things stand differs (pins). broken: draws the same as before, or not at all, and has errors.
   */
  state: 'new' | 'removed' | 'changed' | 'layout' | 'broken';
  /** The changed files that put it on the list, other than the diagram itself. */
  because: string[];
  comparison: Comparison;
}

export interface Plan {
  base: string;
  targets: Target[];
  /** Diagrams that read a changed file and still draw the same. */
  untouched: string[];
  /** How many diagrams were looked at. */
  checked: number;
  /** Diagrams that could not be compared at all, with why. */
  problems: { file: string; message: string }[];
}

export interface PlanOptions {
  /** Which files may be diagrams: git globs ("docs/**\/*.yaml"), "!" in front to leave some out. */
  files?: string[];
  /** Compare every view of a diagram too (default), or only the diagram as written. */
  views?: boolean;
}

export const DEFAULT_FILES = ['**/*.yaml', '**/*.yml'];

/** "docs/**" and "!docs/old/**" as git pathspecs; git does the globbing, the same on every machine. */
export function pathspecs(patterns: string[] = DEFAULT_FILES): string[] {
  const list = patterns.map((p) => p.trim()).filter(Boolean);
  const out = list.map((p) => (p.startsWith('!') ? `:(glob,exclude)${p.slice(1)}` : `:(glob)${p}`));
  // Only exclusions: everything else is meant.
  return out.every((p) => p.startsWith(':(glob,exclude)')) ? [...DEFAULT_FILES.map((p) => `:(glob)${p}`), ...out] : out;
}

/** A YAML file is a diagram when its `type:` is one Linework draws; workflows, compose files and the like are not. */
export function isDiagram(text: string | undefined): boolean {
  const id = text?.match(/^type:[ \t]*["']?([\w-]+)/m)?.[1];
  return !!id && (id === 'model' || !!findType(id));
}

const isYaml = (p: string) => /\.ya?ml$/.test(p);

/** Diagrams in the work tree, of the files git tracks. */
export function diagrams(root: string, patterns?: string[]): string[] {
  return git(['ls-files', '-z', '--', ...pathspecs(patterns)], root)
    .split('\0')
    .filter((p) => p && isYaml(p))
    .filter((p) => isDiagram(versionOnDisk(root, p).text))
    .sort();
}

/** The work tree against `base`: every diagram the change touches, compared. */
export async function plan(root: string, base: string, opts: PlanOptions = {}): Promise<Plan> {
  const changed = changedFiles(root, base, 'HEAD');
  const status = new Map(changed.map((c) => [c.path, c.status]));
  const out: Plan = { base, targets: [], untouched: [], checked: 0, problems: [] };
  if (!changed.length) return out;

  const now = diagrams(root, opts.files);
  // What a diagram can read besides itself: other YAML (include, theme), layout notes and pictures.
  // A change with none of those (code only) cannot reach a diagram that did not change itself.
  const readable = changed.some((c) => /\.(ya?ml|json|svg|png|jpe?g|gif|webp)$/i.test(c.path));
  // Diagrams that are gone: among the removed files of the same globs.
  const gone = changedFiles(root, base, 'HEAD', pathspecs(opts.files))
    .filter((c: ChangedFile) => c.status === 'removed' && isYaml(c.path) && isDiagram(versionAt(root, base, c.path).text))
    .map((c) => c.path);

  for (const file of [...now, ...gone].sort()) {
    out.checked++;
    try {
      const after = versionOnDisk(root, file);
      const before = versionAt(root, base, file);
      const own = status.has(file) || status.has(sidecarOf(file));
      if (!own) {
        if (!readable) continue;
        // Not changed itself: draw it once to learn what it reads.
        await render(after.text!, { ...after.options, fonts: 'none' });
        if (![...after.read].some((p) => status.has(p))) continue;
      }
      const options = { before: before.options, after: after.options };
      const whole = await compare(before.text, after.text, options);
      const because = () => [...new Set([...after.read, ...before.read])].filter((p) => status.has(p)).sort();
      const list: Target[] = [];
      const add = (c: Comparison, view?: string, state?: Target['state']) => {
        const s = state ?? stateOf(c, before.text, after.text, status.has(sidecarOf(file)));
        if (s) list.push({ file, ...(view ? { view } : {}), state: s, because: because(), comparison: c });
      };
      add(whole);
      if (opts.views !== false) {
        const was = new Set((whole.before?.views ?? []).map((v) => v.name));
        const is = new Set((whole.after?.views ?? []).map((v) => v.name));
        // A file with only views draws its first one as "the diagram": that one is already compared.
        const drawn = whole.after?.onlyViews ? whole.after.view : whole.before?.onlyViews ? whole.before.view : undefined;
        for (const view of [...new Set([...was, ...is])]) {
          if (view === drawn) continue;
          const c = await compare(was.has(view) ? before.text : undefined, is.has(view) ? after.text : undefined, { ...options, view });
          add(c, view, before.text !== undefined && after.text !== undefined && !was.has(view) ? 'new' : before.text !== undefined && after.text !== undefined && !is.has(view) ? 'removed' : undefined);
        }
      }
      if (list.length) out.targets.push(...list);
      else out.untouched.push(file);
    } catch (e) {
      out.problems.push({ file, message: (e as Error).message });
    }
  }
  return out;
}

function stateOf(c: Comparison, before: string | undefined, after: string | undefined, pins: boolean): Target['state'] | undefined {
  if (before === undefined) return 'new';
  if (after === undefined) return 'removed';
  if (!c.diff.same) return 'changed';
  if (c.failed) return 'broken';
  if (pins && moved(c)) return 'layout';
  return undefined;
}

/** Something stands somewhere else: a pin was added, moved or dropped. */
function moved(c: Comparison): boolean {
  const a = c.before?.placed;
  const b = c.after?.placed;
  if (!a || !b) return false;
  for (const [id, box] of b.nodes) {
    const old = a.nodes.get(id);
    if (!old || Math.abs(old.x - box.x) > 0.5 || Math.abs(old.y - box.y) > 0.5) return true;
  }
  for (const [id, route] of b.edges) {
    const old = a.edges.get(id);
    if (!old || old.points.length !== route.points.length || old.points.some((p, i) => Math.abs(p.x - route.points[i]!.x) > 0.5 || Math.abs(p.y - route.points[i]!.y) > 0.5)) return true;
  }
  return false;
}

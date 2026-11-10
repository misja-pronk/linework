// GitHub Actions workflows (.github/workflows/*.yml) → a `type: process` diagram of one workflow: what
// starts it, its jobs as tasks, `needs:` as the flow, a matrix noted on the job it fans out, a job's
// `if:` on the line into it, reusable workflows as subprocesses. Jobs that deploy to an environment
// stand in a lane of that environment; a production environment is a gate (someone approves) before
// its job. When the folder has a github diagram with that environment, the job links to it.
import { parse } from 'yaml';
import { writeDrawn, type Drawn } from './graph-keep.ts';
import { isObj, str, type Obj } from './keep.ts';
import { slug, Warnings } from './text.ts';
import type { Imported } from './index.ts';

export interface WorkflowOptions {
  title?: string;
  existing?: string;
  tag?: boolean;
  /** A github diagram in the same folder: its file (as a link from this one) and its environments by name. */
  github?: { file: string; environments: string[] };
}

export const isWorkflowPath = (path: string): boolean => /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(path);

/** A workflow: on: and jobs: with runs-on or uses. */
export function isWorkflow(text: string): boolean {
  if (!/^jobs\s*:/m.test(text)) return false;
  try {
    const d = parse(text) as unknown;
    return isObj(d) && isObj(d.jobs) && ('on' in d || 'true' in d) && Object.values(d.jobs).some((j) => isObj(j) && (j['runs-on'] !== undefined || j.uses !== undefined));
  } catch {
    return false;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);
/** A name the flow can carry: no colons or arrows, one line. */
const clean = (s: string) => s.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, '$1').replace(/->|:|#|\n/g, ' ').replace(/[[\]{}"']/g, '').replace(/\s+/g, ' ').trim();

/** What starts it, in words: "push to main, pull request, by hand". */
function triggers(on: unknown): string[] {
  const keys = typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : isObj(on) ? Object.keys(on) : [];
  const conf = isObj(on) ? on : {};
  return keys.map((k) => {
    const c = isObj(conf[k]) ? (conf[k] as Obj) : {};
    const branches = list(c.branches);
    const tags = list(c.tags);
    if (k === 'push') return tags.length && !branches.length ? `tag ${tags[0]}` : branches.length ? `push to ${branches.slice(0, 2).join(', ')}` : 'push';
    if (k === 'pull_request' || k === 'pull_request_target') return branches.length ? `pull request to ${branches[0]}` : 'pull request';
    if (k === 'workflow_dispatch') return 'by hand';
    if (k === 'schedule') return 'on schedule';
    if (k === 'workflow_call') return 'called by another workflow';
    if (k === 'release') return 'release';
    if (k === 'workflow_run') return `after ${list(c.workflows)[0] ?? 'another workflow'}`;
    return k.replace(/_/g, ' ');
  });
}

const GATE = /\b(prod|production|live|prd)\b/i;

export function importWorkflow(text: string, name = 'workflow', opts: WorkflowOptions = {}): Imported & { summary: string } {
  const warn = new Warnings();
  let doc: Obj;
  try {
    const d = parse(text) as unknown;
    if (!isObj(d) || !isObj(d.jobs)) return { yaml: '', warnings: ['No jobs: in this workflow'], summary: '' };
    doc = d;
  } catch (e) {
    return { yaml: '', warnings: [`Not a workflow that can be read: ${(e as Error).message.split('\n')[0]}`], summary: '' };
  }
  // YAML 1.1 reads a bare `on:` as true.
  const on = 'on' in doc ? doc.on : (doc as Record<string, unknown>)['true'];
  const jobs = Object.entries(doc.jobs as Obj).filter(([, j]) => isObj(j)) as [string, Obj][];
  const title = opts.title ?? str(doc.name) ?? name;

  // ---- names: the steps of the flow are named after the jobs
  const taken = new Set<string>(['start', 'end']);
  const nameOf = new Map<string, string>();
  for (const [id, j] of jobs) {
    let n = clean(str(j.name) ?? id) || id;
    // A name that ends in ? would be read as a decision.
    n = n.replace(/\?+$/, '');
    for (let i = 2; taken.has(n.toLowerCase()); i++) n = `${clean(str(j.name) ?? id)} ${i}`;
    taken.add(n.toLowerCase());
    nameOf.set(id, n);
  }
  const envOf = (j: Obj) => (isObj(j.environment) ? str(j.environment.name) : str(j.environment));

  const lanes: Record<string, Obj> = {};
  const envs = [...new Set(jobs.map(([, j]) => envOf(j)).filter((e): e is string => !!e))];
  const laneId = (env: string) => `env-${slug(env).toLowerCase()}`;
  if (envs.length) {
    lanes.pipeline = { label: 'Pipeline' };
    for (const e of envs) lanes[laneId(e)] = { label: /\$\{\{/.test(e) ? clean(e) : e };
  }

  const nodes: Record<string, Obj> = {};
  const flow: unknown[] = [];
  const start = clean(`On ${triggers(on).join(', ') || 'trigger'}`);
  nodes[start] = { kind: 'start', ...(envs.length ? { in: 'pipeline' } : {}) };
  let matrices = 0;
  const gates: string[] = [];
  const linked = new Set<string>();
  const entry = new Map<string, string>();
  for (const [id, j] of jobs) {
    const n = nameOf.get(id)!;
    const env = envOf(j);
    const caption: string[] = [];
    const strategy = isObj(j.strategy) ? j.strategy : {};
    const matrix = isObj(strategy.matrix) ? strategy.matrix : typeof strategy.matrix === 'string' ? { from: [strategy.matrix] } : undefined;
    if (matrix) {
      const axes = Object.entries(matrix).filter(([k, v]) => k !== 'include' && k !== 'exclude' && Array.isArray(v)) as [string, unknown[]][];
      const count = axes.reduce((p, [, v]) => p * v.length, 1) + (Array.isArray(matrix.include) ? matrix.include.length : 0) - (Array.isArray(matrix.exclude) ? matrix.exclude.length : 0);
      if (axes.length) caption.push(`matrix ×${count}: ${axes.map(([k]) => k).join(' × ')}`);
      else caption.push('matrix');
      matrices++;
    }
    const uses = str(j.uses);
    if (uses) caption.push(`uses ${uses.replace(/^\.\/\.github\/workflows\//, '').replace(/@.*$/, '')}`);
    else {
      const runsOn = Array.isArray(j['runs-on']) ? j['runs-on'].map(String).join(', ') : isObj(j['runs-on']) ? str((j['runs-on'] as Obj).group) : str(j['runs-on']);
      if (runsOn && !/^ubuntu-latest$/.test(runsOn) && !matrix) caption.push(clean(runsOn));
    }
    if (env && isObj(j.environment) && str(j.environment.url)) caption.push(clean(str(j.environment.url)!.replace(/^https?:\/\//, '')));
    const entryNode: Obj = { kind: uses ? 'subprocess' : env ? 'service' : 'script', ...(envs.length ? { in: env ? laneId(env) : 'pipeline' } : {}), ...(caption.length ? { caption: caption.join(' · ') } : {}) };
    if (env && opts.github?.environments.some((e) => e.toLowerCase() === env.toLowerCase())) {
      entryNode.links = [opts.github.file];
      linked.add(env);
    }
    nodes[n] = entryNode;
    entry.set(id, n);
    // A production environment: someone approves before the job runs.
    if (env && GATE.test(env)) {
      const gate = `Approve ${env}`;
      if (!nodes[gate]) {
        nodes[gate] = { kind: 'user', in: laneId(env), caption: 'environment protection' };
        gates.push(env);
      }
      entry.set(id, gate);
    }
  }

  // ---- needs: the flow; a job's if: on the line into it
  const needed = new Set<string>();
  for (const [id, j] of jobs) {
    const needs = list(j.needs).filter((x) => {
      if (nameOf.has(x)) return true;
      warn.add(`${nameOf.get(id)} needs ${x}, which is not a job of this workflow`);
      return false;
    });
    for (const x of needs) needed.add(x);
    const cond = typeof j.if === 'string' ? clean(j.if).replace(/^github\./, '').replace(/ref == refs\/heads\/(\S+)/, 'on $1').replace(/event_name == (\S+)/, 'on $1') : undefined;
    const into = entry.get(id)!;
    const froms = needs.length ? needs.map((x) => nameOf.get(x)!) : [start];
    for (const f of froms) flow.push(cond && cond.length <= 32 ? { [`${f} -> ${into}`]: cond } : `${f} -> ${into}`);
    if (into !== nameOf.get(id)) flow.push(`${into} -> ${nameOf.get(id)}`);
    if (cond && cond.length > 32) warn.add(`${nameOf.get(id)} runs only if ${cond}`);
  }
  // From the start first: the first line is the one drawn as the main path.
  flow.sort((a, b) => Number(JSON.stringify(b).startsWith(`"${start} ->`) || JSON.stringify(b).startsWith(`{"${start} ->`)) - Number(JSON.stringify(a).startsWith(`"${start} ->`) || JSON.stringify(a).startsWith(`{"${start} ->`)));
  // What nothing needs is where the workflow ends.
  for (const [id] of jobs) if (!needed.has(id)) flow.push(`${nameOf.get(id)} -> end`);

  const d: Drawn = {
    type: 'process',
    head: { title, subtitle: `From ${name}: ${plural(jobs.length, 'job')}${matrices ? `, ${matrices} with a matrix` : ''}` },
    maps: envs.length ? { lanes, nodes } : { nodes },
    lists: { flow },
    mine: { nodes: ['caption', 'links'] },
  };
  const yaml = writeDrawn(d, opts, warn);
  return {
    yaml,
    warnings: warn.list,
    summary: `${plural(jobs.length, 'job')}${envs.length ? `, deploys to ${envs.join(', ')}` : ''}${gates.length ? ` (${gates.join(', ')} approved first)` : ''}${linked.size ? `, linked to the github diagram` : ''}`,
  };
}

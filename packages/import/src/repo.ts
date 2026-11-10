// A code repository → one diagram per source it holds, as `carto import <repo>` and the web app's open
// folder find them: Compose files, Helm charts, Kubernetes manifests, Bicep (and compiled ARM
// templates), terraform show -json, OpenAPI and AsyncAPI files, GitHub Actions workflows. Dockerfiles
// say what a Compose service is built from; Terraform source and kustomizations are named as hints,
// with the command that makes something this can read. Each diagram has a file in the diagrams folder;
// importing again over those files keeps what was changed by hand. Pure: files in, diagrams out.
import { importAzure, isAzureExport } from './azure.ts';
import { bicepEntries } from './bicep.ts';
import { importCompose, isCompose, isComposeName, join } from './compose.ts';
import { importHelm, type ChartFile } from './helm.ts';
import { importKubernetes, isKubernetes } from './kubernetes.ts';
import { importAsyncApi, importOpenApi, isAsyncApi, isOpenApi } from './openapi.ts';
import { importTerraform, isTerraform } from './terraform.ts';
import { importWorkflow, isWorkflow, isWorkflowPath } from './workflows.ts';
import { slug } from './text.ts';

export interface RepoFile {
  /** Relative to the repository, with forward slashes. */
  path: string;
  text: string;
}

export type RepoKind = 'compose' | 'helm' | 'kubernetes' | 'bicep' | 'arm' | 'terraform' | 'openapi' | 'callbacks' | 'asyncapi' | 'workflow';

export interface RepoDiagram {
  kind: RepoKind;
  /** Where it goes: diagrams/services.yaml. */
  file: string;
  /** What it was made from: a file, or a folder (a chart). */
  sources: string[];
  yaml: string;
  warnings: string[];
  /** What it holds, in a few words. */
  summary: string;
  /** Imported over the diagram that was there: what was changed by hand is kept. */
  kept: boolean;
}

export interface RepoOptions {
  /** The folder the diagrams go into, relative to the repository. `diagrams` when not given. */
  out?: string;
  /** The repository's name, for titles. */
  name?: string;
  /** What is in a file of the repository already (an earlier import), by its path. */
  existing?: (file: string) => string | undefined;
  /** A Helm values file read over every chart's own (helm template -f). */
  values?: string;
}

export interface RepoScan {
  diagrams: RepoDiagram[];
  /** Things found that are not drawn, with what would draw them. */
  hints: string[];
}

const KIND_ORDER: RepoKind[] = ['compose', 'helm', 'kubernetes', 'bicep', 'arm', 'terraform', 'openapi', 'callbacks', 'asyncapi', 'workflow'];
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.split('/').pop()!;
const stem = (p: string) => baseOf(p).replace(/\.[^.]+$/, '');
const isDiagram = (text: string) => /^type:\s*[\w-]+\s*$/m.test(text) && !/^apiVersion\s*:/m.test(text);
const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Whether a folder's files hold anything a repository scan draws. */
export function isRepo(files: RepoFile[]): boolean {
  return files.some(
    (f) =>
      (isComposeName(f.path) && isCompose(f.text)) ||
      /(^|\/)Chart\.yaml$/.test(f.path) ||
      /\.bicep$/i.test(f.path) ||
      (isWorkflowPath(f.path) && isWorkflow(f.text)) ||
      (/\.(ya?ml|json)$/i.test(f.path) && (isOpenApi(f.text) || isAsyncApi(f.text))),
  );
}

export function scanRepo(files: RepoFile[], opts: RepoOptions = {}): RepoScan {
  const out = (opts.out ?? 'diagrams').replace(/^\.\/|\/+$/g, '');
  const name = opts.name ? capital(opts.name) : undefined;
  const inOut = (p: string) => out !== '' && (p === out || p.startsWith(`${out}/`));
  const all = files.filter((f) => !inOut(f.path) && !/(^|\/)(node_modules|\.git|vendor|dist)\//.test(f.path));
  const diagrams: RepoDiagram[] = [];
  const hints: string[] = [];
  const names = new Set<string>();
  const place = (want: string) => {
    const base = slug(want).toLowerCase() || 'diagram';
    let n = base;
    for (let i = 2; names.has(n); i++) n = `${base}-${i}`;
    names.add(n);
    return out ? `${out}/${n}.yaml` : `${n}.yaml`;
  };
  const add = (kind: RepoKind, want: string, sources: string[], r: { yaml: string; warnings: string[]; summary: string }, file = place(want)) => {
    if (!r.yaml) {
      hints.push(`${sources.join(', ')}: nothing drawn${r.warnings[0] ? ` (${r.warnings[0]})` : ''}`);
      return;
    }
    diagrams.push({ kind, file, sources, yaml: r.yaml, warnings: r.warnings, summary: r.summary, kept: opts.existing?.(file) !== undefined });
  };
  const was = (want: string) => {
    // The file a diagram will be written to, asked before it is placed so the name is the same.
    const base = slug(want).toLowerCase() || 'diagram';
    let n = base;
    for (let i = 2; names.has(n); i++) n = `${base}-${i}`;
    const file = out ? `${out}/${n}.yaml` : `${n}.yaml`;
    return opts.existing?.(file);
  };
  const used = new Set<string>();

  // ---- Helm charts: everything under a Chart.yaml is the chart's (its subcharts too).
  const charts = all
    .filter((f) => baseOf(f.path) === 'Chart.yaml')
    .map((f) => dirOf(f.path))
    .filter((d, _, list) => !list.some((o) => o !== d && (d === `${o}/charts` || d.startsWith(`${o}/charts/`))))
    .sort();
  const under = (dir: string, p: string) => (dir ? p.startsWith(`${dir}/`) : true);
  for (const dir of charts) {
    const own: ChartFile[] = all.filter((f) => under(dir, f.path)).map((f) => ({ path: dir ? f.path.slice(dir.length + 1) : f.path, text: f.text }));
    for (const f of all) if (under(dir, f.path)) used.add(f.path);
    const chartName = /^name\s*:\s*["']?([\w.-]+)/m.exec(own.find((f) => f.path === 'Chart.yaml')?.text ?? '')?.[1] ?? baseOf(dir || 'chart');
    const want = `${chartName}-chart`;
    const r = importHelm(own, { values: opts.values, existing: was(want), tag: true });
    add('helm', want, [dir || '.'], r);
    const extra = own.filter((f) => /^values[-.].+\.ya?ml$/.test(f.path)).map((f) => f.path);
    if (extra.length && !opts.values) hints.push(`${dir}: also ${extra.join(', ')}: --values ${dir}/${extra[0]} draws the chart with ${extra.length > 1 ? 'one of them' : 'it'}`);
  }

  // ---- Compose: one diagram a file, the override next to it read over it.
  const dockerfiles = Object.fromEntries(all.filter((f) => /(^|\/)(Dockerfile|[\w.-]+\.Dockerfile|Dockerfile\.[\w.-]+)$/.test(f.path)).map((f) => [f.path, f.text]));
  const composes = all.filter((f) => !used.has(f.path) && isComposeName(f.path) && isCompose(f.text));
  const builtFrom = new Set<string>();
  for (const f of composes.filter((c) => !/\.override\.ya?ml$/i.test(c.path))) {
    const dir = dirOf(f.path);
    const overrides = composes.filter((o) => dirOf(o.path) === dir && /\.override\.ya?ml$/i.test(o.path) && stem(o.path).replace(/\.override$/, '') === stem(f.path));
    // The Dockerfiles as the compose file names them: relative to its folder.
    const rel = Object.fromEntries(Object.entries(dockerfiles).filter(([p]) => under(dir, p)).map(([p, t]) => [dir ? p.slice(dir.length + 1) : p, t]));
    const suffix = /^(?:docker-)?compose\.([\w-]+)\.ya?ml$/i.exec(baseOf(f.path))?.[1];
    const want = `${dir && composes.filter((c) => !/\.override\./.test(c.path)).length > 1 ? `${baseOf(dir)}-` : ''}services${suffix ? `-${suffix}` : ''}`;
    const r = importCompose(f.text, { files: rel, overrides: overrides.map((o) => o.text), existing: was(want), tag: true });
    add('compose', want, [f.path, ...overrides.map((o) => o.path)], r);
    used.add(f.path);
    for (const o of overrides) used.add(o.path);
    // Which Dockerfiles it built from: the rest are named as hints.
    for (const m of f.text.matchAll(/(?:build:\s*|context:\s*)["']?([./][\w./-]*)/g)) builtFrom.add(join(dir, `${m[1]}/Dockerfile`));
  }
  const loose = Object.keys(dockerfiles).filter((p) => !builtFrom.has(p));
  if (loose.length) hints.push(`${loose.length > 3 ? `${loose.slice(0, 3).join(', ')} +${loose.length - 3}` : loose.join(', ')}: Dockerfile${loose.length > 1 ? 's' : ''} no Compose file builds; a Compose file or a chart that runs ${loose.length > 1 ? 'them' : 'it'} draws ${loose.length > 1 ? 'them' : 'it'}`);

  // ---- Bicep: one diagram per file no other uses as a module, with what it uses and its parameters file.
  const bicep = new Map(all.filter((f) => /\.bicep$/i.test(f.path)).map((f) => [f.path, f.text]));
  if (bicep.size) {
    const { entries, compiled } = bicepEntries(bicep);
    for (const p of all) if (/\.bicep$/i.test(p.path)) used.add(p.path);
    for (const entry of entries) {
      const closure = new Set([entry, ...(compiled.get(entry)?.modules ?? [])]);
      const params = all.filter((f) => /\.bicepparam$/i.test(f.path) && new RegExp(`^using\\s+['"]\\.?/?${baseOf(entry).replace(/\./g, '\\.')}['"]`, 'm').test(f.text) && dirOf(f.path) === dirOf(entry));
      for (const q of params) used.add(q.path);
      const base = stem(entry) === 'main' ? baseOf(dirOf(entry)) || name || 'infra' : stem(entry);
      const want = `${base}-azure`;
      const r = importAzure([...[...closure].map((p) => ({ path: p, text: bicep.get(p)! })), ...params.map((q) => ({ path: q.path, text: q.text }))], { title: `${name ? `${name} ` : ''}in Azure${entries.length > 1 ? ` (${baseOf(entry)})` : ''}`.trim().replace(/^in Azure/, 'In Azure'), existing: was(want) });
      add('bicep', want, [entry, ...params.map((q) => q.path)], r);
    }
  }

  // ---- JSON: compiled ARM templates (unless their Bicep is here), Terraform state and plans.
  for (const f of all) {
    if (used.has(f.path) || !/\.json$/i.test(f.path) || /\.layout\.json$/i.test(f.path)) continue;
    if (isTerraform(f.text)) {
      used.add(f.path);
      if (isAzureExport(f.text)) {
        const want = `${stem(f.path)}-azure`;
        add('arm', want, [f.path], importAzure([{ path: f.path, text: f.text }], { existing: was(want) }));
      } else {
        const r = importTerraform(f.text, `${capital(stem(f.path))}`);
        add('terraform', `${stem(f.path)}-cloud`, [f.path], { ...r, summary: 'Terraform' });
      }
    } else if (isAzureExport(f.text)) {
      used.add(f.path);
      if (bicep.has(f.path.replace(/\.json$/i, '.bicep'))) continue;
      const want = `${stem(f.path)}-azure`;
      add('arm', want, [f.path], importAzure([{ path: f.path, text: f.text }], { existing: was(want) }));
    }
  }
  const tf = [...new Set(all.filter((f) => /\.tf$/i.test(f.path)).map((f) => dirOf(f.path) || '.'))];
  if (tf.length) hints.push(`${tf.join(', ')}: Terraform source; terraform show -json (of a plan or the state) saved in the repository draws it`);

  // ---- API descriptions.
  const asyncs: RepoFile[] = [];
  for (const f of all) {
    if (used.has(f.path) || !/\.(ya?ml|json)$/i.test(f.path)) continue;
    if (isOpenApi(f.text)) {
      used.add(f.path);
      const title = /^\s*title\s*:\s*["']?(.+?)["']?\s*$/m.exec(f.text)?.[1] ?? stem(f.path);
      const want = slug(title).toLowerCase();
      const blocks = importOpenApi(f.text, stem(f.path), { existing: was(want), tag: true });
      for (const [i, b] of blocks.entries()) {
        const w = i === 0 ? want : `${want}-callbacks`;
        // A sequence is not merged into: one that is there already stays as it is.
        const there = i > 0 ? was(w) : undefined;
        add(i === 0 ? 'openapi' : 'callbacks', w, [f.path], there !== undefined ? { ...b, yaml: there, summary: `${b.summary}, as it was` } : b);
      }
    } else if (isAsyncApi(f.text)) {
      used.add(f.path);
      asyncs.push(f);
    }
  }
  if (asyncs.length) {
    const want = 'events';
    add('asyncapi', want, asyncs.map((f) => f.path), importAsyncApi(asyncs, { existing: was(want), tag: true, ...(asyncs.length > 1 && name ? { title: `${name} events` } : {}) }));
  }

  // ---- Kubernetes manifests outside charts: one diagram a folder.
  const k8s = new Map<string, RepoFile[]>();
  for (const f of all) {
    if (used.has(f.path) || !/\.(ya?ml|json)$/i.test(f.path) || isDiagram(f.text) || baseOf(f.path) === 'kustomization.yaml' || isWorkflowPath(f.path)) continue;
    if (!isKubernetes(f.text)) continue;
    used.add(f.path);
    const d = dirOf(f.path);
    k8s.set(d, [...(k8s.get(d) ?? []), f]);
  }
  for (const [d, list] of k8s) {
    // A folder called k8s or manifests says nothing the diagram's name should carry.
    const what = /^(k8s|kubernetes|kube|manifests|deploy|deployment|\.?)$/i.test(baseOf(d)) ? undefined : baseOf(d);
    const want = what ? `${what}-kubernetes` : 'kubernetes';
    const r = importKubernetes(list.map((f) => f.text).join('\n---\n'), `${capital(what ?? opts.name ?? 'Workloads')} on Kubernetes`, { existing: was(want) });
    const n = (/^nodes:\n((?:  .*\n?)*)/m.exec(r.yaml)?.[1] ?? '').split('\n').filter((l) => /^  \S/.test(l)).length;
    add('kubernetes', want, list.map((f) => f.path), { ...r, summary: `${list.length} manifest file${list.length > 1 ? 's' : ''}, ${n} cards` });
  }
  for (const f of all) if (baseOf(f.path) === 'kustomization.yaml') hints.push(`${dirOf(f.path) || '.'}: a kustomization; kustomize build ${dirOf(f.path) || '.'} > ${dirOf(f.path) || '.'}/built.yaml draws what it makes`);

  // ---- Workflows, each its own process, linked to a github diagram here when there is one.
  const github = all.find((f) => /\.ya?ml$/i.test(f.path) && /^type:\s*github\s*$/m.test(f.text));
  const environments = github ? [...github.text.matchAll(/^\s+([\w.-]+):\s*\{[^}]*kind:\s*environment\b[^}]*\}/gm)].map((m) => /label:\s*([^,}]+)/.exec(m[0])?.[1]?.trim() ?? m[1]!) : [];
  const relFromOut = (p: string) => `${out ? out.split('/').map(() => '..').join('/') + '/' : ''}${p}`;
  for (const f of all) {
    if (!isWorkflowPath(f.path) || !isWorkflow(f.text)) continue;
    const want = `workflow-${stem(f.path)}`;
    add('workflow', want, [f.path], importWorkflow(f.text, baseOf(f.path), { existing: was(want), tag: true, ...(github ? { github: { file: relFromOut(github.path), environments } } : {}) }));
  }

  diagrams.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.file.localeCompare(b.file));
  return { diagrams, hints };
}

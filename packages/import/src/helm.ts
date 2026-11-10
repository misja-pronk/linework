// A Helm chart (a folder with Chart.yaml, values.yaml and templates/) → a `type: kubernetes` diagram,
// without Helm: the templates are rendered here with the chart's values (and a values file given
// over them, as `helm template -f` does), by the Go template subset in gotemplate.ts, and what comes
// out is read by the Kubernetes importer. A template that cannot be rendered is named with its line;
// what its manifests clearly say is still drawn, its expressions left out.
import { parse, parseAllDocuments } from 'yaml';
import { parseTemplate, run, TemplateError, type RunContext } from './gotemplate.ts';
import { importKubernetes } from './kubernetes.ts';
import { isObj, str, type Obj } from './keep.ts';
import { Warnings } from './text.ts';
import type { Imported } from './index.ts';

export interface ChartFile {
  /** Relative to the chart's folder: Chart.yaml, values.yaml, templates/deployment.yaml, charts/redis/…. */
  path: string;
  text: string;
}

export interface HelmOptions {
  /** A values file read over the chart's own (helm template -f). */
  values?: string;
  /** The release name; the chart's name when not given, so names read as the chart's own. */
  release?: string;
  namespace?: string;
  title?: string;
  existing?: string;
  /** Tag every entry `imported`, for an import that will be done again. */
  tag?: boolean;
}

export interface Rendered {
  name: string;
  /** The manifests, as `helm template` would write them. */
  manifests: string;
  /** Templates rendered, and those only read in part. */
  templates: number;
  partial: string[];
}

/** Whether these are the files of a chart: a Chart.yaml with a name. */
export const isChart = (files: ChartFile[]): boolean => files.some((f) => f.path === 'Chart.yaml' && /^name\s*:/m.test(f.text));

function merge(dst: Obj, src: Obj): Obj {
  for (const [k, v] of Object.entries(src)) {
    if (isObj(v) && isObj(dst[k])) dst[k] = merge({ ...(dst[k] as Obj) }, v);
    else dst[k] = v;
  }
  return dst;
}

const readYaml = (text: string | undefined): Obj => {
  if (!text) return {};
  try {
    const v = parse(text) as unknown;
    return isObj(v) ? v : {};
  } catch {
    return {};
  }
};

/** Renders the chart (and the subcharts in its charts/ folder) to manifests. */
export function renderChart(files: ChartFile[], opts: HelmOptions, warn: Warnings, given: Obj = {}, parent?: { release: string; namespace: string }): Rendered {
  const byPath = new Map(files.map((f) => [f.path, f.text]));
  const chart = readYaml(byPath.get('Chart.yaml'));
  const name = str(chart.name) ?? 'chart';
  const release = parent?.release ?? opts.release ?? name;
  const namespace = parent?.namespace ?? opts.namespace ?? 'default';
  const values = merge(merge(readYaml(byPath.get('values.yaml')), parent ? {} : readYaml(opts.values)), given);
  const Chart = { Name: name, Version: str(chart.version) ?? '0.0.0', AppVersion: str(chart.appVersion) ?? '', Description: str(chart.description) ?? '', Type: str(chart.type) ?? 'application' };
  const capabilities = { KubeVersion: { Version: 'v1.30.0', Major: '1', Minor: '30', GitVersion: 'v1.30.0' }, APIVersions: { Has: () => true, __method: true }, HelmVersion: { Version: 'v3.15.0' } };
  const filesApi = {
    Get: (p: string) => byPath.get(String(p)) ?? '',
    Glob: (g: string) => Object.fromEntries([...byPath].filter(([p]) => new RegExp(`^${String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`).test(p))),
    AsConfig: () => '',
    AsSecrets: () => '',
    Lines: (p: string) => (byPath.get(String(p)) ?? '').split('\n'),
    __method: true,
  };
  const templates = files.filter((f) => /^templates\//.test(f.path) && /\.(ya?ml|tpl|json)$/i.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  const defs = new Map<string, ReturnType<typeof parseTemplate>>();
  const parsed = new Map<string, ReturnType<typeof parseTemplate>>();
  const partial: string[] = [];
  const told = new Set<string>();
  const unknown: RunContext['unknown'] = (what, file, line) => {
    if (told.has(what)) return;
    told.add(what);
    warn.add(`${name}/${file}:${line}: ${what} is not known here: left empty`);
  };
  // Every file's defines first: a template may include one from a file read after it.
  for (const t of templates) {
    try {
      parsed.set(t.path, parseTemplate(t.text, t.path, defs));
    } catch (e) {
      const err = e as TemplateError;
      warn.add(`${name}/${t.path}:${err.line ?? '?'}: ${err.message}: what the file clearly says is drawn`);
      partial.push(t.path);
    }
  }
  const out: string[] = [];
  let count = 0;
  for (const t of templates) {
    const base = t.path.split('/').pop()!;
    // Partials only define; NOTES.txt is not a manifest.
    if (base.startsWith('_')) continue;
    const tree = parsed.get(t.path);
    const dot = { Values: values, Release: { Name: release, Namespace: namespace, Service: 'Helm', IsInstall: true, IsUpgrade: false, Revision: 1 }, Chart, Capabilities: capabilities, Files: filesApi, Template: { Name: `${name}/${t.path}`, BasePath: `${name}/templates` } };
    if (tree) {
      try {
        out.push(`# Source: ${name}/${t.path}\n${run(tree, dot, { defs, file: t.path, unknown, depth: 0 })}`);
        count++;
        continue;
      } catch (e) {
        const err = e as TemplateError;
        warn.add(`${name}/${t.path}:${err.line ?? '?'}: ${err.message}: what the file clearly says is drawn`);
        if (!partial.includes(t.path)) partial.push(t.path);
      }
    }
    out.push(`# Source: ${name}/${t.path} (in part)\n${clearly(t.text, name)}`);
  }

  // Subcharts in charts/<name>/: their own values, under their name in ours, and the globals.
  const subs = new Set(files.map((f) => /^charts\/([^/]+)\/Chart\.yaml$/.exec(f.path)?.[1]).filter((x): x is string => !!x));
  for (const f of files) if (/^charts\/[^/]+\.tgz$/i.test(f.path)) warn.add(`${name}/${f.path}: a packed subchart is not read (helm dependency build unpacks it into charts/)`);
  for (const sub of subs) {
    const own = files.filter((f) => f.path.startsWith(`charts/${sub}/`)).map((f) => ({ path: f.path.slice(`charts/${sub}/`.length), text: f.text }));
    const subChart = readYaml(own.find((f) => f.path === 'Chart.yaml')?.text);
    const key = str(subChart.name) ?? sub;
    const enabled = isObj(values[key]) ? (values[key] as Obj).enabled : undefined;
    if (enabled === false) continue;
    const r = renderChart(own, opts, warn, { ...(isObj(values[key]) ? (values[key] as Obj) : {}), ...(isObj(values.global) ? { global: values.global } : {}) }, { release, namespace });
    out.push(r.manifests);
    count += r.templates;
    partial.push(...r.partial.map((p) => `charts/${sub}/${p}`));
  }
  return { name, manifests: out.join('\n---\n'), templates: count, partial };
}

/**
 * A template that could not be rendered, read for what it clearly says: lines that are only an
 * action go, an action inside a line becomes the chart's name where it names something (an include
 * of …fullname) and is left out otherwise. Documents that still have a kind and a name are kept.
 */
function clearly(text: string, chart: string): string {
  const lines = text
    .replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, '')
    .split('\n')
    .filter((l) => !/^\s*\{\{[^}]*\}\}\s*$/.test(l))
    .map((l) => l.replace(/\{\{-?([^}]*)-?\}\}/g, (_, inner: string) => (/name/i.test(inner) ? chart : '')));
  const docs = parseAllDocuments(lines.join('\n'));
  return docs
    .filter((d) => !d.errors.length)
    .map((d) => d.toJS() as unknown)
    .filter((o): o is Obj => isObj(o) && typeof o.kind === 'string' && isObj(o.metadata) && !!str(o.metadata.name))
    .map((o) => JSON.stringify(o))
    .join('\n---\n');
}

export interface ImportedHelm extends Imported {
  summary: string;
}

/** The chart's diagram: rendered, then read as manifests. */
export function importHelm(files: ChartFile[], opts: HelmOptions = {}): ImportedHelm {
  const warn = new Warnings();
  if (!isChart(files)) return { yaml: '', warnings: ['No Chart.yaml with a name: not a Helm chart'], summary: '' };
  const r = renderChart(files, opts, warn);
  const chart = readYaml(files.find((f) => f.path === 'Chart.yaml')?.text);
  const title = opts.title ?? `${r.name} chart${str(chart.version) ? ` ${str(chart.version)}` : ''}`;
  const k = importKubernetes(r.manifests, title, opts.existing !== undefined || opts.tag ? { existing: opts.existing } : undefined);
  const nodes = /^nodes:\n((?:  .*\n?)*)/m.exec(k.yaml)?.[1]?.split('\n').filter((l) => /^  \S/.test(l)) ?? [];
  const workloads = nodes.filter((l) => /kind: (deployment|statefulset|daemonset|job|cronjob)\b/.test(l)).length;
  return {
    yaml: k.yaml,
    warnings: [...warn.list, ...k.warnings],
    summary: `${r.templates} template${r.templates === 1 ? '' : 's'} rendered${r.partial.length ? `, ${r.partial.length} in part` : ''}, ${workloads} workload${workloads === 1 ? '' : 's'}`,
  };
}

// Live imports: the user's own kubectl, az and gh, run read-only, their answers fed to the importers
// that read saved files (kubernetes, azure, access, github). No API client of our own and no
// credentials: the tools are logged in already, or say so. Nothing here spawns anything; a runner is
// handed in (live-node.ts spawns, tests hand in stubs), and every command it is asked to run passes
// `refusal` first, the one allow-list.
import type { ExportFile } from './access.ts';

export type Argv = readonly string[];
export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}
export type Run = (argv: Argv) => Promise<Ran>;

export type LiveSource = 'k8s' | 'azure' | 'access' | 'github';
export const LIVE_SOURCES: LiveSource[] = ['k8s', 'azure', 'access', 'github'];

export interface LiveOptions {
  /** kubectl: a context of the kubeconfig, else the current one. */
  context?: string;
  /** kubectl: one namespace, else the context's own. */
  namespace?: string;
  /** kubectl: every namespace but the cluster's own (kube-system and kin). */
  allNamespaces?: boolean;
  /** az: subscriptions by id (narrows the query) or name (narrows the import); commas between several. */
  subscription?: string;
  /** az: resource groups by name (narrows the query) or with * (narrows the import); commas between several. */
  rg?: string;
  /** gh: the organisation. */
  org?: string;
  /** azure: role assignments too, as an access diagram beside it. */
  withAccess?: boolean;
  /** Said as a command runs, before it runs. */
  onRun?: (argv: Argv) => void;
}

export type LiveKind = 'kubernetes' | 'azure' | 'access' | 'github';
export interface Fetched {
  kind: LiveKind;
  /** What the importer reads, as the files the docs' scripts save; secret values are never in them. */
  files: ExportFile[];
  /** The kubectl context, the Azure account, the organisation: for a title. */
  title?: string;
  notes: string[];
}

/** A tool missing, not logged in, or an answer that is not what it should be: one line, with what to do. */
export class LiveError extends Error {}

// ---------------------------------------------------------------- the allow-list

/** What kubectl may get: the kinds the Kubernetes importer draws. Secrets and ConfigMaps only by name (see `refusal`). */
export const KUBE_RESOURCES = ['deployments', 'statefulsets', 'daemonsets', 'cronjobs', 'jobs', 'services', 'ingresses', 'persistentvolumeclaims', 'serviceaccounts', 'networkpolicies', 'horizontalpodautoscalers'];
const GATEWAY_RESOURCES = ['gateways.gateway.networking.k8s.io', 'httproutes.gateway.networking.k8s.io'];
const NAMES_ONLY = ['configmaps', 'secrets'];

type Flag = RegExp | true | 'many';
interface Verb {
  /** The words after the tool, in order. */
  words: string[];
  /** The flags it may take: a pattern its value must match, true for a switch, 'many' for a list of values. */
  flags: Record<string, Flag>;
  /** Positionals after the words: each must match. */
  args?: RegExp[];
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANY = /^[^-@][\s\S]*$/;
const KUBE_LIST = new RegExp(`^(${[...KUBE_RESOURCES, ...GATEWAY_RESOURCES, ...NAMES_ONLY].map((r) => r.replace(/\./g, '\\.')).join('|')})(,(${[...KUBE_RESOURCES, ...GATEWAY_RESOURCES, ...NAMES_ONLY].map((r) => r.replace(/\./g, '\\.')).join('|')}))*$`);
const COLUMNS = /^custom-columns=[A-Z]+:\.[\w.]+(,[A-Z]+:\.[\w.]+)*$/;
const KUBE_COMMON: Record<string, Flag> = { '--context': ANY, '--request-timeout': /^\d+s$/ };

// GitHub: GET requests to these paths and no others. A segment is a name; a branch is URL-encoded.
const SEG = '[A-Za-z0-9._-]+';
const GH_PATHS = [
  `orgs/${SEG}`,
  `orgs/${SEG}/(teams|members|outside_collaborators|repos|rulesets|installations)`,
  `orgs/${SEG}/members\\?role=admin`,
  `orgs/${SEG}/rulesets/\\d+`,
  `orgs/${SEG}/actions/(secrets|variables|runners|runner-groups)`,
  `orgs/${SEG}/teams/${SEG}/(members|repos)`,
  `repos/${SEG}/${SEG}/(collaborators\\?affiliation=direct|environments|rulesets|actions/secrets|actions/variables)`,
  `repos/${SEG}/${SEG}/rulesets/\\d+`,
  `repos/${SEG}/${SEG}/branches/[A-Za-z0-9._%-]+/protection`,
  `repos/${SEG}/${SEG}/contents/\\.github/CODEOWNERS`,
].map((p) => new RegExp(`^${p}$`));

/**
 * Every command a live import may run, by tool. Only reading verbs: kubectl get, az … list / show /
 * query, gh api without a method or a body (a GET) and gh auth status. Anything not here is refused.
 */
export const ALLOWED: Record<'kubectl' | 'az' | 'gh', Verb[]> = {
  kubectl: [
    { words: ['config', 'current-context'], flags: KUBE_COMMON },
    { words: ['get'], args: [KUBE_LIST], flags: { ...KUBE_COMMON, '-o': /^(json|custom-columns=.*)$/, '-n': NAME, '-A': true, '--no-headers': true } },
  ],
  az: [
    { words: ['account', 'show'], flags: { '-o': /^json$/, '--only-show-errors': true } },
    { words: ['graph', 'query'], flags: { '-q': ANY, '--first': /^\d{1,4}$/, '--skip-token': ANY, '--subscriptions': 'many', '-o': /^json$/, '--only-show-errors': true } },
    { words: ['role', 'assignment', 'list'], flags: { '--all': true, '--include-inherited': true, '--subscription': ANY, '-o': /^json$/, '--only-show-errors': true } },
    { words: ['role', 'definition', 'list'], flags: { '--custom-role-only': true, '--subscription': ANY, '-o': /^json$/, '--only-show-errors': true } },
    { words: ['ad', 'group', 'member', 'list'], flags: { '--group': GUID, '-o': /^json$/, '--only-show-errors': true } },
  ],
  gh: [
    { words: ['auth', 'status'], flags: { '--hostname': NAME } },
    { words: ['api'], args: [/^/], flags: { '--paginate': true, '--slurp': true, '-H': /^Accept: application\/vnd\.github\.raw$/ } },
  ],
};

/**
 * Why a command may not run, or undefined when it may: the one check every spawned command passes.
 * The tool, its verb and each flag must be on the list above, values must look as they should, and a
 * Secret or ConfigMap is only ever listed by name (custom columns of its metadata, never -o json).
 */
export function refusal(argv: Argv): string | undefined {
  const [tool, ...rest] = argv;
  if (!tool || !(tool in ALLOWED)) return `${tool ?? 'nothing'} is not one of the tools a live import runs`;
  const verb = ALLOWED[tool as keyof typeof ALLOWED].find((v) => v.words.every((w, i) => rest[i] === w));
  if (!verb) return `${tool} ${rest.slice(0, 3).join(' ')} is not a reading command on the allow-list`;
  const args: string[] = [];
  const set = new Map<string, string | true>();
  for (let i = verb.words.length; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('-')) {
      args.push(a);
      continue;
    }
    const rule = verb.flags[a];
    if (rule === undefined) return `${tool} ${verb.words.join(' ')} may not take ${a}`;
    if (set.has(a)) return `${a} is given twice`;
    if (rule === true) {
      set.set(a, true);
      continue;
    }
    if (rule === 'many') {
      let n = 0;
      while (i + 1 < rest.length && !rest[i + 1]!.startsWith('-')) {
        if (!GUID.test(rest[++i]!)) return `${a} takes ids, not "${rest[i]}"`;
        n++;
      }
      if (!n) return `${a} needs a value`;
      set.set(a, true);
      continue;
    }
    const v = rest[++i];
    if (v === undefined || !rule.test(v)) return `${a} may not be ${v === undefined ? 'left empty' : `"${v}"`}`;
    set.set(a, v);
  }
  const want = verb.args ?? [];
  if (args.length !== want.length) return `${tool} ${verb.words.join(' ')} takes ${want.length} argument${want.length === 1 ? '' : 's'}, not ${args.length}`;
  if (args.some((a, i) => !want[i]!.test(a))) return `${tool} ${verb.words.join(' ')} may not take "${args.find((a, i) => !want[i]!.test(a))}"`;
  if (tool === 'kubectl' && verb.words[0] === 'get') {
    const kinds = args[0]!.split(',');
    const out = set.get('-o');
    if (out === undefined) return 'kubectl get needs -o json or -o custom-columns';
    // Values of Secrets and ConfigMaps never come to us: by name only, and only on their own.
    if (kinds.some((k) => NAMES_ONLY.includes(k))) {
      if (kinds.length > 1) return 'Secrets and ConfigMaps are listed on their own';
      if (typeof out !== 'string' || !COLUMNS.test(out) || /\.(data|stringData|binaryData)\b/.test(out)) return `${kinds[0]} are only listed by name (-o custom-columns of their metadata)`;
    } else if (out !== 'json') return 'kubectl get takes -o json here';
    if (set.has('-A') && set.has('-n')) return '-A and -n do not go together';
  }
  if (tool === 'gh' && verb.words[0] === 'api') {
    const p = args[0]!;
    if (!GH_PATHS.some((r) => r.test(p))) return `gh api ${p} is not one of the paths a live import reads`;
    if (set.has('--slurp') && !set.has('--paginate')) return '--slurp goes with --paginate';
    if (set.has('-H') !== /\/contents\//.test(p)) return 'only CODEOWNERS is asked for raw';
  }
  return undefined;
}

/** A command as it would be typed: quoted where a word has a space or a quote in it. */
export function shown(argv: Argv): string {
  return argv.map((a) => (/^[\w@%+=:,./<>-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');
}

// ---------------------------------------------------------------- secrets

const KEEP_ANNOTATIONS = ['helm.sh/hook'];

/**
 * A Kubernetes object without anything that may be a secret: the data of Secrets and ConfigMaps,
 * literal env values, command lines, annotations (last-applied-configuration copies a whole manifest,
 * Secret data included), managed fields and status. What is left is what the importer reads.
 */
export function withoutSecrets<T>(o: T): T {
  if (Array.isArray(o)) return o.map(withoutSecrets) as T;
  if (!o || typeof o !== 'object') return o;
  const src = o as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const secretish = src.kind === 'Secret' || src.kind === 'ConfigMap';
  for (const [k, v] of Object.entries(src)) {
    if (secretish && (k === 'data' || k === 'stringData' || k === 'binaryData')) continue;
    if (k === 'managedFields' || k === 'status' || k === 'command' || k === 'args') continue;
    if (k === 'annotations' && v && typeof v === 'object') {
      const kept = Object.fromEntries(Object.entries(v).filter(([a]) => KEEP_ANNOTATIONS.includes(a)));
      if (Object.keys(kept).length) out[k] = kept;
      continue;
    }
    // An env entry keeps its name and where it comes from (valueFrom), never a value written in.
    if (k === 'env' && Array.isArray(v)) {
      out[k] = v.map((e) => (e && typeof e === 'object' ? withoutSecrets(Object.fromEntries(Object.entries(e).filter(([x]) => x !== 'value'))) : e));
      continue;
    }
    out[k] = withoutSecrets(v);
  }
  return out as T;
}

// ---------------------------------------------------------------- what runs

const json = (text: string, what: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    throw new LiveError(`${what} did not answer with JSON`);
  }
};
const flat = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.flatMap((x) => (Array.isArray(x) ? x : [x])).filter((x) => x && typeof x === 'object') : []);
const firstLine = (s: string) => s.trim().split('\n').find((l) => l.trim())?.trim() ?? '';

/** What a failed command means, with what to do about it. */
export function failure(argv: Argv, r: Ran): LiveError {
  const tool = argv[0]!;
  const err = `${r.stderr}\n${r.stdout}`;
  if (tool === 'az') {
    if (/az login|AADSTS|not logged in|Please run 'az login'|refresh token.*expired/i.test(err)) return new LiveError('az is not logged in: run `az login` first');
    if (/'graph' is (not in|misspelled)|resource-graph/i.test(err)) return new LiveError('az graph query needs the Resource Graph extension: run `az extension add --name resource-graph` first');
    if (/AuthorizationFailed|Insufficient privileges|Authorization_RequestDenied/i.test(err)) return new LiveError(`${shown(argv.slice(0, 4))}: your account may not read this (${firstLine(r.stderr)})`);
  }
  if (tool === 'gh' && /gh auth login|not logged into|HTTP 401|Bad credentials/i.test(err)) return new LiveError('gh is not logged in: run `gh auth login` first');
  if (tool === 'gh' && /rate limit/i.test(err)) return new LiveError('GitHub says the API rate limit is reached: try again later');
  if (tool === 'kubectl') {
    if (/current-context is not set|no context exists|context was not found/i.test(err)) return new LiveError(`kubectl has no such context: pick one with --context (kubectl config get-contexts), or set one with \`kubectl config use-context\``);
    if (/Unauthorized|must be logged in|provide credentials|token.*expired|exec plugin/i.test(err)) return new LiveError('kubectl is not logged in to the cluster: log in the way your cluster wants (az aks get-credentials, aws eks update-kubeconfig, gcloud container clusters get-credentials, …) first');
    if (/connection refused|Unable to connect|no such host|i\/o timeout|dial tcp/i.test(err)) return new LiveError(`kubectl cannot reach the cluster (${firstLine(r.stderr)})`);
    if (/forbidden/i.test(err)) return new LiveError(`kubectl: your account may not read this (${firstLine(r.stderr)})`);
  }
  return new LiveError(`${shown(argv)} failed${r.code ? ` (exit ${r.code})` : ''}: ${firstLine(r.stderr) || firstLine(r.stdout) || 'no output'}`);
}

const kubeBase = (o: LiveOptions): string[] => (o.context ? ['--context', o.context] : []);
const kubeWhere = (o: LiveOptions): string[] => (o.allNamespaces ? ['-A'] : o.namespace ? ['-n', o.namespace] : []);
const K = {
  context: (o: LiveOptions) => ['kubectl', 'config', 'current-context', ...kubeBase(o)],
  get: (o: LiveOptions) => ['kubectl', 'get', KUBE_RESOURCES.join(','), '-o', 'json', ...kubeWhere(o), ...kubeBase(o)],
  gateway: (o: LiveOptions) => ['kubectl', 'get', GATEWAY_RESOURCES.join(','), '-o', 'json', ...kubeWhere(o), ...kubeBase(o)],
  configmaps: (o: LiveOptions) => ['kubectl', 'get', 'configmaps', '-o', 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name', '--no-headers', ...kubeWhere(o), ...kubeBase(o)],
  secrets: (o: LiveOptions) => ['kubectl', 'get', 'secrets', '-o', 'custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,TYPE:.type', '--no-headers', ...kubeWhere(o), ...kubeBase(o)],
};

const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
/** Subscriptions by id narrow the query itself; by name only the import can tell. */
const subscriptionIds = (o: LiveOptions) => (list(o.subscription).every((s) => GUID.test(s)) ? list(o.subscription) : []);
/** Resource groups by plain name go into the query; a wildcard or an odd character leaves it to the import. */
const rgNames = (o: LiveOptions) => (list(o.rg).length && list(o.rg).every((r) => /^[\w.()-]+$/.test(r)) ? list(o.rg) : []);
const PAGE = 1000;
const MAX_PAGES = 100;
const A = {
  account: () => ['az', 'account', 'show', '-o', 'json'],
  graph: (o: LiveOptions, table: 'resources' | 'resourcecontainers', token?: string) => {
    const rgs = table === 'resources' ? rgNames(o) : [];
    const q = rgs.length ? `${table} | where resourceGroup in~ (${rgs.map((r) => `'${r}'`).join(', ')})` : table;
    const subs = subscriptionIds(o);
    return ['az', 'graph', 'query', '-q', q, '--first', String(PAGE), ...(subs.length ? ['--subscriptions', ...subs] : []), ...(token ? ['--skip-token', token] : []), '-o', 'json'];
  },
  assignments: (o: LiveOptions) => ['az', 'role', 'assignment', 'list', '--all', '--include-inherited', ...(list(o.subscription).length === 1 && !o.subscription!.includes('*') ? ['--subscription', list(o.subscription)[0]!] : []), '-o', 'json'],
  definitions: (o: LiveOptions) => ['az', 'role', 'definition', 'list', '--custom-role-only', ...(list(o.subscription).length === 1 && !o.subscription!.includes('*') ? ['--subscription', list(o.subscription)[0]!] : []), '-o', 'json'],
  members: (group: string) => ['az', 'ad', 'group', 'member', 'list', '--group', group, '-o', 'json'],
};
const MAX_GROUPS = 200;

const G = {
  auth: () => ['gh', 'auth', 'status'],
  one: (path: string) => ['gh', 'api', path],
  all: (path: string) => ['gh', 'api', '--paginate', '--slurp', path],
  raw: (path: string) => ['gh', 'api', path, '-H', 'Accept: application/vnd.github.raw'],
};
/** The organisation's lists: gh api path → the file the docs' script saves it as. */
const GH_ORG: [string, string][] = [
  ['teams', 'teams.json'],
  ['members', 'members.json'],
  ['members?role=admin', 'owners.json'],
  ['outside_collaborators', 'outside-collaborators.json'],
  ['repos', 'repos.json'],
  ['rulesets', 'rulesets.json'],
  ['actions/secrets', 'secrets.json'],
  ['actions/variables', 'variables.json'],
  ['actions/runners', 'runners.json'],
  ['actions/runner-groups', 'runner-groups.json'],
  ['installations', 'installations.json'],
];
const GH_REPO: [string, string][] = [
  ['collaborators?affiliation=direct', 'collaborators.json'],
  ['environments', 'environments.json'],
  ['rulesets', 'rulesets.json'],
  ['actions/secrets', 'secrets.json'],
  ['actions/variables', 'variables.json'],
];
const GH_CONCURRENT = 6;

/** What the options leave unsaid or say twice, before anything runs. */
export function liveProblem(source: string, o: LiveOptions): string | undefined {
  if (!LIVE_SOURCES.includes(source as LiveSource)) return `--live is one of ${LIVE_SOURCES.join(', ')}, not "${source}"`;
  if (source === 'k8s' && o.namespace && o.allNamespaces) return '--namespace and --all-namespaces do not go together';
  if (source === 'k8s' && o.namespace && !NAME.test(o.namespace)) return `"${o.namespace}" is not a namespace name`;
  if (source === 'github' && !o.org) return 'carto import --live github needs --org <organisation>';
  if (source === 'github' && !new RegExp(`^${SEG}$`).test(o.org!)) return `"${o.org}" is not an organisation name`;
  if (o.context?.startsWith('-')) return `--context "${o.context}" is not a context name`;
  return undefined;
}

/** The commands a live import runs, as they are shown before it runs them; <…> stands for what an earlier answer names. */
export function livePlan(source: LiveSource, o: LiveOptions): string[] {
  if (source === 'k8s') return [K.context(o), K.get(o), K.gateway(o), K.configmaps(o), K.secrets(o)].map(shown).map((l, i) => l + (i === 2 ? '   # when the Gateway API is installed' : i > 2 ? '   # names only' : ''));
  if (source === 'azure')
    return [
      shown(A.account()),
      `${shown(A.graph(o, 'resources'))}   # and --skip-token <token> while there are more`,
      `${shown(A.graph(o, 'resourcecontainers'))}   # and --skip-token <token> while there are more`,
      ...(o.withAccess ? livePlan('access', o).slice(1) : []),
    ];
  if (source === 'access') return [shown(A.account()), shown(A.assignments(o)), shown(A.definitions(o)), `${shown(A.members('<group>'))}   # for each group that holds a role, and the groups in it`];
  const org = o.org!;
  return [
    shown(G.auth()),
    shown(G.one(`orgs/${org}`)),
    ...GH_ORG.map(([p]) => shown(G.all(`orgs/${org}/${p}`))),
    `${shown(G.one(`orgs/${org}/rulesets/<id>`))}   # for each organisation ruleset`,
    `${shown(G.all(`orgs/${org}/teams/<team>/members`))}   # for each team, and /repos`,
    ...GH_REPO.map(([p]) => `${shown(G.all(`repos/${org}/<repo>/${p}`))}   # for each repository not archived`),
    `${shown(G.one(`repos/${org}/<repo>/rulesets/<id>`))}   # for each ruleset of a repository`,
    `${shown(G.all(`repos/${org}/<repo>/branches/<default branch>/protection`))}`,
    `${shown(G.raw(`repos/${org}/<repo>/contents/.github/CODEOWNERS`))}`,
  ];
}

/** Each command checked against the allow-list again and said before it runs, whoever the runner is. */
function guarded(run: Run, o: LiveOptions): Run {
  return async (argv) => {
    const why = refusal(argv);
    if (why) throw new LiveError(`Not run: ${shown(argv)} (${why})`);
    o.onRun?.(argv);
    return run(argv);
  };
}

/** Runs the source's commands and returns what the importers read: one diagram's files, or two (azure with access). */
export async function fetchLive(source: LiveSource, o: LiveOptions, runner: Run): Promise<Fetched[]> {
  const problem = liveProblem(source, o);
  if (problem) throw new LiveError(problem);
  const run = guarded(runner, o);
  if (source === 'k8s') return [await fetchKubernetes(o, run)];
  if (source === 'access') return [await fetchAccess(o, run)];
  if (source === 'github') return [await fetchGithub(o, run)];
  const azure = await fetchAzure(o, run);
  return o.withAccess ? [azure, await fetchAccess(o, run, true)] : [azure];
}

/** The cluster's own namespaces: left out of an --all-namespaces drawing. */
const SYSTEM_NAMESPACES = ['kube-system', 'kube-public', 'kube-node-lease'];

async function fetchKubernetes(o: LiveOptions, run: Run): Promise<Fetched> {
  const notes: string[] = [];
  const ctx = await run(K.context(o));
  if (ctx.code) throw failure(K.context(o), ctx);
  const title = firstLine(ctx.stdout) || o.context;
  const get = async (argv: string[]) => {
    const r = await run(argv);
    if (r.code) throw failure(argv, r);
    return r.stdout;
  };
  const items = (text: string, what: string) => flat((json(text, what) as { items?: unknown })?.items);
  const objects = items(await get(K.get(o)), 'kubectl get');
  const gw = await run(K.gateway(o));
  if (!gw.code) objects.push(...items(gw.stdout, 'kubectl get (Gateway API)'));
  else if (/doesn't have a resource type|could not find the requested resource|no matches for kind/i.test(gw.stderr)) notes.push('The Gateway API is not installed in this cluster: Ingresses only');
  else throw failure(K.gateway(o), gw);
  // Names (and a Secret's type) only: their values never leave kubectl.
  const rows = (text: string, kind: 'ConfigMap' | 'Secret') =>
    text.split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 2 && c[1]).map(([ns, name, type]) => ({ apiVersion: 'v1', kind, metadata: { name, ...(ns && ns !== '<none>' ? { namespace: ns } : {}) }, ...(type && type !== '<none>' ? { type } : {}) }));
  const configmaps = rows(await get(K.configmaps(o)), 'ConfigMap');
  const secrets = rows(await get(K.secrets(o)), 'Secret');
  let all = withoutSecrets([...objects, ...configmaps, ...secrets]) as { metadata?: { namespace?: string } }[];
  if (o.allNamespaces) {
    const system = all.filter((x) => SYSTEM_NAMESPACES.includes(x.metadata?.namespace ?? ''));
    if (system.length) notes.push(`${system.length} resources in ${SYSTEM_NAMESPACES.join(', ')} left out: --namespace kube-system draws them`);
    all = all.filter((x) => !system.includes(x));
  }
  const file = (path: string, items: unknown[]) => ({ path, text: JSON.stringify({ apiVersion: 'v1', kind: 'List', items }, null, 2) + '\n' });
  const isKind = (k: string) => (x: unknown) => (x as { kind?: string }).kind === k;
  return {
    kind: 'kubernetes',
    title,
    notes,
    files: [file('resources.json', all.filter((x) => !isKind('ConfigMap')(x) && !isKind('Secret')(x))), file('configmaps.json', all.filter(isKind('ConfigMap'))), file('secrets.json', all.filter(isKind('Secret')))],
  };
}

async function account(run: Run): Promise<string | undefined> {
  const r = await run(A.account());
  if (r.code) throw failure(A.account(), r);
  const a = json(r.stdout, 'az account show') as { name?: string; tenantDisplayName?: string };
  return a?.tenantDisplayName || a?.name || undefined;
}

async function fetchAzure(o: LiveOptions, run: Run): Promise<Fetched> {
  const notes: string[] = [];
  const title = await account(run);
  const files: ExportFile[] = [];
  for (const [table, name] of [['resources', 'resources'], ['resourcecontainers', 'containers']] as const) {
    let token: string | undefined;
    for (let page = 1; ; page++) {
      const argv = A.graph(o, table, token);
      const r = await run(argv);
      if (r.code) throw failure(argv, r);
      const answer = json(r.stdout, 'az graph query') as { data?: unknown; skip_token?: string | null };
      if (!answer || typeof answer !== 'object' || !Array.isArray(answer.data)) throw new LiveError('az graph query answered without data: is the Resource Graph extension up to date (az extension update --name resource-graph)?');
      files.push({ path: `${name}-${String(page).padStart(2, '0')}.json`, text: r.stdout });
      token = answer.skip_token ?? undefined;
      if (!token) break;
      if (page >= MAX_PAGES) {
        notes.push(`${table}: stopped after ${MAX_PAGES} pages of ${PAGE}; narrow it with --subscription or --rg`);
        break;
      }
    }
  }
  if (list(o.subscription).length && !subscriptionIds(o).length) notes.push('Subscriptions by name are picked out after the query: give their ids to narrow the query itself');
  return { kind: 'azure', title, notes, files };
}

async function fetchAccess(o: LiveOptions, run: Run, signedIn = false): Promise<Fetched> {
  const notes: string[] = [];
  const title = signedIn ? undefined : await account(run);
  const files: ExportFile[] = [];
  const get = async (argv: string[], path: string) => {
    const r = await run(argv);
    if (r.code) throw failure(argv, r);
    json(r.stdout, shown(argv.slice(0, 4)));
    files.push({ path, text: r.stdout });
    return JSON.parse(r.stdout) as unknown;
  };
  const assignments = flat(await get(A.assignments(o), 'role-assignments.json'));
  await get(A.definitions(o), 'role-definitions.json');
  // The groups that hold a role, and the groups in those: their members.
  const queue = [...new Set(assignments.filter((a) => a.principalType === 'Group' && typeof a.principalId === 'string').map((a) => a.principalId as string))];
  const seen = new Set<string>();
  while (queue.length) {
    const g = queue.shift()!;
    if (seen.has(g) || !GUID.test(g)) continue;
    if (seen.size >= MAX_GROUPS) {
      notes.push(`Members of more than ${MAX_GROUPS} groups are not read: the rest are drawn without their members`);
      break;
    }
    seen.add(g);
    const argv = A.members(g);
    const r = await run(argv);
    if (r.code) {
      // One group we may not read is not the whole import.
      if (/Authorization_RequestDenied|Insufficient privileges|does not exist|ResourceNotFound/i.test(r.stderr)) {
        notes.push(`Members of group ${g} could not be read: ${firstLine(r.stderr)}`);
        continue;
      }
      throw failure(argv, r);
    }
    const members = flat(json(r.stdout, 'az ad group member list'));
    files.push({ path: `group-members-${g}.json`, text: r.stdout });
    for (const m of members) if (/group/i.test(String(m['@odata.type'] ?? '')) && typeof m.id === 'string') queue.push(m.id);
  }
  return { kind: 'access', title, notes, files };
}

/** At most `n` at a time, in order of the list. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}

async function fetchGithub(o: LiveOptions, run: Run): Promise<Fetched> {
  const org = o.org!;
  const notes: string[] = [];
  const files: ExportFile[] = [];
  const auth = await run(G.auth());
  if (auth.code) throw /not logged|gh auth login/i.test(auth.stderr + auth.stdout) || !auth.stderr.trim() ? new LiveError('gh is not logged in: run `gh auth login` first') : failure(G.auth(), auth);
  // GitHub's own answer to what is not there or not allowed (Not Found, Branch not protected) is saved as the script saves it.
  const fatal = (argv: Argv, r: Ran) => /gh auth login|HTTP 401|Bad credentials|rate limit/i.test(r.stderr) || !/HTTP 40[34]|HTTP 404|Not Found|not protected|Forbidden|Resource not accessible/i.test(r.stderr + r.stdout) ? failure(argv, r) : undefined;
  const answer = async (argv: string[], path: string, raw = false): Promise<unknown> => {
    const r = await run(argv);
    if (r.code) {
      const f = fatal(argv, r);
      if (f) throw f;
      if (raw) return undefined;
      let message = firstLine(r.stderr).replace(/^gh:\s*/, '').replace(/\s*\(HTTP \d+\)$/, '') || 'Not Found';
      try {
        const body = flat([JSON.parse(r.stdout)])[0];
        if (typeof body?.message === 'string') message = body.message;
      } catch {
        // No body: the message from stderr.
      }
      files.push({ path, text: JSON.stringify({ message }) + '\n' });
      return undefined;
    }
    if (!raw) json(r.stdout, `gh api ${argv.at(-1)}`);
    files.push({ path, text: r.stdout });
    return raw ? r.stdout : JSON.parse(r.stdout);
  };
  const orgAnswer = await run(G.one(`orgs/${org}`));
  if (orgAnswer.code) {
    if (/HTTP 404|Not Found/i.test(orgAnswer.stderr + orgAnswer.stdout)) throw new LiveError(`GitHub has no organisation "${org}" that you can see`);
    throw failure(G.one(`orgs/${org}`), orgAnswer);
  }
  json(orgAnswer.stdout, `gh api orgs/${org}`);
  files.push({ path: 'org.json', text: orgAnswer.stdout });
  const lists: Record<string, Record<string, unknown>[]> = {};
  await pool(GH_ORG, GH_CONCURRENT, async ([p, file]) => {
    lists[file] = flat(await answer(G.all(`orgs/${org}/${p}`), file));
  });
  const slugs = lists['teams.json']!.map((t) => t.slug).filter((s): s is string => typeof s === 'string' && new RegExp(`^${SEG}$`).test(s));
  const repos = lists['repos.json']!.filter((r) => !r.archived && typeof r.name === 'string' && new RegExp(`^${SEG}$`).test(r.name as string));
  const rulesetIds = lists['rulesets.json']!.map((r) => r.id).filter((id) => Number.isInteger(id));
  const jobs: (() => Promise<void>)[] = [
    ...rulesetIds.map((id) => async () => void (await answer(G.one(`orgs/${org}/rulesets/${id}`), `rulesets/${id}.json`))),
    ...slugs.flatMap((t) => (['members', 'repos'] as const).map((what) => async () => void (await answer(G.all(`orgs/${org}/teams/${t}/${what}`), `teams/${t}/${what}.json`)))),
    ...repos.flatMap((repo) => {
      const r = repo.name as string;
      const branch = typeof repo.default_branch === 'string' ? repo.default_branch : undefined;
      return [
        ...GH_REPO.map(([p, file]) => async () => {
          const got = await answer(G.all(`repos/${org}/${r}/${p}`), `repos/${r}/${file}`);
          if (p !== 'rulesets') return;
          const own = flat(got).filter((s) => s.source_type === 'Repository' && Number.isInteger(s.id));
          for (const s of own) await answer(G.one(`repos/${org}/${r}/rulesets/${s.id}`), `repos/${r}/rulesets/${s.id}.json`);
        }),
        ...(branch ? [async () => void (await answer(G.all(`repos/${org}/${r}/branches/${encodeURIComponent(branch)}/protection`), `repos/${r}/branch-protection.json`))] : []),
        async () => void (await answer(G.raw(`repos/${org}/${r}/contents/.github/CODEOWNERS`), `repos/${r}/CODEOWNERS`, true)),
      ];
    }),
  ];
  await pool(jobs, GH_CONCURRENT, (job) => job());
  const archived = lists['repos.json']!.length - repos.length;
  if (archived) notes.push(`${archived} archived ${archived === 1 ? 'repository is' : 'repositories are'} only listed: what is inside ${archived === 1 ? 'it' : 'them'} is not read`);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { kind: 'github', title: org, notes, files };
}

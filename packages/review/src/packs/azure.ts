// Azure: what an Azure Well-Architected review asks of a drawing first. Each rule reads only what a
// drawing shows or says (kinds, nesting, lines and their styles, public:, zones:, sku:, props:), and
// stays quiet where the drawing does not say: a setting that is not written is not assumed wrong.
import type { Hit, Rule } from '../types.ts';
import type { ReviewModel } from '../model.ts';

const APPS = ['app-service', 'function-app', 'container-app', 'aks', 'aks-cluster', 'vm', 'vmss', 'api-management', 'logic-app'];
const STORES = ['sql-database', 'sql-server', 'postgres', 'mysql', 'cosmos-db', 'storage', 'redis'];
/** What holds a secret to be reached: a password, a key, a connection string. */
const WITH_SECRETS = [...STORES, 'service-bus', 'event-hub', 'openai', 'ai-search', 'container-registry'];
const MONITORING = ['log-analytics', 'app-insights', 'monitor'];
const WAF = /\bwaf\b/i;
const IDENTITY = /\b(managed identity|identity|\bmi\b|entra|aad|rbac|workload identity|federated|oidc)\b/i;

const pack = 'azure';
const azure = ['azure'];

/** A Front Door, or an Application Gateway that is not said to lack its WAF tier. */
function shields(m: ReviewModel, id: string): boolean {
  const e = m.el(id);
  if (!e) return false;
  if (e.kind === 'front-door' || e.kind === 'firewall' || m.tagged(id, 'waf') || WAF.test(e.label)) return true;
  if (e.kind === 'app-gateway') {
    const sku = m.said(id, 'sku', 'tier');
    return sku === undefined || WAF.test(sku);
  }
  return false;
}

/** From an outsider, what is reached through plain plumbing (a load balancer, a public IP) without a shield. */
function reachedFrom(m: ReviewModel, start: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    for (const l of m.out(id)) {
      if (seen.has(l.to) || l.badge || l.style === 'private' || l.style === 'identity' || l.style === 'management') continue;
      seen.add(l.to);
      const k = m.el(l.to)?.kind ?? '';
      if (shields(m, l.to)) continue;
      if ((k === 'load-balancer' || k === 'public-ip') && depth < 2) walk(l.to, depth + 1);
      else out.push(l.to);
    }
  };
  walk(start, 0);
  return out;
}

export const azureRules: Rule[] = [
  {
    id: 'azure.public-without-waf',
    pack,
    title: 'Public endpoints sit behind a WAF',
    why: 'An app reached straight from the internet takes every bot, scan and injection attempt itself.',
    severity: 'warn',
    category: 'security',
    appliesTo: azure,
    fix: 'Put Front Door (with a WAF policy) or an Application Gateway WAF_v2 in front, and draw the line through it; or set public: false when it is only reached privately',
    docs: 'Azure Web Application Firewall on Front Door or Application Gateway',
    check(m) {
      const hits: Hit[] = [];
      const said = new Set<string>();
      for (const l of m.lines) {
        if (!m.outsider(l.from) || m.outsider(l.to)) continue;
        for (const id of reachedFrom(m, l.from).filter((x) => APPS.includes(m.el(x)?.kind ?? ''))) {
          if (said.has(id) || m.publicSaid(id) === false) continue;
          said.add(id);
          const direct = l.to === id;
          hits.push({ on: direct ? { kind: 'edge', id: l.id } : { kind: m.el(id)!.group ? 'group' : 'node', id }, message: `${m.name(id)} is reached from ${m.name(l.from)} without a WAF in front` });
        }
        // An Application Gateway said to be another tier than WAF.
        const k = m.el(l.to)?.kind;
        if (k === 'app-gateway' && !shields(m, l.to) && !said.has(l.to)) {
          said.add(l.to);
          hits.push({ on: { kind: 'node', id: l.to }, message: `${m.name(l.to)} takes traffic from ${m.name(l.from)} on the ${m.said(l.to, 'sku', 'tier')} tier, without its WAF` });
        }
      }
      for (const e of m.ofKind(...APPS)) {
        if (said.has(e.id) || m.publicSaid(e.id) !== true) continue;
        if (m.in(e.id).some((l) => shields(m, l.from))) continue;
        hits.push({ on: { kind: e.group ? 'group' : 'node', id: e.id }, message: `${e.label} is public, and no Front Door or Application Gateway WAF is in front of it` });
      }
      return hits;
    },
  },
  {
    id: 'azure.data-without-private-endpoint',
    pack,
    title: 'Data stores in a network design are reached through a private endpoint',
    why: 'A database or storage account on its public endpoint is one firewall rule away from the internet, whatever the network around the apps.',
    severity: 'warn',
    category: 'security',
    appliesTo: azure,
    fix: 'Add a private endpoint in a subnet (kind: private-endpoint, a line to the store) and turn public network access off; or draw the store in the subnet its endpoint is in. public: false says it is private',
    docs: 'Azure Private Link and private endpoints',
    check(m) {
      if (!m.has('vnet', 'subnet')) return [];
      return m
        .ofKind(...STORES)
        .filter((e) => {
          const pub = m.publicSaid(e.id);
          if (pub === true) return true;
          if (pub === false) return false;
          const inNet = m.ancestors(e.id).some((g) => g.kind === 'subnet' || g.kind === 'vnet');
          const endpoint = m.neighbours(e.id).some((n) => m.el(n)?.kind === 'private-endpoint') || m.tagged(e.id, 'private-endpoint', 'private-link');
          return !inNet && !endpoint;
        })
        .map((e) => ({ on: { kind: 'node', id: e.id }, message: m.publicSaid(e.id) ? `${e.label} is public, in a design with a virtual network` : `${e.label} has no private endpoint: it is reached on its public endpoint` }));
    },
  },
  {
    id: 'azure.secrets-without-key-vault',
    pack,
    title: 'Apps keep their secrets in Key Vault',
    why: 'Connection strings and keys in app settings or code leak with every copy of the configuration and are never rotated.',
    severity: 'warn',
    category: 'security',
    appliesTo: azure,
    fix: 'Read secrets from Key Vault with the app\'s managed identity (a line to the key-vault, style identity), or connect with the managed identity itself (style: identity on the line to the store)',
    docs: 'Azure Key Vault and managed identities',
    check(m) {
      const hits: Hit[] = [];
      const vaults = m.has('key-vault');
      const vault = (id: string) => m.neighbours(id).some((n) => m.el(n)?.kind === 'key-vault');
      const identity = (id: string) => m.neighbours(id).some((n) => ['managed-identity', 'entra-id'].includes(m.el(n)?.kind ?? ''));
      for (const app of m.ofKind(...APPS)) {
        if (vault(app.id) || identity(app.id) || m.tagged(app.id, 'key-vault')) continue;
        // What it reaches that holds a secret, through a private endpoint if that is drawn between.
        const reached = m.out(app.id).flatMap((l) => (m.el(l.to)?.kind === 'private-endpoint' ? m.out(l.to).map((x) => ({ ...x, style: l.style, label: `${l.label} ${x.label}` })) : [l]));
        const secret = reached.find((l) => WITH_SECRETS.includes(m.el(l.to)?.kind ?? '') && l.style !== 'identity' && !IDENTITY.test(l.label));
        if (secret) hits.push({ on: { kind: app.group ? 'group' : 'node', id: app.id }, message: `${app.label} connects to ${m.name(secret.to)} and reads no secrets from Key Vault` });
      }
      // No Key Vault drawn at all: one finding for the design, naming the apps.
      if (!vaults && hits.length > 1) return [{ on: { kind: 'diagram' }, message: `No Key Vault is drawn, and ${hits.length} apps connect to stores that need a secret: ${hits.map((h) => (h.on.kind === 'diagram' ? '' : m.name(h.on.id))).join(', ')}`, path: ['title'] }];
      return hits;
    },
  },
  {
    id: 'azure.prod-single-region',
    pack,
    title: 'Production survives the loss of a zone',
    why: 'A production workload in one zone of one region goes down with that datacentre.',
    severity: 'warn',
    category: 'reliability',
    appliesTo: azure,
    fix: 'Set zones: 3 (or zones: redundant) on what must stay up, or draw a second region group for a paired-region setup',
    docs: 'Azure availability zones and multi-region design',
    check(m) {
      if (!m.production || !m.has(...APPS, ...STORES)) return [];
      if (m.ofKind('region').length > 1) return [];
      const zoned = [...m.nodes.values(), ...m.groups.values()].some((e) => {
        const z = e.props.zones;
        return z === 'redundant' || (typeof z === 'number' && z > 1) || (Array.isArray(z) && z.length > 1) || m.said(e.id, 'zone-redundant') === 'true' || e.tags.includes('zone-redundant');
      });
      return zoned ? [] : [{ on: { kind: 'diagram' }, message: 'Production is drawn in one region, and nothing in it says it is zone-redundant', path: ['title'] }];
    },
  },
  {
    id: 'azure.no-diagnostics',
    pack,
    title: 'Resources send diagnostics to Log Analytics',
    why: 'Without logs and metrics in one place nobody sees an outage, an attack or a cost spike until a user does.',
    severity: 'warn',
    category: 'operations',
    appliesTo: azure,
    fix: 'Draw the Log Analytics workspace (or Application Insights) and the diagnostics lines to it, style management; badges: [management] keeps them out of the way',
    docs: 'Azure Monitor diagnostic settings',
    check(m) {
      if (m.ofKind(...APPS, ...STORES).length < 2) return [];
      const seen = m.has(...MONITORING) || m.lines.some((l) => l.style === 'management' || /\b(diagnostics?|logs?|telemetry|monitor(ing)?)\b/i.test(l.label)) || [...m.nodes.values()].some((e) => e.tags.some((t) => /^(monitoring|diagnostics|logging)$/.test(t)));
      return seen ? [] : [{ on: { kind: 'diagram' }, message: 'Nothing here sends logs or metrics anywhere: no Log Analytics, Application Insights or diagnostics line', path: ['title'] }];
    },
  },
  {
    id: 'azure.aks-network-policy',
    pack,
    title: 'AKS clusters enforce network policy',
    why: 'Without a network policy engine every pod can reach every other pod, so one compromised pod reaches the whole cluster.',
    severity: 'warn',
    category: 'security',
    appliesTo: azure,
    fix: 'Turn on a network policy engine (props: { network-policy: azure } or calico, cilium) and write policies per namespace',
    docs: 'AKS network policies',
    check(m) {
      return m
        .ofKind('aks', 'aks-cluster')
        .filter((e) => ['none', 'false', 'off', 'disabled', ''].includes(m.said(e.id, 'network-policy', 'networkPolicy') ?? 'set'))
        .map((e) => ({ on: { kind: e.group ? 'group' : 'node', id: e.id }, message: `${e.label} has no network policy engine` }));
    },
  },
  {
    id: 'azure.aks-private-cluster',
    pack,
    title: 'AKS API servers are private',
    why: 'A public Kubernetes API server is a target for credential stuffing and the next CVE, from anywhere.',
    severity: 'warn',
    category: 'security',
    appliesTo: azure,
    fix: 'Make it a private cluster (props: { private-cluster: true }), or at least limit authorized IP ranges (props: { authorized-ip-ranges: … })',
    docs: 'AKS private clusters and API server authorized IP ranges',
    check(m) {
      return m
        .ofKind('aks', 'aks-cluster')
        .filter((e) => (m.said(e.id, 'private-cluster', 'privateCluster') === 'false' || m.publicSaid(e.id) === true) && !m.said(e.id, 'authorized-ip-ranges'))
        .map((e) => ({ on: { kind: e.group ? 'group' : 'node', id: e.id }, message: `The API server of ${e.label} is public` }));
    },
  },
  {
    id: 'azure.storage-public-access',
    pack,
    title: 'Storage accounts allow no anonymous access',
    why: 'Anonymous blob access hands every file to whoever guesses the URL; it is how most cloud data leaks start.',
    severity: 'error',
    category: 'security',
    appliesTo: azure,
    fix: 'Disallow blob public access on the account and serve public files through Front Door with a private origin; then set public: false',
    docs: 'Prevent anonymous read access to Azure Storage',
    check(m) {
      return m
        .ofKind('storage')
        .filter((e) => m.publicSaid(e.id) === true || ['true', 'blob', 'container', 'enabled'].includes(m.said(e.id, 'allow-blob-public-access', 'blob-public-access', 'anonymous-access') ?? ''))
        .map((e) => ({ on: { kind: 'node', id: e.id }, message: `${e.label} allows public access` }));
    },
  },
  {
    id: 'azure.owner-at-subscription',
    pack,
    title: 'People get broad roles through groups, not directly',
    why: 'Owner or Contributor on a whole subscription, held by a person directly, is never reviewed when they change jobs and is the first thing an attacker uses.',
    severity: 'warn',
    category: 'security',
    appliesTo: ['access'],
    fix: 'Give the role to a group (with an access review), or make it eligible through PIM; keep standing Owner for break-glass accounts only',
    docs: 'Azure RBAC best practices and Privileged Identity Management',
    check(m) {
      const hits: Hit[] = [];
      const list = Array.isArray(m.data.assignments) ? (m.data.assignments as unknown[]) : [];
      const section = (k: string) => (m.data[k] && typeof m.data[k] === 'object' ? (m.data[k] as Record<string, unknown>) : {});
      const kindOf = (k: string, id: string) => {
        const v = section(k)[id];
        return typeof v === 'string' ? v : v && typeof v === 'object' ? ((v as { kind?: string }).kind ?? '') : '';
      };
      const labelOf = (k: string, id: string) => {
        const v = section(k)[id];
        return (v && typeof v === 'object' && (v as { label?: string }).label) || id;
      };
      for (const [i, a] of list.entries()) {
        const v = typeof a === 'string' ? /^\s*(\S+)\s+is\s+(\S+)\s+on\s+(\S+)\s*$/.exec(a) : undefined;
        const [principal, role, scope] = v ? [v[1]!, v[2]!, v[3]!] : a && typeof a === 'object' ? [(a as { principal?: string }).principal ?? '', (a as { role?: string }).role ?? '', (a as { scope?: string }).scope ?? ''] : ['', '', ''];
        if (!['user', 'guest'].includes(kindOf('principals', principal))) continue;
        if (!['subscription', 'management-group', 'tenant'].includes(kindOf('resources', scope))) continue;
        const roleName = labelOf('roles', role);
        if (!/\b(owner|contributor|user access administrator)\b/i.test(`${role} ${roleName}`)) continue;
        const edge = m.graph.edges.find((e) => e.path[0] === 'assignments' && e.path[1] === i);
        hits.push({ on: edge ? { kind: 'edge', id: edge.id } : { kind: 'diagram' }, message: `${labelOf('principals', principal)} is ${roleName} on ${labelOf('resources', scope)} directly`, path: ['assignments', i] });
      }
      return hits;
    },
  },
];

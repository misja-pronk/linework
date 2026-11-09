// Kubernetes manifests → a `type: kubernetes` diagram, grouped by namespace inside one cluster.
// Reads what `kubectl apply` would: multi-document YAML, List kinds (`kubectl get -o yaml`), JSON,
// and the output of `helm template` and `kustomize build`. Links come from the manifests themselves:
// Service selectors match pod template labels, Ingress and HTTPRoute rules name services, and pod
// specs name their ConfigMaps, Secrets, claims and service account.
import { parseAllDocuments } from 'yaml';
import { scalar, slug, Warnings } from './text.ts';
import type { Imported } from './index.ts';

type Obj = Record<string, any>;

interface Node {
  id: string;
  kind: string;
  label: string;
  ns?: string;
  fields: [string, string | number | (string | number)[]][];
}

const WORKLOADS: Record<string, string> = { Deployment: 'deployment', StatefulSet: 'statefulset', DaemonSet: 'daemonset', Job: 'job', CronJob: 'cronjob', Pod: 'pod', ReplicaSet: 'deployment' };
// Short suffixes keep ids apart where Kubernetes reuses one name for several kinds ("api" the service and the deployment).
const SUFFIX: Record<string, string> = { service: 'svc', ingress: 'ing', gateway: 'gw', configmap: 'cm', secret: 'secret', pvc: 'pvc', serviceaccount: 'sa', hpa: 'hpa', networkpolicy: 'np' };
// Noise every namespace has: not something anyone drew.
// Objects that come with the cluster or with others: never worth a warning.
const WORKLOAD_KINDS = new Set(Object.values(WORKLOADS));
const NOISE = new Set(['Endpoints', 'EndpointSlice', 'Event', 'ControllerRevision', 'Lease']);
const BUILT_IN = new Set(['kube-root-ca.crt', 'default', 'istio-ca-root-cert']);

/** Whether a text looks like Kubernetes manifests rather than a diagram or Mermaid. */
export function isKubernetes(text: string): boolean {
  if (!/\bapiVersion\b/.test(text) || !/\bkind\b/.test(text)) return false;
  try {
    return parseAllDocuments(text).some((d) => {
      const o = d.errors.length ? undefined : (d.toJS() as Obj | null);
      return !!o && typeof o === 'object' && typeof o.apiVersion === 'string' && typeof o.kind === 'string';
    });
  } catch {
    return false;
  }
}

export function importKubernetes(text: string, fallbackTitle?: string): Imported {
  const warn = new Warnings();
  const objects: Obj[] = [];
  const add = (o: unknown) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    const r = o as Obj;
    if (typeof r.kind === 'string' && r.kind.endsWith('List') && Array.isArray(r.items)) r.items.forEach(add);
    else if (typeof r.kind === 'string' && r.metadata?.name) objects.push(r);
  };
  for (const doc of parseAllDocuments(text.replace(/\r\n?/g, '\n'))) {
    if (doc.errors.length) {
      warn.add(`Could not read a document: ${doc.errors[0]!.message.split('\n')[0]}`);
      continue;
    }
    add(doc.toJS());
  }
  if (!objects.length) return { yaml: '', warnings: [...warn.list, 'No Kubernetes resources found'] };

  // Without a namespace a resource lands in "default", as kubectl would put it (helm template leaves it out).
  const nsOf = (o: Obj): string => o.metadata.namespace ?? 'default';
  const nodes: Node[] = [];
  const byKey = new Map<string, Node>();
  // Ids the output itself uses, and names a workload carries: a service of the same name must not take the bare id.
  const used = new Set<string>(['cluster', 'internet']);
  const wantsBare = new Set(objects.filter((o) => WORKLOADS[o.kind]).map((o) => slug(o.metadata.name).toLowerCase()));
  const edges: { from: string; to: string; label?: string }[] = [];
  const edgeSeen = new Set<string>();
  const link = (from: Node | undefined, to: Node | undefined, label?: string) => {
    if (!from || !to || from === to || edgeSeen.has(`${from.id}>${to.id}`)) return;
    edgeSeen.add(`${from.id}>${to.id}`);
    edges.push({ from: from.id, to: to.id, label });
  };
  const namespaces = new Set<string>();

  function node(kind: string, name: string, ns: string | undefined): Node {
    const key = `${kind}/${ns ?? ''}/${name}`;
    let n = byKey.get(key);
    if (n) return n;
    const base = slug(name).toLowerCase();
    const suffix = SUFFIX[kind];
    const prefer = suffix && !base.endsWith(`-${suffix}`) && base !== suffix ? `${base}-${suffix}` : base;
    // Workloads keep their bare name, other kinds get theirs only when nothing else wants it.
    let id = suffix && !used.has(base) && !wantsBare.has(base) ? base : prefer;
    if (used.has(id) && ns) id = `${prefer}-${slug(ns)}`;
    for (let i = 2; used.has(id); i++) id = `${prefer}-${i}`;
    used.add(id);
    n = { id, kind, label: name, ns, fields: [] };
    if (ns) namespaces.add(ns);
    nodes.push(n);
    byKey.set(key, n);
    return n;
  }

  const skipped = new Map<string, number>();
  const skip = (kind: string) => skipped.set(kind, (skipped.get(kind) ?? 0) + 1);

  // Workloads first: services and policies select them by label.
  const workloads: { node: Node; labels: Obj; ns: string }[] = [];
  const attach: { owner: Node; pod: Obj; ns: string }[] = [];
  for (const o of objects) {
    const kind = WORKLOADS[o.kind];
    if (!kind) continue;
    // Pods and ReplicaSets that a Deployment or Job made are already drawn as that workload.
    if (o.metadata.ownerReferences?.length) continue;
    // helm test hooks run once to check a release; they are not part of it.
    if (/\btest\b/.test(o.metadata.annotations?.['helm.sh/hook'] ?? '')) continue;
    const ns = nsOf(o);
    const n = node(kind, o.metadata.name, ns);
    const template = o.kind === 'CronJob' ? o.spec?.jobTemplate?.spec?.template : o.kind === 'Pod' ? o : o.spec?.template;
    const pod = template?.spec ?? {};
    const containers: Obj[] = Array.isArray(pod.containers) ? pod.containers : [];
    // One replica is what everyone assumes; only say it when it is more (or none).
    if (typeof o.spec?.replicas === 'number' && o.spec.replicas !== 1 && kind !== 'pod') n.fields.push(['replicas', o.spec.replicas]);
    if (typeof containers[0]?.image === 'string') n.fields.push(['image', containers[0].image]);
    const ports = containers.flatMap((c) => (Array.isArray(c.ports) ? c.ports.map((p: Obj) => p.containerPort).filter((p: unknown) => typeof p === 'number') : []));
    if (ports.length && kind !== 'deployment' && kind !== 'pod') n.fields.push(['ports', [...new Set(ports)] as number[]]);
    if (o.kind === 'CronJob' && typeof o.spec?.schedule === 'string') n.fields.push(['schedule', o.spec.schedule]);
    workloads.push({ node: n, labels: template?.metadata?.labels ?? {}, ns });
    attach.push({ owner: n, pod, ns });
    for (const t of o.kind === 'StatefulSet' && Array.isArray(o.spec?.volumeClaimTemplates) ? o.spec.volumeClaimTemplates : []) {
      if (!t?.metadata?.name) continue;
      const claim = node('pvc', `${t.metadata.name}`, ns);
      const size = t.spec?.resources?.requests?.storage;
      if (size && !claim.fields.length) claim.fields.push(['size', String(size)]);
      link(n, claim);
    }
  }
  const selected = (ns: string, selector: Obj | undefined) => {
    const want = Object.entries(selector ?? {});
    return workloads.filter((w) => w.ns === ns && want.every(([k, v]) => w.labels[k] === v));
  };

  const services = new Map<string, Node>();
  const serviceNode = (name: string, ns: string) => services.get(`${ns}/${name}`) ?? node('service', name, ns);
  const routes: Obj[] = [];
  const internetNode: Node = { id: 'internet', kind: 'internet', label: 'Internet', fields: [] };
  const internet = () => (nodes.includes(internetNode) ? internetNode : (nodes.unshift(internetNode), internetNode));

  for (const o of objects) {
    const ns = nsOf(o);
    const name: string = o.metadata.name;
    switch (o.kind) {
      case 'Service': {
        // The API server's own service, in every `kubectl get` of default.
        if (name === 'kubernetes' && ns === 'default' && !o.spec?.selector) break;
        const n = node('service', name, ns);
        services.set(`${ns}/${name}`, n);
        const type = o.spec?.type;
        if (type && type !== 'ClusterIP') n.fields.push(['serviceType', type]);
        const ports = (Array.isArray(o.spec?.ports) ? o.spec.ports : []).map((p: Obj) =>
          p.targetPort != null && p.targetPort !== p.port ? `${p.port}:${p.targetPort}` : p.port,
        ).filter((p: unknown) => p != null);
        if (ports.length) n.fields.push(['ports', ports]);
        if (o.spec?.selector && Object.keys(o.spec.selector).length) {
          const hits = selected(ns, o.spec.selector);
          if (!hits.length) warn.add(`Service ${ns}/${name} selects no workload in these manifests`);
          for (const w of hits) link(n, w.node);
        }
        if (type === 'LoadBalancer') link(internet(), n);
        if (type === 'ExternalName' && o.spec?.externalName) {
          const ext = node('external', o.spec.externalName, undefined);
          link(n, ext);
        }
        break;
      }
      case 'Ingress':
      case 'HTTPRoute':
      case 'Gateway':
        routes.push(o);
        break;
      case 'ConfigMap':
      case 'Secret':
      case 'PersistentVolumeClaim':
      case 'ServiceAccount':
      case 'HorizontalPodAutoscaler':
      case 'NetworkPolicy':
      case 'Namespace':
        break;
      default:
        if (!WORKLOADS[o.kind] && !NOISE.has(o.kind)) skip(o.kind);
    }
  }

  // Declared ConfigMaps, Secrets, claims and accounts, keyed so pod specs find them.
  const declared = new Map<string, Obj>();
  for (const o of objects) if (['ConfigMap', 'Secret', 'PersistentVolumeClaim', 'ServiceAccount'].includes(o.kind)) declared.set(`${o.kind}/${nsOf(o)}/${o.metadata.name}`, o);
  const resource = (kind: 'configmap' | 'secret' | 'pvc' | 'serviceaccount', name: string, ns: string) => {
    const n = node(kind, name, ns);
    const pvc = declared.get(`PersistentVolumeClaim/${ns}/${name}`);
    const size = pvc?.spec?.resources?.requests?.storage;
    if (kind === 'pvc' && size && !n.fields.length) n.fields.push(['size', String(size)]);
    return n;
  };
  for (const { owner, pod, ns } of attach) {
    const containers: Obj[] = [...(pod.initContainers ?? []), ...(pod.containers ?? [])];
    for (const v of Array.isArray(pod.volumes) ? pod.volumes : []) {
      if (v.configMap?.name) link(owner, resource('configmap', v.configMap.name, ns));
      if (v.secret?.secretName) link(owner, resource('secret', v.secret.secretName, ns));
      if (v.persistentVolumeClaim?.claimName) link(owner, resource('pvc', v.persistentVolumeClaim.claimName, ns));
      for (const s of v.projected?.sources ?? []) {
        if (s.configMap?.name && !BUILT_IN.has(s.configMap.name)) link(owner, resource('configmap', s.configMap.name, ns));
        if (s.secret?.name) link(owner, resource('secret', s.secret.name, ns));
      }
    }
    for (const c of containers) {
      for (const f of c.envFrom ?? []) {
        if (f.configMapRef?.name) link(owner, resource('configmap', f.configMapRef.name, ns));
        if (f.secretRef?.name) link(owner, resource('secret', f.secretRef.name, ns));
      }
      for (const e of c.env ?? []) {
        if (e.valueFrom?.configMapKeyRef?.name) link(owner, resource('configmap', e.valueFrom.configMapKeyRef.name, ns));
        if (e.valueFrom?.secretKeyRef?.name) link(owner, resource('secret', e.valueFrom.secretKeyRef.name, ns));
      }
    }
    const sa = pod.serviceAccountName ?? pod.serviceAccount;
    if (sa && sa !== 'default') link(owner, resource('serviceaccount', sa, ns));
    for (const p of pod.imagePullSecrets ?? []) if (p?.name) link(owner, resource('secret', p.name, ns));
  }
  // Declared but used by nothing here: kept out, or every namespace grows a pile of loose cards.
  let unused = 0;
  for (const [key, o] of declared) {
    const kind = { ConfigMap: 'configmap', Secret: 'secret', PersistentVolumeClaim: 'pvc', ServiceAccount: 'serviceaccount' }[o.kind as string]!;
    if (byKey.has(`${kind}/${key.split('/').slice(1).join('/')}`)) continue;
    if (BUILT_IN.has(o.metadata.name) || o.type === 'kubernetes.io/service-account-token' || String(o.type ?? '').startsWith('helm.sh/')) continue;
    unused++;
  }
  if (unused) warn.add(`${unused} ConfigMap${unused > 1 ? 's, Secrets or accounts' : ', Secret or account'} that no workload uses ${unused > 1 ? 'are' : 'is'} left out`);

  // Traffic in: Ingress rules and Gateway API routes name the services they send to.
  // Gateways before the routes that hang off them.
  routes.sort((a, b) => Number(b.kind === 'Gateway') - Number(a.kind === 'Gateway'));
  for (const o of routes) {
    const ns = nsOf(o);
    if (o.kind === 'Ingress') {
      const n = node('ingress', o.metadata.name, ns);
      const rules: Obj[] = Array.isArray(o.spec?.rules) ? o.spec.rules : [];
      const hosts = [...new Set(rules.map((r) => r.host).filter(Boolean))];
      if (hosts.length) n.fields.push(['host', hosts.length > 1 ? `${hosts[0]} +${hosts.length - 1}` : hosts[0]]);
      link(internet(), n, o.spec?.tls?.length ? 'HTTPS' : 'HTTP');
      for (const t of o.spec?.tls ?? []) if (t.secretName) link(n, resource('secret', t.secretName, ns));
      const backend = (b: Obj | undefined) => b?.service?.name ?? b?.serviceName;
      const paths = rules.flatMap((r) => (r.http?.paths ?? []).map((p: Obj) => ({ host: r.host as string | undefined, path: p.path as string | undefined, svc: backend(p.backend) })));
      const def = backend(o.spec?.defaultBackend ?? o.spec?.backend);
      if (def) paths.push({ host: undefined, path: undefined, svc: def });
      // A label only tells something when there is more than one way in.
      const label = (p: (typeof paths)[number]) => (hosts.length > 1 && p.host ? `${p.host}${p.path && p.path !== '/' ? p.path : ''}` : (p.path ?? '/'));
      for (const p of paths) if (p.svc) link(n, serviceNode(p.svc, ns), paths.length > 1 ? label(p) : undefined);
    } else if (o.kind === 'Gateway') {
      const n = node('gateway', o.metadata.name, ns);
      const hosts = (o.spec?.listeners ?? []).map((l: Obj) => l.hostname).filter(Boolean);
      if (hosts.length) n.fields.push(['host', hosts[0]]);
      link(internet(), n, (o.spec?.listeners ?? []).some((l: Obj) => l.protocol === 'HTTPS') ? 'HTTPS' : undefined);
    } else {
      // An HTTPRoute is the link itself: gateway → service, labelled with its path.
      const parents: Obj[] = o.spec?.parentRefs ?? [];
      const gws = parents.filter((p) => !p.kind || p.kind === 'Gateway').map((p) => {
        const g = node('gateway', p.name, p.namespace ?? ns);
        if (!edges.some((e) => e.to === g.id)) link(internet(), g);
        return g;
      });
      for (const rule of o.spec?.rules ?? []) {
        const path = rule.matches?.[0]?.path?.value;
        for (const b of rule.backendRefs ?? []) if (!b.kind || b.kind === 'Service') for (const g of gws) link(g, serviceNode(b.name, b.namespace ?? ns), path && path !== '/' ? path : undefined);
      }
    }
  }

  // Autoscalers and policies point at workloads.
  let policies = false;
  for (const o of objects) {
    const ns = nsOf(o);
    if (o.kind === 'HorizontalPodAutoscaler') {
      const ref = o.spec?.scaleTargetRef;
      const target = ref && byKey.get(`${WORKLOADS[ref.kind] ?? ''}/${ns}/${ref.name}`);
      if (!target) {
        warn.add(`HorizontalPodAutoscaler ${ns}/${o.metadata.name} scales ${ref?.kind ?? '?'} ${ref?.name ?? '?'}, which is not in these manifests`);
        continue;
      }
      const n = node('hpa', o.metadata.name, ns);
      const min = o.spec?.minReplicas ?? 1;
      if (o.spec?.maxReplicas != null) n.fields.push(['replicas', `${min}-${o.spec.maxReplicas}`]);
      link(n, target);
    } else if (o.kind === 'NetworkPolicy') {
      const n = node('networkpolicy', o.metadata.name, ns);
      const sel = o.spec?.podSelector?.matchLabels;
      // An empty selector guards every workload in the namespace; each one shows it as a badge.
      for (const w of selected(ns, sel)) link(n, w.node);
      policies = true;
    }
  }

  if (skipped.size) warn.add(`Left out: ${[...skipped].map(([k, n]) => (n > 1 ? `${n} × ${k}` : k)).join(', ')}`);

  // Written in the order traffic flows (outside in, then what workloads use), which is also how dot ranks best.
  const rank = (kind: string | undefined) => ({ internet: 0, gateway: 1, ingress: 1, service: 2 })[kind ?? ''] ?? (WORKLOAD_KINDS.has(kind!) ? 3 : 4);
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  nodes.sort((a, b) => rank(a.kind) - rank(b.kind));
  edges.sort((a, b) => rank(kindOf.get(a.from)) - rank(kindOf.get(b.from)));

  const out: string[] = ['type: kubernetes', `title: ${scalar(fallbackTitle ?? 'Kubernetes')}`, '', 'groups:', '  cluster: { kind: cluster, label: Cluster }'];
  for (const o of objects) if (o.kind === 'Namespace') namespaces.add(o.metadata.name);
  const nsList = [...namespaces].sort();
  for (const ns of nsList) out.push(`  ${nsId(ns)}: { kind: namespace, label: ${scalar(ns)}, in: cluster }`);
  // Policies would otherwise draw a line to every workload they guard.
  if (policies) out.push('', '# Policies show as badges on the workloads they guard, like mounts, accounts and autoscalers.', 'badges: [mounts, identity, scales, policy]');
  out.push('', 'nodes:');
  const value = (v: string | number | (string | number)[]): string =>
    Array.isArray(v) ? `[${v.map(value).join(', ')}]` : typeof v === 'number' ? String(v) : scalar(v);
  for (const n of nodes) {
    const parts: string[] = [`kind: ${n.kind}`];
    if (n.label !== n.id && n.kind !== 'internet') parts.push(`label: ${scalar(n.label)}`);
    if (n.ns) parts.push(`in: ${nsId(n.ns)}`);
    else if (n.kind !== 'internet' && n.kind !== 'external') parts.push('in: cluster');
    for (const [k, v] of n.fields) parts.push(`${k}: ${value(v)}`);
    out.push(n.kind === 'internet' ? `  ${n.id}: internet` : `  ${n.id}: { ${parts.join(', ')} }`);
  }
  if (edges.length) {
    out.push('', 'edges:');
    for (const e of edges) out.push(`  - ${e.from} -> ${e.to}${e.label ? `: ${scalar(e.label)}` : ''}`);
  }
  return { yaml: out.join('\n') + '\n', warnings: warn.list };
}

// Namespace ids carry a prefix: "monitoring" the namespace and "monitoring" the deployment are common.
const nsId = (ns: string) => `ns-${slug(ns).toLowerCase()}`;

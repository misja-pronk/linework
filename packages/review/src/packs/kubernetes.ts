// Kubernetes: what a cluster review asks of a drawing of namespaces and workloads.
import type { Rule } from '../types.ts';

const pack = 'kubernetes';
const k8s = ['kubernetes'];
const WORKLOADS = ['deployment', 'statefulset', 'daemonset', 'job', 'cronjob', 'pod', 'replicaset'];
const ENV = /\b(env|envfrom|environment|env vars?)\b/i;

export const kubernetesRules: Rule[] = [
  {
    id: 'k8s.resource-limits',
    pack,
    title: 'Workloads set resource limits',
    why: 'A pod without limits can take a node\'s memory and CPU from everything else on it, and the scheduler cannot plan for it.',
    severity: 'warn',
    category: 'reliability',
    appliesTo: k8s,
    fix: 'Set requests and limits on every container and write them down (props: { limits: cpu 500m · memory 512Mi }); a LimitRange per namespace catches the rest',
    docs: 'Kubernetes resource management for pods and containers',
    check(m) {
      const workloads = m.ofKind(...WORKLOADS);
      // Only once limits are written for some: a drawing that never says is not assumed wrong.
      const said = (id: string) => m.said(id, 'limits', 'resources');
      if (!workloads.some((w) => said(w.id) !== undefined)) return [];
      return workloads.filter((w) => [undefined, 'none', 'false', ''].includes(said(w.id))).map((w) => ({ on: { kind: 'node', id: w.id }, message: `${w.label} has no resource limits` }));
    },
  },
  {
    id: 'k8s.loadbalancer-service',
    pack,
    title: 'Services are not exposed one by one as load balancers',
    why: 'Each LoadBalancer service is a public address of its own, outside the ingress where TLS, auth and rate limits live.',
    severity: 'warn',
    category: 'security',
    appliesTo: k8s,
    fix: 'Route the traffic through an ingress or Gateway; when a load balancer is needed, make it internal (props: { internal: true }) or public: false',
    docs: 'Kubernetes Ingress and Gateway API',
    check(m) {
      return m
        .ofKind('service')
        .filter((s) => {
          if (m.publicSaid(s.id) === false || m.said(s.id, 'internal') === 'true' || m.tagged(s.id, 'internal')) return false;
          // The load balancer of an ingress controller or gateway is how an ingress is reached: that is the point.
          const next = m.out(s.id).map((l) => l.to);
          if ([...next, ...next.flatMap((n) => m.out(n).map((l) => l.to))].some((n) => ['ingress', 'gateway', 'httproute'].includes(m.el(n)?.kind ?? ''))) return false;
          return m.said(s.id, 'serviceType', 'type') === 'loadbalancer' || m.in(s.id).some((l) => m.outsider(l.from));
        })
        .map((s) => ({ on: { kind: 'node', id: s.id }, message: `${s.label} is exposed to the outside as a load balancer, not through an ingress` }));
    },
  },
  {
    id: 'k8s.no-network-policy',
    pack,
    title: 'Namespaces have a NetworkPolicy',
    why: 'Without a policy every pod accepts traffic from every other pod in the cluster: one compromised pod reaches all.',
    severity: 'warn',
    category: 'security',
    appliesTo: k8s,
    fix: 'Add a default-deny NetworkPolicy to the namespace and allow what is drawn; draw it (kind: networkpolicy) so the review sees it',
    docs: 'Kubernetes network policies',
    check(m) {
      const bare = m.ofKind('namespace').filter((ns) => {
        const inside = m.inside(ns.id);
        return inside.some((e) => WORKLOADS.includes(e.kind ?? '')) && !inside.some((e) => e.kind === 'networkpolicy') && !m.tagged(ns.id, 'network-policy');
      });
      // None at all: one finding for the cluster, not one per namespace.
      const cluster = m.ofKind('cluster');
      if (bare.length > 1 && !m.has('networkpolicy') && cluster.length === 1)
        return [{ on: { kind: 'group', id: cluster[0]!.id }, message: `No namespace of ${cluster[0]!.label} has a NetworkPolicy: ${bare.map((ns) => ns.label).join(', ')}` }];
      return bare.map((ns) => ({ on: { kind: 'group', id: ns.id }, message: `Namespace ${ns.label} has no NetworkPolicy` }));
    },
  },
  {
    id: 'k8s.secret-as-env',
    pack,
    title: 'Secrets are mounted as files, not environment variables',
    why: 'Environment variables end up in crash dumps, logs and child processes; a mounted file does not, and can be rotated in place.',
    severity: 'info',
    category: 'security',
    appliesTo: k8s,
    fix: 'Mount the Secret as a volume (or use the Secrets Store CSI driver with a vault) and label the line volume',
    docs: 'Kubernetes Secrets good practices',
    check(m) {
      return m.lines
        .filter((l) => WORKLOADS.includes(m.el(l.from)?.kind ?? '') && m.el(l.to)?.kind === 'secret' && (ENV.test(l.label) || ENV.test(String(l.props.as ?? ''))))
        .map((l) => ({ on: { kind: 'edge', id: l.id }, message: `${m.name(l.from)} reads ${m.name(l.to)} as environment variables` }));
    },
  },
];

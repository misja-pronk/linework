import type { Answers, Wizard } from '../engine.ts';
import { comment, entry, file, flow, scalar, slug } from '../yaml.ts';

const SOURCE = 'Azure Architecture Center, "Baseline architecture for an Azure Kubernetes Service (AKS) cluster" and its reference implementation (github.com/mspnp/aks-baseline)';

export const aksBaseline: Wizard = {
  id: 'aks-baseline',
  name: 'AKS baseline',
  type: 'azure',
  description: 'An AKS cluster in a spoke network: ingress, node pools, ACR, Key Vault, monitoring and egress through the hub firewall',
  source: SOURCE,
  questions: [
    { id: 'app', kind: 'text', label: 'What runs on the cluster?', default: 'Orders', help: 'Names the cluster, the network and the title.' },
    { id: 'private', kind: 'yesno', label: 'Private cluster (API server only reachable inside the network)?', default: true, help: 'The baseline recommends it; operators come in through Bastion.' },
    {
      id: 'ingress',
      kind: 'choice',
      label: 'How does traffic come in?',
      default: 'app-gateway',
      options: [
        { value: 'app-gateway', label: 'Application Gateway with WAF', help: 'As in the baseline: TLS and WAF before the cluster.' },
        { value: 'nginx', label: 'NGINX ingress controller', help: 'Behind an Azure load balancer; WAF is yours to add.' },
      ],
    },
    { id: 'pools', kind: 'number', label: 'How many user node pools (besides the system pool)?', min: 1, max: 3, default: 1, help: 'Separate pools for workloads with different VM sizes or isolation.' },
    { id: 'acr', kind: 'yesno', label: 'Pull images from Azure Container Registry over a private endpoint?', default: true },
    { id: 'keyvault', kind: 'yesno', label: 'Mount secrets from Key Vault (Secrets Store CSI driver)?', default: true },
    { id: 'monitoring', kind: 'yesno', label: 'Send logs and metrics to Azure Monitor (Container insights, managed Prometheus)?', default: true },
    { id: 'firewall', kind: 'yesno', label: 'Route egress through Azure Firewall in a hub network?', default: true, help: 'Otherwise a NAT gateway in the spoke.' },
  ],
  build,
};

function build(a: Answers): string {
  const app = String(a.app) || 'Orders';
  const id = slug(app);
  const fw = !!a.firewall;
  const agw = a.ingress === 'app-gateway';
  const pools = Number(a.pools);
  const pe = !!a.acr || !!a.keyvault || !!a.private;
  const poolIds = Array.from({ length: pools }, (_, i) => (pools === 1 ? 'pool-user' : `pool-user-${i + 1}`));

  const L: (string | false)[] = [];
  L.push(...comment(`Made by the AKS baseline wizard (carto new --wizard aks-baseline). Follows ${SOURCE}.`));
  L.push('type: azure');
  L.push(`title: ${scalar(`${app} on AKS`)}`);
  L.push(`subtitle: ${scalar(['AKS baseline', a.private ? 'private cluster' : 'public API server', agw ? 'Application Gateway' : 'NGINX ingress', fw ? 'egress through Azure Firewall' : 'NAT gateway egress'].join(' · '))}`);
  L.push('');
  L.push('groups:');
  if (fw) {
    L.push(...comment('The hub: shared by every spoke, run by the platform team.', 2));
    L.push(entry('hub', { kind: 'vnet', label: 'vnet-hub · 10.200.0.0/24' }));
  }
  L.push(entry('spoke', { kind: 'vnet', label: `vnet-spoke-${id} · 10.240.0.0/16` }));
  if (agw) L.push(entry('snet-ingress', { kind: 'subnet', label: 'snet-appgw · 10.240.4.0/24', in: 'spoke' }));
  L.push(entry('snet-nodes', { kind: 'subnet', label: 'snet-nodes · 10.240.0.0/22', in: 'spoke' }));
  L.push(entry('cluster', { kind: 'aks-cluster', label: `aks-${id}`, in: 'snet-nodes' }));
  if (pe) L.push(entry('snet-pe', { kind: 'subnet', label: 'snet-private-endpoints · 10.240.5.0/28', in: 'spoke' }));
  L.push('');
  L.push(...comment('Monitoring lines are drawn as badges on the cards they come from.'));
  L.push('badges: [management]');
  L.push('');
  L.push('nodes:');
  L.push(entry('users', { kind: 'users', label: 'Users' }));
  if (agw) L.push(entry('agw', { kind: 'app-gateway', label: `agw-${id}`, caption: 'WAF v2', in: 'snet-ingress' }));
  else {
    L.push(entry('lb', { kind: 'load-balancer', label: 'Load balancer', caption: 'Public IP', in: 'snet-nodes' }));
    L.push(entry('nginx', { kind: 'service', label: 'NGINX ingress', caption: 'ingress controller', in: 'cluster' }));
  }
  L.push(...comment('The system pool runs only cluster add-ons (CriticalAddonsOnly taint); workloads go to the user pools.', 2));
  L.push(entry('pool-system', { kind: 'vmss', label: 'System pool', caption: '3 nodes · zones 1-3', in: 'cluster' }));
  poolIds.forEach((p, i) => L.push(entry(p, { kind: 'vmss', label: pools === 1 ? 'User pool' : `User pool ${i + 1}`, caption: `${app} workloads`, in: 'cluster' })));
  if (a.private) L.push(entry('api', { kind: 'private-endpoint', label: 'API server', caption: 'Private endpoint', in: 'snet-pe' }));
  else L.push(entry('api', { kind: 'service', label: 'API server', caption: 'Authorized IP ranges' }));
  if (a.acr) L.push(entry('acr', { kind: 'container-registry', label: `acr${id.replace(/-/g, '')}`, caption: 'Private endpoint', in: 'snet-pe' }));
  if (a.keyvault) L.push(entry('kv', { kind: 'key-vault', label: `kv-${id}`, caption: 'Private endpoint', in: 'snet-pe' }));
  if (fw) {
    L.push(entry('afw', { kind: 'firewall', label: 'afw-hub', caption: 'Egress allow list', in: 'hub' }));
    if (a.private) L.push(entry('bastion', { kind: 'bastion', label: 'Bastion', caption: 'Operator access', in: 'hub' }));
  } else {
    L.push(entry('nat', { kind: 'nat-gateway', label: 'NAT gateway', in: 'spoke' }));
    if (a.private) L.push(entry('bastion', { kind: 'bastion', label: 'Bastion', caption: 'Operator access', in: 'spoke' }));
  }
  if (a.monitoring) L.push(entry('logs', { kind: 'log-analytics', label: 'Azure Monitor', caption: 'Container insights · Prometheus' }));
  L.push(entry('internet', { kind: 'internet', label: 'Internet', caption: 'Allowed FQDNs' }));
  L.push('');

  L.push('edges:');
  if (agw) {
    L.push(`  - users -> agw: { label: HTTPS, style: public }`);
    poolIds.forEach((p, i) => L.push(`  - agw -> ${p}: ${flow({ label: i === 0 ? 'TLS to ingress' : undefined, style: 'private' })}`));
  } else {
    L.push(`  - users -> lb: { label: HTTPS, style: public }`);
    L.push(`  - lb -> nginx: { style: private }`);
    poolIds.forEach((p) => L.push(`  - nginx -> ${p}: { style: private }`));
  }
  const first = poolIds[0]!;
  if (a.acr) L.push(`  - ${first} -> acr: { label: pull images, style: private }`);
  if (a.keyvault) L.push(`  - ${first} -> kv: { label: CSI secrets, style: identity }`);
  L.push(`  - pool-system -> api: { style: private }`);
  if (a.private && fw) L.push(`  - bastion -> api: { label: kubectl, style: private }`);
  if (a.private && !fw) L.push(`  - bastion -> api: { label: kubectl, style: private }`);
  if (fw) {
    L.push(...comment('A route table on the node subnet sends 0.0.0.0/0 to the firewall (UDR).', 2));
    L.push(`  - ${first} -> afw: { label: 0.0.0.0/0, style: private }`);
    L.push(`  - afw -> internet: { style: public }`);
  } else {
    L.push(`  - ${first} -> nat: { label: outbound, style: private }`);
    L.push(`  - nat -> internet: { style: public }`);
  }
  if (a.monitoring) {
    L.push(`  - pool-system -> logs: { style: management }`);
    for (const p of poolIds) L.push(`  - ${p} -> logs: { style: management }`);
    if (fw) L.push(`  - afw -> logs: { style: management }`);
    if (agw) L.push(`  - agw -> logs: { style: management }`);
  }
  L.push('');

  L.push('steps:');
  L.push(`  - title: The cluster`);
  L.push(`    caption: ${scalar(`aks-${id} runs in its own spoke network: a system pool for add-ons, ${pools === 1 ? 'a user pool' : `${pools} user pools`} for the workloads.`)}`);
  L.push(`    focus: cluster`);
  L.push(`  - title: In`);
  L.push(`    caption: ${scalar(agw ? 'Requests pass the Application Gateway WAF and reach the ingress in the user pool over TLS.' : 'Requests come through the Azure load balancer to the NGINX ingress controller.')}`);
  L.push(`    path: ${agw ? `users -> agw -> ${first}` : `users -> lb -> nginx -> ${first}`}`);
  L.push(`  - title: Out`);
  L.push(`    caption: ${scalar(fw ? 'Every outbound call leaves through the hub firewall, which only allows the FQDNs the cluster needs.' : 'Outbound calls leave through the NAT gateway, from one fixed public IP.')}`);
  L.push(`    path: ${fw ? `${first} -> afw -> internet` : `${first} -> nat -> internet`}`);
  return file(L);
}

import { names, type Answers, type Wizard } from '../engine.ts';
import { comment, entry, file, flow, ids, scalar } from '../yaml.ts';

const SOURCE = 'Azure Architecture Center, "Hub-spoke network topology in Azure" (learn.microsoft.com/azure/architecture/networking/architecture/hub-spoke)';

export const hubSpoke: Wizard = {
  id: 'hub-spoke',
  name: 'Hub and spoke network',
  type: 'azure',
  types: ['azure', 'network'],
  description: 'A hub with the firewall, gateways and DNS; spokes peered to it; the link to on-premises',
  source: SOURCE,
  questions: [
    {
      id: 'notation',
      kind: 'choice',
      label: 'Draw it as?',
      default: 'azure',
      options: [
        { value: 'azure', label: 'Azure', help: 'Virtual networks and Azure services (type: azure).' },
        { value: 'network', label: 'Network diagram', help: 'Routers, firewalls, address ranges (type: network); fits any cloud.' },
      ],
    },
    { id: 'spokes', kind: 'text', list: true, label: 'Which spokes?', default: 'Production, Test, Shared services', help: 'One virtual network per name, separated by commas (1 to 8).' },
    { id: 'firewall', kind: 'yesno', label: 'A firewall in the hub (spoke to spoke and egress through it)?', default: true },
    {
      id: 'onprem',
      kind: 'choice',
      label: 'Link to on-premises?',
      default: 'vpn',
      options: [
        { value: 'expressroute', label: 'ExpressRoute' },
        { value: 'vpn', label: 'Site-to-site VPN' },
        { value: 'both', label: 'ExpressRoute with VPN backup' },
        { value: 'none', label: 'None' },
      ],
    },
    { id: 'dns', kind: 'yesno', label: 'Central DNS in the hub (Private DNS Resolver)?', default: true, help: 'Spokes resolve private endpoints and on-premises names through the hub.' },
    { id: 'bastion', kind: 'yesno', label: 'Azure Bastion in the hub for admin access?', default: true, when: (a) => a.notation === 'azure' },
  ],
  build,
};

function build(a: Answers): string {
  const net = a.notation === 'network';
  const spokes = names(a.spokes).slice(0, 8);
  if (!spokes.length) spokes.push('Workload');
  const spokeIds = ids(spokes, ['hub', 'onprem', 'region', 'fw', 'dns', 'bastion', 'ergw', 'vpngw', 'router', 'internet']);
  const fw = !!a.firewall;
  const onprem = String(a.onprem);
  const er = onprem === 'expressroute' || onprem === 'both';
  const vpn = onprem === 'vpn' || onprem === 'both';
  // Where spoke traffic lands in the hub: the firewall, else the hub's gateway or the hub itself.
  const into = fw ? 'fw' : 'hub';

  const L: (string | false)[] = [];
  L.push(...comment(`Made by the hub and spoke wizard (carto new --wizard hub-spoke). Follows ${SOURCE}.`));
  L.push(`type: ${net ? 'network' : 'azure'}`);
  L.push('title: Hub and spoke');
  L.push(`subtitle: ${scalar([`${spokes.length} ${spokes.length === 1 ? 'spoke' : 'spokes'}`, fw ? 'traffic inspected in the hub' : 'no central firewall', onprem === 'none' ? 'cloud only' : er && vpn ? 'ExpressRoute with VPN backup' : er ? 'ExpressRoute to the data centre' : 'VPN to the data centre'].join(' · '))}`);
  L.push('');
  L.push('groups:');
  if (net) {
    L.push(entry('region', { kind: 'region', label: 'Cloud region' }));
    L.push(entry('hub', { kind: 'vnet', label: 'vnet-hub', cidr: '10.0.0.0/22', in: 'region' }));
    spokes.forEach((s, i) => L.push(entry(spokeIds[i]!, { kind: 'vnet', label: `vnet-${spokeIds[i]}`, caption: s, cidr: `10.${i + 1}.0.0/16`, in: 'region' })));
    if (onprem !== 'none') L.push(entry('onprem', { kind: 'datacenter', label: 'Data centre', cidr: '172.16.0.0/16' }));
  } else {
    L.push(entry('hub', { kind: 'vnet', label: 'vnet-hub · 10.0.0.0/22' }));
    spokes.forEach((s, i) => L.push(entry(spokeIds[i]!, { kind: 'vnet', label: `vnet-${spokeIds[i]} · 10.${i + 1}.0.0/16` })));
    if (onprem !== 'none') L.push(entry('onprem', { kind: 'on-premises', label: 'Data centre' }));
  }
  L.push('');
  L.push('nodes:');
  L.push(...comment('The hub holds what every spoke shares.', 2));
  if (fw) L.push(entry('fw', net ? { kind: 'firewall', label: 'afw-hub', model: 'Azure Firewall', ip: '10.0.1.4', in: 'hub' } : { kind: 'firewall', label: 'afw-hub', caption: 'Routes 0.0.0.0/0', in: 'hub' }));
  if (er) L.push(entry('ergw', net ? { kind: 'cloud-gateway', label: 'ergw-hub', model: 'ExpressRoute gateway', in: 'hub' } : { kind: 'expressroute', label: 'ergw-hub', in: 'hub' }));
  if (vpn) L.push(entry('vpngw', { kind: 'vpn-gateway', label: 'vpngw-hub', in: 'hub' }));
  if (a.dns) L.push(entry('dns', net ? { kind: 'dns', label: 'DNS resolver', ip: '10.0.2.4', in: 'hub' } : { kind: 'dns', label: 'Private DNS Resolver', caption: 'Inbound 10.0.2.4', in: 'hub' }));
  if (a.bastion && !net) L.push(entry('bastion', { kind: 'bastion', label: 'Bastion', caption: 'Admin access', in: 'hub' }));
  // A hub with nothing asked for still needs something to show it is there.
  if (!fw && !er && !vpn && !a.dns && !(a.bastion && !net)) L.push(entry('hub-router', net ? { kind: 'router', label: 'Hub router', in: 'hub' } : { kind: 'service', label: 'Hub router', in: 'hub' }));
  L.push('');
  L.push(...comment('One workload per spoke, to show where the traffic goes.', 2));
  spokes.forEach((s, i) => L.push(entry(`${spokeIds[i]}-app`, net ? { kind: 'server', label: s, ip: `10.${i + 1}.1.0/24`, in: spokeIds[i]! } : { kind: 'vm', label: `${s} workload`, in: spokeIds[i]! })));
  if (onprem !== 'none') L.push(entry('router', net ? { kind: 'router', label: 'Edge router', ha: true, in: 'onprem' } : { kind: 'vpn-gateway', label: 'Edge router', caption: 'Customer edge', in: 'onprem' }));
  L.push(entry('internet', { kind: 'internet', label: 'Internet' }));
  L.push('');
  L.push('edges:');
  const peer = net ? 'peering' : 'private';
  const line = net ? '--' : '->';
  const hubTarget = fw ? 'fw' : !net ? 'hub' : er ? 'ergw' : vpn ? 'vpngw' : a.dns ? 'dns' : 'hub-router';
  spokes.forEach((_, i) => L.push(`  - ${spokeIds[i]}-app ${line} ${net ? hubTarget : into}: ${flow({ label: i === 0 ? 'peering' : undefined, style: peer })}`));
  if (er) L.push(`  - router ${line} ergw: ${flow({ label: 'ExpressRoute', style: net ? 'circuit' : 'private' })}`);
  if (vpn) L.push(`  - router ${line} vpngw: ${flow({ label: er ? 'IPsec backup' : 'IPsec', style: net ? 'vpn' : 'private' })}`);
  if (fw && er) L.push(`  - ergw ${line} fw${net ? '' : ': { style: private }'}`);
  if (fw && vpn) L.push(`  - vpngw ${line} fw${net ? '' : ': { style: private }'}`);
  if (fw && a.dns) L.push(`  - fw ..> dns: DNS proxy`);
  if (a.bastion && !net) spokes.slice(0, 1).forEach((_, i) => L.push(`  - bastion -> ${spokeIds[i]}-app: { label: RDP/SSH, style: private }`));
  L.push(`  - ${fw ? 'fw' : `${spokeIds[0]}-app`} ${line} internet: ${flow({ label: 'egress', style: net ? 'wan' : 'public' })}`);
  L.push('');
  L.push('steps:');
  L.push(`  - title: The hub`);
  L.push(`    caption: ${scalar('Shared services live once, in the hub: ' + [fw && 'the firewall', (er || vpn) && 'the gateways', a.dns && 'DNS', a.bastion && !net && 'Bastion'].filter(Boolean).join(', ') + '.')}`);
  L.push(`    focus: hub`);
  if (spokes.length > 1) {
    L.push(`  - title: Spoke to spoke`);
    L.push(`    caption: ${scalar(fw ? 'Spokes are not peered with each other: traffic between them goes through the hub firewall.' : 'Spokes are not peered with each other; without a firewall in the hub they cannot reach each other.')}`);
    L.push(`    focus: ${flow([`${spokeIds[0]}-app`, `${spokeIds[1]}-app`, ...(fw ? ['fw'] : [])])}`);
  }
  if (onprem !== 'none') {
    L.push(`  - title: On-premises`);
    L.push(`    caption: ${scalar(`The data centre reaches every spoke through the hub ${er ? 'ExpressRoute' : 'VPN'} gateway${fw ? ', past the firewall' : ''}.`)}`);
    L.push(`    focus: ${flow(['router', er ? 'ergw' : 'vpngw', ...(fw ? ['fw'] : [])])}`);
  }
  return file(L);
}

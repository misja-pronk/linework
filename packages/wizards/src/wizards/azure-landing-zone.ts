import { names, type Answers, type Wizard } from '../engine.ts';
import { comment, entry, file, flow, ids, scalar, slug } from '../yaml.ts';
import { azureGeographies } from '../regions.ts';

const SOURCE = 'Microsoft Cloud Adoption Framework, "Azure landing zone architecture" (learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/)';

export const azureLandingZone: Wizard = {
  id: 'azure-landing-zone',
  name: 'Azure landing zone (CAF)',
  type: 'azure',
  description: 'Management groups, the platform subscriptions and your landing zones, wired to a hub or a Virtual WAN',
  source: SOURCE,
  questions: [
    { id: 'org', kind: 'text', label: 'What is the organisation called?', default: 'Contoso', help: 'Names the top management group and the title.' },
    {
      id: 'network',
      kind: 'choice',
      label: 'Which network topology?',
      default: 'hub-spoke',
      options: [
        { value: 'hub-spoke', label: 'Hub and spoke', help: 'A hub virtual network you run per region; spokes peer to it. Most control.' },
        { value: 'vwan', label: 'Virtual WAN', help: 'Microsoft runs the hubs; best for many branches, regions or SD-WAN.' },
      ],
    },
    { id: 'firewall', kind: 'yesno', label: 'Inspect traffic with Azure Firewall in the hub?', default: true, help: 'CAF recommends it: east-west and egress go through the hub.' },
    {
      id: 'onprem',
      kind: 'choice',
      label: 'How does the hub reach on-premises?',
      default: 'expressroute',
      options: [
        { value: 'expressroute', label: 'ExpressRoute', help: 'A private circuit through a provider.' },
        { value: 'vpn', label: 'Site-to-site VPN', help: 'IPsec over the internet.' },
        { value: 'both', label: 'ExpressRoute with VPN backup' },
        { value: 'none', label: 'Not connected', help: 'Cloud only.' },
      ],
    },
    { id: 'geo', kind: 'choice', label: 'Where?', default: 'europe', options: azureGeographies.map(({ value, label, help }) => ({ value, label, help })) },
    { id: 'regions', kind: 'number', label: 'How many regions?', min: 1, max: 3, default: 1, help: 'One hub per region; spokes spread over them.' },
    { id: 'corp', kind: 'text', list: true, label: 'Corp landing zones (private, connected to on-premises)', default: 'Finance, HR', help: 'Names, separated by commas. Empty for none.' },
    { id: 'online', kind: 'text', list: true, label: 'Online landing zones (internet-facing)', default: 'Webshop', help: 'Names, separated by commas. Empty for none.' },
    { id: 'identity', kind: 'yesno', label: 'Run domain controllers (AD DS) in an identity subscription?', default: true, help: 'For workloads that still need Kerberos or LDAP.' },
    { id: 'sandbox', kind: 'yesno', label: 'Add a Sandbox management group?', default: false, help: 'For experiments, cut off from the corporate network.' },
  ],
  build,
};

function build(a: Answers): string {
  const org = String(a.org) || 'Contoso';
  const vwan = a.network === 'vwan';
  const fw = !!a.firewall;
  const onprem = String(a.onprem);
  const geo = azureGeographies.find((g) => g.value === a.geo) ?? azureGeographies[0]!;
  const regionCount = Number(a.regions);
  const regions = geo.regions.slice(0, regionCount);
  const short = geo.short.slice(0, regionCount);
  const corp = names(a.corp).slice(0, 6);
  const online = names(a.online).slice(0, 6);
  const orgId = slug(org);
  const taken = ['platform', 'landing-zones', 'corp', 'online', 'sandbox', 'connectivity', 'identity', 'management', 'onprem', orgId];
  const corpIds = ids(corp, taken);
  const onlineIds = ids(online, [...taken, ...corpIds]);
  const er = onprem === 'expressroute' || onprem === 'both';
  const vpn = onprem === 'vpn' || onprem === 'both';
  const hubOf = (i: number) => `hub-${short[i % regionCount]}`;
  // Where a spoke's traffic goes in the hub: the firewall, else the hub (or virtual hub) itself.
  const hubEntry = (r: number) => (fw ? `afw-${short[r]}` : vwan ? `router-${short[r]}` : hubOf(r));

  const L: (string | false)[] = [];
  L.push(...comment(`Made by the Azure landing zone wizard (carto new --wizard azure-landing-zone). Follows ${SOURCE}.`));
  L.push(...comment('Management groups hold policy; the platform subscriptions are run by the central team, each landing zone by a workload team.'));
  L.push('type: azure');
  L.push(`title: ${scalar(`${org} Azure landing zone`)}`);
  const sub = [vwan ? 'Virtual WAN' : 'hub and spoke', fw ? 'Azure Firewall' : undefined, regionCount > 1 ? `${regionCount} regions` : regions[0]].filter(Boolean).join(' · ');
  L.push(`subtitle: ${scalar(`Cloud Adoption Framework · ${sub}`)}`);
  L.push('direction: down');
  L.push('');
  L.push('groups:');
  L.push(...comment('The management group hierarchy CAF proposes: an intermediate root under the tenant root group, then Platform and Landing zones.', 2));
  L.push(entry(orgId, { kind: 'management-group', label: org }));
  L.push(entry('platform', { kind: 'management-group', label: 'Platform', in: orgId }));
  L.push(entry('landing-zones', { kind: 'management-group', label: 'Landing zones', in: orgId }));
  if (corp.length) L.push(entry('corp', { kind: 'management-group', label: 'Corp', in: 'landing-zones' }));
  if (online.length) L.push(entry('online', { kind: 'management-group', label: 'Online', in: 'landing-zones' }));
  if (a.sandbox) L.push(entry('sandbox', { kind: 'management-group', label: 'Sandbox', in: orgId }));
  L.push('');
  L.push(...comment('Platform subscriptions: shared networking, identity and the central logs.', 2));
  L.push(entry('connectivity', { kind: 'subscription', label: 'Connectivity', in: 'platform' }));
  if (a.identity) L.push(entry('identity', { kind: 'subscription', label: 'Identity', in: 'platform' }));
  L.push(entry('management', { kind: 'subscription', label: 'Management', in: 'platform' }));
  if (vwan) L.push(...comment(`Virtual WAN (vwan-${orgId}): Microsoft runs the hubs and their routing; you choose what they hold.`, 2));
  regions.forEach((r, i) => {
    const cidr = `10.${i * 64}.0.0/${vwan ? 23 : 22}`;
    L.push(entry(hubOf(i), { kind: 'vnet', label: `${vwan ? 'vhub' : 'vnet-hub'}-${short[i]} · ${cidr}`, caption: vwan ? 'Virtual WAN hub' : undefined, in: 'connectivity' }));
  });
  L.push('');
  if (corp.length || online.length) L.push(...comment('Landing zones: one subscription per workload, each with a spoke network in one of the regions.', 2));
  // A landing zone's spoke network is told in the caption of what runs in it: a group per spoke would
  // double the nesting (management group, subscription, network) and leave the drawing mostly frame.
  const spokes: { id: string; cidr: string; region: number; online: boolean; name: string }[] = [];
  [...corp.map((n, i) => ({ n, id: corpIds[i]!, online: false })), ...online.map((n, i) => ({ n, id: onlineIds[i]!, online: true }))].forEach((z, k) => {
    const region = k % regionCount;
    const nr = Math.floor(k / regionCount) + 1;
    L.push(entry(z.id, { kind: 'subscription', label: z.n, in: z.online ? 'online' : 'corp' }));
    spokes.push({ id: z.id, cidr: `vnet-${z.id}-${short[region]} · 10.${region * 64 + nr}.0.0/16`, region, online: z.online, name: z.n });
  });
  if (onprem !== 'none') L.push(entry('onprem', { kind: 'on-premises', label: 'Data centre' }));
  L.push('');

  L.push('badges: [management]');
  L.push('');
  L.push('nodes:');
  regions.forEach((_, i) => {
    const hub = hubOf(i);
    if (fw) L.push(entry(`afw-${short[i]}`, { kind: 'firewall', label: `afw-${short[i]}`, caption: 'Premium', in: hub }));
    if (er) L.push(entry(`ergw-${short[i]}`, { kind: 'expressroute', label: `ergw-${short[i]}`, in: hub }));
    if (vpn) L.push(entry(`vpngw-${short[i]}`, { kind: 'vpn-gateway', label: `vpngw-${short[i]}`, in: hub }));
    if (vwan && !fw) L.push(entry(`router-${short[i]}`, { kind: 'service', label: 'Hub router', in: hub }));
    if (!vwan && i === 0) L.push(entry('dns', { kind: 'dns', label: 'Private DNS Resolver', caption: 'privatelink zones', in: hub }));
  });
  if (vwan) L.push(entry('dns', { kind: 'dns', label: 'Private DNS zones', caption: 'privatelink', in: 'connectivity' }));
  if (a.identity) L.push(entry('dc', { kind: 'vm', label: 'Domain controllers', caption: `vnet-identity-${short[0]} · 10.0.4.0/24`, in: 'identity' }));
  L.push(entry('logs', { kind: 'log-analytics', label: 'Central logs', caption: 'Log Analytics', in: 'management' }));
  for (const s of spokes) {
    if (s.online) L.push(entry(`agw-${s.id}`, { kind: 'app-gateway', label: `agw-${s.id}`, caption: 'WAF', in: s.id }));
    L.push(entry(`app-${s.id}`, { kind: s.online ? 'app-service' : 'vm', label: `${s.name} workload`, caption: s.cidr, in: s.id }));
  }
  if (a.sandbox) L.push(entry('sandbox-sub', { kind: 'service', label: 'Sandbox subscriptions', caption: 'No peering', in: 'sandbox' }));
  if (online.length) L.push(entry('internet', { kind: 'internet', label: 'Internet' }));
  if (onprem !== 'none') L.push(entry('router', { kind: 'vpn-gateway', label: 'Edge router', caption: 'Customer edge', in: 'onprem' }));
  L.push('');

  L.push('edges:');
  for (const s of spokes) {
    // A spoke peers to its hub (or connects to its virtual hub); with a firewall its routes point at it.
    const first = s === spokes[0];
    L.push(`  - app-${s.id} -> ${hubEntry(s.region)}: ${flow({ label: first ? (vwan ? 'connection' : 'peering') : undefined, style: 'private' })}`);
    if (s.online) {
      L.push(`  - internet -> agw-${s.id}: { label: HTTPS, style: public }`);
      L.push(`  - agw-${s.id} -> app-${s.id}: { style: private }`);
    }
  }
  if (a.identity) L.push(`  - dc -> ${hubEntry(0)}: { style: private }`);
  regions.forEach((_, i) => {
    if (fw && er) L.push(`  - afw-${short[i]} -> ergw-${short[i]}: { style: private }`);
    if (fw && vpn) L.push(`  - afw-${short[i]} -> vpngw-${short[i]}: { style: private }`);
    if (er) L.push(`  - ergw-${short[i]} -> router: { label: ExpressRoute, style: private }`);
    if (vpn) L.push(`  - vpngw-${short[i]} -> router: { label: ${onprem === 'both' ? 'IPsec backup' : 'IPsec'}, style: private }`);
    if (i > 0) L.push(`  - ${hubOf(0)} <-> ${hubOf(i)}: { label: ${vwan ? 'hub to hub' : 'global peering'}, style: private }`);
  });
  // The firewall answers DNS for the spokes and forwards to the resolver (DNS proxy).
  if (fw) L.push(`  - afw-${short[0]} ..> dns: DNS proxy`);
  // Diagnostics to the central workspace, drawn as a badge on the card rather than one more line.
  if (fw) regions.forEach((_, i) => L.push(`  - afw-${short[i]} -> logs: { style: management }`));
  L.push('');

  L.push(...comment('Presenting: carto render --all-steps, or the play button in the editor.'));
  L.push('steps:');
  L.push(`  - title: Management groups`);
  L.push(`    caption: ${scalar(`Policy is assigned to management groups, not to subscriptions: everything under ${org} inherits the guardrails.`)}`);
  L.push(`  - title: Platform`);
  L.push(`    caption: ${scalar('The central team runs connectivity, identity and management; workload teams never change these.')}`);
  L.push(`    focus: platform`);
  if (spokes.length) {
    L.push(`  - title: Landing zones`);
    L.push(`    caption: ${scalar('Each workload gets its own subscription and spoke network, connected to the hub and governed by policy.')}`);
    L.push(`    focus: landing-zones`);
  }
  if (onprem !== 'none' && spokes.some((s) => !s.online)) {
    const s = spokes.find((x) => !x.online)!;
    L.push(`  - title: To the data centre`);
    L.push(`    caption: ${scalar(`Corp traffic leaves through the hub${fw ? ', inspected by the firewall,' : ''} over ${er ? 'ExpressRoute' : 'the VPN'}.`)}`);
    const gw = `${er ? 'ergw' : 'vpngw'}-${short[s.region]}`;
    if (fw) L.push(`    path: app-${s.id} -> afw-${short[s.region]} -> ${gw} -> router`);
    else L.push(`    focus: ${flow([`app-${s.id}`, hubEntry(s.region), gw, 'router'])}`);
  }
  return file(L);
}

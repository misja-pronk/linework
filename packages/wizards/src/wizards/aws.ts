import { names, type Answers, type Wizard } from '../engine.ts';
import { comment, entry, file, flow, ids, scalar, slug } from '../yaml.ts';
import { awsGeographies } from '../regions.ts';

const THREE_TIER = 'AWS Well-Architected Framework and the AWS reference architecture "Web application hosting" (three tiers over several Availability Zones)';
const LANDING_ZONE = 'AWS whitepaper "Organizing Your AWS Environment Using Multiple Accounts" and the AWS Control Tower landing zone (Security OU with Log Archive and Audit)';

export const awsThreeTier: Wizard = {
  id: 'aws-three-tier',
  name: 'AWS three-tier web app',
  type: 'cloud',
  description: 'A web application over two or three Availability Zones: public, application and data tiers in one VPC',
  source: THREE_TIER,
  questions: [
    { id: 'app', kind: 'text', label: 'What is the application called?', default: 'Web shop' },
    { id: 'geo', kind: 'choice', label: 'Where?', default: 'europe', options: awsGeographies.map(({ value, label, help }) => ({ value, label, help })) },
    { id: 'azs', kind: 'number', label: 'How many Availability Zones?', min: 2, max: 3, default: 3, help: 'Two is the minimum for high availability; three survives a zone outage with capacity to spare.' },
    {
      id: 'compute',
      kind: 'choice',
      label: 'What runs the application tier?',
      default: 'ecs',
      options: [
        { value: 'ecs', label: 'ECS on Fargate', help: 'Containers without servers to manage.' },
        { value: 'ec2', label: 'EC2 Auto Scaling', help: 'Virtual machines in an Auto Scaling group.' },
        { value: 'eks', label: 'EKS', help: 'Kubernetes.' },
        { value: 'lambda', label: 'Lambda', help: 'Functions behind the load balancer.' },
      ],
    },
    {
      id: 'database',
      kind: 'choice',
      label: 'Which database?',
      default: 'aurora',
      options: [
        { value: 'aurora', label: 'Aurora', help: 'A writer and readers across the zones.' },
        { value: 'rds', label: 'RDS Multi-AZ', help: 'A primary and a standby.' },
        { value: 'dynamodb', label: 'DynamoDB', help: 'Serverless, outside the VPC, through a gateway endpoint.' },
      ],
    },
    { id: 'cache', kind: 'yesno', label: 'A cache (ElastiCache) in front of the database?', default: false },
    { id: 'cdn', kind: 'yesno', label: 'CloudFront with AWS WAF in front?', default: true },
    { id: 'nat', kind: 'yesno', label: 'NAT gateways for outbound calls from the private subnets?', default: false, help: 'One per zone, so a zone outage does not cut the others off.' },
  ],
  build: buildThreeTier,
};

const computeKind = { ecs: 'ecs', ec2: 'ec2', eks: 'eks', lambda: 'lambda' } as const;
const computeCaption = { ecs: 'Fargate tasks', ec2: 'Auto Scaling group', eks: 'Pods', lambda: 'Function' } as const;

function buildThreeTier(a: Answers): string {
  const app = String(a.app) || 'Web shop';
  const id = slug(app);
  const geo = awsGeographies.find((g) => g.value === a.geo) ?? awsGeographies[0]!;
  const region = geo.regions[0]!;
  const n = Number(a.azs);
  const zones = ['a', 'b', 'c'].slice(0, n);
  const compute = String(a.compute) as keyof typeof computeKind;
  const db = String(a.database);
  const inVpc = db !== 'dynamodb';
  const L: (string | false)[] = [];
  L.push(...comment(`Made by the AWS three-tier wizard (carto new --wizard aws-three-tier). Follows ${THREE_TIER}.`));
  L.push('type: cloud');
  L.push('provider: aws');
  L.push(`title: ${scalar(`${app} on AWS`)}`);
  L.push(`subtitle: ${scalar(`Three tiers over ${n} Availability Zones in ${region}`)}`);
  L.push('direction: down');
  L.push('');
  L.push('groups:');
  L.push(entry('account', { kind: 'account', label: `${id}-prod` }));
  L.push(entry('region', { kind: 'region', region, in: 'account' }));
  L.push(entry('vpc', { kind: 'vpc', label: `vpc-${id}`, cidr: '10.0.0.0/16', in: 'region' }));
  zones.forEach((z, i) => {
    L.push(entry(`az-${z}`, { kind: 'zone', zone: `${region}${z}`, in: 'vpc' }));
    if (a.nat) L.push(entry(`public-${z}`, { kind: 'subnet', tier: 'public', cidr: `10.0.${i}.0/24`, in: `az-${z}` }));
    L.push(entry(`app-${z}`, { kind: 'subnet', tier: 'private', cidr: `10.0.${10 + i}.0/24`, in: `az-${z}` }));
    if (inVpc || a.cache) L.push(entry(`data-${z}`, { kind: 'subnet', tier: 'isolated', cidr: `10.0.${20 + i}.0/24`, in: `az-${z}` }));
  });
  L.push('');
  L.push('nodes:');
  L.push(entry('users', { kind: 'users', label: 'Users' }));
  if (a.cdn) L.push(entry('cdn', { kind: 'cloudfront', label: 'CDN and WAF', caption: 'CloudFront · AWS WAF' }));
  L.push(...comment('One load balancer across the zones (its nodes sit in the public subnets).', 2));
  L.push(entry('alb', { kind: 'alb', label: 'Load balancer', in: 'vpc', tier: 'public', exposure: 'public' }));
  zones.forEach((z) => {
    if (a.nat) L.push(entry(`nat-${z}`, { kind: 'nat-gateway', label: 'NAT gateway', in: `public-${z}` }));
    L.push(entry(`web-${z}`, { kind: computeKind[compute], label: app, caption: computeCaption[compute], in: `app-${z}` }));
  });
  // The writer in the middle zone, so the lines from every zone reach it without crossing.
  const writer = zones[Math.floor((n - 1) / 2)]!;
  if (db === 'aurora') zones.forEach((z) => L.push(entry(`db-${z}`, { kind: 'aurora', label: z === writer ? 'Writer' : 'Reader', caption: 'Aurora', in: `data-${z}` })));
  if (db === 'rds') zones.slice(0, 2).forEach((z, i) => L.push(entry(`db-${z}`, { kind: 'rds', label: i === 0 ? 'Primary' : 'Standby', caption: 'RDS Multi-AZ', in: `data-${z}` })));
  if (db === 'dynamodb') {
    L.push(entry('db', { kind: 'dynamodb', label: `${app} table`, in: 'region' }));
    L.push(entry('endpoint', { kind: 'vpc-endpoint', label: 'Gateway endpoint', in: 'vpc' }));
  }
  if (a.cache) L.push(entry('cache', { kind: 'elasticache', label: 'Cache', caption: 'Replicas in each zone', in: db === 'aurora' ? `data-${writer}` : 'data-a' }));
  if (a.nat) L.push(entry('internet', { kind: 'internet', label: 'Internet' }));
  L.push('');
  L.push('edges:');
  if (a.cdn) {
    L.push(`  - users -> cdn: { label: HTTPS, style: public }`);
    L.push(`  - cdn -> alb: { style: public }`);
  } else L.push(`  - users -> alb: { label: HTTPS, style: public }`);
  zones.forEach((z) => L.push(`  - alb -> web-${z}: { style: private }`));
  const mid = Math.floor((n - 1) / 2);
  zones.forEach((z, i) => {
    if (db === 'aurora') L.push(`  - web-${z} -> db-${writer}: ${flow({ label: i === mid ? 'SQL' : undefined, style: 'private' })}`);
    if (db === 'rds') L.push(`  - web-${z} -> db-a: ${flow({ label: i === mid ? 'SQL' : undefined, style: 'private' })}`);
    if (db === 'dynamodb') L.push(`  - web-${z} -> endpoint: ${flow({ style: 'private' })}`);
    if (a.cache) L.push(`  - web-${z} -> cache: { style: private }`);
    if (a.nat) L.push(`  - web-${z} -> nat-${z}: { style: private }`);
    if (a.nat) L.push(`  - nat-${z} -> internet: { style: public }`);
  });
  if (db === 'dynamodb') L.push(`  - endpoint -> db: { style: private }`);
  if (db === 'aurora') zones.filter((z) => z !== writer).forEach((z, i) => L.push(`  - db-${writer} -> db-${z}: ${flow({ label: i === 0 ? 'replication' : undefined, style: 'data' })}`));
  if (db === 'rds') L.push(`  - db-a -> db-b: { label: synchronous standby, style: data }`);
  L.push('');
  L.push('steps:');
  L.push(`  - title: The request`);
  L.push(`    caption: ${scalar(`A request ${a.cdn ? 'passes CloudFront and WAF, ' : ''}reaches the load balancer and goes to ${app} in one of the zones.`)}`);
  L.push(`    path: ${[a.cdn ? 'users -> cdn -> alb' : 'users -> alb', `web-a`].join(' -> ')}`);
  L.push(`  - title: The data`);
  L.push(`    caption: ${scalar(db === 'dynamodb' ? 'DynamoDB is reached through a gateway endpoint: the traffic never leaves the AWS network.' : db === 'aurora' ? 'Every zone writes to the Aurora writer; the readers replicate it and take over when its zone fails.' : 'RDS keeps a synchronous standby in a second zone and fails over to it.')}`);
  L.push(`    focus: ${flow(db === 'dynamodb' ? ['endpoint', 'db'] : zones.filter((z) => db === 'aurora' || z !== 'c').map((z) => `db-${z}`))}`);
  L.push(`  - title: Zones`);
  L.push(`    caption: ${scalar(`Each zone has the same subnets and copies; losing one zone leaves ${n - 1} serving.`)}`);
  L.push(`    focus: az-b`);
  return file(L);
}

export const awsLandingZone: Wizard = {
  id: 'aws-landing-zone',
  name: 'AWS multi-account landing zone',
  type: 'cloud',
  description: 'AWS Organizations with Control Tower: OUs, the core accounts, workload accounts and the shared network',
  source: LANDING_ZONE,
  questions: [
    { id: 'org', kind: 'text', label: 'What is the organisation called?', default: 'Acme' },
    { id: 'workloads', kind: 'text', list: true, label: 'Which workloads get their own accounts?', default: 'Shop, Payments', help: 'Names, separated by commas (1 to 5).' },
    { id: 'environments', kind: 'yesno', label: 'Separate Prod and Test OUs (an account per workload in each)?', default: true },
    { id: 'infrastructure', kind: 'yesno', label: 'An Infrastructure OU with a central Network account?', default: true, help: 'Transit gateway and central egress, shared with every workload account.' },
    { id: 'inspection', kind: 'yesno', label: 'Inspect traffic with AWS Network Firewall?', default: true, when: (a) => !!a.infrastructure },
    {
      id: 'onprem',
      kind: 'choice',
      label: 'Link to on-premises?',
      default: 'dx',
      when: (a) => !!a.infrastructure,
      options: [
        { value: 'dx', label: 'Direct Connect' },
        { value: 'vpn', label: 'Site-to-site VPN' },
        { value: 'none', label: 'None' },
      ],
    },
    { id: 'sandbox', kind: 'yesno', label: 'A Sandbox OU for experiments?', default: false },
  ],
  build: buildLandingZone,
};

function buildLandingZone(a: Answers): string {
  const org = String(a.org) || 'Acme';
  const work = names(a.workloads).slice(0, 5);
  if (!work.length) work.push('Workload');
  const envs = a.environments ? ['prod', 'test'] : ['prod'];
  const infra = !!a.infrastructure;
  const onprem = infra ? String(a.onprem) : 'none';
  const taken = ['org', 'security', 'infra', 'workloads', 'prod', 'test', 'sandbox', 'management', 'log-archive', 'audit', 'network', 'egress', 'dc'];
  const wid = ids(work, taken);
  // A workload account's VPC is told in the caption of what runs in it: one more group per account would
  // make the organisation twice as wide.
  const cidrs = new Map<string, string>();
  const L: (string | false)[] = [];
  L.push(...comment(`Made by the AWS landing zone wizard (carto new --wizard aws-landing-zone). Follows ${LANDING_ZONE}.`));
  L.push('type: cloud');
  L.push('provider: aws');
  L.push(`title: ${scalar(`${org} AWS landing zone`)}`);
  L.push(`subtitle: ${scalar(['AWS Organizations and Control Tower', `${work.length * envs.length + 3 + (infra ? 1 : 0)} accounts`, infra ? 'shared network' : undefined].filter(Boolean).join(' · '))}`);
  L.push('direction: down');
  L.push('');
  L.push('groups:');
  L.push(entry('org', { kind: 'organization', label: org }));
  L.push(...comment('Control Tower sets up the management account and the Security OU with Log Archive and Audit.', 2));
  L.push(entry('management', { kind: 'account', label: 'Management', in: 'org' }));
  L.push(entry('security', { kind: 'ou', label: 'Security', in: 'org' }));
  L.push(entry('log-archive', { kind: 'account', label: 'Log Archive', in: 'security' }));
  L.push(entry('audit', { kind: 'account', label: 'Audit', in: 'security' }));
  if (infra) {
    L.push(entry('infra', { kind: 'ou', label: 'Infrastructure', in: 'org' }));
    L.push(entry('network', { kind: 'account', label: 'Network', in: 'infra' }));
    if (a.inspection) L.push(entry('egress', { kind: 'vpc', label: 'Inspection and egress', cidr: '10.0.0.0/22', in: 'network' }));
  }
  L.push(entry('workloads', { kind: 'ou', label: 'Workloads', in: 'org' }));
  if (a.environments) {
    L.push(entry('prod', { kind: 'ou', label: 'Prod', in: 'workloads' }));
    L.push(entry('test', { kind: 'ou', label: 'Test', in: 'workloads' }));
  }
  work.forEach((w, i) =>
    envs.forEach((e, k) => {
      const acc = `${wid[i]}-${e}`;
      L.push(entry(acc, { kind: 'account', label: `${wid[i]}-${e}`, in: a.environments ? e : 'workloads' }));
      cidrs.set(acc, `vpc-${wid[i]}-${e} · 10.${(i + 1) * 10 + k}.0.0/16`);
    }),
  );
  if (a.sandbox) L.push(entry('sandbox', { kind: 'ou', label: 'Sandbox', in: 'org' }));
  if (onprem !== 'none') L.push(entry('dc', { kind: 'on-premises', label: 'Data centre', cidr: '172.16.0.0/16' }));
  L.push('');
  L.push('nodes:');
  L.push(entry('tower', { kind: 'control-tower', label: 'Guardrails', caption: 'Control Tower', in: 'management' }));
  L.push(entry('sso', { kind: 'identity-center', label: 'Single sign-on', caption: 'IAM Identity Center', in: 'management' }));
  L.push(entry('logs', { kind: 'cloudtrail', label: 'Central logs', caption: 'CloudTrail and Config', in: 'log-archive' }));
  L.push(entry('findings', { kind: 'security-hub', label: 'Findings', caption: 'Security Hub · GuardDuty', in: 'audit' }));
  if (infra) {
    L.push(entry('tgw', { kind: 'transit-gateway', label: 'Transit gateway', caption: 'Shared with RAM', in: 'network' }));
    if (a.inspection) {
      L.push(entry('inspect', { kind: 'network-firewall', label: 'Inspection', in: 'egress' }));
      L.push(entry('nat', { kind: 'nat-gateway', label: 'Central egress', in: 'egress' }));
    } else L.push(entry('nat', { kind: 'nat-gateway', label: 'Central egress', in: 'network' }));
    if (onprem === 'dx') L.push(entry('dx', { kind: 'direct-connect', label: 'Direct Connect', in: 'network' }));
    if (onprem === 'vpn') L.push(entry('dx', { kind: 'vpn', label: 'Site-to-site VPN', in: 'network' }));
    L.push(entry('internet', { kind: 'internet', label: 'Internet' }));
  }
  work.forEach((w, i) => envs.forEach((e) => L.push(entry(`${wid[i]}-${e}-app`, { kind: 'ecs', label: e === 'prod' ? w : `${w} (test)`, caption: cidrs.get(`${wid[i]}-${e}`), in: `${wid[i]}-${e}` }))));
  if (a.sandbox) L.push(entry('sandbox-accounts', { kind: 'service', label: 'Sandbox accounts', caption: 'Not connected', in: 'sandbox' }));
  if (onprem !== 'none') L.push(entry('core', { kind: 'router', label: 'Core router', in: 'dc' }));
  L.push('');
  L.push('edges:');
  if (infra) {
    work.forEach((_, i) => envs.forEach((e) => L.push(`  - ${wid[i]}-${e}-app -> tgw: ${flow({ label: i === 0 && e === 'prod' ? 'attachment' : undefined, style: 'private' })}`)));
    if (a.inspection) {
      L.push(`  - tgw -> inspect: { label: 0.0.0.0/0, style: private }`);
      L.push(`  - inspect -> nat: { style: private }`);
    } else L.push(`  - tgw -> nat: { label: 0.0.0.0/0, style: private }`);
    L.push(`  - nat -> internet: { style: public }`);
    if (onprem !== 'none') {
      L.push(`  - tgw -> dx: { style: vpn }`);
      L.push(`  - dx -> core: ${flow({ label: onprem === 'dx' ? 'BGP' : 'IPsec', style: 'vpn' })}`);
    }
  }
  L.push('');
  L.push('steps:');
  L.push(`  - title: The organisation`);
  L.push(`    caption: ${scalar('Accounts are the boundary: each workload and environment gets its own, grouped in OUs that carry the guardrails.')}`);
  L.push(`  - title: Security`);
  L.push(`    caption: ${scalar('Every account logs to Log Archive; Audit sees the findings of all of them. Nobody works in these accounts day to day.')}`);
  L.push(`    focus: security`);
  L.push(`  - title: Workloads`);
  L.push(`    caption: ${scalar(a.environments ? 'Prod and Test are separate accounts, under separate OUs with their own policies.' : 'One account per workload.')}`);
  L.push(`    focus: workloads`);
  if (infra) {
    L.push(`  - title: The shared network`);
    L.push(`    caption: ${scalar(`Workload VPCs attach to the transit gateway in the Network account; ${a.inspection ? 'traffic to the internet is inspected and leaves centrally' : 'traffic to the internet leaves centrally'}.`)}`);
    L.push(`    path: ${wid[0]}-prod-app -> tgw -> ${a.inspection ? 'inspect -> ' : ''}nat -> internet`);
  }
  return file(L);
}

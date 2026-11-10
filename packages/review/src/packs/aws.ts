// AWS: the first questions of an AWS Well-Architected review, on a cloud diagram's AWS kinds.
import { t } from '../nl.ts';
import type { Hit, Rule } from '../types.ts';
import type { ReviewModel } from '../model.ts';

const pack = 'aws';
const cloud = ['cloud'];
const AWS = ['ec2', 'ecs', 'eks', 'lambda', 'batch', 'rds', 'aurora', 'dynamodb', 'elasticache', 's3', 'alb', 'nlb', 'api-gateway', 'cloudfront', 'opensearch', 'redshift', 'sqs', 'sns', 'kinesis', 'msk', 'emr', 'glue'];
const WAF = /\bwaf\b/i;

/** A WAF is on it: drawn next to it, tagged, or in its name ("CDN and WAF"). */
function waf(m: ReviewModel, id: string): boolean {
  const e = m.el(id);
  if (!e) return false;
  return m.tagged(id, 'waf') || WAF.test(e.label) || m.said(id, 'waf') === 'true' || m.neighbours(id).some((n) => ['waf', 'network-firewall'].includes(m.el(n)?.kind ?? ''));
}

/** The availability zone something is in: a zone group around it, or zone: on it. */
function zoneOf(m: ReviewModel, id: string): string | undefined {
  const g = m.ancestors(id).find((a) => a.kind === 'zone');
  return g ? g.id : (m.said(id, 'zone') ?? undefined);
}

export const awsRules: Rule[] = [
  {
    id: 'aws.alb-without-waf',
    pack,
    title: 'Internet-facing load balancers have AWS WAF',
    why: 'An internet-facing ALB without a web ACL passes every injection, scan and bot straight to the app.',
    severity: 'warn',
    category: 'security',
    appliesTo: cloud,
    fix: 'Associate an AWS WAF web ACL with the ALB, or put CloudFront with WAF in front and draw the line through it; tags: [waf] or a waf node beside it says so',
    docs: 'AWS WAF with Application Load Balancer and CloudFront',
    check(m) {
      return m
        .ofKind('alb')
        .filter((e) => {
          if (waf(m, e.id)) return false;
          const from = m.in(e.id).filter((l) => !l.badge);
          const outside = from.some((l) => m.outsider(l.from));
          const facing = m.publicSaid(e.id) === true || outside;
          // Reached only through a CloudFront (or anything else) with a WAF on it: covered there.
          return facing && (outside || !from.length || !from.every((l) => waf(m, l.from)));
        })
        .map((e) => ({ on: { kind: 'node', id: e.id }, message: t(m.lang, '{name} is internet-facing and no WAF is on it or in front of it', { name: e.label }) }));
    },
  },
  {
    id: 'aws.rds-single-az',
    pack,
    title: 'Production databases are Multi-AZ',
    why: 'A single-AZ RDS instance is down for the length of a zone outage or a host failure, and its backups restore slowly.',
    severity: 'warn',
    category: 'reliability',
    appliesTo: cloud,
    fix: 'Turn on Multi-AZ (props: { multi-az: true }) or run an Aurora cluster with a replica in another zone, and draw it there',
    docs: 'Amazon RDS Multi-AZ deployments',
    check(m) {
      if (!m.production) return [];
      // Only where zones are drawn (or Multi-AZ is said to be off): a drawing without zones says nothing about them.
      const zones = m.has('zone') || [...m.nodes.keys()].some((id) => m.said(id, 'zone') !== undefined);
      return m
        .ofKind('rds', 'aurora')
        .filter((e) => {
          const multi = m.said(e.id, 'multi-az', 'multiAz', 'multi_az');
          if (multi === 'true') return false;
          if (multi !== 'false' && !zones) return false;
          const z = e.props.zones;
          if ((typeof z === 'number' && z > 1) || (Array.isArray(z) && z.length > 1) || z === 'redundant') return false;
          const here = zoneOf(m, e.id);
          // A replica (a line to another database) in another zone.
          return !m.neighbours(e.id).some((n) => ['rds', 'aurora'].includes(m.el(n)?.kind ?? '') && zoneOf(m, n) !== here);
        })
        .map((e) => ({ on: { kind: 'node', id: e.id }, message: t(m.lang, '{name} runs in one availability zone', { name: e.label }) }));
    },
  },
  {
    id: 'aws.s3-public',
    pack,
    title: 'S3 buckets block public access',
    why: 'A public bucket hands its objects to anyone with the URL; most AWS data leaks are one.',
    severity: 'error',
    category: 'security',
    appliesTo: cloud,
    fix: 'Turn on Block Public Access for the bucket and the account, and serve public files through CloudFront with origin access control; then set public: false',
    docs: 'Amazon S3 Block Public Access',
    check(m) {
      return m
        .ofKind('s3')
        .filter((e) => m.publicSaid(e.id) === true || m.said(e.id, 'block-public-access') === 'false')
        .map((e) => ({ on: { kind: 'node', id: e.id }, message: t(m.lang, '{name} is public', { name: e.label }) }));
    },
  },
  {
    id: 'aws.no-audit-trail',
    pack,
    title: 'Accounts record API calls and metrics',
    why: 'Without CloudTrail and CloudWatch nobody can say who changed what, or see trouble before users do.',
    severity: 'warn',
    category: 'operations',
    appliesTo: cloud,
    fix: 'Draw the CloudTrail trail (organisation-wide) and CloudWatch the workloads report to; tags: [monitoring] on a shared logging account says it is elsewhere',
    docs: 'AWS CloudTrail and Amazon CloudWatch',
    check(m) {
      if (m.ofKind(...AWS).length < 3) return [];
      const seen = m.has('cloudtrail', 'cloudwatch', 'security-hub', 'guardduty', 'config') || [...m.nodes.values(), ...m.groups.values()].some((e) => e.tags.some((t) => /^(monitoring|logging|audit)$/.test(t)));
      return seen ? [] : [{ on: { kind: 'diagram' }, message: t(m.lang, 'No CloudTrail or CloudWatch is drawn'), path: ['title'] }];
    },
  },
  {
    id: 'aws.nat-single-az',
    pack,
    title: 'Each zone has its own NAT gateway',
    why: 'One NAT gateway for private subnets in several zones takes all their outbound traffic down with its zone, and costs cross-zone data.',
    severity: 'warn',
    category: 'reliability',
    appliesTo: cloud,
    fix: 'Run one NAT gateway per availability zone, each in that zone\'s public subnet, and route each private subnet to the one in its zone',
    docs: 'NAT gateways per availability zone',
    check(m) {
      const nats = m.ofKind('nat-gateway');
      if (!nats.length) return [];
      const privateZones = new Set(m.ofKind('subnet').filter((s) => m.said(s.id, 'tier') === 'private').map((s) => zoneOf(m, s.id)).filter((z): z is string => !!z));
      const natZones = new Set(nats.map((n) => zoneOf(m, n.id)).filter((z): z is string => !!z));
      if (privateZones.size < 2 || natZones.size >= privateZones.size) return [];
      const hits: Hit[] = [];
      for (const n of nats) hits.push({ on: { kind: 'node', id: n.id }, message: t(m.lang, 'One NAT gateway serve private subnets in {zones} zones|{count} NAT gateways serve private subnets in {zones} zones', { count: natZones.size, zones: privateZones.size }) });
      return hits.slice(0, 1);
    },
  },
];

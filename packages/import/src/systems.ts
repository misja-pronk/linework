// The common target of flowchart and architecture imports: a `type: systems` diagram. Kinds are
// guessed from words in the label ("Orders DB" is a database) and then from the Mermaid shape.
import { config } from '@cartography/systems';
import { flow, scalar } from './text.ts';

export interface SysGroup {
  id: string;
  label: string;
  kind: string;
  parent?: string;
}

export interface SysNode {
  id: string;
  label: string;
  kind: string;
  parent?: string;
}

export interface SysEdge {
  from: string;
  to: string;
  op: '->' | '<->' | '--';
  label?: string;
  style?: 'sync' | 'async' | 'data' | 'dotted';
}

export interface SysDiagram {
  title?: string;
  direction: 'right' | 'down';
  groups: SysGroup[];
  nodes: SysNode[];
  edges: SysEdge[];
}

// Order matters: the first rule that matches wins, so specific stores come before "service" words
// and servers before web clients ("Web server").
const rules: [string, RegExp][] = [
  ['cache', /\b(cache|caching|redis|memcached?|varnish)\b/],
  ['worker', /\b(workers?|consumers?|processors?|daemon|background)\b/],
  ['queue', /\b(queues?|sqs|rabbit(mq)?|amqp|activemq|mq|nats|celery)\b/],
  ['topic', /\b(kafka|topics?|event ?bus|eventbridge|pub ?\/? ?sub|kinesis|event ?hubs?|streams?|sns|events)\b/],
  ['warehouse', /\b(warehouse|snowflake|bigquery|redshift|data ?lake|lakehouse|databricks|clickhouse|olap)\b/],
  ['database', /\b(db|dbs|database|databases|postgres(ql)?|mysql|mariadb|sql|mongo(db)?|dynamo(db)?|cassandra|cockroach(db)?|sqlite|oracle|rds|aurora|firestore|cosmos( ?db)?|datastore|neo4j|couch(db)?|spanner|supabase)\b/],
  ['search', /\b(search|elastic(search)?|opensearch|solr|algolia|meili(search)?)\b/],
  ['storage', /\b(s3|buckets?|blobs?|object ?stor(e|age)|storage|files?|file ?system|gcs|nfs|disk|minio|uploads)\b/],
  ['cdn', /\b(cdn|cloudfront|akamai|fastly|cloudflare)\b/],
  ['load-balancer', /\b(load ?balanc(er|ing)|lb|alb|elb|nlb|haproxy)\b/],
  ['gateway', /\b(gateway|api ?gw|proxy|ingress|nginx|envoy|kong|traefik|apim|bff)\b/],
  ['dns', /\b(dns|route ?53)\b/],
  ['firewall', /\b(firewall|waf)\b/],
  ['identity', /\b(auth|authn|authz|authentication|authori[sz]ation|identity|idp|sso|oauth2?|oidc|keycloak|auth0|okta|cognito|login|entra|ldap|active directory)\b/],
  ['api', /\b(apis?|rest|graphql|grpc|endpoints?)\b/],
  ['secrets', /\b(vault|secrets?|kms|key ?vault)\b/],
  ['monitoring', /\b(monitor(ing)?|metrics|logs?|logging|grafana|prometheus|datadog|observability|tracing|sentry|splunk|alert(s|ing)?|telemetry)\b/],
  ['email', /\b(e-?mail|smtp|sendgrid|mailgun|ses|mailer|postmark|envelope)\b/],
  ['payments', /\b(payments?|stripe|paypal|adyen|psp|braintree|mollie|credit card)\b/],
  ['ai', /\b(llm|gpt|openai|claude|anthropic|ml|machine learning|inference|embeddings?|ai)\b/],
  ['function', /\b(lambdas?|functions?|serverless)\b/],
  ['job', /\b(cron|scheduler|scheduled|batch|nightly|etl|jobs?)\b/],
  ['container', /\b(containers?|docker|pods?)\b/],
  ['server', /\b(servers?|vms?|ec2|hosts?|machines?|instances?|bare metal)\b/],
  ['mobile', /\b(mobile|ios|android|phone|react native|flutter)\b/],
  ['desktop', /\b(desktop|electron)\b/],
  ['device', /\b(iot|devices?|sensors?|meters?|thermostats?)\b/],
  ['client', /\b(browser|frontend|front-end|web ?app|webapp|spa|ui|web client|website|portal|dashboards?|web|desktop|globe)\b/],
  ['external', /\b(external|third[- ]party|3rd party|partners?|vendors?|saas|legacy|upstream|internet|github|slack|twilio|salesforce)\b/],
];

const PEOPLE = /\b(users?|customers?|people|persons?|actors?|visitors?|shoppers?|admins?|administrators?|operators?|guests?|members?|employees?|developers?|buyers?|sellers?|patients?|students?|clients?|staff|agents?)\b/;
const SERVICE_WORDS = /\b(service|services|svc|api|db|database|store|portal|app|application|management|server|manager|registry|directory|profile|data)\b/;
const PLURAL_PEOPLE = /\b(users|customers|people|persons|actors|visitors|shoppers|admins|operators|guests|members|employees|developers|buyers|sellers|patients|students|clients|staff|agents)\b/;

/** A systems kind for a label (and an icon or shape hint), or undefined when nothing fits. */
export function guessKind(text: string): string | undefined {
  const t = text.toLowerCase().replace(/[_]/g, ' ');
  // "Users" is a person; "User service" and "User DB" are not.
  if (PEOPLE.test(t) && !SERVICE_WORDS.test(t) && !rules.slice(0, 6).some(([, r]) => r.test(t))) return PLURAL_PEOPLE.test(t) ? 'users' : 'user';
  return rules.find(([, r]) => r.test(t))?.[0];
}

export function guessGroupKind(text: string, nested: boolean): string {
  const t = text.toLowerCase();
  if (/\b(aws|azure|gcp|google cloud|cloud)\b/.test(t)) return 'cloud';
  if (/\b(clusters?|k8s|kubernetes|eks|aks|gke|namespace)\b/.test(t)) return 'cluster';
  if (/\b(regions?)\b|\b(eu|us|ap)-[a-z]+-\d\b/.test(t)) return 'region';
  if (/\b(on-?prem(ises)?|data ?cent(er|re)s?|office)\b/.test(t)) return 'on-premises';
  if (/\b(vpc|vnet|subnets?|networks?|dmz|zones?|private|public|internal|tier|edge)\b/.test(t)) return 'zone';
  if (/\b(teams?|squads?|owners?)\b/.test(t)) return 'team';
  if (/\b(domains?|context|layers?)\b/.test(t)) return 'domain';
  if (/\b(external|third[- ]party|partners?|vendors?)\b/.test(t)) return 'boundary';
  return nested ? 'boundary' : 'system';
}

// Labels the systems type shows when an entry has no label of its own: leave those out.
const kindLabels = Object.fromEntries(Object.entries(config.nodeKinds).map(([k, v]) => [k, v.label]));
const groupLabels = Object.fromEntries(Object.entries(config.groupKinds).map(([k, v]) => [k, v.label]));

export function systemsYaml(d: SysDiagram): string {
  const out: string[] = ['type: systems'];
  if (d.title) out.push(`title: ${scalar(d.title)}`);
  if (d.direction === 'down') out.push('direction: down');
  const entry = (id: string, kind: string, label: string | undefined, parent: string | undefined, known: Record<string, string>) => {
    const l = label === known[kind] || label === undefined ? undefined : label;
    return l === undefined && parent === undefined ? `  ${id}: ${kind}` : `  ${id}: ${flow([['kind', kind], ['label', l], ['in', parent]])}`;
  };
  if (d.groups.length) {
    out.push('', 'groups:');
    for (const g of d.groups) out.push(entry(g.id, g.kind, g.label, g.parent, groupLabels));
  }
  if (d.nodes.length) {
    out.push('', 'nodes:');
    for (const n of d.nodes) out.push(entry(n.id, n.kind, n.label, n.parent, kindLabels));
  }
  if (d.edges.length) {
    out.push('', 'edges:');
    for (const e of d.edges) {
      const arrow = `${e.from} ${e.op} ${e.to}`;
      if (e.style) out.push(`  - ${arrow}: ${flow([['label', e.label], ['style', e.style]])}`);
      else if (e.label) out.push(`  - ${arrow}: ${scalar(e.label)}`);
      else out.push(`  - ${arrow}`);
    }
  }
  return out.join('\n') + '\n';
}

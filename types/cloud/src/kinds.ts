// The kinds of a cloud diagram: containers shared by the providers (organization, region, VPC, subnet,
// zone), each provider's own (account and OU, folder and project) and the services people draw most.
// Icons are generic Lucide line icons; `names` are the words of the official icon file names, so
// `carto icons import <download> --pack aws|gcp` finds the vendor's own icon for each kind. The files
// themselves are never in this repo.
import type { GraphGroup, Tone } from '@cartography/core';

export type Provider = 'aws' | 'gcp' | 'azure';
export const providers: Provider[] = ['aws', 'gcp', 'azure'];
export const providerNames: Record<Provider, string> = { aws: 'AWS', gcp: 'Google Cloud', azure: 'Azure' };

export type Category =
  | 'compute'
  | 'containers'
  | 'serverless'
  | 'storage'
  | 'database'
  | 'analytics'
  | 'integration'
  | 'network'
  | 'security'
  | 'observability'
  | 'ai'
  | 'devops'
  | 'general';

/** One tone per category, so a drawing reads by colour: data stores indigo, networking sky, security rose. */
export const categoryTone: Record<Category, Tone> = {
  compute: 'blue',
  containers: 'blue',
  serverless: 'amber',
  storage: 'teal',
  database: 'indigo',
  analytics: 'violet',
  integration: 'orange',
  network: 'sky',
  security: 'rose',
  observability: 'green',
  ai: 'violet',
  devops: 'slate',
  general: 'slate',
};

export interface CloudKind {
  label: string;
  icon: string;
  tone: Tone;
  category: Category;
  /** The provider whose product this is; none for kinds every cloud has (a region, a user). */
  provider?: Provider;
  /** Official product names as they appear in the vendor's icon file names. */
  names?: string[];
  keywords?: string[];
  /** Lives in one zone: drawn outside any zone while the diagram has zones, it gets a warning. */
  zonal?: boolean;
  quiet?: boolean;
  border?: GraphGroup['border'];
}

type Row = [kind: string, label: string, icon: string, names?: string[], keywords?: string[], extra?: Partial<CloudKind>];

const table = (provider: Provider | undefined, category: Category, rows: Row[]): Record<string, CloudKind> =>
  Object.fromEntries(
    rows.map(([kind, label, icon, names, keywords, extra]) => [
      kind,
      {
        label,
        icon,
        tone: categoryTone[category],
        category,
        ...(provider ? { provider } : {}),
        ...(names?.length ? { names } : {}),
        ...(keywords?.length ? { keywords } : {}),
        ...extra,
      },
    ]),
  );

// ---------------------------------------------------------------- containers

/** Groups every provider has; the caption follows the provider (see `sharedLabels`). */
export const sharedGroups: Record<string, CloudKind> = {
  organization: { label: 'Organization', icon: 'building-complex', tone: 'slate', category: 'general', names: ['organizations', 'organization'], keywords: ['org', 'root'] },
  region: { label: 'Region', icon: 'earth', tone: 'slate', category: 'general', border: 'dashed', names: ['region'] },
  vpc: { label: 'VPC', icon: 'waypoints', tone: 'sky', category: 'network', names: ['virtual private cloud vpc', 'virtual private cloud'], keywords: ['network', 'virtual private cloud'] },
  zone: { label: 'Availability zone', icon: 'map-pin', tone: 'slate', category: 'general', border: 'dashed', keywords: ['az', 'zone'] },
  subnet: { label: 'Subnet', icon: 'square-dashed', tone: 'sky', category: 'network', border: 'dashed', names: ['private subnet'], keywords: ['public', 'private', 'isolated', 'tier'] },
  'on-premises': { label: 'On-premises', icon: 'building', tone: 'slate', category: 'general', names: ['corporate data center'], keywords: ['data centre', 'datacenter', 'office', 'hybrid'] },
  boundary: { label: 'Boundary', icon: 'square-dashed', tone: 'slate', category: 'general', border: 'dashed', quiet: true, keywords: ['group', 'layer'] },
};

export const awsGroups: Record<string, CloudKind> = table('aws', 'general', [
  ['aws', 'AWS Cloud', 'cloud', ['aws cloud', 'cloud logo'], ['amazon web services']],
  ['ou', 'Organizational unit', 'layers', ['organizations organizational unit', 'organizational unit'], ['ou']],
  ['account', 'Account', 'folder-key', ['account'], ['aws account'], { tone: 'amber' }],
  ['security-group', 'Security group', 'shield-check', ['security group'], ['sg', 'firewall'], { tone: 'rose', border: 'dashed' }],
  ['auto-scaling-group', 'Auto Scaling group', 'scaling', ['auto scaling group', 'ec2 auto scaling'], ['asg'], { tone: 'blue', border: 'dashed' }],
  ['ecs-cluster', 'ECS cluster', 'boxes', [], ['containers', 'fargate'], { tone: 'blue' }],
  ['eks-cluster', 'EKS cluster', 'ship-wheel', [], ['kubernetes'], { tone: 'blue' }],
]);

export const gcpGroups: Record<string, CloudKind> = table('gcp', 'general', [
  ['gcp', 'Google Cloud', 'cloud', ['google cloud', 'cloud logo'], ['gcp', 'google cloud platform']],
  ['folder', 'Folder', 'folder', ['folder'], ['resource hierarchy']],
  ['project', 'Project', 'folder-key', ['project'], ['gcp project'], { tone: 'amber' }],
  ['instance-group', 'Managed instance group', 'scaling', ['instance group'], ['mig', 'autoscaling'], { tone: 'blue', border: 'dashed' }],
  ['gke-cluster', 'GKE cluster', 'ship-wheel', [], ['kubernetes'], { tone: 'blue' }],
  ['service-perimeter', 'Service perimeter', 'shield-check', ['vpc service controls'], ['vpc-sc', 'vpc service controls'], { tone: 'rose', border: 'dashed' }],
]);

/** What a shared container is called by each provider, where it differs from the kind's own label. */
export const sharedLabels: Record<string, Partial<Record<Provider, string>>> = {
  vpc: { gcp: 'VPC network', azure: 'Virtual network' },
  zone: { gcp: 'Zone' },
};

// ---------------------------------------------------------------- AWS

export const awsNodes: Record<string, CloudKind> = {
  ...table('aws', 'compute', [
    ['ec2', 'EC2 instance', 'server', ['ec2'], ['vm', 'virtual machine', 'server'], { zonal: true }],
    ['batch', 'Batch', 'list-checks', ['batch'], ['jobs']],
  ]),
  ...table('aws', 'containers', [
    ['ecs', 'ECS service', 'container', ['elastic container service'], ['fargate', 'containers', 'task']],
    ['eks', 'EKS', 'ship-wheel', ['elastic kubernetes service'], ['kubernetes', 'k8s']],
    ['ecr', 'ECR registry', 'package', ['elastic container registry'], ['images', 'registry']],
  ]),
  ...table('aws', 'serverless', [
    ['lambda', 'Lambda function', 'square-function', ['lambda'], ['serverless', 'function']],
    ['step-functions', 'Step Functions', 'workflow', ['step functions'], ['state machine', 'orchestration']],
  ]),
  ...table('aws', 'storage', [
    ['s3', 'S3 bucket', 'archive', ['simple storage service'], ['bucket', 'object storage', 'data lake']],
    ['ebs', 'EBS volume', 'hard-drive', ['elastic block store'], ['disk'], { zonal: true }],
    ['efs', 'EFS file system', 'folder', ['efs', 'elastic file system'], ['nfs', 'file share']],
  ]),
  ...table('aws', 'database', [
    ['rds', 'RDS database', 'database', ['rds'], ['postgres', 'mysql', 'sql', 'relational']],
    ['aurora', 'Aurora cluster', 'database', ['aurora'], ['postgres', 'mysql', 'sql']],
    ['dynamodb', 'DynamoDB table', 'table-2', ['dynamodb', 'dynamo db'], ['nosql', 'key-value']],
    ['elasticache', 'ElastiCache', 'database-zap', ['elasticache', 'elasti cache'], ['redis', 'valkey', 'cache']],
    ['opensearch', 'OpenSearch', 'search', ['opensearch service', 'open search service'], ['elasticsearch', 'search']],
  ]),
  ...table('aws', 'analytics', [
    ['redshift', 'Redshift', 'warehouse', ['redshift'], ['data warehouse', 'dwh']],
    ['glue', 'Glue', 'workflow', ['glue'], ['etl', 'crawler', 'data catalog']],
    ['athena', 'Athena', 'terminal', ['athena'], ['sql', 'query']],
    ['kinesis', 'Kinesis Data Streams', 'radio-tower', ['kinesis data streams', 'kinesis'], ['streaming', 'events']],
    ['firehose', 'Data Firehose', 'arrow-right-to-line', ['data firehose', 'kinesis data firehose', 'kinesis firehose'], ['delivery stream', 'ingest']],
    ['msk', 'MSK (Kafka)', 'radio', ['managed streaming for apache kafka'], ['kafka', 'streaming']],
    ['emr', 'EMR cluster', 'cpu', ['emr'], ['spark', 'hadoop']],
    ['lake-formation', 'Lake Formation', 'layers', ['lake formation'], ['data lake', 'governance', 'permissions']],
    ['quicksight', 'QuickSight', 'chart-column-big', ['quicksight', 'quick sight'], ['bi', 'dashboards', 'reporting']],
    ['dms', 'Database Migration Service', 'arrow-left-right', ['database migration service'], ['cdc', 'replication']],
    ['mwaa', 'Managed Airflow', 'calendar-clock', ['managed workflows for apache airflow'], ['airflow', 'orchestration', 'mwaa']],
  ]),
  ...table('aws', 'integration', [
    ['sqs', 'SQS queue', 'send', ['simple queue service'], ['queue', 'messaging']],
    ['sns', 'SNS topic', 'bell', ['simple notification service'], ['topic', 'pub/sub', 'notifications']],
    ['eventbridge', 'EventBridge', 'zap', ['eventbridge', 'event bridge'], ['event bus', 'events', 'schedule']],
    ['api-gateway', 'API Gateway', 'webhook', ['api gateway'], ['rest', 'http api']],
  ]),
  ...table('aws', 'network', [
    ['cloudfront', 'CloudFront', 'globe', ['cloudfront', 'cloud front'], ['cdn', 'edge']],
    ['route53', 'Route 53', 'signpost', ['route 53'], ['dns', 'hosted zone']],
    ['alb', 'Application Load Balancer', 'split', ['elastic load balancing application load balancer', 'application load balancer'], ['load balancer', 'elb', 'https']],
    ['nlb', 'Network Load Balancer', 'scale', ['elastic load balancing network load balancer', 'network load balancer'], ['load balancer', 'elb', 'tcp']],
    ['internet-gateway', 'Internet gateway', 'door-open', ['vpc internet gateway', 'internet gateway'], ['igw']],
    ['nat-gateway', 'NAT gateway', 'arrow-down-up', ['vpc nat gateway', 'nat gateway'], ['egress', 'nat'], { zonal: true }],
    ['transit-gateway', 'Transit Gateway', 'router', ['transit gateway'], ['tgw', 'hub', 'routing']],
    ['direct-connect', 'Direct Connect', 'cable', ['direct connect'], ['dx', 'private circuit', 'hybrid']],
    ['vpn', 'Site-to-Site VPN', 'lock-keyhole', ['site to site vpn'], ['ipsec', 'vpn gateway', 'hybrid']],
    ['vpc-endpoint', 'VPC endpoint', 'plug-zap', ['vpc endpoints', 'privatelink', 'private link'], ['privatelink', 'private endpoint', 'interface endpoint', 'gateway endpoint']],
    ['network-firewall', 'Network Firewall', 'brick-wall-fire', ['network firewall'], ['inspection', 'firewall']],
  ]),
  ...table('aws', 'security', [
    ['iam-role', 'IAM role', 'id-card', ['identity access management role'], ['role', 'permissions', 'assume role']],
    ['iam', 'IAM', 'shield-user', ['identity and access management'], ['policies', 'users', 'permissions']],
    ['identity-center', 'IAM Identity Center', 'fingerprint-pattern', ['iam identity center'], ['sso', 'single sign-on']],
    ['cognito', 'Cognito user pool', 'user-round', ['cognito'], ['sign-in', 'customer identity']],
    ['kms', 'KMS key', 'key-round', ['key management service'], ['encryption', 'cmk']],
    ['secrets-manager', 'Secrets Manager', 'lock', ['secrets manager'], ['secrets', 'passwords']],
    ['waf', 'WAF', 'brick-wall-shield', ['waf'], ['web application firewall']],
    ['acm', 'Certificate Manager', 'badge-check', ['certificate manager'], ['tls', 'certificates']],
    ['guardduty', 'GuardDuty', 'radar', ['guardduty', 'guard duty'], ['threat detection']],
    ['security-hub', 'Security Hub', 'shield-check', ['security hub'], ['findings', 'posture']],
  ]),
  ...table('aws', 'observability', [
    ['cloudwatch', 'CloudWatch', 'activity', ['cloudwatch', 'cloud watch'], ['metrics', 'logs', 'alarms', 'monitoring']],
    ['cloudtrail', 'CloudTrail', 'scroll-text', ['cloudtrail', 'cloud trail'], ['audit', 'api log']],
    ['config', 'AWS Config', 'file-sliders', ['config'], ['compliance', 'rules']],
    ['systems-manager', 'Systems Manager', 'cog', ['systems manager'], ['ssm', 'parameter store', 'patching']],
    ['control-tower', 'Control Tower', 'landmark', ['control tower'], ['landing zone', 'guardrails']],
  ]),
  ...table('aws', 'ai', [
    ['bedrock', 'Bedrock', 'sparkles', ['bedrock'], ['llm', 'foundation models', 'genai']],
    ['sagemaker', 'SageMaker', 'brain', ['sagemaker', 'sage maker', 'sage maker ai'], ['ml', 'training', 'inference']],
  ]),
  ...table('aws', 'devops', [['codepipeline', 'CodePipeline', 'git-merge', ['codepipeline', 'code pipeline'], ['ci/cd', 'deploy']]]),
};

// ---------------------------------------------------------------- Google Cloud

export const gcpNodes: Record<string, CloudKind> = {
  ...table('gcp', 'compute', [
    ['compute-engine', 'Compute Engine VM', 'server', ['compute engine'], ['vm', 'virtual machine', 'gce'], { zonal: true }],
    ['app-engine', 'App Engine', 'app-window', ['app engine'], ['paas', 'web']],
  ]),
  ...table('gcp', 'containers', [
    ['gke', 'GKE', 'ship-wheel', ['google kubernetes engine', 'kubernetes engine', 'gke'], ['kubernetes', 'k8s']],
    ['cloud-run', 'Cloud Run service', 'container', ['cloud run'], ['containers', 'serverless']],
    ['artifact-registry', 'Artifact Registry', 'package', ['artifact registry'], ['images', 'registry']],
  ]),
  ...table('gcp', 'serverless', [
    ['cloud-functions', 'Cloud Function', 'square-function', ['cloud functions', 'cloud run functions'], ['serverless', 'function']],
    ['workflows', 'Workflows', 'workflow', ['workflows'], ['orchestration']],
    ['cloud-scheduler', 'Cloud Scheduler', 'clock', ['cloud scheduler'], ['cron', 'schedule']],
    ['cloud-tasks', 'Cloud Tasks', 'list-checks', ['cloud tasks'], ['queue', 'async']],
  ]),
  ...table('gcp', 'storage', [
    ['gcs', 'Cloud Storage bucket', 'archive', ['cloud storage'], ['bucket', 'object storage', 'data lake']],
    ['persistent-disk', 'Persistent Disk', 'hard-drive', ['persistent disk'], ['disk'], { zonal: true }],
    ['filestore', 'Filestore', 'folder', ['filestore'], ['nfs', 'file share']],
  ]),
  ...table('gcp', 'database', [
    ['cloud-sql', 'Cloud SQL', 'database', ['cloud sql'], ['postgres', 'mysql', 'sql', 'relational']],
    ['alloydb', 'AlloyDB', 'database', ['alloydb', 'alloy db'], ['postgres']],
    ['spanner', 'Spanner', 'orbit', ['cloud spanner', 'spanner'], ['global', 'sql']],
    ['firestore', 'Firestore', 'file-braces', ['firestore'], ['nosql', 'documents']],
    ['bigtable', 'Bigtable', 'table-2', ['bigtable', 'cloud bigtable'], ['nosql', 'wide column']],
    ['memorystore', 'Memorystore', 'database-zap', ['memorystore'], ['redis', 'valkey', 'cache']],
  ]),
  ...table('gcp', 'analytics', [
    ['bigquery', 'BigQuery', 'warehouse', ['bigquery', 'big query'], ['data warehouse', 'dwh', 'sql', 'lakehouse']],
    ['dataflow', 'Dataflow', 'route', ['dataflow'], ['beam', 'streaming', 'etl']],
    ['dataproc', 'Dataproc cluster', 'cpu', ['dataproc'], ['spark', 'hadoop']],
    ['composer', 'Cloud Composer', 'calendar-clock', ['cloud composer'], ['airflow', 'orchestration']],
    ['dataplex', 'Dataplex', 'layers', ['dataplex', 'dataplex universal catalog'], ['catalog', 'governance', 'data mesh']],
    ['datastream', 'Datastream', 'arrow-left-right', ['datastream'], ['cdc', 'replication']],
    ['dataform', 'Dataform', 'file-code', ['dataform'], ['sql', 'transformations', 'dbt']],
    ['looker', 'Looker', 'chart-column-big', ['looker'], ['bi', 'dashboards', 'reporting']],
  ]),
  ...table('gcp', 'integration', [
    ['pubsub', 'Pub/Sub topic', 'radio-tower', ['pubsub', 'pub sub'], ['topic', 'queue', 'messaging', 'events']],
    ['eventarc', 'Eventarc', 'zap', ['eventarc'], ['events', 'triggers']],
    ['apigee', 'Apigee', 'webhook', ['apigee', 'apigee api platform'], ['api management', 'api gateway']],
    ['cloud-api-gateway', 'Cloud API Gateway', 'webhook', ['api gateway'], ['rest', 'openapi']],
  ]),
  ...table('gcp', 'network', [
    ['cloud-load-balancing', 'Cloud Load Balancing', 'split', ['cloud load balancing'], ['load balancer', 'https', 'glb']],
    ['cloud-cdn', 'Cloud CDN', 'globe', ['cloud cdn'], ['cdn', 'edge']],
    ['cloud-dns', 'Cloud DNS', 'signpost', ['cloud dns'], ['dns', 'zone']],
    ['cloud-nat', 'Cloud NAT', 'arrow-down-up', ['cloud nat'], ['egress', 'nat']],
    ['cloud-router', 'Cloud Router', 'router', ['cloud router'], ['bgp', 'routing']],
    ['cloud-vpn', 'Cloud VPN', 'lock-keyhole', ['cloud vpn'], ['ipsec', 'ha vpn', 'hybrid']],
    ['interconnect', 'Cloud Interconnect', 'cable', ['cloud interconnect'], ['dedicated', 'partner', 'private circuit', 'hybrid']],
    ['private-service-connect', 'Private Service Connect', 'plug-zap', ['private service connect'], ['psc', 'private endpoint']],
    ['cloud-firewall', 'Firewall rules', 'brick-wall-fire', ['cloud firewall', 'cloud firewall rules', 'cloud ngfw'], ['firewall', 'ngfw']],
  ]),
  ...table('gcp', 'security', [
    ['service-account', 'Service account', 'id-card', ['service account'], ['workload identity', 'permissions']],
    ['cloud-iam', 'Cloud IAM', 'shield-user', ['identity and access management'], ['policies', 'roles', 'permissions']],
    ['iap', 'Identity-Aware Proxy', 'fingerprint-pattern', ['identity aware proxy'], ['zero trust', 'beyondcorp']],
    ['identity-platform', 'Identity Platform', 'user-round', ['identity platform'], ['sign-in', 'customer identity']],
    ['cloud-kms', 'Cloud KMS key', 'key-round', ['key management service', 'cloud key management'], ['encryption', 'cmek']],
    ['secret-manager', 'Secret Manager', 'lock', ['secret manager'], ['secrets', 'passwords']],
    ['cloud-armor', 'Cloud Armor', 'brick-wall-shield', ['cloud armor'], ['waf', 'ddos']],
    ['security-command-center', 'Security Command Center', 'radar', ['security command center'], ['findings', 'posture', 'threat detection']],
  ]),
  ...table('gcp', 'observability', [
    ['cloud-logging', 'Cloud Logging', 'scroll-text', ['cloud logging'], ['logs', 'audit']],
    ['cloud-monitoring', 'Cloud Monitoring', 'activity', ['cloud monitoring'], ['metrics', 'alerts']],
  ]),
  ...table('gcp', 'ai', [['vertex-ai', 'Vertex AI', 'sparkles', ['vertex ai', 'vertexai'], ['ml', 'gemini', 'llm', 'genai']]]),
  ...table('gcp', 'devops', [['cloud-build', 'Cloud Build', 'git-merge', ['cloud build'], ['ci/cd', 'deploy']]]),
};

// ---------------------------------------------------------------- every cloud

export const generalNodes: Record<string, CloudKind> = table(undefined, 'general', [
  ['users', 'Users', 'users', ['users'], ['people', 'customers']],
  ['user', 'User', 'user', ['user'], ['person']],
  ['client', 'Client app', 'laptop', [], ['browser', 'mobile', 'web']],
  ['internet', 'Internet', 'cloud', ['internet'], ['public']],
  ['external', 'External system', 'earth', [], ['saas', 'third party', 'partner']],
  ['server', 'Server', 'server', ['traditional server'], ['on-premises', 'host']],
  ['datastore', 'Database', 'database', [], ['on-premises', 'legacy']],
  ['router', 'Router', 'router', ['customer gateway'], ['on-premises', 'edge', 'customer gateway', 'bgp']],
  ['service', 'Service', 'box', [], ['generic', 'other']],
]);

/** Per category and provider, for the docs and the report: how many kinds the type knows. */
export function countKinds(): Record<string, Partial<Record<Provider, number>>> {
  const out: Record<string, Partial<Record<Provider, number>>> = {};
  for (const k of [...Object.values(awsNodes), ...Object.values(gcpNodes)]) {
    const row = (out[k.category] ??= {});
    row[k.provider!] = (row[k.provider!] ?? 0) + 1;
  }
  return out;
}

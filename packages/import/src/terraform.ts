// Terraform → cloud diagram. Reads the JSON of `terraform show -json` (a state or a saved plan) for
// AWS and Google Cloud: VPCs, subnets and zones become containers, the common services become
// nodes in the right one, and lines follow what refers to what. Text in, YAML out: no cloud API,
// no credentials, nothing but names, ranges and sizes is copied (no secrets, no tags).
//
// Ids come from resource addresses (aws_lb.web → web), so a re-import after a change keeps the
// ids of everything that stayed, and with them the pins of a hand-arranged layout.
import type { Imported } from './index.ts';
import { scalar, slug, Warnings } from './text.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The JSON of `terraform show -json`: a state (values) or a plan (planned_values). */
export function isTerraform(text: string): boolean {
  if (!/"format_version"/.test(text.slice(0, 4000))) return false;
  try {
    const o = JSON.parse(text) as Obj;
    return isObj(o) && (isObj(o.values) || isObj(o.planned_values) || Array.isArray(o.resource_changes) || 'terraform_version' in o);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- what is drawn

/** Containers: networks and subnets. */
const containers: Record<string, 'vpc' | 'subnet'> = {
  aws_vpc: 'vpc',
  aws_default_vpc: 'vpc',
  aws_subnet: 'subnet',
  aws_default_subnet: 'subnet',
  google_compute_network: 'vpc',
  google_compute_subnetwork: 'subnet',
};

/** Resource type → kind of the cloud type; a second word is a caption that says what it really is. */
const nodes: Record<string, string | [kind: string, caption: string]> = {
  // AWS
  aws_instance: 'ec2',
  aws_autoscaling_group: ['ec2', 'Auto Scaling group'],
  aws_batch_compute_environment: 'batch',
  aws_ecs_service: 'ecs',
  aws_eks_cluster: 'eks',
  aws_ecr_repository: 'ecr',
  aws_lambda_function: 'lambda',
  aws_sfn_state_machine: 'step-functions',
  aws_s3_bucket: 's3',
  aws_efs_file_system: 'efs',
  aws_ebs_volume: 'ebs',
  aws_db_instance: 'rds',
  aws_rds_cluster: 'aurora',
  aws_dynamodb_table: 'dynamodb',
  aws_elasticache_cluster: 'elasticache',
  aws_elasticache_replication_group: 'elasticache',
  aws_opensearch_domain: 'opensearch',
  aws_elasticsearch_domain: 'opensearch',
  aws_redshift_cluster: 'redshift',
  aws_redshiftserverless_workgroup: 'redshift',
  aws_glue_job: 'glue',
  aws_glue_crawler: ['glue', 'Glue crawler'],
  aws_athena_workgroup: 'athena',
  aws_kinesis_stream: 'kinesis',
  aws_kinesis_firehose_delivery_stream: 'firehose',
  aws_msk_cluster: 'msk',
  aws_emr_cluster: 'emr',
  aws_dms_replication_instance: 'dms',
  aws_mwaa_environment: 'mwaa',
  aws_sqs_queue: 'sqs',
  aws_sns_topic: 'sns',
  aws_cloudwatch_event_bus: 'eventbridge',
  aws_cloudwatch_event_rule: ['eventbridge', 'EventBridge rule'],
  aws_api_gateway_rest_api: 'api-gateway',
  aws_apigatewayv2_api: 'api-gateway',
  aws_cloudfront_distribution: 'cloudfront',
  aws_route53_zone: 'route53',
  aws_lb: 'alb',
  aws_alb: 'alb',
  aws_elb: ['alb', 'Classic Load Balancer'],
  aws_internet_gateway: 'internet-gateway',
  aws_nat_gateway: 'nat-gateway',
  aws_ec2_transit_gateway: 'transit-gateway',
  aws_dx_connection: 'direct-connect',
  aws_dx_gateway: 'direct-connect',
  aws_vpn_connection: 'vpn',
  aws_vpn_gateway: 'vpn',
  aws_vpc_endpoint: 'vpc-endpoint',
  aws_networkfirewall_firewall: 'network-firewall',
  aws_cognito_user_pool: 'cognito',
  aws_secretsmanager_secret: 'secrets-manager',
  aws_wafv2_web_acl: 'waf',
  aws_guardduty_detector: 'guardduty',
  aws_cloudtrail: 'cloudtrail',
  aws_sagemaker_endpoint: 'sagemaker',
  aws_codepipeline: 'codepipeline',
  // Google Cloud
  google_compute_instance: 'compute-engine',
  google_compute_instance_group_manager: ['compute-engine', 'Managed instance group'],
  google_compute_region_instance_group_manager: ['compute-engine', 'Managed instance group'],
  google_app_engine_application: 'app-engine',
  google_container_cluster: 'gke',
  google_cloud_run_service: 'cloud-run',
  google_cloud_run_v2_service: 'cloud-run',
  google_cloud_run_v2_job: ['cloud-run', 'Cloud Run job'],
  google_artifact_registry_repository: 'artifact-registry',
  google_cloudfunctions_function: 'cloud-functions',
  google_cloudfunctions2_function: 'cloud-functions',
  google_workflows_workflow: 'workflows',
  google_cloud_scheduler_job: 'cloud-scheduler',
  google_cloud_tasks_queue: 'cloud-tasks',
  google_storage_bucket: 'gcs',
  google_compute_disk: 'persistent-disk',
  google_filestore_instance: 'filestore',
  google_sql_database_instance: 'cloud-sql',
  google_alloydb_cluster: 'alloydb',
  google_spanner_instance: 'spanner',
  google_firestore_database: 'firestore',
  google_bigtable_instance: 'bigtable',
  google_redis_instance: 'memorystore',
  google_bigquery_dataset: 'bigquery',
  google_dataflow_job: 'dataflow',
  google_dataflow_flex_template_job: 'dataflow',
  google_dataproc_cluster: 'dataproc',
  google_composer_environment: 'composer',
  google_dataplex_lake: 'dataplex',
  google_datastream_stream: 'datastream',
  google_dataform_repository: 'dataform',
  google_pubsub_topic: 'pubsub',
  google_eventarc_trigger: 'eventarc',
  google_api_gateway_gateway: 'cloud-api-gateway',
  google_compute_global_forwarding_rule: 'cloud-load-balancing',
  google_compute_forwarding_rule: 'cloud-load-balancing',
  google_dns_managed_zone: 'cloud-dns',
  google_compute_router_nat: 'cloud-nat',
  google_compute_router: 'cloud-router',
  google_compute_vpn_gateway: 'cloud-vpn',
  google_compute_ha_vpn_gateway: 'cloud-vpn',
  google_compute_interconnect_attachment: 'interconnect',
  google_compute_security_policy: 'cloud-armor',
  google_secret_manager_secret: 'secret-manager',
  google_vertex_ai_endpoint: 'vertex-ai',
  google_cloudbuild_trigger: 'cloud-build',
};

/**
 * Resources that only say "this feeds that": the line runs from what the first attribute refers to,
 * to what the second refers to. They are not drawn themselves.
 */
const connectors: Record<string, [from: RegExp, to: RegExp, style: string | undefined]> = {
  aws_lambda_event_source_mapping: [/^event_source_arn$/, /^function_name$/, 'data'],
  aws_sns_topic_subscription: [/^topic_arn$/, /^endpoint$/, 'data'],
  aws_cloudwatch_event_target: [/^(rule|event_bus_name)$/, /^arn$/, 'data'],
  aws_s3_bucket_notification: [/^bucket$/, /_arn$/, 'data'],
  aws_lb_listener: [/^load_balancer_arn$/, /target_group_arn$/, 'private'],
  aws_alb_listener: [/^load_balancer_arn$/, /target_group_arn$/, 'private'],
  aws_api_gateway_integration: [/^rest_api_id$/, /^uri$/, undefined],
  aws_apigatewayv2_integration: [/^api_id$/, /^integration_uri$/, undefined],
  aws_route53_record: [/^zone_id$/, /^(alias\.name|records)$/, 'public'],
  aws_wafv2_web_acl_association: [/^web_acl_arn$/, /^resource_arn$/, undefined],
  google_pubsub_subscription: [/^topic$/, /^push_config\./, 'data'],
  google_storage_notification: [/^bucket$/, /^topic$/, 'data'],
};

/** Not drawn, and what refers to them stands for what uses them: a target group, a subscription. */
const relays = new Set(['aws_lb_target_group', 'aws_alb_target_group', 'google_pubsub_subscription']);

/** Never followed for lines: nearly everything refers to these, and it says nothing about flow. */
const dull = /^(aws_(security_group|iam_|kms_|acm_|cloudwatch_log_|route_table|route$|network_acl|eip|key_pair|db_subnet_group|elasticache_subnet_group|redshift_subnet_group)|google_(service_account|project|kms_|compute_firewall|compute_route|compute_address|compute_global_address))/;

/** Supporting resources nobody expects in the picture: not worth a warning. */
const plumbing = /_(attachment|association|policy|permission|listener|listener_rule|target_group|task_definition|versioning|public_access_block|parameter_group|record|notification|mapping|subscription|integration|target|member|binding|rule|route|cluster_capacity_providers|launch_template|lifecycle_configuration|server_side_encryption_configuration|ownership_controls|secret_version|log_group)$|^aws_ecs_cluster$/;

/** Attribute that names another resource by its name instead of an id, and the type it means. */
const byName: Record<string, string[]> = {
  db_subnet_group_name: ['aws_db_subnet_group'],
  subnet_group_name: ['aws_elasticache_subnet_group'],
  cluster_subnet_group_name: ['aws_redshift_subnet_group'],
  function_name: ['aws_lambda_function'],
  rule: ['aws_cloudwatch_event_rule'],
  bucket: ['aws_s3_bucket', 'google_storage_bucket'],
  network: ['google_compute_network'],
  subnetwork: ['google_compute_subnetwork'],
  topic: ['google_pubsub_topic'],
  router: ['google_compute_router'],
};
const nameAttr: Record<string, string> = { aws_lambda_function: 'function_name', aws_s3_bucket: 'bucket' };

// ---------------------------------------------------------------- reading

export interface Resource {
  address: string;
  /** Address without the index: what the configuration calls it. */
  config: string;
  type: string;
  name: string;
  key?: string;
  module: string;
  values: Obj;
  /** attribute path (no indexes) → addresses it refers to. */
  refs: Map<string, Set<string>>;
}

export function readResources(root: unknown, out: Resource[]) {
  if (!isObj(root)) return;
  for (const r of Array.isArray(root.resources) ? root.resources : []) {
    if (!isObj(r) || r.mode !== 'managed' || !str(r.type) || !str(r.address)) continue;
    const address = r.address as string;
    const config = address.replace(/\[[^\]]*\]/g, '');
    const module = config.slice(0, config.length - `${r.type as string}.${String(r.name)}`.length).replace(/\.$/, '');
    out.push({ address, config, type: r.type as string, name: String(r.name), key: r.index == null ? undefined : String(r.index), module, values: isObj(r.values) ? r.values : {}, refs: new Map() });
  }
  for (const m of Array.isArray(root.child_modules) ? root.child_modules : []) readResources(m, out);
}

/** A module of the configuration: where its resources live, and what its variables were given. */
export interface Scope {
  module: Obj;
  prefix: string;
  variable: (name: string, depth: number) => string[];
}

const refsOf = (v: unknown) => (isObj(v) && Array.isArray(v.references) ? (v.references as unknown[]).filter((x): x is string => typeof x === 'string') : []);

const childScope = (parent: Scope, name: string, call: Obj): Scope => ({
  module: isObj(call.module) ? call.module : {},
  prefix: `${parent.prefix}module.${name}.`,
  variable: (v, depth) => resolver(parent)(refsOf(isObj(call.expressions) ? call.expressions[v] : undefined), depth),
});

/** References → addresses of resources: a module's output and a variable are followed to what is behind them. */
function resolver(scope: Scope): (refs: string[], depth: number) => string[] {
  const calls = isObj(scope.module.module_calls) ? scope.module.module_calls : {};
  const one = (ref: string, depth: number): string[] => {
    if (depth > 6) return [];
    const m = /^module\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/.exec(ref);
    if (m) {
      const call = calls[m[1]!];
      const outputs = isObj(call) && isObj(call.module) && isObj(call.module.outputs) ? call.module.outputs : {};
      const output = outputs[m[2]!];
      return isObj(output) ? resolver(childScope(scope, m[1]!, call as Obj))(refsOf(output.expression), depth + 1) : [];
    }
    const v = /^var\.([A-Za-z0-9_-]+)/.exec(ref);
    if (v) return scope.variable(v[1]!, depth + 1);
    const r = /^([a-z][a-z0-9]*_[a-z0-9_]+\.[A-Za-z0-9_-]+)/.exec(ref);
    return r ? [scope.prefix + r[1]!] : [];
  };
  return (refs, depth) => [...new Set(refs.flatMap((x) => one(x, depth)))];
}

/** References in the configuration of a plan: config address → attribute → config addresses. */
export function readConfig(scope: Scope, out: Map<string, Map<string, string[]>>) {
  const resolve = resolver(scope);
  for (const r of Array.isArray(scope.module.resources) ? scope.module.resources : []) {
    if (!isObj(r) || r.mode !== 'managed' || !str(r.address)) continue;
    const attrs = new Map<string, string[]>();
    const walk = (v: unknown, path: string) => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, path));
      if (!isObj(v)) return;
      if (Array.isArray(v.references)) {
        const found = resolve(refsOf(v), 0);
        if (found.length) attrs.set(path, [...new Set([...(attrs.get(path) ?? []), ...found])]);
        return;
      }
      for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(r.expressions, '');
    out.set(scope.prefix + (r.address as string), attrs);
  }
  for (const [name, call] of Object.entries(isObj(scope.module.module_calls) ? scope.module.module_calls : {})) if (isObj(call)) readConfig(childScope(scope, name, call), out);
}

const idLike = (s: string) => s.length >= 8 && (/[:/]/.test(s) || /^[a-z]+-[0-9a-f]{8,}$/.test(s) || (s.length >= 12 && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)));

export function link(resources: Resource[], config: Map<string, Map<string, string[]>>) {
  const byId = new Map<string, string>();
  const named = new Map<string, string>();
  const instances = new Map<string, Resource[]>();
  for (const r of resources) {
    for (const k of ['id', 'arn', 'self_link', 'url', 'uri', 'invoke_arn', 'qualified_arn', 'dns_name', 'domain_name', 'bucket_regional_domain_name', 'bucket_domain_name']) {
      const v = str(r.values[k]);
      if (v && idLike(v) && !byId.has(v)) byId.set(v, r.address);
    }
    const n = str(r.values[nameAttr[r.type] ?? 'name']);
    if (n) named.set(`${r.type}\0${n}`, r.address);
    instances.set(r.config, [...(instances.get(r.config) ?? []), r]);
  }
  const arns = [...byId.keys()].filter((k) => k.startsWith('arn:'));
  const urls = [...byId.keys()].filter((k) => /^[a-z0-9]+:\/\//.test(k));
  for (const r of resources) {
    const add = (path: string, to: string | undefined) => {
      if (!to || to === r.address) return;
      r.refs.set(path, (r.refs.get(path) ?? new Set()).add(to));
    };
    // Values (a state, or what a plan already knows): ids, ARNs and self links of other resources.
    const walk = (v: unknown, path: string, key: string) => {
      if (typeof v === 'string') {
        if (byId.has(v)) return add(path, byId.get(v));
        for (const t of byName[key] ?? []) add(path, named.get(`${t}\0${v.split('/').pop()!}`));
        // Something under it: a path in a bucket, a route of a service.
        if (v.includes('://')) for (const u of urls) if (v.startsWith(`${u}/`)) add(path, byId.get(u));
        if (v.includes('arn:') && v.length < 4000) for (const a of arns) {
          const i = v.indexOf(a);
          // Not the start of a longer name: …:shop is not …:shop-assets.
          if (i >= 0 && !/[A-Za-z0-9_-]/.test(v[i + a.length] ?? '')) add(path, byId.get(a));
        }
        return;
      }
      if (Array.isArray(v)) return v.forEach((x) => walk(x, path, key));
      if (isObj(v)) for (const [k, x] of Object.entries(v)) if (!/^(tags|tags_all|labels|effective_labels|terraform_labels)$/.test(k)) walk(x, path ? `${path}.${k}` : k, k);
    };
    for (const [k, v] of Object.entries(r.values)) if (!/^(id|arn|self_link|tags|tags_all|labels)$/.test(k)) walk(v, k, k);
    // The configuration (a plan, where ids are not known yet): what each expression refers to.
    for (const [path, targets] of config.get(r.config) ?? [])
      for (const t of targets) {
        const all = instances.get(t) ?? [];
        // One of several (count, for_each): the one with the same key, else all of them.
        const same = all.filter((x) => x.key === r.key);
        for (const x of all.length > 1 && same.length ? same : all) add(path, x.address);
      }
  }
}

// ---------------------------------------------------------------- writing

// A Google name may be the whole path (projects/p/secrets/key): the last part is what it is called.
const first = (o: Obj, keys: string[]) => keys.map((k) => str(o[k])).find(Boolean)?.replace(/^projects\/.*\//, '');
const tagName = (o: Obj) => (isObj(o.tags) ? str(o.tags.Name) : undefined);

function tierOf(name: string): string | undefined {
  if (/public|dmz|edge|ingress/i.test(name)) return 'public';
  if (/isolated|intra|data|database|\bdb\b|rds|protected/i.test(name)) return 'isolated';
  if (/private|app|internal|workload/i.test(name)) return 'private';
  return undefined;
}

/** A cloud diagram of the resources in the JSON of `terraform show -json`. */
export function importTerraform(text: string, title = 'Infrastructure'): Imported {
  const warn = new Warnings();
  let doc: Obj;
  try {
    doc = JSON.parse(text) as Obj;
  } catch (e) {
    return { yaml: '', warnings: [`Not JSON: ${(e as Error).message.split('\n')[0]}. Expected the output of terraform show -json`] };
  }
  const all: Resource[] = [];
  const plan = isObj(doc.planned_values);
  readResources(plan ? (doc.planned_values as Obj).root_module : isObj(doc.values) ? doc.values.root_module : undefined, all);
  const config = new Map<string, Map<string, string[]>>();
  if (isObj(doc.configuration) && isObj(doc.configuration.root_module)) readConfig({ module: doc.configuration.root_module, prefix: '', variable: () => [] }, config);
  const cloudy = all.filter((r) => /^(aws|google)_/.test(r.type)).sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  if (!cloudy.length)
    return { yaml: '', warnings: [all.some((r) => r.type.startsWith('azurerm_')) ? 'Azure resources (azurerm): carto import reads them as an azure diagram' : 'No AWS or Google Cloud resources found: expected the output of terraform show -json (a state or a saved plan)'] };
  link(cloudy, config);
  const at = new Map(cloudy.map((r) => [r.address, r]));
  const google = cloudy.filter((r) => r.type.startsWith('google_')).length;
  const provider = google > cloudy.length - google ? 'gcp' : 'aws';

  const drawn = cloudy.filter((r) => containers[r.type] || nodes[r.type]);
  const skipped = new Map<string, number>();
  for (const r of cloudy) if (!containers[r.type] && !nodes[r.type] && !connectors[r.type] && !relays.has(r.type) && !dull.test(r.type) && !plumbing.test(r.type)) skipped.set(r.type, (skipped.get(r.type) ?? 0) + 1);
  if (!drawn.length) return { yaml: '', warnings: [`None of the ${cloudy.length} resources is one the cloud type draws`] };
  if (skipped.size) {
    const top = [...skipped].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    warn.add(`Left out ${top.reduce((n, [, c]) => n + c, 0)} resources of types that are not drawn: ${top.slice(0, 8).map(([t, c]) => (c > 1 ? `${t} ×${c}` : t)).join(', ')}${top.length > 8 ? ', …' : ''}`);
  }

  // Ids from addresses: the resource name, with the type in front where two share a name.
  const base = (r: Resource) => slug(r.key != null ? `${r.name}-${r.key}` : r.name).toLowerCase();
  const short = (r: Resource) => slug(r.type.replace(/^(aws|google_compute|google)_/, '').replace(/_/g, '-'));
  const count = new Map<string, number>();
  for (const r of drawn) count.set(base(r), (count.get(base(r)) ?? 0) + 1);
  const taken = new Set<string>();
  const ids = new Map<string, string>();
  for (const r of drawn) {
    const mod = r.module ? slug(r.module.replace(/module\./g, '')).toLowerCase() : '';
    const options = [count.get(base(r)) === 1 ? base(r) : `${short(r)}-${base(r)}`, `${mod}-${short(r)}-${base(r)}`];
    let id = options.find((o) => !taken.has(o)) ?? options[1]!;
    for (let n = 2; taken.has(id); n++) id = `${options[1]!}-${n}`;
    taken.add(id);
    ids.set(r.address, id);
  }
  const fresh = (want: string) => {
    let id = want;
    for (let n = 2; taken.has(id); n++) id = `${want}-${n}`;
    taken.add(id);
    return id;
  };

  const refs = (r: Resource, path?: RegExp) => [...r.refs].flatMap(([p, to]) => (!path || path.test(p) ? [...to] : [])).map((a) => at.get(a)!).filter(Boolean);
  const kindOf = (r: Resource) => containers[r.type];
  /** Subnets a resource sits in: named directly, or through a subnet group. */
  const subnetsOf = (r: Resource): Resource[] => {
    const direct = refs(r).filter((x) => kindOf(x) === 'subnet');
    if (direct.length) return direct;
    return refs(r).filter((x) => /_subnet_group$/.test(x.type)).flatMap((g) => refs(g).filter((x) => kindOf(x) === 'subnet'));
  };
  const vpcs = cloudy.filter((r) => kindOf(r) === 'vpc');
  const vpcOf = (r: Resource): Resource | undefined => {
    const direct = refs(r).find((x) => kindOf(x) === 'vpc');
    if (direct) return direct;
    // Through what is itself in one network: a security group, a Cloud Router.
    return refs(r).filter((x) => /security_group$|^google_compute_router$/.test(x.type)).map((g) => refs(g).find((x) => kindOf(x) === 'vpc')).find(Boolean);
  };
  const subnets = cloudy.filter((r) => kindOf(r) === 'subnet');
  const subnetVpc = new Map<string, Resource | undefined>();
  for (const s of subnets) {
    const v = vpcOf(s) ?? (vpcs.length === 1 && s.type.startsWith(vpcs[0]!.type.split('_')[0]!) ? vpcs[0] : undefined);
    if (!vpcOf(s) && vpcs.length > 1) warn.onceFor('subnet-vpc', 'Some subnets do not say which VPC they are in (a plan with ids not known yet): they are drawn outside');
    subnetVpc.set(s.address, v);
  }

  // Public, private or isolated: by the route out (an internet gateway, a NAT gateway, neither), else by name.
  const routeTier = new Map<string, string>();
  for (const a of cloudy.filter((r) => r.type === 'aws_route_table_association')) {
    const subnet = refs(a, /^subnet_id$/)[0];
    const table = refs(a, /^route_table_id$/)[0];
    if (!subnet || !table) continue;
    const hops = [...refs(table), ...cloudy.filter((r) => r.type === 'aws_route' && refs(r, /^route_table_id$/).includes(table)).flatMap((r) => refs(r))];
    routeTier.set(subnet.address, hops.some((h) => h.type === 'aws_internet_gateway') ? 'public' : hops.some((h) => /nat_gateway|transit_gateway|vpn_gateway/.test(h.type)) ? 'private' : 'isolated');
  }
  const label = (r: Resource) =>
    tagName(r.values) ??
    // A distribution's domain name is a random host name; a search domain's is what it is called.
    first(r.values, r.type === 'aws_cloudfront_distribution' ? ['comment'] : ['name', 'bucket', 'function_name', 'identifier', 'cluster_identifier', 'domain_name', 'friendly_name', 'dataset_id', 'replication_group_id', 'cluster_id', 'secret_id', 'family']) ??
    r.name;
  const tier = (s: Resource) => (s.type.startsWith('aws_') ? routeTier.get(s.address) ?? (s.values.map_public_ip_on_launch === true ? 'public' : tierOf(`${label(s)} ${s.name}`)) : undefined);

  // Zones as columns: when the subnets of a VPC are spread over zones, each zone becomes a group.
  const zoneGroups = new Map<string, { id: string; vpc: string; zone: string }>();
  const zoneOf = (s: Resource) => str(s.values.availability_zone);
  for (const v of vpcs) {
    const mine = subnets.filter((s) => subnetVpc.get(s.address) === v);
    const zones = [...new Set(mine.map(zoneOf))];
    if (zones.length < 2 || zones.some((z) => !z)) continue;
    for (const z of (zones as string[]).sort()) zoneGroups.set(`${v.address}\0${z}`, { id: fresh(`${ids.get(v.address)!}-${slug(z)}`), vpc: ids.get(v.address)!, zone: z });
  }
  const regionOf = (r: Resource) => str(r.values.region) ?? zoneOf(r)?.replace(/[a-z]$/, '') ?? /^arn:aws[a-z-]*:[a-z0-9-]+:([a-z]{2}-[a-z]+-\d)/.exec(str(r.values.arn) ?? '')?.[1];

  const line = (id: string, parts: (string | undefined)[]) => `  ${id}: { ${parts.filter(Boolean).join(', ')} }`;
  const field = (k: string, v: string | undefined) => (v ? `${k}: ${scalar(v)}` : undefined);
  const groupLines: string[] = [];
  for (const v of vpcs) {
    const region = subnets.filter((s) => subnetVpc.get(s.address) === v).map(regionOf).find(Boolean) ?? (v.type.startsWith('aws_') ? regionOf(v) : undefined);
    groupLines.push(line(ids.get(v.address)!, ['kind: vpc', field('label', label(v)), field('region', v.type.startsWith('aws_') ? region : undefined), field('cidr', str(v.values.cidr_block))]));
    for (const z of zoneGroups.values()) if (z.vpc === ids.get(v.address)) groupLines.push(line(z.id, ['kind: zone', field('zone', z.zone), `in: ${z.vpc}`]));
  }
  const subnetHome = (s: Resource) => {
    const v = subnetVpc.get(s.address);
    return v ? zoneGroups.get(`${v.address}\0${zoneOf(s) ?? ''}`)?.id ?? ids.get(v.address) : undefined;
  };
  for (const s of subnets) {
    const zoned = !!subnetVpc.get(s.address) && zoneGroups.has(`${subnetVpc.get(s.address)!.address}\0${zoneOf(s) ?? ''}`);
    const t = tier(s);
    groupLines.push(
      line(ids.get(s.address)!, [
        'kind: subnet',
        // A tiered subnet in a zone column is named by its tier; elsewhere by its own name.
        zoned && t ? undefined : field('label', label(s)),
        field('tier', t),
        field('region', s.type.startsWith('google_') ? str(s.values.region) : undefined),
        field('zone', zoned ? undefined : zoneOf(s)),
        field('cidr', str(s.values.cidr_block) ?? str(s.values.ip_cidr_range)),
        field('in', subnetHome(s)),
      ]),
    );
  }

  const nodeLines: string[] = [];
  /** Where a resource is drawn: once, or once in every zone it is spread over. */
  interface Spot {
    id: string;
    home?: string;
    zone?: string;
    tier?: string;
  }
  const places = new Map<string, Spot[]>();
  const inColumn = (s: Resource) => !!subnetVpc.get(s.address) && zoneGroups.has(`${subnetVpc.get(s.address)!.address}\0${zoneOf(s) ?? ''}`);
  const things = drawn.filter((r) => nodes[r.type]);
  const kinds = new Map<string, string>();
  for (const r of things) {
    const spec = nodes[r.type]!;
    let [kind, caption] = typeof spec === 'string' ? [spec, undefined] : spec;
    if (kind === 'alb' && r.values.load_balancer_type === 'network') kind = 'nlb';
    if (kind === 'alb' && r.values.load_balancer_type === 'gateway') caption = 'Gateway Load Balancer';
    kinds.set(r.address, kind);
    const own = ids.get(r.address)!;
    const all = subnetsOf(r);
    // In one zone only (an instance, a database without a standby): the subnet in that zone.
    const pinned = r.values.multi_az === true ? undefined : str(r.values.availability_zone);
    const inZone = all.filter((s) => pinned && zoneOf(s) === pinned);
    const inSubnets = inZone.length === 1 ? inZone : all;
    const homes = [...new Set(inSubnets.map((s) => subnetVpc.get(s.address)).filter(Boolean))] as Resource[];
    const tiers = [...new Set(inSubnets.map(tier))];
    const zones = new Set(inSubnets.map(zoneOf));
    const oneZone = r.type === 'aws_db_instance' && r.values.multi_az !== true;
    let spots: Spot[];
    if (inSubnets.length === 1) spots = [{ id: own, home: ids.get(inSubnets[0]!.address) }];
    else if (inSubnets.length > 1 && !oneZone && inSubnets.every(inColumn) && zones.size === inSubnets.length)
      // Spread over zones: once in each subnet, the way these pictures are drawn, so the tiers line up.
      spots = inSubnets.map((s) => {
        const letter = zoneOf(s)!.slice(-1);
        return { id: fresh(taken.has(`${own}-${letter}`) ? `${short(r)}-${own}-${letter}` : `${own}-${letter}`), home: ids.get(s.address), zone: zoneOf(s) };
      });
    // Across several subnets otherwise: in the VPC, on the row of their tier.
    else if (inSubnets.length > 1 && homes.length === 1) spots = [{ id: own, home: ids.get(homes[0]!.address), tier: tiers.length === 1 ? tiers[0] : undefined }];
    else spots = [{ id: own, home: vpcOf(r) ? ids.get(vpcOf(r)!.address) : undefined }];
    places.set(r.address, spots);
    const settings = Array.isArray(r.values.settings) && isObj(r.values.settings[0]) ? r.values.settings[0] : {};
    const size = first(r.values, ['instance_type', 'instance_class', 'node_type', 'machine_type', 'engine']) ?? str(settings.tier);
    const exposure = /^aws_(lb|alb|elb)$/.test(r.type) && typeof r.values.internal === 'boolean' ? (r.values.internal ? 'internal' : 'public') : undefined;
    // An AWS subnet is in one zone already; a Google subnet spans its region.
    const zone = r.type.startsWith('google_') ? str(r.values.zone)?.split('/').pop() : inSubnets.length === 1 ? undefined : pinned;
    for (const spot of spots)
      nodeLines.push(
        line(spot.id, [`kind: ${kind}`, field('label', label(r)), field('caption', caption), field('size', size?.split('/').pop()), field('exposure', exposure), field('zone', zone), field('tier', spot.tier), field('in', spot.home)]),
      );
  }

  // Lines: what a drawn resource refers to (through plumbing such as a task definition), and what connectors join.
  const isNode = (r: Resource) => !!nodes[r.type];
  const reach = (r: Resource, depth = 0, seen = new Set<string>()): Resource[] => {
    if (isNode(r)) return [r];
    if (depth > 5 || seen.has(r.address) || containers[r.type] || dull.test(r.type) || connectors[r.type] || relays.has(r.type)) return [];
    seen.add(r.address);
    return refs(r).flatMap((x) => reach(x, depth + 1, seen));
  };
  const users = (relay: Resource) => [
    ...things.filter((t) => refs(t).includes(relay)),
    ...cloudy.filter((r) => /target_group_attachment$/.test(r.type) && refs(r, /target_group_arn$/).includes(relay)).flatMap((r) => refs(r, /^target_id$/).flatMap((x) => reach(x))),
  ];
  const ends = (r: Resource) => (relays.has(r.type) ? users(r) : reach(r));
  const edges = new Map<string, string | undefined>();
  const wire = (from: string, to: string, style?: string) => {
    if (from === to || edges.has(`${from} -> ${to}`) || edges.has(`${to} -> ${from}`)) return;
    edges.set(`${from} -> ${to}`, style);
  };
  const spots = (r: Resource) => places.get(r.address) ?? [];
  /** Between two resources; where both are in several zones, each talks to the one in its own. */
  const edge = (from: Resource, to: Resource, style?: string) => {
    for (const a of spots(from)) {
      const near = spots(to).filter((b) => b.zone && b.zone === a.zone);
      for (const b of near.length ? near : spots(to)) wire(a.id, b.id, style);
    }
  };
  for (const c of cloudy) {
    const rule = connectors[c.type];
    if (!rule) continue;
    const from = refs(c, rule[0]).flatMap((x) => (isNode(x) ? [x] : []));
    const to = [...c.refs].flatMap(([p, t]) => (rule[1].test(p) && !rule[0].test(p) ? [...t] : [])).map((a) => at.get(a)!).flatMap(ends);
    for (const f of from) for (const t of to) edge(f, t, rule[2]);
    // A subscription is also what its readers refer to.
    if (relays.has(c.type)) for (const f of from) for (const t of users(c)) edge(f, t, rule[2]);
  }
  // What may talk to what: a security group that lets another one in.
  const behindGroup = (g: Resource) => things.filter((t) => refs(t, /security_group/).includes(g));
  const allow = (from: Resource | undefined, to: Resource | undefined) => {
    if (!from || !to || from === to) return;
    const a = behindGroup(from);
    const b = behindGroup(to);
    // A group half the estate is in says little about who calls whom.
    if (a.length * b.length > 6) return;
    for (const f of a) for (const t of b) edge(f, t, 'private');
  };
  for (const r of cloudy) {
    if (r.type === 'aws_security_group') for (const g of refs(r, /^ingress(\.security_groups)?$/).filter((x) => x.type === 'aws_security_group')) allow(g, r);
    else if (/^aws_(security_group_rule|vpc_security_group_ingress_rule)$/.test(r.type) && r.values.type !== 'egress') allow(refs(r, /^(source_security_group_id|referenced_security_group_id)$/)[0], refs(r, /^security_group_id$/)[0]);
  }
  const quiet = new Set(['internet-gateway', 'nat-gateway', 'waf', 'cloud-armor']);
  for (const r of things) {
    const front = /^(cloudfront|cloud-cdn|route53|cloud-dns)$/.test(kinds.get(r.address)!);
    for (const [path, targets] of r.refs) {
      if (/(^|\.)(vpc_id|subnet_ids?|subnets|security_groups?|vpc_security_group_ids|kms_key_id|kms_key_arn|role|role_arn|network|subnetwork)$/.test(path)) continue;
      // What sets a function off comes before it: the topic feeds the function.
      const trigger = /(^|\.)(event_trigger|trigger_topic|event_source_arn)(\.|$)/.test(path);
      for (const a of targets)
        for (const t of reach(at.get(a)!)) {
          if (quiet.has(kinds.get(t.address)!)) continue;
          if (trigger) edge(t, r, 'data');
          else edge(r, t, front ? 'public' : undefined);
        }
    }
  }
  // The way in and out: the internet gateway of a VPC, and what faces the internet.
  const fronted = new Set([...edges].flatMap(([k, style]) => (style === 'public' ? [k.split(' -> ')[1]!] : [])));
  const facing = things.filter((r) => /^(cloudfront|api-gateway|cloud-api-gateway)$/.test(kinds.get(r.address)!) || (/^aws_(lb|alb|elb)$/.test(r.type) && r.values.internal === false));
  const gateways = things.filter((r) => r.type === 'aws_internet_gateway');
  let internet: string | undefined;
  if (facing.length || gateways.length) {
    internet = fresh('internet');
    for (const g of gateways) for (const s of spots(g)) wire(internet, s.id, 'public');
    for (const r of facing) {
      const home = /^aws_(lb|alb|elb)$/.test(r.type) ? subnetsOf(r).map((s) => subnetVpc.get(s.address)).find(Boolean) ?? vpcOf(r) : undefined;
      const gateway = home && gateways.find((g) => vpcOf(g) === home);
      // Behind a CDN or a DNS name already: that is its way in.
      for (const s of spots(r)) if (!fronted.has(s.id)) wire(gateway ? spots(gateway)[0]!.id : internet, s.id, 'public');
    }
    for (const n of things.filter((r) => r.type === 'aws_nat_gateway')) {
      const home = subnetsOf(n).map((s) => subnetVpc.get(s.address)).find(Boolean);
      const gateway = home && gateways.find((g) => vpcOf(g) === home);
      if (gateway && n.values.connectivity_type !== 'private') edge(n, gateway);
    }
  }
  if (plan && !edges.size && things.length > 1) warn.add('No lines: this plan carries no configuration to read references from');

  const out = ['type: cloud', `provider: ${provider}`, `title: ${scalar(title)}`, `subtitle: ${plan ? 'From a Terraform plan' : 'From Terraform state'}`];
  if (zoneGroups.size) out.push('direction: down');
  if (groupLines.length) out.push('', 'groups:', ...groupLines);
  out.push('', 'nodes:');
  if (internet) out.push(`  ${internet}: internet`);
  out.push(...nodeLines);
  if (edges.size) out.push('', 'edges:', ...[...edges].map(([k, style]) => `  - ${k}${style ? `: { style: ${style} }` : ''}`));
  return { yaml: out.join('\n') + '\n', warnings: warn.list };
}

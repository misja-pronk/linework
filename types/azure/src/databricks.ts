// Azure Databricks in the Azure type's words: the planes it runs in, Unity Catalog's objects, the Lakeflow
// tools, serving and sharing, and the Azure pieces around a workspace (access connector, NCC). Line icons only:
// Databricks' own marks are theirs. See docs/research/databricks-2026.md for what each one is.
import type { KindTable } from '@cartography/core';

/** Containers: a workspace, the three planes, and Unity Catalog's metastore → catalog → schema. */
export const databricksGroups: KindTable = {
  databricks: { label: 'Databricks workspace', icon: 'flame', tone: 'rose', keywords: ['dbw', 'workspace', 'azure databricks'] },
  'control-plane': { label: 'Control plane', icon: 'cloud-cog', tone: 'slate', keywords: ['databricks control plane', 'run by databricks', 'web application'] },
  'compute-plane': { label: 'Classic compute plane', icon: 'server-cog', tone: 'sky', keywords: ['vnet injection', 'data plane', 'classic compute', 'host subnet', 'container subnet'] },
  'serverless-plane': { label: 'Serverless plane', icon: 'cloud', tone: 'violet', keywords: ['serverless compute plane', 'databricks serverless'] },
  metastore: { label: 'Metastore', icon: 'library-big', tone: 'indigo', keywords: ['unity catalog', 'uc'] },
  catalog: { label: 'Catalog', icon: 'library', tone: 'indigo', keywords: ['unity catalog', 'uc'] },
  schema: { label: 'Schema', icon: 'folder-tree', tone: 'indigo', keywords: ['unity catalog', 'database', 'bronze', 'silver', 'gold'] },
};

/** Cards. Kinds that are also groups (catalog, schema) draw closed, as one card. */
export const databricksNodes: KindTable = {
  // Compute
  compute: { label: 'Compute', icon: 'cpu', tone: 'blue', keywords: ['cluster', 'spark', 'all-purpose', 'jobs compute', 'databricks'] },
  serverless: { label: 'Serverless compute', icon: 'zap', tone: 'amber', keywords: ['databricks serverless', 'serverless jobs', 'serverless notebooks'] },
  // Lakeflow: ingestion, transformation and orchestration
  'lakeflow-connect': { label: 'Lakeflow Connect', icon: 'import', tone: 'teal', keywords: ['ingestion', 'connector', 'salesforce', 'cdc', 'databricks'] },
  'lakeflow-pipeline': { label: 'Lakeflow pipeline', icon: 'workflow', tone: 'teal', keywords: ['declarative pipeline', 'spark declarative pipelines', 'dlt', 'delta live tables', 'auto loader', 'etl', 'databricks'] },
  'lakeflow-job': { label: 'Lakeflow job', icon: 'calendar-clock', tone: 'amber', keywords: ['workflows', 'job', 'orchestration', 'schedule', 'databricks'] },
  // Unity Catalog
  metastore: { label: 'Metastore', icon: 'library-big', tone: 'indigo', keywords: ['unity catalog', 'uc'] },
  catalog: { label: 'Catalog', icon: 'library', tone: 'indigo', keywords: ['unity catalog', 'uc'] },
  schema: { label: 'Schema', icon: 'folder-tree', tone: 'indigo', keywords: ['unity catalog', 'database'] },
  table: { label: 'Table', icon: 'table-2', tone: 'indigo', keywords: ['delta', 'unity catalog', 'streaming table', 'materialized view'] },
  volume: { label: 'Volume', icon: 'folders', tone: 'teal', keywords: ['files', 'unity catalog'] },
  'registered-model': { label: 'Model', icon: 'brain', tone: 'violet', keywords: ['mlflow', 'registered model', 'unity catalog'] },
  'storage-credential': { label: 'Storage credential', icon: 'key-square', tone: 'amber', keywords: ['unity catalog', 'credential'] },
  'external-location': { label: 'External location', icon: 'folder-cog', tone: 'teal', keywords: ['unity catalog', 'abfss', 'path'] },
  'access-connector': { label: 'Access connector', icon: 'plug', tone: 'indigo', keywords: ['dbac', 'managed identity', 'unity catalog'] },
  // Serving and sharing
  'model-serving': { label: 'Model Serving', icon: 'brain-circuit', tone: 'violet', keywords: ['serving endpoint', 'mosaic ai', 'inference', 'ml'] },
  'databricks-app': { label: 'Databricks App', icon: 'app-window-mac', tone: 'blue', keywords: ['apps', 'streamlit', 'dash'] },
  // OpenSharing, called Delta Sharing until June 2026: a share of tables, views, volumes and models, and who receives it.
  share: { label: 'Share', icon: 'share-2', tone: 'teal', keywords: ['opensharing', 'delta sharing', 'delta share'] },
  recipient: { label: 'Recipient', icon: 'handshake', tone: 'slate', keywords: ['opensharing', 'delta sharing', 'share recipient', 'partner'] },
  // Networking of the serverless plane
  ncc: { label: 'Network connectivity config', icon: 'globe-lock', tone: 'sky', keywords: ['ncc', 'serverless', 'private endpoint', 'stable ip'] },
  'network-policy': { label: 'Network policy', icon: 'brick-wall-shield', tone: 'rose', keywords: ['serverless egress', 'egress control', 'serverless network policy'] },
};

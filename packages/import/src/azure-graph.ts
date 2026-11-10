// Azure Resource Graph → the estate. Reads what `az graph query -q "resources | …" -o json` writes
// (`{ "data": [ … ] }`, or the bare array with --query data), `resourcecontainers` for the names of
// subscriptions, resource groups and management groups, and `az resource list -o json`, which has
// the same rows. Subnets and peerings are inside a network's row; they become resources of their own.
import { Estate, readDetails, type AzResource } from './azure-estate.ts';
import { isObj, str, type Obj } from './keep.ts';

/** The rows of a Resource Graph answer: `{ data: [...] }`, `{ value: [...] }` or the bare array. */
export function graphRows(json: unknown): Obj[] | undefined {
  const rows = Array.isArray(json) ? json : isObj(json) && Array.isArray(json.data) ? json.data : isObj(json) && Array.isArray(json.value) ? json.value : undefined;
  if (!rows?.length || !rows.every(isObj)) return undefined;
  const typed = (rows as Obj[]).filter((r) => typeof r.id === 'string' && typeof r.type === 'string' && /^\/(subscriptions|providers)\//i.test(r.id));
  return typed.length >= rows.length / 2 ? (rows as Obj[]) : undefined;
}

const CONTAINER = /^microsoft\.(resources\/subscriptions(\/resourcegroups)?|management\/managementgroups)$/i;
/** What the access importer reads instead: role assignments and definitions. */
const ACCESS = /^microsoft\.authorization\/(roleassignments|roledefinitions)$/i;

/** Rows of resources, not only containers or role assignments. */
export const hasResources = (rows: Obj[]) => rows.some((r) => !CONTAINER.test(String(r.type)) && !ACCESS.test(String(r.type)));
/** Rows of subscriptions, resource groups or management groups only: `resourcecontainers`. */
export const onlyContainers = (rows: Obj[]) => rows.every((r) => CONTAINER.test(String(r.type)));

/** Reads the rows into the estate; the number of resources read. */
export function readGraph(estate: Estate, rows: Obj[]): number {
  let n = 0;
  estate.sources.add('graph');
  for (const row of rows) {
    const type = String(row.type).toLowerCase();
    const id = String(row.id);
    const p = isObj(row.properties) ? row.properties : {};
    if (type === 'microsoft.management/managementgroups') {
      const parent = isObj(p.details) && isObj(p.details.parent) ? str(p.details.parent.name) ?? str(p.details.parent.id)?.split('/').pop() : undefined;
      estate.managementGroup(str(row.name) ?? id.split('/').pop()!, str(p.displayName), parent);
      continue;
    }
    if (type === 'microsoft.resources/subscriptions') {
      // The first in the chain is the management group the subscription is directly in.
      const chain = Array.isArray(p.managementGroupAncestorsChain) ? p.managementGroupAncestorsChain.filter(isObj) : [];
      for (let i = chain.length - 1; i >= 0; i--) estate.managementGroup(String(chain[i]!.name), str(chain[i]!.displayName), i < chain.length - 1 ? String(chain[i + 1]!.name) : undefined);
      estate.subscription(str(row.subscriptionId) ?? id.split('/')[2]!, str(row.name) ?? str(p.displayName), chain[0] ? String(chain[0].name) : undefined);
      continue;
    }
    if (type === 'microsoft.resources/subscriptions/resourcegroups') {
      const sub = str(row.subscriptionId) ?? id.split('/')[2];
      if (sub && str(row.name)) estate.group(sub, str(row.name)!);
      continue;
    }
    if (ACCESS.test(type)) continue;
    const r = estate.resource(id, { type, name: str(row.name), rg: str(row.resourceGroup), sub: str(row.subscriptionId)?.toLowerCase() });
    readDetails(r, row);
    n++;
    if (type === 'microsoft.network/virtualnetworks') for (const s of Array.isArray(p.subnets) ? p.subnets.filter(isObj) : []) subnet(estate, r, s);
  }
  return n;
}

/** A subnet inside a network's row: a resource of its own, so what is in it can say so. */
export function subnet(estate: Estate, vnet: AzResource, s: Obj): AzResource | undefined {
  const name = str(s.name);
  if (!name) return undefined;
  const r = estate.resource(str(s.id) ?? `${vnet.id}/subnets/${name}`, { type: 'microsoft.network/virtualnetworks/subnets', name, change: vnet.change === 'create' ? 'create' : undefined });
  readDetails(r, s);
  return r;
}

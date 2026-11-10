// Data product and data contract files → one `type: data-products` diagram: the data mesh as its files describe it.
// Files are known by what is in them, not by their names:
//
//   Open Data Product Standard (Bitol, `kind: DataProduct`, v1.0 and v1.1)        products with their input and output ports
//   Open Data Product Specification (Linux Foundation, `product:`, v3 and v4)     products and how they are accessed
//   Open Data Contract Standard (Bitol, `kind: DataContract`, v2 and v3)          the contract behind an output port;
//                                                                                 the diagram reads the file itself
//
// Products connect where an input port names the contract of another product's output port. An input
// contract nobody here provides becomes a source. Importing again into the diagram an earlier import
// made keeps what was added by hand (see `write` below), and ids stay, so pinned positions do too.
import { parseSource, type Path, type Source } from '@cartography/core';
import { isOdcs } from '@cartography/data-products';
import { Document, isMap, isScalar, parseDocument, type YAMLMap } from 'yaml';
import { slug } from './text.ts';
import type { Imported } from './index.ts';

export interface MeshFile {
  /** Where the file is, seen from the diagram: contracts are read from there when it is drawn. */
  path: string;
  text: string;
}

export interface MeshProblem {
  /** The data file it is about, as it was given; none when it is about the diagram itself. */
  file?: string;
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface MeshOptions {
  title?: string;
  /** The diagram an earlier import made: what was added to it by hand stays. */
  existing?: string;
}

export interface ImportedMesh extends Imported {
  /** The warnings with their file, line and column apart, for editors and the CLI. */
  problems: MeshProblem[];
  products: number;
  contracts: number;
  /** YAML or JSON that is neither a data product nor a data contract: left alone. */
  skipped: string[];
}

export type DataFileKind = 'odps' | 'odps-lf' | 'odcs';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
/** Ids the way they are written by hand: Customer 360 → customer-360. */
const idOf = (s: string) => slug(s).toLowerCase();
const str = (v: unknown): string | undefined => (v == null || typeof v === 'object' || String(v).trim() === '' ? undefined : String(v).trim());

/** What a parsed file is: a Bitol data product, a Linux Foundation data product, a data contract, or none of these. */
export function dataFileKind(data: unknown): DataFileKind | undefined {
  if (!isObj(data) || typeof data.type === 'string') return undefined;
  if (data.kind === 'DataProduct') return 'odps';
  if (isObj(data.product) && (isObj(data.product.en) || isObj(data.product.details))) return 'odps-lf';
  // In a folder a contract has to say that it is one: "apiVersion" alone is on many kinds of file.
  return isOdcs(data) && (data.kind === 'DataContract' || Array.isArray(data.dataset)) ? 'odcs' : undefined;
}

/** Whether a text is a data product or data contract file, as `carto import` and the editor ask before reading it as one. */
export function isDataMeshFile(text: string): boolean {
  if (!/\b(DataProduct|DataContract|product|dataset)\b/.test(text)) return false;
  return dataFileKind(parseSource(text).data) !== undefined;
}

interface PortIn {
  name?: string;
  /** The contract id as written. */
  contract?: string;
}
interface PortOut {
  name: string;
  kind?: string;
  contract?: string;
}
interface Product {
  file: string;
  name: string;
  domain?: string;
  owner?: string;
  version?: string;
  status?: string;
  inputs: PortIn[];
  outputs: PortOut[];
  /** The format has input ports: without them (Linux Foundation, contracts alone) inputs written by hand stay. */
  lineage: boolean;
}
interface ContractFile {
  file: string;
  id: string;
  name?: string;
  product?: string;
  domain?: string;
  owner?: string;
}

// What a port's free-text type says it is, first match wins: "Kafka topic", "REST API", "SQL tables", "s3 parquet".
const PORT_KINDS: [RegExp, string][] = [
  [/kafka|topic|pub.?sub|event ?hub|kinesis|queue/i, 'topic'],
  [/stream/i, 'stream'],
  [/\bapi\b|rest\b|graphql|grpc|odata|https?\b/i, 'api'],
  [/view/i, 'view'],
  [/table|bigquery|snowflake|databricks|postgres|warehouse|lakehouse|dataset/i, 'table'],
  [/file|csv|parquet|avro|\bs3\b|blob|bucket|adls|sftp|delta|json/i, 'files'],
  [/model|\bml\b/i, 'model'],
  [/sql|query|jdbc|odbc/i, 'query'],
];
const portKind = (type: string | undefined) => (type ? PORT_KINDS.find(([re]) => re.test(type))?.[1] : undefined);

/** The caption of a source that stands for an input contract nobody in the folder provides; also how a later import knows it made it. */
const OUTSIDE = 'Outside the mesh';
/** What earlier versions wrote there, still known as theirs. */
const OUTSIDE_BEFORE = 'Outside these files';

/** The team's name, else whoever is its owner. */
function ownerOf(team: unknown): string | undefined {
  if (isObj(team) && str(team.name)) return str(team.name);
  const members = Array.isArray(team) ? team : isObj(team) && Array.isArray(team.members) ? team.members : [];
  const owner = members.filter(isObj).find((m) => /owner/i.test(str(m.role) ?? ''));
  return owner ? (str(owner.name) ?? str(owner.username)) : undefined;
}

export function importDataMesh(files: MeshFile[], options: MeshOptions = {}): ImportedMesh {
  const problems: MeshProblem[] = [];
  const skipped: string[] = [];
  const products: Product[] = [];
  const contracts = new Map<string, ContractFile>();

  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const src = parseSource(f.text);
    const note = (path: Path, message: string, severity: MeshProblem['severity'] = 'warning') => {
      const at = src.locate(path);
      problems.push({ file: f.path, ...(at ? { line: at.line, column: at.column } : {}), message, severity });
    };
    const broken = src.diagnostics.find((d) => d.severity === 'error');
    if (broken) {
      // Only a file that set out to be one of these is worth a message: a folder holds other YAML too.
      if (/\b(DataProduct|DataContract|productID)\b/.test(f.text)) problems.push({ file: f.path, line: broken.line, column: broken.column, message: `Not read: ${broken.message}`, severity: 'error' });
      else skipped.push(f.path);
      continue;
    }
    const kind = dataFileKind(src.data);
    const d = src.data as Obj;
    if (kind === 'odps') {
      const p = readBitol(d, f.path, note);
      if (p) products.push(p);
    } else if (kind === 'odps-lf') {
      const p = readLinuxFoundation(d, f.path, note);
      if (p) products.push(p);
    } else if (kind === 'odcs') {
      const id = str(d.id) ?? str(d.name) ?? str(d.datasetName);
      if (!id) note([], 'A data contract needs an id: not read');
      else if (contracts.has(id)) note(['id'], `Contract id "${id}" is already used by ${contracts.get(id)!.file}: this file is not read`);
      else contracts.set(id, { file: f.path, id, name: str(d.name) ?? str(d.datasetName), product: str(d.dataProduct), domain: str(d.domain), owner: ownerOf(d.team) });
    } else skipped.push(f.path);
  }

  // A contract no output port names still belongs to a product: the one it names, or one of its own.
  const named = new Set(products.flatMap((p) => p.outputs.map((o) => o.contract)));
  const same = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  for (const c of contracts.values()) {
    if (named.has(c.id)) continue;
    const name = c.product ?? c.name ?? baseName(c.file);
    let p = products.find((x) => same(x.name, c.product));
    if (!p) products.push((p = { file: c.file, name, domain: c.domain, owner: c.owner, inputs: [], outputs: [], lineage: false }));
    p.outputs.push({ name: c.name ?? baseName(c.file), contract: c.id });
  }

  if (!products.length) {
    problems.push({ message: files.length ? 'No data products or data contracts found: none of these files is ODPS or ODCS' : 'No files to read', severity: 'error' });
    return { yaml: '', warnings: problems.map(line), problems, products: 0, contracts: 0, skipped };
  }

  const yaml = write(products, contracts, options, problems);
  return { yaml, warnings: problems.map(line), problems, products: yaml ? products.length : 0, contracts: yaml ? contracts.size : 0, skipped };
}

const line = (p: MeshProblem) => (p.file ? `${p.file}${p.line ? `:${p.line}:${p.column}` : ''}: ${p.message}` : p.message);
const baseName = (file: string) => file.split('/').pop()!.replace(/\.(ya?ml|json)$/i, '').replace(/\.(odcs|odps|contract|product)$/i, '');

type Note = (path: Path, message: string, severity?: MeshProblem['severity']) => void;

/** A list of maps under a key; anything else is said once and read as empty. */
function entries(d: Obj, key: string, note: Note): [number, Obj][] {
  const v = d[key];
  if (v == null) return [];
  if (!Array.isArray(v)) return note([key], `"${key}" should be a list: not read`), [];
  const out: [number, Obj][] = [];
  for (const [i, x] of v.entries()) {
    if (isObj(x)) out.push([i, x]);
    else note([key, i], `An entry of "${key}" should be a map with a name: not read`);
  }
  return out;
}

/** Open Data Product Standard v1 (bitol.io): `kind: DataProduct`. */
function readBitol(d: Obj, file: string, note: Note): Product | undefined {
  const name = str(d.name) ?? str(d.id);
  if (!name) return note([], 'A data product needs a name or an id: not read', 'error'), undefined;
  const p: Product = { file, name, domain: str(d.domain), owner: ownerOf(d.team), version: str(d.version), status: str(d.status), inputs: [], outputs: [], lineage: true };
  for (const [i, port] of entries(d, 'inputPorts', note)) {
    const input = { name: str(port.name), contract: str(port.contractId) };
    if (!input.name && !input.contract) note(['inputPorts', i], 'An input port needs a name or a contractId: not read');
    else p.inputs.push(input);
  }
  for (const [i, port] of entries(d, 'outputPorts', note)) {
    const contract = str(port.contractId);
    const portName = str(port.name) ?? contract;
    if (!portName) {
      note(['outputPorts', i], 'An output port needs a name: not read');
      continue;
    }
    p.outputs.push({ name: portName, kind: portKind(str(port.type)), contract });
    // Lineage written on the port itself: the contracts this output is made from.
    for (const [, c] of entries(port, 'inputContracts', (path, m, s) => note(['outputPorts', i, ...path], m, s))) {
      const id = str(c.id) ?? str(c.contractId);
      if (id && !p.inputs.some((x) => x.contract === id)) p.inputs.push({ contract: id });
    }
  }
  return p;
}

/** Open Data Product Specification v3 and v4 (opendataproducts.org): `product:` with its details per language. */
function readLinuxFoundation(d: Obj, file: string, note: Note): Product | undefined {
  const product = d.product as Obj;
  // v4 keeps the details under `details`, v3 under the language itself; English first, else whichever language is there.
  const perLanguage = isObj(product.details) ? product.details : product;
  const en = isObj(perLanguage.en) ? perLanguage.en : Object.values(perLanguage).find((v): v is Obj => isObj(v) && (!!str(v.name) || !!str(v.productID)));
  const name = str(en?.name) ?? str(en?.productID);
  if (!en || !name) return note(['product'], 'A data product needs a name or a productID: not read', 'error'), undefined;
  const holder = isObj(product.dataHolder) ? product.dataHolder : {};
  const categories = Array.isArray(en.categories) ? en.categories.map(str).filter(Boolean) : [];
  const p: Product = {
    file,
    name,
    domain: categories[0] ?? str(holder.businessDomain),
    owner: str(holder.legalName) ?? (isObj(holder.en) ? str(holder.en.legalName) : undefined),
    version: str(en.productVersion) ?? str(en.version),
    status: str(en.status),
    inputs: [],
    outputs: [],
    lineage: false,
  };
  const access = product.dataAccess;
  if (access != null && !isObj(access)) note(['product', 'dataAccess'], '"dataAccess" should be a map: not read');
  if (isObj(access)) {
    // v4: a map of named ways in, each with an outputPorttype; v3: one way in, described directly.
    const ways = Object.entries(access).filter((e): e is [string, Obj] => isObj(e[1]));
    const one = str(access.type) ?? str(access.format) ?? str(access.outputPorttype);
    if (one) p.outputs.push({ name: str(access.format) ?? one, kind: portKind(`${str(access.type) ?? ''} ${str(access.outputPorttype) ?? ''} ${str(access.format) ?? ''}`) });
    else
      for (const [key, way] of ways) {
        const named = isObj(way.name) ? (str(way.name.en) ?? Object.values(way.name).map(str).find(Boolean)) : str(way.name);
        const portName = named ?? (key === 'default' ? (str(way.format) ?? str(way.outputPorttype) ?? key) : key);
        p.outputs.push({ name: portName, kind: portKind(`${str(way.outputPorttype) ?? ''} ${str(way.type) ?? ''} ${str(way.format) ?? ''}`) });
      }
  }
  const contract = isObj(product.contract) ? str(product.contract.id) : undefined;
  if (contract) {
    if (!p.outputs.length) p.outputs.push({ name: 'data' });
    p.outputs[0]!.contract = contract;
  }
  return p;
}

// ---------------------------------------------------------------- the diagram

const COLLECTIONS = ['domains', 'sources', 'products', 'consumers', 'contracts'] as const;
/** Product keys in the order they are written; those the files speak for are replaced by an import, the others stay as they are. */
const PRODUCT_KEYS = ['label', 'caption', 'class', 'domain', 'owner', 'version', 'status', 'detail', 'file', 'inputs', 'outputs'];
const FROM_FILE = ['label', 'domain', 'owner', 'version', 'status', 'file'];

const equal = (a: unknown, b: unknown): boolean => {
  if (isObj(a) && isObj(b)) return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => k in b && equal(a[k], b[k]));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  return a === b;
};
const fromOf = (ref: unknown) => (typeof ref === 'string' ? ref : isObj(ref) ? str(ref.from) : undefined);

/**
 * The diagram as YAML. With an earlier diagram the files win for what they say (label, domain, owner,
 * version, status, ports and lineage); everything else stays: title, views, focus, consumers, products
 * and sources made by hand, a product's class, caption and detail, a port's own label or kind where
 * the file gives none. What an earlier import made and the files no longer have goes.
 */
function write(products: Product[], contracts: Map<string, ContractFile>, options: MeshOptions, problems: MeshProblem[]): string {
  let doc: Document;
  if (options.existing?.trim()) {
    doc = parseDocument(options.existing);
    const type = isMap(doc.contents) ? doc.get('type') : undefined;
    if (doc.errors.length || type !== 'data-products') {
      problems.push({ message: doc.errors.length ? `The diagram cannot be read (${doc.errors[0]!.message.split('\n')[0]}): not changed` : 'The diagram is not a data-products diagram: not changed', severity: 'error' });
      return '';
    }
  } else doc = new Document({ type: 'data-products', title: options.title ?? 'Data mesh' });
  const root = doc.contents as YAMLMap;
  const old = (doc.toJS() ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const before = (name: string): Record<string, unknown> => (isObj(old[name]) ? (old[name] as Record<string, unknown>) : {});
  const oldProducts = before('products');
  const oldContracts = before('contracts');

  // Ids: what an earlier import called a file's product or contract stays, so pins and references by hand hold.
  const fileOf = (v: unknown) => (isObj(v) ? str(v.file) : undefined);
  // A product whose file is gone gives its name back.
  const files = new Set(products.map((p) => p.file));
  const stays = Object.keys(oldProducts).filter((id) => !fileOf(oldProducts[id]) || files.has(fileOf(oldProducts[id])!));
  const taken = new Set([...Object.keys(before('sources')), ...Object.keys(before('consumers')), ...stays]);
  const free = (prefer: string, used: Set<string>) => {
    let id = prefer;
    for (let n = 2; used.has(id); n++) id = `${prefer}-${n}`;
    used.add(id);
    return id;
  };
  const productId = new Map<Product, string>();
  for (const p of products) {
    const was = Object.keys(oldProducts).find((id) => fileOf(oldProducts[id]) === p.file);
    productId.set(p, was ?? free(idOf(p.name), taken));
  }
  const contractKeys = new Set(Object.keys(oldContracts));
  const contractKey = new Map<string, string>();
  for (const c of contracts.values()) {
    const was = Object.keys(oldContracts).find((id) => fileOf(oldContracts[id]) === c.file);
    contractKey.set(c.id, was ?? free(idOf(c.name ?? baseName(c.file)), contractKeys));
  }

  // Who provides a contract: the product whose output port names it.
  const portIds = new Map<Product, string[]>();
  const provider = new Map<string, { product: Product; port: string }>();
  for (const p of products) {
    const used = new Set<string>();
    const ids = p.outputs.map((o) => free(idOf(o.name), used));
    portIds.set(p, ids);
    for (const [i, o] of p.outputs.entries()) {
      if (!o.contract) continue;
      const first = provider.get(o.contract);
      if (first && first.product !== p) problems.push({ file: p.file, message: `Contract "${o.contract}" is also an output of ${first.product.file}: input ports that name it are drawn from there`, severity: 'warning' });
      else provider.set(o.contract, { product: p, port: ids[i]! });
    }
  }

  const domains = new Map<string, Obj>();
  const sources = new Map<string, Obj>();
  const sourceIds = new Map<string, string>();
  const inputs = new Map<Product, unknown[]>();
  const reads = new Set<Product>();
  const read = new Set<Product>();
  for (const p of products) {
    const list: unknown[] = [];
    for (const port of p.inputs) {
      const from = port.contract ? provider.get(port.contract) : undefined;
      let ref: string;
      if (from) {
        if (from.product === p) continue;
        reads.add(p);
        read.add(from.product);
        ref = from.product.outputs.length === 1 ? productId.get(from.product)! : `${productId.get(from.product)}.${from.port}`;
      } else {
        // Nobody here provides it: it comes from outside, named by its contract when that file is here.
        const key = port.contract ?? port.name!;
        const label = (port.contract ? contracts.get(port.contract)?.name : undefined) ?? port.name ?? key;
        if (!sourceIds.has(key)) {
          const id = Object.keys(before('sources')).find((s) => s === idOf(label)) ?? free(idOf(label), taken);
          sourceIds.set(key, id);
          sources.set(id, { label, caption: OUTSIDE });
        }
        ref = sourceIds.get(key)!;
      }
      if (list.some((x) => fromOf(x) === ref)) continue;
      // The port's own name shows where it says more than what it reads.
      const plain = !port.name || !from || same(port.name, from.product.outputs[portIds.get(from.product)!.indexOf(from.port)]?.name) || same(port.name, from.product.name);
      list.push(plain ? ref : { from: ref, name: port.name });
    }
    inputs.set(p, list);
  }
  function same(a: string | undefined, b: string | undefined) {
    return !!a && !!b && idOf(a) === idOf(b);
  }

  const made = new Map<string, Obj>();
  for (const p of products) {
    const id = productId.get(p)!;
    if (p.domain && !domains.has(idOf(p.domain))) domains.set(idOf(p.domain), p.domain === idOf(p.domain) ? {} : { label: p.domain });
    const outputs: Record<string, Obj> = {};
    for (const [i, o] of p.outputs.entries()) {
      const port = portIds.get(p)![i]!;
      const known = o.contract ? contractKey.get(o.contract) : undefined;
      outputs[port] = { ...(o.kind ? { kind: o.kind } : {}), ...(o.name !== port ? { label: o.name } : {}), ...(known ? { contract: known } : {}) };
    }
    made.set(id, {
      ...(p.name !== id ? { label: p.name } : {}),
      // Nothing in the files says it: read from where a product stands in the lineage, and yours to correct.
      class: !reads.has(p) ? 'source-aligned' : read.has(p) ? 'aggregate' : 'consumer-aligned',
      ...(p.domain ? { domain: idOf(p.domain) } : {}),
      ...(p.owner ? { owner: p.owner } : {}),
      ...(p.version ? { version: p.version } : {}),
      // In use is what a reader expects: only the other states are worth a word on the card.
      ...(p.status && !/^(active|production)$/i.test(p.status) ? { status: p.status } : {}),
      file: p.file,
      ...(inputs.get(p)!.length ? { inputs: inputs.get(p) } : {}),
      ...(p.outputs.length ? { outputs } : {}),
    });
  }

  // Each collection: the map in the document (made when needed), entries set only where they change so comments stay.
  const mapOf = (name: (typeof COLLECTIONS)[number], make: boolean): YAMLMap | undefined => {
    const m = doc.get(name, true);
    if (isMap(m)) return m;
    if (!make) return undefined;
    const key = doc.createNode(name);
    key.spaceBefore = true;
    const value = doc.createNode({}) as YAMLMap;
    // In the order a reader expects, whatever was there first.
    const later = root.items.findIndex((pair) => isScalar(pair.key) && COLLECTIONS.indexOf(pair.key.value as never) > COLLECTIONS.indexOf(name));
    root.items.splice(later < 0 ? root.items.length : later, 0, doc.createPair(key, value) as never);
    return value;
  };
  const put = (name: (typeof COLLECTIONS)[number], id: string, value: Obj, shape: (node: YAMLMap) => void) => {
    if (equal(before(name)[id], value)) return;
    const node = doc.createNode(value) as YAMLMap;
    shape(node);
    mapOf(name, true)!.set(id, node);
  };
  const flowed = (node: YAMLMap) => void (node.flow = true);

  for (const [id, d] of domains) if (!(id in before('domains'))) put('domains', id, d, flowed);
  for (const [id, s] of sources) if (!(id in before('sources'))) put('sources', id, s, flowed);
  for (const [id, fresh] of made) {
    const p = products.find((x) => productId.get(x) === id)!;
    // An id an earlier product left behind is a new product: nothing of the old one is its.
    const was = isObj(oldProducts[id]) && fileOf(oldProducts[id]) === p.file ? (oldProducts[id] as Obj) : undefined;
    const merged: Obj = {};
    for (const key of [...PRODUCT_KEYS, ...Object.keys(was ?? {}).filter((k) => !PRODUCT_KEYS.includes(k))]) {
      const mine = was?.[key];
      let value: unknown;
      if (FROM_FILE.includes(key)) value = fresh[key];
      else if (key === 'class') value = mine ?? fresh.class;
      else if (key === 'inputs') value = p.lineage ? fresh.inputs : (mine ?? fresh.inputs);
      else if (key === 'outputs') {
        // A port keeps what was written on it by hand where the file says nothing about it.
        const ports = (fresh.outputs ?? {}) as Record<string, Obj>;
        const kept = isObj(mine) ? mine : {};
        value = Object.keys(ports).length ? Object.fromEntries(Object.entries(ports).map(([port, o]) => [port, { ...(isObj(kept[port]) ? (kept[port] as Obj) : {}), ...o }])) : undefined;
      } else value = mine;
      if (value !== undefined) merged[key] = value;
    }
    put('products', id, merged, (node) => {
      const ins = node.get('inputs', true);
      if (ins && typeof ins === 'object') (ins as { flow?: boolean }).flow = true;
      const outs = node.get('outputs', true);
      if (isMap(outs)) for (const pair of outs.items) if (isMap(pair.value)) pair.value.flow = true;
    });
  }
  for (const c of contracts.values()) {
    const id = contractKey.get(c.id)!;
    put('contracts', id, { ...(isObj(oldContracts[id]) ? (oldContracts[id] as Obj) : {}), file: c.file }, flowed);
  }

  // What an earlier import made and the files no longer have goes; what was made by hand stays.
  // ...unless something made by hand still reads it: that is for whoever made it to decide.
  const byHand = [...Object.values(oldProducts).filter((p) => isObj(p) && !fileOf(p)), ...Object.values(before('consumers'))].filter(isObj);
  const wanted = new Set(byHand.flatMap((x) => [...(Array.isArray(x.inputs) ? x.inputs : []), ...(Array.isArray(x.uses) ? x.uses : [])]).map((r) => fromOf(r)?.split('.')[0]));
  for (const [id, p] of Object.entries(oldProducts)) {
    if (!fileOf(p) || files.has(fileOf(p)!) || made.has(id)) continue;
    if (wanted.has(id)) problems.push({ message: `Product "${id}" is kept: ${fileOf(p)} is gone, but it is still read by what was added by hand`, severity: 'warning' });
    else mapOf('products', false)?.delete(id);
  }
  const now = (doc.toJS() ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const all = (name: string) => Object.values(isObj(now[name]) ? now[name]! : {}).filter(isObj);
  const refs = new Set([...all('products').flatMap((p) => (Array.isArray(p.inputs) ? p.inputs : [])), ...all('consumers').flatMap((c) => (Array.isArray(c.uses) ? c.uses : []))].map((r) => fromOf(r)?.split('.')[0]));
  for (const [id, s] of Object.entries(before('sources'))) if (!sources.has(id) && !refs.has(id) && isObj(s) && (s.caption === OUTSIDE || s.caption === OUTSIDE_BEFORE)) mapOf('sources', false)?.delete(id);
  const governed = new Set(all('products').flatMap((p) => Object.values(isObj(p.outputs) ? p.outputs : {}).map((o) => (isObj(o) ? o.contract : undefined))));
  const contractFiles = new Set([...contracts.values()].map((c) => c.file));
  for (const [id, c] of Object.entries(oldContracts)) if (fileOf(c) && !contractFiles.has(fileOf(c)!) && !governed.has(id)) mapOf('contracts', false)?.delete(id);
  const placed = new Set([...all('products'), ...all('sources'), ...all('consumers')].map((x) => x.domain));
  for (const [id, d] of Object.entries(before('domains'))) {
    const bare = d == null || typeof d === 'string' || (isObj(d) && Object.keys(d).every((k) => k === 'label'));
    if (!domains.has(id) && !placed.has(id) && bare) mapOf('domains', false)?.delete(id);
  }
  for (const name of COLLECTIONS) {
    const m = mapOf(name, false);
    if (m && !m.items.length) root.delete(name);
  }

  return doc.toString({ lineWidth: 0 }).split('\n').map(tight).join('\n');
}

/** Lists the way the examples write them: [a, { from: b }], not [ a, { from: b } ]. Only on a line whose value is such a list or map. */
function tight(line: string): string {
  const start = /^\s*(?:- )*(?:[\w.-]+: )?(?=[[{])/.exec(line)?.[0].length;
  if (start == null) return line;
  let out = line.slice(0, start);
  let quote = '';
  for (let i = start; i < line.length; i++) {
    const c = line[i]!;
    if (quote) quote = c === quote && !(quote === '"' && line[i - 1] === '\\') ? '' : quote;
    else if (c === '"' || c === "'") quote = c;
    else if (c === '#' && line[i - 1] === ' ') return out + line.slice(i);
    else if (c === ' ' && (line[i - 1] === '[' || line[i + 1] === ']')) continue;
    out += c;
  }
  return out;
}

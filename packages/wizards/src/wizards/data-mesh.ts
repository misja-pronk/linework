import { names, type Answers, type Wizard } from '../engine.ts';
import { comment, entry, file, flow, ids, scalar, slug } from '../yaml.ts';

const SOURCE = 'Zhamak Dehghani, "Data Mesh: Delivering Data-Driven Value at Scale" (O\'Reilly, 2022): domain ownership, data as a product (source-aligned, aggregate, consumer-aligned), self-serve platform, federated governance';

export const dataMesh: Wizard = {
  id: 'data-mesh',
  name: 'Data mesh',
  type: 'data-products',
  description: 'Domains that own their data products, from source systems to the people and tools that use them',
  source: SOURCE,
  questions: [
    { id: 'domains', kind: 'text', list: true, label: 'Which domains own data?', default: 'Customer, Sales, Finance', help: 'Names, separated by commas (1 to 5).' },
    { id: 'products', kind: 'number', label: 'How many source-aligned products per domain?', min: 1, max: 3, default: 1 },
    { id: 'aggregate', kind: 'yesno', label: 'An aggregate product that joins domains (a customer 360)?', default: true, when: (a) => names(a.domains).length > 1 },
    { id: 'consumerAligned', kind: 'yesno', label: 'A consumer-aligned product made for one use (KPIs, a feature set)?', default: true },
    {
      id: 'consumers',
      kind: 'multi',
      label: 'Who uses the data?',
      default: ['dashboard', 'ml'],
      options: [
        { value: 'dashboard', label: 'Dashboards' },
        { value: 'ml', label: 'ML models' },
        { value: 'application', label: 'Applications' },
        { value: 'report', label: 'Regulatory reports' },
      ],
    },
    { id: 'platform', kind: 'text', label: 'Which self-serve data platform do the domains build on?', default: 'Databricks', help: 'Shown in the subtitle; leave empty to leave it out.' },
  ],
  build,
};

/** Products a domain of that name usually owns first; others get generic names. */
const KNOWN: Record<string, [string, string][]> = {
  customer: [['Customers', 'table'], ['Consents', 'table'], ['Customer events', 'topic']],
  sales: [['Orders', 'table'], ['Returns', 'table'], ['Quotes', 'table']],
  finance: [['Payments', 'table'], ['Invoices', 'table'], ['General ledger', 'table']],
  marketing: [['Campaigns', 'table'], ['Leads', 'table'], ['Web analytics', 'topic']],
  logistics: [['Shipments', 'table'], ['Stock levels', 'table'], ['Carrier events', 'topic']],
  product: [['Catalogue', 'table'], ['Prices', 'table'], ['Product events', 'topic']],
  hr: [['Employees', 'table'], ['Absence', 'table'], ['Org units', 'table']],
};
const SYSTEMS: Record<string, [string, string]> = {
  customer: ['CRM', 'saas'],
  sales: ['Web shop', 'application'],
  finance: ['ERP', 'erp'],
  marketing: ['Marketing automation', 'saas'],
  logistics: ['Warehouse system', 'application'],
  product: ['PIM', 'application'],
  hr: ['HR system', 'saas'],
};

const consumerLabel: Record<string, [string, string]> = {
  dashboard: ['dashboard', 'Management dashboard'],
  ml: ['ml', 'Churn model'],
  application: ['application', 'Recommendations'],
  report: ['report', 'Regulatory report'],
};

function build(a: Answers): string {
  const domains = names(a.domains).slice(0, 5);
  if (!domains.length) domains.push('Sales');
  const dids = ids(domains);
  const per = Number(a.products);
  const platform = String(a.platform ?? '');
  const L: (string | false)[] = [];
  L.push(...comment(`Made by the data mesh wizard (carto new --wizard data-mesh). Follows ${SOURCE}.`));
  L.push('type: data-products');
  L.push('title: Data mesh');
  L.push(`subtitle: ${scalar([`${domains.length} ${domains.length === 1 ? 'domain' : 'domains'} own their data`, platform && `built on ${platform}`, 'federated governance'].filter(Boolean).join(' · '))}`);
  L.push('');
  L.push('domains:');
  domains.forEach((d, i) => L.push(entry(dids[i]!, { label: d, owner: `${d} team` })));
  L.push('');
  L.push(...comment('Operational systems: where the data starts, outside the mesh.'));
  L.push('sources:');
  const taken = new Set(dids);
  const sourceIds = domains.map((d, i) => {
    const [label, kind] = SYSTEMS[slug(d)] ?? [`${d} system`, 'application'];
    const id = ids([label], taken)[0]!;
    taken.add(id);
    L.push(entry(id, { kind, label, domain: dids[i] }));
    return id;
  });
  L.push('');
  L.push('products:');
  const firsts: string[] = [];
  domains.forEach((d, i) => {
    const list = KNOWN[slug(d)] ?? [[`${d} records`, 'table'], [`${d} events`, 'topic'], [`${d} reference data`, 'table']];
    list.slice(0, per).forEach(([label, port], k) => {
      const id = ids([label], taken)[0]!;
      taken.add(id);
      if (k === 0) firsts.push(id);
      L.push(`  ${id}:`);
      L.push(`    label: ${scalar(label)}`);
      L.push(`    class: source-aligned`);
      L.push(`    domain: ${dids[i]}`);
      L.push(`    inputs: [${sourceIds[i]}]`);
      L.push(`    outputs:`);
      L.push(`      ${slug(label)}: { kind: ${port} }`);
    });
  });
  let aggregate: string | undefined;
  if (a.aggregate && domains.length > 1) {
    const label = dids.includes('customer') ? 'Customer 360' : `${domains[0]} 360`;
    aggregate = ids([label], taken)[0]!;
    taken.add(aggregate);
    L.push(...comment('Aggregate: joins products of several domains into one shared view, owned by one of them.', 2));
    L.push(`  ${aggregate}:`);
    L.push(`    label: ${scalar(label)}`);
    L.push(`    class: aggregate`);
    L.push(`    domain: ${dids.includes('customer') ? 'customer' : dids[0]}`);
    L.push(`    inputs: ${flow(firsts.slice(0, 3))}`);
    L.push(`    outputs:`);
    L.push(`      profiles: { kind: table }`);
  }
  let fit: string | undefined;
  if (a.consumerAligned) {
    fit = ids(['KPIs'], taken)[0]!;
    taken.add(fit);
    L.push(...comment('Consumer-aligned: shaped for one use, close to the people who use it.', 2));
    L.push(`  ${fit}:`);
    L.push(`    label: KPIs`);
    L.push(`    class: consumer-aligned`);
    L.push(`    domain: ${dids[dids.length - 1]}`);
    L.push(`    inputs: ${flow(aggregate ? [aggregate, firsts[firsts.length - 1]!] : firsts.slice(-2))}`);
    L.push(`    outputs:`);
    L.push(`      kpis: { kind: api, label: KPI API }`);
  }
  const consumers = Array.isArray(a.consumers) ? a.consumers : [];
  if (consumers.length) {
    L.push('');
    L.push('consumers:');
    for (const c of consumers) {
      const [kind, label] = consumerLabel[c]!;
      // Dashboards and reports read the KPIs; models and applications the joined view.
      const uses = c === 'dashboard' || c === 'report' ? (fit ?? aggregate ?? firsts[0]!) : (aggregate ?? fit ?? firsts[0]!);
      L.push(entry(c, { kind, label, uses: [uses] }));
    }
  }
  const end = consumers.length ? consumers[0]! : (fit ?? aggregate);
  if (end && (fit || aggregate)) {
    const focusOn = fit ?? aggregate!;
    L.push('');
    L.push('views:');
    L.push(`  lineage:`);
    L.push(`    title: ${scalar(`Where ${fit ? 'the KPIs come' : `${aggregate} comes`} from`)}`);
    L.push(`    focus: { on: ${focusOn}, hops: all, direction: upstream }`);
  }
  L.push('');
  L.push('steps:');
  L.push(`  - title: Domains`);
  L.push(`    caption: ${scalar('Each domain owns its data and publishes it as products, with an owner, a version and a contract.')}`);
  L.push(`  - title: Source-aligned`);
  L.push(`    caption: ${scalar('Close to the systems they come from: the facts as the domain knows them.')}`);
  L.push(`    focus: ${flow(firsts)}`);
  if (aggregate || fit) {
    L.push(`  - title: Built on each other`);
    L.push(`    caption: ${scalar('Products use other products, never the source systems of another domain.')}`);
    L.push(`    focus: ${flow([aggregate, fit].filter((x): x is string => !!x))}`);
  }
  return file(L);
}

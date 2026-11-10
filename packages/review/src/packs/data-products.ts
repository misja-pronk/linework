// Data products: what a data governance review asks of a mesh, from the products as written.
import { parseSource } from '@cartography/core';
import { parseField, readOdcs } from '@cartography/data-products';
import type { Hit, Rule, Target } from '../types.ts';
import type { ReviewModel } from '../model.ts';

const pack = 'data-products';
const dp = ['data-products'];
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** The product's card, or the diagram when it is not drawn here. */
const productAt = (m: ReviewModel, id: string): Target => (m.nodes.has(id) ? { kind: 'node', id } : m.groups.has(id) ? { kind: 'group', id } : { kind: 'diagram' });

/** "orders", "orders.orders", { from: orders.orders }: the product and port a reference names. */
function refOf(r: unknown): { product: string; port?: string } | undefined {
  const s = typeof r === 'string' ? r : typeof obj(r).from === 'string' ? (obj(r).from as string) : undefined;
  if (!s) return undefined;
  const [product, port] = s.split('.');
  return { product: product!, ...(port ? { port } : {}) };
}

export const dataProductRules: Rule[] = [
  {
    id: 'data.output-without-contract',
    pack,
    title: 'Output ports that others read have a data contract',
    why: 'Without a contract a consumer builds on whatever the port happens to hold today, and every change of it breaks someone silently.',
    severity: 'warn',
    category: 'operations',
    appliesTo: dp,
    fix: 'Write a data contract for the port (contracts: with fields, SLA and quality, or file: an ODCS file) and set contract: on the port',
    docs: 'Open Data Contract Standard (ODCS)',
    check(m) {
      const products = obj(m.data.products);
      const used = new Set<string>();
      for (const p of Object.values(products)) for (const r of (obj(p).inputs as unknown[]) ?? []) {
        const ref = refOf(r);
        if (ref) used.add(`${ref.product}.${ref.port ?? '*'}`);
      }
      for (const c of Object.values(obj(m.data.consumers))) for (const r of (obj(c).uses as unknown[]) ?? []) {
        const ref = refOf(r);
        if (ref) used.add(`${ref.product}.${ref.port ?? '*'}`);
      }
      const hits: Hit[] = [];
      for (const [id, p] of Object.entries(products)) {
        const outputs = Object.entries(obj(obj(p).outputs));
        for (const [port, o] of outputs) {
          if (typeof obj(o).contract === 'string') continue;
          // A reference without a port reads the product's only port.
          if (!used.has(`${id}.${port}`) && !(outputs.length === 1 && used.has(`${id}.*`))) continue;
          const label = (obj(o).label as string | undefined) ?? port;
          hits.push({ on: productAt(m, id), message: `${m.name(id)}: output port ${label} is read by others and has no data contract`, path: ['products', id, 'outputs', port] });
        }
      }
      return hits;
    },
  },
  {
    id: 'data.pii-without-classification',
    pack,
    title: 'Contracts with personal data say how it is classified',
    why: 'Personal data without a classification gets copied, joined and kept like any other data: a GDPR breach waiting for an audit.',
    severity: 'warn',
    category: 'security',
    appliesTo: dp,
    fix: 'Set classification: on the contract (confidential, restricted, …) and keep the pii marks on the fields',
    docs: 'ODCS classification and GDPR data classification',
    check(m) {
      const hits: Hit[] = [];
      for (const [id, raw] of Object.entries(obj(m.data.contracts))) {
        const c = obj(raw);
        let classification = typeof c.classification === 'string' ? c.classification : undefined;
        let pii = Object.values(obj(c.fields)).some((f) => parseField(typeof f === 'string' ? f : null).marks.includes('pii'));
        if (typeof c.file === 'string' && m.load) {
          try {
            const read = readOdcs(parseSource(m.load(c.file)).data);
            if (typeof read !== 'string') {
              classification ??= read.classification;
              if (!Object.keys(obj(c.fields)).length) pii = read.schemas.some((s) => s.fields.some((f) => f.marks.includes('pii')));
            }
          } catch {
            // A file that cannot be read is the diagram's own error already.
          }
        }
        if (!pii || classification) continue;
        const user = Object.entries(obj(m.data.products)).find(([, p]) => Object.values(obj(obj(p).outputs)).some((o) => obj(o).contract === id));
        const on: Target = m.nodes.has(`contract:${id}`) ? { kind: 'node', id: `contract:${id}` } : user ? productAt(m, user[0]) : { kind: 'diagram' };
        hits.push({ on, message: `Contract ${(c.label as string | undefined) ?? id} has personal data and no classification`, path: ['contracts', id] });
      }
      return hits;
    },
  },
];

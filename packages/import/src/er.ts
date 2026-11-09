// Mermaid erDiagram → erd. Attributes become columns; a relationship whose child has a matching FK
// column becomes that column's "fk", so the line attaches to the row as in hand-written erd YAML.
import { flow, Ids, scalar, slug, type Warnings } from './text.ts';

interface Column {
  name: string;
  type: string;
  pk: boolean;
  fk: boolean;
  unique: boolean;
  target?: string;
}

interface Entity {
  source: string;
  id: string;
  label?: string;
  columns: Column[];
}

interface Relation {
  a: string;
  b: string;
  left: string;
  right: string;
  dashed: boolean;
  label?: string;
}

const NAME = String.raw`("[^"]+"|[\p{L}\p{N}_-]+)`;
const REL = new RegExp(String.raw`^${NAME}\s*(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s*${NAME}\s*(?::\s*(.*))?$`, 'u');
const BLOCK = new RegExp(String.raw`^${NAME}(?:\s*\[\s*"?([^"\]]*)"?\s*\])?\s*\{\s*(\})?\s*$`, 'u');
const ALONE = new RegExp(String.raw`^${NAME}(?:\s*\[\s*"?([^"\]]*)"?\s*\])?\s*$`, 'u');
const ATTR = /^([\w()[\],.-]+)\s+([\w-]+)((?:\s+(?:PK|FK|UK)\s*,?)*)\s*(?:"([^"]*)")?\s*$/i;

const unquote = (s: string) => (s.startsWith('"') ? s.slice(1, -1) : s);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const singular = (s: string) => s.replace(/(ies)$/, 'y').replace(/(ses|xes)$/, (m) => m.slice(0, -2)).replace(/s$/, '');

export function importEr(body: string[], title: string | undefined, warn: Warnings): string {
  const ids = new Ids();
  const entities = new Map<string, Entity>();
  const relations: Relation[] = [];
  const entity = (raw: string, label?: string) => {
    const source = unquote(raw);
    let e = entities.get(source);
    if (!e) entities.set(source, (e = { source, id: ids.get(source, slug(source).toLowerCase()), columns: [] }));
    if (label) e.label = label;
    return e;
  };

  let open: Entity | undefined;
  let comments = 0;
  for (const line of body) {
    const s = line.trim();
    if (!s) continue;
    if (open) {
      if (s === '}') {
        open = undefined;
        continue;
      }
      const a = ATTR.exec(s);
      if (!a) {
        warn.add(`Could not read the attribute "${s}"`);
        continue;
      }
      const keys = (a[3] ?? '').toUpperCase();
      if (a[4]) comments++;
      open.columns.push({ name: a[2]!, type: a[1]!, pk: keys.includes('PK'), fk: keys.includes('FK'), unique: keys.includes('UK') });
      continue;
    }
    const r = REL.exec(s);
    if (r) {
      relations.push({ a: entity(r[1]!).source, left: r[2]!, dashed: r[3] === '..', right: r[4]!, b: entity(r[5]!).source, label: r[6] ? unquote(r[6].trim()) || undefined : undefined });
      continue;
    }
    const b = BLOCK.exec(s);
    if (b) {
      const e = entity(b[1]!, b[2]);
      if (!b[3]) open = e;
      continue;
    }
    const alone = ALONE.exec(s);
    if (alone) {
      entity(alone[1]!, alone[2]);
      continue;
    }
    if (/^(direction|style|classDef|class)\b/.test(s)) {
      warn.onceFor('style', 'Styling and direction lines are not imported');
      continue;
    }
    warn.add(`Could not read "${s}"`);
  }
  if (comments) warn.add(`${comments} attribute comment${comments > 1 ? 's were' : ' was'} left out`);

  // Who is the child: the "many" side, or the optional side of a one-to-one.
  const many = (marker: string) => marker.includes('{') || marker.includes('}');
  const optional = (marker: string) => marker.includes('o');
  const out: { from: string; to: string; cardinality?: string; label?: string; dashed: boolean }[] = [];
  for (const r of relations) {
    const [ma, mb] = [many(r.left), many(r.right)];
    let from = r.a;
    let to = r.b;
    let cardinality: string | undefined;
    if (ma && mb) cardinality = 'many-to-many';
    else if (!ma && mb) [from, to] = [r.b, r.a];
    else if (!ma && !mb) {
      if (optional(r.right) && !optional(r.left)) [from, to] = [r.b, r.a];
      cardinality = optional(from === r.a ? r.left : r.right) ? 'zero-or-one-to-one' : 'one-to-one';
    }
    out.push({ from, to, cardinality, label: r.label, dashed: r.dashed });
  }

  // FK columns: find the parent they point at, by name first, else the only parent left.
  for (const e of entities.values()) {
    const parents = out.filter((o) => o.from === e.source && o.cardinality !== 'many-to-many').map((o) => o.to);
    const fks = e.columns.filter((c) => c.fk);
    for (const c of fks) {
      const n = norm(c.name);
      c.target = parents.find((p) => n.startsWith(singular(norm(p))) || n.startsWith(norm(p)));
    }
    const unmatched = fks.filter((c) => !c.target);
    const free = parents.filter((p) => !fks.some((c) => c.target === p));
    if (unmatched.length === 1 && free.length === 1) unmatched[0]!.target = free[0];
    for (const c of fks.filter((c) => !c.target)) warn.add(`${e.source}.${c.name} is a foreign key, but it is not clear to which table`);
  }

  const lines = ['type: erd'];
  if (title) lines.push(`title: ${scalar(title)}`);
  lines.push('', 'tables:');
  for (const e of entities.values()) {
    lines.push(`  ${e.id}:`);
    if (e.label && e.label !== e.source) lines.push(`    label: ${scalar(e.label)}`);
    if (!e.columns.length) {
      lines.push('    columns: {}');
      continue;
    }
    lines.push('    columns:');
    for (const c of e.columns) {
      const target = c.target && entities.get(c.target)!.id;
      const spec = [c.type, c.pk && 'pk', target && `fk ${target}`, c.unique && 'unique'].filter(Boolean).join(' ');
      lines.push(`      ${/^[\w-]+$/.test(c.name) ? c.name : JSON.stringify(c.name)}: ${scalar(spec)}`);
    }
  }

  // A relation the FK column already draws only needs writing when it adds a label or another cardinality.
  const rel: string[] = [];
  for (const o of out) {
    const child = entities.get(o.from)!;
    const parent = entities.get(o.to)!;
    const col = child.columns.find((c) => c.target === o.to);
    if (col && !o.label && !o.cardinality && !o.dashed) continue;
    // Same ends as the FK line (the parent's first key column), so this one replaces it instead of doubling it.
    const pk = parent.columns.find((c) => c.pk);
    const from = col ? `${child.id}.${col.name}` : child.id;
    const to = col && pk ? `${parent.id}.${pk.name}` : parent.id;
    const arrow = `${from} ${o.dashed ? '-->' : '->'} ${to}`;
    if (o.cardinality) rel.push(`  - ${arrow}: ${flow([['label', o.label], ['cardinality', o.cardinality]])}`);
    else rel.push(o.label ? `  - ${arrow}: ${scalar(o.label)}` : `  - ${arrow}`);
  }
  if (rel.length) lines.push('', 'relations:', ...rel);
  return lines.join('\n') + '\n';
}

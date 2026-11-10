import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importD2, importMarkdown, importText, languageOf } from '../src/index.ts';

async function clean(yaml: string) {
  const r = await render(yaml, { fonts: 'none' });
  expect(r.diagnostics, yaml).toEqual([]);
  return r;
}
const fixture = (name: string) => fs.readFileSync(new URL(`./d2/${name}`, import.meta.url), 'utf8');
const one = (text: string) => {
  const blocks = importD2(text, 'Test');
  expect(blocks).toHaveLength(1);
  return { ...blocks[0]!, d: parse(blocks[0]!.yaml) };
};

describe('D2 syntax', () => {
  it('reads shapes, labels, nested containers and dot paths', async () => {
    const { d, yaml } = one(`
direction: right
customer: Customer {shape: person}
shop: Web shop {
  web: Storefront
  api: Orders API
}
shop.db: Orders DB {shape: cylinder}
customer -> shop.web: HTTPS
shop.web -> shop.api: REST
shop.api -> shop.db: SQL
`);
    expect(d).toMatchObject({ type: 'systems', direction: 'right' });
    expect(d.groups).toEqual({ shop: { kind: 'group', label: 'Web shop' } });
    expect(d.nodes).toMatchObject({
      customer: { kind: 'user', label: 'Customer' },
      web: { kind: 'client', label: 'Storefront', in: 'shop' },
      api: { kind: 'api', label: 'Orders API', in: 'shop' },
      db: { kind: 'database', label: 'Orders DB', in: 'shop' },
    });
    expect(d.edges).toEqual([{ 'customer -> web': 'HTTPS' }, { 'web -> api': 'REST' }, { 'api -> db': 'SQL' }]);
    await clean(yaml);
  });

  it('reads every arrow, chains with one label, and connections written inside a container', async () => {
    const { d, yaml } = one(`
a -> b -> c: calls
d <- c
e <-> d
e -- a
box: {
  x -> y
  x -> _.a
}
`);
    expect(d.edges).toEqual([{ 'a -> b': 'calls' }, { 'b -> c': 'calls' }, 'c -> d', 'e <-> d', 'e -- a', 'x -> y', 'x -> a']);
    expect(d.nodes.x).toMatchObject({ in: 'box' });
    await clean(yaml);
  });

  it('skips comments, block comments and semicolons, and reads quoted keys and block strings', async () => {
    const { d, yaml } = one(`
# a comment
"""
a block comment -> with an arrow
"""
a: Alpha; b: Beta # trailing comment
"the gateway": |md
  # API gateway
  routes **everything**
|
a -> "the gateway" -> b
`);
    expect(Object.keys(d.nodes)).toEqual(['a', 'b', 'the-gateway']);
    expect(d.nodes['the-gateway']).toBe('gateway'); // "API gateway" is the kind's own label
    await clean(yaml);
  });

  it('fills in vars and warns about what it does not know', () => {
    const { d, warnings } = one(`
vars: { env: prod; db: { name: orders } }
api: API \${env}
db: \${db.name} DB {shape: cylinder}
x: \${nope}
api -> db
`);
    expect(d.nodes.api.label).toBe('API prod');
    expect(d.nodes.db.label).toBe('orders DB');
    expect(warnings.join('\n')).toMatch(/\$\{nope\} is not set/);
  });

  it('takes a title from a text near the top, and drops other text shapes and styles with a note', () => {
    const { d, warnings } = one(`
title: Checkout {near: top-center; shape: text}
explain: This is how it works {shape: text}
a: A {style.fill: red; width: 200}
b: B {near: bottom-right}
a -> b {style.stroke-dash: 3}
classes: { x: { style.fill: blue } }
`);
    expect(d.title).toBe('Checkout');
    expect(d.nodes).not.toHaveProperty('explain');
    expect(d.edges).toEqual([{ 'a -> b': { style: 'async' } }]);
    const w = warnings.join('\n');
    expect(w).toMatch(/Styles/);
    expect(w).toMatch(/Sizes and positions/);
    expect(w).toMatch(/Classes/);
    expect(w).toMatch(/near:/);
    expect(w).toMatch(/Text and code shapes are left out: explain/);
  });

  it('removes what is set to null, and warns about imports and edge references', () => {
    const { d, warnings } = one(`
...@shared
a -> b
c -> b
c: null
(a -> b)[0].style.stroke: red
`);
    expect(Object.keys(d.nodes)).toEqual(['a', 'b']);
    expect(d.edges).toEqual(['a -> b']);
    expect(warnings.join('\n')).toMatch(/Imports .* not followed/);
    expect(warnings.join('\n')).toMatch(/\(a -> b\)\[0\]/);
  });

  it('turns shapes and icons into kinds', () => {
    const { d } = one(`
users: Shoppers {shape: person}
cache: Redis {shape: cylinder}
store: Files {shape: stored_data}
q: Jobs {shape: queue}
fn: Resize {icon: https://icons.terrastruct.com/aws%2FCompute%2FAWS-Lambda.svg}
pg: Main {icon: https://icons.terrastruct.com/dev%2Fpostgresql.svg}
`);
    expect(Object.fromEntries(Object.entries(d.nodes).map(([k, v]) => [k, (v as { kind: string }).kind]))).toEqual({
      users: 'users', cache: 'cache', store: 'storage', q: 'queue', fn: 'function', pg: 'database',
    });
  });

  it('class shapes come in as a class diagram with their fields and methods', () => {
    const [b] = importD2('Order: {shape: class; +id: uuid; -lines: "[]Line"; total(): Money}\nLine: {shape: class}\nOrder -> Line: has\n', 'shop');
    expect(parse(b!.yaml)).toEqual({ type: 'class', title: 'shop', classes: { Order: { members: [{ '+id': 'uuid' }, '-lines: []Line', '+total(): Money'] }, Line: null }, relations: [{ 'Order --> Line': 'has' }] });
    // Beside other boxes they are boxes in the architecture, and a class diagram of their own.
    const both = importD2('web -> api\nOrder: {shape: class; +id: uuid}\n', 'mixed');
    expect(both.map((x) => x.name)).toEqual(['architecture', 'classes']);
    expect(both[1]!.yaml).toMatch(/^type: class/);
  });
});

describe('D2 targets', () => {
  it('a cloud diagram when the icons say AWS, with the products as kinds and the tables as an erd', async () => {
    const blocks = importD2(fixture('aws-shop.d2'), 'aws-shop');
    expect(blocks.map((b) => b.name)).toEqual(['architecture', 'tables']);
    const d = parse(blocks[0]!.yaml);
    expect(d).toMatchObject({ type: 'cloud', provider: 'aws', title: 'Web shop on AWS', direction: 'right' });
    expect(d.groups).toMatchObject({ aws: { kind: 'aws' }, vpc: { kind: 'vpc', label: 'VPC eu-west-1' }, public: { kind: 'subnet' }, private: { kind: 'subnet' } });
    expect(d.nodes).toMatchObject({ cdn: { kind: 'cloudfront' }, alb: { kind: 'alb' }, api: { kind: 'ecs' }, worker: { kind: 'lambda' }, db: { kind: 'rds' }, queue: { kind: 'sqs' }, assets: { kind: 's3' }, stripe: { kind: 'external' } });
    expect(d.nodes).not.toHaveProperty('orders');
    await clean(blocks[0]!.yaml);
    const erd = parse(blocks[1]!.yaml);
    expect(erd.tables.orders.columns).toEqual({ id: 'uuid pk', customer_id: 'uuid fk customers.id', total: 'numeric(10,2)', placed_at: 'timestamptz' });
    expect(erd.tables.customers.columns).toEqual({ id: 'uuid pk', email: 'text unique' });
    await clean(blocks[1]!.yaml);
  });

  it('only tables: one erd, keys from constraints and connections either way round', async () => {
    const { d, yaml } = one(`
users: {
  shape: sql_table
  id: int {constraint: primary_key}
  email: varchar(255) {constraint: [unique]}
}
posts: Blog posts {
  shape: sql_table
  id: int {constraint: primary_key}
  author_id: int {constraint: foreign_key}
}
users.id <- posts.author_id: writes
`);
    expect(d.type).toBe('erd');
    expect(d.tables.posts).toEqual({ label: 'Blog posts', columns: { id: 'int pk', author_id: 'int fk users.id' } });
    expect(d.tables.users.columns.email).toBe('varchar(255) unique');
    expect(d.relations).toEqual([{ 'posts.author_id -> users.id': 'writes' }]);
    await clean(yaml);
  });

  it('a sequence_diagram: actors, messages in order, groups as frames, notes and spans', async () => {
    const blocks = importD2(fixture('login-sequence.d2'), 'Login');
    expect(blocks).toHaveLength(1);
    const d = parse(blocks[0]!.yaml);
    expect(d.type).toBe('sequence');
    expect(d.participants).toMatchObject({ user: { kind: 'person' }, idp: { kind: 'identity' }, db: { kind: 'database' } });
    expect(d.messages[4]).toEqual({ 'idp --> app': 'Authorization code' });
    expect(d.messages[7]).toMatchObject({ loop: 'until the session expires' });
    expect(d.messages[7].messages).toHaveLength(4);
    expect(d.messages[8]).toEqual({ note: 'Keeps the refresh token server side', over: 'app' });
    expect(d.messages[9]).toMatchObject({ alt: 'token expired' });
    await clean(blocks[0]!.yaml);

    const spans = importD2('shape: sequence_diagram\na; b\na.t1 -> b: hi\nb -> a.t1: ok', 'S');
    expect(parse(spans[0]!.yaml).messages).toEqual([{ 'a -> b': 'hi' }, { 'b -> a': 'ok' }]);
    expect(spans[0]!.warnings.join('\n')).toMatch(/Spans/);
  });

  it('a sequence_diagram inside an architecture is a diagram of its own', () => {
    const blocks = importD2('api -> db\nflow: Login {\n  shape: sequence_diagram\n  a -> b: hi\n}', 'T');
    expect(blocks.map((b) => [b.name, parse(b.yaml).type])).toEqual([['architecture', 'systems'], ['Login', 'sequence']]);
    expect(parse(blocks[0]!.yaml).nodes).not.toHaveProperty('flow');
  });

  it('steps build the drawing up', async () => {
    const { d, yaml } = one(fixture('steps.d2'));
    expect(d.steps).toEqual([{ title: 'Start', show: ['web', 'api'] }, { title: '1', show: ['db'] }, { title: '2', show: ['cache'] }]);
    await clean(yaml);
  });

  it('scenarios are views, layers diagrams of their own', async () => {
    const blocks = importD2(`
a -> b
scenarios: {
  failover: { c: Standby DB {shape: cylinder}; b -> c }
}
layers: {
  inside: { x -> y }
}
`, 'Main');
    expect(blocks.map((b) => b.name)).toEqual(['architecture', 'inside']);
    const d = parse(blocks[0]!.yaml);
    expect(d.views).toEqual({ main: { title: 'Main', exclude: ['c'] }, failover: { title: 'Main: failover' } });
    expect(parse(blocks[1]!.yaml).edges).toEqual(['x -> y']);
    for (const b of blocks) await clean(b.yaml);
  });
});

describe('finding the language', () => {
  it('knows D2 by its ending and by how it looks', () => {
    expect(languageOf('a -> b', 'x.d2')).toBe('d2');
    expect(languageOf('direction: right\na -> b: hi')).toBe('d2');
    expect(languageOf('shop: {\n  api\n}')).toBe('d2');
    expect(languageOf('flowchart LR\n  a --> b')).toBe('mermaid');
    expect(importText('a -> b', 'thing.d2')[0]).toMatchObject({ line: 0 });
    expect(parse(importText('a -> b', 'thing.d2')[0]!.yaml).title).toBe('thing');
  });

  it('reads ```d2 blocks in Markdown', () => {
    const blocks = importMarkdown('# Shop\n\n```d2\na -> b\n```\n\n```mermaid\nflowchart LR\n  x --> y\n```\n');
    expect(blocks.map((b) => [b.line, parse(b.yaml).title])).toEqual([[3, 'Shop'], [7, 'Shop']]);
  });

  it('an empty text says so', () => {
    expect(importD2('# nothing', 'x')[0]).toEqual({ yaml: '', warnings: ['The D2 text has no shapes'] });
  });
});

describe('D2 review findings', () => {
  const azure = `direction: right
users: Users {shape: person}
cloud: Azure {
  fd: Front Door
  app: App Service
  db: SQL {shape: cylinder}
  fd -> app: HTTPS
  app -> db: SQL {style.stroke-dash: 3}
}
users -> cloud.fd
vars: { d2-config: { theme-id: 4 } }
`;
  it('names Azure, AWS and GCP products by their own names; a dashed line stays dashed', async () => {
    const { d, yaml, warnings } = one(azure);
    expect(d).toMatchObject({ type: 'cloud', provider: 'azure', captions: 'written' });
    expect(d.nodes.fd).toEqual({ kind: 'front-door', label: 'Front Door', in: 'cloud' });
    expect(d.nodes.app).toMatchObject({ kind: 'app-service' });
    expect(d.edges).toContainEqual({ 'app -> db': { label: 'SQL', line: 'dashed' } });
    expect(warnings).toContain("vars.d2-config (D2's theme, layout engine and sketch mode) is left out: the theme and the layout are Cartography's");
    // No caption the source never wrote, and none blanked one by one.
    expect(yaml).not.toContain('caption:');
    const r = await clean(yaml);
    expect(r.graph!.nodes.find((n) => n.id === 'db')!.shape).not.toHaveProperty('caption', 'SQL Database');
    expect(r.graph!.edges.find((e) => e.from.node === 'app')!.line).toBe('dashed');
    const aws = one('aws: AWS {\n  t: Transit Gateway\n  f: Data Firehose\n  d: DynamoDB\n}\n').d;
    expect([aws.nodes.t.kind, aws.nodes.f.kind, aws.nodes.d.kind]).toEqual(['transit-gateway', 'firehose', 'dynamodb']);
    const gcp = one('gcp: Google Cloud {\n  a: Cloud Armor\n  l: Looker\n  o: Orders service\n}\n').d;
    expect([gcp.nodes.a.kind, gcp.nodes.l.kind, gcp.nodes.o.kind]).toEqual(['cloud-armor', 'looker', 'service']);
  });

  it('a dashed line without a cloud is asynchronous', () => {
    expect(one('a -> b: {style.stroke-dash: 3}\n').d.edges).toEqual([{ 'a -> b': { style: 'async' } }]);
  });
});

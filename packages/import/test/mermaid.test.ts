import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { guessKind, importMarkdown, importMermaid } from '../src/index.ts';

async function clean(yaml: string) {
  const r = await render(yaml, { fonts: 'none' });
  expect(r.diagnostics, yaml).toEqual([]);
  return r;
}

describe('flowchart', () => {
  const shop = `---
title: Checkout
---
flowchart LR
    %% the customer side
    U((Customer)) -->|browses| W[Web shop]
    W --> GW{{API Gateway}}
    subgraph backend [Backend services]
      direction TB
      GW --> O[Order Service] & P(Payment Service)
      O --> DB[(Orders)]
      O -.->|OrderPlaced| Q[[order-events queue]]
      Q -.-> M[Mailer worker]
    end
    P == charge ==> S[Stripe]
    O --- C[(Redis cache)]
    classDef hot fill:#f96
    class O hot
`;

  it('maps shapes and words to kinds, subgraphs to groups, links to styles', async () => {
    const { yaml, warnings } = importMermaid(shop);
    const d = parse(yaml);
    expect(d).toMatchObject({ type: 'systems', title: 'Checkout' });
    expect(d.direction).toBeUndefined();
    expect(d.groups).toEqual({ backend: { kind: 'system', label: 'Backend services' } });
    expect(d.nodes).toEqual({
      U: { kind: 'user', label: 'Customer' },
      W: { kind: 'client', label: 'Web shop' },
      GW: { kind: 'gateway', label: 'API Gateway', in: 'backend' },
      O: { kind: 'service', label: 'Order Service', in: 'backend' },
      P: { kind: 'payments', label: 'Payment Service', in: 'backend' },
      DB: { kind: 'database', label: 'Orders', in: 'backend' },
      Q: { kind: 'queue', label: 'order-events queue', in: 'backend' },
      M: { kind: 'worker', label: 'Mailer worker', in: 'backend' },
      S: { kind: 'payments', label: 'Stripe' },
      C: { kind: 'cache', label: 'Redis cache' },
    });
    expect(d.edges).toEqual([
      { 'U -> W': 'browses' },
      'W -> GW',
      'GW -> O',
      'GW -> P',
      'O -> DB',
      { 'O -> Q': { label: 'OrderPlaced', style: 'async' } },
      { 'Q -> M': { style: 'async' } },
      { 'P -> S': { label: 'charge', style: 'sync' } },
      'O -- C',
    ]);
    expect(warnings).toEqual([
      'Subgraph directions are not imported: the whole diagram uses one direction',
      'Styling (classDef) is not imported: Cartography colours by kind',
    ]);
    await clean(yaml);
  });

  it('reads the older graph syntax, text links, quotes and odd ids', async () => {
    const { yaml, warnings } = importMermaid(`graph TD;
  A["Mobile app<br/>(iOS & Android)"]-- "HTTPS" -->B(Load balancer);
  B-->C1[fa:fa-server App server 1]
  B-->C2[App server 2]
  C1 & C2 --> D[("Postgres primary")]
  D -. replicates .-> E[(Read replica)]
  C1 <--> X>External CRM]
  C2 ~~~ X
  C2 --x D
  F{Is cached?}
  D.backup --> F
`);
    const d = parse(yaml);
    expect(d.direction).toBe('down');
    expect(d.nodes.A).toEqual({ kind: 'mobile', label: 'Mobile app (iOS & Android)' });
    expect(d.nodes.B).toBe('load-balancer');
    expect(d.nodes.C1).toEqual({ kind: 'server', label: 'App server 1' });
    expect(d.nodes.D).toEqual({ kind: 'database', label: 'Postgres primary' });
    expect(d.nodes.X).toEqual({ kind: 'external', label: 'External CRM' });
    expect(d.nodes['D-backup']).toEqual({ kind: 'service', label: 'D.backup' });
    expect(d.edges).toContainEqual({ 'A -> B': 'HTTPS' });
    expect(d.edges).toContainEqual({ 'D -> E': { label: 'replicates', style: 'async' } });
    expect(d.edges).toContainEqual('C1 <-> X');
    expect(d.edges).toContainEqual('C2 -> D');
    expect(warnings).toEqual([
      'Circle and cross arrow ends (--o, --x) are drawn as arrows',
      'Decision shapes ({…}) become ordinary cards: Cartography draws systems, not flow logic',
      'Invisible links (~~~) are left out',
    ]);
    await clean(yaml);
  });

  it('nests subgraphs, links to subgraphs and reads the @{ } shape syntax', async () => {
    const { yaml } = importMermaid(`flowchart LR
  subgraph aws [AWS eu-west-1]
    subgraph vpc [Private VPC]
      api@{ shape: rect, label: "Orders API" }
      db@{ shape: cyl, label: "orders" }
    end
  end
  subgraph "Ops team"
    graf[Grafana]
  end
  user[Browser] --> aws
  api --> db
  api -.->|metrics| graf
`);
    const d = parse(yaml);
    expect(d.groups).toEqual({ aws: { kind: 'cloud', label: 'AWS eu-west-1' }, vpc: { kind: 'zone', label: 'Private VPC', in: 'aws' }, 'Ops-team': { kind: 'team', label: 'Ops team' } });
    expect(d.nodes.db).toEqual({ kind: 'database', label: 'orders', in: 'vpc' });
    expect(d.nodes.api).toEqual({ kind: 'api', label: 'Orders API', in: 'vpc' });
    expect(d.edges).toEqual(['user -> aws', 'api -> db', { 'api -> graf': { label: 'metrics', style: 'dotted' } }]);
    await clean(yaml);
  });

  it('quotes labels that YAML would misread', () => {
    const { yaml } = importMermaid('flowchart LR\n  a["yes"] -->|"#1: fast, {cheap}"| b["Price: 10"]\n');
    expect(parse(yaml)).toMatchObject({ nodes: { a: { label: 'yes' }, b: { label: 'Price: 10' } }, edges: [{ 'a -> b': '#1: fast, {cheap}' }] });
  });
});

describe('architecture-beta', () => {
  it('maps groups, services, icons and dissolves junctions', async () => {
    const { yaml, warnings } = importMermaid(`architecture-beta
    group api(cloud)[API]
    group private(server)[Private network] in api

    service db(database)[Database] in private
    service disk1(disk)[Storage] in private
    service server(server)[Server] in api
    service gateway(internet)[Gateway]
    service fn(logos:aws-lambda)[Resize] in api
    junction j

    db:L -- R:server
    disk1:T -- B:server
    gateway:R --> L:server
    server:B -- T:j
    j:R -- L:fn
    j:B -- T:db
`);
    const d = parse(yaml);
    expect(d.direction).toBeUndefined();
    expect(d.groups).toEqual({ api: { kind: 'cloud', label: 'API' }, private: { kind: 'zone', label: 'Private network', in: 'api' } });
    expect(d.nodes).toEqual({
      db: { kind: 'database', in: 'private' },
      disk1: { kind: 'storage', label: 'Storage', in: 'private' },
      server: { kind: 'server', in: 'api' },
      gateway: { kind: 'gateway', label: 'Gateway' },
      fn: { kind: 'function', label: 'Resize', in: 'api' },
    });
    expect(d.edges).toEqual(['db -- server', 'disk1 -- server', 'gateway -> server', 'server -- fn', 'server -- db']);
    expect(warnings).toEqual(['Junctions are replaced by direct lines between what they join']);
    await clean(yaml);
  });
});

describe('erDiagram', () => {
  it('turns entities into tables and FK attributes into fk columns', async () => {
    const { yaml, warnings } = importMermaid(`erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    PRODUCT ||--o{ LINE-ITEM : "ordered in"
    CUSTOMER ||--o| LOYALTY-CARD : holds
    CUSTOMER {
        string id PK
        string name
        string email UK "login"
    }
    ORDER {
        int id PK
        string customer_id FK
        datetime placed_at
    }
    LINE-ITEM {
        int order_id PK, FK
        string product_code PK, FK
        int quantity
    }
    PRODUCT {
        string code PK
        decimal(10,2) price
    }
`);
    const d = parse(yaml);
    expect(d.type).toBe('erd');
    expect(d.tables.order.columns).toEqual({ id: 'int pk', customer_id: 'string fk customer', placed_at: 'datetime' });
    expect(d.tables.customer.columns.email).toBe('string unique');
    expect(d.tables['line-item'].columns).toEqual({ order_id: 'int pk fk order', product_code: 'string pk fk product', quantity: 'int' });
    expect(d.tables['loyalty-card']).toEqual({ columns: {} });
    expect(d.relations).toEqual([
      { 'order.customer_id -> customer.id': 'places' },
      { 'line-item.order_id -> order.id': 'contains' },
      { 'line-item.product_code -> product.code': 'ordered in' },
      { 'loyalty-card -> customer': { label: 'holds', cardinality: 'zero-or-one-to-one' } },
    ]);
    expect(warnings).toEqual(['1 attribute comment was left out']);
    const r = await clean(yaml);
    expect(r.graph!.edges).toHaveLength(4);
  });

  it('reads many-to-many, dashed lines and aliases', async () => {
    const { yaml, warnings } = importMermaid(`erDiagram
    p[Person] {
      string name
      int team_id FK
    }
    STUDENT }|..|{ COURSE : enrolls
    p }o--|| TEAM : "member of"
    p ||--|| BADGE : wears
`);
    const d = parse(yaml);
    expect(d.tables.p.label).toBe('Person');
    expect(d.relations).toEqual([
      { 'student --> course': { label: 'enrolls', cardinality: 'many-to-many' } },
      { 'p.team_id -> team': 'member of' },
      { 'p -> badge': { label: 'wears', cardinality: 'one-to-one' } },
    ]);
    expect(warnings).toEqual([]);
    await clean(yaml);
  });
});

describe('markdown and other inputs', () => {
  it('imports every mermaid block, titled by the heading above it', () => {
    const blocks = importMarkdown(`# Docs

## Request flow

\`\`\`mermaid
flowchart LR
  a[Browser] --> b[API]
\`\`\`

Some text.

\`\`\`js
const x = 1;
\`\`\`

## Calls

~~~mermaid
sequenceDiagram
  a->>b: hi
~~~
`);
    expect(blocks.map((b) => [b.line, parse(b.yaml || '{}').title, b.warnings.length])).toEqual([
      [5, 'Request flow', 0],
      [18, undefined, 1],
    ]);
    expect(blocks[1]!.warnings[0]).toContain('"sequenceDiagram" diagrams cannot be imported');
  });

  it('guesses kinds from words without mistaking services for people', () => {
    expect(['Users', 'Admin', 'User Service', 'User DB', 'Customer events', 'Kafka consumer', 'Web server', 'Web app', 'S3 bucket', 'Auth0'].map((l) => guessKind(l))).toEqual([
      'users',
      'user',
      undefined,
      'database',
      'topic',
      'worker',
      'server',
      'client',
      'storage',
      'identity',
    ]);
  });
});

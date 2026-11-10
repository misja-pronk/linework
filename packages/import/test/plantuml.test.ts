import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { render } from '@cartography/engine';
import { importMarkdown, importPlantUml, importText, languageOf } from '../src/index.ts';

async function clean(yaml: string) {
  const r = await render(yaml, { fonts: 'none' });
  expect(r.diagnostics, yaml).toEqual([]);
  return r;
}
const fixture = (name: string) => fs.readFileSync(new URL(`./plantuml/${name}`, import.meta.url), 'utf8');
const one = (text: string) => {
  const blocks = importPlantUml(text, 'Test');
  expect(blocks).toHaveLength(1);
  return { ...blocks[0]!, d: blocks[0]!.yaml ? parse(blocks[0]!.yaml) : undefined };
};

describe('PlantUML sequence', () => {
  it('reads participants, arrows, activations, frames, notes, dividers and autonumber', async () => {
    const { d, yaml, warnings } = one(fixture('checkout-sequence.puml'));
    expect(d).toMatchObject({ type: 'sequence', title: 'Checkout with card payment', autonumber: true, activations: 'explicit' });
    expect(d.participants).toMatchObject({
      user: { kind: 'person', label: 'Shopper' },
      web: { kind: 'client', label: 'Storefront' },
      api: { kind: 'api', label: 'Orders API' },
      db: { kind: 'database', label: 'Orders DB' },
      bus: { kind: 'queue', label: 'order-events' },
      psp: { kind: 'payments', label: 'Stripe' },
    });
    expect(d.messages[1]).toEqual({ 'web -> +api': 'POST /orders' });
    expect(d.messages[4]).toEqual({ divider: 'Payment' });
    expect(d.messages[6]).toEqual({ 'psp --> -api': 'client secret' });
    expect(d.messages[7].else).toHaveProperty('card declined');
    expect(d.messages[7].messages[0]).toEqual({ 'psp ->> api': 'webhook succeeded' });
    expect(d.messages[9]).toEqual({ note: 'The browser never decides that an order is paid', over: ['web', 'api'] });
    // return answers the call that is still open: web -> api ++.
    expect(d.messages[10]).toEqual({ 'api --> -web': '201 Created' });
    expect(warnings).toEqual(['skinparam and themes are left out: the theme draws each kind its own way']);
    await clean(yaml);
  });

  it('reads arrows backwards, lost, from outside, multi-line notes, refs, boxes and delays', async () => {
    const { d, yaml, warnings } = one(`@startuml
box "Shop" #LightBlue
participant A
participant B
end box
A <- B : back
A ->x B : lost
[-> A : from outside
A -[#red]> B : coloured
note left of A
  two
  lines
end note
ref over A, B : Login
... five minutes later ...
group Retry [3 times]
  A -> B
end
@enduml`);
    expect(d.boxes).toEqual({ shop: 'Shop' });
    expect(d.participants.A).toEqual({ kind: 'service', box: 'shop' });
    expect(d.messages.slice(0, 6)).toEqual([
      { 'B -> A': 'back' },
      { 'A -x B': 'lost' },
      { 'Outside -> A': 'from outside' },
      { 'A -> B': 'coloured' },
      { note: 'two lines', left: 'A' },
      { ref: 'Login', over: ['A', 'B'] },
    ]);
    expect(d.messages[6]).toEqual({ divider: 'five minutes later' });
    expect(d.messages[7]).toMatchObject({ group: 'Retry' });
    expect(warnings.join('\n')).toMatch(/Delays/);
    expect(warnings.join('\n')).toMatch(/outside/);
    await clean(yaml);
  });

  it('without activations the drawing keeps ours', () => {
    const { d } = one('Alice -> Bob : hi\nBob --> Alice : hello');
    expect(d.activations).toBeUndefined();
    expect(d.messages).toEqual([{ 'Alice -> Bob': 'hi' }, { 'Bob --> Alice': 'hello' }]);
  });
});

describe('PlantUML component and deployment', () => {
  it('elements, containers as groups, relations with labels, dotted lines async', async () => {
    const { d, yaml, warnings } = one(fixture('deployment.puml'));
    expect(d).toMatchObject({ type: 'systems', title: 'Shop deployment', direction: 'right' });
    expect(d.groups).toMatchObject({ dmz: { kind: 'zone', label: 'DMZ' }, 'kubernetes-cluster': { kind: 'cluster', label: 'Kubernetes cluster' } });
    expect(d.nodes).toMatchObject({
      customer: { kind: 'user' },
      internet: { kind: 'external' },
      lb: { kind: 'load-balancer', in: 'dmz' },
      events: { kind: 'queue', in: 'kubernetes-cluster' },
      db: { kind: 'database' },
      payments: { kind: 'api', label: 'Payments API' },
    });
    expect(d.edges).toContainEqual({ 'api -> events': { label: 'OrderPlaced', style: 'async' } });
    expect(warnings.join('\n')).toMatch(/Notes are left out/);
    await clean(yaml);
  });

  it('bracket components, interfaces, arrows with direction hints, reversed and plain lines, hidden ones skipped', async () => {
    const { d, yaml } = one(`
[Web App] as web
() "REST" as rest
web -up-> rest : calls
rest <.. [Worker]
web -- [Worker]
web -[hidden]-> rest
component Api {
  [Handler]
}
`);
    expect(d.nodes).toMatchObject({ web: { kind: 'client' }, rest: { kind: 'api' }, worker: 'worker', handler: { in: 'api' } });
    expect(d.groups).toEqual({ api: { kind: 'group', label: 'Api' } });
    expect(d.edges).toEqual([{ 'web -> rest': 'calls' }, { 'worker -> rest': { style: 'async' } }, 'web -- worker']);
    await clean(yaml);
  });
});

describe('C4-PlantUML', () => {
  it('a container diagram becomes a c4 model with its container view', async () => {
    const { d, yaml } = one(fixture('c4-containers.puml'));
    expect(d.type).toBe('c4');
    expect(d.elements.c1).toMatchObject({ kind: 'software-system', label: 'Internet Banking' });
    expect(d.elements.c1.elements).toMatchObject({
      web_app: { kind: 'container', technology: 'Java, Spring MVC' },
      spa: { kind: 'web-app' },
      mobile_app: { kind: 'mobile-app' },
      database: { kind: 'database', technology: 'SQL Database' },
    });
    expect(d.elements.email_system).toMatchObject({ kind: 'software-system', external: true });
    // Rel_Back and Rel_Back_Neighbor point the other way.
    expect(d.relations).toContainEqual({ 'c1.backend_api -> c1.database': { label: 'Reads from and writes to', technology: 'sync, JDBC' } });
    expect(d.relations).toContainEqual({ 'email_system -> customer': 'Sends e-mails to' });
    expect(d.views).toEqual({ containers: { kind: 'container', of: 'c1' } });
    await clean(yaml);
  });

  it('context, component, dynamic and deployment diagrams', async () => {
    const context = one(`!include <C4/C4_Context>
Person(u, "User")
System(s, "Shop", "Sells things")
System_Ext(p, "PSP", $tags="external")
Rel(u, s, "Buys")
Rel(s, p, "Charges", "HTTPS")`);
    expect(context.d.views).toEqual({ context: { kind: 'context', of: 's' } });
    expect(context.d.relations).toContainEqual({ 's -> p': { label: 'Charges', technology: 'HTTPS' } });
    await clean(context.yaml);

    const component = one(`!include C4_Component.puml
Container_Boundary(api, "API Application") {
  Component(sign, "Sign In Controller", "Spring MVC Rest Controller", "Allows users to sign in")
  ComponentDb(store, "Store", "JDBC")
}
Rel(sign, store, "Reads")`);
    expect(component.warnings.join('\n')).toMatch(/put in a software system/);
    expect(component.d.views.components).toMatchObject({ kind: 'component' });
    await clean(component.yaml);

    const dynamic = one(`!include C4_Dynamic.puml
Person(u, "User")
System_Boundary(b, "Shop") {
  Container(web, "Web")
  Container(api, "API")
}
RelIndex(2, web, api, "Submits")
RelIndex(1, u, web, "Orders")`);
    expect(dynamic.d.views.dynamic.steps).toEqual([{ 'u -> b.web': 'Orders' }, { 'b.web -> b.api': 'Submits' }]);
    await clean(dynamic.yaml);

    const deployment = one(`!include C4_Deployment.puml
Deployment_Node(aws, "AWS", "eu-west-1") {
  Deployment_Node(k8s, "EKS", "Kubernetes") {
    Container(api, "API", "Go")
  }
  ContainerDb(db, "Orders DB", "PostgreSQL")
}
Rel(api, db, "SQL")`);
    expect(deployment.d.views.deployment.nodes).toEqual({
      aws: { label: 'AWS', technology: 'eu-west-1', instances: [expect.stringMatching(/\.db$/)], nodes: { k8s: { label: 'EKS', technology: 'Kubernetes', instances: [expect.stringMatching(/\.api$/)] } } },
    });
    await clean(deployment.yaml);
  });

  it('an enterprise boundary makes a landscape', async () => {
    const { d, yaml } = one(`Enterprise_Boundary(e, "Bank") {
  System(a, "Online")
  System(b, "Ledger")
}
System(c, "Partner")`);
    expect(d.views).toEqual({ landscape: { kind: 'landscape', enterprise: 'Bank' } });
    expect(d.elements.c.external).toBe(true);
    await clean(yaml);
  });
});

describe('PlantUML state, activity and entity diagrams', () => {
  it('state diagrams become states', async () => {
    const { d, yaml } = one(fixture('order-states.puml'));
    expect(d.type).toBe('states');
    expect(d.states.Paid.states).toHaveProperty('Picking');
    expect(d.states.Cancelled).toEqual({ note: 'the stock is released' });
    expect(d.transitions).toContainEqual({ 'Pending -> Cancelled': 'timeout' });
    expect(d.transitions).toContainEqual('Shipped -> Out for delivery');
    await clean(yaml);
  });

  it('activity diagrams become a process with lanes, decisions, loops and parallel work', async () => {
    const { d, yaml } = one(fixture('release-activity.puml'));
    expect(d.type).toBe('process');
    expect(d.lanes).toEqual({ developer: 'Developer', ci: 'CI', 'release-manager': 'Release manager' });
    expect(d.nodes.Split).toEqual({ kind: 'parallel', in: 'release-manager', label: '' });
    expect(d.flow[0]).toMatch(/^start -> Open pull request -> Build and test -> Tests green\? -yes-> Deploy to staging/);
    expect(d.flow).toContain('Smoke tests pass? -no-> Roll back staging -> Fix the bug -> Smoke tests pass?');
    await clean(yaml);
  });

  it('repeat, switch and multi-line actions', async () => {
    const { d, yaml } = one(`start
repeat
  :Fetch
  page;
repeat while (More pages?) is (yes) not (no)
switch (Format?)
case (CSV)
  :Write CSV;
case (JSON)
  :Write JSON;
endswitch
stop`);
    expect(d.flow[0]).toBe('start -> Fetch page -> More pages? -no-> Format? -CSV-> Write CSV -> end');
    expect(d.flow).toContain('More pages? -yes-> Fetch page');
    await clean(yaml);
  });

  it('entities become an erd', async () => {
    const { d, yaml } = one(fixture('entities.puml'));
    expect(d.tables.order.columns).toEqual({ id: 'uuid pk', customer_id: 'uuid fk customer', total: 'numeric' });
    expect(d.relations).toEqual([{ 'order.customer_id -> customer.id': 'places' }]);
    await clean(yaml);
  });
});

describe('what PlantUML cannot import yet', () => {
  it.each([
    ['@startuml\nclass Order {\n +id\n}\nOrder <|-- Special\n@enduml', /class diagram type is planned/],
    ['@startmindmap\n* Root\n** Child\n@endmindmap', /mind map type is planned/],
    ['@startwbs\n* Project\n@endwbs', /tree type is planned/],
    ['@startuml\n(*) --> "First"\n@enduml', /old syntax/],
    ['@startuml\nactor User\nUser --> (Checkout)\n@enduml', /Use case/],
  ])('%s', (text, message) => {
    const [r] = importPlantUml(text);
    expect(r!.yaml).toBe('');
    expect(r!.warnings.join('\n')).toMatch(message);
  });
});

describe('PlantUML files', () => {
  it('several @startuml blocks are several diagrams, named by their titles', () => {
    const blocks = importPlantUml('@startuml\ntitle One\nA -> B\n@enduml\n\n@startuml\nA -> C\n@enduml');
    expect(blocks.map((b) => b.name)).toEqual(['One', 'Diagram 2']);
  });

  it('is found by its ending, by @startuml and by its C4 macros; ```plantuml blocks in Markdown', () => {
    expect(languageOf('A -> B', 'x.puml')).toBe('plantuml');
    expect(languageOf('@startuml\nA -> B\n@enduml')).toBe('plantuml');
    expect(languageOf('Person(u, "User")\nSystem(s, "Shop")')).toBe('plantuml');
    expect(importText('A -> B : hi', 'flow.plantuml')[0]!.yaml).toMatch(/^type: sequence\ntitle: flow/);
    const md = importMarkdown('## Login\n\n```plantuml\n@startuml\nA -> B : hi\n@enduml\n```\n');
    expect(md).toHaveLength(1);
    expect(parse(md[0]!.yaml)).toMatchObject({ type: 'sequence', title: 'Login' });
  });
});

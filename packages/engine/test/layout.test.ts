// Layout quality guard: every example must stay clean, and crossings may not creep up.
// When a change improves an example, lower its budget.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LayoutMemory } from '@cartography/core';
import { boxOverlaps, disorder, falseJoins, labelMetrics, measure, routeEdges, slideReadability, throughVia, touchedLabels, type RouteRequest } from '@cartography/layout';
import { endsRoom } from '@cartography/render';
import { readableArea, render, SLIDE_MIN_PT, slideTextPt } from '../src/index.ts';
import { big, budget, race, timed } from './perf.ts';

const examples = path.resolve(import.meta.dirname, '../../../examples');
const crossingBudget: Record<string, number> = {
  'capabilities/e-commerce.yaml': 0,
  'capabilities/enterprise.yaml': 0,
  'capabilities/retail-bank.yaml': 0,
  'teams/consultancy-team.yaml': 2, // the dotted lines from the client side cross the consultancy's reporting lines: that is what they say
  'teams/platform-org.yaml': 0,
  'teams/product-org.yaml': 0,
  'class/domain-model.yaml': 0,
  'class/strategy.yaml': 0,
  'mindmap/capability-brainstorm.yaml': 0,
  'mindmap/workshop-agenda.yaml': 0,
  'access/engineering.yaml': 0,
  'access/engineering-access.yaml': 0,
  'access/engineering-packages.yaml': 0,
  'access/engineering-roles.yaml': 0,
  'access/access-packages.yaml': 0,
  'access/azure-rbac-pim.yaml': 0,
  'access/privileged-access.yaml': 2, // the service desk's lines up into its unit pass the break-glass line into the tenant
  'azure/aks-baseline.yaml': 0,
  'azure/app-landing-zone.yaml': 0,
  'azure/data-platform.yaml': 0,
  'azure/hub-spoke.yaml': 0,
  'azure/landing-zone.yaml': 0,
  'azure/microservices.yaml': 4,
  'azure/private-endpoints.yaml': 0,
  'azure/web-shop.yaml': 0,
  'azure/web-app.yaml': 0,
  'azure/workload-identities.yaml': 0,
  'context-map/e-commerce.yaml': 0,
  'c4/kestrel-bank.yaml': 0,
  'c4/kestrel-bank.yaml#landscape': 0,
  'c4/kestrel-bank.yaml#context': 0,
  'c4/kestrel-bank.yaml#containers': 0,
  'c4/kestrel-bank.yaml#notifications': 0,
  'c4/kestrel-bank.yaml#components': 1,
  'c4/kestrel-bank.yaml#payment': 0,
  'c4/kestrel-bank.yaml#payment-notice': 0,
  'c4/kestrel-bank.yaml#production': 0,
  'c4/kestrel-bank.yaml#production-data': 0,
  'cloud/aws-data-lake.yaml': 1, // wrapped into two rows for a slide (4.55:1 at 3.7 pt -> 1.84:1 at 6.3 pt): the stream's line down to the raw zone passes the change data capture's
  'cloud/aws-landing-zone.yaml': 0,
  'cloud/aws-landing-zone-network.yaml': 0,
  'cloud/aws-three-tier.yaml': 0,
  'cloud/gcp-data-platform.yaml': 0,
  'cloud/multi-cloud.yaml': 2, // left to right for a slide: the interconnect and CDC lines to Google Cloud pass the shop's lines down to the data centre
  'data-products/customer.yaml': 0,
  'data-products/customer-detailed.yaml': 1, // lines keep clear of the cards they pass: the dashboard's line crosses the one from orders
  'data-products/customer-focus.yaml': 0,
  'data-products/finance.yaml': 0,
  'data-products/mesh.yaml': 0,
  'data-products/northwind-mesh.yaml': 1, // Orders and Customers both feed Revenue and the sales dashboard, which stand in one column
  'data-products/northwind-orders-product.yaml': 0,
  'data-products/mesh-detailed.yaml': 3, // keys run field to field between contracts that stand by their own product, across the port lines
  'deployment/aws.yaml': 2, // the OrderPlaced lines into the queue each run on their own: lines with a label never share a trunk
  'deployment/aws.yaml#prod': 2, // the same
  'deployment/aws.yaml#test': 0,
  'deployment/aws.yaml#dev': 0,
  'deployment/azure.yaml': 0,
  'deployment/azure.yaml#prod': 0,
  'deployment/azure.yaml#test': 0,
  'deployment/azure.yaml#dev': 0,
  'deployment/model.yaml': 0,
  'deployment/model.yaml#context': 0,
  'deployment/model.yaml#containers': 0,
  'erd/orders.yaml': 0,
  'erd/saas.yaml': 3, // the nullable assignee comes into users.id from the far side, so its ring and bar are not drawn over the others' bars
  'erd/shop-schemas.yaml': 0,
  'model/containers.yaml': 0,
  'model/context.yaml': 0,
  'model/deployment.yaml': 0,
  'model/model.yaml': 0,
  'workspace/access.yaml': 0,
  'workspace/containers.yaml': 0,
  'workspace/containers.yaml#payments': 1, // wrapped for a slide (text 5.6 → 7 pt): the interbank payments pass the nightly extract
  'workspace/containers.yaml#api': 1, // the payments call leaves the API past the accounts controller's line to the ledger
  'workspace/context.yaml': 0,
  'workspace/data-products.yaml': 0,
  'workspace/deployment.yaml': 0,
  'workspace/model.yaml': 1, // the landscape drawn left to right for a slide (5.1 → 7.0 pt): the retail customer's line down into Harbour Online passes the advisor's line to the desk
  'network/campus.yaml': 0,
  'network/hybrid-cloud.yaml': 0,
  'network/office-ip-plan.yaml': 0,
  'network/small-office.yaml': 0,
  'github/setup.yaml': 0,
  'gitflow/git-flow.yaml': 0,
  'gitflow/github-flow-environments.yaml': 0,
  'gitflow/trunk-delivery.yaml': 0,
  'process/access-request.yaml': 1, // the approver's "no" passes the line down to IT: drawn with a gap
  'process/build-buy-reuse.yaml': 0,
  'process/incident-handling.yaml': 0,
  'process/onboarding.yaml': 1, // the manager's branch passes IT's line on its way down
  'process/order-to-cash.yaml': 0,
  'process/pull-request.yaml': 0,
  'process/release-to-production.yaml': 0,
  'roadmap/migration-waves.yaml': 0,
  'roadmap/now-next-later.yaml': 0,
  'journey/access-request.yaml': 0,
  'journey/data-product-consumer.yaml': 0,
  'journey/developer-onboarding.yaml': 0,
  'journey/first-deploy.yaml': 0,
  'matrix/crud-services.yaml': 0,
  'matrix/raci-migration.yaml': 0,
  'kubernetes/inference.yaml': 1, // the router's chat and embeddings lines leave its side one over the other
  'kubernetes/platform.yaml': 0,
  'kubernetes/web-app.yaml': 0,
  'sequence/checkout.yaml': 0,
  'sequence/entra-sign-in.yaml': 0,
  'sequence/managed-identity.yaml': 0,
  'sequence/service-bus-events.yaml': 0,
  'sequence/pipeline-handshake.yaml': 0,
  'states/device-connection.yaml': 1, // wrapped into two rows for a slide (2.94:1 at 6.6 pt -> 1.70:1 at 8.4 pt)
  'states/document-approval.yaml': 2, // wrapped into rows for a slide (3.89:1 at 6.7 pt -> 1.23:1 at 8.5 pt): the review's lines back pass Draft's
  'states/order-lifecycle.yaml': 1, // wrapped into three rows for a slide (text 5.4 → 8.2 pt): the line on to Shipped passes Cancelled's line to the end
  'states/pull-request.yaml': 0,
  'systems/data-pipeline.yaml': 0,
  'systems/invoice-walkthrough.yaml': 1, // Orders' confirmation line passes its own OrderPlaced line
  'systems/saas-platform.yaml': 2, // the overview: the host dashboard's way in passes the guests' line to their app, and the app's OIDC line over to Auth0
  'systems/saas-platform.yaml#cluster': 0,
  'systems/trust-zones.yaml': 1,
  'systems/web-shop.yaml': 0,
};

// Lines over the header strip of a group: none, but for the ones named here.
const headerBudget: Record<string, number> = {
  'deployment/aws.yaml#prod': 1, // one load balancer now (main): the OrderPlaced line from zone 1a, labelled and so on its own, runs over the top of zone 1b on its way to the queue
};

// Jogs (a short step aside between two runs the same way): none, but for the ones named here.
const jogBudget: Record<string, number> = {
  // The Harbour Bank workspace example (examples/workspace), as drawn when it was added.
  'workspace/containers.yaml#api': 2,
  'workspace/context.yaml': 1,
  'workspace/model.yaml': 2, // the landscape left to right: the lines into the ledger step aside into its side
  'workspace/data-products.yaml': 2,
  'systems/invoice-walkthrough.yaml': 1, // three lines out of Orders' side: confirmation steps a lane down past the SQL line
  // A lane aside: lines keep clear of the cards they pass and do not start where another ends on its track.
  'data-products/mesh-detailed.yaml': 1,
  'kubernetes/inference.yaml': 1,
  'model/deployment.yaml': 1,
  'azure/hub-spoke.yaml': 2, // the second peering line steps out of the firewall's side beside the first, and the way out to the internet above them
  'azure/private-endpoints.yaml': 1, // the hub stands beside its zones for a slide (4.3 → 5.2 pt): the resolver's trunk steps into the middle zone
  'workspace/containers.yaml': 1,
  'cloud/aws-data-lake.yaml': 1, // two lines into one side: the second end has no room in line with its card
  'cloud/aws-three-tier.yaml': 1, // the web shops' lines into the writer: one steps a lane aside past the other
  'cloud/gcp-data-platform.yaml': 1, // the change data capture's line into the raw datasets steps around the streaming pipeline
  'cloud/multi-cloud.yaml': 2, // left to right for a slide: the lines out of the shop step aside on their way down
  'context-map/e-commerce.yaml': 1, // Ordering's line steps into Billing a lane apart from Payment provider's: lines that meet end to end read as one
  'c4/kestrel-bank.yaml#components': 2, // two labelled lines into one side each keep their own path now, and one end steps aside
  'data-products/customer.yaml': 1, // drawn left to right (a slide's shape): Customer 360's line steps into the dashboard beside the one from orders
  'data-products/customer-detailed.yaml': 2, // the same as customer.yaml, and a line stepping clear of a card it passes
  'data-products/customer-focus.yaml': 2, // the same, twice
  'data-products/northwind-mesh.yaml': 1, // Customers' line steps into Revenue beside the one from Orders
  'data-products/northwind-orders-product.yaml': 2, // the sources' lines step into their input ports
  'deployment/azure.yaml': 2, // drawn left to right for a slide (it was three times taller): the ways in from Users step aside into Front Door and Storefront
  'deployment/aws.yaml#prod': 2, // the one load balancer (main) feeds both zones: its line into zone 1b's API steps aside past the zone's title; the site files stand by the storefront, a step up
  'deployment/aws.yaml': 2, // Users' line to the load balancer goes around Storefront and the zone's title
  'erd/saas.yaml': 4, // ends are fixed on their rows
  'access/privileged-access.yaml': 1, // Tier 0's two eligible lines into the tenant step aside, one beside the other
  'kubernetes/platform.yaml': 2, // /api goes under storefront
  'kubernetes/web-app.yaml': 1, // two lines into one side
  // A mind map's branches leave the centre on curves, drawn as short pieces that each read as a step: no kinks a reader sees.
  'mindmap/capability-brainstorm.yaml': 86,
  'mindmap/workshop-agenda.yaml': 72,
  'teams/consultancy-team.yaml': 1, // a dotted line comes up out of its lane into the side of a card in the row above
  'states/device-connection.yaml': 2, // returns to Idle share its side; the line out of Connecting steps a lane aside, clear of the line in beside it
  'states/document-approval.yaml': 3, // changes asked and withdrawn run back past In review; wrapped, the review's line back steps aside
  'states/pull-request.yaml': 4, // the returns into In review and Closed; a line out steps aside from the line in beside it
  'systems/data-pipeline.yaml': 1, // two lines into one side
  'systems/saas-platform.yaml': 1, // the overview: the host dashboard's way in steps aside past the guest app's
};

// Labels sitting on a corner of their line: none, but for the ones named here.
const bendBudget: Record<string, number> = {
  'azure/hub-spoke.yaml': 1, // IPsec: the hop from the office's border to the turn is shorter than the label
  'kubernetes/inference.yaml': 1, // chat: the router's line steps aside past the embeddings line right where it leaves
  'states/device-connection.yaml': 2, // update verified, between two returns; buffer full, on the short hop up into Sending
  'azure/aks-baseline.yaml': 1, // secrets: on the short hop from orders-api to its turn down to pe-kv
  'c4/kestrel-bank.yaml#components': 1, // a label of one of two lines into one side that no longer share a trunk
  'c4/kestrel-bank.yaml#production': 1, // the same
  'c4/kestrel-bank.yaml#production-data': 1, // Reads logins, on the line down from the banking API past Kafka
  // Short lines whose middle lies near another line: the label goes to the end clear of it.
  'workspace/containers.yaml': 1,
  'c4/kestrel-bank.yaml#containers': 1,
  // Given room (no other line through it), the label sits at its line's turn: create invoice; db_datawriter.
  'systems/invoice-walkthrough.yaml': 1,
  'azure/web-app.yaml': 1,
};

// Pairs of groups standing side by side against the order they are written in: none, but for these,
// where the lines between the groups say otherwise.
const orderBudget: Record<string, number> = {
  'azure/hub-spoke.yaml': 1,
  'c4/kestrel-bank.yaml#production': 3,
  'context-map/e-commerce.yaml': 1, // Fulfilment sits above Sales: Shipping lines up with Billing that way
  'cloud/multi-cloud.yaml': 1,
  // One load balancer across both zones (as AWS runs it) no longer pins zone a to the left: zone b lands first.
  'deployment/aws.yaml': 1,
  'deployment/aws.yaml#prod': 1,
  'kubernetes/platform.yaml': 1,
  'model/deployment.yaml': 1,
  'network/small-office.yaml': 1,
};

// Lines on one track that are not one trunk (falseJoins): none, but for the ones named here.
const joinBudget: Record<string, number> = {
  'erd/saas.yaml': 3, // a nullable key comes into users.id beside the required ones: ends are fixed on their row
  'states/document-approval.yaml': 1, // wrapped for a slide: the review's line back runs on in the line out of Draft
};

// Labels with another line running through or right beside them (nearer than 6 px): none, but for the ones named here.
const touchBudget: Record<string, number> = {
  'workspace/model.yaml': 1, // the landscape's dense middle: two labels share a corner
  'access/privileged-access.yaml': 1, // Privileged Role Administrator, beside Tier 0's other eligible line into the tenant
  'c4/kestrel-bank.yaml#containers': 1,
  'c4/kestrel-bank.yaml#components': 1,
  'kubernetes/inference.yaml': 1,
  'states/device-connection.yaml': 1,
  'states/pull-request.yaml': 2, // closed without merging, between the line out and the line back
  'systems/invoice-walkthrough.yaml': 1,
  'systems/web-shop.yaml': 1,
  'workspace/containers.yaml#payments': 1,
  'workspace/containers.yaml#api': 1,
  'workspace/deployment.yaml': 1,
  'azure/web-app.yaml': 1, // db_datawriter, on its role line down to SQL, sits against the TDS line running down beside it
};

// Lines that go back on purpose: the rework loop of a process, a state a machine returns to.
const returns: Record<string, number> = {
  'workspace/containers.yaml': 2, // customer → web and app, drawn above the boundary they enter
  'azure/workload-identities.yaml': 1, // the shared identity's line up to the storage account, beside the function it serves
  'process/incident-handling.yaml': 1,
  'process/order-to-cash.yaml': 1,
  'process/pull-request.yaml': 2, // a red build and requested changes both go back to the developer's commit
  'states/device-connection.yaml': 6, // and one more: wrapped into two rows for a slide
  'states/document-approval.yaml': 2, // and one more: wrapped into rows for a slide
  'states/order-lifecycle.yaml': 3, // wrapped into three rows for a slide: the lines on to the next row run back
  'states/pull-request.yaml': 4,
  'workspace/context.yaml': 1, // wrapped into two columns for a slide: the line on to the second runs back
  'systems/data-pipeline.yaml': 1, // wrapped into two rows for a slide: the line down to the second row runs back to its start
  'azure/data-platform.yaml': 1, // wrapped for a slide: serving stands under the ingest, so gold's line down to the warehouse runs back
  // Wrapped into rows (columns, top-down) for a slide, as slideReadability weighs it: the lines on to the next row run back.
  'cloud/multi-cloud.yaml': 3,
  'deployment/azure.yaml': 1,
  'deployment/azure.yaml#prod': 1,
  'deployment/aws.yaml': 2, // users and the storefront stand to the left for a slide: their lines into the region run back
  'deployment/aws.yaml#prod': 2, // wrapped the way the first environment is
  'deployment/aws.yaml#test': 2, // the same
  'model/containers.yaml': 2,
  'network/campus.yaml': 2,
  'systems/trust-zones.yaml': 2,
  'c4/kestrel-bank.yaml#payment': 2,
  'deployment/model.yaml#containers': 2,
  'systems/saas-platform.yaml': 4, // the overview: the ways in from the apps left of the cloud, OIDC up over it to Auth0, and the events back up to the cluster
  'data-products/customer.yaml': 3,
  'c4/kestrel-bank.yaml#containers': 3,
  'cloud/aws-data-lake.yaml': 1,
  'workspace/containers.yaml#payments': 3,
  // Lines that run back where a view is drawn to fit a slide.
  'cloud/aws-three-tier.yaml': 1, // the writer replicates to the reader in the zone to its left
  'c4/kestrel-bank.yaml#notifications': 2, // the notifier sends to Postbird and the push gateway, drawn under the boundary on the left
  'c4/kestrel-bank.yaml#payment-notice': 1,
  'c4/kestrel-bank.yaml#production': 1, // wrapped for a slide: the line down to the core ledger runs back to its start
};

describe('layout quality', () => {
  const files = fs.readdirSync(examples).flatMap((d) => fs.readdirSync(path.join(examples, d)).filter((f) => f.endsWith('.yaml')).map((f) => `${d}/${f}`));
  // C4 examples are one model with many views: each view is a drawing of its own. So is each environment of a
  // deployment, and each view of any other example that has a budget of its own.
  const views = files.flatMap((f) => Object.keys(crossingBudget).filter((k) => k.startsWith(`${f}#`)));
  it('has a budget for every example', () => expect(files.sort()).toEqual(Object.keys(crossingBudget).filter((k) => !k.includes('#')).sort()));

  for (const key of [...files, ...views])
    it(key, async () => {
      const [file, view] = key.split('#') as [string, string | undefined];
      const load = (rel: string) => fs.readFileSync(path.resolve(examples, path.dirname(file), rel), 'utf8');
      const r = await render(fs.readFileSync(path.join(examples, file), 'utf8'), { fonts: 'none', load, view });
      if (file.startsWith('c4/') || file.startsWith('deployment/')) expect(r.diagnostics).toEqual([]);
      const m = measure(r.graph!, r.placed!);
      expect({ through: m.edgeThroughNode, labels: m.labelOverlaps, backward: Math.max(0, m.backward - (returns[key] ?? 0)), overlaps: m.overlaps }).toEqual({ through: 0, labels: 0, backward: 0, overlaps: 0 });
      expect(m.crossings).toBeLessThanOrEqual(crossingBudget[key]!);
      expect(m.headerHits).toBeLessThanOrEqual(headerBudget[key] ?? 0);
      expect(m.labelOnBend).toBeLessThanOrEqual(bendBudget[key] ?? 0);
      expect(m.jogs).toBeLessThanOrEqual(jogBudget[key] ?? 0);
      // No line seems to run between two cards it does not join, and every label sits on its own line, clear of the others.
      expect(falseJoins(r.graph!, r.placed!).length).toBeLessThanOrEqual(joinBudget[key] ?? 0);
      const labels = labelMetrics(r.graph!, r.placed!);
      expect(labels.labelFar).toBe(0);
      expect(labels.labelTouching).toBeLessThanOrEqual(touchBudget[key] ?? 0);
      expect(disorder({ ...r.graph!, direction: r.placed!.direction ?? r.graph!.direction }, r.placed!.groups)).toBeLessThanOrEqual(orderBudget[key] ?? 0);
    });

  const c4 = fs.readFileSync(path.join(examples, 'c4/kestrel-bank.yaml'), 'utf8');
  it('keeps groups apart in a deployment view drawn top-down', async () => {
    // The production view is written left to right (to fit a slide); turned top-down here.
    const down = c4.replace('    direction: right\n', '').replace('    kind: deployment\n', '    kind: deployment\n    direction: down\n');
    expect(down).not.toBe(c4);
    const r = await render(down, { fonts: 'none', view: 'production' });
    expect(r.placed!.memory!.variant).toMatch(/^down\//);
    expect(boxOverlaps(r.graph!, r.placed!)).toEqual([]);
  });
  it('keeps the wide deployment view within 2600 px', async () => {
    const r = await render(c4, { fonts: 'none', view: 'production' });
    expect(r.placed!.width).toBeLessThan(2600);
  });
  it('runs straight between two cards in line, past the titles of the groups in between', async () => {
    const load = (rel: string) => fs.readFileSync(path.resolve(examples, 'deployment', rel), 'utf8');
    // Drawn on its own (not the way the first environment was), as it would be without the others,
    // and with the account around the region that the example leaves out to fit a slide: one more group title to pass.
    const aws = fs.readFileSync(path.join(examples, 'deployment/aws.yaml'), 'utf8');
    const inAccount = aws.replace('  region: { kind: region, region: eu-west-1 }', '  account: { kind: account, label: shop }\n  region: { kind: region, region: eu-west-1, in: account }');
    expect(inAccount).not.toBe(aws);
    const r = await render(inAccount, { fonts: 'none', load, view: 'dev', previous: null });
    const line = r.graph!.edges.find((e) => e.from.node === 'users' && e.to.node === 'alb')!;
    expect(r.placed!.edges.get(line.id)!.points).toHaveLength(2);
  });
  it('writes each label on its own line where lines that say the same run into one target', async () => {
    const load = (rel: string) => fs.readFileSync(path.resolve(examples, 'deployment', rel), 'utf8');
    const r = await render(fs.readFileSync(path.join(examples, 'deployment/aws.yaml'), 'utf8'), { fonts: 'none', load, view: 'prod' });
    const said = r.graph!.edges.filter((e) => e.label === 'OrderPlaced' && e.to.node === 'queue');
    expect(said.length).toBeGreaterThan(1);
    // On a shared trunk one label would leave the reader to guess which line it names.
    expect(said.filter((e) => r.placed!.edges.get(e.id)!.label)).toHaveLength(said.length);
  });
  it('opens room for a label that has no clear spot, so no other line runs through it', async () => {
    // Invoicing's "create invoice" lay across Notifier's line to the mail provider: the gap between the
    // system and the outside services was too narrow for the words and both lines.
    for (const file of ['systems/invoice-walkthrough.yaml', 'azure/web-app.yaml']) {
      const r = await render(fs.readFileSync(path.join(examples, file), 'utf8'), { fonts: 'none' });
      expect(touchedLabels(r.graph!, r.placed!)).toEqual([]);
      expect(slideTextPt(r.svg!, r.width!, r.height!)).toBeGreaterThanOrEqual(SLIDE_MIN_PT);
    }
  });
  it('puts the words of a label beside a line next to it, whatever room the line keeps for its end tags', async () => {
    const r = await render(fs.readFileSync(path.join(examples, 'context-map/e-commerce.yaml'), 'utf8'), { fonts: 'none' });
    for (const e of r.graph!.edges) {
      const pe = r.placed!.edges.get(e.id)!;
      const aside = 2 * endsRoom(e.ends);
      if (!pe.label || !e.label) continue;
      // The words, as drawn: the box less the room for the end tags, half each side.
      const w = { x: pe.label.x + aside / 2, y: pe.label.y, width: pe.label.width - aside, height: pe.label.height };
      const gap = Math.min(...pe.points.slice(1).map((q, i) => {
        const p = pe.points[i]!;
        const dx = Math.max(w.x - Math.max(p.x, q.x), Math.min(p.x, q.x) - (w.x + w.width), 0);
        const dy = Math.max(w.y - Math.max(p.y, q.y), Math.min(p.y, q.y) - (w.y + w.height), 0);
        return Math.hypot(dx, dy);
      }));
      expect(gap).toBeLessThanOrEqual(6);
    }
  });
  it('keeps a label on the middle of its piece of line rather than over the bend at its end', () => {
    const box = (x: number, y: number) => ({ x, y, width: 120, height: 50 });
    const r = routeEdges({
      obstacles: new Map([['a', box(0, 0)], ['b', box(400, 300)]]),
      soft: [],
      direction: 'right',
      edges: [{ id: 'e', from: { node: 'a', box: box(0, 0), stub: 16 }, to: { node: 'b', box: box(400, 300), stub: 18 }, label: { width: 90, height: 16 } }],
    });
    const { points, label } = r.get('e')!;
    // The label lies wholly on one straight piece, clear of both its ends.
    const on = points.slice(1).some((q, i) => {
      const p = points[i]!;
      return p.y === q.y ? label!.x >= Math.min(p.x, q.x) && label!.x + label!.width <= Math.max(p.x, q.x) : label!.y >= Math.min(p.y, q.y) && label!.y + label!.height <= Math.max(p.y, q.y);
    });
    expect(on).toBe(true);
  });
  it('draws groups that stand side by side in the order they are written', async () => {
    const text = fs.readFileSync(path.join(examples, 'cloud/aws-three-tier.yaml'), 'utf8');
    const zones = async (source: string, previous?: LayoutMemory) => {
      const r = await render(source, { fonts: 'none', previous });
      const ids = ['az-a', 'az-b', 'az-c'].sort((a, b) => r.placed!.groups.get(a)!.x - r.placed!.groups.get(b)!.x);
      return { ids, memory: r.placed!.memory };
    };
    const first = await zones(text);
    expect(first.ids).toEqual(['az-a', 'az-b', 'az-c']);
    // Written the other way round they are drawn the other way round, also with the first drawing remembered.
    const lines = text.split('\n');
    const [a, c] = [lines.findIndex((l) => l.startsWith('  az-a:')), lines.findIndex((l) => l.startsWith('  az-c:'))];
    expect(a).toBeGreaterThan(-1);
    expect(c).toBeGreaterThan(a);
    [lines[a], lines[c]] = [lines[c]!, lines[a]!];
    expect((await zones(lines.join('\n'), first.memory)).ids).toEqual(['az-c', 'az-b', 'az-a']);
  });
  it('draws sibling groups of one kind as a set: the subnets of a zone one width', async () => {
    const r = await render(fs.readFileSync(path.join(examples, 'cloud/aws-three-tier.yaml'), 'utf8'), { fonts: 'none' });
    expect(measure(r.graph!, r.placed!).siblingSpread).toBe(0);
  });
  it('keeps what one card names in a badge by that card', async () => {
    const r = await render(fs.readFileSync(path.join(examples, 'azure/web-shop.yaml'), 'utf8'), { fonts: 'none' });
    const at = (id: string) => r.placed!.nodes.get(id)!;
    // The key vault has no line of its own: it stands past the API that names it, not at the far end of the resource group.
    expect(at('vault').x).toBeGreaterThan(at('api').x);
    // And the way in runs straight: nothing stretches the resource group out in front of the web shop.
    const middle = (id: string) => at(id).y + at(id).height / 2;
    expect(new Set(['users', 'edge', 'web'].map(middle)).size).toBe(1);
  });
  it('starts the cards of one row on one line, top-down', async () => {
    // As placed, not wrapped for a slide: wrapped, each column moves on its own grid.
    const r = await render(c4, { fonts: 'none', view: 'containers', tuning: { wrap: false } });
    expect(r.placed!.memory!.variant).toMatch(/^down\//);
    const tops = new Map<number, Set<number>>();
    for (const [id, b] of r.placed!.nodes) {
      if (r.graph!.edges.some((e) => e.from.node === id || e.to.node === id) === false) continue;
      const row = Math.round((b.y + b.height / 2) / 24);
      tops.set(row, (tops.get(row) ?? new Set()).add(b.y));
    }
    // Rows whose cards are joined by a line stay centred; the others share a top.
    const ragged = [...tops.values()].filter((t) => t.size > 1 && Math.max(...t) - Math.min(...t) < 24);
    expect(ragged).toEqual([]);
  });
  it('starts the cards of one column on one line, left to right', async () => {
    // Drawn left to right, the sources share their left edge.
    const r = await render(fs.readFileSync(path.join(examples, 'azure/data-platform.yaml'), 'utf8'), { fonts: 'none', tuning: { direction: 'right' } });
    const left = ['web', 'crm', 'erp'].map((id) => r.placed!.nodes.get(id)!.x);
    expect(new Set(left).size).toBe(1);
  });

  it('lays out 200 nodes in under a second', async () => {
    await render(big(2, 5), { fonts: 'none' }); // load Graphviz first
    // Best of three, so a busy machine does not fail it.
    const { ms, result } = await timed(big(10, 20), {}, 3);
    expect(result.graph!.nodes).toHaveLength(200);
    expect(ms).toBeLessThan(budget(1000));
  }, 20_000);

  it('and as fast one line later, knowing the drawing before', async () => {
    const text = big(10, 20);
    const before = await render(text, { fonts: 'none' });
    // A line right across the drawing: the longest route there can be. Best of two, so a busy machine does not fail it.
    const { ms, result } = await timed(text + '  - n0_1 -> n9_19\n', { previous: before.placed!.memory }, 2);
    expect(result.graph!.edges).toHaveLength(before.graph!.edges.length + 1);
    expect(ms).toBeLessThan(budget(1000));
    // Drawn the way the drawing before was, and nothing that was there moved.
    expect(result.placed!.memory!.variant).toBe(before.placed!.memory!.variant);
    const was = before.placed!.memory!.nodes!;
    const now = result.placed!.memory!.nodes!;
    const far = [...was].filter(([id, p]) => Math.hypot(now.get(id)!.x - p.x, now.get(id)!.y - p.y) > 16);
    expect(far.length / was.size).toBeLessThan(0.1);
  });
});

describe('drawn again', () => {
  const file = path.join(examples, 'cloud/multi-cloud.yaml');
  const text = fs.readFileSync(file, 'utf8');
  const load = (rel: string) => fs.readFileSync(path.resolve(path.dirname(file), rel), 'utf8');

  it('the same diagram with a label edited is drawn the way it was, without trying the others', async () => {
    const first = await render(text, { fonts: 'none', load });
    const memory = first.placed!.memory!;
    // A drawing that was turned and wrapped for the page: the search is long, its answer is kept.
    expect(memory.variant).toMatch(/w\d/);
    // An edit that keeps the card's width: drawn left to right, a wider card would rightly push what follows it.
    const edited = text.replace('label: Web shop CDN', 'label: Shop CDN');
    const [fresh, again] = await race(
      () => render(edited, { fonts: 'none', load }),
      () => render(edited, { fonts: 'none', load, previous: memory }),
    );
    const r = await render(edited, { fonts: 'none', load, previous: memory });
    expect(r.placed!.memory!.variant).toBe(memory.variant);
    expect(r.placed!.memory!.shape).toBe(memory.shape);
    const far = [...memory.nodes!].filter(([id, p]) => Math.hypot(r.placed!.memory!.nodes!.get(id)!.x - p.x, r.placed!.memory!.nodes!.get(id)!.y - p.y) > 48);
    expect(far.map(([id]) => id)).toEqual([]);
    // Taken in turns, so a busy machine slows both: one way drawn is a small part of the search.
    expect(again).toBeLessThan(fresh / 3);
    expect(again).toBeLessThan(budget(300));
  }, 30_000);

  it('the same diagram drawn again comes out exactly as it was', async () => {
    const first = await render(text, { fonts: 'none', load });
    const again = await render(text, { fonts: 'none', load, previous: first.placed!.memory });
    expect(again.svg).toBe(first.svg);
  });

  it('a pin moved keeps the way it was drawn and costs no search', async () => {
    const first = await render(text, { fonts: 'none', load });
    const shop = first.placed!.nodes.get('cdn')!;
    const shift = first.placed!.shift!;
    const sidecar = (dy: number) => ({ version: 1 as const, nodes: { cdn: { x: shop.x + shift.x, y: shop.y + shift.y + dy } }, layout: { variant: first.placed!.memory!.variant } });
    const [fresh, pinned] = await race(
      () => render(text, { fonts: 'none', load, previous: null }),
      () => render(text, { fonts: 'none', load, sidecar: sidecar(48), previous: first.placed!.memory }),
    );
    const r = await render(text, { fonts: 'none', load, sidecar: sidecar(48), previous: first.placed!.memory });
    expect(r.placed!.memory!.variant).toBe(first.placed!.memory!.variant);
    expect(pinned).toBeLessThan(fresh / 3);
  }, 30_000);

  it('a diagram that changed shape (a card added) is laid out afresh', async () => {
    const first = await render(text, { fonts: 'none', load });
    const added = text.replace('nodes:\n', 'nodes:\n  extra: { kind: users, label: Partners }\n');
    const r = await render(added, { fonts: 'none', load, previous: first.placed!.memory });
    expect(r.placed!.memory!.shape).not.toBe(first.placed!.memory!.shape);
    expect(r.placed!.nodes.has('extra')).toBe(true);
  });
});

describe('pins', () => {
  it('moves what is in the way of a pinned node, never the pinned node', async () => {
    const text = 'type: azure\nnodes:\n  a: app-service\n  b: sql-database\n  c: key-vault\nedges:\n  - a -> b\n  - a -> c\n';
    const free = await render(text, { fonts: 'none' });
    const shift = free.placed!.shift!;
    const b = free.placed!.nodes.get('b')!;
    // Pin c right on top of b.
    const pinned = await render(text, { fonts: 'none', sidecar: { version: 1, nodes: { c: { x: b.x + shift.x, y: b.y + shift.y } } } });
    const nb = pinned.placed!.nodes.get('b')!;
    const nc = pinned.placed!.nodes.get('c')!;
    const overlap = nb.x < nc.x + nc.width && nc.x < nb.x + nb.width && nb.y < nc.y + nc.height && nc.y < nb.y + nb.height;
    expect(overlap).toBe(false);
    expect({ x: nc.x + pinned.placed!.shift!.x, y: nc.y + pinned.placed!.shift!.y }).toEqual({ x: b.x + shift.x, y: b.y + shift.y });
  });
});

describe('lines bent by hand', () => {
  const text = 'type: azure\nnodes:\n  a: app-service\n  b: sql-database\n  c: key-vault\nedges:\n  - a -> b\n  - a -> c\n';
  const orthogonal = (pts: { x: number; y: number }[]) => pts.slice(1).every((q, i) => q.x === pts[i]!.x || q.y === pts[i]!.y);
  it('run through their bend points, stay orthogonal and leave the boxes where they were', async () => {
    const free = await render(text, { fonts: 'none' });
    const s = free.placed!.shift!;
    const pts = free.placed!.edges.get('e0')!.points;
    // A detour 120px below the line's lowest point, entered and left from its first and last bends.
    const low = Math.max(...pts.map((q) => q.y)) + 120;
    const via = [{ x: pts[0]!.x + 20 + s.x, y: low + s.y }, { x: pts.at(-1)!.x - 20 + s.x, y: low + s.y }];
    const bent = await render(text, { fonts: 'none', sidecar: { version: 1, edges: { e0: { via } } } });
    const p = bent.placed!;
    const out = p.edges.get('e0')!.points.map((q) => ({ x: q.x + p.shift!.x, y: q.y + p.shift!.y }));
    expect(orthogonal(out)).toBe(true);
    for (const v of via) expect(out).toContainEqual(v);
    for (const id of ['a', 'b', 'c']) {
      const before = free.placed!.nodes.get(id)!;
      const after = p.nodes.get(id)!;
      expect({ x: after.x + p.shift!.x, y: after.y + p.shift!.y }).toEqual({ x: before.x + s.x, y: before.y + s.y });
    }
    // The other line still leaves and arrives where it did (its trunk partner went its own way, so the middle may differ).
    const e1 = (q: { x: number; y: number }[], o: { x: number; y: number }) => [q[0], q.at(-1)].map((r) => ({ x: r!.x + o.x, y: r!.y + o.y }));
    expect(e1(p.edges.get('e1')!.points, p.shift!)).toEqual(e1(free.placed!.edges.get('e1')!.points, s));
  });
  it('are ignored once the line at that position joins other nodes', async () => {
    const free = await render(text, { fonts: 'none' });
    const via = [{ x: 0, y: 900 }];
    const stale = await render(text, { fonts: 'none', sidecar: { version: 1, edges: { e0: { via, from: 'a', to: 'c' } } } });
    expect(stale.placed!.edges.get('e0')!.points).toEqual(free.placed!.edges.get('e0')!.points);
  });
  it('get corners where bends no longer line up with the ports', () => {
    const ports = { from: { x: 0, y: 0 }, start: { x: 16, y: 0 }, fromSide: 'E' as const, to: { x: 200, y: 100 }, goal: { x: 184, y: 100 }, toSide: 'W' as const };
    const pts = throughVia(ports, [{ x: 100, y: 40 }]);
    expect(orthogonal(pts)).toBe(true);
    expect(pts).toContainEqual({ x: 100, y: 40 });
    expect(pts.slice(-2)).toEqual([{ x: 184, y: 100 }, { x: 200, y: 100 }]);
  });
  it('are in the way of other lines: none runs on top of one', () => {
    // a and b side by side, their line straight between them; c and d below, their line bent up by
    // hand into exactly that corridor.
    const box = (x: number, y: number) => ({ x, y, width: 100, height: 60 });
    const end = (node: string, x: number, y: number) => ({ node, box: box(x, y), stub: 16 });
    const obstacles = new Map([['a', box(0, 0)], ['b', box(400, 0)], ['c', box(0, 200)], ['d', box(400, 200)]]);
    const straight = { id: 'ab', from: end('a', 0, 0), to: end('b', 400, 0) };
    const hand = { id: 'cd', from: end('c', 0, 200), to: end('d', 400, 200), via: [{ x: 150, y: 30 }, { x: 350, y: 30 }] };
    /** Length two polylines run on top of each other. */
    const shared = (p: { x: number; y: number }[], q: { x: number; y: number }[]) => {
      let total = 0;
      for (let i = 1; i < p.length; i++)
        for (let j = 1; j < q.length; j++) {
          const [a, b, c, d] = [p[i - 1]!, p[i]!, q[j - 1]!, q[j]!];
          if (a.y === b.y && c.y === d.y && a.y === c.y) total += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
          if (a.x === b.x && c.x === d.x && a.x === c.x) total += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
        }
      return total;
    };
    const alone = routeEdges({ obstacles, soft: [], direction: 'right', edges: [straight] });
    expect(alone.get('ab')!.points.every((q) => q.y === 30)).toBe(true);
    const both = routeEdges({ obstacles, soft: [], direction: 'right', edges: [straight, hand] });
    for (const v of hand.via) expect(both.get('cd')!.points).toContainEqual(v);
    expect(shared(both.get('ab')!.points, both.get('cd')!.points)).toBe(0);
  });
});

describe('moved groups', () => {
  it('carry their contents, also with an empty group inside', async () => {
    const text = 'type: azure\ngroups:\n  rg: resource-group\n  empty: { kind: subnet, in: rg }\nnodes:\n  a: { kind: app-service, in: rg }\n  b: sql-database\nedges:\n  - a -> b\n';
    const free = await render(text, { fonts: 'none' });
    const g = free.placed!.groups.get('rg')!;
    const s = free.placed!.shift!;
    const moved = await render(text, { fonts: 'none', sidecar: { version: 1, groups: { rg: { x: g.x + s.x, y: g.y + s.y + 200 } } } });
    expect(moved.diagnostics).toEqual([]);
    const a0 = free.placed!.nodes.get('a')!;
    const a1 = moved.placed!.nodes.get('a')!;
    const g1 = moved.placed!.groups.get('rg')!;
    // Same offset inside the group as before.
    expect(a1.y - g1.y).toBeCloseTo(a0.y - g.y, 0);
  });
});

describe('tidy lines', () => {
  const text = 'type: azure\nnodes:\n  bus: service-bus\n  a: app-service\n  b: function-app\n  c: app-service\nedges:\n  - bus -> a\n  - bus -> b\n  - bus -> c\n';
  it('fans out from one shared port as a trunk', async () => {
    const r = await render(text, { fonts: 'none' });
    const starts = [...r.placed!.edges.values()].map((e) => e.points[0]!);
    expect(new Set(starts.map((p) => `${p.x},${p.y}`)).size).toBe(1);
    expect(r.svg).toContain('<circle');
  });
  it('puts node centres on the 8px grid where there is room', async () => {
    const r = await render('type: azure\nnodes:\n  a: app-service\n  b: sql-database\n  c: key-vault\nedges:\n  - a -> b\n  - b -> c\n', { fonts: 'none' });
    for (const b of r.placed!.nodes.values()) {
      expect((b.x + b.width / 2) % 8).toBe(0);
      expect((b.y + b.height / 2) % 8).toBe(0);
    }
  });
});

describe('group titles', () => {
  // A node right under a title, fed from straight above: the line may not run through the title.
  const title = { x: 0, y: 160, width: 172, height: 18 };
  const end = (node: string, y: number) => ({ node, box: { x: 0, y, width: 172, height: 58 }, stub: 18 });
  const crosses = (pts: { x: number; y: number }[]) =>
    pts.slice(1).some((q, i) => {
      const p = pts[i]!;
      return Math.min(p.x, q.x) < title.x + title.width && Math.max(p.x, q.x) > title.x && Math.min(p.y, q.y) < title.y + title.height && Math.max(p.y, q.y) > title.y;
    });
  it('are never crossed by lines, also when the title covers the whole top of the node', () => {
    const out = routeEdges({ obstacles: new Map([['a', end('a', 0).box], ['b', end('b', 203).box]]), soft: [], texts: [title], direction: 'down', edges: [{ id: 'e', from: end('a', 0), to: end('b', 203) }] });
    expect(crosses(out.get('e')!.points)).toBe(false);
  });
  it('take the lane under them: a fan-out into the next row comes in from the top', async () => {
    // The cluster view turned top-down and drawn as it comes (not wrapped for a slide): the fan-outs then run into the row below.
    const text = fs.readFileSync(path.join(examples, 'systems/saas-platform.yaml'), 'utf8').replace('    direction: right\n', '    direction: down\n');
    const r = await render(text, { fonts: 'none', view: 'cluster', tuning: { wrap: false } });
    for (const id of ['cloud.edge.lb', 'cloud.data.events']) {
      const lines = r.graph!.edges.filter((e) => e.from.node === id);
      expect(lines, id).toHaveLength(2);
      for (const e of lines) {
        const pts = r.placed!.edges.get(e.id)!.points;
        const [a, b] = [pts[pts.length - 2]!, pts[pts.length - 1]!];
        expect(a.x === b.x && a.y < b.y).toBe(true);
      }
    }
  });
});

describe('shared trunks', () => {
  const end = (node: string, x: number, y: number) => ({ node, box: { x, y, width: 120, height: 50 }, stub: 18 });
  const fan = (a: Partial<RouteRequest>, b: Partial<RouteRequest>) =>
    routeEdges({
      obstacles: new Map([['s', end('s', 0, 100).box], ['a', end('a', 300, 0).box], ['b', end('b', 300, 200).box]]),
      soft: [],
      direction: 'right',
      edges: [
        { id: 'x', from: end('s', 0, 100), to: end('a', 300, 0), style: 'solid', ...a },
        { id: 'y', from: end('s', 0, 100), to: end('b', 300, 200), style: 'solid', ...b },
      ],
    });
  const start = (r: Map<string, { points: { x: number; y: number }[] }>, id: string) => JSON.stringify(r.get(id)!.points[0]);
  it('join lines drawn alike that say nothing', () => {
    const r = fan({}, {});
    expect(start(r, 'x')).toBe(start(r, 'y'));
  });
  it('never join lines with a label, or lines drawn differently', () => {
    const label = { width: 60, height: 20 };
    for (const [a, b] of [[{ label }, { label }], [{}, { style: 'dashed' }], [{ style: undefined }, { style: undefined }]] as Partial<RouteRequest>[][]) {
      const r = fan(a!, b!);
      expect(start(r, 'x')).not.toBe(start(r, 'y'));
    }
  });
  it('join only lines to cards that stand together: a branch beside a card of another group reads as running on through it', () => {
    const to = (node: string, x: number, y: number, within: string) => ({ ...end(node, x, y), within });
    const together = fan({ to: to('a', 300, 0, 'g') }, { to: to('b', 300, 200, 'g') });
    expect(start(together, 'x')).toBe(start(together, 'y'));
    const apart = fan({ to: to('a', 300, 0, 'g') }, { to: to('b', 300, 200, 'h') });
    expect(start(apart, 'x')).not.toBe(start(apart, 'y'));
  });
  it('never draw two different marks on one table row: the second line comes in on the other side', () => {
    // Two tables left, one right; both point at the right table's key row, one ending in a bar, one in a ring and bar.
    const row = (node: string, x: number, y: number, mark: string) => ({ node, box: { x, y, width: 160, height: 120 }, rowY: 50, stub: 30, mark });
    const key = (mark: string) => row('k', 400, 100, mark);
    const r = routeEdges({
      obstacles: new Map([['p', row('p', 0, 0, '').box], ['q', row('q', 0, 260, '').box], ['k', key('').box]]),
      soft: [],
      direction: 'right',
      edges: [
        { id: 'one', from: row('p', 0, 0, 'many'), to: key('one'), style: 'solid||many|one|1' },
        { id: 'maybe', from: row('q', 0, 260, 'many'), to: key('zeroOrOne'), style: 'solid||many|zeroOrOne|1' },
      ],
    });
    const last = (id: string) => r.get(id)!.points.at(-1)!.x;
    expect(new Set([last('one'), last('maybe')]).size).toBe(2);
  });
  it('never draw a link the source does not have: a context map keeps every relation on its own line', async () => {
    const r = await render(fs.readFileSync(path.join(examples, 'context-map/e-commerce.yaml'), 'utf8'), { fonts: 'none' });
    expect(falseJoins(r.graph!, r.placed!)).toEqual([]);
    // Ordering's two Customer/Supplier lines leave from their own spots, each with its own U.
    const ordering = r.graph!.edges.filter((e) => e.from.node === 'ordering');
    expect(new Set(ordering.map((e) => JSON.stringify(r.placed!.edges.get(e.id)!.points[0]))).size).toBe(ordering.length);
  });
  it('count lines that meet end to end on one track as a false join', () => {
    const graph = { direction: 'right', groups: [], nodes: [], edges: [
      { id: 'p', from: { node: 'a' }, to: { node: 'b' }, line: 'solid', start: 'none', end: 'arrow', path: [] },
      { id: 'q', from: { node: 'c' }, to: { node: 'd' }, line: 'solid', start: 'none', end: 'arrow', path: [] },
    ] } as unknown as Parameters<typeof falseJoins>[0];
    const edges = new Map([['p', { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }], ['q', { points: [{ x: 104, y: 0 }, { x: 200, y: 0 }] }]]);
    expect(falseJoins(graph, { edges })).toEqual(['p+q']);
    edges.set('q', { points: [{ x: 104, y: 30 }, { x: 200, y: 30 }] });
    expect(falseJoins(graph, { edges })).toEqual([]);
  });
});

describe('slide shape', () => {
  const pipeline = fs.readFileSync(path.join(examples, 'systems/data-pipeline.yaml'), 'utf8');
  const shape = (r: Awaited<ReturnType<typeof render>>) => r.width! / r.height!;
  it('wraps a long left-to-right chain into rows nearer 16:9', async () => {
    const r = await render(pipeline, { fonts: 'none' });
    expect(shape(r)).toBeLessThan(2.4);
    expect(measure(r.graph!, r.placed!).crossings).toBe(0);
  });
  it('moves a card outside the groups to the row of the card it is joined to', async () => {
    const stage = (g: string, a: string, b: string) => `  ${g}1: { kind: worker, label: ${a}, in: ${g} }\n  ${g}2: { kind: worker, label: ${b}, in: ${g} }\n`;
    const text = [
      'type: systems\ntitle: Stages\ndirection: right\ngroups:\n',
      ...['a', 'b', 'c', 'd'].map((g) => `  ${g}: { kind: domain, label: Stage ${g} }\n`),
      'nodes:\n',
      stage('a', 'Collector API', 'Readings'),
      stage('b', 'Enrichment', 'Validation'),
      stage('c', 'Raw zone', 'Curated tables'),
      stage('d', 'Delivery API', 'Dashboards'),
      '  customers: { kind: users, label: Customers }\n',
      'edges:\n  - a1 -> a2\n  - a2 -> b1\n  - b1 -> b2\n  - b2 -> c1\n  - c1 -> c2\n  - c2 -> d1\n  - d1 -> d2\n  - customers -> c1\n',
    ].join('');
    const r = await render(text, { fonts: 'none' });
    // Wrapped into two rows, the third stage starting the second.
    expect(r.placed!.memory!.variant).toMatch(/w2/);
    const box = (id: string) => r.placed!.nodes.get(id) ?? r.placed!.groups.get(id)!;
    const [b, c, customers] = [box('b'), box('c'), box('customers')];
    expect(c.y).toBeGreaterThan(b.y + b.height);
    // dot puts the customers in the column of the second stage: they go down to the row of the card they reach.
    expect(customers.y).toBeGreaterThan(b.y + b.height);
    const [from, to] = [customers, box('c1')];
    expect(Math.hypot(from.x - to.x, from.y - to.y)).toBeLessThan(400);
    // And it costs the page nothing: as large on a slide as with the customers left behind.
    expect(slideTextPt(r.svg!, r.width!, r.height!)).toBeGreaterThan(SLIDE_MIN_PT);
  });
  it('takes the drawing as it comes with aspect: auto', async () => {
    const r = await render(pipeline.replace('direction: right', 'direction: right\naspect: auto'), { fonts: 'none' });
    expect(r.diagnostics).toEqual([]);
    expect(shape(r)).toBeGreaterThan(3);
  });
  it('aims for the shape the source asks for', async () => {
    const wide = await render(pipeline.replace('direction: right', 'direction: right\naspect: 4:1'), { fonts: 'none' });
    expect(shape(wide)).toBeGreaterThan(3);
    const bad = await render(pipeline.replace('direction: right', 'direction: right\naspect: square'), { fonts: 'none' });
    expect(bad.diagnostics.map((d) => d.message).join()).toMatch(/aspect/);
  });
  it('weighs crossings, lines back and empty room against the size on the page', () => {
    // Twice the size is worth a crossing and more; a crossing is not worth 10% more size.
    expect(slideReadability(1, 1, 0)).toBeGreaterThan(slideReadability(0.5, 0, 0));
    expect(slideReadability(1.1, 1, 0)).toBeLessThan(slideReadability(1, 0, 0));
    expect(slideReadability(1, 0, 0, 0.3)).toBeLessThan(slideReadability(1, 0, 0));
  });
  it('fits the wide examples nearer a slide', async () => {
    for (const [file, most] of [['cloud/multi-cloud.yaml', 2.2], ['states/pull-request.yaml', 2.4], ['systems/web-shop.yaml', 2.2]] as const) {
      const r = await render(fs.readFileSync(path.join(examples, file), 'utf8'), { fonts: 'none' });
      expect(shape(r), file).toBeLessThan(most);
    }
  });
  it('knows its page: 16:9 by default, 4:3 and A4 by name, none with auto', async () => {
    const page = async (aspect?: string) => (await render(aspect ? pipeline.replace('direction: right', `direction: right\naspect: ${aspect}`) : pipeline, { fonts: 'none' })).page;
    expect(await page()).toMatchObject({ name: '16:9 slide', width: 1280, height: 720 });
    expect(await page('4:3')).toMatchObject({ name: '4:3 slide' });
    expect(await page('a4')).toMatchObject({ name: 'A4 landscape' });
    expect(await page('A4 portrait')).toMatchObject({ name: 'A4 portrait', width: 794, height: 1123 });
    expect(await page('auto')).toBeUndefined();
    // The readable part of a page: where the smallest text is still SLIDE_MIN_PT.
    const r = await render(pipeline, { fonts: 'none' });
    const area = readableArea(r.svg!, r.page!)!;
    expect(area.width / area.height).toBeCloseTo(16 / 9);
    expect(slideTextPt(r.svg!, area.width, area.height)).toBeCloseTo(SLIDE_MIN_PT);
  });
  it('knows how small the text gets on a 16:9 slide', async () => {
    const small = await render('type: azure\nnodes:\n  a: app-service\n  b: sql-database\nedges:\n  - a -> b\n', { fonts: 'none' });
    expect(slideTextPt(small.svg!, small.width!, small.height!)).toBeGreaterThan(SLIDE_MIN_PT);
    const wide = await render(pipeline.replace('direction: right', 'direction: right\naspect: auto'), { fonts: 'none' });
    expect(slideTextPt(wide.svg!, wide.width!, wide.height!)).toBeLessThan(SLIDE_MIN_PT);
  });
});

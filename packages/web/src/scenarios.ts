// What the start screen offers first: the drawings people come to make, each opening a bundled example
// (a path under examples/) that is ready to show and to change. Edit this list to change the cards; a
// path that is not bundled fails test/scenarios.test.ts. The English is shown through say(), so each
// title, sentence and label has its Dutch in i18n/nl-dialogs.ts.
import { starters, type Starter } from './library.ts';

export interface Scenario {
  title: string;
  /** One plain sentence: what the drawing shows. */
  text: string;
  /** The example the card opens. */
  example: string;
  /** Related examples, offered as links under the card: [label, path]. */
  also: [string, string][];
}

export const SCENARIOS: Scenario[] = [
  {
    title: 'Azure network',
    text: 'Hub and spoke: the firewall, peered spokes and the way to on-premises.',
    example: 'azure/hub-spoke.yaml',
    also: [
      ['Private endpoints', 'azure/private-endpoints.yaml'],
      ['Hybrid cloud', 'network/hybrid-cloud.yaml'],
    ],
  },
  {
    title: 'Landing zone',
    text: 'Management groups, subscriptions and the policy at each level.',
    example: 'azure/landing-zone.yaml',
    also: [['Application landing zone', 'azure/app-landing-zone.yaml']],
  },
  {
    title: 'Entra access',
    text: 'Who gets which access: access packages, approvals and what they grant.',
    example: 'access/access-packages.yaml',
    also: [
      ['Azure RBAC and PIM', 'access/azure-rbac-pim.yaml'],
      ['Privileged access', 'access/privileged-access.yaml'],
      ['Workload identities', 'azure/workload-identities.yaml'],
    ],
  },
  {
    title: 'Azure solution',
    text: 'One application in Azure: Front Door, the app, its data and its secrets.',
    example: 'azure/web-app.yaml',
    also: [
      ['AKS baseline', 'azure/aks-baseline.yaml'],
      ['Data platform', 'azure/data-platform.yaml'],
    ],
  },
  {
    title: 'Data products',
    text: 'A data mesh: domains, the data products they own and who uses them.',
    example: 'data-products/northwind-mesh.yaml',
    also: [['One data product', 'data-products/northwind-orders-product.yaml']],
  },
  {
    title: 'Databricks',
    text: 'A lakehouse on Azure Databricks: network, Unity Catalog and data.',
    example: 'databricks/overview.yaml',
    also: [
      ['Deployment', 'databricks/deployment.yaml'],
      ['Environments', 'databricks/environments.yaml'],
      ['Governance', 'databricks/governance.yaml'],
      ['Medallion', 'databricks/medallion.yaml'],
      ['Data mesh', 'databricks/mesh.yaml'],
    ],
  },
  {
    title: 'From PR to production',
    text: 'A change from pull request, through checks and review, to main.',
    example: 'process/pull-request.yaml',
    also: [
      ['Release to production', 'process/release-to-production.yaml'],
      ['GitHub flow', 'gitflow/github-flow-environments.yaml'],
    ],
  },
  {
    title: 'Sequence',
    text: 'Who calls whom, in order: signing in with Entra ID.',
    example: 'sequence/entra-sign-in.yaml',
    also: [
      ['Managed identity', 'sequence/managed-identity.yaml'],
      ['Service Bus events', 'sequence/service-bus-events.yaml'],
    ],
  },
];

/** The bundled example at a path under examples/. */
export const exampleAt = (path: string): Starter | undefined => starters.find((s) => s.id === `example:${path}`);

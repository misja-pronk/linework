// The questions to ask before drawing: a few per diagram type, so the prompt carries what a good
// diagram needs (scope, parts, flows) instead of one vague sentence. Chips come from the type's
// palette, so a new type gets sensible questions without code here.
import type { DiagramType } from './diagram-type.ts';

export interface Question {
  id: string;
  label: string;
  /** Shown under the field. */
  help?: string;
  kind: 'text' | 'long' | 'chips' | 'choice';
  placeholder?: string;
  options?: string[];
  /** Chips in named groups (the palette's collections), so a long list stays scannable. */
  groups?: { label: string; options: string[] }[];
  /** Pre-filled, so a first try works without typing much. */
  initial?: string | string[];
}

const about: Question = { id: 'about', label: 'What should the diagram show?', kind: 'long', placeholder: 'One or two sentences: the system, and the story the picture should tell.' };
const audience: Question = { id: 'audience', label: 'Who is it for?', kind: 'choice', options: ['Engineers', 'Architects', 'Management', 'Customer presentation'], initial: 'Architects' };
const detail: Question = { id: 'detail', label: 'How much detail?', kind: 'choice', options: ['Overview (5–10 shapes)', 'Normal (10–20 shapes)', 'Detailed (20+ shapes)'], initial: 'Normal (10–20 shapes)' };
const extra: Question = { id: 'extra', label: 'Anything else?', kind: 'long', placeholder: 'Names to use, things to leave out, constraints…' };

const parts = (type: DiagramType, label: string, help?: string): Question => ({
  id: 'parts',
  label,
  help,
  kind: 'chips',
  options: [...new Set(type.palette.map((p) => p.label))],
  groups: [...new Set(type.palette.map((p) => p.collection))].map((c) => ({
    label: c.charAt(0).toUpperCase() + c.slice(1).replace(/-/g, ' '),
    options: [...new Set(type.palette.filter((p) => p.collection === c).map((p) => p.label))],
  })),
});

const specific: Record<string, (type: DiagramType) => Question[]> = {
  systems: (t) => [
    { ...about, placeholder: 'E.g. our order platform: web shop, orders, payments and warehouse, and how they call each other.' },
    parts(t, 'What kinds of things are in it?', 'Pick what you know; the AI adds what is clearly missing.'),
    { id: 'grouping', label: 'Group them by', kind: 'choice', options: ['Team or domain', 'Layer (front, services, data)', 'Environment', 'No groups'], initial: 'Team or domain' },
    { id: 'external', label: 'Outside systems and people', kind: 'text', placeholder: 'Customers, a payment provider, the ERP…' },
  ],
  c4: () => [
    { ...about, label: 'Which software system?', placeholder: 'E.g. internet banking: customers view accounts and pay; it uses the mainframe and sends e-mail.' },
    { id: 'people', label: 'Who uses it?', kind: 'text', placeholder: 'Customers, back-office staff, support' },
    { id: 'external', label: 'Systems it depends on', kind: 'text', placeholder: 'Mainframe banking system, e-mail, identity provider' },
    { id: 'containers', label: 'Apps and data stores inside it (if you know them)', kind: 'text', placeholder: 'Web app, mobile app, API, database' },
    { id: 'views', label: 'Which views?', kind: 'chips', options: ['System landscape', 'System context', 'Containers', 'Components', 'Dynamic (numbered steps)', 'Deployment'], initial: ['System context', 'Containers'] },
  ],
  kubernetes: (t) => [
    { ...about, label: 'Which workloads?', placeholder: 'E.g. a shop: web and API deployments behind an ingress, a worker, Postgres as a StatefulSet.' },
    parts(t, 'What should appear?', 'Pick what you know; the AI adds what is clearly missing.'),
    { id: 'namespaces', label: 'Namespaces', kind: 'text', placeholder: 'shop, monitoring, ingress-nginx' },
    { id: 'traffic', label: 'How does traffic get in?', kind: 'choice', options: ['Ingress', 'Gateway API', 'LoadBalancer service', 'Internal only'], initial: 'Ingress' },
    { id: 'focus', label: 'Show', kind: 'choice', options: ['Traffic path', 'Config and storage too', 'Security (service accounts, network policies)'], initial: 'Traffic path' },
  ],
  sequence: () => [
    { ...about, label: 'Which interaction?', placeholder: 'E.g. checkout with a card: the shop creates a payment, the provider confirms by webhook.' },
    { id: 'participants', label: 'Who takes part, left to right', kind: 'text', placeholder: 'Shopper, Storefront, Orders API, Orders DB, Payment provider' },
    { id: 'messages', label: 'The messages, roughly', kind: 'long', placeholder: 'One per line is enough: place order, create payment, confirm card, webhook, mark paid…' },
    { id: 'branches', label: 'Include', kind: 'chips', options: ['Failure path', 'Retries or loops', 'Async messages', 'Notes'], initial: ['Failure path'] },
  ],
  gitflow: () => [
    { ...about, label: 'Which way of working?', placeholder: 'E.g. how a feature goes from branch to production in our team, including a hotfix.' },
    { id: 'preset', label: 'Branching model', kind: 'choice', options: ['GitHub Flow', 'Trunk-based', 'Git Flow', 'Release branches', 'Not sure'], initial: 'GitHub Flow' },
    { id: 'view', label: 'Show it as', kind: 'choice', options: ['Branches (commits, merges, tags)', 'Delivery (stages and environments)'], initial: 'Branches (commits, merges, tags)' },
    { id: 'environments', label: 'Environments', kind: 'text', placeholder: 'dev, test, acceptance, production' },
    { id: 'events', label: 'Include', kind: 'chips', options: ['Pull request review', 'Release tag', 'Hotfix', 'Cherry-pick', 'Deployments'], initial: ['Pull request review', 'Release tag'] },
  ],
  roadmap: () => [
    { ...about, label: 'Which plan?', placeholder: 'E.g. the data platform migration: foundation first, then three waves of workloads, old platform off in Q4.' },
    { id: 'period', label: 'Period', kind: 'text', placeholder: 'Q1 2027 to Q4 2027, or January to June' },
    { id: 'unit', label: 'Time in', kind: 'choice', options: ['Months', 'Quarters', 'Sprints', 'Now / next / later'], initial: 'Quarters' },
    { id: 'lanes', label: 'Workstreams or teams', kind: 'text', placeholder: 'Platform, Migration, Governance, Change' },
    { id: 'milestones', label: 'Milestones and deadlines', kind: 'text', placeholder: 'Go-live 1 June, audit in September, old contract ends 31 December' },
    { id: 'show', label: 'Include', kind: 'chips', options: ['Dependencies', 'Progress and status', 'Phases', 'Today line'], initial: ['Dependencies', 'Phases'] },
  ],
  journey: () => [
    { ...about, label: 'Whose journey, and towards what?', placeholder: 'E.g. a new developer, from the first day to the first deploy in production on our platform.' },
    { id: 'persona', label: 'Who is it about?', kind: 'text', placeholder: 'Dana, new backend developer; wants to ship a first change this week' },
    { id: 'phases', label: 'Phases, in order', kind: 'text', placeholder: 'First day, first commit, first deploy, first incident' },
    { id: 'steps', label: 'What happens, roughly', kind: 'long', placeholder: 'One step per line is enough; add what goes badly or well: finds the repository (lost, 40 repos), first review (quick)…' },
    { id: 'view', label: 'Show it as', kind: 'choice', options: ['Journey map (rows under the steps)', 'Storyboard (a card per step)', 'Service blueprint (frontstage, backstage)', 'Today next to future'], initial: 'Journey map (rows under the steps)' },
    { id: 'rows', label: 'Include', kind: 'chips', options: ['Touchpoints', 'Feeling curve', 'Thoughts', 'Pains', 'Gains', 'Opportunities', 'Metrics'], initial: ['Touchpoints', 'Feeling curve', 'Thoughts', 'Pains', 'Opportunities'] },
  ],
  process: () => [
    { ...about, label: 'Which process, from what to what?', placeholder: 'E.g. an access request: from the request by an employee to access granted or refused, with approval by the manager.' },
    { id: 'lanes', label: 'Who does the work? (a lane each; leave empty for a plain flowchart)', kind: 'text', placeholder: 'Employee, Manager, IT service desk, Identity system' },
    { id: 'steps', label: 'The steps of the usual way through', kind: 'long', placeholder: 'One per line is enough, in order: ask for access, manager approves, create account, tell the employee…' },
    { id: 'decisions', label: 'Decisions, and what happens on each answer', kind: 'long', placeholder: 'Approved? no: tell the employee why. Privileged role? yes: security also approves.' },
    { id: 'include', label: 'Include', kind: 'chips', options: ['Work in parallel', 'Waiting (timer)', 'Messages between lanes', 'What goes wrong (error end)', 'Documents', 'Notes'], initial: ['What goes wrong (error end)'] },
  ],
  states: () => [
    { ...about, label: 'The life of which thing?', placeholder: 'E.g. an order: from placed to delivered, with cancelling and returning.' },
    { id: 'states', label: 'The states it can be in', kind: 'text', placeholder: 'New, Paid, Packed, Shipped, Delivered, Cancelled, Returned' },
    { id: 'events', label: 'What moves it from one state to the next', kind: 'long', placeholder: 'One per line is enough: payment received, picked and packed, handed to the carrier, customer cancels (only before shipping)…' },
    { id: 'include', label: 'Include', kind: 'chips', options: ['Guards (conditions)', 'Actions on a transition', 'A state with states inside', 'Entry and exit actions', 'Choice points', 'Notes'], initial: ['Guards (conditions)'] },
  ],
  capabilities: () => [
    { ...about, label: 'Whose capabilities, for what decision?', placeholder: 'E.g. a retail bank, to decide where to invest in the next three years.' },
    { id: 'areas', label: 'Level-1 areas', kind: 'text', placeholder: 'Channels, Customer, Products, Payments, Risk, Support' },
    { id: 'heat', label: 'Colour it by', kind: 'choice', options: ['Maturity (1–5)', 'Investment (invest, maintain, divest)', 'Cost', 'Nothing yet'], initial: 'Maturity (1–5)' },
    { id: 'depth', label: 'Levels', kind: 'choice', options: ['Two', 'Three'], initial: 'Three' },
  ],
  teams: () => [
    { ...about, label: 'Which organisation or team?', placeholder: 'E.g. product and technology of a web shop: about 40 people in 6 teams.' },
    { id: 'view', label: 'Show it as', kind: 'choice', options: ['Org chart', 'Team Topologies', 'Both'], initial: 'Both' },
    { id: 'people', label: 'Who reports to whom, roughly', kind: 'long', placeholder: 'CTO; under them a head of product and a head of engineering; an open role for an SRE coach…' },
    { id: 'teams', label: 'Teams and how they work together', kind: 'long', placeholder: 'Checkout and Search are product teams; the platform team runs the paved road; Search collaborates with the ranking specialists.' },
  ],
  azure: (t) => [
    { ...about, placeholder: 'E.g. an order platform on Container Apps with a public API, events on Service Bus and SQL.' },
    parts(t, 'Which Azure services are involved?', 'Pick what you know; the AI adds what is clearly missing.'),
    { id: 'layout', label: 'How is it organised?', kind: 'choice', options: ['One subscription', 'Hub and spoke', 'Per environment (dev / test / prod)', 'Not sure'], initial: 'One subscription' },
    { id: 'network', label: 'Networking', kind: 'choice', options: ['Public endpoints', 'Private endpoints in a VNet', 'Mixed'], initial: 'Mixed' },
    { id: 'users', label: 'Who or what calls it?', kind: 'text', placeholder: 'Customers, partners, internal staff, other systems…' },
  ],
  cloud: (t) => [
    { ...about, placeholder: 'E.g. a web shop on AWS: a load balancer, containers on ECS and Aurora, across three availability zones.' },
    { id: 'provider', label: 'Which cloud?', kind: 'choice', options: ['AWS', 'Google Cloud', 'Several clouds or hybrid'], initial: 'AWS' },
    parts(t, 'Which services are involved?', 'Pick what you know; the AI adds what is clearly missing.'),
    { id: 'layout', label: 'How is it organised?', kind: 'choice', options: ['One account or project', 'Landing zone (organization, several accounts or projects)', 'Per environment (dev / test / prod)', 'Not sure'], initial: 'One account or project' },
    { id: 'network', label: 'Networking', kind: 'choice', options: ['Leave the network out', 'One VPC with public and private subnets', 'Subnet tiers across availability zones', 'Hub network with VPN or interconnect'], initial: 'One VPC with public and private subnets' },
    { id: 'users', label: 'Who or what calls it?', kind: 'text', placeholder: 'Customers, partners, internal staff, other systems…' },
  ],
  network: (t) => [
    { ...about, label: 'Which network?', placeholder: 'E.g. our office: a firewall pair, a core switch, four VLANs and Wi-Fi; a VPN to Azure.' },
    parts(t, 'What should appear?', 'Zones and devices; the AI adds what is clearly missing.'),
    { id: 'addressing', label: 'Addressing (if you know it)', kind: 'text', placeholder: 'VLAN 10 staff 10.0.10.0/24, VLAN 20 voice…' },
    { id: 'view', label: 'Show it as', kind: 'choice', options: ['Topology', 'IP plan table'], initial: 'Topology' },
  ],
  erd: () => [
    { ...about, label: 'What is the database for?', placeholder: 'E.g. a webshop: customers, orders, products, payments.' },
    { id: 'tables', label: 'Main tables (if you know them)', kind: 'text', placeholder: 'customers, orders, order_lines, products' },
    { id: 'engine', label: 'Database', kind: 'choice', options: ['PostgreSQL', 'SQL Server', 'MySQL', 'Generic'], initial: 'PostgreSQL' },
    { id: 'schemas', label: 'Group tables in schemas?', kind: 'choice', options: ['No', 'Yes, by area'], initial: 'No' },
  ],
  access: () => [
    { ...about, label: 'Whose access should it explain?', placeholder: 'E.g. the engineering department: developers, ops and contractors across dev and prod.' },
    { id: 'principals', label: 'Teams, groups or people', kind: 'text', placeholder: 'Developers, Ops, Contractors, Data team' },
    { id: 'resources', label: 'Where do they need access?', kind: 'text', placeholder: 'Subscriptions, repos, databases, environments…' },
    { id: 'view', label: 'Show it as', kind: 'choice', options: ['Graph (who gets what through which role)', 'Matrix (who × where)', 'Access packages', 'Roles × permissions'], initial: 'Graph (who gets what through which role)' },
  ],
  github: (t) => [
    { ...about, label: 'Which organisation or setup?', placeholder: 'E.g. our product org: platform team, two product teams, a shared actions repo.' },
    parts(t, 'What should appear?'),
    { id: 'teams', label: 'Teams', kind: 'text', placeholder: 'platform, web, mobile, security' },
    { id: 'repos', label: 'Repositories', kind: 'text', placeholder: 'api, web, infra, shared-actions' },
  ],
  'data-products': (t) => [
    { ...about, label: 'Which data landscape?', placeholder: 'E.g. customer data: CRM and webshop feed source products, a Customer 360 aggregate, churn and marketing on top.' },
    { id: 'domains', label: 'Domains', kind: 'text', placeholder: 'Sales, Customer, Marketing, Finance' },
    { id: 'sources', label: 'Source systems', kind: 'text', placeholder: 'Salesforce, webshop database, SAP' },
    parts(t, 'What should appear?'),
    { id: 'view', label: 'Detail level', kind: 'choice', options: ['Overview (products and lineage)', 'Detailed (ports, contracts, fields)'], initial: 'Overview (products and lineage)' },
  ],
};

/** A type's questions, in English or through `say` in another language (palette labels stay as the type has them). */
export function questionsFor(type: DiagramType, say: (text: string) => string = (s) => s): Question[] {
  const own = specific[type.id]?.(type) ?? [about, parts(type, 'What should appear?')];
  return [...own, audience, detail, extra].map((q) => local(q, say));
}

const local = (q: Question, say: (text: string) => string): Question => ({
  ...q,
  label: say(q.label),
  ...(q.help ? { help: say(q.help) } : {}),
  ...(q.placeholder ? { placeholder: say(q.placeholder) } : {}),
  ...(q.options && !q.groups ? { options: q.options.map((o) => say(o)) } : {}),
  ...(q.initial !== undefined ? { initial: Array.isArray(q.initial) ? q.initial.map((o) => say(o)) : say(q.initial) } : {}),
});

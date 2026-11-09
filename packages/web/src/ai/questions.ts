// The questions behind "Describe it": a few per diagram type, so the prompt carries what a good
// diagram needs (scope, parts, flows) instead of one vague sentence. Chips come from the type's
// palette, so a new type gets sensible questions without code here.
import type { DiagramType } from '@cartography/core';

export interface Question {
  id: string;
  label: string;
  /** Shown under the field. */
  help?: string;
  kind: 'text' | 'long' | 'chips' | 'choice';
  placeholder?: string;
  options?: string[];
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
});

const specific: Record<string, (type: DiagramType) => Question[]> = {
  azure: (t) => [
    { ...about, placeholder: 'E.g. an order platform on Container Apps with a public API, events on Service Bus and SQL.' },
    parts(t, 'Which Azure services are involved?', 'Pick what you know; Claude adds what is clearly missing.'),
    { id: 'layout', label: 'How is it organised?', kind: 'choice', options: ['One subscription', 'Hub and spoke', 'Per environment (dev / test / prod)', 'Not sure'], initial: 'One subscription' },
    { id: 'network', label: 'Networking', kind: 'choice', options: ['Public endpoints', 'Private endpoints in a VNet', 'Mixed'], initial: 'Mixed' },
    { id: 'users', label: 'Who or what calls it?', kind: 'text', placeholder: 'Customers, partners, internal staff, other systems…' },
  ],
  erd: (t) => [
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

export function questionsFor(type: DiagramType): Question[] {
  const own = specific[type.id]?.(type) ?? [about, parts(type, 'What should appear?')];
  return [...own, audience, detail, extra];
}

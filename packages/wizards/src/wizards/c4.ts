import { names, type Answers, type Wizard } from '../engine.ts';
import { comment, entry, file, ids, scalar, slug } from '../yaml.ts';

const SOURCE = 'Simon Brown, the C4 model (c4model.com): system context and container diagrams';

const CONTAINERS: Record<string, { kind: string; label: string; technology: string; description: string }> = {
  web: { kind: 'web-app', label: 'Web app', technology: 'React', description: 'What users see in the browser' },
  mobile: { kind: 'mobile-app', label: 'Mobile app', technology: 'iOS and Android', description: 'The same on the phone' },
  api: { kind: 'container', label: 'API', technology: 'Node.js', description: 'Business logic, served as JSON over HTTPS' },
  db: { kind: 'database', label: 'Database', technology: 'PostgreSQL', description: 'Accounts, orders and everything else that must last' },
  queue: { kind: 'queue', label: 'Message queue', technology: 'RabbitMQ', description: 'Work to do later, in order' },
  worker: { kind: 'container', label: 'Worker', technology: 'Node.js', description: 'Picks up work from the queue: email, exports' },
};

export const c4Starter: Wizard = {
  id: 'c4-starter',
  name: 'C4 starter',
  type: 'c4',
  description: 'Your system, the people who use it and the systems it talks to, as a context and a container view',
  source: SOURCE,
  questions: [
    { id: 'system', kind: 'text', label: 'What is the system called?', default: 'Online shop' },
    { id: 'purpose', kind: 'text', label: 'What does it do, in one line?', default: 'Lets customers find, buy and track products' },
    { id: 'people', kind: 'text', list: true, label: 'Who uses it?', default: 'Customer, Customer service', help: 'Roles, separated by commas.' },
    { id: 'externals', kind: 'text', list: true, label: 'Which other systems does it talk to?', default: 'Payment provider, Email service', help: 'Separated by commas; empty for none.' },
    {
      id: 'containers',
      kind: 'multi',
      label: 'What is it made of?',
      default: ['web', 'api', 'db'],
      options: Object.entries(CONTAINERS).map(([value, c]) => ({ value, label: c.label, help: c.description })),
    },
  ],
  build,
};

function build(a: Answers): string {
  const system = String(a.system) || 'Online shop';
  const sys = slug(system);
  const people = names(a.people).slice(0, 5);
  if (!people.length) people.push('User');
  const externals = names(a.externals).slice(0, 5);
  const picked = Array.isArray(a.containers) && a.containers.length ? a.containers : ['api'];
  const has = (c: string) => picked.includes(c);
  const pids = ids(people, [sys]);
  const xids = ids(externals, [sys, ...pids]);
  const L: (string | false)[] = [];
  L.push(...comment(`Made by the C4 starter wizard (carto new --wizard c4-starter). Follows ${SOURCE}.`));
  L.push(...comment('One model, two views: the context (who and what around the system) and its containers (what runs inside).'));
  L.push('type: c4');
  L.push(`title: ${scalar(system)}`);
  L.push('');
  L.push('elements:');
  people.forEach((p, i) => L.push(entry(pids[i]!, { kind: 'person', label: p, description: i === 0 ? `Uses ${system}` : `Works with ${system}` })));
  L.push('');
  L.push(`  ${sys}:`);
  L.push(`    kind: software-system`);
  L.push(`    label: ${scalar(system)}`);
  L.push(`    description: ${scalar(String(a.purpose) || `What ${system} does`)}`);
  L.push(`    elements:`);
  for (const c of picked) {
    const k = CONTAINERS[c]!;
    L.push(entry(c, { kind: k.kind, label: k.label, technology: k.technology, description: k.description }, 6));
  }
  if (externals.length) L.push('');
  externals.forEach((x, i) => L.push(entry(xids[i]!, { kind: 'software-system', label: x, external: true, description: `Outside ${system}` })));
  L.push('');
  L.push('relations:');
  // People reach the system through its front ends; without one, through the API.
  const fronts = ['web', 'mobile'].filter(has);
  const entryPoints = fronts.length ? fronts : has('api') ? ['api'] : [picked[0]!];
  people.forEach((_, i) => {
    const via = i === 0 || entryPoints.length === 1 ? entryPoints : entryPoints.slice(0, 1);
    for (const f of via) L.push(`  - ${pids[i]} -> ${sys}.${f}: ${i === 0 ? 'Uses' : 'Manages'}`);
  });
  if (has('api')) for (const f of fronts) L.push(`  - ${sys}.${f} -> ${sys}.api: { label: Calls, technology: JSON/HTTPS }`);
  const core = has('api') ? 'api' : picked[0]!;
  if (has('db') && core !== 'db') L.push(`  - ${sys}.${core} -> ${sys}.db: { label: Reads and writes, technology: SQL }`);
  if (has('queue') && core !== 'queue') L.push(`  - ${sys}.${core} -> ${sys}.queue: { label: Sends work, style: async }`);
  if (has('queue') && has('worker')) L.push(`  - ${sys}.queue -> ${sys}.worker: { label: Delivers, style: async }`);
  if (has('worker') && has('db') && !has('queue')) L.push(`  - ${sys}.worker -> ${sys}.db: Reads`);
  // The first external is called by the core; the others by the worker when there is one.
  xids.forEach((x, i) => L.push(`  - ${sys}.${i > 0 && has('worker') ? 'worker' : core} -> ${x}: ${i === 0 ? 'Calls' : 'Sends through'}`));
  L.push('');
  L.push('views:');
  L.push(`  context:`);
  L.push(`    kind: context`);
  L.push(`    of: ${sys}`);
  L.push(`    title: ${scalar(`${system} — system context`)}`);
  L.push(`    subtitle: The people and systems around it`);
  L.push(`  containers:`);
  L.push(`    kind: container`);
  L.push(`    of: ${sys}`);
  L.push(`    title: ${scalar(`${system} — containers`)}`);
  L.push(`    subtitle: What runs, and how the parts talk`);
  return file(L);
}

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkDecisions,
  decisionFileName,
  decisionLog,
  decisionSection,
  decisionSummary,
  decisionTable,
  decisionTemplate,
  decisionsAbout,
  decisionsDir,
  decisionsOnDrawing,
  indexWorkspace,
  isDecisionFile,
  markdownBlocks,
  nextDecisionNumber,
  parseDecision,
  planRename,
  readConcern,
  readDecisions,
  renameDecisionConcerns,
  resolveConcern,
  searchWorkspace,
  setDecisionConcerns,
  setDecisionStatus,
  supersede,
  type Graph,
} from '@cartography/core';

const madr = `---
status: accepted
date: 2026-03-04
concerns: [online.db, "online.api -> online.db"]
deciders: [ann, bo]
---

# Use PostgreSQL

## Context and Problem Statement

We need a store.

## Considered Options

- PostgreSQL
- Cosmos

## Decision Outcome

Chosen option: **PostgreSQL**, because the team knows it.

### Consequences

- Good, because …
`;

// adr-tools writes these.
const nygard = `# 2. Record architecture decisions

Date: 2026-01-12

## Status

Superseded by [5. Use events](0005-use-events.md)

## Context

We need to record the architectural decisions made on this project.

## Decision

We will use Architecture Decision Records.

## Consequences

See Michael Nygard's article.
`;

const nygardNew = `# 5. Use events

Date: 2026-02-01

## Status

Accepted

Supersedes [2. Record architecture decisions](0002-record-architecture-decisions.md)

## Context

…
`;

// log4brains / MADR 2 bullets.
const bullets = `# Use Markdown Architectural Decision Records

- Status: proposed
- Deciders: Ann
- Date: 2021-04-03

## Context and Problem Statement

Which format?
`;

const graph = (nodes: string[], groups: string[] = [], edges: [string, string][] = []): Graph => ({
  direction: 'down',
  nodes: nodes.map((id) => ({ id, shape: { kind: 'card', label: id, tone: 'slate' }, path: [] })),
  groups: groups.map((id) => ({ id, label: id, tone: 'slate', border: 'solid', path: [] })),
  edges: edges.map(([a, b], i) => ({ id: `e${i}`, from: { node: a }, to: { node: b }, path: [] })) as Graph['edges'],
  legend: [],
});

describe('reading decisions', () => {
  it('reads MADR with front matter', () => {
    const d = parseDecision('decisions/0001-use-postgresql.md', madr);
    expect(d).toMatchObject({ number: 1, title: 'Use PostgreSQL', status: 'accepted', date: '2026-03-04', concerns: ['online.db', 'online.api -> online.db'], deciders: ['ann', 'bo'], style: 'front-matter' });
    expect(decisionSection(d, 'decision')).toMatch(/Chosen option/);
    expect(decisionSection(d, 'options')).toMatch(/Cosmos/);
    expect(decisionSummary(d)).toBe('Chosen option: PostgreSQL, because the team knows it.');
  });

  it("reads Nygard's form (adr-tools): numbered title, Date: line, Status section", () => {
    const d = parseDecision('doc/adr/0002-record-architecture-decisions.md', nygard);
    expect(d).toMatchObject({ number: 2, title: 'Record architecture decisions', status: 'superseded', supersededBy: 5, date: '2026-01-12', style: 'section', concerns: [] });
    const n = parseDecision('doc/adr/0005-use-events.md', nygardNew);
    expect(n).toMatchObject({ number: 5, status: 'accepted', supersedes: [2] });
  });

  it("reads log4brains' bullets and numbers dated files by order", () => {
    const list = readDecisions(
      [
        ['docs/adr/20210403-use-markdown.md', bullets],
        ['docs/adr/20210501-use-postgres.md', madr],
        ['docs/adr/README.md', '# ADRs'],
        ['docs/adr/template.md', '# Title'],
      ],
      'docs/adr',
    );
    expect(list.map((d) => [d.number, d.title, d.status, d.date ?? ''])).toEqual([
      [1, 'Use Markdown Architectural Decision Records', 'proposed', '2021-04-03'],
      [2, 'Use PostgreSQL', 'accepted', '2026-03-04'],
    ]);
  });

  it('finds the folder: .adr-dir, .log4brains.yml, a known folder, else decisions/', () => {
    expect(decisionsDir([['.adr-dir', 'architecture/adr\n']])).toBe('architecture/adr');
    expect(decisionsDir([['.log4brains.yml', 'project:\n  name: x\n  adrFolder: ./docs/decisions\n']])).toBe('docs/decisions');
    expect(decisionsDir([['doc/adr/0001-x.md', nygard]])).toBe('doc/adr');
    expect(decisionsDir([['shop.yaml', 'type: systems']])).toBe('decisions');
    expect(isDecisionFile('decisions/0001-x.md', 'decisions')).toBe(true);
    expect(isDecisionFile('decisions/README.md', 'decisions')).toBe(false);
    expect(isDecisionFile('docs/x.md', 'decisions')).toBe(false);
  });

  it('reads the example folder', () => {
    const dir = path.join(import.meta.dirname, '../../../examples/workspace/decisions');
    const list = readDecisions(fs.readdirSync(dir).map((f) => [`decisions/${f}`, fs.readFileSync(path.join(dir, f), 'utf8')]), 'decisions');
    expect(list.map((d) => `${d.number} ${d.status}`)).toEqual(['1 accepted', '2 superseded', '3 accepted', '4 proposed']);
    expect(list[1]!.supersededBy).toBe(3);
    expect(list[2]!.supersedes).toEqual([2]);
  });
});

describe('writing decisions', () => {
  it('numbers and names a new decision, and writes the template', () => {
    expect(nextDecisionNumber(readDecisions([['decisions/0003-a.md', madr]], 'decisions'))).toBe(4);
    expect(decisionFileName(4, 'Use Kafka for payment events!')).toBe('0004-use-kafka-for-payment-events.md');
    expect(decisionFileName(12, 'Café — naïve')).toBe('0012-cafe-naive.md');
    const t = decisionTemplate({ number: 4, title: 'Use Kafka', concerns: ['payments.events', 'a -> b'], date: '2026-11-10' });
    const d = parseDecision('decisions/0004-use-kafka.md', t);
    expect(d).toMatchObject({ number: 4, title: 'Use Kafka', status: 'proposed', date: '2026-11-10', concerns: ['payments.events', 'a -> b'] });
    expect(t).toContain('concerns: [payments.events, "a -> b"]');
  });

  it('sets the status where the file keeps it, and nothing else', () => {
    const a = setDecisionStatus(madr, 'decisions/0001-use-postgresql.md', 'deprecated');
    expect(a.replace('status: deprecated', 'status: accepted')).toBe(madr);
    const n = setDecisionStatus(nygardNew, 'doc/adr/0005-use-events.md', 'superseded', { number: 7, title: 'Use streams', file: 'doc/adr/0007-use-streams.md' });
    expect(n).toContain('## Status\n\nSuperseded by [7. Use streams](0007-use-streams.md)\n\nSupersedes [2. Record architecture decisions](0002-record-architecture-decisions.md)\n\n## Context');
    expect(parseDecision('doc/adr/0005-use-events.md', n)).toMatchObject({ status: 'superseded', supersededBy: 7, supersedes: [2] });
    const b = setDecisionStatus(bullets, 'docs/adr/x.md', 'accepted');
    expect(b).toContain('- Status: accepted\n- Deciders: Ann');
  });

  it('supersedes: the new one says what it supersedes, the old one is marked', () => {
    const old = parseDecision('decisions/0001-use-postgresql.md', madr);
    const [neu, was] = supersede(old, { number: 6, title: 'Use CockroachDB', file: 'decisions/0006-use-cockroachdb.md', date: '2026-11-10', concerns: old.concerns });
    expect(parseDecision(neu!.file, neu!.text)).toMatchObject({ supersedes: [1], concerns: old.concerns });
    expect(neu!.text).toContain('[1. Use PostgreSQL](0001-use-postgresql.md)');
    expect(parseDecision(was!.file, was!.text)).toMatchObject({ status: 'superseded', supersededBy: 6 });
  });

  it('sets concerns, adding front matter to a file without it', () => {
    const t = setDecisionConcerns(nygard, ['ledger', 'api -> db']);
    expect(t.startsWith('---\nconcerns: [ledger, "api -> db"]\n---\n\n# 2. Record')).toBe(true);
    expect(parseDecision('doc/adr/0002-x.md', t)).toMatchObject({ concerns: ['ledger', 'api -> db'], status: 'superseded', style: 'section' });
    const block = '---\nstatus: accepted\nconcerns:\n  - a\n  - b\ndate: 2026-01-01\n---\n# T\n';
    expect(setDecisionConcerns(block, ['c'])).toBe('---\nstatus: accepted\nconcerns: [c]\ndate: 2026-01-01\n---\n# T\n');
    expect(setDecisionConcerns(block, [])).toBe('---\nstatus: accepted\ndate: 2026-01-01\n---\n# T\n');
  });

  it('renames concerns, a part of an id along with its parent', () => {
    const t = renameDecisionConcerns(madr, 'x.md', (id) => (id === 'online' || id.startsWith('online.') ? 'digital' + id.slice(6) : id));
    expect(parseDecision('x.md', t!).concerns).toEqual(['digital.db', 'digital.api -> digital.db']);
    expect(t!.replace('concerns: [digital.db, "digital.api -> digital.db"]', 'concerns: [online.db, "online.api -> online.db"]')).toBe(madr);
    expect(renameDecisionConcerns(madr, 'x.md', (id) => id)).toBeUndefined();
  });
});

describe('decisions on a drawing', () => {
  const g = graph(['api', 'db', 'engine'], ['online'], [['api', 'db']]);
  it('resolves ids, ids drawn under another name, lines and views', () => {
    expect(readConcern('a -> b')).toEqual({ kind: 'edge', from: 'a', to: 'b' });
    expect(readConcern('containers.yaml#online')).toEqual({ kind: 'view', file: 'containers.yaml', view: 'online' });
    expect(resolveConcern('db', g)).toEqual({ kind: 'node', id: 'db' });
    expect(resolveConcern('online', g)).toEqual({ kind: 'group', id: 'online' });
    expect(resolveConcern('payments.engine', g, { drawnAs: (id) => (id === 'payments.engine' ? 'engine' : undefined) })).toEqual({ kind: 'node', id: 'engine' });
    expect(resolveConcern('api -> db', g)).toEqual({ kind: 'edge', id: 'e0' });
    expect(resolveConcern('db -> api', g)).toBeUndefined();
    expect(resolveConcern('containers.yaml#online', g, { file: 'containers.yaml', view: 'online' })).toEqual({ kind: 'view' });
    expect(resolveConcern('containers.yaml#online', g, { file: 'containers.yaml', view: 'api' })).toBeUndefined();
    const d = parseDecision('decisions/0001-x.md', madr.replace('[online.db, "online.api -> online.db"]', '[db, "api -> db", nope]'));
    expect(decisionsOnDrawing([d], g).map((x) => x.target)).toEqual([
      { kind: 'node', id: 'db' },
      { kind: 'edge', id: 'e0' },
    ]);
    expect(decisionsAbout([d], 'api')).toHaveLength(1);
    expect(decisionsAbout([d], 'engine')).toHaveLength(0);
  });

  it('checks concerns against what there is', () => {
    const d = parseDecision('decisions/0001-x.md', madr.replace('status: accepted', 'status: accepted\nsuperseded-by: 9'));
    const out = checkDecisions([d], { element: (id) => id === 'online.db', near: () => 'online.dbs' });
    expect(out.map((p) => p.message)).toEqual([
      'Decision 1 concerns "online.api", which is not in the workspace; did you mean online.dbs?',
      'Decision 1 is superseded by 9, which is not in the folder',
    ]);
    expect(out[0]!.line).toBe(5);
  });

  it('writes the log and the table', () => {
    const list = readDecisions(
      [
        ['decisions/0001-use-postgresql.md', madr],
        ['decisions/0002-record.md', nygard],
      ],
      'decisions',
    );
    const md = decisionLog(list, { dir: 'decisions' });
    expect(md).toContain('| 1 | [Use PostgreSQL](0001-use-postgresql.md) | Accepted | 2026-03-04 | online.db, online.api -> online.db |');
    expect(md).toContain('| 2 | [Record architecture decisions](0002-record.md) | Superseded by 5 |');
    const t = decisionTable(list);
    expect(t.nodes[0]!.shape.kind).toBe('matrix');
    expect(t.subtitle).toBe('1 accepted, 1 superseded');
  });

  it('turns markdown into blocks', () => {
    const b = markdownBlocks('# T\n\nA **b** c\nd\n\n- x\n- y\n\n1. one\n\n```\ncode\n```\n> q');
    expect(b.map((x) => x.kind)).toEqual(['heading', 'para', 'list', 'list', 'code', 'quote']);
  });
});

describe('decisions in the workspace', () => {
  const model = 'type: model\nelements:\n  online:\n    elements:\n      api: { kind: container }\n      db: { kind: database }\n  ledger: { kind: software-system }\n';
  const files: [string, string][] = [
    ['model.yaml', model],
    ['decisions/0001-use-postgresql.md', madr],
    ['decisions/0002-x.md', '---\nconcerns: [ledgr]\n---\n# X\n'],
  ];
  it('indexes them, warns about unknown ids, finds them, and renames follow', () => {
    const ix = indexWorkspace(files);
    expect(ix.decisions.map((d) => d.number)).toEqual([1, 2]);
    expect(ix.problems.some((p) => p.file === 'decisions/0002-x.md' && /concerns "ledgr".*did you mean ledger/.test(p.message))).toBe(true);
    expect(searchWorkspace(ix, 'postgresql')[0]).toMatchObject({ kind: 'decision', id: '1', file: 'decisions/0001-use-postgresql.md' });
    const plan = planRename(ix, 'online', 'digital');
    const f = plan.files.find((x) => x.file === 'decisions/0001-use-postgresql.md');
    expect(f?.after).toContain('concerns: [digital.db, "digital.api -> digital.db"]');
    expect(f?.count).toBe(2);
  });
});

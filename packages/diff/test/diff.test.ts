// What changed between two versions of a diagram: as data, as words and as marks on the picture.
import { describe, expect, it } from 'vitest';
import { compare, formatDiff, markdownDiff, summary } from '../src/index.ts';

const before = `type: azure
title: Web shop
groups:
  rg: { kind: resource-group, label: rg-shop }
  data: { kind: subnet, label: snet-data, in: rg }
nodes:
  users: users
  web: { kind: app-service, label: Web shop, in: rg }
  api: { kind: container-app, label: Orders, in: rg }
  db: { kind: sql-database, label: Orders, in: data }
  reports: { kind: app-service, label: Reports, in: rg }
edges:
  - users -> web: { label: HTTPS }
  - web -> api: { label: REST }
  - api -> db: { label: SQL }
  - reports -> db
`;

const after = `type: azure
title: Web shop
groups:
  rg: { kind: resource-group, label: rg-shop }
  data: { kind: subnet, label: snet-data, in: rg }
  edge: { kind: subnet, label: snet-edge, in: rg }
nodes:
  users: users
  web: { kind: app-service, label: Web shop, in: edge }
  api: { kind: container-app, label: Orders service, in: rg }
  db: { kind: sql-database, label: Orders, in: data }
  cache: { kind: redis, label: Sessions, in: data }
edges:
  - users -> web: { label: HTTPS }
  - web -> api: { label: REST }
  - web -> cache
  - api -> db: { label: T-SQL }
`;

const ids = (list: { id: string; status: string }[], status: string) => list.filter((i) => i.status === status).map((i) => i.id);
/** Every mark in the picture as "status kind id". */
const marks = (svg: string) => [...svg.matchAll(/<g data-diff="(\w+)" data-(node|group|edge)="([^"]*)"/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`);

describe('structural diff', () => {
  it('names what was added, removed and changed, by id', async () => {
    const { diff } = await compare(before, after);
    expect(ids(diff.nodes, 'added')).toEqual(['cache']);
    expect(ids(diff.nodes, 'removed')).toEqual(['reports']);
    expect(ids(diff.nodes, 'changed').sort()).toEqual(['api', 'web']);
    expect(ids(diff.groups, 'added')).toEqual(['edge']);
    expect(ids(diff.edges, 'added')).toEqual(['web -> cache']);
    expect(ids(diff.edges, 'removed')).toEqual(['reports -> db']);
    expect(ids(diff.edges, 'changed')).toEqual(['api -> db']);
    expect(diff.counts).toEqual({ added: 3, removed: 2, changed: 3 });
    expect(diff.same).toBe(false);

    const api = diff.nodes.find((n) => n.id === 'api')!;
    expect(api.changes).toEqual([{ field: 'label', before: 'Orders', after: 'Orders service' }]);
    expect(diff.nodes.find((n) => n.id === 'web')!.changes).toEqual([{ field: 'group', before: 'rg', after: 'edge' }]);
    const line = diff.edges.find((e) => e.id === 'api -> db')!;
    expect(line.changes).toEqual([{ field: 'label', before: 'SQL', after: 'T-SQL' }]);
    // The line's id in each drawing follows its place in the file; the diff carries both.
    expect(line.edge).toEqual({ before: 'e2', after: 'e3' });
  });

  it('is silent about a file that is only reordered or reformatted', async () => {
    const shuffled = `type: azure
title: Web shop

edges:
  - reports -> db
  - api -> db: { label: SQL }
  - web -> api:
      label: REST
  - users -> web: { label: HTTPS }
nodes:
  reports: { kind: app-service, label: Reports, in: rg }
  db: { kind: sql-database, label: Orders, in: data }
  api: { kind: container-app, label: Orders, in: rg }
  web: { kind: app-service, label: Web shop, in: rg }
  users: users
groups:
  rg: { kind: resource-group, label: rg-shop }
  data: { kind: subnet, label: snet-data, in: rg }
`;
    const { diff } = await compare(before, shuffled);
    expect(formatDiff(diff)).toBe('');
    expect(diff.same).toBe(true);
    expect(summary(diff)).toBe('no changes');
  });

  it('tells a second line between the same two cards from the first', async () => {
    const one = 'type: azure\nnodes:\n  a: app-service\n  b: sql-database\nedges:\n  - a -> b: { label: reads }\n';
    const two = one + '  - a -> b: { label: writes }\n';
    const { diff } = await compare(one, two);
    expect(diff.edges).toEqual([{ kind: 'edge', id: 'a -> b #2', status: 'added', label: 'writes', edge: { after: 'e1' } }]);
    const back = await compare(two, one);
    expect(ids(back.diff.edges, 'removed')).toEqual(['a -> b #2']);
  });

  it('reports a new file as all added and a deleted one as all removed', async () => {
    const fresh = await compare(undefined, after);
    expect(fresh.diff.counts).toEqual({ added: 5 + 3 + 4, removed: 0, changed: 0 });
    const gone = await compare(before, undefined);
    expect(gone.diff.counts).toEqual({ added: 0, removed: 5 + 2 + 4, changed: 0 });
    expect(gone.picture()?.svg).toContain('data-diff="removed"');
  });

  it('notices a new title', async () => {
    const { diff } = await compare(before, before.replace('title: Web shop', 'title: Shop'));
    expect(diff.diagram).toEqual([{ field: 'title', before: 'Web shop', after: 'Shop' }]);
    expect(diff.same).toBe(false);
    expect(summary(diff)).toBe('title changed');
  });

  it('goes into a table, row by row', async () => {
    const erd = (type: string) => `type: erd\ntables:\n  customers:\n    columns:\n      id: uuid pk\n      email: ${type}\n`;
    const { diff, failed } = await compare(erd('text'), erd('varchar'));
    expect(failed).toBe(false);
    expect(diff.nodes).toHaveLength(1);
    expect(diff.nodes[0]!.id).toBe('customers');
    expect(diff.nodes[0]!.status).toBe('changed');
    const changes = diff.nodes[0]!.changes!;
    expect(changes).toHaveLength(1);
    expect(changes[0]!.field).toContain('email');
    expect(changes[0]).toMatchObject({ before: 'text', after: 'varchar' });
  });

  it('says it in words, for a terminal and for a pull request', async () => {
    const { diff } = await compare(before, after);
    expect(summary(diff)).toBe('3 added, 2 removed, 3 changed');
    const text = formatDiff(diff).split('\n');
    expect(text).toContain('+ node  cache          "Sessions"');
    expect(text).toContain('- node  reports        "Reports"');
    expect(text).toContain('~ node  api            label: "Orders" → "Orders service"');
    expect(text).toContain('~ line  api -> db      label: "SQL" → "T-SQL"');
    expect(text).toContain('+ line  web -> cache');
    const md = markdownDiff(diff);
    expect(md).toContain('| + added | node | `cache` | Sessions |');
    expect(md).toContain('| − removed | line | `reports -> db` |');
    expect(markdownDiff(diff, 2)).toContain('…and 6 more.');
  });
});

describe('visual diff', () => {
  it('marks exactly what changed, on the newer drawing', async () => {
    const c = await compare(before, after);
    const picture = c.picture({ against: 'main' })!;
    const line = (id: string) => c.diff.edges.find((e) => e.id === id)!.edge!;
    expect(marks(picture.svg).sort()).toEqual(
      [
        'added node cache',
        'added group edge',
        `added edge ${line('web -> cache').after}`,
        'changed node api',
        'changed node web',
        `changed edge ${line('api -> db').after}`,
        'removed node reports',
        // A line that is gone has no id in the newer drawing: its mark carries its ends.
        'removed edge reports -&gt; db',
      ].sort(),
    );
    expect(line('reports -> db')).toEqual({ before: 'e3' });
    // Untouched cards carry no mark.
    expect(picture.svg).not.toMatch(/data-diff="\w+" data-node="(users|db)"/);
    expect(picture.svg).toContain('data-diff-overlay');
    // The picture is the newer drawing: the new card is in it, the old label only as a ghost.
    expect(picture.svg).toContain('Sessions');
    expect(picture.svg).toContain('Reports');
    expect(picture.width).toBeGreaterThanOrEqual(c.after!.width!);
    expect(picture.height).toBeGreaterThan(c.after!.height!);
  });

  it('does not rest on colour: each state has its own outline, sign and word', async () => {
    const c = await compare(before, after);
    const svg = c.picture()!.svg;
    const mark = (status: string, id: string) => svg.match(new RegExp(`<g data-diff="${status}" data-node="${id}">.*?</g>`))![0];
    const added = mark('added', 'cache');
    const changed = mark('changed', 'api');
    const removed = mark('removed', 'reports');
    expect(added).not.toContain('stroke-dasharray');
    expect(changed).toContain('stroke-dasharray="7 5"');
    expect(removed).toContain('stroke-dasharray="1.5 5"');
    expect(added).toContain('+ added');
    expect(changed).toContain('~ changed');
    expect(removed).toContain('− removed');
    // And a key that says so, with the counts.
    const key = svg.match(/<g data-diff-key="">.*?<\/g>/)![0];
    for (const word of ['+ added', '~ changed', '− removed']) expect(key).toContain(word);
  });

  it('takes its colours from the theme', async () => {
    const light = await compare(before, after);
    const dark = await compare(before, after, { before: { themeOverride: 'dark' }, after: { themeOverride: 'dark' } });
    const tone = dark.after!.theme!.tones.green.fg;
    expect(tone).not.toBe(light.after!.theme!.tones.green.fg);
    expect(dark.picture()!.svg).toContain(`stroke="${tone}"`);
    expect(dark.picture()!.svg).not.toContain(`stroke="${light.after!.theme!.tones.green.fg}"`);
  });

  it('draws what is gone where it used to be', async () => {
    const c = await compare(before, after);
    const svg = c.picture()!.svg;
    const ghost = svg.match(/<g data-diff="removed" data-node="reports"><rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/)!;
    const old = c.before!.placed!.nodes.get('reports')!;
    expect(Number(ghost[3])).toBeCloseTo(old.width, 0);
    expect(Number(ghost[4])).toBeCloseTo(old.height, 0);
    // Its neighbour in both drawings moved as far as the ghost did, or the ghost went to the row below.
    const db = { was: c.before!.placed!.nodes.get('db')!, now: c.after!.placed!.nodes.get('db')! };
    const shift = { x: Number(ghost[1]) - old.x, y: Number(ghost[2]) - old.y };
    const follows = Math.abs(shift.x - (db.now.x - db.was.x)) < 200 && Math.abs(shift.y - (db.now.y - db.was.y)) < 200;
    expect(follows || svg.includes('No longer in the drawing')).toBe(true);
  });

  it('keeps what both versions have in place, unless asked to draw afresh', async () => {
    const held = await compare(before, after);
    const still = ['users', 'db'].filter((id) => {
      const a = held.before!.placed!.nodes.get(id)!;
      const b = held.after!.placed!.nodes.get(id)!;
      return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
    });
    expect(still).toEqual(['users', 'db']);
    const fresh = await compare(before, after, { fresh: true });
    expect(fresh.diff).toEqual(held.diff);
  });

  it('puts before and after next to each other, each with its own marks', async () => {
    const c = await compare(before, after);
    const svg = c.sideBySide({ labels: { before: 'main', after: 'This pull request' } })!.svg;
    const [, left, right] = svg.match(/<g data-diff-panel="before"[^>]*>(.*)<g data-diff-panel="after"[^>]*>(.*)/s)!;
    expect(marks(left!).sort()).toEqual(['changed edge e2', 'changed node api', 'changed node web', 'removed edge e3', 'removed node reports']);
    expect(marks(right!)).toContain('added node cache');
    expect(marks(right!)).not.toContain('removed node reports');
    expect(svg).toContain('main');
    expect(svg).toContain('This pull request');
    expect(svg.match(/data-diff-key/g)).toHaveLength(1);
    const column = c.sideBySide({ arrange: 'column' })!;
    const row = c.sideBySide({ arrange: 'row' })!;
    expect(column.height).toBeGreaterThan(row.height);
    expect(row.width).toBeGreaterThan(column.width);
  });

  it('leaves an unchanged drawing alone, with a key that says so', async () => {
    const c = await compare(before, before);
    const picture = c.picture()!;
    expect(marks(picture.svg)).toEqual([]);
    expect(picture.svg).toContain('No changes');
  });

  it('is one well-formed svg', async () => {
    const c = await compare(before, after);
    for (const svg of [c.picture()!.svg, c.sideBySide()!.svg]) {
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.match(/<svg\b/g)).toHaveLength(1);
      expect(svg.match(/<g\b/g)!.length).toBe(svg.match(/<\/g>/g)!.length);
    }
  });
});

// Free placement: what is put somewhere by hand stays there, what is not moves as little as it can,
// and nothing ever lies on anything it is not in.
import { describe, expect, it } from 'vitest';
import { packLayout, type LayoutSidecar } from '@cartography/core';
import { boxOverlaps, measure } from '@cartography/layout';
import { render } from '../src/index.ts';

const base = 'type: azure\ntitle: Drops\ngroups:\n  sub: { kind: subscription, label: Subscription }\n  rg: { kind: resource-group, label: Resource group, in: sub }\nnodes:\n  app: { kind: app-service, label: App Service, in: rg }\n  users: { kind: users, label: Users }\nedges:\n  - users -> app\n';
const withSql = base.replace('  users: {', '  sql: { kind: sql-database, label: SQL Database, in: rg }\n  users: {');
type R = Awaited<ReturnType<typeof render>>;
/** Where an element is in pin space (where a pin puts its top-left corner). */
const at = (r: R, id: string) => {
  const b = r.placed!.nodes.get(id) ?? r.placed!.groups.get(id)!;
  const s = r.placed!.shift ?? { x: 0, y: 0 };
  return { x: b.x + s.x, y: b.y + s.y, width: b.width, height: b.height };
};
const moved = (a: R, b: R, id: string) => Math.hypot(at(b, id).x - at(a, id).x, at(b, id).y - at(a, id).y);

/** The first drawing, then the same with a shape dropped (pinned) at `drop`, as the editor does it. */
async function drop(dx: number, dy: number) {
  const first = await render(base, { fonts: 'none' });
  const app = at(first, 'app');
  const pin = { x: app.x + dx, y: app.y + app.height + dy };
  const sidecar: LayoutSidecar = { version: 1, nodes: { sql: pin }, layout: packLayout(first.placed!.memory, false) };
  const after = await render(withSql, { fonts: 'none', sidecar, previous: first.placed!.memory });
  return { first, after, pin };
}

/** Displacement budget (px) for an element that had to make room: no more than its own size and the air around it. */
const ROOM = 260;

describe('free placement', () => {
  it('keeps a dropped shape where it lands and its neighbours where they were', async () => {
    const { first, after, pin } = await drop(0, 40);
    expect(at(after, 'sql')).toMatchObject(pin);
    expect(moved(first, after, 'app')).toBe(0);
    expect(moved(first, after, 'users')).toBe(0);
    expect(measure(after.graph!, after.placed!).overlaps).toBe(0);
  });

  it('never lets a grown group lie over what it does not hold, wherever the drop', async () => {
    for (const dx of [-320, -240, -160, -80, 0, 80, 200])
      for (const dy of [24, 80]) {
        const { first, after, pin } = await drop(dx, dy);
        const where = `drop at ${dx},${dy}`;
        expect(at(after, 'sql'), where).toMatchObject(pin);
        expect(boxOverlaps(after.graph!, after.placed!), where).toEqual([]);
        expect(measure(after.graph!, after.placed!).overlaps, where).toBe(0);
        // What was not in the way stays; what was, moves out of it and no further than it must.
        expect(moved(first, after, 'app'), where).toBe(0);
        expect(moved(first, after, 'users'), where).toBeLessThanOrEqual(ROOM);
      }
  });

  it('keeps everything that is not pinned where it was when a shape is added in the text', async () => {
    const first = await render(base, { fonts: 'none' });
    const users = at(first, 'users');
    // Users dragged a little down: pinned.
    const sidecar: LayoutSidecar = { version: 1, nodes: { users: { x: users.x, y: users.y + 64 } }, layout: packLayout(first.placed!.memory, false) };
    const pinned = await render(base, { fonts: 'none', sidecar, previous: first.placed!.memory });
    const after = await render(withSql, { fonts: 'none', sidecar, previous: pinned.placed!.memory });
    expect(at(after, 'users')).toMatchObject(sidecar.nodes!.users!);
    expect(moved(pinned, after, 'app')).toBe(0);
    expect(measure(after.graph!, after.placed!).overlaps).toBe(0);
  });

  it('moves the newer of two pins that would lie on top of each other, and says so', async () => {
    const first = await render(withSql, { fonts: 'none' });
    const app = at(first, 'app');
    const sidecar: LayoutSidecar = { version: 1, nodes: { app: { x: app.x, y: app.y }, users: { x: app.x + 20, y: app.y + 10 } } };
    const r = await render(withSql, { fonts: 'none', sidecar });
    expect(at(r, 'app')).toMatchObject({ x: app.x, y: app.y });
    expect(r.placed!.nudged).toEqual(['users']);
    expect(r.diagnostics.map((d) => d.message).join()).toMatch(/pinned on top of another/);
    const [a, u] = [at(r, 'app'), at(r, 'users')];
    expect(a.x < u.x + u.width && u.x < a.x + a.width && a.y < u.y + u.height && u.y < a.y + a.height).toBe(false);
  });

  it('draws the rest afresh around the pins when the memory is dropped (Tidy)', async () => {
    const first = await render(withSql, { fonts: 'none' });
    const sql = at(first, 'sql');
    const pin = { x: sql.x + 400, y: sql.y + 200 };
    const r = await render(withSql, { fonts: 'none', sidecar: { version: 1, nodes: { sql: pin } }, previous: null });
    expect(at(r, 'sql')).toMatchObject(pin);
    expect(boxOverlaps(r.graph!, r.placed!)).toEqual([]);
  });

  it('moves a group pinned elsewhere with everything in it', async () => {
    const first = await render(withSql, { fonts: 'none' });
    const rg = at(first, 'rg');
    const sidecar: LayoutSidecar = { version: 1, groups: { rg: { x: rg.x + 160, y: rg.y + 96 } }, layout: packLayout(first.placed!.memory, false) };
    const r = await render(withSql, { fonts: 'none', sidecar, previous: first.placed!.memory });
    expect(at(r, 'rg')).toMatchObject({ x: rg.x + 160, y: rg.y + 96 });
    for (const id of ['app', 'sql']) expect({ x: at(r, id).x - at(first, id).x, y: at(r, id).y - at(first, id).y }).toEqual({ x: 160, y: 96 });
    expect(boxOverlaps(r.graph!, r.placed!)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { render } from '../src/index.ts';

// Review 3: a typo in a kind gave two errors, each listing 36 kinds, and no "did you mean".
describe('kind problems', () => {
  it('one error per value, with what was probably meant and only a few kinds', async () => {
    const r = await render('type: systems\nnodes:\n  a: { kind: servce }\n', { fonts: 'none' });
    const errors = r.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/^"kind" cannot be "servce": did you mean service\? \(36 allowed, e\.g\. /);
    expect(errors[0]!.message.split(',').length).toBeLessThan(10);
    expect(errors[0]!.choices).toContain('service');
    expect(errors[0]!.line).toBe(3);
  });

  it('a short list is still said whole', async () => {
    const r = await render('type: states\nstates:\n  A: { kind: stat }\n', { fonts: 'none' });
    expect(r.diagnostics.find((d) => d.severity === 'error')?.message).toBe('"kind" must be one of: state, choice, final, history (did you mean state?)');
  });

  it('reads "user" as the person kind of a sequence diagram, with a hint', async () => {
    const r = await render('type: sequence\nparticipants:\n  user: User\n  shop: { kind: service }\nmessages:\n  - user -> shop: Order\n', { fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.svg).toBeTruthy();
  });

  it('person in a cloud diagram is its user, people its users', async () => {
    const r = await render('type: azure\nnodes:\n  a: person\n  b: { kind: people }\n  w: app-service\nedges:\n  - a -> w\n  - b -> w\n', { fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(r.diagnostics.map((d) => d.message)).toEqual(expect.arrayContaining(['"person" is read as user, the kind this diagram type has: write user', '"people" is read as users, the kind this diagram type has: write users']));
  });
});

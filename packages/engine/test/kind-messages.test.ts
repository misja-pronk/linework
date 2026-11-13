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

  it('an entry written short with a value that is no kind: about the value, not the name', async () => {
    const r = await render('type: data-products\nsources:\n  crm: nope\n  erp: 3\n', { fonts: 'none' });
    expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([
      '"crm: nope": "nope" is not a kind. Write a kind after the name (application, database, erp, saas, stream, file, api, device), or the details in { }, like crm: { label: crm }',
      '"erp: 3": "3" is not a kind. Write a kind after the name (application, database, erp, saas, stream, file, api, device), or the details in { }, like erp: { label: erp }',
    ]);
  });

  it('says in plain words what text after a closing } is, and what an unknown type was meant to be', async () => {
    const stray = await render('type: systems\nnodes:\n  a: { kind: service } x\n', { fonts: 'none' });
    expect(stray.diagnostics[0]).toMatchObject({ line: 3, message: 'There is text after the closing } on this line: remove it, or move it inside the { }' });
    const typo = await render('type: sytems\n', { fonts: 'none' });
    expect(typo.diagnostics[0]).toMatchObject({ line: 1, message: 'Unknown type "sytems": did you mean systems? (completion in the editor and carto types list them all)' });
    expect(typo.diagnostics[0]!.choices).toContain('systems');
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

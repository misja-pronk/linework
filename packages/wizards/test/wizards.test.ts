import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { asked, coerce, combinations, resolve, run, wizards, wizardsFor, type Wizard } from '../src/index.ts';

/** Answer sets per wizard: all of them for the small wizards, a fixed sample for the big ones. */
const LIMIT = 24;

async function problems(w: Wizard, yaml: string, steps = false): Promise<string[]> {
  const r = await render(yaml, { fonts: 'none' });
  const out = r.diagnostics.map((d) => `${d.severity} line ${d.line ?? '?'}: ${d.message}`);
  if (!r.svg) out.push('nothing drawn');
  if (r.type?.id !== (/^type: (\S+)/m.exec(yaml)?.[1] ?? w.type)) out.push(`drawn as ${r.type?.id}`);
  // Every presenting step draws too (checked for some answer sets: each step is a whole render).
  for (let s = 1; steps && s <= (r.steps?.length ?? 0); s++) {
    const step = await render(yaml, { fonts: 'none', step: s });
    out.push(...step.diagnostics.map((d) => `step ${s}: ${d.severity}: ${d.message}`));
  }
  return out;
}

describe('wizard engine', () => {
  const w = wizards.find((x) => x.id === 'aws-landing-zone')!;

  it('fills in defaults and drops what was not asked', () => {
    const a = resolve(w, { infrastructure: false });
    expect(a.org).toBe('Acme');
    expect('inspection' in a).toBe(false);
    expect(asked(w, { infrastructure: false }).map((q) => q.id)).not.toContain('onprem');
    expect(asked(w).map((q) => q.id)).toContain('onprem');
  });

  it('reads answers the way the terminal and JSON give them', () => {
    const q = (id: string) => w.questions.find((x) => x.id === id)!;
    expect(coerce(q('environments'), 'n')).toBe(false);
    expect(coerce(q('environments'), 'Yes')).toBe(true);
    expect(coerce(q('onprem'), '2')).toBe('vpn');
    expect(coerce(q('onprem'), 'direct connect')).toBe('dx');
    expect(coerce(q('onprem'), 'carrier pigeon')).toBeUndefined();
    expect(coerce(q('workloads'), ' Shop ,, shop, Billing')).toBe('Shop, Billing');
    const azs = wizards.find((x) => x.id === 'aws-three-tier')!.questions.find((x) => x.id === 'azs')!;
    expect(coerce(azs, '9')).toBe(3);
    expect(coerce(azs, 'two')).toBeUndefined();
  });

  it('gives the same YAML for the same answers', () => {
    for (const x of wizards) expect(run(x)).toBe(run(x));
  });

  it('offers wizards per type', () => {
    expect(wizardsFor('azure').map((x) => x.id)).toContain('hub-spoke');
    expect(wizardsFor('network').map((x) => x.id)).toEqual(['hub-spoke']);
    expect(wizardsFor('erd')).toEqual([]);
  });

  it('every wizard names its source and has unique question ids', () => {
    for (const x of wizards) {
      expect(x.source.length, x.id).toBeGreaterThan(20);
      expect(run(x), x.id).toContain('Follows');
      expect(new Set(x.questions.map((q) => q.id)).size, x.id).toBe(x.questions.length);
    }
  });

  it('survives odd names', async () => {
    const lz = wizards.find((x) => x.id === 'azure-landing-zone')!;
    const yaml = run(lz, { org: 'Ünïcode: "Co" #1', corp: 'A, a, Finance & Risk, 123', online: '' });
    expect(await problems(lz, yaml, true)).toEqual([]);
  });
});

describe.each(wizards.map((w) => [w.id, w] as const))('%s', (_, w) => {
  const sets = combinations(w, LIMIT);

  it(`draws ${sets.length} answer sets without errors or warnings`, { timeout: 240_000 }, async () => {
    const failed: string[] = [];
    for (const [i, a] of sets.entries()) {
      const p = await problems(w, w.build(a), i % 8 === 0);
      if (p.length) failed.push(`${JSON.stringify(a)}\n  ${p.join('\n  ')}`);
    }
    expect(failed).toEqual([]);
  });
});

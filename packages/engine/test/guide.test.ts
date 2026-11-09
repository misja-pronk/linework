import { describe, expect, it } from 'vitest';
import { matchTypes } from '@cartography/core';
import { icon } from '../../icons/src/index.ts';
import { types } from '../src/index.ts';

const best = (q: string) => matchTypes(q, types)[0]!;

describe('type guidance', () => {
  it('every type says what it is for, briefly', () => {
    for (const t of types) {
      expect(t.tagline, t.id).toBeTruthy();
      expect(t.tagline!.length, t.id).toBeLessThanOrEqual(72);
      expect(t.useWhen?.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.useWhen!.length, t.id).toBeLessThanOrEqual(4);
      for (const u of t.useWhen!) expect(u.length, u).toBeLessThanOrEqual(64);
      expect(icon(t.icon ?? ''), `${t.id} icon`).toBeDefined();
      for (const n of t.notFor ?? []) if (n.use) expect(types.map((x) => x.id), n.text).toContain(n.use);
    }
  });

  it('ranks types by what people type', () => {
    expect(best('who has access to production').type.id).toBe('access');
    expect(best('tables and foreign keys').type.id).toBe('erd');
    expect(best('vnet subnets and private endpoints').type.id).toBe('azure');
    expect(best('teams and repositories').type.id).toBe('github');
    expect(best('data mesh contracts').type.id).toBe('data-products');
    expect(best('microservices and queues').type.id).toBe('systems');
    expect(best('c4').type.id).toBe('c4');
    expect(best('context diagram').type.id).toBe('c4');
    expect(best('container diagram').type.id).toBe('c4');
    expect(best('structurizr deployment diagram').type.id).toBe('c4');
  });

  it('keeps the order when nothing matches', () => {
    expect(matchTypes('', types).map((r) => r.type.id)).toEqual(types.map((t) => t.id));
    expect(matchTypes('zzz', types).every((r) => r.score === 0)).toBe(true);
  });
});

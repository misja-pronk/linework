import { describe, expect, it } from 'vitest';
import { render } from '@cartography/engine';
import { elementAt, elementSpans, elementsAt, spanOf } from '../src/mapping.ts';

const text = `type: systems
title: Shop
groups:
  back: { kind: zone, label: Backend }
nodes:
  web: { kind: client, label: Web }
  api:
    kind: api
    in: back
  db: { kind: database, in: back }
edges:
  - web -> api: calls
  - api -> db
`;

describe('YAML ↔ element mapping', async () => {
  const r = await render(text, { fonts: 'none' });
  const spans = elementSpans(text, r.graph!);

  it('finds every drawn element in the text', () => {
    expect(spans.map((s) => `${s.kind}:${s.id}`).sort()).toEqual(['edge:e0', 'edge:e1', 'group:back', 'node:api', 'node:db', 'node:web']);
  });

  it('points a click at the key of the entry', () => {
    const api = spanOf(spans, 'node', 'api')!;
    expect(text.slice(api.at, api.at + 4)).toBe('api:');
    const e0 = spanOf(spans, 'edge', 'e0')!;
    expect(text.slice(e0.at).startsWith('web -> api: calls')).toBe(true);
  });

  it('finds what the cursor is on, the innermost entry', () => {
    expect(elementAt(spans, text.indexOf('in: back'))?.id).toBe('api');
    expect(elementAt(spans, text.indexOf('Backend'))?.id).toBe('back');
    expect(elementAt(spans, text.indexOf('api -> db') + 3)?.id).toBe('e1');
    expect(elementAt(spans, text.indexOf('title'))).toBeUndefined();
  });

  it('lights up all elements written in one place', () => {
    expect(elementsAt(spans, text.indexOf('database')).map((s) => s.id)).toEqual(['db']);
  });
});

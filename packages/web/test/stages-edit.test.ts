import { describe, expect, it } from 'vitest';
import { dropFrom, listed, recordIn, tidyStages } from '../src/stages/stages-edit.ts';

const text = `type: systems
nodes:
  a: { kind: service }
  b: { kind: service }
edges:
  - a -> b
stages:
  - id: as-is
  - id: q2
    add: [b]
  - id: to-be
    remove: a
`;

describe('stage edits', () => {
  it('records in a stage, creating the list or turning one name into a list', () => {
    expect(recordIn(text, 1, 'add', 'c')).toMatch(/add: \[\s*b, c\s*\]/);
    expect(recordIn(text, 2, 'remove', 'b')).toMatch(/remove: \[\s*a, b\s*\]/);
    expect(recordIn(text, 1, 'remove', 'a -> b')).toMatch(/remove: \[\s*a -> b\s*\]/);
    expect(recordIn(text, 1, 'add', 'b')).toBe(text);
    expect(listed(text, 2, 'remove', 'a')).toBe(true);
  });

  it('drops from a stage, the key with its last name', () => {
    const out = dropFrom(text, 1, 'add', 'b')!;
    expect(out).not.toContain('add:');
    expect(out).toContain('  - id: q2\n');
  });

  it('tidies the stages of what is gone', () => {
    const gone = text.replace('  b: { kind: service }\n', '').replace('  - a -> b\n', '');
    const out = tidyStages(gone);
    expect(out).not.toMatch(/add:/);
    expect(out).toContain('remove: a');
    expect(tidyStages(text)).toBe(text);
  });
});

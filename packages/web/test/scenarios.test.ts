import { describe, expect, it } from 'vitest';
import { SCENARIOS, exampleAt } from '../src/scenarios.ts';
import { nl } from '../src/i18n/nl.ts';

describe("the start screen's cards", () => {
  it('open examples that are bundled', () => {
    const paths = SCENARIOS.flatMap((s) => [s.example, ...s.also.map(([, p]) => p)]);
    expect(paths.filter((p) => !exampleAt(p))).toEqual([]);
  });
  it('say everything in Dutch too', () => {
    const words = SCENARIOS.flatMap((s) => [s.title, s.text, ...s.also.map(([label]) => label)]);
    expect(words.filter((w) => !(w in nl))).toEqual([]);
  });
});

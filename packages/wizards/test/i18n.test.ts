// The wizards in Dutch: every question, hint and answer has its Dutch, and a translated wizard
// asks the same and writes the same YAML.
import { describe, expect, it } from 'vitest';
import { badMessages, unusedIds } from '@cartography/i18n/lint';
import { asked, coerce, run, translateWizard, wizardWords, wizards } from '../src/index.ts';
import { nl } from '../src/nl.ts';

const words = new Set(wizards.flatMap(wizardWords));

describe('wizards in Dutch', () => {
  it('has the Dutch of every text a person reads, and nothing for text that is gone', () => {
    expect(badMessages(nl)).toEqual([]);
    expect([...words].filter((w) => !(w in nl))).toEqual([]);
    expect(unusedIds(nl, '', (id) => words.has(id))).toEqual([]);
  });

  it('asks the same questions with the same values and writes the same YAML', () => {
    for (const w of wizards) {
      const d = translateWizard(w, 'nl');
      expect(d.id).toBe(w.id);
      expect(d.questions.map((q) => [q.id, q.kind, q.default])).toEqual(w.questions.map((q) => [q.id, q.kind, q.default]));
      expect(run(d)).toBe(run(w));
      expect(asked(d).map((q) => q.id)).toEqual(asked(w).map((q) => q.id));
      expect(wizardWords(d).filter((x, i) => x !== wizardWords(w)[i]).length, w.id).toBeGreaterThan(0);
    }
    expect(translateWizard(wizards[0]!, 'en')).toBe(wizards[0]);
  });

  it('reads a Dutch answer label and a Dutch yes', () => {
    const aks = translateWizard(wizards.find((w) => w.id === 'aks-baseline')!, 'nl');
    const ingress = aks.questions.find((q) => q.id === 'ingress')!;
    expect(coerce(ingress, 'nginx-ingresscontroller')).toBe('nginx');
    expect(coerce(aks.questions.find((q) => q.id === 'private')!, 'j')).toBe(true);
    expect(aks.questions[0]!.label).toBe('Wat draait er op het cluster?');
  });
});

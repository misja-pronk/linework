// A wizard in another language: the same questions, answers and build, with the words people read
// (its name, description, questions, hints and answer labels) from ./nl.ts. The English in the
// wizard files stays the source; the values, defaults and the YAML do not change.
import { lookup, type Lang } from '@cartography/i18n';
import type { Option, Question, Wizard } from './engine.ts';
import { nl } from './nl.ts';

const say = lookup(nl);

/** The wizard as shown in `lang`; English (or undefined) gives it back as it is. */
export function translateWizard(w: Wizard, lang: Lang | undefined): Wizard {
  if (lang !== 'nl') return w;
  const word = <T extends string | undefined>(s: T): T => (s === undefined ? s : (say(lang, s) as T));
  const option = (o: Option): Option => ({ ...o, label: word(o.label), ...(o.help !== undefined ? { help: word(o.help) } : {}) });
  const question = (q: Question): Question => {
    const base = { ...q, label: word(q.label), ...(q.help !== undefined ? { help: word(q.help) } : {}) };
    if (base.kind === 'choice' || base.kind === 'multi') return { ...base, options: base.options.map(option) } as Question;
    if (base.kind === 'text' && base.placeholder !== undefined) return { ...base, placeholder: word(base.placeholder) };
    if (base.kind === 'number' && base.unit !== undefined) return { ...base, unit: word(base.unit) };
    return base;
  };
  return { ...w, name: word(w.name), description: word(w.description), questions: w.questions.map(question) };
}

/** Every text of a wizard a person reads, for the tests: each needs its Dutch. */
export function wizardWords(w: Wizard): string[] {
  const out = [w.name, w.description];
  for (const q of w.questions) {
    out.push(q.label, ...(q.help ? [q.help] : []));
    if (q.kind === 'choice' || q.kind === 'multi') for (const o of q.options) out.push(o.label, ...(o.help ? [o.help] : []));
    if (q.kind === 'text' && q.placeholder) out.push(q.placeholder);
    if (q.kind === 'number' && q.unit) out.push(q.unit);
  }
  return out;
}

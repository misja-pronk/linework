// The editor's language: the browser's by default, else what was picked in the settings menu
// (remembered per browser). t('Save') gives the text in it; the Dutch is in ./nl.ts, typed so a
// new English message does not compile without its Dutch. Text that is only known at run time
// (a shortcut's description from keys.ts) goes through `say`, which passes unknown text as is.
// The language of what is drawn is the diagram's own `lang:`, not this.
import { useSyncExternalStore } from 'react';
import { lookup, pickLang, translator, type Lang, type Params } from '@cartography/i18n';
import { store } from '../store.ts';
import { nl } from './nl.ts';

export type { Lang } from '@cartography/i18n';
export type Message = keyof typeof nl;

const KEY = 'lang';
const browser = (): Lang => pickLang(typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language]);
let current: Lang = store.get<Lang>(KEY) === 'nl' || store.get<Lang>(KEY) === 'en' ? store.get<Lang>(KEY)! : browser();
const listeners = new Set<() => void>();
if (typeof document !== 'undefined') document.documentElement.lang = current;

/** What was picked in the menu: a language, or `undefined` for the browser's. */
export const uiLangChoice = (): Lang | undefined => (store.get<Lang>(KEY) === 'nl' || store.get<Lang>(KEY) === 'en' ? store.get<Lang>(KEY)! : undefined);

/** The editor's language now. */
export const uiLang = () => current;

/** Picks the editor's language and remembers it; `undefined` goes back to the browser's. */
export function setUiLang(lang: Lang | undefined) {
  store.set(KEY, lang ?? null);
  current = lang ?? browser();
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  for (const l of listeners) l();
}

/** Re-renders on a change of language (the app's root reads it, so everything under it follows). */
export function useUiLang(): Lang {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => current,
  );
}

const tr = translator(nl);
const free = lookup(nl);

/** An editor message in the editor's language. */
export const t = (id: Message, params?: Params) => tr(current, id, params);
/** Text known only at run time, in the editor's language when the catalog has it. */
export const say = (text: string, params?: Params) => free(current, text, params);

/** A new diagram from the start dialog speaks the editor's language: Dutch gets `lang: nl` after `type:`. */
export const withUiLang = (yaml: string) => (current === 'nl' && !/^lang:/m.test(yaml) ? yaml.replace(/^(type:.*)$/m, '$1\nlang: nl') : yaml);

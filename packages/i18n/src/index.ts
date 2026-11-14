// Linework's own words in more than one language, without a library. The English text is the
// message id: code says t('Save') and reads as it shows, and a catalog per area (drawing, editor,
// CLI) gives the Dutch for each id. The ids are typed from the Dutch catalog, so a new or
// changed English message does not compile until it has its Dutch; test/catalog.test.ts checks
// that every id is still used somewhere.
//
// A message may hold placeholders, {name}, filled from the params. A plural is written as its
// forms joined by "|", one then other ("{count} element|{count} elements"), and picks by `count`.
// The same English that needs two Dutch words takes a context after "@" ("Open@state"): English
// shows the text before it.

export type Lang = 'en' | 'nl';
export const LANGS: readonly Lang[] = ['en', 'nl'];
export const LANG_NAMES: Record<Lang, string> = { en: 'English', nl: 'Nederlands' };

export type Params = Record<string, string | number>;
/** A catalog: English id → Dutch. */
export type Catalog = Record<string, string>;

/** A language from what people write ("nl", "nl-NL", "Dutch", "nl_BE.UTF-8"): Dutch or English. */
export function readLang(value: unknown): Lang | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const v = value.trim().toLowerCase();
  if (/^(nl|nld|dut)([-_.@].*)?$/.test(v) || v === 'dutch' || v === 'nederlands') return 'nl';
  if (/^(en|eng)([-_.@].*)?$/.test(v) || v === 'english' || v === 'engels' || v === 'c' || v === 'posix') return 'en';
  return undefined;
}

/** The first language in a list (navigator.languages, or LC_ALL, LC_MESSAGES, LANG) that is one of ours. */
export function pickLang(candidates: readonly (string | undefined)[], fallback: Lang = 'en'): Lang {
  for (const c of candidates) {
    const l = readLang(c);
    if (l) return l;
  }
  return fallback;
}

const rules = new Map<Lang, Intl.PluralRules>();
const plural = (lang: Lang, n: number) => {
  let r = rules.get(lang);
  if (!r) rules.set(lang, (r = new Intl.PluralRules(lang)));
  return r.select(n) === 'one' ? 0 : 1;
};

/** Fills {name} placeholders and picks a plural form; what has no param stays as written. */
export function format(text: string, lang: Lang, params?: Params): string {
  let s = text;
  if (s.includes('|')) {
    const forms = s.split('|');
    const n = Number(params?.count ?? params?.n);
    s = forms[Number.isFinite(n) ? Math.min(plural(lang, n), forms.length - 1) : forms.length - 1]!;
  }
  if (!params || !s.includes('{')) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** The English of an id: the text before a context mark. */
export const english = (id: string) => {
  const at = id.indexOf('@');
  return at > 0 ? id.slice(0, at) : id;
};

/**
 * A translator for one catalog: t(lang, 'English text', params). Ids not in the catalog (text made
 * at run time, a message from elsewhere) pass through as English.
 */
export function translator<C extends Catalog>(nl: C) {
  return (lang: Lang | undefined, id: keyof C & string, params?: Params): string => format(lang === 'nl' ? (nl[id] ?? english(id)) : english(id), lang ?? 'en', params);
}

/**
 * A translator for text that is only known at run time (a style's label from a type, a shortcut
 * from the table): the Dutch when the catalog has it, else the text itself.
 */
export function lookup(nl: Catalog) {
  return (lang: Lang | undefined, text: string, params?: Params): string => format(lang === 'nl' ? (nl[text] ?? english(text)) : english(text), lang ?? 'en', params);
}

/** "a, b and c" / "a, b en c". */
export function listWords(lang: Lang | undefined, xs: string[], and = lang === 'nl' ? 'en' : 'and'): string {
  return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} ${and} ${xs.at(-1)}`;
}

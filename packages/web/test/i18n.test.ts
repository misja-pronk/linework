import { describe, expect, it } from 'vitest';
import { badMessages, sourceText, unusedIds } from '@cartography/i18n/lint';
import { nl } from '../src/i18n/nl.ts';
import { SHORTCUTS } from '../src/keys.ts';
import { setUiLang, t, withUiLang } from '../src/i18n/index.ts';

const catalog: Record<string, string> = nl;
/** Text keys.ts holds and the sheet looks up with say(). */
const fromTable = new Set(SHORTCUTS.flatMap((s) => [s.what, s.group, ...(s.show ? [s.show] : [])]));
/** A field name in the inspector: a YAML key in title case ("Technology"), shown with say(). */
const fieldName = (id: string) => /^[A-Z][a-z]+$/.test(id);

describe("the editor's Dutch", () => {
  it('has every shortcut and every heading of the sheet', () => {
    expect(SHORTCUTS.flatMap((s) => [s.what, s.group]).filter((x) => !(x in catalog))).toEqual([]);
    expect(SHORTCUTS.flatMap((s) => (s.show && /[a-z]{2}/i.test(s.show.replace(/Tab|Esc|Home|End|F\d/g, '')) ? [s.show] : [])).filter((x) => !(x in catalog))).toEqual([]);
  });
  it('keeps the placeholders and plural forms of the English', () => {
    expect(badMessages(nl)).toEqual([]);
  });
  it('has no message the editor no longer says', () => {
    const source = sourceText(['packages/web/src'], (f) => f.includes('/i18n/'));
    expect(unusedIds(nl, source, (id) => fromTable.has(id) || fieldName(id))).toEqual([]);
  });
  it('switches, and gives a new diagram lang: nl in Dutch', () => {
    setUiLang('nl');
    expect(t('Same as the browser')).toBe('Zoals de browser');
    expect(withUiLang('# x\ntype: systems\nnodes: {}\n')).toBe('# x\ntype: systems\nlang: nl\nnodes: {}\n');
    expect(withUiLang('type: systems\nlang: en\n')).toBe('type: systems\nlang: en\n');
    setUiLang('en');
    expect(t('Same as the browser')).toBe('Same as the browser');
    expect(withUiLang('type: systems\n')).toBe('type: systems\n');
    setUiLang(undefined);
  });
});

describe('the catalog parts', () => {
  it('give the same English the same Dutch', async () => {
    const parts = await Promise.all(['shell', 'app', 'dialogs', 'panels', 'show'].map((p) => import(`../src/i18n/nl-${p}.ts`).then((m) => Object.values(m)[0] as Record<string, string>)));
    const seen = new Map<string, string>();
    const differ: string[] = [];
    for (const part of parts) for (const [id, dutch] of Object.entries(part)) seen.has(id) && seen.get(id) !== dutch ? differ.push(`${id}: ${seen.get(id)} / ${dutch}`) : seen.set(id, dutch);
    expect(differ).toEqual([]);
  });
});

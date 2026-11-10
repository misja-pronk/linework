import { describe, expect, it } from 'vitest';
import { format, listWords, pickLang, readLang, translator } from '../src/index.ts';
import { badMessages, sourceText, unusedIds } from '../src/lint.ts';
import { term, terms } from '../src/drawing.ts';
import { nl as drawing } from '../src/drawing-nl.ts';

describe('messages', () => {
  it('fills placeholders and picks plurals', () => {
    expect(format('{count} element|{count} elements', 'en', { count: 1 })).toBe('1 element');
    expect(format('{count} element|{count} elementen', 'nl', { count: 3 })).toBe('3 elementen');
    expect(format('{count} element|{count} elementen', 'nl', { count: 0 })).toBe('0 elementen');
    expect(format('Hello {name}, {missing}', 'en', { name: 'Ada' })).toBe('Hello Ada, {missing}');
  });
  it('translates by English text, with a context after @', () => {
    const t = translator({ Save: 'Opslaan', 'Open@state': 'Geopend' });
    expect(t('nl', 'Save')).toBe('Opslaan');
    expect(t('en', 'Open@state')).toBe('Open');
    expect(t('nl', 'Open@state')).toBe('Geopend');
  });
  it('reads languages as people write them', () => {
    expect(readLang('nl-NL')).toBe('nl');
    expect(readLang('nl_BE.UTF-8')).toBe('nl');
    expect(readLang('Dutch')).toBe('nl');
    expect(readLang('en-GB')).toBe('en');
    expect(readLang('fr')).toBeUndefined();
    expect(pickLang(['fr-FR', 'nl'])).toBe('nl');
    expect(pickLang(['de'])).toBe('en');
    expect(listWords('nl', ['a', 'b', 'c'])).toBe('a, b en c');
  });
  it('translates type words whole or part by part', () => {
    expect(term('nl', 'Users')).toBe('Gebruikers');
    expect(term('nl', 'Source · Database')).toBe('Bron · Database');
    expect(term('nl', 'Maturity: 1 Initial')).toBe('Volwassenheid: 1 Initieel');
    expect(term('nl', '[Software System]')).toBe('[Softwaresysteem]');
    expect(term('nl', '[Container: React]')).toBe('[Container: React]');
    expect(term('nl', 'App Service · .NET 9')).toBe('App Service · .NET 9');
    expect(term('en', 'Users')).toBe('Users');
  });
});

describe('the drawing catalog', () => {
  it('has the placeholders and plural forms of its English', () => {
    expect(badMessages(drawing)).toEqual([]);
    expect(badMessages(terms)).toEqual([]);
  });
  it('has no ids no code uses', () => {
    const src = sourceText(['packages', 'types'], (f) => /packages\/i18n\/|\/test\/|\/e2e\/|packages\/web\/src\/i18n\//.test(f));
    expect(unusedIds(drawing, src)).toEqual([]);
  });
  it('has terms that some type or example still writes', () => {
    const src = sourceText(['types', 'packages/core/src', 'packages/render/src', 'packages/engine/src', 'packages/review/src']);
    const unused = Object.keys(terms).filter((k) => !src.includes(`'${k}'`) && !src.includes(`"${k}"`) && !src.includes(`${k}`));
    expect(unused).toEqual([]);
  });
});

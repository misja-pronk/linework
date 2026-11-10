// The CLI in Dutch: every message has its Dutch, the help is laid out as the English, and the
// language comes from --lang, CARTO_LANG or the locale; only the first two reach the drawing.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { badMessages, sourceText, unusedIds } from '@cartography/i18n/lint';
import { nl, nlHelp } from '../src/nl.ts';
import { helpChunks } from '../src/i18n.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carto-i18n-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** carto with exactly these language variables (the rest of the environment as it is). */
function carto(env: Record<string, string>, ...args: string[]) {
  const base = { ...process.env };
  for (const k of ['CARTO_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) delete base[k];
  const r = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'packages/cli/src/main.ts'), ...args], { cwd: tmp, encoding: 'utf8', env: { ...base, CARTO_CONFIG_DIR: '/cfg', ...env } });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('the CLI catalog', () => {
  it('keeps placeholders and plurals, and every id is still used', () => {
    expect(badMessages(nl)).toEqual([]);
    const source = sourceText([path.join(root, 'packages/cli/src')], (f) => f.endsWith('nl.ts'));
    expect(unusedIds(nl, source)).toEqual([]);
  });

  it('has the Dutch of every part of the help, and nothing for help that is gone', () => {
    const all = carto({ CARTO_LANG: 'en' }, 'help', 'all').out.replace(/\n$/, '').split('/cfg').join('{configDir}');
    const usage = carto({ CARTO_LANG: 'en' }, '--help').out.split('\n').find((l) => l.startsWith('Usage: '))!;
    const chunks = [...helpChunks(all), usage];
    // A line of only a command and its options has nothing to translate.
    const syntax = (c: string) => /^ {2}carto /.test(c) && !c.includes('\n') && !/\S {2,}\S/.test(c.trim());
    expect(chunks.filter((c) => c && !syntax(c) && !(c in nlHelp))).toEqual([]);
    expect(Object.keys(nlHelp).filter((k) => !chunks.includes(k))).toEqual([]);
    for (const [k, v] of Object.entries(nlHelp)) {
      // The per-command help is cut from these lines: the same commands, each line indented as before.
      const starts = (s: string) => s.split('\n').map((l) => /^ {2}carto ([\w-]+)/.exec(l)?.[1] ?? (l.startsWith('   ') ? '' : '-'));
      expect(starts(v).filter((x) => x !== ''), k).toEqual(starts(k).filter((x) => x !== ''));
      expect(v.includes('{configDir}'), k).toBe(k.includes('{configDir}'));
    }
  }, 120_000);
});

describe('carto --lang', () => {
  it('speaks Dutch with --lang nl, CARTO_LANG=nl or a Dutch locale, English otherwise', () => {
    const dutch = /^Tekenen:\n {2}render/m;
    const english = /^Draw:\n {2}render/m;
    expect(carto({}, '--lang', 'nl', '--help').out).toMatch(dutch);
    expect(carto({}, '--lang=nl', '--help').out).toMatch(dutch);
    expect(carto({ CARTO_LANG: 'nl' }, '--help').out).toMatch(dutch);
    expect(carto({ LANG: 'nl_NL.UTF-8' }, '--help').out).toMatch(dutch);
    expect(carto({ LC_ALL: 'C', LANG: 'nl_NL.UTF-8' }, '--help').out).toMatch(english);
    expect(carto({}, '--help').out).toMatch(english);
    expect(carto({ CARTO_LANG: 'nl' }, '--lang', 'en', '--help').out).toMatch(english);
    expect(carto({ LANG: 'nl_NL.UTF-8' }, '--lang', 'en', '--help').out).toMatch(english);
  }, 120_000);

  it('gives English help byte for byte as before when the language is English', () => {
    const top = carto({ CARTO_LANG: 'en' }, '--help').out;
    expect(top).toContain('Usage: carto <command> [files…] [options] [--lang en|nl]\n');
    expect(top).toContain('carto <command> --help   the options of one command\n');
    const render = carto({}, '--lang', 'en', 'render', '--help').out;
    expect(render).toContain('               [--view name | --all-views]      one of the diagram\'s views, or each to <file>-<view>.svg\n');
    expect(render.endsWith('\n\nAll commands: carto --help\n')).toBe(true);
  }, 120_000);

  it('translates a command\'s help and the CLI\'s own errors', () => {
    const render = carto({}, '--lang', 'nl', 'render', '--help');
    expect(render.code).toBe(0);
    expect(render.out).toContain('carto render <file.yaml…>');
    expect(render.out).toContain('               [--view name | --all-views]      één weergave van het diagram');
    expect(render.out).not.toMatch(/^ {2}carto import/m);
    expect(render.out).toMatch(/Alle commando's: carto --help\n$/);
    expect(carto({}, '--lang', 'nl', 'render', 'missing.yaml').err).toBe('carto: missing.yaml: bestand of map bestaat niet\n');
    expect(carto({}, '--lang', 'nl', 'render', 'x.yaml', '--bogus').err).toBe("carto: Onbekende optie '--bogus'\nOpties: carto render --help\n");
    expect(carto({}, '--lang', 'nl', 'rendr').err).toContain('Bedoel je "carto render"?');
    const fr = carto({}, '--lang', 'fr', '--help');
    expect(fr.code).toBe(1);
    expect(fr.err).toBe('carto: --lang is en or nl, not "fr"\n');
  }, 120_000);

  it('passes the language asked for into the drawing, but not the locale', () => {
    fs.writeFileSync(path.join(tmp, 'people.yaml'), 'type: systems\nnodes:\n  shoppers: { kind: users }\n  shop: service\nedges:\n  - shoppers -> shop\n');
    const svg = (env: Record<string, string>, ...args: string[]) => carto(env, 'render', 'people.yaml', '-o', '-', '--no-fonts', ...args).out;
    expect(svg({}, '--lang', 'nl')).toContain('Gebruikers');
    expect(svg({ CARTO_LANG: 'nl' })).toContain('Gebruikers');
    // The same files give the same picture on every machine, whatever its locale.
    const local = svg({ LANG: 'nl_NL.UTF-8' });
    expect(local).toContain('Users');
    expect(local).not.toContain('Gebruikers');
    // The diagram's own lang: wins.
    fs.writeFileSync(path.join(tmp, 'english.yaml'), 'type: systems\nlang: en\nnodes:\n  shoppers: { kind: users }\n');
    expect(carto({}, '--lang', 'nl', 'render', 'english.yaml', '-o', '-', '--no-fonts').out).not.toContain('Gebruikers');
  }, 120_000);
});

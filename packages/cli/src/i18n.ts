// The CLI's language, settled once: --lang (any command) > CARTO_LANG > LC_ALL, LC_MESSAGES or LANG
// > English (docs/nederlands.md). t('Unknown theme "{name}"', …) gives a message in it, the Dutch is
// in ./nl.ts. The help is translated chunk by chunk (helpText), so its English stays one readable
// block in main.ts. Diagnostics about a diagram's content come from the engine and stay English.
import { readLang, translator, type Lang, type Params } from '@cartography/i18n';
import { nl, nlHelp } from './nl.ts';

export type { Lang } from '@cartography/i18n';
export type Message = keyof typeof nl;

/** What --lang says, read from the arguments before parseArgs (it decides how parse errors read). */
function langArg(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') break;
    if (a === '--lang') return argv[i + 1] ?? '';
    if (a.startsWith('--lang=')) return a.slice(7);
  }
  return undefined;
}

const argv = process.argv.slice(2);
/** --lang as written, when it is not a language we speak (said by main as a usage error). */
export const badLang = ((v) => (v !== undefined && !readLang(v) ? v : undefined))(langArg(argv));

/**
 * The language asked for on purpose (--lang or CARTO_LANG). Only this one goes into the drawing,
 * for a diagram without its own lang:; the locale of the machine does not, so the same files give the
 * same pictures everywhere.
 */
export const explicitLang: Lang | undefined = readLang(langArg(argv)) ?? readLang(process.env.CARTO_LANG);

/** The language of the CLI's own words: the one asked for, else the first locale variable that is set. */
export const cliLang: Lang = explicitLang ?? readLang([process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG].find((v) => v?.trim())) ?? 'en';

const tr = translator(nl);
/** A CLI message in its language. */
export const t = (id: Message, params?: Params) => tr(cliLang, id, params);

/**
 * The parts help is translated by: a line "  carto <command>…" with the lines indented under it,
 * or a paragraph of other lines. Blank lines are parts of their own.
 */
export function helpChunks(text: string): string[] {
  const out: string[] = [];
  let prev: string | undefined;
  for (const line of text.split('\n')) {
    if (prev === undefined || line === '' || prev === '' || /^ {2}carto /.test(line) || (!line.startsWith('   ') && /^ {2}carto /.test(out.at(-1)!))) out.push(line);
    else out[out.length - 1] += '\n' + line;
    prev = line;
  }
  return out;
}

/**
 * Help text in the CLI's language, part by part; a part without Dutch stays English. `vars` are
 * what differs per machine (a folder): looked up as {name}, filled in after.
 */
export function helpText(text: string, vars: Record<string, string> = {}, lang: Lang = cliLang): string {
  if (lang !== 'nl') return text;
  const key = (s: string) => Object.entries(vars).reduce((x, [k, v]) => x.split(v).join(`{${k}}`), s);
  const fill = (s: string) => Object.entries(vars).reduce((x, [k, v]) => x.split(`{${k}}`).join(v), s);
  return helpChunks(text)
    .map((c) => fill((nlHelp as Record<string, string>)[key(c)] ?? c))
    .join('\n');
}

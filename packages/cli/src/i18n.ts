// The CLI's language, settled once: --lang (any command) > LINEWORK_LANG > LC_ALL, LC_MESSAGES or LANG
// > English (docs/nederlands.md). t('Unknown theme "{name}"', …) gives a message in it, the Dutch is
// in ./nl.ts. The help is translated chunk by chunk (helpText), so its English stays one readable
// block in main.ts. Diagnostics about a diagram's content come from the engine and stay English.
import { readLang, translator, type Lang, type Params } from '@linework/i18n';
import { nl, nlHelp } from './nl.ts';

export type { Lang } from '@linework/i18n';
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

/** The CLI's language for one run, settled from its arguments and environment by setLang. */
export interface Langs {
  /** --lang as written, when it is not a language we speak (said by main as a usage error). */
  bad: string | undefined;
  /**
   * The language asked for on purpose (--lang or LINEWORK_LANG). Only this one goes into the drawing,
   * for a diagram without its own lang:; the locale of the machine does not, so the same files give the
   * same pictures everywhere.
   */
  explicit: Lang | undefined;
  /** The language of the CLI's own words: the one asked for, else the first locale variable that is set. */
  cli: Lang;
}

function settle(argv: readonly string[], env: NodeJS.ProcessEnv): Langs {
  const asked = langArg(argv);
  const explicit = readLang(asked) ?? readLang(env.LINEWORK_LANG);
  return {
    bad: asked !== undefined && !readLang(asked) ? asked : undefined,
    explicit,
    cli: explicit ?? readLang([env.LC_ALL, env.LC_MESSAGES, env.LANG].find((v) => v?.trim())) ?? 'en',
  };
}

// Until a run settles it, the process's own arguments (modules that print outside run).
let langs = settle(process.argv.slice(2), process.env);

/** Settles the language of a run of the CLI: --lang in its arguments, else the environment. */
export function setLang(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Langs {
  return (langs = settle(argv, env));
}

const tr = translator(nl);
/** A CLI message in its language. */
export const t = (id: Message, params?: Params) => tr(langs.cli, id, params);

/**
 * The parts help is translated by: a line "  linework <command>…" with the lines indented under it,
 * or a paragraph of other lines. Blank lines are parts of their own.
 */
export function helpChunks(text: string): string[] {
  const out: string[] = [];
  let prev: string | undefined;
  for (const line of text.split('\n')) {
    if (prev === undefined || line === '' || prev === '' || /^ {2}linework /.test(line) || (!line.startsWith('   ') && /^ {2}linework /.test(out.at(-1)!))) out.push(line);
    else out[out.length - 1] += '\n' + line;
    prev = line;
  }
  return out;
}

/**
 * Help text in the CLI's language, part by part; a part without Dutch stays English. `vars` are
 * what differs per machine (a folder): looked up as {name}, filled in after.
 */
export function helpText(text: string, vars: Record<string, string> = {}, lang: Lang = langs.cli): string {
  if (lang !== 'nl') return text;
  const key = (s: string) => Object.entries(vars).reduce((x, [k, v]) => x.split(v).join(`{${k}}`), s);
  const fill = (s: string) => Object.entries(vars).reduce((x, [k, v]) => x.split(`{${k}}`).join(v), s);
  return helpChunks(text)
    .map((c) => fill((nlHelp as Record<string, string>)[key(c)] ?? c))
    .join('\n');
}

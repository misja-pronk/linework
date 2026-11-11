// The command line, read once: which command, its files, and its options as typed objects. Every
// command takes every option (as before); each command's own type names the ones it reads.
import { parseArgs } from 'node:util';
import { t } from './i18n.ts';

const options = {
  out: { type: 'string', short: 'o' },
  port: { type: 'string' },
  format: { type: 'string', short: 'f', default: 'svg' },
  theme: { type: 'string', short: 't' },
  pack: { type: 'string', multiple: true },
  icons: { type: 'string' },
  scale: { type: 'string', default: '2' },
  'no-fonts': { type: 'boolean' },
  'svg-safe': { type: 'boolean' },
  'outline-text': { type: 'boolean' },
  view: { type: 'string' },
  'all-views': { type: 'boolean' },
  layer: { type: 'string', multiple: true },
  'all-layers': { type: 'boolean' },
  dim: { type: 'boolean' },
  stable: { type: 'boolean' },
  drift: { type: 'boolean' },
  json: { type: 'boolean' },
  'side-by-side': { type: 'boolean' },
  fresh: { type: 'boolean' },
  'exit-code': { type: 'boolean' },
  fix: { type: 'boolean' },
  step: { type: 'string' },
  'all-steps': { type: 'boolean' },
  'no-steps': { type: 'boolean' },
  focus: { type: 'string', multiple: true },
  hops: { type: 'string' },
  upstream: { type: 'boolean' },
  downstream: { type: 'boolean' },
  title: { type: 'string' },
  subtitle: { type: 'string' },
  aspect: { type: 'string', default: '16:9' },
  template: { type: 'string' },
  layout: { type: 'string' },
  'keep-look': { type: 'boolean' },
  'keep-slides': { type: 'boolean' },
  font: { type: 'string' },
  page: { type: 'string', default: 'fit' },
  git: { type: 'string' },
  since: { type: 'string' },
  snapshot: { type: 'string' },
  base: { type: 'string' },
  to: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  lang: { type: 'string' },
} as const;

const read = (argv: string[]) => parseArgs({ args: argv, allowPositionals: true, options });

/** Every option, as parseArgs gives them. */
export type Values = ReturnType<typeof read>['values'];

/** What draws a diagram: theme, packs and icons, the part of it (view, step, focus, layers). */
export type DrawOptions = Pick<Values, 'theme' | 'pack' | 'icons' | 'view' | 'step' | 'focus' | 'hops' | 'upstream' | 'downstream' | 'layer' | 'dim'>;
/** What makes a deck or a PDF of drawings. */
export type DocumentOptions = Pick<Values, 'theme' | 'aspect' | 'font' | 'title' | 'subtitle' | 'all-steps' | 'no-steps' | 'template' | 'layout' | 'keep-look' | 'keep-slides' | 'page'>;
/** Where pictures go: -o and what it means for several. */
export type OutputOptions = Pick<Values, 'out' | 'all-views' | 'all-layers'>;

export type RenderOptions = DrawOptions & DocumentOptions & OutputOptions & Pick<Values, 'format' | 'scale' | 'no-fonts' | 'svg-safe' | 'outline-text' | 'stable'>;
export type DeckOptions = DrawOptions & DocumentOptions & Pick<Values, 'out'>;
export type ValidateOptions = Pick<Values, 'view' | 'drift' | 'fix' | 'pack'>;
export type DiffOptions = DrawOptions & Pick<Values, 'out' | 'format' | 'scale' | 'no-fonts' | 'json' | 'side-by-side' | 'fresh' | 'exit-code' | 'git' | 'since' | 'snapshot'>;
export type IconsOptions = Pick<Values, 'out' | 'pack'>;
export type ExportHtmlOptions = Pick<Values, 'out' | 'title' | 'all-steps' | 'theme' | 'pack' | 'icons'>;
export type DescribeOptions = DrawOptions & Pick<Values, 'out' | 'format' | 'all-views'>;
export type ShareOptions = Pick<Values, 'base'>;
export type ServeOptions = Pick<Values, 'port'>;

/** The command line as read: the command meant (`export --to html` is export-html), its files and options. */
export interface Args {
  /** The command as typed. */
  typed: string | undefined;
  /** The command meant. */
  command: string | undefined;
  files: string[];
  values: Values;
}

/** An option that cannot be read: the message as carto says it, and the command it was for. */
export interface ArgsError {
  error: string;
  command: string | undefined;
}

/** Node's word for a wrong option, in the CLI's language. */
function parseError(m: string): string {
  const unknown = /^Unknown option '(.+)'$/.exec(m);
  if (unknown) return t("Unknown option '{option}'", { option: unknown[1]! });
  const missing = /^Option '(.+)' argument missing$/.exec(m);
  if (missing) return t("Option '{option}' argument missing", { option: missing[1]! });
  return m;
}

/** `carto export --to html` is the export command of that name. */
export const exportTo = ['html'];

export function parse(argv: string[]): Args | ArgsError {
  let parsed: ReturnType<typeof read>;
  try {
    parsed = read(argv);
  } catch (e) {
    // The command it was for, so the message can say where its options are.
    const at = argv[0] === '--lang' ? 2 : argv[0]?.startsWith('--lang=') ? 1 : 0;
    const command = argv[at] && !argv[at].startsWith('-') ? argv[at] : undefined;
    return { error: parseError((e as Error).message.split('\n')[0]!.replace(/\. To specify a positional.*$/, '')), command };
  }
  const { positionals, values } = parsed;
  const [typed, ...files] = positionals;
  const command = typed === 'export' && values.to && exportTo.includes(values.to) ? `export-${values.to}` : typed;
  return { typed, command, files, values };
}

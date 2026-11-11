#!/usr/bin/env node
// carto render | deck | watch | validate | diff | new | export | share | icons | themes | types | describe | serve
// The command line read once (args.ts), then the command it names (commands/), with its options and
// the terminal (io.ts) passed in. run() is the whole CLI, so tests call it in-process.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportTo, parse, type Args } from './args.ts';
import { help, unknownCommand, type Help } from './help.ts';
import { setLang, t } from './i18n.ts';
import { Ctx, friendly, processIo, UsageError, type Io } from './io.ts';
import { deckCommand } from './commands/deck.ts';
import { describeCommand } from './commands/describe.ts';
import { diffCommand } from './commands/diff.ts';
import { exportHtmlCommand } from './commands/export-html.ts';
import { iconsCommand } from './commands/icons.ts';
import { newCommand } from './commands/new.ts';
import { renderCommand } from './commands/render.ts';
import { serveCommand } from './commands/serve.ts';
import { shareCommand } from './commands/share.ts';
import { themesCommand, typesCommand } from './commands/types.ts';
import { validateCommand } from './commands/validate.ts';
import { watchCommand } from './commands/watch.ts';

export type { Io } from './io.ts';

/** carto with these arguments (without node and the script): the exit code. Writes only through `io`. */
export async function run(argv: string[], io: Io = processIo): Promise<number> {
  const langs = setLang(argv, io.env);
  const ctx = new Ctx(io, langs.explicit);
  const h = help();
  const args = parse(argv);
  if ('error' in args) {
    // An unknown or malformed option: one line and how to see the right ones.
    ctx.error(`carto: ${args.error}\n${args.command && h.has(args.command) ? t('Options: carto {command} --help', { command: args.command }) : t('Commands: carto --help')}`);
    return 1;
  }
  const { to } = args.values;
  if (args.typed === 'export' && to && !exportTo.includes(to)) {
    const picture = ['svg', 'png', 'pptx', 'pdf'].includes(to) ? ` (a picture or deck: carto render <file> -o out.${to})` : '';
    ctx.error(`carto: --to ${to} is not an export; use one of: ${exportTo.join(', ')}${picture}`);
    return 1;
  }
  try {
    return await dispatch(ctx, args, h, langs.bad);
  } catch (e) {
    ctx.error(`carto: ${friendly(e)}`);
    // The stack only when asked for: CARTO_DEBUG=1.
    if (io.env.CARTO_DEBUG && !(e instanceof UsageError)) ctx.error((e as Error).stack);
    return 1;
  }
}

async function dispatch(ctx: Ctx, { command, files, values }: Args, h: Help, badLang: string | undefined): Promise<number> {
  const unknown = (cmd: string) => (ctx.error(unknownCommand(cmd, h)), 1);
  if (badLang !== undefined) throw new UsageError(t('--lang is en or nl, not "{value}"', { value: badLang }));
  if (command === 'help') {
    const [what] = files;
    if (what === 'all') ctx.log(h.all);
    else if (what && !h.has(what)) return unknown(what);
    else ctx.log(h.for(what));
    return 0;
  }
  if (values.help || !command) {
    if (command && !h.has(command)) return unknown(command);
    ctx.log(h.for(command));
    return command || values.help ? 0 : 1;
  }
  /** The command's help on standard error, exit 1: what it says when called wrong. */
  const usage = () => (ctx.error(h.for(command)), 1);
  switch (command) {
    case 'types':
      return typesCommand(ctx, files);
    case 'themes':
      return themesCommand(ctx);
    case 'icons':
      return iconsCommand(ctx, files, values, usage);
    case 'new':
      return newCommand(ctx, files);
    case 'export-html':
      return exportHtmlCommand(ctx, files, values, usage);
    case 'describe':
      return describeCommand(ctx, files, values, usage);
    case 'share':
      return shareCommand(ctx, files, values, usage);
    case 'validate':
      return validateCommand(ctx, files, values);
    case 'diff':
      return diffCommand(ctx, files, values);
    case 'render':
      return renderCommand(ctx, files, values, usage);
    case 'export':
      // Without --to html: which exports there are.
      return usage();
    case 'deck':
      return deckCommand(ctx, files, values, usage);
    case 'serve':
      return serveCommand(ctx, files, values, usage);
    case 'watch':
      return watchCommand(ctx, files, values);
    default:
      return unknown(command);
  }
}

// Run as a program (node carto.mjs, tsx main.ts, a bin link): the process's own arguments and terminal.
const entry = process.argv[1] && fs.existsSync(process.argv[1]) ? fs.realpathSync(process.argv[1]) : undefined;
if (entry && entry === fs.realpathSync(fileURLToPath(import.meta.url))) process.exitCode = await run(process.argv.slice(2));

// carto's help: the whole manual (carto help all), each command's part of it, the short list of
// commands (carto --help), and what to say for a command that is not one. Built per run, in its language.
import { configDir } from './packs.ts';
import { helpText, t } from './i18n.ts';

/** The commands, grouped, one line each: what `carto --help` shows. */
const groups = (): [string, [string, string][]][] => [
  [t('Create'), [
    ['new', t('start from a template')],
    ['types', t('which diagram type to pick')],
  ]],
  [t('Draw'), [
    ['render', t('a diagram to SVG, PNG, PowerPoint or PDF')],
    ['deck', t('several diagrams in one deck')],
    ['watch', t('render again on every save')],
    ['serve', t('the web editor for a folder, and an MCP endpoint for your AI')],
  ]],
  [t('Export'), [
    ['export', '--to html'],
    ['describe', t('the diagram in plain words')],
    ['share', t('a link that opens it in the web app')],
  ]],
  [t('Check'), [
    ['validate', t('check files and their views')],
    ['diff', t('what changed between two versions')],
  ]],
  [t('Look'), [
    ['themes', t('built-in themes')],
    ['icons', t('import and list vendor icon packs')],
  ]],
];
/** Older names, still taken: `carto export --to html` is the same as `carto export-html`. */
const aliases: [string, string][] = [
  ['export-html', 'export --to html'],
];

/**
 * How many entries of a command's help (a usage line, or an option line with what follows it) are
 * the ones most people need: the rest is under "More options". Commands not listed show all as common.
 */
const commonEntries: Record<string, number> = { render: 4, deck: 2, diff: 3, new: 1, icons: 3, 'export-html': 2, validate: 1 };

export interface Help {
  /** Everything: carto help all. */
  all: string;
  /** Whether there is help for the command, i.e. it is one. */
  has(cmd: string): boolean;
  /** Help for one command, or the short help. */
  for(cmd?: string): string;
  /** Every command name, aliases too. */
  commands: string[];
}

/** The help, in the language of the run. */
export function help(): Help {
  const all = helpText(`carto — architecture diagrams that look good

  carto render <file.yaml…> [-o out] [--format svg|png|pptx|pdf] [--theme name|file.theme.yaml]
               [--pack azure] [--scale 2]           --theme wins over the diagram's theme:; -o x.pptx or x.pdf picks the format too
               [--view name | --all-views]      one of the diagram's views, or each to <file>-<view>.svg
               [--step 3 | --all-steps]         the drawing at one of its steps:, or each to <file>-step-01.svg;
                                                pptx and pdf get a slide (page) per step by themselves
               [--icons official|lucide]        the vendor's official icons (carto icons import) or our line icons,
                                                whatever the diagram's icons: says
               [--layer security | --all-layers] through one (or several) of its layers:, or each to <file>-<layer>.svg;
               [--dim]                          pptx and pdf: a slide (page) per layer. --dim fades the rest in place
               [--stable]                       note where things were drawn in <file>.layout.json, so the
                                                next render after an edit keeps them there
               [--svg-safe]                     an SVG that PowerPoint, Word and Keynote take whole: no CSS, no
                                                filters or markers, system fonts, one group per node and line
               [--outline-text]                 with --svg-safe: text as outlines in the theme's own font
               [--focus orders] [--hops 2]      only that element (an id, a group, tag:x, kind:x) and what is within
               [--upstream | --downstream]      so many lines of it (default 1, or all); what feeds it, or what it feeds
               [--template customer.potx]       pptx: made in that PowerPoint template, its layouts, master, fonts
               [--layout "Title Only"]          and colours (a brand theme's pptx: names one too); --layout picks the
               [--keep-look] [--keep-slides]    layout, --keep-look keeps the diagram's own theme, --keep-slides the
                                                template's own slides in front
  carto deck <file.yaml…> -o deck.pptx|deck.pdf  all diagrams in one deck, a slide (page) each, one per step where a diagram has steps:
               [--all-steps | --no-steps]           also step through sequence messages and dynamic views; or never
               [--title "Deck title"] [--subtitle …] title slide in front (pptx)
               [--aspect 16:9|4:3] [--font Inter]   slide shape and typeface (pptx)
               [--template x.potx] [--layout name]  in a PowerPoint template, as carto render (pptx)
               [--keep-look] [--keep-slides]
               [--page fit|a4|a3]                   page size (pdf, default fit)
  carto watch  <file.yaml…> [same options]      re-render on every save (and when included files change)
  carto serve  [folder] [--port 4317]           the web editor for a folder, with an MCP endpoint for your own AI
  carto export-html <file.yaml|folder> [-o out.html]  one HTML file to send: every view and step drawn (light and
               [--title "…"] [--all-steps]      dark), pan and zoom, presenter, drill-down, search, element
                                                details, print; works offline from disk. A file brings the
                                                diagrams it drills into; a folder gets a contents page.
                                                More: docs/html-export.md
  carto describe <file.yaml> [-o out.md|.txt|.html]  the diagram in plain words: what it shows, its groups and
               [--view name | --all-views]      elements, connections in reading order, steps, layers, trust boundaries
               [--format text|md|html]          and key (sequence: the messages; ERD: tables and relations).
                                                The same words are in every SVG, PNG, PDF and slide. docs/describe.md
  carto share <file.yaml> [--base URL]          a link that opens the diagram read-only in the web app; the diagram
                                                travels in the link's #fragment, never to a server (default base
                                                http://localhost:5178/)
  carto validate <file.yaml…|folder>            check files (each diagram of a folder) and each of their views,
                                                print problems; warns when the smallest text on its PowerPoint
                                                slide (as carto render --format pptx makes it) is under 6 pt
               [--template x.potx] [--layout name]  measure that on a slide of a PowerPoint template
               [--drift]                        also fail when <file>.layout.json pins, bends or locks things
                                                (or views) that are no longer in the diagram
               [--drift --fix]                  drop those entries from <file>.layout.json
  carto diff <before.yaml> <after.yaml>         what changed between two versions, by id: added, removed and
                                                changed nodes, groups and lines
  carto diff --git <ref> <file.yaml…>           the same against the file at a branch, tag or commit (includes too);
                                                --since <ref> says the same
  carto diff --snapshot <label> <file.yaml…>    against a snapshot the editor wrote next to it (<name>.snapshots/<label>.yaml)
               [-o diff.svg|diff.png|diff.md|folder]  also the picture (or, .md, the changes in plain sentences): the newer drawing with what was added and
                                                changed marked, what was removed as ghosts where it was, and a key
               [--side-by-side]                 the picture as before and after, each with its own marks
               [--json] [--view name] [--fresh] [--exit-code]
                                                --fresh lays the newer drawing out from scratch instead of keeping
                                                what was there in place; --exit-code exits 1 when something changed
  carto new <type> [file.yaml]                  start from a template; no type: which to pick
  carto export <file.yaml…|folder> --to html [-o out]
                                                the same as carto export-html (its options apply)
  carto icons [azure|aws|gcp|kubernetes]        where to download each official icon set, and what is imported
  carto icons import <folder|file.zip> [--pack azure]
                                                index an official icon download (Azure, AWS, Google Cloud,
                                                Kubernetes) into a pack in ${configDir()};
                                                the vendor is told from the files when --pack is left out
  carto icons list                              packs, when imported, and how many kinds each covers
  carto icons show <pack> [-o sheet.png|.svg]   which kind got which icon, and which have none
  carto icons find <pack> <words…>              icons of the pack by name, to map one by hand
  carto icons map <pack> <kind> <words…|file>   give a kind an icon by hand (kept when a newer set is imported)
  carto icons unmap <pack> <kind>               the kind draws its line icon again
               then: icons: official in a diagram, or --icons official|lucide on render, deck or watch
  carto themes                                  built-in themes
  carto types [words…]                          which type to pick, best match first

Manual positions are read from <file>.layout.json next to the diagram (per view under "views").
The same file can hold a layout note ("layout") per view: render reads it and only --stable writes it,
so the same YAML and layout file always give the same picture. More: docs/ci.md`, { configDir: configDir() });

  /** Each command's part of the full help, from the lines that start with "carto <command>". */
  const usage = new Map<string, string>();
  {
    let current = '';
    for (const line of all.split('\n').slice(2)) {
      const m = /^  carto ([\w-]+)/.exec(line);
      if (m) current = m[1]!;
      else if (!line.startsWith('   ')) current = '';
      if (current) usage.set(current, (usage.has(current) ? usage.get(current) + '\n' : '') + line);
    }
  }

  const grouped = groups();
  const commands = [...grouped.flatMap(([, list]) => list.map(([c]) => c)), ...aliases.map(([c]) => c)];
  // The group names' column: as wide as the longest (Controleren) and a space.
  const groupWidth = Math.max(8, ...grouped.map(([title]) => title.length + 1));

  const short = `${helpText('carto — architecture diagrams that look good')}
${helpText('Usage: carto <command> [files…] [options] [--lang en|nl]')}

${grouped.map(([title, list]) => list.map(([c, what], i) => `${(i ? '' : title).padEnd(groupWidth)}${c.padEnd(11)}${what}`).join('\n')).join('\n')}

${t('carto <command> --help: its options · carto help all: everything · - is stdin or stdout')}
${t('Example: carto render shop.yaml -o shop.png')}`;

  /** One command's help: what it does, its common options, then the rest. */
  function commandHelp(cmd: string): string {
    const lines = usage.get(cmd)!.split('\n');
    // An entry starts at a usage line or an option line; lines indented further belong to the one above.
    const entries: string[][] = [];
    for (const line of lines) (/^ {2}carto |^ {15}\S/.test(line) || !entries.length ? entries.push([line]) : entries.at(-1)!.push(line));
    const what = cmd === 'export' ? 'the interactive HTML file' : grouped.flatMap(([, l]) => l).find(([c]) => c === cmd)?.[1];
    const alias = aliases.find(([c]) => c === cmd)?.[1];
    const head = `carto ${cmd}${what ? ` — ${what}` : alias ? ` (also: carto ${alias})` : ''}`;
    const n = commonEntries[cmd] ?? entries.length;
    const common = entries.slice(0, n).flat().join('\n');
    const more = entries.slice(n).flat().join('\n');
    return `${head}\n\nCommon options:\n${common}${more ? `\n\nMore options:\n${more}` : ''}`;
  }

  return {
    all,
    has: (cmd) => usage.has(cmd),
    for: (cmd) => (cmd && usage.has(cmd) ? `${commandHelp(cmd)}\n\n${t('All commands: carto --help')}` : short),
    commands,
  };
}

/** The command meant by a typo: the nearest by edit distance, when it is close. */
export function nearest(word: string, commands: string[]): string | undefined {
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length]![b.length]!;
  };
  const best = commands.map((c) => [c, c.startsWith(word) && word.length >= 2 ? 0 : dist(word, c)] as const).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= Math.max(1, Math.floor(word.length / 3)) ? best[0] : undefined;
}

/** What carto says for a command it does not have: the one meant, when it is close. */
export function unknownCommand(cmd: string, h: Help): string {
  const guess = nearest(cmd, h.commands);
  return `carto: ${guess ? t('unknown command "{name}". Did you mean "carto {guess}"?', { name: cmd, guess }) : t('unknown command "{name}"', { name: cmd })}\n${t('Commands: {list}', { list: h.commands.join(', ') })}\n${t('More: carto --help')}`;
}

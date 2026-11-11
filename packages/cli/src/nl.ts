// The CLI's Dutch, by English text (see ./i18n.ts). Short and plain, as a Dutch architect writes it:
// "je", no anglicisms where a common Dutch word exists, IT terms (API, deployment, subnet, YAML) as
// they are; option, command and file names stay English. Terms: docs/nederlands.md.
export const nl = {
  // carto --help
  Draw: 'Tekenen',
  Check: 'Controleren',
  Look: 'Uiterlijk',
  'a diagram to SVG, PNG, PowerPoint or PDF': 'een diagram naar SVG, PNG, PowerPoint of PDF',
  'several diagrams in one deck': 'meer diagrammen in één deck',
  'render again on every save': 'opnieuw renderen bij elke keer opslaan',
  'the web editor for a folder, and an MCP endpoint for your AI': 'de webeditor voor een map, en een MCP-endpoint voor je AI',
  '{file}: not a folder': '{file}: geen map',
  '--port takes a number, e.g. --port 4317': '--port neemt een getal, bijvoorbeeld --port 4317',
  'The web app is not built yet: run pnpm web:build first': 'De webapp is nog niet gebouwd: voer eerst pnpm web:build uit',
  'Port {port} is in use: pick another with --port': 'Poort {port} is in gebruik: kies een andere met --port',
  'Cartography for {folder}': 'Cartography voor {folder}',
  'Editor': 'Editor',
  'Connect your AI (once; the token stays the same):': 'Verbind je AI (eenmalig; het token blijft hetzelfde):',
  'Ctrl+C to stop': 'Ctrl+C om te stoppen',
  'check files and their views': 'bestanden en hun weergaven controleren',
  'what changed between two versions': 'wat er veranderde tussen twee versies',
  'the diagram in plain words': 'het diagram in gewone woorden',
  'which diagram type to pick': 'welk diagramtype je kiest',
  'built-in themes': "ingebouwde thema's",
  'import and list vendor icon packs': 'iconenpakketten van leveranciers importeren en tonen',
  'Example: carto render shop.yaml -o shop.png': 'Voorbeeld: carto render shop.yaml -o shop.png',
  'All commands: carto --help': "Alle commando's: carto --help",

  // How carto was called
  "Unknown option '{option}'": "Onbekende optie '{option}'",
  "Option '{option}' argument missing": "Optie '{option}' heeft een waarde nodig",
  'Options: carto {command} --help': 'Opties: carto {command} --help',
  'Commands: carto --help': "Commando's: carto --help",
  'Commands: {list}': "Commando's: {list}",
  'More: carto --help': 'Meer: carto --help',
  'unknown command "{name}"': 'onbekend commando "{name}"',
  'unknown command "{name}". Did you mean "carto {guess}"?': 'onbekend commando "{name}". Bedoel je "carto {guess}"?',
  '--lang is en or nl, not "{value}"': '--lang is en of nl, niet "{value}"',
  '--icons is official or lucide, not "{value}"': '--icons is official of lucide, niet "{value}"',
  '--template is a PowerPoint template, .potx or .pptx: {file}': '--template is een PowerPoint-sjabloon, .potx of .pptx: {file}',
  '-o {out} names one file, but {why}: give a folder, e.g. -o {folder}/': '-o {out} noemt één bestand, maar {why}: geef een map, bijvoorbeeld -o {folder}/',
  '--all-views writes one per view': '--all-views schrijft er een per weergave',
  '--all-layers writes one per layer': '--all-layers schrijft er een per laag',
  'several diagrams make several files': 'meer diagrammen geven meer bestanden',
  '-o - writes one picture to standard output: give a folder for --all-views or --all-steps': '-o - schrijft één plaatje naar standaarduitvoer: geef een map voor --all-views of --all-steps',
  'Unknown theme "{name}", use one of: {themes}, or a .theme.yaml file': 'Onbekend thema "{name}", kies uit: {themes}, of een .theme.yaml-bestand',
  'Unknown type "{name}". Types: {types}': 'Onbekend type "{name}". Typen: {types}',
  'carto deck needs -o <file>.pptx or -o <file>.pdf': 'carto deck heeft -o <file>.pptx of -o <file>.pdf nodig',
  'Name the diagrams: carto diff --git <ref> <file.yaml…>': 'Noem de diagrammen: carto diff --git <ref> <file.yaml…>',
  'Name the diagrams: carto diff --snapshot <label> <file.yaml…>': 'Noem de diagrammen: carto diff --snapshot <label> <file.yaml…>',
  'Two files: carto diff <before.yaml> <after.yaml>, carto diff --git <ref> <file.yaml…> or carto diff --snapshot <label> <file.yaml…>': 'Twee bestanden: carto diff <before.yaml> <after.yaml>, carto diff --git <ref> <file.yaml…> of carto diff --snapshot <label> <file.yaml…>',

  // Files
  error: 'fout',
  warning: 'waarschuwing',
  file: 'bestand',
  that: 'dat',
  '{file}: no such file or folder': '{file}: bestand of map bestaat niet',
  '{file}: no such file': '{file}: bestand bestaat niet',
  '{file} is a folder; give a file': '{file} is een map; geef een bestand',
  '{file}: a file is in the way where a folder is needed': '{file}: er staat een bestand waar een map nodig is',
  '{file}: not allowed to read or write it': '{file}: geen toestemming om te lezen of te schrijven',
  '{file} already exists': '{file} bestaat al',
  'Created {file}': '{file} gemaakt',
  'not found': 'niet gevonden',
  'not found, here or in {ref}': 'niet gevonden, hier of in {ref}',
  'not valid JSON: {message}': 'geen geldige JSON: {message}',
  'standard output': 'standaarduitvoer',
  ok: 'ok',
  'nothing written': 'niets geschreven',
  '{file}: nothing to draw': '{file}: niets te tekenen',

  // Drawing
  '--svg-safe is for SVG: ignored for {format}': '--svg-safe is voor SVG: genegeerd voor {format}',
  '--outline-text goes with --svg-safe: ignored': '--outline-text hoort bij --svg-safe: genegeerd',
  '--layout, --keep-look and --keep-slides go with --template: ignored': '--layout, --keep-look en --keep-slides horen bij --template: genegeerd',
  'empty: nothing to draw, not written': 'leeg: niets te tekenen, niet geschreven',
  '--all-layers: this diagram has no layers: (see docs/layers.md)': '--all-layers: dit diagram heeft geen layers: (zie docs/layers.md)',
  'nothing on this layer, not written': 'niets op deze laag, niet geschreven',
  '{all} drawings: the whole and {count} layer|{all} drawings: the whole and {count} layers': '{all} tekeningen: het geheel en {count} laag|{all} tekeningen: het geheel en {count} lagen',
  'no steps here: drawn as a whole': 'hier zijn geen stappen: als geheel getekend',
  'step {n}': 'stap {n}',
  'layout noted': 'layout onthouden',
  '{count} diagram|{count} diagrams': '{count} diagram|{count} diagrammen',
  '{count} drawing|{count} drawings': '{count} tekening|{count} tekeningen',
  '{count} element|{count} elements': '{count} element|{count} elementen',
  '{count} step|{count} steps': '{count} stap|{count} stappen',
  '{count} page|{count} pages': "{count} pagina|{count} pagina's",
  '{count} slide|{count} slides': "{count} dia|{count} dia's",
  'watching… Ctrl+C to stop': 'kijkt mee… Ctrl+C om te stoppen',

  // validate
  fixed: 'opgelost',
  stale: 'verouderd',
  '{count} stale entry; carto validate --drift --fix {file} drops it|{count} stale entries; carto validate --drift --fix {file} drops them': '{count} verouderde regel; carto validate --drift --fix {file} haalt hem weg|{count} verouderde regels; carto validate --drift --fix {file} haalt ze weg',
  '{count} stale entry dropped|{count} stale entries dropped': '{count} verouderde regel weggehaald|{count} verouderde regels weggehaald',
  '{count} stale entry dropped, nothing left: file removed|{count} stale entries dropped, nothing left: file removed': '{count} verouderde regel weggehaald, niets over: bestand verwijderd|{count} verouderde regels weggehaald, niets over: bestand verwijderd',
  'workspace ok: {count} diagram|workspace ok: {count} diagrams': 'map ok: {count} diagram|map ok: {count} diagrammen',

  // share
  '{file}: the link would be {size} kB, over the {limit} kB a link can safely carry. Share the file itself instead.': '{file}: de link zou {size} kB worden, meer dan de {limit} kB die een link veilig kan bevatten. Deel liever het bestand zelf.',

  // diff
  'against {what}': 'tegen {what}',
  '"{ref}" is not a commit, branch or tag here': '"{ref}" is hier geen commit, branch of tag',
  'carto diff --git needs a git repository': 'carto diff --git heeft een git-repository nodig',
  'no snapshot "{label}" ({path}); there are: {list}': 'geen snapshot "{label}" ({path}); er zijn: {list}',
  'no snapshot "{label}" ({path}); take one in the editor with ⇧⌘S': 'geen snapshot "{label}" ({path}); maak er een in de editor met ⇧⌘S',

  // types, themes, icons
  'Nothing matches "{query}"; architecture (systems) is the usual start.': 'Niets past bij "{query}"; architectuur (systems) is het gewone begin.',
  'not for:': 'niet voor:',
  'Start one: carto new <type> [file.yaml]. Guide: docs/types.md': 'Begin er een: carto new <type> [file.yaml]. Gids: docs/types.md',
  'other names for survey and survey-dark': 'andere namen voor survey en survey-dark',
  'Or a file: theme: ./client.theme.yaml (see docs/themes.md and docs/style.md)': 'Of een bestand: theme: ./client.theme.yaml (zie docs/themes.md en docs/style.md)',
  'No icon packs yet. Where to get them: carto icons': 'Nog geen iconenpakketten. Waar je ze haalt: carto icons',
  '{have} of {count} kinds': '{have} van {count} soorten',
  '{have} of {count} kinds have an icon': '{have} van {count} soorten hebben een icoon',
  '{count} by hand': '{count} met de hand',
  'by hand': 'met de hand',
  'imported {when} ← {source}': 'geïmporteerd {when} ← {source}',
  '{files} SVG files; {have} of {count} {pack} kinds have an icon': '{files} SVG-bestanden; {have} van {count} {pack}-soorten hebben een icoon',
  '({count} mapped by hand before, kept)': '({count} eerder met de hand gekoppeld, behouden)',
  'no icon yet: {kinds}': 'nog geen icoon: {kinds}',
  'give one by hand: carto icons map {pack} <kind> <words>; see all: carto icons show {pack} -o {pack}.png': 'geef er met de hand een: carto icons map {pack} <kind> <words>; alles zien: carto icons show {pack} -o {pack}.png',
  'use it: icons: official in the diagram, or carto render diagram.yaml --icons official': 'gebruiken: icons: official in het diagram, of carto render diagram.yaml --icons official',
  'Nothing in {pack} called "{words}"': 'Niets in {pack} met de naam "{words}"',
  '{kind} draws its line icon again': '{kind} tekent weer zijn lijnicoon',

  // carto new
  none: 'geen',
  Create: 'Maken',
  'start from a template': 'beginnen met een sjabloon',
  Export: 'Exporteren',
  'a link that opens it in the web app': 'een link die het opent in de webapp',
  'carto <command> --help: its options · carto help all: everything · - is stdin or stdout': 'carto <opdracht> --help: de opties · carto help all: alles · - is stdin of stdout',
  '{file}: a file is in the way where a folder is needed (-o names a folder when it has no extension)': '{file}: er staat een bestand waar een map nodig is (-o is een map als er geen extensie is)',
  'as-is, transition stages and to-be: each, compared, a roadmap': 'huidig, tussenstappen en gewenst: elk apart, vergeleken, als roadmap',
} as const satisfies Record<string, string>;

/** The help, part by part (see helpChunks): the English as main.ts writes it, the Dutch laid out the same way. */
export const nlHelp: Record<string, string> = {
  [`  carto stages <file.yaml> [-o folder] [-f png]  everything its stages: make: each stage, the migration overview,
               [--from as-is --to q2]           each transition (what is added, changed, removed, replaced),
               [--side-by-side]                 the as-is and to-be side by side, the roadmap (YAML and drawn)
                                                and the stages in words; --from/--to: that transition only.
                                                Decks: carto deck --stages.
                                                More: docs/transitions.md`]:
    `  carto stages <file.yaml> [-o folder] [-f png]  alles wat de stages: opleveren: elke stage, het migratieoverzicht,
               [--from as-is --to q2]           elke overgang (wat erbij komt, wijzigt, weggaat, vervangen wordt),
               [--side-by-side]                 huidig en gewenst naast elkaar, de roadmap (YAML en getekend)
                                                en de stages in woorden; --from/--to: alleen die overgang.
                                                Decks: carto deck --stages.
                                                Meer: docs/transitions.md`,
  [`  carto export <file.yaml…|folder> --to html [-o out]
                                                the same as carto export-html (its options apply)`]:
    `  carto export <file.yaml…|folder> --to html [-o out]
                                                hetzelfde als carto export-html (de opties daarvan gelden)`,
  'Usage: carto <command> [files…] [options] [--lang en|nl]': 'Gebruik: carto <command> [files…] [options] [--lang en|nl]',
  [`carto — architecture diagrams that look good`]:
    `carto — architectuurdiagrammen die er goed uitzien`,
  [`  carto render <file.yaml…> [-o out] [--format svg|png|pptx|pdf] [--theme name|file.theme.yaml]
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
               [--stage q2 | --stage overview]  one of its stages: (as-is to to-be; without it the to-be), or
                                                everything marked with the stage it comes and goes in
               [--svg-safe]                     an SVG that PowerPoint, Word and Keynote take whole: no CSS, no
                                                filters or markers, system fonts, one group per node and line
               [--outline-text]                 with --svg-safe: text as outlines in the theme's own font
               [--focus orders] [--hops 2]      only that element (an id, a group, tag:x, kind:x) and what is within
               [--upstream | --downstream]      so many lines of it (default 1, or all); what feeds it, or what it feeds
               [--template customer.potx]       pptx: made in that PowerPoint template, its layouts, master, fonts
               [--layout "Title Only"]          and colours (a brand theme's pptx: names one too); --layout picks the
               [--keep-look] [--keep-slides]    layout, --keep-look keeps the diagram's own theme, --keep-slides the
                                                template's own slides in front`]:
    `  carto render <file.yaml…> [-o out] [--format svg|png|pptx|pdf] [--theme name|file.theme.yaml]
               [--pack azure] [--scale 2]           --theme gaat voor theme: in het diagram; -o x.pptx of x.pdf kiest ook het formaat
               [--view name | --all-views]      één weergave van het diagram, of elk naar <file>-<view>.svg
               [--step 3 | --all-steps]         de tekening bij een van zijn steps:, of elke stap naar <file>-step-01.svg;
                                                pptx en pdf krijgen vanzelf een dia (pagina) per stap
               [--icons official|lucide]        de officiële iconen van de leverancier (carto icons import) of onze lijniconen,
                                                wat icons: in het diagram ook zegt
               [--layer security | --all-layers] door één (of meer) van zijn layers:, of elke laag naar <file>-<layer>.svg;
               [--dim]                          pptx en pdf: een dia (pagina) per laag. --dim laat de rest vervaagd staan
               [--stable]                       onthoudt in <file>.layout.json waar alles stond, zodat de
                                                volgende render na een wijziging het daar laat
               [--stage q2 | --stage overview]  een van zijn stages: (van huidig naar gewenst; zonder: de gewenste), of
                                                alles gemarkeerd met de stage waarin het komt en gaat
               [--svg-safe]                     een SVG die PowerPoint, Word en Keynote heel overnemen: geen CSS, geen
                                                filters of markers, systeemlettertypen, één groep per element en lijn
               [--outline-text]                 met --svg-safe: tekst als contouren in het eigen lettertype van het thema
               [--focus orders] [--hops 2]      alleen dat element (een id, een groep, tag:x, kind:x) en wat binnen
               [--upstream | --downstream]      zoveel lijnen ervan ligt (standaard 1, of all); wat erheen leidt, of waar het heen leidt
               [--template customer.potx]       pptx: gemaakt in dat PowerPoint-sjabloon, met zijn indelingen, model,
               [--layout "Title Only"]          lettertypen en kleuren (de pptx: van een huisstijlthema noemt er ook een);
               [--keep-look] [--keep-slides]    --layout kiest de indeling, --keep-look houdt het eigen thema van het
                                                diagram, --keep-slides de eigen dia's van het sjabloon vooraan`,
  [`  carto deck <file.yaml…> -o deck.pptx|deck.pdf  all diagrams in one deck, a slide (page) each, one per step where a diagram has steps:
               [--all-steps | --no-steps]           also step through sequence messages and dynamic views; or never
               [--stages]                           a slide per stage of its stages: and per transition, the overview,
                                                    as-is and to-be side by side, the roadmap (pptx)
               [--title "Deck title"] [--subtitle …] title slide in front (pptx)
               [--aspect 16:9|4:3] [--font Inter]   slide shape and typeface (pptx)
               [--template x.potx] [--layout name]  in a PowerPoint template, as carto render (pptx)
               [--keep-look] [--keep-slides]
               [--page fit|a4|a3]                   page size (pdf, default fit)`]:
    `  carto deck <file.yaml…> -o deck.pptx|deck.pdf  alle diagrammen in één deck, elk een dia (pagina), een per stap als het steps: heeft
               [--all-steps | --no-steps]           ook stap voor stap door sequence-berichten en dynamische weergaven; of nooit
               [--stages]                           een dia per stage van zijn stages: en per overgang, het overzicht,
                                                    huidig en gewenst naast elkaar, de roadmap (pptx)
               [--title "Deck title"] [--subtitle …] titeldia vooraan (pptx)
               [--aspect 16:9|4:3] [--font Inter]   vorm van de dia en lettertype (pptx)
               [--template x.potx] [--layout name]  in een PowerPoint-sjabloon, zoals carto render (pptx)
               [--keep-look] [--keep-slides]
               [--page fit|a4|a3]                   paginaformaat (pdf, standaard fit)`,
  [`  carto watch  <file.yaml…> [same options]      re-render on every save (and when included files change)`]:
    `  carto watch  <file.yaml…> [same options]      opnieuw renderen bij elke keer opslaan (en als ingevoegde bestanden wijzigen)`,
  [`  carto serve  [folder] [--port 4317]           the web editor for a folder, with an MCP endpoint for your own AI`]:
    `  carto serve  [folder] [--port 4317]           de webeditor voor een map, met een MCP-endpoint voor je eigen AI`,
  [`  carto export-html <file.yaml|folder> [-o out.html]  one HTML file to send: every view and step drawn (light and
               [--title "…"] [--all-steps]      dark), pan and zoom, presenter, drill-down, search, element
                                                details, print; works offline from disk. A file brings the
                                                diagrams it drills into; a folder gets a contents page.
                                                More: docs/html-export.md`]:
    `  carto export-html <file.yaml|folder> [-o out.html]  één HTML-bestand om te versturen: elke weergave en stap getekend
               [--title "…"] [--all-steps]      (licht en donker), verschuiven en zoomen, presenteren, doorklikken, zoeken,
                                                details per element, afdrukken; werkt offline vanaf schijf. Een bestand
                                                neemt de diagrammen mee waar het naar doorklikt; een map krijgt een inhoudspagina.
                                                Meer: docs/html-export.md`,
  [`  carto describe <file.yaml> [-o out.md|.txt|.html]  the diagram in plain words: what it shows, its groups and
               [--view name | --all-views]      elements, connections in reading order, steps, layers, trust boundaries
               [--format text|md|html]          and key (sequence: the messages; ERD: tables and relations).
               [--stages]                       its stages: what each one adds, changes, removes and replaces
                                                The same words are in every SVG, PNG, PDF and slide. docs/describe.md`]:
    `  carto describe <file.yaml> [-o out.md|.txt|.html]  het diagram in gewone woorden: wat het laat zien, de groepen en
               [--view name | --all-views]      elementen, verbindingen in leesvolgorde, stappen, lagen, vertrouwensgrenzen
               [--format text|md|html]          en legenda (sequence: de berichten; ERD: tabellen en relaties).
               [--stages]                       de stages: wat elke stage toevoegt, wijzigt, weghaalt en vervangt
                                                Dezelfde woorden staan in elke SVG, PNG, PDF en dia. docs/describe.md`,
  [`  carto share <file.yaml> [--base URL]          a link that opens the diagram read-only in the web app; the diagram
                                                travels in the link's #fragment, never to a server (default base
                                                http://localhost:5178/)`]:
    `  carto share <file.yaml> [--base URL]          een link die het diagram alleen-lezen opent in de webapp; het diagram
                                                reist mee in het #fragment van de link, nooit naar een server (standaard
                                                http://localhost:5178/)`,
  [`  carto validate <file.yaml…|folder>            check files and each of their views, print problems; a folder
                                                also across files: dangling ref:/of:, one id with two kinds,
                                                elements that no diagram or view shows
               [--drift]                        also fail when <file>.layout.json pins, bends or locks things
                                                (or views) that are no longer in the diagram
               [--drift --fix]                  drop those entries from <file>.layout.json`]:
    `  carto validate <file.yaml…|folder>            controleert bestanden en elk van hun weergaven, toont problemen; een
                                                map ook over bestanden heen: ref:/of: naar niets, één id met twee
                                                soorten, elementen die geen diagram of weergave laat zien
               [--drift]                        ook falen als <file>.layout.json dingen (of weergaven) vastzet,
                                                buigt of vergrendelt die niet meer in het diagram staan
               [--drift --fix]                  die regels uit <file>.layout.json halen`,
  [`  carto diff <before.yaml> <after.yaml>         what changed between two versions, by id: added, removed and
                                                changed nodes, groups and lines`]:
    `  carto diff <before.yaml> <after.yaml>         wat er veranderde tussen twee versies, per id: toegevoegde,
                                                verwijderde en gewijzigde elementen, groepen en lijnen`,
  [`  carto diff --git <ref> <file.yaml…>           the same against the file at a branch, tag or commit (includes too);
                                                --since <ref> says the same`]:
    `  carto diff --git <ref> <file.yaml…>           hetzelfde tegen het bestand op een branch, tag of commit (ook includes);
                                                --since <ref> zegt hetzelfde`,
  [`  carto diff --snapshot <label> <file.yaml…>    against a snapshot the editor wrote next to it (<name>.snapshots/<label>.yaml)
               [-o diff.svg|diff.png|diff.md|folder]  also the picture (or, .md, the changes in plain sentences): the newer drawing with what was added and
                                                changed marked, what was removed as ghosts where it was, and a key
               [--side-by-side]                 the picture as before and after, each with its own marks
               [--json] [--view name] [--fresh] [--exit-code]
                                                --fresh lays the newer drawing out from scratch instead of keeping
                                                what was there in place; --exit-code exits 1 when something changed`]:
    `  carto diff --snapshot <label> <file.yaml…>    tegen een snapshot die de editor ernaast schreef (<name>.snapshots/<label>.yaml)
               [-o diff.svg|diff.png|diff.md|folder]  ook het plaatje (of, .md, de wijzigingen in gewone zinnen): de nieuwere
                                                tekening met wat erbij kwam en veranderde gemarkeerd, wat weg is als schim
                                                op zijn oude plek, en een legenda
               [--side-by-side]                 het plaatje als voor en na, elk met zijn eigen markeringen
               [--json] [--view name] [--fresh] [--exit-code]
                                                --fresh legt de nieuwere tekening opnieuw uit in plaats van wat er
                                                stond op zijn plek te houden; --exit-code geeft exit 1 als er iets veranderde`,
  [`  carto new <type> [file.yaml]                  start from a template; no type: which to pick`]:
    `  carto new <type> [file.yaml]                  begin vanuit een sjabloon; zonder type: welk je kiest`,
  [`  carto icons [azure|aws|gcp|kubernetes]        where to download each official icon set, and what is imported`]:
    `  carto icons [azure|aws|gcp|kubernetes]        waar je elke officiële iconenset downloadt, en wat er geïmporteerd is`,
  [`  carto icons import <folder|file.zip> [--pack azure]
                                                index an official icon download (Azure, AWS, Google Cloud,
                                                Kubernetes) into a pack in {configDir};
                                                the vendor is told from the files when --pack is left out`]:
    `  carto icons import <folder|file.zip> [--pack azure]
                                                indexeert een gedownloade officiële iconenset (Azure, AWS, Google Cloud,
                                                Kubernetes) als pakket in {configDir};
                                                zonder --pack blijkt de leverancier uit de bestanden`,
  [`  carto icons list                              packs, when imported, and how many kinds each covers`]:
    `  carto icons list                              pakketten, wanneer geïmporteerd, en hoeveel soorten elk dekt`,
  [`  carto icons show <pack> [-o sheet.png|.svg]   which kind got which icon, and which have none`]:
    `  carto icons show <pack> [-o sheet.png|.svg]   welke soort welk icoon kreeg, en welke er geen heeft`,
  [`  carto icons find <pack> <words…>              icons of the pack by name, to map one by hand`]:
    `  carto icons find <pack> <words…>              iconen van het pakket op naam, om er een met de hand te koppelen`,
  [`  carto icons map <pack> <kind> <words…|file>   give a kind an icon by hand (kept when a newer set is imported)`]:
    `  carto icons map <pack> <kind> <words…|file>   geef een soort met de hand een icoon (blijft bij een nieuwere set)`,
  [`  carto icons unmap <pack> <kind>               the kind draws its line icon again
               then: icons: official in a diagram, or --icons official|lucide on render, deck or watch`]:
    `  carto icons unmap <pack> <kind>               de soort tekent weer zijn lijnicoon
               dan: icons: official in een diagram, of --icons official|lucide bij render, deck of watch`,
  [`  carto themes                                  built-in themes`]:
    `  carto themes                                  ingebouwde thema's`,
  [`  carto types [words…]                          which type to pick, best match first`]:
    `  carto types [words…]                          welk type je kiest, beste match eerst`,
  [`Manual positions are read from <file>.layout.json next to the diagram (per view under "views").
The same file can hold a layout note ("layout") per view: render reads it and only --stable writes it,
so the same YAML and layout file always give the same picture. More: docs/ci.md`]:
    `Handmatige posities worden gelezen uit <file>.layout.json naast het diagram (per weergave onder "views").
Hetzelfde bestand kan per weergave een layoutnotitie ("layout") bevatten: render leest die en alleen --stable
schrijft hem, zodat dezelfde YAML en hetzelfde layoutbestand altijd hetzelfde plaatje geven. Meer: docs/ci.md`,
};

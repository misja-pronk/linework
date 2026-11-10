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
  'steps or layers as a GIF, MP4 or WebM': 'stappen of lagen als GIF, MP4 of WebM',
  'render again on every save': 'opnieuw renderen bij elke keer opslaan',
  'a web page that carries the drawing': 'een webpagina met de tekening erin',
  'check files and their views': 'bestanden en hun weergaven controleren',
  'architecture review rules: findings, fixes, a report': 'regels voor de architectuurreview: bevindingen, oplossingen, een rapport',
  'what changed between two versions': 'wat er veranderde tussen twee versies',
  'the diagram in plain words': 'het diagram in gewone woorden',
  'architecture decisions: log, table, new': 'architectuurbesluiten: log, tabel, nieuw',
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
  '--pick takes a route number: 1, 2, …': '--pick neemt een routenummer: 1, 2, …',
  '--{name} is a number from {min} to {max}, not "{value}"': '--{name} is een getal van {min} tot {max}, niet "{value}"',
  '--icons is official or lucide, not "{value}"': '--icons is official of lucide, niet "{value}"',
  '--timeout takes seconds, not "{value}"': '--timeout neemt seconden, niet "{value}"',
  '--template is a PowerPoint template, .potx or .pptx: {file}': '--template is een PowerPoint-sjabloon, .potx of .pptx: {file}',
  '-o {out} names one file, but {why}: give a folder, e.g. -o {folder}/': '-o {out} noemt één bestand, maar {why}: geef een map, bijvoorbeeld -o {folder}/',
  '--all-views writes one per view': '--all-views schrijft er een per weergave',
  '--all-layers writes one per layer': '--all-layers schrijft er een per laag',
  'several diagrams make several files': 'meer diagrammen geven meer bestanden',
  '-o - writes one picture to standard output: give a folder for --all-views or --all-steps': '-o - schrijft één plaatje naar standaarduitvoer: geef een map voor --all-views of --all-steps',
  '-o - writes one drawing to standard output: give a folder for --all-views': '-o - schrijft één tekening naar standaarduitvoer: geef een map voor --all-views',
  'Unknown theme "{name}", use one of: {themes}, or a .theme.yaml file': 'Onbekend thema "{name}", kies uit: {themes}, of een .theme.yaml-bestand',
  'Unknown type "{name}". Types: {types}': 'Onbekend type "{name}". Typen: {types}',
  '--write keeps the diagram of one folder of exports or data product files: carto render <folder> --write mesh.yaml': '--write bewaart het diagram van één map met exports of dataproductbestanden: carto render <folder> --write mesh.yaml',
  'carto animate takes one diagram': 'carto animate neemt één diagram',
  'carto deck needs -o <file>.pptx or -o <file>.pdf': 'carto deck heeft -o <file>.pptx of -o <file>.pdf nodig',
  'carto import --live reads from the tool, not from files: --into <diagram.yaml> imports over one': 'carto import --live leest uit het programma, niet uit bestanden: --into <diagram.yaml> importeert over een diagram heen',
  'Say which format: -o out.drawio, .excalidraw, .mmd or .md, or --format {formats}': 'Zeg welk formaat: -o out.drawio, .excalidraw, .mmd of .md, of --format {formats}',
  'One saved diagram: carto diff --live <source> <saved.yaml>': 'Eén bewaard diagram: carto diff --live <source> <saved.yaml>',
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
  '{file} already exists, use --force to overwrite': '{file} bestaat al, overschrijf het met --force',
  '{file} already exists: --into {file} imports over it (your edits stay), --force starts it over': '{file} bestaat al: --into {file} importeert eroverheen (je wijzigingen blijven), --force begint opnieuw',
  'Created {file}': '{file} gemaakt',
  'not found': 'niet gevonden',
  'not found, here or in {ref}': 'niet gevonden, hier of in {ref}',
  'not found: leave out --into to start a new diagram': 'niet gevonden: laat --into weg om een nieuw diagram te beginnen',
  'not valid JSON: {message}': 'geen geldige JSON: {message}',
  'standard output': 'standaarduitvoer',
  ok: 'ok',
  'nothing written': 'niets geschreven',
  '{file}: nothing to draw': '{file}: niets te tekenen',
  'nothing to draw': 'niets te tekenen',

  // Drawing
  '--svg-safe is for SVG: ignored for {format}': '--svg-safe is voor SVG: genegeerd voor {format}',
  '--outline-text goes with --svg-safe: ignored': '--outline-text hoort bij --svg-safe: genegeerd',
  '--layout, --keep-look and --keep-slides go with --template: ignored': '--layout, --keep-look en --keep-slides horen bij --template: genegeerd',
  'empty: nothing to draw, not written': 'leeg: niets te tekenen, niet geschreven',
  '--all-layers: this diagram has no layers: (see docs/layers.md)': '--all-layers: dit diagram heeft geen layers: (zie docs/layers.md)',
  'nothing on this layer, not written': 'niets op deze laag, niet geschreven',
  '{all} drawings: the whole and {count} layer|{all} drawings: the whole and {count} layers': '{all} tekeningen: het geheel en {count} laag|{all} tekeningen: het geheel en {count} lagen',
  '--notes: there is no {path}': '--notes: er is geen {path}',
  'no steps here: drawn as a whole': 'hier zijn geen stappen: als geheel getekend',
  'step {n}': 'stap {n}',
  'layout noted': 'layout onthouden',
  '{count} diagram|{count} diagrams': '{count} diagram|{count} diagrammen',
  '{count} drawing|{count} drawings': '{count} tekening|{count} tekeningen',
  '{count} element|{count} elements': '{count} element|{count} elementen',
  '{count} step|{count} steps': '{count} stap|{count} stappen',
  '{count} page|{count} pages': "{count} pagina|{count} pagina's",
  '{count} slide|{count} slides': "{count} dia|{count} dia's",
  '{count} file|{count} files': '{count} bestand|{count} bestanden',
  '{count} threat|{count} threats': '{count} dreiging|{count} dreigingen',
  '{shapes} shapes, {lines} connectors': '{shapes} vormen, {lines} verbindingen',
  '{shapes} shapes, {lines} arrows': '{shapes} vormen, {lines} pijlen',
  'watching… Ctrl+C to stop': 'kijkt mee… Ctrl+C om te stoppen',

  // validate
  fixed: 'opgelost',
  stale: 'verouderd',
  '{count} stale entry; carto validate --drift --fix {file} drops it|{count} stale entries; carto validate --drift --fix {file} drops them': '{count} verouderde regel; carto validate --drift --fix {file} haalt hem weg|{count} verouderde regels; carto validate --drift --fix {file} haalt ze weg',
  '{count} stale entry dropped|{count} stale entries dropped': '{count} verouderde regel weggehaald|{count} verouderde regels weggehaald',
  '{count} stale entry dropped, nothing left: file removed|{count} stale entries dropped, nothing left: file removed': '{count} verouderde regel weggehaald, niets over: bestand verwijderd|{count} verouderde regels weggehaald, niets over: bestand verwijderd',
  'workspace ok: {count} diagram|workspace ok: {count} diagrams': 'map ok: {count} diagram|map ok: {count} diagrammen',
  'note {id} is in view "{view}", which the diagram no longer has': 'notitie {id} staat in weergave "{view}", die het diagram niet meer heeft',
  'note {id} ({status}) is about "{was}", which is no longer in the diagram': 'notitie {id} ({status}) gaat over "{was}", dat niet meer in het diagram staat',
  'note {id} ({status}) is about "{was}", which is no longer in the diagram (view {view})': 'notitie {id} ({status}) gaat over "{was}", dat niet meer in het diagram staat (weergave {view})',

  // trace, notes, threats, share
  '{file}: there is {count} route, not {pick}|{file}: there are {count} routes, not {pick}': '{file}: er is {count} route, geen {pick}|{file}: er zijn {count} routes, geen {pick}',
  '{count} routes, route {pick}:': '{count} routes, route {pick}:',
  '{count} routes, the first:': '{count} routes, de eerste:',
  '{file} has no model: a dynamic view needs model elements (elements:, or include: of a model)': '{file} heeft geen model: een dynamische weergave heeft modelelementen nodig (elements:, of include: van een model)',
  'carto notes: {ours} or {theirs} is not a notes file': 'carto notes: {ours} of {theirs} is geen notitiebestand',
  '{file}: no review notes ({path} is not there)': '{file}: geen reviewnotities ({path} bestaat niet)',
  '{file}: no threat model here: add trust: to a group, or threats: to an element or line (docs/threats.md)': '{file}: hier is geen dreigingsmodel: zet trust: bij een groep, of threats: bij een element of lijn (docs/threats.md)',
  '{file}: the link would be {size} kB, over the {limit} kB a link can safely carry. Share the file itself instead.': '{file}: de link zou {size} kB worden, meer dan de {limit} kB die een link veilig kan bevatten. Deel liever het bestand zelf.',

  // diff
  'against {what}': 'tegen {what}',
  '"{ref}" is not a commit, branch or tag here': '"{ref}" is hier geen commit, branch of tag',
  'carto diff --git needs a git repository': 'carto diff --git heeft een git-repository nodig',
  'Neither {a} nor {b} holds access exports, gh api responses or Azure resources': 'Noch {a} noch {b} bevat access-exports, gh api-antwoorden of Azure-resources',
  'no snapshot "{label}" ({path}); there are: {list}': 'geen snapshot "{label}" ({path}); er zijn: {list}',
  'no snapshot "{label}" ({path}); take one in the editor with ⇧⌘S': 'geen snapshot "{label}" ({path}); maak er een in de editor met ⇧⌘S',

  // import
  'nothing to draw: no Compose file, Helm chart, manifests, Bicep, OpenAPI, AsyncAPI or workflow found': 'niets te tekenen: geen Compose-bestand, Helm-chart, manifests, Bicep, OpenAPI, AsyncAPI of workflow gevonden',
  '(not written: --dry-run)': '(niet geschreven: --dry-run)',
  'also: {hint}': 'ook: {hint}',
  'no workspace model found': 'geen workspace-model gevonden',
  'no ```mermaid, ```d2 or ```plantuml blocks found': 'geen ```mermaid-, ```d2- of ```plantuml-blokken gevonden',
  'no pages found': "geen pagina's gevonden",
  'git log failed in {repo}: {message}': 'git log mislukte in {repo}: {message}',

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

  // carto review
  '--fail-on is error, warn, info or never, not "{value}"': '--fail-on is error, warn, info of never, niet "{value}"',
  'There is no rule pack "{name}": {packs}': 'Er is geen regelpakket "{name}": {packs}',
  '{file}: no diagrams here': '{file}: hier staan geen diagrammen',
  'cannot review': 'niet te reviewen',
  'review: off': 'review: uit',
  'no findings': 'geen bevindingen',
  'no findings, {count} set aside': 'geen bevindingen, {count} opzijgezet',
  '{count} set aside': '{count} opzijgezet',
  '-o {out}: a review report is .md, .html, .pdf or (with --json) .json': '-o {out}: een reviewrapport is .md, .html, .pdf of (met --json) .json',

  // carto decisions
  'carto decisions new "title": the decision needs a title': 'carto decisions new "title": het besluit heeft een titel nodig',
  '--status is one of {list}, not "{value}"': '--status is een van {list}, niet "{value}"',
  'carto decisions new: there is no decision {n} in {folder}': 'carto decisions new: er is geen besluit {n} in {folder}',
  'concerns "{id}", which is not in {folder}': 'gaat over "{id}", dat niet in {folder} staat',
  'this folder': 'deze map',
  'superseded by {n}': 'vervangen door {n}',
  '{file}: no such folder': '{file}: map bestaat niet',
  '{count} decision|{count} decisions': '{count} besluit|{count} besluiten',

  // carto new --wizard
  'Wizards (carto new --wizard <name> [file.yaml] [--answers answers.json] [-y]):': 'Wizards (carto new --wizard <name> [file.yaml] [--answers answers.json] [-y]):',
  'No wizard "{name}".': 'Geen wizard "{name}".',
  'After: {source}': 'Volgens: {source}',
  'Y/n': 'J/n',
  'y/N': 'j/N',
  'numbers, commas; Enter: {value}': "nummers, komma's; Enter: {value}",
  'Enter: {value}': 'Enter: {value}',
  none: 'geen',
  'number or name, Enter: *': 'nummer of naam, Enter: *',
  'Not one of the choices; try again.': 'Geen van de keuzes; probeer het nog eens.',
  'Not a question of {wizard}, ignored: {ids}. Questions: {questions}': 'Geen vraag van {wizard}, genegeerd: {ids}. Vragen: {questions}',
  Create: 'Maken',
  'start from a template or a wizard': 'beginnen met een sjabloon of een wizard',
  'Mermaid, draw.io, Terraform, Azure, … to YAML': 'Mermaid, draw.io, Terraform, Azure, … naar YAML',
  'reusable fragments: list, show, save, insert': 'herbruikbare fragmenten: tonen, bekijken, opslaan, invoegen',
  Export: 'Exporteren',
  'a link that opens it in the web app': 'een link die het opent in de webapp',
  'a request through it, as a sequence diagram': 'een verzoek erdoorheen, als sequentiediagram',
  'the threat table': 'de dreigingstabel',
  'review notes': 'reviewnotities',
  'carto <command> --help: its options · carto help all: everything · - is stdin or stdout': 'carto <opdracht> --help: de opties · carto help all: alles · - is stdin of stdout',
  'carto trace needs where the request starts: --from <element> (with --to <element> for one route), or --steps to follow the diagram\'s steps': 'carto trace moet weten waar het verzoek begint: --from <element> (met --to <element> voor één route), of --steps om de stappen van het diagram te volgen',
  '{file}: a file is in the way where a folder is needed (-o names a folder when it has no extension)': '{file}: er staat een bestand waar een map nodig is (-o is een map als er geen extensie is)',
  'as-is, transition stages and to-be: each, compared, a roadmap': 'huidig, tussenstappen en gewenst: elk apart, vergeleken, als roadmap',
} as const satisfies Record<string, string>;

/** The help, part by part (see helpChunks): the English as main.ts writes it, the Dutch laid out the same way. */
export const nlHelp: Record<string, string> = {
  [`  carto stages <file.yaml> [-o folder] [-f png]  everything its stages: make: each stage, the migration overview,
               [--from as-is --to q2]           each transition (what is added, changed, removed, replaced),
               [--side-by-side]                 the as-is and to-be side by side, the roadmap (YAML and drawn)
                                                and the stages in words; --from/--to: that transition only.
                                                Decks and animations: carto deck --stages, carto animate --stages.
                                                More: docs/transitions.md`]:
    `  carto stages <file.yaml> [-o folder] [-f png]  alles wat de stages: opleveren: elke stage, het migratieoverzicht,
               [--from as-is --to q2]           elke overgang (wat erbij komt, wijzigt, weggaat, vervangen wordt),
               [--side-by-side]                 huidig en gewenst naast elkaar, de roadmap (YAML en getekend)
                                                en de stages in woorden; --from/--to: alleen die overgang.
                                                Decks en animaties: carto deck --stages, carto animate --stages.
                                                Meer: docs/transitions.md`,
  [`  carto export <file.yaml…|folder> --to html|md|confluence|drawio|excalidraw|mermaid [-o out]
                                                one command for every export: html is export-html, md is
                                                export-md, confluence is export-confluence (their options apply)`]:
    `  carto export <file.yaml…|folder> --to html|md|confluence|drawio|excalidraw|mermaid [-o out]
                                                één opdracht voor elke export: html is export-html, md is
                                                export-md, confluence is export-confluence (hun opties gelden)`,
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
               [--notes]                        with the open review notes of <file>.notes.json: numbered markers
                                                and the notes under the drawing (pptx: in the speaker notes)
               [--decisions]                    with the architecture decisions of the folder (decisions/): a
                                                numbered page marker on what each is about, and a key and the
                                                decisions under the drawing (pptx: in the speaker notes)
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
               [--notes]                        met de open reviewnotities uit <file>.notes.json: genummerde markeringen
                                                en de notities onder de tekening (pptx: in de sprekersnotities)
               [--decisions]                    met de architectuurbesluiten van de map (decisions/): een
                                                genummerde markering bij waar elk over gaat, en een legenda en de
                                                besluiten onder de tekening (pptx: in de sprekersnotities)
               [--template customer.potx]       pptx: gemaakt in dat PowerPoint-sjabloon, met zijn indelingen, model,
               [--layout "Title Only"]          lettertypen en kleuren (de pptx: van een huisstijlthema noemt er ook een);
               [--keep-look] [--keep-slides]    --layout kiest de indeling, --keep-look houdt het eigen thema van het
                                                diagram, --keep-slides de eigen dia's van het sjabloon vooraan`,
  [`  carto render <folder> [-o mesh.svg]           a folder of data product and data contract files (ODPS, ODCS) as one
               [--write mesh.yaml]              data mesh map; --write keeps the diagram, and updates it the next time`]:
    `  carto render <folder> [-o mesh.svg]           een map met bestanden van dataproducten en datacontracten (ODPS, ODCS)
               [--write mesh.yaml]              als één data-mesh-kaart; --write bewaart het diagram en werkt het daarna bij`,
  [`  carto render <folder> [-o access.svg]         a folder of saved az / Graph / AzureHound JSON as who reaches what,
                                                or of gh api responses as the GitHub organisation (same options as
                                                carto import <folder> below; --write access.yaml keeps the diagram)`]:
    `  carto render <folder> [-o access.svg]         een map met bewaarde az / Graph / AzureHound JSON als wie wat bereikt,
                                                of met gh api-antwoorden als de GitHub-organisatie (dezelfde opties als
                                                carto import <folder> hieronder; --write access.yaml bewaart het diagram)`,
  [`  carto render <folder|export.json> [-o x.png]  Azure resources (az graph query, az bicep build, terraform show -json)
                                                as an azure diagram, with the options of carto import below`]:
    `  carto render <folder|export.json> [-o x.png]  Azure-resources (az graph query, az bicep build, terraform show -json)
                                                als azure-diagram, met de opties van carto import hieronder`,
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
  [`  carto animate <file.yaml> -o out.gif|out.mp4|out.webm  its steps as an animation: each step held, a short blend
               [--view name] [--theme name]         to the next (what appears fades in, what goes fades out),
               [--layers | --walk "a -> b -> c"]    the caption as a lower third; --layers walks its layers
               [--stages]                           (--stages: its stages, what comes fades in, what goes out)
               [--hold 2.5] [--transition 0.5]      (the rest faded in place), --walk a route hop by hop;
               [--no-transitions] [--draw-lines]    --draw-lines draws new lines along their path;
               [--fps 30] [--size 1920x1080]        MP4 and WebM need ffmpeg on the PATH (without it: the GIF
               [--no-captions]                      and the frames as PNG). More: docs/animate.md`]:
    `  carto animate <file.yaml> -o out.gif|out.mp4|out.webm  de stappen als animatie: elke stap even vast, een korte overgang
               [--view name] [--theme name]         naar de volgende (wat verschijnt komt op, wat verdwijnt vervaagt),
               [--layers | --walk "a -> b -> c"]    het onderschrift onderin beeld; --layers loopt de lagen langs
               [--stages]                           (--stages: de stages, wat komt verschijnt, wat gaat vervaagt)
               [--hold 2.5] [--transition 0.5]      (de rest vervaagd op zijn plek), --walk een route hop voor hop;
               [--no-transitions] [--draw-lines]    --draw-lines tekent nieuwe lijnen langs hun pad;
               [--fps 30] [--size 1920x1080]        MP4 en WebM hebben ffmpeg in het PATH nodig (zonder: de GIF
               [--no-captions]                      en de frames als PNG). Meer: docs/animate.md`,
  [`  carto watch  <file.yaml…> [same options]      re-render on every save (and when included files change)`]:
    `  carto watch  <file.yaml…> [same options]      opnieuw renderen bij elke keer opslaan (en als ingevoegde bestanden wijzigen)`,
  [`  carto embed <file.yaml|-> [-o out.html]       a web page that carries everything: the drawing, zoom and drill-down
               [--view name] [--theme name]         --static: the drawing alone, no script; --fragment: only the
               [--static] [--fragment] [--css]      figure, for a page of your own, and --css: the stylesheet with it`]:
    `  carto embed <file.yaml|-> [-o out.html]       een webpagina waar alles in zit: de tekening, zoomen en doorklikken
               [--view name] [--theme name]         --static: alleen de tekening, geen script; --fragment: alleen de
               [--static] [--fragment] [--css]      figuur, voor een eigen pagina, en --css: het stijlblad erbij`,
  [`  carto export-html <file.yaml|folder> [-o out.html]  one HTML file to send: every view and step drawn (light and
               [--notes] [--title "…"] [--all-steps]  dark), pan and zoom, presenter, drill-down, search, element
                                                details, print; works offline from disk. A file brings the
                                                diagrams it drills into; a folder gets a contents page.
                                                --notes: the open review notes too; --decisions: the folder's
                                                architecture decisions, as a page and in the details. More: docs/html-export.md`]:
    `  carto export-html <file.yaml|folder> [-o out.html]  één HTML-bestand om te versturen: elke weergave en stap getekend
               [--notes] [--title "…"] [--all-steps]  (licht en donker), verschuiven en zoomen, presenteren, doorklikken, zoeken,
                                                details per element, afdrukken; werkt offline vanaf schijf. Een bestand
                                                neemt de diagrammen mee waar het naar doorklikt; een map krijgt een inhoudspagina.
                                                --notes: ook de open reviewnotities; --decisions: de architectuurbesluiten
                                                van de map, als pagina en in de details. Meer: docs/html-export.md`,
  [`  carto describe <file.yaml> [-o out.md|.txt|.html]  the diagram in plain words: what it shows, its groups and
               [--view name | --all-views]      elements, connections in reading order, steps, layers, threats
               [--format text|md|html]          and key (sequence: the messages; ERD: tables and relations).
               [--stages]                       its stages: what each one adds, changes, removes and replaces
                                                The same words are in every SVG, PNG, PDF and slide. docs/describe.md`]:
    `  carto describe <file.yaml> [-o out.md|.txt|.html]  het diagram in gewone woorden: wat het laat zien, de groepen en
               [--view name | --all-views]      elementen, verbindingen in leesvolgorde, stappen, lagen, dreigingen
               [--format text|md|html]          en legenda (sequence: de berichten; ERD: tabellen en relaties).
               [--stages]                       de stages: wat elke stage toevoegt, wijzigt, weghaalt en vervangt
                                                Dezelfde woorden staan in elke SVG, PNG, PDF en dia. docs/describe.md`,
  [`  carto export-md <file.yaml|folder> -o dir/    a Markdown page with each view as SVG and PNG, its description
               [--title "…"] [--no-steps]       under it and steps as sections; a folder gets README.md as its
                                                index. Links work on GitHub, GitLab and in Obsidian. docs/wiki-export.md`]:
    `  carto export-md <file.yaml|folder> -o dir/    een Markdown-pagina met elke weergave als SVG en PNG, de beschrijving
               [--title "…"] [--no-steps]       eronder en stappen als secties; een map krijgt README.md als
                                                index. Links werken op GitHub, GitLab en in Obsidian. docs/wiki-export.md`,
  [`  carto export-confluence <file.yaml|folder> -o dir/  Confluence storage-format pages with their PNG and SVG
               [--title "…"] [--no-steps]       attachments, an HTML copy, manifest.json and a README on how to
                                                import them (REST API or by hand); nothing is sent anywhere`]:
    `  carto export-confluence <file.yaml|folder> -o dir/  Confluence-pagina's (storage format) met hun PNG en SVG als
               [--title "…"] [--no-steps]       bijlagen, een HTML-kopie, manifest.json en een README over het
                                                importeren (REST API of met de hand); er wordt niets verstuurd`,
  [`  carto threats <file.yaml> [-o threats.md]    the threat table (STRIDE threats, trust boundaries) as markdown;
               [--view name]                    --view: of one of a model's views. Drawn: carto render --view threats`]:
    `  carto threats <file.yaml> [-o threats.md]    de dreigingstabel (STRIDE-dreigingen, vertrouwensgrenzen) als markdown;
               [--view name]                    --view: van een van de weergaven van een model. Getekend: carto render --view threats`,
  [`  carto trace <file.yaml> --from a --to b       a request traced along the relations, as a sequence diagram:
               [--view v] [--all] [--pick n]    the shortest route (--all: every route, --pick: route n), with
               [--steps] [--dynamic] [-o x]     replies for calls; without --to, followed until each call ends;
                                                --steps: along the diagram's steps or a dynamic view; --dynamic:
                                                a C4 dynamic view to add to views: instead. More: docs/trace.md`]:
    `  carto trace <file.yaml> --from a --to b       een verzoek gevolgd langs de relaties, als sequencediagram:
               [--view v] [--all] [--pick n]    de kortste route (--all: elke route, --pick: route n), met
               [--steps] [--dynamic] [-o x]     antwoorden op aanroepen; zonder --to gevolgd tot elke aanroep eindigt;
                                                --steps: langs de stappen van het diagram of een dynamische weergave;
                                                --dynamic: in plaats daarvan een dynamische C4-weergave om aan views:
                                                toe te voegen. Meer: docs/trace.md`,
  [`  carto share <file.yaml> [--base URL]          a link that opens the diagram read-only in the web app; the diagram
                                                travels in the link's #fragment, never to a server (default base
                                                http://localhost:5178/)`]:
    `  carto share <file.yaml> [--base URL]          een link die het diagram alleen-lezen opent in de webapp; het diagram
                                                reist mee in het #fragment van de link, nooit naar een server (standaard
                                                http://localhost:5178/)`,
  [`  carto validate <file.yaml…|folder>            check files and each of their views, print problems (and review
                                                notes in <file>.notes.json whose element is gone); a folder also
                                                across files: dangling ref:/of:, one id with two kinds, elements
                                                that no diagram or view shows
               [--drift]                        also fail when <file>.layout.json pins, bends or locks things
                                                (or views) that are no longer in the diagram
               [--drift --fix]                  drop those entries from <file>.layout.json`]:
    `  carto validate <file.yaml…|folder>            controleert bestanden en elk van hun weergaven, toont problemen (en
                                                reviewnotities in <file>.notes.json waarvan het element weg is); een map
                                                ook over bestanden heen: ref:/of: naar niets, één id met twee soorten,
                                                elementen die geen diagram of weergave laat zien
               [--drift]                        ook falen als <file>.layout.json dingen (of weergaven) vastzet,
                                                buigt of vergrendelt die niet meer in het diagram staan
               [--drift --fix]                  die regels uit <file>.layout.json halen`,
  [`  carto review <file.yaml…|folder>              the architecture review: built-in rule packs (Azure, AWS,
                                                Kubernetes, systems and C4, GitHub, data products) and the
                                                folder's .cartography/rules.yaml or rules/*.yaml; findings by
                                                Well-Architected pillar, each with why and how to fix it
               [--pack azure]                   only these packs (again for more)
               [--fail-on error|warn|info|never] exit 1 when a finding this bad or worse is left (default
                                                error); 2 when a file cannot be reviewed. For CI: docs/review.md
               [-o report.md|.html|.pdf]        a report to hand over: a summary per pillar, the drawing with
                                                the findings marked, each finding with its fix; --json for tools`]:
    `  carto review <file.yaml…|folder>              de architectuurreview: ingebouwde regelpakketten (Azure, AWS,
                                                Kubernetes, systems en C4, GitHub, dataproducten) en de eigen
                                                .cartography/rules.yaml of rules/*.yaml van de map; bevindingen per
                                                Well-Architected-pijler, elk met waarom en hoe je het oplost
               [--pack azure]                   alleen deze pakketten (herhaal voor meer)
               [--fail-on error|warn|info|never] exit 1 als er een bevinding van deze ernst of erger over is
                                                (standaard error); 2 als een bestand niet te reviewen is. Voor CI: docs/review.md
               [-o report.md|.html|.pdf]        een rapport om over te dragen: een samenvatting per pijler, de tekening
                                                met de bevindingen gemarkeerd, elke bevinding met de oplossing; --json voor tools`,
  [`  carto diff <before.yaml> <after.yaml>         what changed between two versions, by id: added, removed and
                                                changed nodes, groups and lines`]:
    `  carto diff <before.yaml> <after.yaml>         wat er veranderde tussen twee versies, per id: toegevoegde,
                                                verwijderde en gewijzigde elementen, groepen en lijnen`,
  [`  carto diff <old-folder> <new-folder>          two exports (access, GitHub or Azure; two Azure export files too) imported and compared; for access
                                                and GitHub also who gained and lost what, effective access, in words
               [-o diff.svg|diff.md] [--view access]  the picture, the words as markdown; --view access: the matrix
                                                with gained, lost and changed cells marked`]:
    `  carto diff <old-folder> <new-folder>          twee exports (access, GitHub of Azure; ook twee Azure-exportbestanden) geïmporteerd en vergeleken;
                                                voor access en GitHub ook wie wat kreeg en verloor, effectieve toegang, in woorden
               [-o diff.svg|diff.md] [--view access]  het plaatje, de woorden als markdown; --view access: de matrix
                                                met gekregen, verloren en gewijzigde cellen gemarkeerd`,
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
  [`  carto diff --live <k8s|azure|access|github> <saved.yaml>   drift: what changed in the cluster, the estate or
               [the --live options of carto import] [-o drift.png] [--exit-code]   the organisation since the
                                                diagram was saved (read live, as carto import --live does)`]:
    `  carto diff --live <k8s|azure|access|github> <saved.yaml>   drift: wat er veranderde in het cluster, de omgeving of
               [the --live options of carto import] [-o drift.png] [--exit-code]   de organisatie sinds het
                                                diagram werd bewaard (live gelezen, zoals carto import --live doet)`,
  [`  carto notes <file.yaml…> [-o notes.md]       the review notes of <file>.notes.json as markdown, open ones
               [--open | --all]                 (default), or resolved ones too`]:
    `  carto notes <file.yaml…> [-o notes.md]       de reviewnotities uit <file>.notes.json als markdown, de open
               [--open | --all]                 (standaard), of ook de afgehandelde`,
  [`  carto notes --merge-driver <base> <ours> <theirs>
                                                git's merge driver for notes files: merges two people's notes by
                                                thread; set up once, see docs/notes.md`]:
    `  carto notes --merge-driver <base> <ours> <theirs>
                                                de merge driver van git voor notitiebestanden: voegt de notities van
                                                twee mensen per draad samen; eenmalig instellen, zie docs/notes.md`,
  [`  carto decisions [folder] [-o log.md]         the architecture decisions (decisions/, doc/adr, docs/adr, .adr-dir)
               [-o decisions.svg|png|pptx|pdf]  as a decision log in markdown, or drawn as the Decisions table`]:
    `  carto decisions [folder] [-o log.md]         de architectuurbesluiten (decisions/, doc/adr, docs/adr, .adr-dir)
               [-o decisions.svg|png|pptx|pdf]  als besluitenlog in markdown, of getekend als de besluitentabel`,
  [`  carto decisions new "title" [--concerns a,b] [--supersedes 3] [--into folder]
                                                the next decision from the template (MADR with front matter);
                                                --supersedes marks that one superseded by it. More: docs/decisions.md`]:
    `  carto decisions new "title" [--concerns a,b] [--supersedes 3] [--into folder]
                                                het volgende besluit uit het sjabloon (MADR met front matter);
                                                --supersedes markeert dat besluit als vervangen door dit. Meer: docs/decisions.md`,
  [`  carto new <type> [file.yaml]                  start from a template; no type: which to pick`]:
    `  carto new <type> [file.yaml]                  begin vanuit een sjabloon; zonder type: welk je kiest`,
  [`  carto new --wizard <name> [file.yaml]         answer a few questions, get a finished diagram (Azure landing
               [--answers answers.json] [-y]    zone, AKS baseline, AWS, C4, data mesh, …); --wizard list
                                                names them; --answers or -y: no questions, the rest default`]:
    `  carto new --wizard <name> [file.yaml]         beantwoord een paar vragen, krijg een af diagram (Azure-landingszone,
               [--answers answers.json] [-y]    AKS-baseline, AWS, C4, data mesh, …); --wizard list noemt
                                                ze; --answers of -y: geen vragen, de rest standaard`,
  [`  carto import <file.mmd|.d2|.puml|.md|.dsl|.yaml…> [-o out|-] [--force]
                                                Mermaid (flowchart, architecture-beta, stateDiagram,
                                                erDiagram, sequenceDiagram, gitGraph, gantt, timeline, journey) to YAML;
                                                D2 (boxes, sql_table, sequence_diagram; layers: one file each);
                                                PlantUML (sequence, component, deployment, C4, state, activity,
                                                entity; every @startuml block); .md: every mermaid, d2 and
                                                plantuml block; Kubernetes manifests: all files in one diagram;
                                                .csv inventory or NetBox JSON: a network diagram;
                                                terraform show -json (state or plan, AWS and Google Cloud): a cloud diagram;
                                                a folder (or files) of data products and contracts (ODPS, ODCS):
                                                one data mesh diagram, <folder>.yaml; again updates it, your edits stay;
                                                a folder (or files) of az role assignment / Graph / AzureHound JSON:
                                                an access diagram; of gh api responses (or one combined JSON): github
               [--principals auto|all|groups]   members drawn, or folded into their groups (auto: above --collapse-above, 30)
               [--scope <prefix|name>]          one part: /subscriptions/…, rg-shop, or repositories shop-*
               [--depth 1|2|3] [--group-by access|none] [--as github|access]
                                                how deep scopes go; those that reach the same as one; a GitHub
                                                organisation as who reaches which repository (a matrix)
                                                Azure: az graph query JSON (resources and resourcecontainers), az bicep
                                                build output (ARM templates), terraform show -json with azurerm: an azure
                                                diagram, <folder|file>.yaml; again updates it, your edits and pins stay
               [--subscription <name|id,…>] [--rg <name|glob,…>] [--depth 1|2|3] [--all] [--collapse-above 12]
                                                only some subscriptions or resource groups; containers down to
                                                subscriptions, resource groups or (3) networks and subnets; --all also
                                                NICs, disks, NSGs, public IPs, plans; above 12 in one place, 3+ of a kind are one card`]:
    `  carto import <file.mmd|.d2|.puml|.md|.dsl|.yaml…> [-o out|-] [--force]
                                                Mermaid (flowchart, architecture-beta, stateDiagram,
                                                erDiagram, sequenceDiagram, gitGraph, gantt, timeline, journey) naar YAML;
                                                D2 (boxes, sql_table, sequence_diagram; layers: elk een eigen bestand);
                                                PlantUML (sequence, component, deployment, C4, state, activity,
                                                entity; elk @startuml-blok); .md: elk mermaid-, d2- en
                                                plantuml-blok; Kubernetes-manifests: alle bestanden in één diagram;
                                                .csv-inventaris of NetBox JSON: een netwerkdiagram;
                                                terraform show -json (state of plan, AWS en Google Cloud): een clouddiagram;
                                                een map (of bestanden) met dataproducten en contracten (ODPS, ODCS):
                                                één data-mesh-diagram, <folder>.yaml; opnieuw werkt het bij, je wijzigingen
                                                blijven;
                                                een map (of bestanden) met az role assignment / Graph / AzureHound JSON:
                                                een toegangsdiagram; met gh api-antwoorden (of één gecombineerde JSON): github
               [--principals auto|all|groups]   leden getekend, of opgevouwen in hun groepen (auto: boven --collapse-above, 30)
               [--scope <prefix|name>]          één deel: /subscriptions/…, rg-shop, of repositories shop-*
               [--depth 1|2|3] [--group-by access|none] [--as github|access]
                                                hoe diep scopes gaan; die hetzelfde bereiken als één; een GitHub-
                                                organisatie als wie welke repository bereikt (een matrix)
                                                Azure: az graph query JSON (resources en resourcecontainers), uitvoer van az bicep
                                                build (ARM-templates), terraform show -json met azurerm: een azure-
                                                diagram, <folder|file>.yaml; opnieuw werkt het bij, je wijzigingen en
                                                vastgezette posities blijven
               [--subscription <name|id,…>] [--rg <name|glob,…>] [--depth 1|2|3] [--all] [--collapse-above 12]
                                                alleen sommige subscriptions of resourcegroepen; containers tot
                                                subscriptions, resourcegroepen of (3) netwerken en subnets; --all ook
                                                NIC's, schijven, NSG's, publieke IP's, plannen; boven 12 op één plek worden
                                                3+ van een soort één kaart`,
  [`  carto import <repo> [--diagrams diagrams/]    a code repository: a diagram of each Compose file (systems), Helm
               [--values values-prod.yaml]      chart (rendered here; kubernetes), folder of manifests, Bicep entry
               [--dry-run] [--force]            file (azure), OpenAPI / AsyncAPI file (systems; callbacks as a
                                                sequence) and GitHub Actions workflow (process), into diagrams/;
                                                again updates them, your edits stay (--force: start over);
                                                --values: read over every chart's own. More: docs/repo-import.md`]:
    `  carto import <repo> [--diagrams diagrams/]    een coderepository: een diagram van elk Compose-bestand (systems), elke Helm-
               [--values values-prod.yaml]      chart (hier gerenderd; kubernetes), map met manifests, Bicep-startbestand
               [--dry-run] [--force]            (azure), OpenAPI- / AsyncAPI-bestand (systems; callbacks als
                                                sequence) en GitHub Actions-workflow (process), in diagrams/;
                                                opnieuw werkt ze bij, je wijzigingen blijven (--force: opnieuw beginnen);
                                                --values: gelezen over de eigen waarden van elke chart. Meer: docs/repo-import.md`,
  [`  carto render <repo> [-o pictures/]            the same diagrams drawn, without writing them`]:
    `  carto render <repo> [-o pictures/]            dezelfde diagrammen getekend, zonder ze te schrijven`,
  [`  carto import <file.drawio|.excalidraw…> [--keep-positions] [-o out|-] [--force]
                                                a draw.io file (every page) or an Excalidraw file to YAML, with a
                                                report of what was mapped and what was left out; --keep-positions
                                                writes where the shapes stood to <file>.layout.json as pins`]:
    `  carto import <file.drawio|.excalidraw…> [--keep-positions] [-o out|-] [--force]
                                                een draw.io-bestand (elke pagina) of een Excalidraw-bestand naar YAML, met een
                                                verslag van wat overgenomen is en wat niet; --keep-positions schrijft
                                                waar de vormen stonden naar <file>.layout.json als vastgezette posities`,
  [`  carto import --git <repo> [--since 2026-01-01] [--branches main,develop] [--max 200] [-o out]
                                                a repository's history as a git branching diagram`]:
    `  carto import --git <repo> [--since 2026-01-01] [--branches main,develop] [--max 200] [-o out]
                                                de geschiedenis van een repository als git-branchdiagram`,
  [`  carto import --live github --org o           read live with your own kubectl, az or gh and its login, read-only:
               [--into diagram.yaml] [-o out|-]  the commands are shown and asked for first (--yes: not asked;
               [--yes] [--dry-run] [--timeout 120]  --dry-run: only shown); --into imports over a diagram, your
               [--keep-raw <dir>]               edits stay; --keep-raw saves the answers (no secret values,
                                                ever) for carto import <dir>. Allow-list: docs/live-import.md`]:
    `  carto import --live github --org o           live gelezen met je eigen kubectl, az of gh en hun login, alleen lezen:
               [--into diagram.yaml] [-o out|-]  de commando's worden eerst getoond en gevraagd (--yes: niet gevraagd;
               [--yes] [--dry-run] [--timeout 120]  --dry-run: alleen getoond); --into importeert over een diagram heen,
               [--keep-raw <dir>]               je wijzigingen blijven; --keep-raw bewaart de antwoorden (nooit geheime
                                                waarden) voor carto import <dir>. Toegestane commando's: docs/live-import.md`,
  [`  carto export <file.yaml…> -o out.drawio|.excalidraw|.mmd|.md
               [--format drawio|excalidraw|mermaid] [--view name] [--theme name]
                                                the drawing for another tool: draw.io (every view a page) and
                                                Excalidraw keep shapes, groups and attached lines where they are;
                                                Mermaid (.mmd, or .md as a fenced block) for a README on GitHub.
                                                What a format cannot hold is said on stderr. More: docs/interop.md`]:
    `  carto export <file.yaml…> -o out.drawio|.excalidraw|.mmd|.md
               [--format drawio|excalidraw|mermaid] [--view name] [--theme name]
                                                de tekening voor een ander programma: draw.io (elke weergave een pagina) en
                                                Excalidraw houden vormen, groepen en vastgemaakte lijnen waar ze staan;
                                                Mermaid (.mmd, of .md als codeblok) voor een README op GitHub.
                                                Wat een formaat niet kan bevatten staat op stderr. Meer: docs/interop.md`,
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
               then: icons: official in a diagram, or --icons official|lucide on render, deck, watch, embed`]:
    `  carto icons unmap <pack> <kind>               de soort tekent weer zijn lijnicoon
               dan: icons: official in een diagram, of --icons official|lucide bij render, deck, watch, embed`,
  [`  carto themes                                  built-in themes`]:
    `  carto themes                                  ingebouwde thema's`,
  [`  carto types [words…]                          which type to pick, best match first`]:
    `  carto types [words…]                          welk type je kiest, beste match eerst`,
  [`  carto blocks list [--json]                    reusable fragments (docs/blocks.md): ./blocks, your library in
                                                {configDir}/blocks, and the starters`]:
    `  carto blocks list [--json]                    herbruikbare fragmenten (docs/blocks.md): ./blocks, je bibliotheek in
                                                {configDir}/blocks, en de starters`,
  [`  carto blocks show <block> [-o preview.svg|png] [--param k=v]   what it holds, its parameters and problems`]:
    `  carto blocks show <block> [-o preview.svg|png] [--param k=v]   wat erin zit, de parameters en problemen`,
  [`  carto blocks new <name> --from file.yaml --select a,b,c [--title …] [--user]
                                                the selection, with its groups and the lines between, as
                                                ./blocks/<name>.block.yaml (--user: into your library)`]:
    `  carto blocks new <name> --from file.yaml --select a,b,c [--title …] [--user]
                                                de selectie, met haar groepen en de lijnen ertussen, als
                                                ./blocks/<name>.block.yaml (--user: in je bibliotheek)`,
  [`  carto blocks insert <block> into <file.yaml> [--into group] [--param k=v…] [-o out.yaml|-]
                                                as plain YAML, ids made unique, marked "# from block: name@hash"`]:
    `  carto blocks insert <block> into <file.yaml> [--into group] [--param k=v…] [-o out.yaml|-]
                                                als gewone YAML, ids uniek gemaakt, gemarkeerd met "# from block: name@hash"`,
  [`Manual positions are read from <file>.layout.json next to the diagram (per view under "views").
The same file can hold a layout note ("layout") per view: render reads it and only --stable writes it,
so the same YAML and layout file always give the same picture. More: docs/ci.md`]:
    `Handmatige posities worden gelezen uit <file>.layout.json naast het diagram (per weergave onder "views").
Hetzelfde bestand kan per weergave een layoutnotitie ("layout") bevatten: render leest die en alleen --stable
schrijft hem, zodat dezelfde YAML en hetzelfde layoutbestand altijd hetzelfde plaatje geven. Meer: docs/ci.md`,
};

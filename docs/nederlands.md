# Cartography in het Nederlands

Cartography spreekt Engels en Nederlands. Je eigen labels blijven altijd zoals je ze schrijft; vertaald
wordt alleen wat Cartography zelf toevoegt of laat zien.

## Overschakelen

| Waar | Hoe |
| --- | --- |
| De editor | Standaard de taal van je browser. Kies een andere in het menu Instellingen (tandwiel) onder **Taal**; de keuze blijft bewaard in deze browser. |
| De tekening | Zet `lang: nl` bovenaan het diagram. Dan staan de legenda, de namen van soorten, stappentellers, review en beschrijving in het Nederlands, ook in elke export. Een nieuw diagram uit de Nederlandstalige editor krijgt `lang: nl` vanzelf. |
| De CLI | `carto --lang nl …` of `CARTO_LANG=nl`. Zonder die twee volgt de CLI `LC_ALL`, `LC_MESSAGES` of `LANG`. Optienamen blijven Engels (`--view`, `--out`). Een `--lang` geldt ook voor tekeningen zonder eigen `lang:`. |

```yaml
type: systems
lang: nl
title: Webwinkel
nodes:
  klanten: { kind: users }        # getekend als "Gebruikers"
  winkel: { kind: web-app, label: Webwinkel }
```

## Wat wordt vertaald

- **In de tekening en exports** (SVG, PNG, PDF, PowerPoint, HTML): het woord LEGENDA en de labels van
  ingebouwde lijnstijlen, de namen van algemene soorten (Gebruikers, Wachtrij, Opslag; productnamen
  als App Service, S3 of BigQuery blijven), "stap 3 van 7", vertrouwensgrenzen, dreigingen,
  besluiten en reviewbevindingen, rij- en kolomkoppen van journeys en roadmaps, de tekstbeschrijving
  (`carto describe`, alt-tekst) en de knoppen van de interactieve HTML-viewer.
- **In de editor**: werkbalk, panelen, menu's, dialogen, meldingen, het commandopalet, het overzicht
  van sneltoetsen, de inspector en de vragen van de wizards.
- **In de architectuurreview** (`carto review`, het tabblad Review): de regels met waarom en oplossing,
  de bevindingen en het rapport (Markdown, HTML, PDF), in de taal van de tekening. Je eigen regels in
  `rules.yaml` blijven zoals je ze schrijft; meldingen over `rules.yaml` zelf zijn Engels.
- **In de CLI**: de help en de eigen foutmeldingen.

Niet vertaald: meldingen over de inhoud van een diagram (validatie van de YAML), de namen van
diagramtypen in YAML (`type: systems`), sleutels en optienamen, en commentaar in gegenereerde YAML.

## Woordenlijst

We schrijven kort en gewoon, met "je". Een gangbaar Nederlands woord gaat voor een Engels woord, maar
IT-termen die architecten zo gebruiken blijven Engels: API, deployment, subnet, cluster, container,
repository, workflow, pull request, YAML, SVG.

| Engels | Nederlands |
| --- | --- |
| Save / Save as | Opslaan / Opslaan als |
| Open | Openen |
| Export | Exporteren |
| New diagram | Nieuw diagram |
| Builder | Builder (de visuele editor; naam van de modus) |
| Drawing | Tekening |
| Element, node | Element |
| Group | Groep |
| Connection, line | Verbinding, lijn |
| Label | Label |
| Caption | Onderschrift |
| Kind | Soort |
| Type (diagram type) | Type |
| View | Weergave |
| Layer / Layers | Laag / Lagen |
| Step / Steps | Stap / Stappen |
| Focus | Focus |
| Note (review note) | Notitie |
| Decision (ADR) | Besluit |
| Review | Review |
| Finding | Bevinding |
| Threat | Dreiging |
| Trust boundary | Vertrouwensgrens |
| Compare | Vergelijken |
| Present | Presenteren |
| Key, legend | Legenda |
| Theme | Thema |
| Settings | Instellingen |
| Shortcut | Sneltoets |
| Command palette | Commandopalet |
| Template | Sjabloon |
| Tidy | Opruimen |
| Undo / Redo | Ongedaan maken / Opnieuw |
| Delete | Verwijderen |
| Rename | Hernoemen |
| Pin | Vastzetten |
| Folder, workspace | Map |
| Search | Zoeken |
| Describe | Beschrijven |
| Ask Claude | Vraag het Claude |
| Warning / Error | Waarschuwing / Fout |

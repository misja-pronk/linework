# Linework in het Nederlands

Linework spreekt Engels en Nederlands. Je eigen labels blijven altijd zoals je ze schrijft; vertaald
wordt alleen wat Linework zelf toevoegt of laat zien.

## Overschakelen

| Waar | Hoe |
| --- | --- |
| De editor | Standaard de taal van je browser. Kies een andere in het themamenu in de werkbalk onder **Language / Taal**; de keuze blijft bewaard in deze browser. |
| De tekening | Zet `lang: nl` bovenaan het diagram. Dan staan de legenda, de namen van soorten, stappentellers, review en beschrijving in het Nederlands, ook in elke export. Een nieuw diagram uit de Nederlandstalige editor krijgt `lang: nl` vanzelf. |
| De CLI | `linework --lang nl …` of `LINEWORK_LANG=nl`. Zonder die twee volgt de CLI `LC_ALL`, `LC_MESSAGES` of `LANG`. Optienamen blijven Engels (`--view`, `--out`). Een `--lang` geldt ook voor tekeningen zonder eigen `lang:`. |

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
  als App Service, S3 of BigQuery blijven), "stap 3 van 7", vertrouwensgrenzen,
  rij- en kolomkoppen van journeys en roadmaps (ook de maanden: Mrt, Mei, Okt), de kopjes in een
  dataproduct en datacontract (Inputports, Outputports, Schema, Garanties, Kwaliteitscontroles),
  de hoek en de soorten in een toegangsmatrix (Wie \ waar), wat een toegangsdiagram zelf schrijft
  over PIM (In aanmerking, max. 4 h, goedkeuring door …), over Conditional Access (Alleen rapporteren,
  vereist MFA) en bij een vergelijking met een eerdere stand (+ erbij, − kwijt, ~ gewijzigd, Nieuw,
  Weg), de systemen op een capabilitymap (1 systeem, geen systeem), aantallen (5 mensen), de namen
  die een type zelf aan zijn weergaven geeft (Overzicht, Hele sequence, Klantreis, *Orders in
  detail*), de tekstbeschrijving (`linework describe`, alt-tekst) en de knoppen van de interactieve
  HTML-viewer. Een naam die gelijk is aan zijn sleutel in de YAML (een klasse `Member`) is van jou en
  blijft staan, ook als Linework hem van de sleutel maakt: een team `payments` heet Payments, niet
  Betalingen. Alleen een sleutel die zijn soort herhaalt (`users: { kind: users }`) noemt de soort, en
  die wordt Gebruikers.
- **Bewust Engels in de tekening**: de vaste woorden van een notatie, zoals ALT, LOOP en REF in een
  sequence, «interface» en «enumeration» in UML, entry / do in een toestandsdiagram, de patronen van
  een context map (Customer/Supplier, Partnership, ACL) en Flow of change uit Team Topologies.
- **In de editor**: werkbalk, panelen, menu's, dialogen, meldingen (ook waarom twee elementen niet
  te verbinden zijn), het commandopalet, het overzicht van sneltoetsen en de inspector. De weergavekiezer, het commandopalet, de melding bij V en de
  alleen-lezen-viewer van een deellink noemen de weergaven die een type zelf maakt in de taal van de
  editor; de tekening en de exports houden de `lang:` van het diagram. Een naam die je zelf aan een
  weergave gaf, blijft zoals je hem schreef.
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
| Review | Review |
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
| Your AI | Je AI |
| Copy for your AI | Kopiëren voor je AI |
| Warning / Error | Waarschuwing / Fout |

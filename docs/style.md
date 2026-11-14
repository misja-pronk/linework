# The Linework style

Linework has a look of its own, called **Survey**. It is the default: a diagram without a `theme:` is drawn in
it. Two other looks, **Transit** and **Drafting**, are built in for the cases where Survey is not the right voice.
This page says what Survey is, which rules keep it recognisable, and when to pick which theme. The tokens behind
it are listed in [themes.md](themes.md); the research that led here is in
[research/style-2026-11.md](research/style-2026-11.md).

## Survey: the diagram as a map sheet

![Survey](themes/png/survey-azure.png)

White page, white cards. Groups are terrain: warm paper tints that get one step deeper with every level of
nesting, bounded by one hairline colour. Group names are small letterspaced capitals, like region names on a map.
Words on a line sit on the line in a monospace face with no box around them, like a road number. Icons are drawn
bare in one of ten map inks. A ruled KEY row closes the sheet, and four small corner marks show its extent. No
shadows, no gradients, no ornament.

The signature does a job. The depth tints are what you recognise, and they are also what makes nesting readable:
subscription, network and subnet are three visibly different grounds, and the white cards stand out on all of
them.

## The rules that keep it recognisable

A theme file can change any of these. A diagram stops looking like Linework when several go at once, so change
colour and font for a brand, and leave the rest.

1. **Depth, not colour, fills a group.** One tint per nesting level, the same hue throughout. A group's tone
   shows in its small header icon, never in its fill.
2. **Cards are white and flat.** One hairline border, no shadow. Colour on a card is the icon and nothing else.
3. **Icons are bare.** No tile behind them. The ink says what family a thing belongs to; the shape says what it
   is. Vendor icons from an icon pack are drawn as they are, on the same white card.
4. **Two typefaces, two jobs.** Instrument Sans for names and prose. Geist Mono for the technical layer: labels
   on lines, column types, addresses, versions.
5. **Labels sit on their line.** No pill, no box. The line is opened under the label with the colour of the
   ground at that spot, so a label reads on any tint.
6. **A crossing is not a junction.** Where two lines cross, one is opened by a small gap. Where lines join, there
   is a ring.
7. **Group names are small capitals** with letter-spacing, in muted ink, followed by the caption in normal case.
8. **A KEY closes the sheet.** Under a rule, with the heading KEY. Node kinds are shown with their own icon, line
   kinds with their own dash, so the key works in greyscale.
9. **Corner marks show the sheet's extent.** Four small marks, nothing more. A full frame is for print.
10. **One accent.** Rust orange, for the rule and the classification of a title block. Step numbers are ink.
    The accent is never decoration.

Meaning is never carried by colour alone: kinds have their own icon, line types their own dash pattern (where two
styles of a type draw the same dash, the later one gets ticks, beads or a double line, the same in every diagram and in
the key), badges in the key carry the icon of their chips, and every
text colour passes WCAG AA (4.5:1) on the deepest tint it can land on. The ten inks were checked under
deuteranopia, protanopia and tritanopia simulation and spread in lightness so neighbours stay apart.

### The same sheet, other diagram types

![Survey, ERD](themes/png/survey-erd.png)

Every diagram type is drawn from the same tokens: tables, sequence diagrams, git graphs, roadmaps and matrices
use the paper tints, the capitals, the mono labels and the key.

### A framed sheet for documents that get printed

![Survey, framed](themes/png/survey-sheet.png)

```yaml
theme:
  extends: survey
  sheet: { marks: frame, zones: true }
  titleBlock: { client: Acme Corporation, project: Platform modernisation, version: v1.3, classification: Confidential, imprint: true }
```

The frame carries a zone grid ("the firewall in B3"), and the imprint sets the title block's fields as one line
beside the key. Only fields you gave are shown. A date is never made up.

## The built-in themes

| Theme | Picture | Pick it when |
| --- | --- | --- |
| `survey` (default) | ![survey](themes/png/survey.png) | Always, unless one of the reasons below applies. It is quiet enough to sit next to any corporate palette. |
| `survey-dark` | ![survey-dark](themes/png/survey-dark.png) | Dark slides, dashboards and screens. |
| `survey-cool` | ![survey-cool](themes/png/survey-cool.png) | The customer's deck is cold blue-grey and the warm paper looks out of place in it. |
| `transit` | ![transit](themes/png/transit.png) | The lines are the story: traffic flows, network paths, integrations. Thick routes cut at 45 degrees, round stations and flat grey zones read from across a room. Too loud for dense diagrams and heavy on ERDs. |
| `transit-dark` | ![transit-dark](themes/png/transit-dark.png) | The same, on a dark page. |
| `drafting` | ![drafting](themes/png/drafting.png) | Specifications, tenders and anything printed in black and white. Ink lines, square corners, monospace lettering, a frame with zones. Gives up most colour. |
| `drafting-dark` | ![drafting-dark](themes/png/drafting-dark.png) | A blueprint, for a title slide or a poster. |
| `classic` | ![classic](themes/png/classic.png) | Diagrams that must keep looking as they did before Survey: Inter, soft icon tiles, tone-washed groups, pill labels. |
| `classic-dark` | ![classic-dark](themes/png/classic-dark.png) | The same, dark. |
| `slate` | ![slate](themes/png/slate.png) | Formal consulting reports: navy and brass, tight corners. Built on Classic. |
| `ocean` | ![ocean](themes/png/ocean.png) | Product and marketing pages: bright, round. Built on Classic. |
| `mono` | ![mono](themes/png/mono.png) | Greyscale print with one accent. Built on Classic. |

`light` and `dark` are other names for `survey` and `survey-dark`.

Transit on a network, Drafting on a C4 container view:

![Transit](themes/png/transit-network.png)

![Drafting](themes/png/drafting-c4.png)

## Your own brand on top

A brand theme extends a built-in one and changes colours, font and title block. The Survey rules stay:

```yaml
# client.theme.yaml
extends: survey
colors: { primary: '#0B5FFF', accent: '#E4572E' }
font: { family: Space Grotesk, files: { 400: fonts/SpaceGrotesk-400.woff2, 600: fonts/SpaceGrotesk-600.woff2 } }
titleBlock: { logo: client-logo.svg, client: Client name }
```

Theme files written for the old default keep working. One that says `extends: light` now gets Survey underneath;
write `extends: classic` to keep the old base.

## The tokens

Survey is not special-cased in the renderer. It is a set of tokens any theme file can use, all described in
[themes.md](themes.md#the-look-what-a-theme-can-change-beyond-colour):

| Token | Survey | Transit | Drafting | Classic |
| --- | --- | --- | --- | --- |
| `font.family` | Instrument Sans | Barlow | IBM Plex Sans | Inter |
| `font.mono`, `font.monoFor` | Geist Mono for line labels and types | none | IBM Plex Mono for line labels, types and the title | none |
| `tile` | `bare` | `disc` | `outline` | `soft` |
| `group.tints` | three warm paper tints, hairline outline | three neutral greys, no outline | the page colour, ink outline only | a wash per tone |
| `group.label` | `caps` | `caps` | `caps` | `plain` |
| `edgeLabel` | `halo`, muted ink | `halo`, the line's ink, capitals | `plate` | `pill` |
| `lines.bridge`, `lines.junction` | 4 px gap, ring | no gap, large ring | 4 px gap, dot | no gap, dot |
| `lines.corner`, `lines.arrow` | `round`, `filled` | `chamfer`, `slim` | `square`, `open` | `round`, `filled` |
| `legendStyle` | `key` | `key` | `key` | `row` |
| `sheet` | `corners` | `none` | `frame` with zones and ticks | `none` |
| `tableHead` | `paper` | `paper` | `plain` | `tone` |
| `number` | `ink` | `ring` | `ring` | `solid` |
| `chip` | `fill` | `fill` | `outline` | `fill` |
| `background.dots` | no | no | yes | no |
| shadow | none | none | none | soft |

The fonts are bundled under the SIL Open Font License; see [themes.md](themes.md#fonts).

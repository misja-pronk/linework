# Coming from draw.io

draw.io (diagrams.net) is a canvas: you place every box and bend every line yourself, and the file remembers pixels. Cartography is the other way round: you say what is there and how it connects, and the layout is made for you. The two work together: Cartography reads draw.io files and writes them, so a diagram can go to a colleague who only has draw.io and come back.

## Bring your diagrams

```sh
carto import network.drawio                    # every page → network-<page>.yaml
carto import network.drawio --keep-positions   # keep the layout someone made, as pins
carto export network.yaml -o network.drawio    # an editable draw.io file back
```

In the editor: open or drop a `.drawio` file. The import panel shows the drawing, lets you pick pages and the *Keep the positions from draw.io* switch, and lists what was mapped and what was left out.

The type is guessed per page: shapes from the Azure, AWS, Google Cloud, Kubernetes or network stencils make an `azure`, `cloud`, `kubernetes` or `network` diagram, tables make an ERD, anything else an architecture (`systems`) diagram. Details in [interop.md](../interop.md#drawio).

## What maps to what

| draw.io | Cartography |
| --- | --- |
| A shape with text | a node; the stencil (`mxgraph.azure.app_services`) or the shape (cylinder, person, rhombus) gives the `kind` |
| A second line in a label | the node's `caption` |
| A container, swimlane, or a box drawn around others | a group, with `in:` on what is inside |
| A connector attached at both ends | an edge, with its label, dash and arrowheads |
| A table (`swimlane` with rows) | an ERD table; `PK`/`FK` marks and types come along |
| Pages | one diagram per page; on the way out, one page per view |
| Positions | laid out again, or kept as pins in `<name>.layout.json` with `--keep-positions` |
| Colours, fonts, sizes | not read: the theme decides |

## What you lose

- **Pixel control.** You cannot put a box at an exact spot by typing; you drag it in the editor and the place is kept next to the file, but the rest is laid out on rules.
- **Free drawing.** Loose text, arrows with a loose end, shapes without text, free lines and pictures are left out on import (and listed in the report).
- **Styling per shape**: colours, fonts and sizes come from the theme. A brand theme puts a client's colours, font and logo on everything at once ([themes.md](../themes.md)).
- **Everyone's familiarity.** draw.io needs no explanation; YAML does, for some readers. The editor's *Build visually* mode and draw.io export soften this.

## What you gain

- **Diffs that mean something.** A change is a line in a pull request, and `carto diff` draws what changed ([ci.md](../ci.md)). A draw.io XML diff is unreadable.
- **No more tidying.** Add a box and the lines re-route; the rest of the drawing stays where it was.
- **Consistency across a team**: every diagram in the same look, with a key, without a style guide to police.
- **Generated diagrams**: from Terraform, Azure exports, Kubernetes manifests, Entra and GitHub exports, so the drawing follows the real system.
- **The way back stays open.** `carto export -o x.drawio` writes real draw.io shapes, containers and attached connectors, not a picture.

# Other tools: draw.io, Excalidraw, Mermaid and Office

A diagram does not have to stay in Cartography. It goes out as a file another tool edits, and a drawing from another tool comes in as YAML. Every way out and in says what it could not carry, on stderr in the CLI and in a note in the editor; nothing is dropped without a word.

| | Out | In |
|---|---|---|
| draw.io (diagrams.net) | `carto export shop.yaml -o shop.drawio`, Export menu | `carto import shop.drawio`, open or drop in the editor |
| Excalidraw | `carto export shop.yaml -o shop.excalidraw`, Export menu | `carto import sketch.excalidraw`, open or drop in the editor |
| Mermaid | `carto export shop.yaml -o shop.mmd` (or `.md`, a fenced block), Export menu, Copy as Mermaid | `carto import shop.mmd` (see the README) |
| PowerPoint, Word, Keynote | `carto render shop.yaml --svg-safe [--outline-text]`, Office-safe SVG in the Export menu | |

## draw.io

**Out.** One `.drawio` file, uncompressed, that opens in draw.io (desktop, web, the VS Code extension) and stays editable:

- Every node is one shape with its label, caption and icon; a decision is a rhombus or hexagon, a terminal a pill, a person a round tile, as drawn.
- Every group is a container: drag it and its contents come along, drop a shape into it and it belongs there.
- Every line is a connector attached to the two shapes it joins (source and target set), with the route as waypoints and fixed points where it leaves and enters. It looks the same as in Cartography; move a shape and draw.io re-routes the line from there.
- An ERD table is a draw.io table: a swimlane that stacks its rows. A row is a column, with its marks (PK, FK) and type; relations run from row to row with crow's feet.
- A sequence diagram keeps its participants as shapes, the lifelines and frames behind them, and every message as a connector.
- Every view of the file is a page, named after the view. In the editor the export holds every view too.
- What each cell stands for (node `api`, kind `container-app`) is kept as data on the cell (draw.io: Edit Data), so the importer reads its own files back exactly.

Lost on the way: the theme's fonts if they are not installed (draw.io falls back to Helvetica or Arial), the numbered list of steps under the drawing, a theme's brand header and footer. Git flow and roadmap diagrams have no shapes to map to: they go in as one picture. A journey's curves and faces are small pictures that move and scale but cannot be edited point by point.

**In.** Compressed (deflate and base64, draw.io's default) and plain `.drawio` files, `.xml` exports, and a bare `<mxGraphModel>`. Every page becomes its own diagram (`shop-<page>.yaml`), and its type is guessed per page:

- shapes from the Azure, AWS, Google Cloud, Kubernetes or network stencil libraries make an Azure, cloud (with `provider: aws` or `gcp`), Kubernetes or network diagram, and the stencil names the kind (`mxgraph.azure.app_services` → `app-service`);
- tables (`swimlane` with rows, or `shape=table`) make an ERD; a column's `PK` and `FK` marks, its type, and relations between rows come along;
- anything else is an architecture (`systems`) diagram: the shape says the kind where it can (a cylinder is a database, a person a user, a rhombus a decision) and the label guesses the rest.

Containers, swimlanes and boxes drawn around other boxes become groups; connectors attached at both ends become edges, with their label, line (dashed, dotted) and arrowheads. A second line in a label becomes the caption.

`--keep-positions` (in the editor: *Keep the positions from draw.io*) keeps the layout the person made: every shape becomes a pin in `<name>.layout.json`, and the groups fit around them. Without it, Cartography lays the diagram out itself.

Left out, and said in the report: text that belongs to no shape, connectors with a loose end, shapes without text or icon, free lines and pictures, styling (colours, fonts, sizes).

## Excalidraw

**Out.** One `.excalidraw` file per drawing (Excalidraw has no pages; with `--all-views` a file per view). A node is a rectangle with its label bound to it, so it moves and resizes with the box; a caption is a second text grouped with its card. A line is an arrow bound to the two shapes it joins, an outer group a frame that carries its contents, an icon an embedded image. ERD tables are a header and a row of boxes per column; crow's feet use Excalidraw's own arrowheads.

Lost on the way: Excalidraw has one font size and colour per text and no letter-spacing, frames cannot nest (an inner group is a plain rectangle), the "zero or" circle of a crow's foot is not drawn, and the frame's name shows above it next to the group's own heading.

**In.** `.excalidraw` files and Excalidraw JSON. A box, ellipse or diamond with text (bound or lying on it) is a node, a frame or a box drawn around other boxes a group, an arrow bound to two shapes (or ending on them) a connection, with its label, line and arrowheads. Everything else is said in the report: loose text, arrows with a loose end, shapes without text, freehand drawings and pictures. A deleted element stays deleted. `--keep-positions` works as for draw.io.

## Mermaid

**Out.** Text for a README on GitHub or GitLab, a wiki or anything else that draws Mermaid: what is in the drawing, not where it stands.

| Cartography | Mermaid |
|---|---|
| architecture, C4, Azure, cloud, Kubernetes, network, GitHub, access (an access matrix is left out) | `flowchart`, groups as subgraphs, lines with their label and style (dashed, dotted, thick) |
| ERD | `erDiagram` with columns, PK/FK/UK, and relations with their cardinality |
| sequence | `sequenceDiagram`: participants, messages, notes, alt/opt/loop/par frames |
| git branching | `gitGraph` |
| roadmap | `gantt` (dated) or `timeline` (now / next / later) |
| journey | `journey` |

Lost: captions, icons and colours (Mermaid draws a box with its label); schemas of an ERD; participant captions; deployments and pipelines of a git diagram; phases, lanes and dependencies of a roadmap; thoughts, pains and the blueprint rows of a journey. Each is named in a warning. The test suite exports every graph, ERD and sequence example and reads it back with Cartography's Mermaid importer: the same nodes, groups, tables and messages come back.

## Office-safe SVG

PowerPoint, Word and Keynote take an SVG, but drop or misdraw much of what a browser draws: style sheets, CSS variables, filters, markers, `foreignObject`, web fonts. `--svg-safe` (in the editor: the *Office-safe SVG* switch in the Export menu, remembered) writes the same drawing without them:

- every style is a presentation attribute (`fill="…"`), variables become their value;
- no filters, patterns, gradients, clip paths, masks, markers or links; shadows and the dot grid go;
- text is in Arial (or Courier New for code), which every machine has;
- one group per node and per line, so *Ungroup* in PowerPoint gives shapes you can recolour.

`--outline-text` goes one step further: every word becomes a path in the theme's own font, so the drawing looks exactly as in Cartography on any machine. The text can then no longer be edited or searched.

## In the editor

- **Export**: draw.io, Excalidraw, Mermaid (.mmd) and Copy as Mermaid (a fenced block) are in the Export menu and the command palette. What a format could not hold is said in a note when the file is saved.
- **Import**: *Open file…* (`⌘O`) or a file dropped anywhere on the window. A Cartography YAML file opens; a `.drawio`, `.excalidraw` or `.mmd` file goes to the Import panel of the start dialog, which shows the drawing, the pages to choose from, the switch to keep the positions, and the report. *Import from Mermaid, draw.io or Excalidraw* on the start dialog does the same for pasted text or a chosen file. Everything is read in the browser; nothing is sent anywhere.

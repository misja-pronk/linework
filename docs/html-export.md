# Interactive HTML

One `.html` file to send a customer instead of a PNG: every view and every step of a diagram, or a whole folder of
them, with pan and zoom, a presenter, drill-down between C4 levels, search, and what each element is. It opens from
disk in Chrome, Safari, Firefox and Edge, needs no install and no hosted app, and asks the network for nothing.

## Making one

- In the editor: **Export → Interactive HTML (.html)**. With a folder open, the command palette (⌘K) also has
  *Interactive HTML of &lt;folder&gt;*.
- On the command line:

  ```sh
  carto export-html shop.yaml -o shop.html          # one diagram, and the diagrams of its folder it drills into
  carto export-html architecture/ -o harbour.html   # the whole folder, with a contents page
  ```

  | Option | |
  | --- | --- |
  | `-o out.html` | where to write it; by default next to the diagram (`shop.html`) or the folder (`architecture.html`) |
  | `--notes` | the **open** review notes of `<name>.notes.json`: numbered markers and a Notes panel. Off by default; resolved notes are never in the file |
  | `--decisions` | the folder's architecture decisions: a Decisions page, a page per decision, markers on the drawings and the decisions about an element in its details. Off by default; see [decisions.md](decisions.md) |
  | `--title "…"` | the page's title; by default the model's title, or the diagram's |
  | `--all-steps` | also the steps nobody wrote (a dynamic view's numbered lines, a sequence's messages) |
  | `--theme`, `--icons`, `--pack` | as for `carto render` |

  It exits 1 when a diagram has errors (the others are still written).

A single diagram brings along what it leads to: the views of its own file, and the diagrams **in the same folder**
that its elements link to (`links:`) or drill into (a system in a context view opens its container view). So
`carto export-html context.yaml` carries the containers too; a link to a diagram that is not there stays a name in
the details panel.

## What the reader gets

- **The drawing**, as Cartography draws it, fitted to the window. Two fingers or a drag move it, a pinch or
  ⌘/Ctrl + scroll zooms, the buttons at the bottom right do the same, and so do `+` `−` `0` (fit) `1` (actual size)
  and the arrow keys with ⇧.
- **Views**: the sidebar lists every diagram and its views; `[` and `]` go to the previous and next one. A folder
  opens on a **contents page**: a card per diagram with its views, and an index of every element with its kind,
  technology, owner and the drawings it is in.
- **Details on click**: kind, description, technology, owner, tags, the fields the YAML gives it, what it is part
  of, its web links, and **where it appears** (each drawing, one click away, with the element ringed there).
- **Drill-down**: double-click an element (or ↵, or *Open …* in its details) to go to the view a level down, or to
  what its link names. Breadcrumbs above the drawing go back up; ⌫ and the browser's back button retrace the way.
  A deployment node that runs a model element links to the model.
- **Steps**: a drawing with `steps:` has a bar at the bottom with the step's title and caption; ← and → go
  through them and on to the next view. **Present** (`P`) goes full screen and walks every step of every view; a click
  goes on, a click on the left third goes back, Esc stops.
- **Search** (`/` or ⌘K): elements by name, id, kind, technology, owner, tag or description, and views by name.
  ↵ opens the element where it is drawn.
- **Light and dark** follow the system; `D` or the contrast button switches, and switching back to what the system says
  follows the system again. Every drawing is in the file in both looks (a brand theme only once, it is its own look).
- **Print** (⌘P or the printer button): a page per drawing, A4 landscape, always light, with the contents in front for
  a folder. *Save as PDF* in the print dialog gives a handout.
- `?` lists the keys.

## How it is built

Everything is drawn when the file is made, not when it is opened: each view in the light and the dark look and each
written step. The viewer in the page only puts the right SVG on the sheet, so the file needs no engine, opens at
once and looks exactly like the export it came from.

- The drawings, what each shape stands for and the element index are JSON, gzipped and base64'd into one data
  block. Official icons that repeat are stored once and put back by the viewer.
- The fonts (the theme's bundled faces, latin subsets as woff2, and a brand theme's own font files) are in the
  stylesheet as `data:` URIs.
- The viewer is a small script (about 35 kB, `packages/html-export/src/viewer/main.ts`, built into
  `src/generated/viewer.ts` by `node packages/html-export/build.mjs`).

Sizes, measured on the examples:

| | drawings | file |
| --- | --- | --- |
| `examples/systems/web-shop.yaml` | 1 | 246 kB |
| `examples/systems/invoice-walkthrough.yaml` | 1 and 7 steps | 254 kB |
| `examples/workspace` (folder) | 14 | 273 kB |
| an Azure import of 129 resources, 123 cards | 1 | 291 kB |

About 200 kB of that is the fonts; each drawing adds a few kB.

## Safety

The file is static. It carries a Content-Security-Policy that allows exactly its own stylesheet and script (by hash),
`data:` images and fonts, and nothing else: no requests, no other scripts, no `eval`. Everything taken from the YAML
is text: the viewer only ever sets `textContent`, SVGs are parsed as XML and cleaned to the elements and attributes
the renderer draws with, and links leave the page only for `http`, `https` and `mailto`, in a new tab, without a
referrer. Review notes are left out unless asked for, and resolved ones always.

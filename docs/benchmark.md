# Layout benchmark

The same ten diagrams drawn by Cartography, Mermaid and D2 (with its three layout engines: dagre, ELK and TALA), and measured from each tool's own SVG in the same way. Then one shape and one line are added to each, and each tool draws it again, to see how much of the drawing moves. The script is in the repository and runs offline: `pnpm bench`.

Nothing here is picked to look good. The cases where Cartography loses are listed first under the results, and they stay in when the numbers change.

<!-- charts -->

## What is measured

| Measure | How | Better |
| --- | --- | --- |
| Crossings | Two different lines cross. Places within 6 px of either line's end do not count (that is where lines meet at a shape), and neither do places where two lines run on one track and part, such as a trunk that splits at a junction. | Fewer |
| Touching lines | Two lines that share no end come within 4 px of each other away from any crossing: a reader cannot tell which way each one goes. | Fewer |
| Bends | Sharp changes of direction: turning of 25° or more within 24 px of line. A rounded corner counts once; a gentle curve not at all. | Fewer |
| Turning | How many degrees a line turns from start to end, summed along it: 90 for a right angle, the sweep of a curve, both turns of an S. Fair to curved and to square routing alike. | Less |
| Label overlaps | A label on a line overlaps another line label or a shape (by more than 4 px², after shrinking both by a pixel). | Fewer |
| Lines through shapes | A line passes through a shape (shrunk by 3 px) that is not one of its ends. | Fewer |
| Line length | Mean line length, in shape sizes (the square root of the median shape area), so tools with larger fonts are not punished for it. | Shorter |
| White space | The area of the box around shapes, lines and line labels (not the title or the legend) over the total area of the shapes. | Lower is tighter; very low can mean cramped |
| Aspect | Width over height of that box. A 16:9 slide is 1.78. | Close to where it goes |
| Movement after an edit | One shape and one line are added (below). Shapes are matched by id. The whole drawing is slid back by the mean shift first, so growing on one side does not count; what is left is the mean distance a shape moved, as a share of the diagonal of the drawing before. | Lower |

## How

1. **Sources.** Each case is written once in Mermaid and once in D2 by hand (`docs/comparison/src` and `docs/benchmark/src`), saying the same thing: the same shapes, the same lines, the same groups and labels. Cartography gets the Mermaid source through `carto import`, untouched, the way someone coming from Mermaid would start. Nobody tuned the Cartography YAML.
2. **Drawing.** Mermaid is the npm package with its default configuration, rendered in headless Chromium. D2 is the `d2` binary with `--layout dagre`, `elk` and `tala`, default theme. Cartography is the engine at this commit, default theme.
3. **Reading the SVG.** Each SVG is put in a page at its natural size and reduced to boxes and lines in the browser itself: a shape is a node's bounding box (Mermaid `g.node`, D2 objects that hold no other objects, Cartography `[data-node]`); a line is the drawn path sampled every 3 px with `getPointAtLength`, arrowhead excluded; a line label is the text on a line. Groups (subgraphs, D2 containers, Cartography groups) are not shapes. The numbers come from `docs/site/src/geometry.ts`, which has tests of its own.
4. **The edit.** One line appended to each source: for example `orders --> audit[Audit log]` in Mermaid, `audit: Audit log` and `platform.orders -> audit` in D2. Every tool draws the edited source from scratch. Cartography is also drawn a second time knowing the drawing before, as its editor and `carto render --stable` do, and that number is shown apart from the others, since no other tool here has such a mode.

The cases: an order platform with two groups, an analytics pipeline in four groups, a leave request in lanes, a sign-in flow with decisions and a loop, a serverless architecture with nested groups, a database schema, a state machine with a composite state, a dense publish-subscribe mesh, a cloud network with three levels of nesting, and a delivery pipeline with two loops back. Sequence diagrams, Gantt charts and git graphs are left out: they are not laid out as a graph, so these measures say nothing about them.

## Limits

- **Ten diagrams is a small set**, of a size people draw by hand (6 to 16 shapes). Large generated diagrams behave differently.
- **These measures are not readability.** A drawing with no crossings can still be hard to read. The pictures are below every table so you can judge for yourself.
- **Different tools draw different things.** Cartography adds a title block and a legend (KEY), which the area does not count. Mermaid's state diagram draws a note; D2 draws the same note as a shape. The shapes are matched per tool, not across tools.
- **Reading another tool's SVG is a guess at its structure.** The selectors are listed above; a future Mermaid or D2 version that changes its markup can break them. The script fails loudly when it finds no shapes.
- **Crossings at a very shallow angle** (under about 10°) are seen as two lines on one track and are not counted, for every tool alike.
- **TALA** is D2's proprietary layout engine. It runs without a licence key for evaluation; its results here are what that build gives. It also moves the most after an edit: it is not designed to be stable from one run to the next.
- **PlantUML is not measured.** It needs Java and the PlantUML jar; when `plantuml` is on the PATH the script says so and still skips it, since there are no PlantUML sources or SVG reader yet. Contributions welcome.
- **Fonts.** Mermaid and D2 use their own fonts at 16 px; Cartography uses Instrument Sans at 13.5 px. Line length is in shape sizes for this reason, but white space still depends on how big each tool draws its text inside a shape.

## Results

<!-- results:start -->

### Where Cartography loses

- **Event mesh**, crossings: Cartography 6; Mermaid 2, D2 · dagre 3, D2 · ELK 3, D2 · TALA 5
- **Cloud platform**, crossings: Cartography 3; Mermaid 1, D2 · dagre 2, D2 · ELK 1
- **Leave request**, white space (area per shape area, more than 1.5 more): Cartography 6.4; Mermaid 3.6
- **Sign-in flow**, white space (area per shape area, more than 1.5 more): Cartography 6.5; Mermaid 2.6, D2 · dagre 4.3, D2 · ELK 4.5, D2 · TALA 4.0
- **Event mesh**, white space (area per shape area, more than 1.5 more): Cartography 5.7; D2 · ELK 3.5
- **Event mesh**, movement after the edit, from scratch (more than 5 points more): Cartography 19.6 %; Mermaid 3.5 %, D2 · dagre 0.8 %
- **Cloud platform**, movement after the edit, from scratch (more than 5 points more): Cartography 19.6 %; Mermaid 11.4 %, D2 · dagre 2.7 %, D2 · ELK 5.8 %
- **Very wide drawings** that will not fit a slide or a page without shrinking: Order lifecycle (9.9 : 1), Event mesh (4.0 : 1)

Generated 2026-11-10 with Mermaid 12.3.0 and D2 v0.9.0. Best value per row in bold (lower is better everywhere).

### Edge crossings

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | **0** | **0** | **0** | **0** | **0** |
| Analytics platform | **0** | **0** | **0** | **0** | **0** |
| Leave request | **0** | **0** | **0** | **0** | **0** |
| Sign-in flow | **0** | **0** | **0** | **0** | **0** |
| Photo uploads | **0** | 2 | 1 | **0** | **0** |
| Shop schema | **0** | **0** | **0** | **0** | **0** |
| Order lifecycle | **0** | 1 | 1 | **0** | **0** |
| Event mesh | 6 | **2** | 3 | 3 | 5 |
| Cloud platform | 3 | **1** | 2 | **1** | 3 |
| Delivery pipeline | **0** | **0** | **0** | **0** | **0** |
| **Total** | 9 | 6 | 7 | 4 | 8 |

### Unrelated lines touching (they meet and part on one track)

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | **0** | **0** | **0** | **0** | **0** |
| Analytics platform | **0** | **0** | **0** | **0** | **0** |
| Leave request | **0** | **0** | **0** | **0** | **0** |
| Sign-in flow | **0** | **0** | **0** | **0** | **0** |
| Photo uploads | **0** | 1 | **0** | **0** | **0** |
| Shop schema | **0** | **0** | **0** | **0** | **0** |
| Order lifecycle | **0** | **0** | **0** | **0** | **0** |
| Event mesh | **0** | **0** | **0** | **0** | **0** |
| Cloud platform | **0** | **0** | **0** | **0** | **0** |
| Delivery pipeline | **0** | **0** | **0** | **0** | **0** |
| **Total** | 0 | 1 | 0 | 0 | 0 |

### Bends

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | 20 | 32 | **1** | 26 | 10 |
| Analytics platform | 11 | 20 | 10 | 12 | **8** |
| Leave request | 5 | 16 | **0** | 16 | **0** |
| Sign-in flow | 5 | 20 | 2 | 8 | **1** |
| Photo uploads | 8 | **0** | 1 | 12 | 2 |
| Shop schema | 4 | 8 | **0** | 8 | 4 |
| Order lifecycle | 11 | 28 | **3** | 19 | 8 |
| Event mesh | 20 | 42 | **1** | 22 | 12 |
| Cloud platform | 17 | 32 | **5** | 18 | **5** |
| Delivery pipeline | 13 | 24 | **1** | 20 | 11 |
| **Total** | 114 | 222 | 24 | 161 | 61 |

### Turning per line, degrees (a right angle is 90, a curve counts its sweep)

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | 120 | 192 | **25** | 156 | 60 |
| Analytics platform | 82 | 150 | 65 | 90 | **60** |
| Leave request | 50 | 154 | 13 | 159 | **0** |
| Sign-in flow | 41 | 155 | 40 | 65 | **8** |
| Photo uploads | 80 | **0** | 28 | 120 | 20 |
| Shop schema | 72 | 144 | **28** | 144 | 72 |
| Order lifecycle | 81 | 194 | **35** | 131 | 55 |
| Event mesh | 112 | 231 | **31** | 124 | 67 |
| Cloud platform | 109 | 198 | 38 | 116 | **32** |
| Delivery pipeline | 73 | 132 | **20** | 112 | 61 |

### Line labels overlapping a label or a shape

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | **0** | **0** | **0** | **0** | **0** |
| Analytics platform | **0** | **0** | **0** | **0** | **0** |
| Leave request | **0** | **0** | **0** | **0** | **0** |
| Sign-in flow | **0** | **0** | **0** | **0** | **0** |
| Photo uploads | **0** | **0** | **0** | **0** | **0** |
| Shop schema | **0** | **0** | **0** | **0** | **0** |
| Order lifecycle | **0** | **0** | **0** | **0** | **0** |
| Event mesh | **0** | **0** | **0** | **0** | **0** |
| Cloud platform | **0** | **0** | **0** | **0** | **0** |
| Delivery pipeline | **0** | **0** | **0** | **0** | **0** |
| **Total** | 0 | 0 | 0 | 0 | 0 |

### Lines passing through a shape that is not one of their ends

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | **0** | **0** | 2 | **0** | **0** |
| Analytics platform | **0** | **0** | **0** | **0** | **0** |
| Leave request | **0** | **0** | **0** | **0** | **0** |
| Sign-in flow | **0** | **0** | **0** | **0** | **0** |
| Photo uploads | **0** | 2 | 1 | **0** | **0** |
| Shop schema | **0** | **0** | **0** | **0** | **0** |
| Order lifecycle | **0** | **0** | **0** | **0** | **0** |
| Event mesh | **0** | **0** | **0** | **0** | **0** |
| Cloud platform | **0** | **0** | 2 | **0** | **0** |
| Delivery pipeline | **0** | **0** | **0** | **0** | **0** |
| **Total** | 0 | 2 | 5 | 0 | 0 |

### Mean line length, in shape sizes

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | 1.81 | 4.04 | 3.03 | 4.39 | **1.80** |
| Analytics platform | 2.63 | **2.62** | 4.49 | 3.56 | 4.22 |
| Leave request | 1.74 | 2.37 | 2.85 | 6.51 | **1.55** |
| Sign-in flow | 2.21 | 2.43 | 2.16 | 2.64 | **1.09** |
| Photo uploads | **2.03** | 2.52 | 3.66 | 3.11 | 3.04 |
| Shop schema | 1.47 | 1.06 | **1.02** | 1.24 | 1.10 |
| Order lifecycle | 3.39 | 3.94 | 5.45 | 3.97 | **1.55** |
| Event mesh | 3.26 | 3.58 | 3.63 | **3.03** | 3.99 |
| Cloud platform | **3.11** | 3.93 | 3.92 | 4.54 | 3.17 |
| Delivery pipeline | 3.29 | 2.96 | 3.50 | 3.39 | **1.99** |

### Area per shape area (white space; lower is tighter)

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | **6.3** | 7.6 | 13.7 | 7.9 | 10.6 |
| Analytics platform | 5.7 | **5.6** | 13.7 | 6.6 | 11.4 |
| Leave request | 6.4 | **3.6** | 7.5 | 7.9 | 10.1 |
| Sign-in flow | 6.5 | **2.6** | 4.3 | 4.5 | 4.0 |
| Photo uploads | 4.4 | 6.7 | 6.3 | **4.3** | 7.7 |
| Shop schema | 2.8 | **2.4** | 3.0 | 2.9 | 3.2 |
| Order lifecycle | 8.4 | 13.0 | 25.8 | 10.5 | **7.4** |
| Event mesh | 5.7 | 6.3 | 8.2 | **3.5** | 5.6 |
| Cloud platform | 7.3 | **6.9** | 14.2 | 8.2 | 16.5 |
| Delivery pipeline | 4.7 | **3.8** | 6.7 | 4.7 | 8.2 |

### Displacement after adding one shape and one line, % of the diagonal (drawn from scratch)

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | **0.7** | 8.6 | 1.8 | 8.1 | 27.8 |
| Analytics platform | 3.2 | 4.6 | 3.7 | **2.1** | 10.2 |
| Leave request | 0.5 | **0.0** | **0.0** | 0.2 | 27.1 |
| Sign-in flow | **0.0** | **0.0** | **0.0** | **0.0** | 30.8 |
| Photo uploads | 0.2 | 3.2 | **0.0** | **0.0** | 41.4 |
| Shop schema | **0.0** | 2.3 | 5.9 | 1.7 | 34.3 |
| Order lifecycle | 1.1 | **0.7** | 3.9 | 1.0 | 40.8 |
| Event mesh | 19.6 | 3.5 | **0.8** | 21.1 | 17.9 |
| Cloud platform | 19.6 | 11.4 | **2.7** | 5.8 | 24.0 |
| Delivery pipeline | **0.0** | 0.8 | 0.4 | 0.8 | 5.4 |

Cartography also keeps the drawing before the edit in mind when it can (the editor does, and `carto render --stable`). Drawn that way, the same edits move the shapes that were there by:

| Case | From scratch | Knowing the drawing before |
| --- | ---: | ---: |
| Order platform | 0.7 % | 0.0 % |
| Analytics platform | 3.2 % | 0.0 % |
| Leave request | 0.5 % | 0.5 % |
| Sign-in flow | 0.0 % | 0.0 % |
| Photo uploads | 0.2 % | 0.2 % |
| Shop schema | 0.0 % | 0.0 % |
| Order lifecycle | 1.1 % | 1.1 % |
| Event mesh | 19.6 % | 0.0 % |
| Cloud platform | 19.6 % | 0.0 % |
| Delivery pipeline | 0.0 % | 0.0 % |

### Aspect ratio (width / height; a 16:9 slide is 1.78)

| Case | Cartography | Mermaid | D2 · dagre | D2 · ELK | D2 · TALA |
| --- | ---: | ---: | ---: | ---: | ---: |
| Order platform | 3.53 | 3.34 | 2.24 | 3.99 | 1.45 |
| Analytics platform | 0.72 | 0.59 | 0.60 | 0.40 | 0.77 |
| Leave request | 3.05 | 7.07 | 5.63 | 6.20 | 1.42 |
| Sign-in flow | 0.79 | 0.17 | 0.24 | 0.22 | 0.48 |
| Photo uploads | 0.49 | 1.44 | 5.93 | 6.82 | 1.09 |
| Shop schema | 1.54 | 0.90 | 1.73 | 2.11 | 1.58 |
| Order lifecycle | 9.87 | 5.13 | 4.84 | 7.54 | 0.86 |
| Event mesh | 4.05 | 3.76 | 3.19 | 2.02 | 1.52 |
| Cloud platform | 0.73 | 0.36 | 0.61 | 0.25 | 0.60 |
| Delivery pipeline | 1.92 | 8.27 | 6.85 | 9.55 | 2.71 |

Not measured:

- plantuml: PlantUML is not installed here (it needs Java and the plantuml jar); not measured

<!-- results:end -->

## The drawings

Every drawing that was measured, before the edit. Click a case to open it.

<!-- drawings -->

## Run it yourself

```sh
pnpm install
pnpm bench                  # every case, every tool found; d2 is optional (brew install d2)
pnpm bench event-mesh       # one case
```

It writes `docs/benchmark/results.json`, the tables on this page and the pictures in `docs/benchmark/png`. The site build (`pnpm docs:build`) draws the charts from the JSON. A new case is a `.mmd` file, a `.d2` file and an entry in `CASES` in `docs/site/src/bench.ts` with the one line each that adds a shape.

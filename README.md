# Cartography

Architecture diagrams that look good: write a short YAML file or build the diagram interactively from a template, and get a clean, consistent drawing.

Diagram types: architecture, C4, Azure, AWS and Google Cloud, Kubernetes, network, database (ERD), roles / groups / access packages, GitHub, data products (with ports and data contracts), sequence, git branching, roadmap and journey map. Not sure which one you need? See [Which diagram type do I need?](docs/types.md)

Status: early development. See [docs/requirements.md](docs/requirements.md).

## The editor

```sh
pnpm install
pnpm web          # → http://localhost:5178
pnpm web:build    # static app in packages/web/dist, runs from any folder, offline
```

YAML on the left, the drawing on the right; both stay in sync and select the same element.

- **Start** by picking what you want to draw: a card per type says what it is for and what it is not for, and a search box ranks the types by your words ("who has access", "tables and keys"). Then a template, then how to work: **Describe it** (a few questions become a prompt; Claude drafts the diagram with your own API key, checked by the engine and fixed automatically — or copy the prompt into any chat), **Build visually** (shapes panel, no YAML; `⌘\` switches) or **Write YAML**. Or paste a Mermaid diagram (flowchart, architecture-beta, erDiagram, sequenceDiagram) and get it back as Cartography. Open a folder of diagrams to edit files in place (Chrome/Edge).
- **Write** with autocomplete from each type's schema; problems show on the right line, and the last good drawing stays while you type.
- **Build** without YAML: add shapes from the palette (`A`, or drag them onto the drawing and into a group), edit them in the inspector, drag from the dot on an element to connect it, rename with every reference following.
- **Select** several with shift-click or a marquee, `⌘C`/`⌘V` copy and paste, double-click to rename in place.
- **Arrange**: drag elements or whole groups; positions are saved next to the diagram as `<name>.layout.json`, lines follow, nothing lands on top of something else.
- **Undo** everything with `⌘Z`: typing, builder edits and moves share one history.
- **Export** SVG, PNG, a 16:9 slide, or copy as PNG for slides and docs. `?` shows every shortcut.

Diagrams look better than the usual tools: lines that share a path are spaced evenly or merge into a trunk, labels stay off group borders, supporting links (Key Vault, logging) can be badges on the card instead of lines (`badges: [identity]`). See [docs/comparison](docs/comparison/README.md) for Mermaid and D2 side by side.

**A look of its own**: the default style, Survey, draws a diagram as a map sheet: paper tints that deepen as groups nest, bare icons, labels set on the lines, a key. Transit and Drafting are built in as alternatives, and a theme file puts a client's colours, font and logo on top. See [docs/style.md](docs/style.md) and [docs/themes.md](docs/themes.md).

![Survey](docs/themes/png/survey-azure.png)

**One model, many diagrams**: describe systems once in a `type: model` file, `include:` it in a context, container or Azure deployment diagram and reference elements by id (`api: { ref: shop.api, kind: container-app }`); `views:` pick what each drawing shows (`expand: [shop]`, `'* -> shop'`, `tag:external`), and `links:` drill down from a box to its detailed diagram, as real links in exported SVG. See [docs/model.md](docs/model.md) and [examples/model](examples/model).

**What runs where, per environment**: a node in an Azure, AWS, Google Cloud or Kubernetes diagram says which part of the model it runs (`api: { of: shop.api, kind: ecs-service, env: prod }`); a view per environment draws production, test and dev from one file, and `complete: true` warns about parts that run nowhere. `carto import plan.json` reads Terraform state or plan JSON. See [docs/model.md](docs/model.md), [examples/deployment](examples/deployment) and [examples/cloud](examples/cloud).

**A data mesh from the files you have**: `carto render mesh/ -o mesh.svg` draws a folder of data product and data contract files (ODPS, ODCS) as one map: products per domain, their ports, what reads what, and the keys between contracts (ODCS 3.1 `relationships`). Running it again keeps what you changed by hand. **Focus** cuts any drawing of boxes and lines down to one thing and what is around it: `focus: { on: revenue, hops: all, direction: upstream }`, `carto render --focus revenue --hops 2`, or `F` in the editor. See [docs/data-products.md](docs/data-products.md).

![A folder of ODPS and ODCS files as one map](docs/data-products/mesh.png)

**Steps and presenting**: `steps:` tells a drawing in parts (`- customer -> web -> api: The order comes in`), with what is shown, what stands out and the sentence you say. Press `P` to present it full screen, or export it: one slide per step in PowerPoint, one page per step in PDF, with every shape in the same place. See [docs/steps.md](docs/steps.md).

CLI: `carto import diagram.mmd` turns Mermaid (or Markdown with mermaid blocks) into Cartography YAML.

**In CI and pull requests**: `carto validate` checks diagrams (`--drift` finds saved positions for things that are gone), `carto diff` shows what changed between two versions as a list and as a marked-up picture, and a GitHub Action puts that picture in one comment on the pull request. An edit keeps the rest of the drawing where it was (`carto render --stable`). See [docs/ci.md](docs/ci.md).

AI assistants: an MCP server (`cartography-mcp`) and an agent skill let Claude Code, Claude Desktop and other MCP clients write diagrams that are checked against the schema and scored for layout quality before you see them. See [docs/mcp.md](docs/mcp.md).

## In your docs

Keep the diagram as YAML next to the docs and let the site draw it. A remark plugin (Docusaurus, Astro, MDX) and a markdown-it plugin (VitePress, Eleventy) turn a fenced `cartography` block or `![Web shop](./shop.yaml)` into plain SVG while the site builds, a light and a dark one: no headless browser, no build server. `<carto-diagram src="shop.yaml">` draws in the reader's browser instead and adds zoom, pan and drill-down into linked diagrams; `carto embed shop.yaml` writes one HTML file with all of it. See [docs/embed.md](docs/embed.md) and the working sites in [examples/docs](examples/docs) (Docusaurus, VitePress, MkDocs, a plain page).

## Try it

```sh
mise install            # Node 24 + pnpm (or bring your own)
pnpm install
pnpm carto types                                  # which type for what (add words to rank them)
pnpm carto new azure my-infra.yaml                # start from a template
pnpm carto render my-infra.yaml -f png -t dark    # → my-infra.png
pnpm carto themes                                 # the built-in themes: survey (default), transit, drafting…
pnpm carto render examples/model/containers.yaml --all-views   # one SVG per view
pnpm gallery                                      # render all examples → gallery/out/index.html
pnpm test
pnpm lab                                          # layout quality per example, variants side by side
```

Fonts: Instrument Sans, Geist Mono, Barlow, IBM Plex Sans, IBM Plex Mono and Inter (all SIL OFL 1.1; licence texts in `packages/theme/fonts`). Icons: Lucide (ISC). Node placement: Graphviz dot (EPL) via @hpcc-js/wasm-graphviz (Apache-2.0); lines are drawn by our own router.

# Cartography

Architecture diagrams that look good: write a short YAML file or build the diagram interactively from a template, and get a clean, consistent drawing.

Status: early development. Docs: [get started](docs/getting-started.md), [the glossary](docs/glossary.md) (the words the app, docs and CLI use), [which diagram type do I need?](docs/types.md), and the docs site (`pnpm docs:build`, then `pnpm docs:serve`; the pages also open from disk, offline) with a gallery of every template and example, light and dark.

## Try it

```sh
mise install && pnpm install                      # Node 24 + pnpm (or bring your own)
pnpm carto new azure shop.yaml                    # start from a template (pnpm carto types: which type for what)
pnpm carto render shop.yaml -o shop.png           # → shop.png (also .svg, .pptx, .pdf)
pnpm carto export shop.yaml --to html             # one interactive HTML file to send
pnpm web                                          # the editor → http://localhost:5178
```

`pnpm carto --help` lists every command in five groups (Create, Draw, Export, Check, Look); `carto <command> --help` puts the common options first.

![Survey](docs/themes/png/survey-azure.png)

## What's in it

The editor: YAML and the drawing side by side (or the **Builder**, no YAML), always in sync. `?` shows every key.

| Feature | Key or command | More |
| --- | --- | --- |
| Start from a type, a template, a wizard or Claude | **New**, `carto new [--wizard …]` | [wizards](docs/wizards.md), [ai](docs/ai.md) |
| Add, connect, rename, move (positions in `<name>.layout.json`) | `A`, `C`, `F2`, drag | [getting started](docs/getting-started.md) |
| Tidy the layout, pins stay | `T` | [style](docs/style.md) |
| Steps: tell a drawing in parts, present it | `S`, `P` | [steps](docs/steps.md) |
| Focus: one thing and what is around it | `F`, `carto render --focus x` | [data products](docs/data-products.md) |
| Layers: a security, data or phase-2 view of one file | `L`, `carto render --layer x` | [layers](docs/layers.md) |
| Transitions: as-is, stages and to-be in one file; each stage, the changes, a roadmap | `,` `.`, `carto stages`, `carto render --stage q2` | [transitions](docs/transitions.md) |
| Trace a request, as a sequence diagram | `⇧Q`, `carto trace f.yaml --from a --to b` | [trace](docs/trace.md) |
| Review notes on elements, lines and spots | `N`, `⇧N`, `carto notes` | [notes](docs/notes.md) |
| Architecture decisions (ADRs) on the drawing | `⇧D`, `⌥⇧D`, `carto decisions` | [decisions](docs/decisions.md) |
| Blocks: reusable patterns with parameters | `B`, `⇧B`, `carto blocks` | [blocks](docs/blocks.md) |
| Compare with an earlier version or a snapshot | `⇧⌘D`, `carto diff` | [compare](docs/compare.md) |
| Ask Claude for a change (your own API key) | `⌘J` | [ai](docs/ai.md) |
| One model, many diagrams; a folder as one model | `⌘P`, `⌘↓`, `⌘↑`, `⇧F2` | [model](docs/model.md), [workspace](docs/workspace.md) |
| Architecture review: rule packs, findings by pillar, fixes | `⇧W`, `carto review` | [review](docs/review.md) |
| Threat models, trust boundaries, STRIDE | `carto threats`, `--view threats` | [threats](docs/threats.md) |
| Animate steps or layers (GIF, MP4, WebM) | Export → Animation, `carto animate` | [animate](docs/animate.md) |
| Describe a diagram in plain words | Export → Describe in words, `carto describe` | [describe](docs/describe.md) |
| One interactive HTML file to send | Export → Interactive HTML, `carto export --to html` | [html export](docs/html-export.md) |
| Wiki pages: Markdown, Confluence | `carto export --to md\|confluence` | [wiki export](docs/wiki-export.md) |
| PowerPoint and PDF, a slide per step; a client's template | Export, `carto deck` | [powerpoint templates](docs/powerpoint-templates.md) |
| Diagrams from a repository's code (Compose, Helm, Bicep, OpenAPI, AsyncAPI, workflows) | ⌘K → Diagrams from the code, `carto import .` | [repo import](docs/repo-import.md) |
| draw.io, Excalidraw, Mermaid, both ways | `carto export --to drawio`, `carto import` | [interop](docs/interop.md) |
| A share link (the diagram travels in the `#fragment`) | Export → Copy share link, `carto share` | [share](docs/share.md) |
| Themes, a client's colours and logo, vendor icons | **Theme**, `carto themes`, `carto icons` | [themes](docs/themes.md), [icons](docs/icons.md) |
| Checks and picture diffs in CI and pull requests | `carto validate`, `carto diff`, the GitHub Action | [ci](docs/ci.md) |

**Diagram types**: architecture, C4, Azure, AWS and Google Cloud, Kubernetes, network, database (ERD), roles / groups / access packages, GitHub, data products (ports and data contracts), sequence, git branching, roadmap, journey map, process, states, capability map (with heatmaps), teams (org chart and Team Topologies), DDD context map, matrix (RACI, CRUD), UML class diagram and mind map.

**A look of its own**: the default style, Survey, draws a diagram as a map sheet: paper tints that deepen as groups nest, bare icons, labels on the lines, a key. Lines that share a path are spaced evenly or merge into a trunk; supporting links (Key Vault, logging) can be badges on the card. Transit, Drafting and a hand-drawn Sketch are built in. See [style](docs/style.md), [the comparison with Mermaid and D2](docs/comparison/README.md) and [the benchmark](docs/benchmark.md), including where Cartography loses.

**From what you already have**: Mermaid, D2, PlantUML, Structurizr DSL, draw.io and Excalidraw files; Kubernetes manifests, Terraform state or plan JSON, network inventories (CSV, NetBox), git history; ODPS and ODCS data products and contracts (`carto render mesh/`); Azure and Entra ID access exports (az, Graph, AzureHound), Azure resources (Resource Graph, ARM / Bicep, azurerm Terraform) and GitHub organisations (`gh api`). Importing again keeps your edits; `carto import --live k8s|azure|access|github` reads with your own logged-in tools, read-only. See [access import](docs/access-import.md), [Azure import](docs/azure-import.md) and [live import](docs/live-import.md), and the guides for people coming from [Mermaid](docs/coming-from/mermaid.md), [D2](docs/coming-from/d2.md), [draw.io](docs/coming-from/drawio.md), [PlantUML](docs/coming-from/plantuml.md) and [Structurizr](docs/coming-from/structurizr.md), or with nothing drawn yet but [a code repository](docs/repo-import.md).

**In your docs**: a remark plugin (Docusaurus, Astro, MDX) and a markdown-it plugin (VitePress, Eleventy) draw a fenced `cartography` block or `![Web shop](./shop.yaml)` as SVG while the site builds; `<carto-diagram src="shop.yaml">` draws in the browser with zoom and drill-down. See [embed](docs/embed.md) and [examples/docs](examples/docs).

**Elsewhere**: a VS Code extension (`packages/vscode`, from a `.vsix`) with a live preview, problems and quick fixes ([vscode](docs/vscode.md)); an MCP server and agent skill so Claude Code and other MCP clients write diagrams checked against the schema ([mcp](docs/mcp.md)).

## Working on it

```sh
pnpm web:build        # static app in packages/web/dist, runs from any folder, offline
pnpm test             # unit tests; pnpm typecheck
pnpm gallery          # render all examples → gallery/out/index.html
pnpm lab              # layout quality per example, variants side by side
pnpm bench            # the layout benchmark (d2 optional) → docs/benchmark.md
pnpm licences && pnpm pack:check
```

Requirements and decisions: [docs/requirements.md](docs/requirements.md).

Fonts: Instrument Sans, Geist Mono, Barlow, IBM Plex Sans, IBM Plex Mono, Kalam and Inter (all SIL OFL 1.1; licence texts in `packages/theme/fonts`). Icons: Lucide (ISC). Node placement: Graphviz dot (EPL) via @hpcc-js/wasm-graphviz (Apache-2.0); lines are drawn by our own router. Licence: MIT.

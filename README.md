# Cartography

Architecture diagrams that look good: write a short YAML file or build the diagram interactively from a template, and get a clean, consistent drawing.

Diagram types: architecture, Azure, database (ERD), roles / groups / access packages, GitHub, data products (with ports and data contracts) — and coming: Kubernetes, networking, git flow and developer journey. Not sure which one you need? See [Which diagram type do I need?](docs/types.md)

Status: early development. See [docs/requirements.md](docs/requirements.md).

## The editor

```sh
pnpm install
pnpm web          # → http://localhost:5178
pnpm web:build    # static app in packages/web/dist, runs from any folder, offline
```

YAML on the left, the drawing on the right; both stay in sync and select the same element.

- **Start** by picking what you want to draw: a card per type says what it is for and what it is not for, and a search box ranks the types by your words ("who has access", "tables and keys"). Then a template, then how to work: **Describe it** (a few questions become a prompt; Claude drafts the diagram with your own API key, checked by the engine and fixed automatically — or copy the prompt into any chat), **Build visually** (shapes panel, no YAML; `⌘\` switches) or **Write YAML**. Or paste a Mermaid diagram (flowchart, architecture-beta, erDiagram) and get it back as Cartography. Open a folder of diagrams to edit files in place (Chrome/Edge).
- **Write** with autocomplete from each type's schema; problems show on the right line, and the last good drawing stays while you type.
- **Build** without YAML: add shapes from the palette (`A`, or drag them onto the drawing and into a group), edit them in the inspector, drag from the dot on an element to connect it, rename with every reference following.
- **Select** several with shift-click or a marquee, `⌘C`/`⌘V` copy and paste, double-click to rename in place.
- **Arrange**: drag elements or whole groups; positions are saved next to the diagram as `<name>.layout.json`, lines follow, nothing lands on top of something else.
- **Undo** everything with `⌘Z`: typing, builder edits and moves share one history.
- **Export** SVG, PNG, a 16:9 slide, or copy as PNG for slides and docs. `?` shows every shortcut.

Diagrams look better than the usual tools: lines that share a path are spaced evenly or merge into a trunk, labels stay off group borders, supporting links (Key Vault, logging) can be badges on the card instead of lines (`badges: [identity]`). See [docs/comparison](docs/comparison/README.md) for Mermaid and D2 side by side.

CLI: `carto import diagram.mmd` turns Mermaid (or Markdown with mermaid blocks) into Cartography YAML.

## Try it

```sh
mise install            # Node 24 + pnpm (or bring your own)
pnpm install
pnpm carto types                                  # which type for what (add words to rank them)
pnpm carto new azure my-infra.yaml                # start from a template
pnpm carto render my-infra.yaml -f png -t dark    # → my-infra.png
pnpm gallery                                      # render all examples → gallery/out/index.html
pnpm test
pnpm lab                                          # layout quality per example, variants side by side
```

Fonts: Inter (SIL OFL 1.1). Icons: Lucide (ISC). Node placement: Graphviz dot (EPL) via @hpcc-js/wasm-graphviz (Apache-2.0); lines are drawn by our own router.

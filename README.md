# Cartography

Architecture diagrams that look good: write a short YAML file or build the diagram interactively from a template, and get a clean, consistent drawing.

Diagram types: Azure, database (ERD), roles / groups / access packages, GitHub, data products (with ports and data contracts) — and coming: Kubernetes, networking, git flow and developer journey.

Status: early development. See [docs/requirements.md](docs/requirements.md).

## Try it

```sh
mise install            # Node 24 + pnpm (or bring your own)
pnpm install
pnpm carto types                                  # list diagram types
pnpm carto new azure my-infra.yaml                # start from a template
pnpm carto render my-infra.yaml -f png -t dark    # → my-infra.png
pnpm gallery                                      # render all examples → gallery/out/index.html
pnpm test
pnpm lab                                          # layout quality per example, variants side by side
```

Fonts: Inter (SIL OFL 1.1). Icons: Lucide (ISC). Node placement: Graphviz dot (EPL) via @hpcc-js/wasm-graphviz (Apache-2.0); lines are drawn by our own router.

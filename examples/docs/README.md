# Diagrams in a docs site: examples

Four small sites that show the same thing: a diagram kept as YAML next to the docs, drawn into the page. How it works, every option and the security notes are in [docs/embed.md](../../docs/embed.md).

The folders are on their own on purpose: they are not part of the workspace, so installing Cartography does not pull in Docusaurus or VitePress. Build the two packages they use first, from the repository root:

```sh
pnpm install
pnpm --filter @cartography/embed build          # the web component → packages/embed/dist
pnpm --filter @cartography/docs-plugins build   # the plugins → packages/docs-plugins/dist
```

| Folder | Docs system | How the diagrams get in |
| --- | --- | --- |
| [static](static/index.html) | none, one HTML page | `<carto-diagram>` draws in the browser |
| [vitepress](vitepress) | VitePress | markdown-it plugin, at build time |
| [docusaurus](docusaurus) | Docusaurus | remark plugin, at build time |
| [mkdocs](mkdocs) | MkDocs | a hook that runs `carto embed`, at build time |

## static

A page cannot fetch files when it is opened from disk, so serve the repository and open the page:

```sh
npx serve -l 5190 .        # from the repository root; any static server will do
# http://localhost:5190/examples/docs/static/
```

## vitepress

```sh
pnpm --dir examples/docs/vitepress install --ignore-workspace
pnpm --dir examples/docs/vitepress build      # → .vitepress/dist
pnpm --dir examples/docs/vitepress preview    # http://localhost:5196
```

The setup is in [.vitepress/config.mjs](vitepress/.vitepress/config.mjs): the plugin with `vue: true`, `dark: '.dark'` and `fonts: 'none'`.

## docusaurus

```sh
pnpm --dir examples/docs/docusaurus install --ignore-workspace
pnpm --dir examples/docs/docusaurus build     # → build
pnpm --dir examples/docs/docusaurus serve     # http://localhost:5197
```

The setup is in [docusaurus.config.mjs](docusaurus/docusaurus.config.mjs): the plugin goes in `beforeDefaultRemarkPlugins`.

## mkdocs

MkDocs is Python and Cartography is Node. [hooks/cartography.py](mkdocs/hooks/cartography.py) bridges the two in the plainest way: it runs `carto embed --fragment` once for every diagram in a page and puts the figure that comes back into the page. Nothing to install on the Python side beyond MkDocs itself; `carto` has to be on the path, or named in `CARTO`:

```sh
export CARTO="node --import tsx $PWD/packages/cli/src/main.ts"   # from the repository root, until carto is installed
uvx mkdocs build -f examples/docs/mkdocs/mkdocs.yml               # or: pip install mkdocs, then mkdocs build -f …
```

That is one Node process per diagram, about a second each. Fine for tens of diagrams; for hundreds, render them up front with `carto render` and use ordinary images.

## Checking a built site

`packages/embed/e2e/site.mjs` opens a built site in a headless browser and checks that the drawings are there without JavaScript, that the dark ones show on a dark page, and that an interactive diagram comes alive and drills down:

```sh
node packages/embed/e2e/site.mjs vitepress examples/docs/vitepress/.vitepress/dist shots
node packages/embed/e2e/site.mjs docusaurus examples/docs/docusaurus/build shots
node packages/embed/e2e/site.mjs mkdocs examples/docs/mkdocs/site shots
```

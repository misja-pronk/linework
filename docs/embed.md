# Diagrams in a docs site

Keep the diagram as YAML next to the docs and let the site show it. There are two ways, and they work together:

- **At build time** (`@cartography/docs-plugins`): a remark plugin and a markdown-it plugin draw each diagram while the site is built and put plain SVG in the page, a light and a dark one. No headless browser, no server, nothing for the reader to download.
- **In the browser** (`@cartography/embed`): `<carto-diagram>` draws the YAML in the reader's browser and adds zoom, pan and drill-down into linked diagrams.

A diagram marked `interactive` in the plugins gets both: the static drawing is in the page from the start, and it comes alive when the component has loaded.

Working examples of each docs system are in [examples/docs](../examples/docs).

## The web component

```html
<script type="module" src="carto-diagram.js"></script>

<carto-diagram src="diagrams/shop.yaml"></carto-diagram>
<carto-diagram src="diagrams/containers.yaml" view="ordering" controls="views"></carto-diagram>

<carto-diagram>
  <script type="text/yaml">
    type: systems
    title: Sign-up
    nodes:
      visitor: { kind: user, label: Visitor }
      site: { kind: client, label: Website }
    edges:
      - visitor -> site: Fills in the form
  </script>
</carto-diagram>
```

Build it with `pnpm --filter @cartography/embed build`; `packages/embed/dist` then holds:

| File | Size | Gzip | What |
| --- | --- | --- | --- |
| `carto-diagram.js` | 24 kB | 9 kB | The element. This is what the page loads. |
| `carto-engine.js` | 1.45 MB | 0.88 MB | Parser, layout (Graphviz as WebAssembly), renderer, icons, Inter. Loaded by the element when the first diagram comes near the screen, once per page however many diagrams it has. Keep it next to `carto-diagram.js`. |
| `carto-diagram.standalone.js` | 1.48 MB | 0.89 MB | Both in one file, for a page that has to be a single file. |

The engine is big because it is the whole tool: most of it is Graphviz (WebAssembly) and the icon set. A page with only static drawings from the plugins loads none of it.

### Attributes

| Attribute | What it does |
| --- | --- |
| `src` | The diagram file. Its `include:` files, its theme file and a `name.layout.json` next to it (positions you dragged in the editor) are fetched relative to it. |
| `view` | The view to show, for a diagram with `views:`. |
| `theme` | `auto` (the default) follows the page: `data-theme`, `data-bs-theme`, `data-md-color-scheme` or a `dark` class on the page when there is one, the system setting otherwise, and redraws when that changes. `light`, `dark`, or the name of a built-in theme (`carto themes`) fix it. With `auto`, a diagram that names its own `theme:` keeps it. |
| `controls="views"` | Adds a picker for the diagram's views. |
| `loading="eager"` | Draw at once. Without it the engine loads when the element scrolls near the screen. |
| `layout` | Another sidecar file than `name.layout.json`, or `none`. |
| `cross-origin` | Allow a `src` on another site (see [Security](#security)). |
| `fonts="page"` | Do not add the theme's typefaces; use the page's fonts. |
| `data-bundle` | Written by the plugins and `carto embed`: the diagram and every file it reads, so nothing is fetched. |

Inline YAML goes in a `<script type="text/yaml">` child. More files can ride along the same way: `<script type="text/yaml" data-file="model.yaml">` for an include, `type="application/json" data-file="shop.layout.json"` for a sidecar.

### Using it

- **Zoom and pan**: Ctrl or ⌘ with the wheel (or pinch on a trackpad), drag to move, double-click to zoom in and again to fit. With the drawing focused: `+`, `-`, `0` to fit. A small cluster of buttons appears at the bottom right. Plain scrolling still scrolls the page.
- **Links**: an element with `links:` is clickable (and reachable with Tab, Enter opens it). A link to another diagram (`containers.yaml`, `containers.yaml#ordering`) or another view (`#ordering`) opens inside the component, with a trail at the top; Backspace, Alt-Left or the back button return. Web addresses open in a new tab. With several links on one element the first usable one is followed; all of them are listed in the text description.
- **Size**: the drawing fits the width of its container and is never enlarged beyond its natural size. `--carto-max-height` limits the height.
- **Accessibility**: the drawing is named after the diagram's title, and a "Text description" below it lists the elements and connections in words. Text in the drawing can be selected and copied.
- **Problems**: a mistake in the YAML shows as a message in place, with line and column, next to whatever could still be drawn. Never an empty box.
- **Styling**: `--carto-border`, `--carto-radius`, `--carto-accent`, `--carto-max-height`, or `::part(frame)`. The rest is inside a shadow tree: page CSS does not leak in and the component's CSS does not leak out.
- **Events**: `carto-render` after each drawing (`detail: { ok, title, view, diagnostics }`), and `carto-link` before a web address opens (`detail: { href }`; `preventDefault()` to handle it yourself).

### Fonts

Diagrams are measured and drawn in the typefaces of their theme, as in the editor and the CLI: Instrument Sans and Geist Mono for the default look, Inter for classic, Barlow or IBM Plex for Transit and Drafting (see [themes](themes.md)). The component registers the faces that ship inside the engine under names of their own (`Carto Instrument Sans`, `Carto Geist Mono`), so labels fit their boxes whatever the page uses, and the page's own fonts are left alone. A brand theme's fonts are loaded the same way. With `fonts="page"` the text falls back to a face of that name on the page, then to system fonts; labels may then be a little wider or narrower than their boxes.

## Build-time plugins

Both plugins turn two things into drawings:

````md
```cartography
type: systems
title: Sign-up
nodes:
  visitor: { kind: user, label: Visitor }
  site: { kind: client, label: Website }
edges:
  - visitor -> site: Fills in the form
```

![Web shop](./diagrams/shop.yaml)
![Ordering](./diagrams/containers.yaml#ordering)
````

` ```carto ` is the short form. An image that points at a `.yaml` file is a diagram; its alt text becomes the accessible name, `#view` picks a view. An image inside a link, a heading or a table is left alone, with a warning.

One diagram can ask for something else than the site's options, on the fence line or in the image's title:

````md
```cartography view=ordering theme=dark interactive title="Placing an order"
```

![Web shop](./diagrams/shop.yaml "interactive theme=dark")
````

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `theme` | `auto` | `auto` draws a light and a dark one and lets the page pick. `light`, `dark` or a theme name draw one. |
| `view` | | The view to draw when the reference names none. |
| `output` | `inline` | `inline` puts the SVG in the page. `file` writes `name-<hash>.svg` (and `.dark.svg`) to `outDir` and points an `<img>` at them: lighter pages, cacheable, but text cannot be selected and links do not work. |
| `outDir`, `publicPath` | | Where `file` output is written, and the address that folder is served at. |
| `interactive` | `false` | Wrap the drawing in `<carto-diagram>` with everything it needs. The page must load `carto-diagram.js` for it to come alive; without it the static drawing stays. |
| `dark` | `auto` | How the page says it is dark. `auto`: the system setting, overruled by `data-theme`, `data-bs-theme`, `data-md-color-scheme` or a `dark`/`light` class. `media`: the system setting only (with `file` output this gives a `<picture>`). Anything else is a CSS selector that matches a dark page, such as `.dark`. |
| `fonts` | `embed` | `embed` adds the typefaces of the site's theme to the page once, under names of their own: `CartoInstrumentSans` and `CartoGeistMono` for the default look (about 190 kB), `CartoInter` for classic (about 112 kB). A drawing in another theme carries its own faces. `none` leaves the text to the page's fonts: right for a site that already loads the same typefaces. |
| `description` | `false` | Add the drawing in words below it, in a `<details>`. |
| `strict` | `true` | A diagram with errors stops the build. Off: a readable message in the page and a build warning. |
| `root` | where the build runs | Diagrams may only read files below this folder. |
| `pageStyle` | `true` | Put the small stylesheet in each page that has a diagram. Turn it off when the site's CSS already has `pageCss()` (exported by the package), which also keeps the font out of every page. |

Problems are reported with the markdown file and the line: for a fenced block the line of the mistake inside the block, for a file reference the line of the image followed by the diagram's own `file:line:column`.

### Docusaurus (remark)

```js
// docusaurus.config.mjs
import cartography from '@cartography/docs-plugins/remark';

export default {
  // Only for diagrams marked interactive.
  scripts: [{ src: '/carto/carto-diagram.js', type: 'module' }],
  presets: [['classic', { docs: { beforeDefaultRemarkPlugins: [[cartography, { description: true }]] } }]],
};
```

It has to be in `beforeDefaultRemarkPlugins`: Docusaurus's own image plugin runs first otherwise and tries to bundle the `.yaml` file. Works in `.md` and `.mdx`. The same plugin works anywhere remark does (Astro, Next with MDX, plain unified).

### VitePress (markdown-it)

```js
// .vitepress/config.mjs
import cartography from '@cartography/docs-plugins/markdown-it';

export default {
  head: [['script', { type: 'module', src: '/carto/carto-diagram.js' }]],
  markdown: {
    config: (md) => md.use(cartography, { vue: true, dark: '.dark' }),
  },
};
```

`vue: true` keeps Vue from reading the drawing as a template. VitePress marks a dark page with a `.dark` class and already ships Inter. The same plugin works with any markdown-it site (Eleventy, for one); the page's path is taken from `env.path`, `env.filePath` or `env.relativePath`.

markdown-it plugins cannot wait, and drawing a diagram has to (Graphviz loads as WebAssembly). So this plugin draws in a worker thread and blocks until it answers. It needs Node 20 or later and costs a moment at the first diagram.

### MkDocs

MkDocs is Python, Cartography is Node, and there is no plugin that hides that. The honest route is a [hook file](../examples/docs/mkdocs/hooks/cartography.py) of about a hundred lines that runs `carto embed --fragment` for every diagram in a page and puts the result in. It handles the same fenced blocks and image references, reports problems as MkDocs warnings (so `mkdocs build --strict` stops on them), and needs `carto` on the path or in `CARTO`. One process per diagram, about a second each; for a site with hundreds of diagrams render them up front with `carto render` and use ordinary images.

```yaml
# mkdocs.yml
hooks:
  - hooks/cartography.py
extra_css:
  - carto/carto.css
extra_javascript:
  - path: carto/carto-diagram.js
    type: module
```

### A plain page, or anything else

Use the component directly ([examples/docs/static](../examples/docs/static/index.html)), or let the CLI write the HTML:

```sh
carto embed shop.yaml                 # → shop.html: one file with the drawing, zoom and drill-down (about 1.6 MB)
carto embed shop.yaml --static        # the drawing alone, light and dark, no script (about 125 kB, most of it Inter)
carto embed shop.yaml --fragment      # only the <figure>, to paste into a page of your own
carto embed --css                     # the stylesheet that goes with fragments
cat shop.yaml | carto embed - --fragment --static
```

`--view` and `--theme` work as in `carto render`.

## Security

A docs site draws what is in its repository, and a diagram may come from someone you would not give script access to your site. So everything in the YAML is treated as untrusted:

- **Text** (titles, labels, descriptions) is always written as text. Markup in a label shows up as the characters you typed.
- **Links** are followed only when they are `http:`, `https:`, `mailto:` or a relative path. `javascript:`, `data:`, `vbscript:` and the like are dropped, also when hidden behind tabs, newlines or odd capitals; such an element is simply not clickable. In static plugin output only full `http`, `https` and `mailto` links are kept (they open in a new tab with `rel="noopener noreferrer"`); relative links and links to other diagrams need the interactive component, which knows where the diagram lives.
- **The SVG** is ours, and is still filtered before it goes into a page: only the elements the renderer draws with, no event handlers, no scripts, no `foreignObject`, images only as embedded pictures or safe paths.
- **The component fetches from its own site only.** A `src`, include or sidecar on another origin is refused with a message in place, and no request is made. Add the `cross-origin` attribute to allow the one site that `src` points at; that site then has to send CORS headers, and you are trusting what it serves as much as your own files.
- **The plugins read below `root` only**, so a diagram cannot include the build machine's files (`include: ../../../etc/…`).
- **No `eval` in our code**, but the engine checks diagrams against their schema with Ajv, which compiles the checks at run time, and Graphviz runs as WebAssembly. A page with a Content-Security-Policy therefore needs `'unsafe-eval'` and `'wasm-unsafe-eval'` in `script-src` for the interactive component. Static plugin output needs neither; its one inline `<style>` needs `style-src 'unsafe-inline'`, or put `pageCss()` in your own stylesheet and set `pageStyle: false`.

## Limits

- Touch pinch is handled by the same code as trackpad pinch but has not been tried on a phone.
- A brand theme's font width correction (`font.scale`) is not applied in the browser; labels in a brand font can sit a little tight.
- With several links on one element the component follows the first usable one.
- Static output cannot drill down. Mark the diagram `interactive` for that.

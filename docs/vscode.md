# Linework in VS Code

An extension that draws a diagram beside its YAML while you type, with the same engine as the CLI and the web editor, bundled in: it works offline, fetches nothing and sends nothing.

It is not on the Marketplace. Build the `.vsix` and install it yourself.

## Install

```sh
pnpm install
pnpm --filter @linework/vscode package        # → packages/vscode/linework-0.1.0.vsix
code --install-extension packages/vscode/linework-0.1.0.vsix
```

Or in VS Code: Extensions view → `…` menu → **Install from VSIX…**. VS Code 1.101 or later.

The `.vsix` is written by `packages/vscode/package.mjs` with fflate (already in the tree), not with `@vscode/vsce`: a vsix is a zip with a manifest, and this keeps packaging offline with no extra dependencies. `pnpm --filter @linework/vscode build` alone writes `dist/` (to run the extension from source: open `packages/vscode` in VS Code and start an Extension Development Host with F5 and a launch config of type `extensionHost`).

## Which files

A YAML file is a diagram when it has a top-level `type:` that names a diagram type (`type: systems`, `type: erd`, … or `type: model`), or when its name ends in `.linework.yaml`. Everything else in YAML is left alone.

## Preview

**Linework: Open Preview to the Side** (`⌘K V` / `Ctrl+K V`, or the preview icon in the editor's title bar).

- Redraws as you type (after `linework.preview.debounce` ms); zoom and pan stay where they are. While the text has errors the last good drawing stays, marked out of date.
- Scroll to pan, `⌘`/`Ctrl` + scroll or pinch to zoom, `0` or **Fit** to fit, `+`/`−` to zoom.
- **Click** an element: the cursor jumps to its entry in the YAML. **Put the cursor** in an entry: the element lights up in the drawing.
- **Drag** a node to pin it where you drop it: the pin goes into `<name>.layout.json` next to the diagram, per view, exactly as the web editor and the CLI write it. **Double-click** a node to let its pin go; **Linework: Clear Pins of This View** lets them all go. (Unsaved documents have nowhere to put a sidecar: no dragging there.) Moving groups, bending lines and snapping guides stay in the web editor.
- **Views**: a picker in the toolbar when the diagram has `views:`. **Steps**: ‹ › (or ← →) step through `steps:`, **All** shows the whole diagram. **Focus**: click an element, then **Focus** draws it and its neighbours; **Clear focus** draws everything.
- **Theme**: the diagram's own `theme:` wins; without one the preview is light or dark as VS Code is. `linework.preview.theme` forces one.
- **Open in editor** opens the diagram in the web editor as a share link (see below).

## Present

**Linework: Present** (or **Present** in the preview's toolbar) opens the diagram on its own, the editor maximized: → / Space / Page Down for the next step, ← for the previous, Home / End, Esc to stop. The step's title and caption show under the drawing, as in the web editor (on an exported PowerPoint slide they sit under the slide title). `linework.present.fullScreen` also turns VS Code full screen.

## Your AI

The extension has no AI of its own: your agent changes the diagrams, through Linework's MCP
server ([ai](ai.md), [mcp](mcp.md)). In VS Code, installing the extension is all you need. It
registers the server with VS Code, so Copilot's agent mode (and any agent that uses VS Code's MCP
servers) has the tools: open the Chat view, pick **Agent**, and **Linework** is in the tools list
(**MCP: List Servers** shows it too). The server runs on VS Code's own Node.js, in the first
workspace folder. VS Code may ask once to trust the server before it starts.

How it goes:

1. Open a diagram and its preview (`⌘K V`). **Click** what you mean in the preview (or put the
   cursor in its YAML): that is the selection the agent sees.
2. Ask in the chat: "make this one redundant", "add a cache in front of the selected database",
   "split the selected service into read and write".
3. The agent calls `get_context` (which file, what is selected) and then `propose`. The change shows
   over the preview: what is added, changed and removed marked, and the YAML diff under **YAML**.
   A diagram of the workspace that is not open is opened first, with its preview.
4. **Accept** (⏎) applies it as one undo step (a renamed id takes its pins along); **Reject** (Esc)
   leaves it. The agent hears which. Save to put it on disk.

A file the agent writes itself (`edit_diagram`) while it is open and saved: VS Code reloads it, and
the preview shows what changed, with **Undo** to take it back.

Claude Code, Cursor and other agents outside VS Code's own MCP servers need the server set up once
in their own way ([ai](ai.md#set-up-the-mcp-server)); the extension answers them just the same. It
listens on 127.0.0.1 with a random token, and the MCP server finds it through a small file in the
temp folder. The server inside the extension draws SVG but not PNG (resvg is native code the
extension does not ship).

## Problems and completion

The engine's problems appear in the Problems panel at their line and column, in the same words as `linework validate` (all views are checked, each problem once). Quick fixes (`⌘.`) where the message names the fix: a value that must be one of a list (closest first), an unknown or missing `type:`, a label that starts with `[ ]` and needs quotes.

With the YAML extension (`redhat.vscode-yaml`) installed, each diagram gets its type's JSON Schema for completion and hover. That copy leaves out "unknown key" and "required key" checks, which Linework already reports in its own words, so each problem shows once. The schemas are also in `packages/vscode/dist/schemas/` after a build (one per type, plus `linework.schema.json` for all).

## Commands

| Command | |
|---|---|
| New Diagram from Template… | Pick a type (the list says what each is for and when not to use it); a new document with its template opens with the preview. |
| Export as SVG… | The drawing as on screen (view, step, focus), fonts embedded. |
| Export as PNG… | Drawn by the preview's own browser canvas (opened if needed), at `linework.export.pngScale`. No native code in the extension; `linework render --format png` uses resvg and the bundled TTFs instead, so its text can differ slightly. |
| Export as PowerPoint (.pptx)… | Native shapes and text, a slide per written step. With the preview open the icons also get a PNG fallback for older Office. |
| Copy Share Link | The diagram (and its pins) in a link's `#fragment`, for the web editor at `linework.shareBase`. A browser never sends the fragment to a server. |
| Open in Linework Editor | The same link, opened in the browser. |

PDF export, `--svg-safe` SVG and icon packs from the CLI's config folder are CLI-only: run `linework` for those.

## Settings

| Setting | Default | |
|---|---|---|
| `linework.preview.theme` | `auto` | `auto`: the diagram's theme, else VS Code's light or dark. A name (`light`, `dark`, a built-in theme) wins over the diagram's. |
| `linework.preview.debounce` | `250` | Milliseconds after typing before redrawing and checking. |
| `linework.diagnostics.enabled` | `true` | Problems in the Problems panel. |
| `linework.yamlSchemas` | `true` | Hand the type schemas to the YAML extension. |
| `linework.shareBase` | `http://localhost:5178/` | The web editor that share links open. |
| `linework.export.pngScale` | `2` | Pixels per unit in PNG exports. |
| `linework.present.fullScreen` | `false` | Present also turns VS Code full screen. |

## How it is built and tested

`packages/vscode/src`: the engine draws in the extension host (`draw.ts`); the webview (`webview/main.ts`) only shows the SVG and reports clicks, drags and picks; `mapping.ts` maps elements to their YAML, `problems.ts` turns diagnostics into ranges and fixes. esbuild bundles `dist/extension.js` (CommonJS, engine and Graphviz inside), `dist/worker.js` (the Markdown plugin's drawing worker) and `dist/webview.js`.

- `pnpm test` runs the unit tests and the extension against a stubbed `vscode` module (`test/vscode-stub.ts`): activation, problems and fixes, schemas, preview messages, pins, Markdown.
- `pnpm --filter @linework/vscode e2e [folder]` loads the built `dist/extension.js` against the stub and opens its preview page in Chromium (Playwright, already in the tree) with a stubbed `acquireVsCodeApi`: click to reveal, cursor highlight, zoom kept over edits, drag to pin, dark theme, SVG/PNG/PPTX export, presenter. It writes screenshots. No VS Code is downloaded; `@vscode/test-electron` is not used.

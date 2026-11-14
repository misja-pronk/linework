# Share links

A share link opens a diagram read-only in the web app, for someone who only needs to look at it. The diagram travels **inside the link**: its YAML (and the positions you dragged, and the theme you picked) is compressed into the part after the `#`. Browsers never send that part to a server, so nothing is uploaded, nothing is stored anywhere, and the link works as long as the web app does, offline included.

## Making one

- In the editor: **Export → Copy share link**, or *Copy share link* in the command palette (⌘K).
- On the command line: `linework share shop.yaml` prints the link. `--base` says where the web app lives (default `http://localhost:5178/`, the local dev server):

  ```sh
  linework share shop.yaml --base https://diagrams.example.org/
  ```

A diagram that `include:`s other files is shared without them: the editor says so when it copies the link.

## What the reader gets

The read-only viewer: the drawing with pan (drag), zoom (wheel, `+`, `-`, `0` to fit), the diagram's views, **Present** (`P`, step by step, as in the editor), and exports to SVG, PNG, PowerPoint, PDF and the YAML itself. A note at the top says the diagram stays in the browser.

**Open in editor** copies the diagram into a new document of the reader's own browser, with an undo back to what they had open. Until then nothing is stored.

## Size

Links up to 32 kB are handed out; longer ones get cut by chat tools, mail clients and older browsers. Diagrams compress well (the 120-line C4 model in `examples/c4` is a link of under 3 kB), but a very large one is refused with a message that says how large it would be: share the YAML file instead.

## How it is encoded

`#share=` followed by base64url of the raw-deflate (`CompressionStream('deflate-raw')`) of a small JSON object: `{ "v": 1, "y": "<yaml>", "n": "<file name>", "l": <layout>, "t": "<theme>" }`. No library is involved; the CLI and the web app use the same code (`packages/core/src/share.ts`).

Opening a link is careful with what it is handed: a link that unpacks to more than 1 MB is not opened, and of the layout only the positions and bends that can be read are kept.

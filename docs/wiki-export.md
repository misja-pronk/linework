# Wiki export: Markdown, Confluence, Notion

Diagrams on a wiki page without a plugin: the picture, and under it the description in words
([describe.md](describe.md)). Nothing is uploaded anywhere; you put the files where they go.

## Markdown: GitHub, GitLab, Obsidian

```sh
carto export-md shop.yaml -o docs/shop/          # docs/shop/README.md and docs/shop/images/
carto export-md architecture/ -o wiki/           # wiki/README.md (an index) and a page per diagram
```

Each page has, per drawing (the diagram as written, then each of its views):

- the picture as **SVG** (`![…](images/shop.svg)`), with links to the **PNG** (for tools that do not show SVG) and the
  SVG itself; the alt text is the drawing's title and summary;
- the **description** under it, with headings and lists;
- **Step by step**: a section per written step with its caption and a picture of that step (`--no-steps` leaves them
  out).

A folder export gets `README.md` with a line per diagram and its summary, and a back link on every page. Paths are
relative, lower case, without spaces, so they work as they are on GitHub, on GitLab, in Obsidian (as a vault folder)
and in any Markdown viewer. The SVGs carry their fonts and their own title and description; the PNGs their title and
description as text chunks.

| Option | |
| --- | --- |
| `-o dir/` | where to write (required) |
| `--title "…"` | the index's title (folder); by default the folder's name |
| `--no-steps` | no step sections |
| `--theme`, `--icons`, `--pack` | as for `carto render` |

It exits 1 when a diagram has errors; the others are still written.

## Confluence

```sh
carto export-confluence shop.yaml -o confluence/
carto export-confluence architecture/ -o confluence/ --title "Architecture"
```

writes, per diagram, `confluence/<page>/` with

- `page.xhtml`: the page body in **Confluence storage format**: the picture as `<ac:image>` of the page's own
  attachment (`<ri:attachment ri:filename="shop.png"/>`) with its alt text, a link to the SVG attachment, and the
  description as headings and lists;
- `page.html`: the same page as plain HTML with the pictures beside it;
- the **PNG and SVG** files: the attachments, named as the body names them;

and next to them `manifest.json` (every page: title, body, HTML copy, attachments, source file), `README.md` on how
to import, and for a folder `index.xhtml`, a parent page with a children macro.

Cartography calls no API. To put the pages in, use your own tool with your own credentials:

1. create the page with the body of `page.xhtml` as `"representation": "storage"`
   (`POST /wiki/rest/api/content` on Cloud, `/rest/api/content` on Data Center; for a folder export create
   `index.xhtml` first and give the others it as their ancestor);
2. upload the files of the folder as attachments of that page (`POST …/content/<id>/child/attachment`, with the
   header `X-Atlassian-Token: no-check`).

The pictures show as soon as the attachments are there. By hand: open `page.html` in a browser, select all, paste
into a new page, or use the editor's copy below. Confluence's own importers differ per edition (Word on Cloud, an
HTML importer on some Data Center sites); where there is one, `page.html` with its pictures is what to give it.

## Copy for Confluence / Notion (the editor)

**Export → Copy for Confluence / Notion**, or `C` in the Describe dialog, puts the drawing on screen (its view, step
and focus) on the clipboard as rich HTML: a heading, the picture as a PNG inside it (2×, shown at its own size) with
alt text, and the description. Paste into a Confluence page, Notion, Google Docs or Word and you get the picture and
the words in one go; anything that takes only text gets the description as plain text. Made in the browser; nothing
is uploaded.

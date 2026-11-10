# Review notes

Comments on a diagram, kept next to it, never in it. A note hangs on an element, a line, a group or a spot of the canvas, and carries a thread of replies. There is no server and no account: notes travel the way the diagram does, as a file in git.

```
shop.yaml            the diagram, untouched by notes
shop.layout.json     pins, bends, layout memory
shop.notes.json      the review notes
```

The notes file is separate from the layout file on purpose: sharing a diagram without its review is copying two files instead of three, and notes and pins change for different reasons, so they should not conflict with each other in a merge.

## In the editor

| Do this | Keyboard | Trackpad / mouse |
| --- | --- | --- |
| Add a note on the selection | <kbd>N</kbd> (nothing selected: in the middle of the view) | right-click an element or a line → *Add a note on …* |
| Add a note on a spot | | right-click empty canvas → *Add a note here* |
| Show or hide the Notes panel | <kbd>⇧N</kbd> | the *Notes* button in the canvas toolbar |
| Review mode | <kbd>⇧R</kbd> | *Review* in the Notes panel |
| Send a note or reply | <kbd>⌘↩</kbd> (<kbd>Esc</kbd> cancels) | *Add note*, *Reply* |
| Everything above | <kbd>⌘K</kbd>, type "note" | |

The first time you write a note, the panel asks for your name; it is kept in this browser and written on your notes. You can edit and delete your own notes and replies (a note with replies stays; delete the replies first).

On the drawing a note is a numbered speech bubble at the top-left corner of what it is about, or halfway along a line. The number and the shape say it is a note, not the colour; a resolved note is an outline. A small dot on a bubble (and on the *Notes* count) means someone else wrote or replied since you last opened that thread in this browser. Click a bubble to open its thread and select what it is about.

The Notes panel lists the threads of the view on screen: filter *Open*, *Resolved* or *All*, and *Mine* (threads you wrote or replied to). Click a thread's title to select its element and zoom to it. While the panel is open it takes the place of the properties panel; <kbd>⇧N</kbd> switches back.

**Review mode** dims the drawing and keeps the notes bright, for going through a review without the details shouting.

Notes are saved with the diagram: <kbd>⌘S</kbd> in an open folder writes `<name>.notes.json` next to it (and removes it when the last note is deleted). If the file changed on disk meanwhile (a `git pull`, another window), the two are merged thread by thread instead of overwritten. A diagram that is not in an open folder keeps its notes in this browser; *Download review notes* in the command palette saves the file.

## Renames and deleted elements

An anchor holds the id of what it is about and the label it had.

- Renamed in the editor (the inspector's ID field, or a step's name): the note follows, and so do notes on the element's lines.
- Renamed by hand in the YAML: the note finds its element again by its label, when exactly one element has that label. The next save writes the new id.
- Deleted: the note stays, *orphaned*, with the label it had ("Web shop — gone"). It has no bubble, is still listed and exported, and can be hung on another element: select it and press *Attach to …* on the thread. `carto validate` warns about orphaned notes.

A note on an element without a view shows in every view that draws the element. A note on a spot of the canvas belongs to the view it was written in.

## Exports

Exports never carry notes unless asked. Tick *Exports include review notes* at the foot of the Notes panel (or *Exports with review notes* in the palette) and SVG, PNG and PDF get the numbered bubbles plus the open notes written out under the drawing; PowerPoint gets them in each slide's speaker notes. Resolved notes are left out.

## Command line

```bash
carto notes shop.yaml                      # open threads as markdown, e.g. for a pull request
carto notes shop.yaml --all -o review.md   # resolved ones too, to a file
carto render shop.yaml --notes -o shop.pdf # with markers and the notes (pptx: speaker notes)
carto validate shop.yaml                   # also warns: note … is about "Web shop", which is no longer in the diagram
```

## The file

```json
{
  "version": 1,
  "threads": [
    {
      "id": "k3bo0a1",
      "anchor": { "kind": "node", "id": "db", "label": "Orders DB" },
      "status": "open",
      "author": "Bo",
      "created": "2026-11-09T10:00:00.000Z",
      "text": "Postgres or the **managed** one?",
      "replies": [
        { "id": "p9x2m4c", "author": "Ann", "created": "2026-11-09T11:20:00.000Z", "text": "Managed." }
      ]
    }
  ]
}
```

- `anchor`: `{ kind: node | group, id, label }`, `{ kind: edge, from, to, label }` (a line by its ends; edge ids are positions in a list, so not something to hold on to) or `{ kind: point, x, y }` in the same coordinates as pins.
- `view`: optional; the thread shows only in that view.
- `text`: plain text with simple markdown: `**bold**`, `*italic*`, `` `code` ``, `[links](https://…)` and `- ` list items.
- `edited` on a thread or reply when its text was changed; `status` is `open` or `resolved`.

### Merging

The file is written to merge well: keys in a fixed order, one thread per block of lines, threads sorted by id, and ids random, so two people's new notes land in different places of the list. Two people each adding notes and replying to different threads merge cleanly with plain git (a test does exactly that). When both add a note in the same spot of the list, git reports a conflict; the merge driver resolves those by thread and reply id:

```bash
# once per clone
git config merge.carto-notes.driver "carto notes --merge-driver %O %A %B"   # in this repo: "pnpm -s carto notes …"
echo '*.notes.json merge=carto-notes' >> .gitattributes
```

The driver keeps both sides' new threads and replies, takes a resolve from one side and an edit from the other, drops a thread deleted on one side unless the other side changed it, and for a thread both edited keeps the later text.

## VS Code

The preview draws the numbered bubbles of the open notes (hover one for its text). Each thread also shows as a read-only comment on the YAML line of what it is about, and so in VS Code's Comments panel; orphaned notes sit on the first line. Write and answer notes in the web editor or in the file.

# Accessibility

Linework aims at WCAG 2.2 AA: for the drawings it makes, for the editor, and for the pages it exports. This page
says what that means in practice. Something that falls short is a bug; please report it.

## Text alternatives in every export

Every drawing says in words what it shows, made from its model (see [describe](describe.md)):

- **SVG**: a `<title>` and `<desc>` the root names, with `role="img"` and the language of the words (`lang`).
- **PNG**: `Title` and `Description` text chunks. A web page still needs its own `alt`.
- **PDF**: a tagged PDF; each drawing has the description as its alternate text, and its words stay searchable.
- **PowerPoint**: the drawing's group has the description as its alt text.
- **Interactive HTML**: the description is read with the drawing, and a text version lists the elements and
  connections.
- **The editor**: the drawing pane is described by the same words; Export → Describe in words shows and copies them.

## The keyboard

Everything can be done without a mouse.

- **Editor**: Tab moves between the elements of the drawing, ⌥ arrows go to the nearest one, arrows nudge, Delete
  removes, F2 renames, `A` adds and `C` connects. ⌘K finds every command, `?` lists every key.
- **Dialogs** are modal: focus moves in, Tab stays in, Escape closes, and focus goes back to where it was.
- **Lines**: a line bent by hand is straightened again with *Reset line* (⌘K, or the button in the inspector).
- **Interactive HTML**: Tab goes through the elements, ↵ opens what one leads to, `/` searches, `?` lists the
  keys. Single-key shortcuts are off while you type or work in the contents and details panels.

## Cues beyond colour

Meaning is never carried by colour alone. Kinds have their own icon, line types their own dash pattern, and the key
shows both, so a drawing works in greyscale and for colour-blind readers (see [style](style.md)). Selection and focus
are a ring, not only a tint, and in forced colours (Windows high contrast) every ring stays.

## Contrast

- Text in the drawings: at least 4.5:1, on the deepest tint it can land on. Tests check every built-in theme.
- Card borders, group lines and the lines between elements: at least 3:1 against what they sit on.
- A theme of your own is checked the same way: a colour that fails is darkened just enough, with a warning.
  `contrast: high` takes borders and faint text further.
- The editor's text, including warnings, YAML comments and punctuation: at least 4.5:1, in light and dark.
- Focus rings: at least 3:1.

Controls take at least 24 by 24 pixels of pointer, even where the grip looks smaller. The editor's font sizes are
in rem, so they follow the browser's text size.

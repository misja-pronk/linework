# The folder as one model

Open a folder in the editor and Cartography reads every diagram in it into one model of the whole workspace: each element by its id across files, the diagrams and views that show it, the relations between elements, and every `ref:`, `of:`, instance, view and relation that names it. On that you can search everything, walk from the landscape down to a component and back, see where something is used, rename it in every file at once, and catch what only goes wrong between files. This is the Structurizr or IcePanel way of working, with plain YAML files.

The example is [examples/workspace](../examples/workspace): a small bank, Harbour Bank, described once in `model.yaml` and drawn as a system context (`context.yaml`), containers and components (`containers.yaml`), an Azure deployment (`deployment.yaml`), a data products map (`data-products.yaml`) and an access diagram (`access.yaml`), all naming the same elements. How a model is written and included is in [model.md](model.md) and [c4.md](c4.md).

## How files are tied together

- **`include:`** puts a model in scope: a diagram sees the elements of the files it includes, and of what those include.
- **`ref:`** and **`of:`** on a node, `instances:` and `of:` in a C4 deployment view, a view's `of:`, its rules (`include`, `exclude`, `expand`, `focus`), dynamic steps and relations name elements by id.
- **The same id** is the same thing. A node `ledger:` in an Azure diagram, a resource `ledger` in an access diagram and a source `ledger` in a data products map are the model's `ledger` when the file includes the model. Fields of other types that hold an element's id (a capability's `systems: [crm]`) count too.

What each view shows is worked out from the view as written (its kind, `of:`, `include`, `expand`, `exclude`), the way the engine picks it, without laying anything out.

## Search (⌘P)

⌘P (or ⇧⌘F, or *Search …* in the command palette) searches every diagram of the folder (without a folder open, ⌘P is the browser's Print again and ⇧⌘F searches the one diagram): elements by id, name, label, technology, owner, tag, kind and description; views by name and title; files; the entries of the other diagrams (people, groups, data products); and the architecture decisions, by number, title, status, concerns and text.

- Names first: a whole match beats a start, a start beats a word inside, a word beats letters in order (`bnkapi` finds the Banking API). Elements come before views, files and other entries; an element shown in more drawings comes a little higher.
- Each element lists the drawings it is in, best first: the view about it, the view about its system, the landscape or context, other views, other diagrams.
- **↵** opens the first of those with the element selected and in focus (only it and what is one line away; Esc shows everything). **⌥↵** only selects it. **←** and **→** pick another of its drawings first; a click on one opens that.
- An element that no drawing shows opens where it is written in the YAML.

Without a folder the search covers the open diagram and its views.

## Walking the model

- **Down**: double-click a system in a landscape or context view, or a container in a container view, and the view about it opens (its context, its containers, its components), in this file or in another one of the folder. ⌘↓ does the same for the selection. In a deployment, double-clicking a node that runs an element (`of:`) or is one (`ref:`) opens the model's drawing of that element. Elsewhere double-click still edits the label (F2 and Enter always do).
- **Up**: ⌘↑, or a breadcrumb.
- **Back and forward**: ⌘[ and ⌘], or the arrows in front of the breadcrumbs. Every file and view opened is a step, however it was opened, and going back selects again what was selected there.
- **Breadcrumbs** above the drawing say where it sits: `harbour › Harbour Online › Banking API`. The folder opens the landscape; each element above opens the view about it.

## Where is this used

Select an element and the panel under the file list says where it is used:

- **Drawn in**: every drawing that shows it, with the id it has there (`deployment.yaml as api`). A click opens it with the element selected.
- **Named in**: every line that names it: where it is defined, `ref:`, `of:`, instances, relations, views and their rules. A click shows the line in the YAML.

## Rename everywhere (⇧F2)

⇧F2 (or the tag button in the panel, or *Rename … everywhere* in the command palette) renames the selected element in every file of the folder that has it in scope.

- Give the new last part of the id (`online.api` → `backend` makes `online.backend`); a rename never moves an element to another parent. A new label is optional: it is written in the definition, and where an entry repeats the old label (an access resource `Core ledger`), there too.
- Only the ids change: comments, quotes, order and layout of each file stay as they were. A part's id goes with its system (`online` → `digital` makes `online.api` `digital.api` everywhere).
- A node with its own key and `ref: ledger` keeps its key; only the ref changes. An entry that is the element by its id (`ledger:`) gets the new key, with whatever its type says refers to it: lines, `in:`, access assignments, data product inputs.
- Pins and review notes follow: in each `.layout.json`, what was pinned, locked or bent under the old id is under the new one, in every view, and threads in `.notes.json` hang on the new id; also for files whose text does not change.
- The change to every file is shown first, as a diff; ↵ applies it. Nothing is written when one of the files changed on disk since it was read, or when the new id is taken (also by another kind of entry in a diagram, such as a principal).
- The open file changes in the editor, as one undo step (⌘Z); the others are written to the folder. *Undo rename* (in the toast and in the command palette) puts every file back, asking first about a file that changed since.

## Checks across files

The problems list (the status bar shows `N across <folder>`) adds what only shows between files, each with a link to the line:

- a `ref:`, `of:`, instance, view `of:`, step or relation that names an element that is not in scope, with the nearest id there is (`of: payments.engin … did you mean payments.engine?`); a view rule or a line naming an unknown dotted id is a warning;
- an `include:` of a file that is not in the folder;
- one id with two different kinds in two models that meet (in the same folder, or included together), such as `cache` a cache in one and a database in the other;
- an element that no diagram or view shows.

The CLI does the same for a folder:

```sh
carto validate examples/workspace      # each diagram and its views, then the checks across files
```

It fails on errors (a dangling `ref:`, a missing include), not on warnings.

## Speed

The index reads each file on its own and keeps it until its text changes, so a keystroke re-reads the open file only. On a folder of 200 diagrams (`packages/engine/test/workspace.test.ts`) the whole index takes about 80 ms, again after one change about 8 ms, and a search about 1 ms.

## Where it lives

`packages/core/src/workspace.ts` (index, checks, search, drill-down) and `workspace-rename.ts` (rename plan, pins, diff); the editor's part is in `packages/web/src/workspace/`.

# Glossary

One name for each thing, the same in the editor, these docs and the `carto` command.

| Name | What it is | Not called |
| --- | --- | --- |
| **Diagram** | One YAML file, of one type. | chart, document |
| **Type** | What kind of diagram it is. The editor shows its name (*Architecture*); the YAML writes its id (`type: systems`). Both are listed below. | template |
| **Template** | A ready diagram of a type to start from, in the start dialog (*New*). | example (the examples are the files in `examples/`) |
| **View** | One drawing of a diagram, picked from its `views:` (or from what the type draws itself: overview, detailed). *As written* is the diagram without a view. | page, tab |
| **Drawing** | What the YAML is drawn as, in the editor and in exports. | canvas (only the area it sits on) |
| **Builder** | The way of working by dragging shapes onto the drawing and filling in the side panel, without YAML. `⌘\` switches between it and YAML. | Build visually (only as its description), visual mode |
| **YAML** | The way of working by writing the YAML, with the drawing beside it. | code view, Write YAML |
| **Your AI** | The user's own AI agent (Claude Code, Copilot, Cursor…), working through Cartography's MCP server. In the editor, the panel (⌘J, Ctrl+I off a Mac) where its proposals are accepted or rejected and files changed on disk are shown; in the start dialog, the way of working that copies a prompt for it. Cartography has no AI of its own. The canvas toolbar's button says just *AI*. | Ask Claude, assistant |
| **Wizard** | Questions after a reference architecture that make a finished diagram, without AI (*Answer questions* in the start dialog, `carto new --wizard`). | |
| **Side panel** | The panel on the right, with three tabs: **Properties** (what is selected), **Notes** (review notes) and **Your AI**. | inspector |
| **Page** | The sheet or slide a drawing is fitted on for PowerPoint, PDF and the page exports: a 16:9 slide unless `aspect:` says otherwise (4:3, A4, A3). The frame on the drawing says *Page: 16:9 slide · 11 pt*. | slide (except as the page's name), frame |
| **Pin** | A place you gave an element by dragging it, kept in the `.layout.json` next to the diagram. **Tidy** lays out again what is not pinned; **Tidy all** unpins everything. | position |
| **Lock** | A pin that cannot be dragged by accident. | |
| **Focus** | The drawing cut down to the selection and what is around it (`F`, `focus:`). | filter |
| **Step** | One part of a drawing told in order (`steps:`), presented one at a time and exported as a slide or page each. | slide, frame |
| **Snapshot** | A copy of the diagram kept to compare with later. | version |
| **Note** | A review note on an element, a line or a spot, kept in the `.notes.json` next to the diagram. | comment |
| **Folder** | A folder of diagrams opened in the editor and treated as one model: search, where used, rename everywhere. | workspace (only in the code) |
| **Model** | Elements described once (`type: model`) and `include:`d by the diagrams that draw them. | |

## Types: the name you see and the id you write

| In the editor | In the YAML |
| --- | --- |
| Architecture | `type: systems` |
| C4 model | `type: c4` |
| Network | `type: network` |
| Azure infrastructure | `type: azure` |
| AWS and Google Cloud | `type: cloud` |
| Kubernetes | `type: kubernetes` |
| Database design | `type: erd` |
| Roles, groups and access packages | `type: access` |
| GitHub design | `type: github` |
| Data products | `type: data-products` |
| Sequence | `type: sequence` |
| Git branching | `type: gitflow` |
| Roadmap & timeline | `type: roadmap` |
| Journey map | `type: journey` |
| Process | `type: process` |
| States | `type: states` |
| Context map | `type: context-map` |
| Matrix | `type: matrix` |
| Capability map | `type: capabilities` |
| Teams & org chart | `type: teams` |
| Class diagram | `type: class` |
| Mind map | `type: mindmap` |

The type's name in the editor's header opens a card with its id (`type: systems`), and `carto types` lists both.

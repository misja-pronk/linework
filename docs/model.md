# One model, many diagrams

Architecture drawings repeat themselves: the same orders API shows up in the context diagram, the container diagram and the Azure deployment. Cartography lets you describe it once and reference it everywhere, while every diagram stays a plain YAML file of its own type. Four pieces make that work: `include:`, a shared `elements:` catalogue, `views:` and `links:`.

The examples below are in [examples/model](../examples/model): `model.yaml`, `context.yaml`, `containers.yaml` and `deployment.yaml`.

## include: other files

Any diagram can pull in other YAML files, relative to itself:

```yaml
type: azure
include: [network.yaml, model.yaml]
nodes:
  api: { kind: container-app, in: apps }
```

- An included file is either a `type: model` file or a diagram of the same type (a file without `type:` counts as the same type).
- Maps (`nodes`, `groups`, `tables`, …) merge key by key; lists (`edges`, ERD `relations`, …) are appended. The diagram's own entries come first, so their ids, edge numbers and pins stay as they are.
- An id that is in two files is an error, shown on the `include:` line with the file it came from. So are include cycles (`a.yaml → b.yaml → a.yaml`), unreadable files and problems inside an included file (`parts.yaml:4: …`).
- A file reached twice through different includes is read once.
- `carto watch` re-renders when an included file changes; the editor reads includes from the open folder, and the bundled examples read them from the bundle.
- In the editor, entries from another file can be selected and moved, but are edited in that file.

## A shared catalogue: elements and relations

A `type: model` file (or the `elements:` of any architecture or Azure diagram) describes things once:

```yaml
type: model
elements:
  customer: { kind: person, label: Customer, description: Buys things in the web shop }
  shop:
    kind: system
    label: Web shop
    elements:                       # parts, addressed as shop.web, shop.api, …
      web: { kind: client, label: Storefront, technology: React, tags: [public] }
      api: { kind: api, label: Orders API, technology: .NET 9, links: [deployment.yaml] }
      db: { kind: database, label: Orders DB, technology: PostgreSQL }
  stripe: { kind: payments, label: Stripe, tags: [external] }
relations:
  - customer -> shop.web: Browses and orders
  - shop.web -> shop.api: { label: REST, style: sync }
  - shop.api -> stripe: Charges cards
```

Element fields: `kind`, `label`, `description` (tooltip in SVG), `technology` (shown as the caption), `owner`, `tags`, `links`, `icon`, `tone`, and nested `elements`. Relations use the usual edge shorthand with dotted ids.

### Referencing elements

Nodes and groups of the graph types (architecture `systems`, `azure`; Kubernetes later) reference elements instead of redefining them:

```yaml
type: systems
include: [model.yaml]
nodes:
  customer:                         # just the id: the element with that id, as it is
  shop: { ref: shop, links: ['containers.yaml#containers'] }   # fields written here win
```

```yaml
type: azure
include: [model.yaml]
nodes:
  api: { ref: shop.api, kind: container-app, in: apps }   # Azure's kind, the model's label and links
  db: { ref: shop.db, in: data }                          # database → SQL Database
```

- The element brings label, kind, technology (as caption), description, tags and links; anything written on the node wins.
- **Kinds map per type.** A kind the type knows is used as is; a group kind on a card works too (a `system` drawn closed). Otherwise the type's aliases apply: in Azure `database → sql-database`, `queue → service-bus`, `api → app-service`, `person → user`, …; in the architecture type `person → user`, `software-system → system`. A kind with no match is drawn as a neutral card, with a warning that suggests setting `kind:` on the node.
- **Relations are drawn for you** between whatever the diagram shows. A relation to a part of something shown closed ends on that thing: `customer → shop.web` becomes `customer → shop` in a context diagram (C4's implied relations). An edge you write between the same two wins, so a deployment can say `api -> db: { style: private }`.
- The model's relation `style` is kept when the type knows it (`sync`, `async`, `data` in the architecture type).

## views: one file, several drawings

A view says what one drawing shows. Views live in the diagram (or in the model file, for rendering the model itself):

```yaml
type: systems
include: [model.yaml]
views:
  containers:
    title: Web shop — containers
    expand: [shop]                  # open the shop into a boundary with its parts
  ordering:
    title: Placing an order
    expand: [shop]
    exclude: [shop.bus, shop.worker, mail]
```

Rules, in `include:` and `exclude:`:

| Rule | Picks |
|---|---|
| `shop`, `shop.api`, `web` | that element or node |
| `shop.*` | its parts (model) or what sits `in:` it (groups) |
| `tag:external` | elements with that tag |
| `kind:database` | elements of that kind |
| `*` | everything at the top level (and everything written in the diagram) |
| `'* -> shop'`, `'shop.api -> *'` | relations, and the ends they connect (at the level of detail shown) |

- `include` defaults to `*`. `expand` draws an element as a boundary and adds its parts; `exclude` takes elements out, or relations when the rule has an arrow.
- What sits in a group keeps the group. `title`, `subtitle` and `direction` override the diagram's.
- Without a view a diagram draws what it says. A diagram that only has views (like `containers.yaml`) draws its first.
- Diagrams of other types (ERD, access, GitHub, data products) take views too, by id, `id.*` and relation rules.
- Views of an included model stay the model's: `carto render model.yaml --view landscape` draws them.

CLI:

```sh
carto render containers.yaml --view ordering     # → containers-ordering.svg
carto render containers.yaml --all-views         # → containers.svg plus containers-<view>.svg for each
```

In the editor a view menu appears in the canvas tools when the diagram has views.

### C4 views

A view can also say which C4 diagram it is (`kind: landscape | context | container | component | dynamic | deployment`, with `of:` the element it is about); it then picks its elements itself, and in a `type: c4` diagram (or a model file with such views) it is drawn in C4 notation. See [c4.md](c4.md).

## links: drill-down

Any element can link to a URL, another diagram or a view:

```yaml
links:
  - https://wiki.example.com/orders          # opens in a new tab
  - deployment.yaml                          # another diagram, relative to this file
  - containers.yaml#containers               # one of its views
  - '#ordering'                              # another view of this diagram
  - { to: adr/0007-postgres.md, label: ADR 7 }
```

- Linked elements carry a small link icon.
- **SVG exports** contain real `<a href>` links. Links to diagrams point at the SVG the CLI writes next to them (`containers.yaml#containers` → `containers-containers.svg`), so a folder rendered with `--all-views` can be clicked through in a browser.
- **In the editor** ⌘-click (Ctrl-click elsewhere) follows the first link, and the inspector lists them all: URLs open in a new tab, diagrams and views open in place (from the open folder, or among the bundled examples).
- Links in an included model are relative to the model file; Cartography rebases them for the diagram.

## Pins per view

Moved elements are saved in `<name>.layout.json` as before. Each view keeps its own:

```json
{
  "version": 1,
  "nodes": { "web": { "x": 120, "y": 40 } },
  "views": { "ordering": { "nodes": { "stripe": { "x": 900, "y": 300 } } } }
}
```

The top level holds the pins of the diagram as written, so existing sidecars keep working unchanged.

## How it fits together

`include:` merging and the catalogue are in `@cartography/core` (`include.ts`, `catalogue.ts`). For graph types, refs and views are resolved into plain nodes, groups and edges before the type builds them (`views.ts`), so each type's kinds, edge styles and legend still apply; other types are filtered by id after they built their graph. Diagrams without any of these keys go through exactly the old path.

# One model, many diagrams

Architecture drawings repeat themselves: the same orders API shows up in the context diagram, the container diagram and the Azure deployment. Cartography lets you describe it once and reference it everywhere, while every diagram stays a plain YAML file of its own type. Four pieces make that work: `include:`, a shared `elements:` catalogue, `views:` and `links:`.

The examples below are in [examples/model](../examples/model): `model.yaml`, `context.yaml`, `containers.yaml` and `deployment.yaml`. [examples/deployment](../examples/deployment) deploys one model to Azure and to AWS, per environment (see [Deployments](#deployments-of-what-a-resource-runs)).

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
- What an included file says about itself stays its own: its `title`, `subtitle`, `direction`, `focus` and `steps`, and its look and language (`theme`, `icons`, `aspect`, `lang`). The diagram that includes it decides those for the drawing, so a file made in the Dutch editor (`lang: nl`) can be included in an English diagram and the other way round.
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

Nodes and groups of the graph types (architecture `systems`, `azure`, `cloud`, `kubernetes`) reference elements instead of redefining them:

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

## Deployments: `of:` what a resource runs

`ref:` says a node **is** the element: one node per element. A deployment needs something else: this Container App **runs** the Orders API, and in production two of them do. That is `of:`, on a node or group of an `azure`, `cloud` or `kubernetes` diagram:

```yaml
type: cloud
provider: aws
include: [model.yaml]
groups:
  az-a: { kind: zone, zone: eu-west-1a }
  az-b: { kind: zone, zone: eu-west-1b, env: prod }
nodes:
  api-a: { of: shop.api, kind: ecs, in: az-a }      # "Orders API", captioned "ECS service · .NET 9"
  api-b: { of: shop.api, kind: ecs, in: az-b }      # the same container, a second time
  db: { of: shop.db, in: az-a }                     # database → RDS, by the type's aliases
  queue: { of: shop.bus, kind: sqs, label: orders-queue }   # own name: "order-events · SQS queue"
views:
  prod: { environment: prod, complete: true }
  dev: { environment: dev, complete: [shop.api, shop.db] }
```

- **Name and caption.** The node takes the element's name. The caption says what it runs on when you set `kind:` yourself, then the element's technology (`Container App · .NET 9`). A node with its own `label:` keeps it and names the element in the caption. `caption:`, `description:` and anything else written on the node win, as with `ref:`.
- **Link back.** The node links to the model file, at the view that shows the element when there is one (`model.yaml#containers`), after any `links:` of its own; its tooltip reads `Runs Orders API (shop.api): …`. The element's own links are not copied (they tend to point at this very deployment). The other way round is one line in the model: `links: ['azure.yaml#prod']` on the element.
- **Any number of instances.** Several nodes may be `of:` the same element; `ref:` and `of:` can be used side by side, but not on one node.
- **Relations are drawn between the instances.** `shop.api → shop.db` becomes a line from every node that runs the API to the nodes that run the database: the ones in the same group (zone, subnet, resource group) when there are any, otherwise all of them. So each zone's API talks to its own zone's cache and to the one shared database.
- **Lines you write come first.** An edge written between the same two nodes wins (`api -> db: { style: private }`), and a relation is left out when the written lines already lead there: with `cdn -> alb -> api` written, the model's `web → api` is not drawn again from the CDN. `exclude: ['shop.api -> shop.bus']` takes a relation out by its element ids.
- **Errors.** `of:` an id that is not in the model is an error on that line, as is `of:` without a model.

### Environments

One file can hold dev, test and production. `env:` on a node, group or edge says which environments have it (a name or a list); a view picks one with `environment:`.

- What has no `env:` is in every environment. What sits in a group that is left out goes with it, and so do the lines to it.
- An environment nothing is tagged for is simply what is left: `dev` without the extras of `prod`. A view with `environment:` in a file where nothing has `env:` at all gets a warning.
- Without a view the diagram draws everything, every environment at once. Then what only some environments have carries their names as tags (`prod`, `test · prod` on a card or a zone, `dev` after a line's label), and the key says that what has no tag is in all of them.
- `carto render aws.yaml --all-views` writes one picture per environment.

### Complete or not

`complete: true` on a view claims that everything in the model runs somewhere in it. Every part (container, database, queue, …) that no node is `of:` (or `ref:`) gets a warning: `Nothing runs "shop.worker" (Mailer) in prod: add a node with of: shop.worker`. People and external systems are not expected to be deployed. `complete: [shop.api, shop.db]` checks only those, for an environment that leaves parts out on purpose. `carto validate` checks every view of a file, so a part that was added to the model and not deployed shows up in CI.

A `kind: deployment` view of a C4 diagram takes `of:` on a deployment node and `complete:` in the same way; see [c4.md](c4.md#deployment-views).

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
- A view can be told in parts: `steps:` inside the view, see [steps.md](steps.md). When presenting, the views come in the order written.

CLI:

```sh
carto render containers.yaml --view ordering     # → containers-ordering.svg
carto render containers.yaml --all-views         # → containers.svg plus containers--<view>.svg for each
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
- **SVG exports** contain real `<a href>` links. Links to diagrams point at the SVG the CLI writes next to them (`containers.yaml#containers` → `containers--containers.svg`), so a folder rendered with `--all-views` can be clicked through in a browser.
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

## A folder of them

Open the folder in the editor (or `carto serve` it) and its diagrams include one another and follow their links. `carto validate <folder>` checks each diagram in it, and `carto export --to html <folder>` writes all of them into one file that drills down from the landscape. See [examples/workspace](../examples/workspace).

## How it fits together

`include:` merging and the catalogue are in `@cartography/core` (`include.ts`, `catalogue.ts`). For graph types, refs and views are resolved into plain nodes, groups and edges before the type builds them (`views.ts`), so each type's kinds, edge styles and legend still apply; other types are filtered by id after they built their graph. Diagrams without any of these keys go through exactly the old path.

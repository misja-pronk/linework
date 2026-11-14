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

## each: a pattern for a list of values

A platform of twenty domains through dev, test and prod has sixty catalogs, sixty storage accounts and hundreds of relations that all look alike. `each:` names lists at the top of a file, and `<name>` in what the file says stands for one value of a list:

```yaml
type: model
each:
  domain:                                   # values with fields: <domain.team>
    orders: { team: Order management }
    webshop: { team: Web shop }
  env: [dev, test, prod]                    # or just the values
elements:
  <domain>-team: { kind: users, label: <domain.team> team }
  dbw-lakehouse-<env>: { kind: databricks, tags: [<env>] }
  uc-weu:
    kind: metastore
    elements:
      <domain>_<env>: { kind: catalog, owner: <domain>-team, tags: [<env>] }   # six catalogs
relations:
  - uc-weu.<domain>_<env> -> dbw-lakehouse-<env>: Bound                       # six relations
  - <domain>-team -> uc-weu.<domain>_dev: Owns                                  # two
views:
  <env>:                                                                      # a view per environment
    title: Catalogs in <env>
    include: [uc-weu.<domain>_<env>, dbw-lakehouse-<env>]                     # both domains' catalogs
```

- **What repeats.** An entry whose name (the key) says `<domain>` is written once per domain; one that says `<domain>_<env>` once per domain and environment, the first list named outermost. So is a list item that names a list: a relation, an assignment, an id in a view's `include:`. The written-out entries take the place of the pattern, in order, so ids and edge order are the same every time.
- **What is filled in.** Inside an entry, `<domain>` is the entry's own domain: in its label, caption, technology, tags, owner, `in:`, `of:`, parts, and the relations and grants written inside it. `<domain.team>` is a field of the value. A list item names what the entry around it does not, so `include: [uc-weu.<domain>_<env>]` in the view `<env>` is every domain's catalog in that environment.
- **One way to write many.** Relations whose ends follow a pattern are written with the same placeholders (`uc-weu.<domain>_prod -> dbw-lakehouse-prod`), not with wildcards: every end is a name the file writes, checked like any other, and nothing is picked up by accident (`*_prod` would match a credential named `cred_x_prod` as readily as a catalog).
- **Everywhere.** In models and in diagrams of every type: nodes, groups, edges, an access diagram's principals, resources and assignments, layers, views and steps. `each:` belongs to the file it is written in, like its title: a diagram that includes a model writes the lists it uses itself (one line each).
- **Problems are said where the pattern is written.** A placeholder no list has is an error on its line, with the lists there are (`<domian> is not a list of each: did you mean <domain>?`); so is a name two patterns (or a pattern and an entry) both write, and a placeholder in a value the entry around it does not name (`label: In <env>` on an entry written once). A problem in a written-out entry (an unknown kind, a missing group) is said once, at the pattern, with the values it is about: `There is no group "nowhere" (for domain orders, and 19 more)`.
- **`<` as text.** A file without `each:` is read exactly as before, `List<Order>` and all. In a file with it, `\<id>` is the text `<id>`.
- **Why `<domain>`.** `{domain}` starts a map in YAML: `label: {domain}_{env}` would not even parse, and the flow maps this idiom is written in (`{ kind: catalog, label: … }`) take no braces in their values. `<domain>` needs no quotes as a key or a value, and is how architecture notes already write it (`<domain>_<env>`).
- **In the editor.** ⌘K and describe list the written-out names (`orders_prod`). Selecting one shows the pattern in the YAML; it is changed there, for every value at once (renaming or deleting one value on its own would leave the others behind).

[examples/databricks-at-scale](../examples/databricks-at-scale) writes twenty domains through three environments in about 150 lines of model (621 elements, 592 relations) and 100 of grants (191); [types.md](types.md#roles-groups-and-access-packages) lays the access matrix out by the same lists (`rows: domain`, `columns: env`).

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
- Three detailed environments side by side are seldom one slide: `present: views` makes the whole a working canvas and the views the slides (see [present: views](#present-views--the-whole-is-a-working-canvas)).

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
| `vnet-prod` (a group written here) | the group with everything written in it, at any depth |
| `shop.*` | its parts (model) or what sits `in:` it (groups) |
| `tag:external` | elements with that tag |
| `env:prod` | what is written for that environment: its own `env:` or that of a group around it names it |
| `kind:database` | elements of that kind |
| `*` | everything at the top level (and everything written in the diagram) |
| `'* -> shop'`, `'shop.api -> *'` | relations, and the ends they connect (at the level of detail shown) |

- `include` defaults to `*`. `expand` draws an element as a boundary and adds its parts; `exclude` takes elements out (a group with what is in it), or relations when the rule has an arrow.
- What sits in a group keeps the group. An element drawn together with parts of it is their boundary, as if expanded, with only those parts in it: `include: [sub-prod, sub-prod.vnet, sub-prod.vnet.snet-pep]` draws the subnet inside its VNet inside its subscription. `title`, `subtitle` and `direction` override the diagram's.
- Without a view a diagram draws what it says. A diagram that only has views (like `containers.yaml`) draws its first.
- Diagrams of other types (ERD, GitHub, data products) take views too, by id, `id.*` and relation rules. An access diagram applies a view itself, to its graph and its tables alike (see [types.md](types.md#roles-groups-and-access-packages)).
- `show:` picks one of the type's own drawings for the view, cut to it: `show: access` is an access diagram's who × where matrix of only what the view keeps. A view named like one of those drawings gets a warning: asked for by that name, the type's drawing is drawn.
- Views of an included model stay the model's: `carto render model.yaml --view landscape` draws them.
- `exclude:` at the top of a diagram leaves relations of the model out of the drawing as written and of every view, by the same arrow rules: `exclude: ['uc-weu -> lakehouse']`. Lines written in the diagram stay. A node is left out by not writing it, so a rule without an arrow there gets a warning.
- A view can be told in parts: `steps:` inside the view, see [steps.md](steps.md). When presenting, the views come in the order written.

CLI:

```sh
carto render containers.yaml --view ordering     # → containers-ordering.svg
carto render containers.yaml --all-views         # → containers.svg plus containers--<view>.svg for each
```

In the editor a view menu appears in the canvas tools when the diagram has views.

### C4 views

A view can also say which C4 diagram it is (`kind: landscape | context | container | component | dynamic | deployment`, with `of:` the element it is about); it then picks its elements itself, and in a `type: c4` diagram (or a model file with such views) it is drawn in C4 notation. See [c4.md](c4.md).

### present: views — the whole is a working canvas

A detailed deployment of three environments never fits one slide, while each environment does. `present: views` at the top says so: the drawing as written is the canvas you work on, and the views are what is presented.

```yaml
type: azure
include: [model.yaml]
present: views
groups:
  vnet-lakehouse-prod: { ref: vnet-lakehouse-prod, env: prod }
  vnet-lakehouse-dev: { ref: vnet-lakehouse-dev, env: dev }
nodes: …
views:
  prod: { environment: prod, steps: [ … ] }
  test: { environment: test }
  dev: { environment: dev }
```

- Without a view the first view is drawn, as for a file of only views. The whole drawing is drawn when asked for by the empty view name: "Whole diagram" in the editor's view picker, `--view ''` on the command line.
- `carto validate` measures the views (and their steps) on their slides, never the whole.
- The type's own drawings of the whole (an access diagram's who × where of everything) are part of the canvas too: a view with `show:` presents one, cut.
- `carto render x.yaml -o x.pptx` (or `.pdf`), `--all-views` and `carto deck` write the views, a slide (page, picture) each; `carto describe` describes each view; the HTML export and presenting in the editor show the views. A PowerPoint or PDF exported in the editor while the whole is on screen holds the views.
- The editor opens the file on its first view; V goes round the views.
- Steps belong in the views: steps written at the top get a warning, since the whole is not presented. `present: whole` is the default. Without views, `present: views` gets a warning and the drawing is the slide.

Examples: [examples/databricks/deployment.yaml](../examples/databricks/deployment.yaml), dev, test and production of one lakehouse, a spoke each; [examples/databricks/governance.yaml](../examples/databricks/governance.yaml), its Unity Catalog grants, a view per concern.

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
- **In the editor** ⌘-click (Ctrl-click elsewhere) follows the first link, and the inspector lists them all: URLs open in a new tab, diagrams and views open in place (from the open folder, or among the bundled examples). **Back to …** over the drawing, or ⌘[ (Ctrl+[), goes back to where the link was followed from, in the view it showed; a walk of several links comes back one step at a time.
- Double-click on a linked card still renames it, as on any card: the editor is for changing the drawing, and a slip of the mouse should not take you to another file. Following is the deliberate ⌘-click. While presenting (P), ⌘-click or Tab and ↵ follows a link, and ⌫ (or the Back button) comes back.
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

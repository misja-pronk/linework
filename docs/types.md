# Which diagram type do I need?

Every diagram starts with `type:`. The type decides what you can put in it (the shapes, how they nest, what a line means) and how it is laid out. Pick the one that matches the question your diagram answers. When unsure, start with **Architecture** (`systems`): it fits most systems and you lose nothing by switching later.

The same guidance is in the editor (New → *What do you want to draw?*, or click the type pill in the top bar) and on the command line:

```sh
carto types                    # every type, what it is for, what it is not for
carto types who has access     # the types that match your words, best first
carto new erd orders.yaml      # start from a type's template
```

## Decision table

| You want to show… | Type | `type:` |
| --- | --- | --- |
| Services, apps, queues and databases and how they talk; anything when unsure | [Architecture](#architecture) | `systems` |
| What runs where in Azure: subscriptions, resource groups, VNets, subnets | [Azure infrastructure](#azure-infrastructure) | `azure` |
| Tables, columns, keys and how tables relate | [Database design](#database-design) | `erd` |
| Who gets access to what, through which group, package or role | [Roles, groups and access packages](#roles-groups-and-access-packages) | `access` |
| How a GitHub organisation is set up: teams, repos, workflows, environments | [GitHub design](#github-design) | `github` |
| Data products, their ports, contracts and consumers (data mesh) | [Data products](#data-products) | `data-products` |

Look-alikes that trip people up:

- **A service that uses a database** is Architecture; **the tables inside it** are Database design.
- **Azure resources and networks** are Azure infrastructure; **who may touch them** is Access.
- **GitHub teams and repository permissions** are GitHub design; **Entra groups and Azure roles** are Access.
- **ETL jobs as boxes and arrows** are Architecture; **products with ports and contracts** are Data products.

## Architecture

`type: systems` · boxes and arrows: the parts of a system and how they talk.

Use it for any system overview: services, clients, queues, databases and external systems in nestable groups (system, zone, cloud, region). It is cloud-neutral, so it suits design docs and onboarding, and it is what a Mermaid import becomes.

Not for: what runs in which Azure subnet (use `azure`), table columns (use `erd`), who may access what (use `access`).

```yaml
type: systems
title: Web shop
nodes:
  web: { kind: client, label: Storefront }
  orders: { kind: service, label: Orders }
  db: { kind: database, label: Orders DB }
edges:
  - web -> orders: REST
  - orders -> db: SQL
```

Examples: [examples/systems](../examples/systems)

## Azure infrastructure

`type: azure` · what runs where in Azure: subscriptions, resource groups, networks.

Use it to map the resources in a subscription, show which VNet or subnet each service sits in, or draw hub and spoke, private endpoints, Front Door and firewalls. Supporting links (Key Vault, identities) can be badges instead of lines.

Not for: a cloud-neutral overview (use `systems`), Entra groups and roles (use `access`).

```yaml
type: azure
title: Web shop
groups:
  rg: { kind: resource-group, label: rg-shop-prod }
nodes:
  web: { kind: app-service, label: Web shop, in: rg }
  db: { kind: sql-database, label: Orders, in: rg }
edges:
  - web -> db: SQL
```

Examples: [examples/azure](../examples/azure)

## Database design

`type: erd` · tables, columns and keys, with crow's-foot relations.

Use it to design a schema before writing migrations, to explain one-to-many and many-to-many relations, or to document an existing schema. Relations and their cardinality follow from the keys you write (`fk`, `pk`, `null`).

Not for: which services use the database (use `systems`), data products and their contracts (use `data-products`).

```yaml
type: erd
title: Orders
tables:
  customers: { columns: { id: uuid pk, email: text unique } }
  orders: { columns: { id: uuid pk, customer_id: uuid fk customers } }
```

Examples: [examples/erd](../examples/erd)

## Roles, groups and access packages

`type: access` · who gets access to what: groups, access packages and roles.

Use it to show which group or access package grants which role on which resource, to answer "who can reach production?" as a matrix (`view: access`), or to review Entra ID governance: catalogs, packages, approvals. One file gives four views: `graph`, `access`, `packages` and `roles`.

Not for: where the resources run (use `azure`), GitHub teams and repository permissions (use `github`).

```yaml
type: access
title: Engineering access
principals:
  engineers: { kind: group, label: Engineers }
resources:
  prod: { kind: subscription, label: Production }
roles:
  reader: { label: Reader }
```

Examples: [examples/access](../examples/access)

## GitHub design

`type: github` · how a GitHub organisation is set up: teams, repos, workflows.

Use it to plan teams and who may write to which repository, to show workflows, environments and where they deploy (OIDC included), or to document rulesets, secrets, runners and apps.

Not for: Entra or cloud role assignments (use `access`), the services the code becomes (use `systems`).

```yaml
type: github
title: GitHub setup
groups:
  shop: { kind: repo, label: acme/shop }
nodes:
  devs: { kind: team, label: Developers }
  ci: { kind: workflow, label: ci.yml, in: shop }
edges:
  - devs -> shop: { label: write, style: access }
```

Examples: [examples/github](../examples/github)

## Data products

`type: data-products` · data mesh: domains, products, their ports, contracts and consumers.

Use it to show which data products feed which through which input and output ports, to link data contracts (ODCS files next to the diagram) to the ports they describe, or to map who consumes a product: reports, models, apps.

Not for: the tables inside one database (use `erd`), ETL jobs and services as boxes (use `systems`).

```yaml
type: data-products
title: Customer data
domains:
  sales: { label: Sales }
products:
  customers: { label: Customers, domain: sales }
```

Examples: [examples/data-products](../examples/data-products)

## Adding a type

A type describes itself with a few optional fields on its `DiagramType` (`packages/core/src/diagram-type.ts`): `icon`, `tagline`, `useWhen`, `notFor` (with `use` pointing at a better type id) and `keywords` for the search box. The start dialog, `carto types` and the editor pick them up; add a section and a row to this page too.

# Which diagram type do I need?

Every diagram starts with `type:`. The type decides what you can put in it (the shapes, how they nest, what a line means) and how it is laid out. Pick the one that matches the question your diagram answers. When unsure, start with **Architecture** (`systems`): it fits most systems and you lose nothing by switching later.

The same guidance is in the editor (New → *What do you want to draw?*, or click the type pill in the top bar) and on the command line:

```sh
carto types                    # every type, what it is for, what it is not for
carto types who has access     # the types that match your words, best first
carto new erd orders.yaml      # start from a type's template
```

Whatever the type, a drawing can be told in parts for an audience: `steps:` says what is shown and what stands out at each step, for the presenter in the editor and for one slide per step in PowerPoint. See [steps.md](steps.md).

## Decision table

| You want to show… | Type | `type:` |
| --- | --- | --- |
| Services, apps, queues and databases and how they talk; anything when unsure | [Architecture](#architecture) | `systems` |
| C4: system context, containers, components, dynamic and deployment views of one model | [C4 model](#c4-model) | `c4` |
| What runs where in Azure: subscriptions, resource groups, VNets, subnets | [Azure infrastructure](#azure-infrastructure) | `azure` |
| Network topology: zones, VLANs, firewalls, switches and links; an IP plan | [Network](#network) | `network` |
| Tables, columns, keys and how tables relate | [Database design](#database-design) | `erd` |
| Who gets access to what, through which group, package or role | [Roles, groups and access packages](#roles-groups-and-access-packages) | `access` |
| How a GitHub organisation is set up: teams, repos, workflows, environments | [GitHub design](#github-design) | `github` |
| Data products, their ports, contracts and consumers (data mesh) | [Data products](#data-products) | `data-products` |
| Who calls whom, in what order: a login flow, an API integration, event choreography | [Sequence](#sequence) | `sequence` |

Look-alikes that trip people up:

- **A service that uses a database** is Architecture; **the tables inside it** are Database design.
- **A quick boxes-and-arrows sketch** is Architecture; **a context diagram that drills down into containers and components** is the C4 model.
- **Azure resources and networks** are Azure infrastructure; **who may touch them** is Access.
- **Firewalls, switches, VLANs and circuits** are Network; **the Azure resources behind them** are Azure infrastructure.
- **GitHub teams and repository permissions** are GitHub design; **Entra groups and Azure roles** are Access.
- **ETL jobs as boxes and arrows** are Architecture; **products with ports and contracts** are Data products.
- **Which services talk to each other** is Architecture; **the order they talk in, step by step** is Sequence.

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

## C4 model

`type: c4` · one model, C4 views: context, containers, components, deployment.

Use it when you work the way Structurizr, LikeC4 or IcePanel do: describe people, software systems, containers and components once, then draw a landscape, a system context, a container or component diagram, a numbered dynamic view or a deployment view from it. Cards read like C4 (`[Container: Spring Boot]` and a short description), external systems are greyed, boundaries are dashed, the legend fills itself and each card links down to the next level. Structurizr DSL imports with `carto import workspace.dsl`.

Not for: a quick sketch without levels (use `systems`), Azure resources and networks (use `azure`).

```yaml
type: c4
elements:
  customer: { kind: person, label: Customer }
  shop:
    label: Web shop
    elements:
      web: { kind: web-app, label: Storefront, technology: Next.js }
      db: { kind: database, label: Orders DB, technology: PostgreSQL }
relations:
  - customer -> shop.web: { label: Orders, technology: HTTPS }
  - shop.web -> shop.db: Reads and writes
views:
  context: { kind: context, of: shop }
  containers: { kind: container, of: shop }
```

Examples: [examples/c4](../examples/c4) · guide: [c4.md](c4.md)

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

## Network

`type: network` · zones, VLANs, devices and links, from the internet down.

Use it for an office or campus (firewall, switches, access points, VLANs), a data centre, or hybrid connectivity: VPN and ExpressRoute or Direct Connect into a hub and spokes. It reads top-down by default, internet first.

- **Zones** are groups with their address range and VLAN in the caption: `internet`, `wan`, `dmz`, `lan`, `vlan`, `zone`, `site`, `branch`, `datacenter`, `region`, `vpc`, `vnet`, `subnet`. Overlapping ranges, a subnet outside its parent and a device IP outside its zone are warned about.
- **Devices**: `router`, `firewall`, `waf`, `ids`, `vpn-gateway`, `cloud-gateway` (ExpressRoute, Direct Connect), `nat`, `load-balancer`, `proxy`, `dns`, `l3-switch`, `switch`, `access-point`, `server`, `nas`, `storage`, `client`, `clients`, `phone`, `printer`, `camera`, plus `internet`, `isp`, `cloud`, `users`. The id is the hostname; `model`, `ip`, `cidr`, `vlan` and `ports` go in the caption.
- **HA pairs**: `ha: true` (or a word, `ha: vPC`) draws the card as a stacked pair.
- **Tiers**: `tier: internet | edge | core | distribution | access | endpoint` puts devices of one tier on one row across zones. Without tiers, links still run from the internet side down, by kind.
- **Links** are plain lines, `a -- b` or `a -> b`; `flow: true` adds an arrowhead. Styles: `ethernet` (default), `fiber`, `trunk` (thick), `wan`, `circuit` (ExpressRoute, MPLS), `vpn` (dashed, with a lock), `peering`, `wireless` (dotted), `ha`, `mgmt`. `speed`, `count` (an aggregated link: one thick line, "2×10G"), `vlans` and `ports` make the label.
- **IP plan**: `view: table` draws the same file as a table of device, interface, IP, VLAN and zone, from `ip` or `interfaces: { eth0: 10.0.0.1/24, mgmt: { ip: …, vlan: 1, zone: mgmt } }`.

Not for: which Azure resources run where (use `azure`), how services call each other (use `systems`), pods and services in a cluster (use `kubernetes`).

```yaml
type: network
title: Office
groups:
  office: { kind: site, label: Utrecht, cidr: 10.20.0.0/16 }
  staff: { kind: vlan, label: Staff, in: office, vlan: 10, cidr: 10.20.10.0/24 }
nodes:
  isp: { kind: isp, label: Fibre ISP }
  fw: { kind: firewall, in: office, model: FortiGate 60F, ha: true, ip: 10.20.1.1 }
  core: { kind: switch, in: office, model: USW Pro 24 }
  ap: { kind: access-point, in: staff }
edges:
  - isp -- fw: { style: wan, speed: 1G }
  - fw -- core: { style: trunk, speed: 10G, count: 2, vlans: [1, 10, 20] }
  - core -- ap
```

Import an inventory with `carto import inventory.csv` (columns `name,type,ip,zone,uplink`, optionally `model`, `vlan`, `cidr`, `tier`, `speed`; `uplink` may name a port as `core01:Gi1/0/1`) or a NetBox export (`{ devices, cables, ip_addresses }`, each as JSON from the API).

Examples: [examples/network](../examples/network)

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

## Sequence

`type: sequence` · who calls whom, in what order: calls, replies, async events.

Use it for a login or OAuth flow step by step, an integration with a payment provider, event choreography between services, or a handshake between two systems.

Not for: which services exist and how they connect, or a process flow with decisions (both `systems`).

```yaml
type: sequence
title: Checkout
autonumber: true                  # number the messages
boxes:
  shop: Web shop                  # participants drawn together in one box
participants:
  shopper: person                 # person, client, service, api, database, queue, topic, external, …
  orders: { kind: service, label: Orders, box: shop }
  psp: { kind: payments, label: Stripe }
steps:
  - shopper -> orders: Place order          # call: opens an activation on orders
  - orders -> orders: Validate cart         # self-call
  - orders ->> psp: Create payment          # async message
  - alt: Paid                               # frames: alt/else, opt, loop, par/and, break, critical, group
    steps:
      - psp --> orders: succeeded           # reply (dashed), closes the activation
    else:
      Declined:
        - psp -x orders: card_declined      # lost / failed
  - note: Webhooks are the source of truth  # notes: over (one or more), left or right
    over: [orders, psp]
  - divider: Fulfilment
  - ref: Shipping flow                      # a box pointing at another diagram
    over: [shopper, orders]
    link: shipping.yaml
```

Activations follow the calls: a call opens one on the receiver and its reply closes it; one that is never answered ends where its lifeline last takes part. `activations: explicit` draws only the ones you ask for (`a -> +b`, `b --> -a`, `activate: b`, `deactivate: b`), which is what a Mermaid import with `activate` or `+`/`-` gives. `footers: true` repeats the participants under the lifelines.

Labels never collide: every message has its own row, a long label wraps, and each gap between lifelines is as wide as its widest label. Built on the lanes engine (`packages/lanes`), which will also carry git flow, roadmaps and journeys.

Presenting: a sequence diagram steps through its messages by itself, one at a time (`P` in the editor, `carto render checkout.yaml --all-steps`). See [steps.md](steps.md).

Examples: [examples/sequence](../examples/sequence)

## Adding a type

A type describes itself with a few optional fields on its `DiagramType` (`packages/core/src/diagram-type.ts`): `icon`, `tagline`, `useWhen`, `notFor` (with `use` pointing at a better type id) and `keywords` for the search box. The start dialog, `carto types` and the editor pick them up; add a section and a row to this page too.

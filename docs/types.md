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
| Who calls whom, in what order: a login flow, an API integration, event choreography | [Sequence](#sequence) | `sequence` |
| A branching strategy: branches, merges, tags, releases; or how branches reach production | [Git branching](#git-branching) | `gitflow` |
| What happens when: workstreams, milestones, migration waves, a delivery plan | [Roadmap & timeline](#roadmap--timeline) | `roadmap` |

Look-alikes that trip people up:

- **A service that uses a database** is Architecture; **the tables inside it** are Database design.
- **Azure resources and networks** are Azure infrastructure; **who may touch them** is Access.
- **GitHub teams and repository permissions** are GitHub design; **Entra groups and Azure roles** are Access.
- **ETL jobs as boxes and arrows** are Architecture; **products with ports and contracts** are Data products.
- **Which services talk to each other** is Architecture; **the order they talk in, step by step** is Sequence.
- **Repositories and teams in a GitHub org** are GitHub design; **how branches in one repo merge and release** is Git branching.
- **The steps of one flow** are Sequence; **work spread over weeks and months** is Roadmap.

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

Labels never collide: every message has its own row, a long label wraps, and each gap between lifelines is as wide as its widest label. Built on the lanes engine (`packages/lanes`), which also carries git branching and roadmaps.

Examples: [examples/sequence](../examples/sequence)

## Git branching

`type: gitflow` · branches, merges and releases: a branching strategy at a glance.

Use it to explain Git Flow, GitHub Flow or trunk-based development to a team, to show how releases and hotfixes reach main, which branch deploys where, or to draw a real repository's history.

Not for: the order services call each other (`sequence`), or which repositories and teams an organisation has (`github`).

A preset alone draws a whole strategy; your own steps continue its history:

```yaml
type: gitflow
preset: gitflow                   # gitflow | github-flow | trunk-based | release-branches
```

```yaml
type: gitflow
title: Our flow
branches:
  main: { tone: indigo }          # optional: tone, family, from, keep (long-lived), label
environments: [test, production]  # optional: a track under the branches
steps:
  - commit: main
    label: Initial release
    tag: v1.0.0                   # tags (pills above the dot), notes ("PR review"), deploy: <env>
  - commit: feature/login         # a branch is created on first use, from develop (or main)
    label: Login form
  - commit: feature/login
    note: PR review
  - merge: feature/login -> main
    deploy: production
  - branch: release/1.1           # fork now, from: develop by default
  - commit: main
    count: 12                     # a collapsed run: "12 commits"
  - cherry-pick: fix-1            # a commit id, copied into: a branch (dashed curve)
    into: release/1.1
  - tag: v1.1.1                   # tag, note or deploy the newest commit on on:
    on: release/1.1
```

Branch names say what they are: `main`/`master`/`trunk`, `develop`, `release/*`, `hotfix/*`, `feature/*` (also `feat/`, `fix/`, `bugfix/`) each get their own colour and lane, top to bottom: main, hotfixes, releases, develop, features. Short-lived branches with the same prefix share a lane when they do not overlap in time. Every commit owns a column of one time axis; the lanes engine spreads the columns so labels never touch, and keeps every fork, merge and deploy line clear of the text it passes. Forks leave their commit vertically and merges arrive vertically (with an arrowhead), so a commit's label always has a free side; a second line from the same commit splits off the line a little later instead of sharing a stretch.

`view: delivery` draws the same branches through a CI/CD pipeline: stages as columns (Build, Test, Staging, Production by default; your own with `stages:`), one row per branch kind, gates such as an approval as pills on the arrow before a stage. Each preset brings its own pipelines; override them with `pipelines:` (keys: `feature`, `develop`, `release`, `hotfix`, `main`, or a branch name):

```yaml
view: delivery
pipelines:
  main: [build, test, { stage: production, label: Deploy, gate: Approval }]
```

Import: `carto import --git <repo> [--since 2026-01-01] [--branches main,develop] [--max 200]` reads `git log` and recovers branches (each head claims its first-parent history; merged and deleted branches are named from their merge message), forks, merges and tags, and collapses runs of plain commits into "n commits". Mermaid `gitGraph` imports with `carto import`.

Examples: [examples/gitflow](../examples/gitflow)

## Roadmap & timeline

`type: roadmap` · what happens when: workstreams, milestones and waves on a time axis.

Use it for a 12-month migration in waves, a delivery plan per team with milestones, a now / next / later slide for a steering group, or a project timeline from a Mermaid gantt.

Not for: the order of messages in one flow (`sequence`), or how branches merge and release (`gitflow`).

```yaml
type: roadmap
title: Azure migration 2026
from: 2026-01                     # dates: 2026, 2026-03, 2026-Q2, 2026-W14, 2026-03-15
to: 2026-12                       # inclusive; both default to the items' range
unit: month                       # week | month | quarter (default: picked from the range)
today: 2026-05-12                 # or true for the real date
lanes:
  platform: { label: Platform, caption: Landing zone and AKS }
  apps: Applications
phases:                           # bands behind the lanes: waves, phases, transition states
  Wave 1: { from: 2026-03, to: 2026-05, tone: sky }
items:
  landing-zone: { lane: platform, label: Landing zone, from: 2026-01, to: 2026-02, status: done }
  aks: { lane: platform, after: landing-zone, duration: 8w, status: active, progress: 60% }
  pilots: { lane: apps, in: 2026-Q2, status: at-risk }   # in: one month, quarter or week
  cab: { lane: apps, at: 2026-06-01, label: CAB sign-off } # a milestone
  go-live: { at: 2026-09-01, label: Go-live }             # no lane: on the axis, a line through all lanes
```

`after:` both schedules (an item without `from:` starts when what it waits for ends) and draws the dependency as an arrow. Statuses `planned` (outline), `active` (solid), `done` (check), `at-risk` and `late` colour the bars and get a legend; without a status a bar takes its lane's colour. Overlapping items, and labels too long for their bar (drawn beside it), take their own track in the lane, so nothing overlaps. `periods: [Now, Next, Later]` gives an axis of named periods instead of dates (`in: Next`, `duration: 2` periods).

Import: Mermaid `gantt` (sections become lanes; `done`, `active`, `crit` become statuses; `after` stays a dependency; milestones stay milestones) and `timeline` (periods become the axis, sections phases).

Examples: [examples/roadmap](../examples/roadmap)

## Adding a type

A type describes itself with a few optional fields on its `DiagramType` (`packages/core/src/diagram-type.ts`): `icon`, `tagline`, `useWhen`, `notFor` (with `use` pointing at a better type id) and `keywords` for the search box. The start dialog, `carto types` and the editor pick them up; add a section and a row to this page too.

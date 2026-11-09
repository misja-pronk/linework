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
| What runs where in AWS or Google Cloud: accounts, VPCs, zones, subnets; multi-cloud and hybrid | [AWS and Google Cloud](#aws-and-google-cloud) | `cloud` |
| Network topology: zones, VLANs, firewalls, switches and links; an IP plan | [Network](#network) | `network` |
| Tables, columns, keys and how tables relate | [Database design](#database-design) | `erd` |
| Who gets access to what, through which group, package or role | [Roles, groups and access packages](#roles-groups-and-access-packages) | `access` |
| How a GitHub organisation is set up: teams, repos, workflows, environments | [GitHub design](#github-design) | `github` |
| Data products, their ports, contracts and consumers (data mesh) | [Data products](#data-products) | `data-products` |
| Who calls whom, in what order: a login flow, an API integration, event choreography | [Sequence](#sequence) | `sequence` |
| A branching strategy: branches, merges, tags, releases; or how branches reach production | [Git branching](#git-branching) | `gitflow` |
| What happens when: workstreams, milestones, migration waves, a delivery plan | [Roadmap & timeline](#roadmap--timeline) | `roadmap` |
| What one person goes through and how it feels: onboarding, a request, a service blueprint | [Journey map](#journey-map) | `journey` |

Look-alikes that trip people up:

- **A service that uses a database** is Architecture; **the tables inside it** are Database design.
- **A quick boxes-and-arrows sketch** is Architecture; **a context diagram that drills down into containers and components** is the C4 model.
- **Azure resources and networks** are Azure infrastructure; **who may touch them** is Access.
- **An estate that is only Azure** is Azure infrastructure; **AWS, Google Cloud or several clouds in one picture** is AWS and Google Cloud.
- **Firewalls, switches, VLANs and circuits** are Network; **the Azure resources behind them** are Azure infrastructure.
- **GitHub teams and repository permissions** are GitHub design; **Entra groups and Azure roles** are Access.
- **ETL jobs as boxes and arrows** are Architecture; **products with ports and contracts** are Data products.
- **Which services talk to each other** is Architecture; **the order they talk in, step by step** is Sequence.
- **Repositories and teams in a GitHub org** are GitHub design; **how branches in one repo merge and release** is Git branching.
- **The steps of one flow** are Sequence; **work spread over weeks and months** is Roadmap.
- **Messages between systems** are Sequence; **what a person does, thinks and feels along the way** is a Journey map.
- **A plan with dates** is Roadmap; **an experience in phases, without dates** is a Journey map.

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

## AWS and Google Cloud

`type: cloud` · what runs where in AWS or Google Cloud: accounts, VPCs, subnets, zones.

Use it for a VPC across availability zones with its subnet tiers, a data platform (S3, Glue and Redshift, or BigQuery), a landing zone (organization, accounts or projects, networks), or a multi-cloud or hybrid picture. `provider: aws | gcp` at the top says whose words the file speaks by default; it reads top-down with `direction: down`.

- **Containers** nest the way the clouds do: `organization`, `region`, `vpc`, `zone`, `subnet`, `on-premises` and `boundary` for both; `aws`, `ou`, `account`, `security-group`, `auto-scaling-group`, `ecs-cluster`, `eks-cluster` for AWS; `gcp`, `folder`, `project`, `instance-group`, `gke-cluster`, `service-perimeter` for Google Cloud. `cidr`, `account`, `project`, `region` and `zone` go in the caption.
- **Services** are named the way you say them: `ec2`, `ecs`, `eks`, `lambda`, `s3`, `rds`, `aurora`, `dynamodb`, `redshift`, `glue`, `kinesis`, `sqs`, `sns`, `eventbridge`, `api-gateway`, `cloudfront`, `route53`, `alb`, `nat-gateway`, `transit-gateway`, `iam-role`, `kms`, `cloudwatch`, `bedrock`, … (59 for AWS) and `compute-engine`, `gke`, `cloud-run`, `cloud-functions`, `gcs`, `cloud-sql`, `spanner`, `bigquery`, `dataflow`, `pubsub`, `cloud-load-balancing`, `cloud-nat`, `service-account`, `cloud-kms`, `vertex-ai`, … (51 for Google Cloud), plus `internet`, `users`, `client`, `server`, `external` and the like. The palette in the editor lists them all by category. `size`, `zone` and `exposure: public | internal` go in the caption.
- **Subnet tiers**: `tier: public | private | isolated` on a subnet colours it and puts the subnets of one tier on one row across the zones, so three zones with the same tiers read as a grid. A node outside the subnets joins a row with `tier:` as well.
- **Mixing providers**: one file may hold AWS, Google Cloud and Azure. A service's provider follows from its kind; a container's from its kind, `provider:` or what it sits in. Every Azure kind works here too; the four that are also general words are `azure-storage`, `azure-load-balancer`, `azure-dns` and `azure-firewall`.
- **Lines**: `public`, `private`, `data`, `identity`, `peering`, `vpn` and `management`; a line without a style is a plain connection.
- **Checks**, as warnings: address ranges that overlap or fall outside their VPC (also between VPCs joined by peering, a VPN or a transit gateway), something marked `exposure: public` or a NAT gateway in a private subnet, public traffic straight into a private subnet, and a zonal resource (EC2, a disk) outside every zone once zones are drawn.
- **Model kinds** (`database`, `queue`, `api`, …) become the service that usually hosts them: RDS, SQS and ECS for `provider: aws`; Cloud SQL, Pub/Sub and Cloud Run for `gcp`. `of:` places a model's containers on the infrastructure, per environment; see [model.md](model.md#deployments-of-what-a-resource-runs).
- **Official icons** are bring-your-own, as for Azure: `carto icons import <download> --pack aws` (or `gcp`), then `--pack aws` or `icons: { pack: [aws, gcp] }`. In a mixed diagram each shape takes its icon from its own provider's pack. See [themes.md](themes.md#icon-packs-bring-your-own).

Not for: an estate that is only Azure (use `azure`), a cloud-neutral overview (use `systems`), pods and services inside a cluster (use `kubernetes`), devices, cabling and an IP plan (use `network`).

```yaml
type: cloud
provider: aws
title: Web shop
direction: down
groups:
  vpc: { kind: vpc, cidr: 10.0.0.0/16 }
  az-a: { kind: zone, zone: eu-west-1a, in: vpc }
  public-a: { kind: subnet, tier: public, cidr: 10.0.0.0/24, in: az-a }
  app-a: { kind: subnet, tier: private, cidr: 10.0.10.0/24, in: az-a }
nodes:
  users: users
  alb: { kind: alb, in: public-a, exposure: public }
  web: { kind: ecs, label: Web shop, in: app-a, size: 2 vCPU }
edges:
  - users -> alb: { label: HTTPS, style: public }
  - alb -> web: { style: private }
```

Import what Terraform knows with `terraform show -json > state.json` (or `terraform show -json plan.out`) and `carto import state.json`: VPCs, zones and subnets become containers (public, private or isolated by their route out), about a hundred AWS and Google resource types become services in the right one, and lines follow references, event sources, listeners and security group rules. Ids come from the resource addresses, so pins survive a re-import. It reads the file only; nothing calls a cloud API.

Examples: [examples/cloud](../examples/cloud) · deployments of a model: [examples/deployment](../examples/deployment)

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

Labels never collide: every message has its own row, a long label wraps, and each gap between lifelines is as wide as its widest label. Built on the lanes engine (`packages/lanes`), which also carries git branching and roadmaps.

Presenting: a sequence diagram steps through its messages by itself, one at a time (`P` in the editor, `carto render checkout.yaml --all-steps`). See [steps.md](steps.md).

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

## Journey map

`type: journey` · what one person goes through, step by step, and how it feels.

Use it for a developer's first week from laptop to first deploy, asking for access today next to the self-service way, a service blueprint with frontstage, backstage and support, or a storyboard that tells a slide deck step by step.

Not for: messages between systems in one flow (`sequence`), a plan with dates and milestones (`roadmap`), or a process with decisions and branches (`systems`).

The short form is one line per step, the key being what they do and the number how it feels:

```yaml
type: journey
title: A developer's first week
persona: Dana, new backend developer
phases:
  day1: Day one
  commit: First commit
steps:
  Collect laptop: 4                 # a score, 1..5 unless scale: says otherwise
  Request access: { in: day1, feel: 2 frustrated, with: Service desk }
  Wait for access: 1                # no in: the phase of the step above
  Clone the repository: { in: commit, feel: 3 }
  Open a pull request: 5 proud      # a score and the feeling in a word
```

Everything a step can carry:

```yaml
persona:
  name: Dana
  role: New backend developer
  avatar: bob                       # short | long | bun | curly | bob | beard | headscarf | cap | glasses; else initials
  goal: Ship a first change in week one
  quote: I just want to know where to start.
scale: 1..5                         # worst..best, also -2..2 or 0..10; default: what the scores fit in
steps:
  deploy:
    label: First deploy
    in: commit
    feel: 2 anxious
    thought: Did I just break production?    # a thought bubble; says: a speech bubble
    touchpoint:                              # what they use; link: opens that diagram, ref: an element of the model
      - Developer portal
      - { label: Delivery pipeline, link: ../gitflow/trunk-delivery.yaml }
    with: [Platform team, Buddy]             # who else is involved
    pains: No preview environment            # one or a list
    gains: The pipeline is fast
    ideas: Preview environment per pull request
    metrics: { Lead time: 3 days }
    frontstage: Portal shows the rollout     # the rows of a service blueprint
    backstage: Pipeline deploys to test
    support: Platform team on call
metrics: { Time to first deploy: 9 days }    # the numbers of the whole journey, beside the persona
rows: [steps, feeling, thoughts, { ideas: Next steps }]   # order and names; default: all rows that have something
hide: [metrics]
view: map                                    # map | storyboard | blueprint | compare
future:                                      # a second journey through the same phases
  label: With self-service
  steps: { Request access: { in: day1, feel: 4 } }
  metrics: { Time to first deploy: 2 days }
```

Four views of the same steps, picked with `view:`, `--view` or the view menu:

- `map`: phases as columns, a row each for what they do, touchpoints, the feeling curve, thoughts, pains, gains, opportunities and metrics. Rows nothing fills are left out.
- `storyboard`: one card per step with its thought, feeling and notes, in reading order; the one to present from.
- `blueprint`: the journey over the lines of interaction and visibility, with frontstage, backstage and support rows (offered when steps have them).
- `compare`: today and `future:` above each other with both curves in one chart and the numbers side by side (the default when there is a `future:`).

The feeling curve is not colour-only: every point is a face, the lowest and highest are called out, and a dashed line marks neutral. A score outside the scale is drawn at the edge, with a warning. The drawing picks its column width (or cards per row) to come close to 16:9, so it fills a slide.

Presenting tells the journey one step at a time: the step in focus is outlined, the rest is quiet and the curve is drawn up to that point; the caption is the step's thought. A comparison is told phase by phase. `carto render --all-steps` gives the same as slides or pages. In PowerPoint the journey is native shapes and text boxes (the curve an editable freeform), not a picture.

Import: Mermaid `journey` (sections become phases, tasks steps with their score; the actor in most tasks becomes the persona, the others go to `with:`).

Examples: [examples/journey](../examples/journey)

## Adding a type

A type describes itself with a few optional fields on its `DiagramType` (`packages/core/src/diagram-type.ts`): `icon`, `tagline`, `useWhen`, `notFor` (with `use` pointing at a better type id) and `keywords` for the search box. The start dialog, `carto types` and the editor pick them up; add a section and a row to this page too.
